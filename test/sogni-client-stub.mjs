import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

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
      canceledProjectIds: state.canceledProjectIds ?? null,
      emittedJobs: state.emittedJobs ?? null,
      projectLookups: state.projectLookups ?? null,
      sequence: state.sequence ?? null
    }, replacer));
  } catch (err) {
    // Ignore persistence errors in tests.
  }
}

const envJson = (name) => (process.env[name] ? JSON.parse(process.env[name]) : undefined);

function recordLookup(entry) {
  const state = getState();
  state.projectLookups = state.projectLookups || [];
  state.projectLookups.push(entry);
  recordSequence(`${entry.method}:${entry.projectId ?? ''}`);
}

/** Order of socket syncs, in-flight reads, completions and result reads (for --wait). */
function recordSequence(event) {
  const state = getState();
  state.sequence = state.sequence || [];
  state.sequence.push(event);
  persistState();
}

/**
 * A tracked SDK Project rebuilt by projects.sync(): settles through its own
 * events after `completeAfterMs` (or fails when `fail` is set), with no request.
 */
function makeTrackedProject(spec) {
  const project = new EventEmitter();
  Object.assign(project, { id: spec.id, status: spec.status ?? 'queued', waitingReason: spec.waitingReason ?? null });
  const done = new Promise((resolve, reject) => {
    setTimeout(() => {
      project.status = spec.fail ? 'failed' : 'completed';
      project.waitingReason = null;
      recordSequence(`${project.status}:${project.id}`);
      project.emit('updated', ['status']);
      if (spec.fail) reject(Object.assign(new Error('Project failed'), { code: 0 }));
      else resolve(['https://cdn.test/result']);
    }, spec.completeAfterMs ?? 0);
  });
  done.catch(() => {});
  project.waitForCompletion = () => done;
  return project;
}

/**
 * The raw @sogni-ai/sogni-client `projects` API the skill reaches through
 * `wrapper.client`: queue explanations (queueChanged), results by id, recent
 * projects and the account's other in-flight projects.
 * SOGNI_AGENT_TEST_SDK_WITHOUT_RESULTS simulates an SDK older than 5.57.0.
 */
