import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import JSON5 from 'json5';
import {
  getModelDefaults,
  resolveVideoSteps,
  selectDefaultVideoModel
} from '../generated/creative-agent-runtime.mjs';

const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const handle = originalSetInterval(...args);
  if (handle?.unref) handle.unref();
  return handle;
};

let SogniClientWrapper;
let sogniClientImportError = null;
try {
  ({ SogniClientWrapper } = await import('@sogni-ai/sogni-intelligence-client'));
} catch (err) {
  sogniClientImportError = err;
}
async function getSogniClientWrapper() {
  if (sogniClientImportError) throw sogniClientImportError;
  return SogniClientWrapper;
}

// Paid integration tests are strictly opt-in: they submit real GPU jobs and
// spend Spark. Run them with SOGNI_INTEGRATION=1 (npm run test:integration).
const integrationFlag = process.env.SOGNI_INTEGRATION;
const shouldRun = integrationFlag === undefined
  ? false
  : ['1', 'true', 'yes'].includes(integrationFlag.toLowerCase());
const credentialsPath = join(homedir(), '.config', 'sogni', 'credentials');
const openclawConfigPath = process.env.OPENCLAW_CONFIG_PATH || join(homedir(), '.openclaw', 'openclaw.json');
const hasCreds = Boolean(loadCredentials());

