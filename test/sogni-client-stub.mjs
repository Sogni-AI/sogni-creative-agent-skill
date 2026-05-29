import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';

const ClientEvent = {
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_FAILED: 'JOB_FAILED',
  PROJECT_PROGRESS: 'PROJECT_PROGRESS',
  PROJECT_FAILED: 'PROJECT_FAILED',
  PROJECT_EVENT: 'PROJECT_EVENT',
  JOB_EVENT: 'JOB_EVENT'
};

function getState() {
  if (!globalThis.__SOGNI_AGENT_TEST_STATE__) {
    globalThis.__SOGNI_AGENT_TEST_STATE__ = { instances: [] };
  }
  return globalThis.__SOGNI_AGENT_TEST_STATE__;
}

function persistState() {
  const statePath = process.env.SOGNI_AGENT_TEST_STATE_PATH;
  if (!statePath) return;
  const state = getState();
  const replacer = (_key, value) => {
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return {
        __blob: true,
        type: value.type,
        size: value.size
      };
    }
    return value;
  };
  try {
    writeFileSync(statePath, JSON.stringify({
      clientConfigs: state.clientConfigs ?? null,
      socketEventSubscriptionUpdates: state.socketEventSubscriptionUpdates ?? null,
      lastImageProject: state.lastImageProject ?? null,
      lastVideoProject: state.lastVideoProject ?? null,
      lastAudioProject: state.lastAudioProject ?? null,
      lastEditProject: state.lastEditProject ?? null,
      lastEstimateVideoCost: state.lastEstimateVideoCost ?? null,
      emittedJobs: state.emittedJobs ?? null
    }, replacer));
  } catch (err) {
    // Ignore persistence errors in tests.
  }
}

class SogniClientWrapper extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.connected = false;
    this.lastImageProject = null;
    this.lastVideoProject = null;
    this.lastAudioProject = null;
    this.lastEditProject = null;
    this.emittedJobs = 0;
    this.client = {
      setSocketEventSubscriptions: async (socketEventSubscriptions) => {
        const currentState = getState();
        currentState.socketEventSubscriptionUpdates = currentState.socketEventSubscriptionUpdates || [];
        currentState.socketEventSubscriptionUpdates.push(socketEventSubscriptions);
        persistState();
      }
    };
    const state = getState();
    state.clientConfigs = state.clientConfigs || [];
    state.clientConfigs.push(config);
    state.instances.push(this);
    persistState();
  }

  async connect() {
    // Simulate the SDK rejecting connect() with a REST 401 (invalid API key).
    if (process.env.SOGNI_AGENT_TEST_CONNECT_REST_401) {
      const err = new Error('Invalid API key');
      err.status = 401;
      err.payload = { status: 'error', errorCode: 101, message: 'Invalid API key' };
      throw err;
    }
    // Simulate the SDK's detached auth-failure cascade: a 401 tears down the
    // socket and throws "WebSocket was closed before the connection was
    // established" from a microtask that never reaches connect()'s awaiter.
    // This is the case that previously crashed the process with a raw stack.
    if (process.env.SOGNI_AGENT_TEST_CONNECT_WS_CRASH) {
      queueMicrotask(() => {
        const err = new Error('WebSocket was closed before the connection was established');
        err.stack = [
          'Error: WebSocket was closed before the connection was established',
          '    at WebSocketClient.disconnect (sogni-client/WebSocketClient/index.js:100:16)',
          '    at ApiClient.handleAuthUpdated (sogni-client/ApiClient/index.js:129:29)',
          '    at ApiKeyAuthManager.clear (sogni-client/AuthManager/ApiKeyAuthManager.js:34:14)'
        ].join('\n');
        throw err;
      });
      // Never resolves: the process must survive on the global handler firing.
      await new Promise(() => {});
    }
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  async createImageProject(config) {
    const state = getState();
    this.lastImageProject = config;
    state.lastImageProject = config;
    persistState();
    if (process.env.SOGNI_AGENT_TEST_IMAGE_PROJECT_RESULT_JSON) {
      return JSON.parse(process.env.SOGNI_AGENT_TEST_IMAGE_PROJECT_RESULT_JSON);
    }
    this._emitJobs('resultUrl', config.numberOfMedia ?? 1, config.seed);
    return { project: { id: 'proj-1' } };
  }

  async createImageEditProject(config) {
    const state = getState();
    this.lastEditProject = config;
    state.lastEditProject = config;
    persistState();
    if (process.env.SOGNI_AGENT_TEST_IMAGE_EDIT_PROJECT_RESULT_JSON) {
      return JSON.parse(process.env.SOGNI_AGENT_TEST_IMAGE_EDIT_PROJECT_RESULT_JSON);
    }
    this._emitJobs('resultUrl', config.numberOfMedia ?? 1, config.seed);
    return { project: { id: 'proj-1' } };
  }

  async createVideoProject(config) {
    const state = getState();
    this.lastVideoProject = config;
    state.lastVideoProject = config;
    persistState();
    if (process.env.SOGNI_AGENT_TEST_VIDEO_PROJECT_ERROR) {
      throw new Error(process.env.SOGNI_AGENT_TEST_VIDEO_PROJECT_ERROR);
    }
    if (process.env.SOGNI_AGENT_TEST_VIDEO_PROJECT_RESULT_JSON) {
      // Simulate the SDK returning an error-shaped result (the path
      // sogni-agent.mjs guards with `if (videoResult?.error || ...)`)
      // instead of throwing. Used to exercise the structured-result
      // failure branch end-to-end.
      return JSON.parse(process.env.SOGNI_AGENT_TEST_VIDEO_PROJECT_RESULT_JSON);
    }
    this._emitJobs('resultUrl', config.numberOfMedia ?? 1, config.seed);
    return { project: { id: 'proj-1' }, videoUrls: ['https://example.com/video.mp4'] };
  }

  async createAudioProject(config) {
    const state = getState();
    this.lastAudioProject = config;
    state.lastAudioProject = config;
    persistState();
    this._emitJobs('audioUrl', config.numberOfMedia ?? 1, config.seed);
    return { project: { id: 'proj-1' }, audioUrls: ['https://example.com/audio.mp3'] };
  }

  async getBalance() {
    if (process.env.SOGNI_AGENT_TEST_BALANCE_JSON) {
      return JSON.parse(process.env.SOGNI_AGENT_TEST_BALANCE_JSON);
    }
    return {
      sogni: 100,
      spark: 100,
      lastUpdated: new Date()
    };
  }

  async estimateVideoCost() {
    const state = getState();
    state.lastEstimateVideoCost = arguments[0] ?? null;
    persistState();
    return {
      token: '1',
      usd: '0.01',
      spark: '1',
      sogni: '1'
    };
  }

  _emitJobs(urlField, count, seed) {
    queueMicrotask(() => {
      const state = getState();
      const ext = urlField === 'videoUrl' ? 'mp4' : urlField === 'audioUrl' ? 'mp3' : 'png';
      for (let i = 0; i < count; i++) {
        this.emittedJobs += 1;
        state.emittedJobs = this.emittedJobs;
        this.emit(ClientEvent.JOB_COMPLETED, {
          [urlField]: `https://example.com/${urlField}-${i + 1}.${ext}`,
          job: { data: { seed: seed ?? 123 } },
          jobIndex: i,
          projectId: 'proj-1'
        });
      }
      persistState();
    });
  }
}

function getMaxContextImages(modelId) {
  if (modelId && modelId.includes('qwen_image_edit_2511')) return 3;
  return 0;
}

export { SogniClientWrapper, ClientEvent, getMaxContextImages };