function makeSdkProjects(appId) {
  const projects = new EventEmitter();
  if (!process.env.SOGNI_AGENT_TEST_SDK_WITHOUT_RESULTS) {
    projects.getResult = async (projectId, options) => {
      recordLookup({ method: 'getResult', projectId, options: options ?? null });
      const failure = envJson('SOGNI_AGENT_TEST_GET_RESULT_ERROR_JSON');
      if (failure) throw Object.assign(new Error(failure.message || 'Request failed'), failure);
      const result = envJson('SOGNI_AGENT_TEST_GET_RESULT_JSON');
      if (!result) throw Object.assign(new Error('Not Found'), { status: 404 });
      return result;
    };
    projects.listRecent = async (options) => {
      recordLookup({ method: 'listRecent', options });
      return envJson('SOGNI_AGENT_TEST_LIST_RECENT_JSON') ?? [];
    };
  }
  // SOGNI_AGENT_TEST_ELSEWHERE_SEQUENCE_JSON: one in-flight list per call (the last repeats).
  let elsewhereCalls = 0;
  projects.listProjectsElsewhere = async () => {
    const sequence = envJson('SOGNI_AGENT_TEST_ELSEWHERE_SEQUENCE_JSON');
    if (!sequence) return envJson('SOGNI_AGENT_TEST_ELSEWHERE_JSON') ?? [];
    recordSequence('elsewhere');
    return sequence[Math.min(elsewhereCalls++, sequence.length - 1)];
  };
  // SOGNI_AGENT_TEST_TRACKED_JSON: { [appId]: [project spec] } rebuilt by sync() for that app id.
  let tracked = null;
  projects.sync = async () => {
    recordSequence(`sync:${appId}`);
    tracked = tracked ?? (envJson('SOGNI_AGENT_TEST_TRACKED_JSON')?.[appId] ?? []).map(makeTrackedProject);
  };
  Object.defineProperty(projects, 'trackedProjects', { get: () => (tracked ?? []).slice() });
  return projects;
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
      projects: makeSdkProjects(config?.appId),
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
    if (process.env.SOGNI_AGENT_TEST_CONNECT_APP_ID_LIMIT) {
      const err = new Error('Too many app IDs for this address. Reuse the same application ID and wait before retrying.');
      err.code = 4061;
      err.reason = err.message;
      throw err;
    }
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
    recordSequence(`disconnect:${this.config?.appId}`);
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
    return { project: this._makeProject('proj-1') };
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
    return { project: this._makeProject('proj-1') };
  }

  async createVideoProject(config) {
    const state = getState();
    this.lastVideoProject = config;
    state.lastVideoProject = config;
    persistState();
    if (process.env.SOGNI_AGENT_TEST_VIDEO_PROJECT_WRAPPED_ERROR) {
      const originalError = new Error(process.env.SOGNI_AGENT_TEST_VIDEO_PROJECT_WRAPPED_ERROR);
      const error = new Error('Project creation failed');
      error.code = 'PROJECT_ERROR';
      error.originalError = originalError;
      throw error;
    }
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
    this._scheduleQueueEvents();
    return { project: this._makeProject('proj-1'), videoUrls: ['https://example.com/video.mp4'] };
  }

  async createAudioProject(config) {
    const state = getState();
    this.lastAudioProject = config;
    state.lastAudioProject = config;
    persistState();
    this._emitJobs('audioUrl', config.numberOfMedia ?? 1, config.seed);
    return { project: this._makeProject('proj-1'), audioUrls: ['https://example.com/audio.mp3'] };
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

  async getSubscriptionStatus() {
    if (process.env.SOGNI_AGENT_TEST_SUBSCRIPTION_ERROR) {
      throw new Error(process.env.SOGNI_AGENT_TEST_SUBSCRIPTION_ERROR);
    }
    if (process.env.SOGNI_AGENT_TEST_SUBSCRIPTION_JSON) {
      return JSON.parse(process.env.SOGNI_AGENT_TEST_SUBSCRIPTION_JSON);
    }
    return { active: false, status: 'none' };
  }

  async getAccountInfo() {
    if (process.env.SOGNI_AGENT_TEST_ACCOUNT_INFO_JSON) {
      return JSON.parse(process.env.SOGNI_AGENT_TEST_ACCOUNT_INFO_JSON);
    }
    return { username: 'stub-user', network: 'fast', isUnlimited: false };
  }

  async getAvailableModels(options = {}) {
    let models = process.env.SOGNI_AGENT_TEST_MODELS_JSON
      ? JSON.parse(process.env.SOGNI_AGENT_TEST_MODELS_JSON)
      : [
          {
            id: 'dark_beast_krea2_fp8',
            name: 'Dark Beast KREA 2 黑兽',
            workerCount: 42,
            media: 'image'
          },
          {
            id: 'ltx23-22b-fp8_t2v_distilled',
            name: 'LTX-2.3 22B',
            workerCount: 24,
            media: 'video'
          },
          {
            id: 'ace_step_1.5_xl_turbo',
            name: 'ACE-Step 1.5 XL Turbo',
            workerCount: 12,
            media: 'audio'
          }
        ];
    if (options.minWorkers !== undefined) {
      models = models.filter((model) => model.workerCount >= options.minWorkers);
    }
    if (options.sortByWorkers) {
      models = [...models].sort((a, b) => b.workerCount - a.workerCount);
    }
    return models.map((model) => ({
      ...model,
      isAvailable: model.workerCount > 0,
      recommendedSettings: model.recommendedSettings || {}
    }));
  }

  async estimateVideoCost() {
    if (process.env.SOGNI_AGENT_TEST_VIDEO_COST_ERROR) {
      throw new Error(process.env.SOGNI_AGENT_TEST_VIDEO_COST_ERROR);
    }
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
    if (process.env.SOGNI_AGENT_TEST_SUPPRESS_JOB_EVENTS) return;
    if (process.env.SOGNI_AGENT_TEST_FAILURE_EVENT_JSON) {
      const { event, payload } = JSON.parse(process.env.SOGNI_AGENT_TEST_FAILURE_EVENT_JSON);
      setImmediate(() => this.emit(event, payload));
      return;
    }
    queueMicrotask(() => {
      const state = getState();
      const ext = urlField === 'videoUrl' ? 'mp4' : urlField === 'audioUrl' ? 'mp3' : 'png';
      // One labels object for every job, or an array with one per job index.
      const labels = envJson('SOGNI_AGENT_TEST_JOB_LABELS_JSON');
      for (let i = 0; i < count; i++) {
        this.emittedJobs += 1;
        state.emittedJobs = this.emittedJobs;
        this.emit(ClientEvent.JOB_COMPLETED, {
          [urlField]: process.env.SOGNI_AGENT_TEST_RESULT_URL || `https://example.com/${urlField}-${i + 1}.${ext}`,
          job: {
            data: { seed: seed ?? 123 },
            ...(Array.isArray(labels) ? labels[i] : labels)
          },
          jobIndex: i,
          projectId: 'proj-1'
        });
      }
      persistState();
    });
  }

  /** SOGNI_AGENT_TEST_QUEUE_EVENTS_JSON: [{ afterMs, projectId, waitingReason }] as queueChanged events. */
  _scheduleQueueEvents() {
    for (const event of envJson('SOGNI_AGENT_TEST_QUEUE_EVENTS_JSON') ?? []) {
      setTimeout(() => {
        this.client.projects.emit('queueChanged', {
          projectId: event.projectId ?? 'proj-1',
          waitingReason: event.waitingReason ?? null,
          jobWaitingReasons: []
        });
      }, event.afterMs ?? 0);
    }
  }

  _makeProject(id) {
    return {
      id,
      cancel: async () => {
        const state = getState();
        state.canceledProjectIds = state.canceledProjectIds || [];
        state.canceledProjectIds.push(id);
        persistState();
      }
    };
  }
}

function getMaxContextImages(modelId) {
  if (modelId && modelId.includes('qwen_image_edit_2511')) return 3;
  if (
    modelId === 'krea2_identity_edit_v1_2'
    || modelId === 'dark_beast_krea2_identity_edit_v1_2'
  ) return 2;
  return 0;
}

// The CLI clamps video sizes to the pinned client's getVideoDimensionRules().
// The stub omits it by default, which leaves the CLI on its legacy fallback
// constants. A test that must see the real envelope (the Wan 3 1536 clamp hid
// behind that fallback) opts in, and gets the installed client's own rules.
const getVideoDimensionRules = process.env.SOGNI_AGENT_TEST_REAL_VIDEO_DIMENSION_RULES === '1'
  ? createRequire(import.meta.url)('@sogni-ai/sogni-intelligence-client').getVideoDimensionRules
  : undefined;

export { SogniClientWrapper, ClientEvent, getMaxContextImages, getVideoDimensionRules };