const IMAGE_TIMEOUT_SEC = Number(process.env.SOGNI_INTEGRATION_IMAGE_TIMEOUT_SEC || 60);
const VIDEO_TIMEOUT_SEC = Number(process.env.SOGNI_INTEGRATION_VIDEO_TIMEOUT_SEC || 600);
const PROCESS_TIMEOUT_MS = Math.max(IMAGE_TIMEOUT_SEC, VIDEO_TIMEOUT_SEC) * 1000 + 120000;
const ARTIFACT_LOG_PATH = process.env.SOGNI_ARTIFACT_LOG_PATH || join(
  process.cwd(),
  'logs',
  `sogni-agent-integration-artifacts-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
);
const ARTIFACT_LOG_KEEP = 10;

// Each run appends a new timestamped artifact file forever; keep only the most
// recent few so logs/ does not grow without bound.
function pruneOldArtifactLogs() {
  const logsDir = join(process.cwd(), 'logs');
  if (!existsSync(logsDir)) return;
  let entries;
  try {
    entries = readdirSync(logsDir)
      .filter((name) => /^sogni-agent-integration-artifacts-.*\.jsonl$/.test(name))
      .map((name) => {
        const filePath = join(logsDir, name);
        return { filePath, mtimeMs: statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return;
  }
  for (const entry of entries.slice(ARTIFACT_LOG_KEEP)) {
    try { unlinkSync(entry.filePath); } catch { /* best effort */ }
  }
}
pruneOldArtifactLogs();

const TESTS = [
  { key: 't2i', name: 'Text-to-image 512x512' },
  { key: 't2v', name: 'Text-to-video 640x640' },
  { key: 'i2v', name: 'Image-to-video 512x512' },
  { key: 'ltx23-i2v-audio-id', name: 'LTX 2.3 first-frame + Audio ID' }
];

function loadOpenClawPluginConfig() {
  if (process.env.OPENCLAW_PLUGIN_CONFIG) {
    try {
      return JSON5.parse(process.env.OPENCLAW_PLUGIN_CONFIG);
    } catch (err) {
      return null;
    }
  }
  if (!existsSync(openclawConfigPath)) return null;
  try {
    const raw = readFileSync(openclawConfigPath, 'utf8');
    const parsed = JSON5.parse(raw);
    return parsed?.plugins?.entries?.['sogni-creative-agent-skill']?.config || null;
  } catch (err) {
    return null;
  }
}

const openclawConfig = loadOpenClawPluginConfig();
const defaultTokenType = (openclawConfig?.defaultTokenType || 'spark').toLowerCase();

function loadCredentials() {
  if (process.env.SOGNI_API_KEY) {
    return {
      apiKey: process.env.SOGNI_API_KEY
    };
  }
  if (!existsSync(credentialsPath)) return null;
  const content = readFileSync(credentialsPath, 'utf8');
  const creds = {};
  for (const line of content.split('\n')) {
    const [key, value] = line.split('=');
    if (key && value) creds[key.trim()] = value.trim();
  }
  if (creds.SOGNI_API_KEY) {
    return {
      apiKey: creds.SOGNI_API_KEY
    };
  }
  return null;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(2);
}

function logGeneratedArtifacts(label, payload) {
  const urls = Array.isArray(payload?.urls) ? payload.urls.filter(Boolean) : [];
  const localPath = typeof payload?.localPath === 'string' && payload.localPath
    ? payload.localPath
    : null;
  if (urls.length === 0 && !localPath) return;

  const record = {
    timestamp: new Date().toISOString(),
    label,
    type: payload.type,
    prompt: payload.prompt,
    model: payload.model,
    workflow: payload.workflow,
    width: payload.width,
    height: payload.height,
    fps: payload.fps,
    duration: payload.duration,
    localPath,
    urls
  };

  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  appendFileSync(ARTIFACT_LOG_PATH, `${JSON.stringify(record)}\n`);
  console.log(`[artifact-log] ${label}: ${ARTIFACT_LOG_PATH}`);
  for (const url of urls) console.log(`[artifact-url] ${label}: ${url}`);
  if (localPath) console.log(`[artifact-file] ${label}: ${localPath}`);
}

function resolveVideoModel(workflow) {
  if (!workflow) return null;
  return selectDefaultVideoModel(workflow, {}, openclawConfig);
}

function writeTestVoiceIdentityWav(filePath) {
  const sampleRate = 22050;
  const durationSeconds = 2.4;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t / 0.12, (durationSeconds - t) / 0.18);
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.2 * t);
    const carrier =
      Math.sin(2 * Math.PI * 170 * t) * 0.55 +
      Math.sin(2 * Math.PI * 245 * t) * 0.25 +
      Math.sin(2 * Math.PI * 510 * t) * 0.12;
    const sample = Math.max(-1, Math.min(1, carrier * syllable * envelope * 0.65));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  writeFileSync(filePath, buffer);
}

function encodeAudioToWav(inputPath, outputPath) {
  const ffmpeg = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '22050',
    '-c:a', 'pcm_s16le',
    outputPath
  ], { stdio: 'ignore' });
  if (ffmpeg.status === 0 && existsSync(outputPath)) return true;

  const afconvert = spawnSync('afconvert', [
    '-f', 'WAVE',
    '-d', 'LEI16@22050',
    inputPath,
    outputPath
  ], { stdio: 'ignore' });
  return afconvert.status === 0 && existsSync(outputPath);
}

function createTestVoiceIdentityAudio(workDir) {
  const spokenPath = join(workDir, 'voice-identity-source.aiff');
  const wavPath = join(workDir, 'voice-identity.wav');
  const say = spawnSync('say', [
    '-o', spokenPath,
    'This is a short voice identity sample for Sogni integration testing.'
  ], { stdio: 'ignore' });
  if (say.status === 0 && existsSync(spokenPath) && encodeAudioToWav(spokenPath, wavPath)) {
    return wavPath;
  }

  writeTestVoiceIdentityWav(wavPath);
  return wavPath;
}

function parseCostEstimate(estimate, tokenType) {
  if (!estimate) return null;
  const raw = tokenType === 'sogni'
    ? estimate.sogni ?? estimate.token
    : estimate.spark ?? estimate.token;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function renderStatus(statuses) {
  return TESTS.map((testDef, index) => {
    const status = statuses[testDef.key] || 'pending';
    const label = status === 'pass'
      ? '[OK]'
      : status === 'fail'
        ? '[FAIL]'
        : status === 'skip'
          ? '[SKIP]'
        : status === 'running'
          ? '[..]'
          : '[ ]';
    return `${label} ${index + 1}/${TESTS.length} ${testDef.name}`;
  }).join('\n');
}

function createStickyHeader() {
  const statuses = {};
  const isTTY = Boolean(process.stdout.isTTY);
  let headerLines = 0;
  let initialized = false;

  const buildHeader = () => {
    const header = `Integration test status:\n${renderStatus(statuses)}`;
    headerLines = header.split('\n').length;
    return header;
  };

  const init = () => {
    if (!isTTY || initialized) return;
    initialized = true;
    const header = buildHeader();
    const rows = process.stdout.rows || 24;

    process.stdout.write('\u001b[2J');
    process.stdout.write('\u001b[H');
    process.stdout.write(`${header}\n`);

    const scrollStart = Math.min(headerLines + 1, rows);
    process.stdout.write(`\u001b[${scrollStart};${rows}r`);
    process.stdout.write(`\u001b[${rows};1H`);
  };

  const update = () => {
    const header = buildHeader();
    if (!isTTY) {
      process.stdout.write(`${header}\n`);
      return;
    }
    if (!initialized) init();
    process.stdout.write('\u001b7');
    process.stdout.write('\u001b[H');
    process.stdout.write('\u001b[J');
    process.stdout.write(`${header}\n`);
    process.stdout.write('\u001b8');
  };

  const reset = () => {
    if (!isTTY || !initialized) return;
    process.stdout.write('\u001b[r');
  };

  return {
    init,
    setRunning(key) {
      statuses[key] = 'running';
      update();
    },
    setPass(key) {
      statuses[key] = 'pass';
      update();
    },
    setFail(key) {
      statuses[key] = 'fail';
      update();
    },
    setSkip(key) {
      statuses[key] = 'skip';
      update();
    },
    reset
  };
}

async function logAccountInfo() {
  const creds = loadCredentials();
  if (!creds) {
    console.log('Sogni API key: missing');
    return;
  }
  console.log('Sogni API key: configured');

  const Wrapper = await getSogniClientWrapper();
  const client = new Wrapper({
    autoConnect: false,
    apiKey: creds.apiKey,
    authType: 'apiKey'
  });

  try {
    await client.connect();
    const balance = await client.getBalance();
    console.log(`Balance: ${formatNumber(balance.sogni)} SOGNI, ${formatNumber(balance.spark)} SPARK`);
  } catch (err) {
    console.log(`Balance: unavailable (${err?.message || 'error'})`);
  } finally {
    try {
      if (client.isConnected?.()) await client.disconnect();
    } catch (err) {
      // Ignore disconnect errors.
    }
  }
}

async function checkVideoBudget({ workflow, modelId: explicitModelId, label, width, height, fps, duration, frames, count }) {
  const creds = loadCredentials();
  if (!creds) {
    return { ok: false, reason: 'Missing API key' };
  }

  const modelId = explicitModelId || resolveVideoModel(workflow);
  if (!modelId) {
    return { ok: true };
  }

  const tokenType = defaultTokenType;
  const tokenLabel = tokenType.toUpperCase();
  const resolvedFps = fps ?? openclawConfig?.defaultFps ?? 16;
  const resolvedDuration = duration ?? openclawConfig?.defaultDurationSec ?? 5;
  const modelDefaults = getModelDefaults(modelId, openclawConfig);
  const steps = resolveVideoSteps(modelId, modelDefaults, null);

  const Wrapper = await getSogniClientWrapper();
  const client = new Wrapper({
    autoConnect: false,
    apiKey: creds.apiKey,
    authType: 'apiKey'
  });

  try {
    await client.connect();
    const balance = await client.getBalance();
    const available = tokenType === 'sogni' ? balance.sogni : balance.spark;
    if (!Number.isFinite(available) || available <= 0) {
      return {
        ok: false,
        reason: `Insufficient ${tokenLabel} balance (have ${formatNumber(available)})`
      };
    }

    if (!Number.isFinite(steps) || steps <= 0) {
      return { ok: true };
    }

    const estimate = await client.estimateVideoCost({
      modelId,
      width,
      height,
      fps: resolvedFps,
      steps,
      numberOfMedia: count,
      tokenType,
      ...(frames ? { frames } : { duration: resolvedDuration })
    });
    const required = parseCostEstimate(estimate, tokenType);
    if (Number.isFinite(required) && available < required) {
      return {
        ok: false,
        reason: `Insufficient ${tokenLabel} balance (need ~${formatNumber(required)}, have ${formatNumber(available)})`
      };
    }
    return { ok: true };
  } catch (err) {
    console.log(`Balance check skipped for ${label}: ${err?.message || 'error'}`);
    return { ok: true };
  } finally {
    try {
      if (client.isConnected?.()) await client.disconnect();
    } catch (err) {
      // Ignore disconnect errors.
    }
  }
}

function runCli(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'sogni-agent.mjs'), ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let elapsed = 0;
    const heartbeat = setInterval(() => {
      elapsed += 60;
      console.log(`[heartbeat] ${label}: +${elapsed}s`);
    }, 60000);

    const timeout = setTimeout(() => {
      clearInterval(heartbeat);
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out after ${PROCESS_TIMEOUT_MS / 1000}s`));
    }, PROCESS_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', (err) => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code) => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`CLI failed (code ${code}).\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error(`CLI returned no JSON output. STDERR:\n${stderr}`));
        return;
      }
      const jsonText = trimmed
        .split(/\r?\n/)
        .map(line => line.trim())
        .reverse()
        .find(line => line.startsWith('{') && line.endsWith('}'));
      if (!jsonText) {
        reject(new Error(`CLI returned no JSON object. STDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        return;
      }
      let json;
      try {
        json = JSON.parse(jsonText);
      } catch (err) {
        reject(new Error(`Failed to parse JSON output.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        return;
      }
      resolve(json);
    });
  });
}

async function runSubtest(t, status, key, name, fn) {
  status.setRunning(key);
  let caughtError = null;
  try {
    await t.test(name, async () => {
      try {
        await fn();
      } catch (err) {
        caughtError = err;
        throw err;
      }
    });
  } catch (err) {
    caughtError = caughtError || err;
  }
  if (caughtError) {
    status.setFail(key);
    throw caughtError;
  }
  status.setPass(key);
}

if (!shouldRun) {
  test('integration: generate image + videos (skipped)', { skip: 'Paid integration tests are opt-in: set SOGNI_INTEGRATION=1 (they submit real GPU jobs).' }, () => {});
} else if (!hasCreds) {
  test('integration: generate image + videos (skipped)', { skip: 'Provide SOGNI_API_KEY or a ~/.config/sogni/credentials file containing SOGNI_API_KEY.' }, () => {});
} else if (sogniClientImportError?.code === 'ERR_UNSUPPORTED_DIR_IMPORT') {
  // Upstream @sogni-ai/sogni-client@5.x ships ESM that relies on directory
  // imports unsupported by Node's ESM resolver. Skip rather than fail until
  // the upstream package republishes with explicit subpath exports.
  test('integration: generate image + videos (skipped)', { skip: `sogni-client@5 ESM directory-import bug: ${sogniClientImportError.message}` }, () => {});
} else {
  test('integration: text-to-image, text-to-video, image-to-video', async (t) => {
    const status = createStickyHeader();
    status.init();

    await logAccountInfo();

    const workDir = mkdtempSync(join(tmpdir(), 'sogni-agent-int-'));
    const imagePath = join(workDir, 't2i-512.png');
    const voicePath = createTestVoiceIdentityAudio(workDir);
    const total = TESTS.length;

    try {
      await runSubtest(t, status, 't2i', 'Text-to-image 512x512', async () => {
        console.log(`Running test 1/${total}: Text-to-image 512x512`);
        const json = await runCli([
          '--json',
          '--width', '512',
          '--height', '512',
          '--timeout', String(IMAGE_TIMEOUT_SEC),
          '-o', imagePath,
          'a simple ceramic mug on a wooden table'
        ], 'Text-to-image 512x512');

        assert.equal(json.success, true);
        assert.equal(json.type, 'image');
        assert.equal(json.width, 512);
        assert.equal(json.height, 512);
        assert.ok(Array.isArray(json.urls) && json.urls.length > 0, 'image url missing');
        assert.ok(existsSync(imagePath), 'image file not written');
        logGeneratedArtifacts('Text-to-image 512x512', json);
      });

      const t2vBudget = await checkVideoBudget({
        workflow: 't2v',
        label: 'Text-to-video 640x640',
        width: 640,
        height: 640,
        count: 1
      });
      if (!t2vBudget.ok) {
        const reason = t2vBudget.reason || 'Insufficient balance for video render';
        status.setSkip('t2v');
        await t.test('Text-to-video 640x640', { skip: reason }, () => {});
      } else {
        await runSubtest(t, status, 't2v', 'Text-to-video 640x640', async () => {
          console.log(`Running test 2/${total}: Text-to-video 640x640`);
          const json = await runCli([
            '--json',
            '--video',
            '--workflow', 't2v',
            '--width', '640',
            '--height', '640',
            '--timeout', String(VIDEO_TIMEOUT_SEC),
            'soft clouds drifting across the sky'
          ], 'Text-to-video 640x640');

          assert.equal(json.success, true);
          assert.equal(json.type, 'video');
          assert.equal(json.workflow, 't2v');
          assert.equal(json.width, 640);
          assert.equal(json.height, 640);
          assert.ok(Array.isArray(json.urls) && json.urls.length > 0, 'video url missing');
          logGeneratedArtifacts('Text-to-video 640x640', json);
        });
      }

      const i2vBudget = await checkVideoBudget({
        workflow: 'i2v',
        label: 'Image-to-video 512x512',
        width: 512,
        height: 512,
        count: 1
      });
      if (!i2vBudget.ok) {
        const reason = i2vBudget.reason || 'Insufficient balance for video render';
        status.setSkip('i2v');
        await t.test('Image-to-video 512x512', { skip: reason }, () => {});
      } else {
        await runSubtest(t, status, 'i2v', 'Image-to-video 512x512', async () => {
          console.log(`Running test 3/${total}: Image-to-video 512x512`);
          const json = await runCli([
            '--json',
            '--video',
            '--workflow', 'i2v',
            '--ref', imagePath,
            '--width', '512',
            '--height', '512',
            '--timeout', String(VIDEO_TIMEOUT_SEC),
            'gentle camera pan'
          ], 'Image-to-video 512x512');

          assert.equal(json.success, true);
          assert.equal(json.type, 'video');
          assert.equal(json.workflow, 'i2v');
          assert.equal(json.width, 512);
          assert.equal(json.height, 512);
          assert.equal(json.refImage, imagePath);
          assert.ok(Array.isArray(json.urls) && json.urls.length > 0, 'video url missing');
          logGeneratedArtifacts('Image-to-video 512x512', json);
        });
      }

      const ltx23I2vAudioIdBudget = await checkVideoBudget({
        workflow: 'i2v',
        modelId: 'ltx23-22b-fp8_i2v_distilled',
        label: 'LTX 2.3 first-frame + Audio ID',
        width: 640,
        height: 640,
        fps: 24,
        duration: 5,
        count: 1
      });
      if (!ltx23I2vAudioIdBudget.ok) {
        const reason = ltx23I2vAudioIdBudget.reason || 'Insufficient balance for LTX 2.3 video render';
        status.setSkip('ltx23-i2v-audio-id');
        await t.test('LTX 2.3 first-frame + Audio ID', { skip: reason }, () => {});
      } else {
        await runSubtest(t, status, 'ltx23-i2v-audio-id', 'LTX 2.3 first-frame + Audio ID', async () => {
          console.log(`Running test 4/${total}: LTX 2.3 first-frame + Audio ID`);
          const json = await runCli([
            '--json',
            '--video',
            '--workflow', 'i2v',
            '-m', 'ltx23-22b-fp8_i2v_distilled',
            '--ref', imagePath,
            '--reference-audio-identity', voicePath,
            '--first-frame-strength', '0.82',
            '--width', '640',
            '--height', '640',
            '--fps', '24',
            '--duration', '5',
            '--timeout', String(VIDEO_TIMEOUT_SEC),
            'A presenter holds the mug, looks at the camera, and says "This is a live voice identity test."'
          ], 'LTX 2.3 first-frame + Audio ID');

          assert.equal(json.success, true);
          assert.equal(json.type, 'video');
          assert.equal(json.workflow, 'i2v');
          assert.equal(json.model, 'ltx23-22b-fp8_i2v_distilled');
          assert.equal(json.width, 640);
          assert.equal(json.height, 640);
          assert.equal(json.refImage, imagePath);
          assert.equal(json.referenceAudioIdentity, voicePath);
          assert.ok(Array.isArray(json.urls) && json.urls.length > 0, 'video url missing');
          logGeneratedArtifacts('LTX 2.3 first-frame + Audio ID', json);
        });
      }
    } finally {
      status.reset();
    }
  });
}
