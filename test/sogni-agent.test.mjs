import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CROSS_SURFACE_PARITY_FIXTURES,
  CROSS_SURFACE_PARITY_SURFACES,
  SEEDANCE_STORYBOARD_REFERENCE_PROMPT,
} from '../generated/creative-agent-runtime.mjs';

const MIN_NODE_VERSION = [22, 11, 0];

function isVersionAtLeast(current, required) {
  for (let i = 0; i < required.length; i++) {
    const currentValue = current[i] ?? 0;
    const requiredValue = required[i] ?? 0;
    if (currentValue > requiredValue) return true;
    if (currentValue < requiredValue) return false;
  }
  return true;
}

const currentNodeVersion = process.versions.node.split('.').map((part) => Number(part));
if (!isVersionAtLeast(currentNodeVersion, MIN_NODE_VERSION)) {
  throw new Error(`Node >= ${MIN_NODE_VERSION.join('.')} is required. Current: ${process.versions.node}`);
}
const PACKAGE_VERSION = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;
const SCREENSHOT_FIXTURE = join(process.cwd(), 'docs', 'screenshot.jpg');

function prepareCliRun(envOverrides = {}) {
  const tempHome = mkdtempSync(join(tmpdir(), 'sogni-agent-test-'));
  const statePath = join(tempHome, 'state.json');
  const loaderPath = join(process.cwd(), 'test', 'loader.mjs');
  const cliPath = join(process.cwd(), 'sogni-agent.mjs');
  const env = {
    ...process.env,
    HOME: tempHome,
    USERPROFILE: tempHome,
    OPENCLAW_CONFIG_PATH: join(tempHome, 'openclaw.json'),
    OPENCLAW_PLUGIN_CONFIG: '',
    SOGNI_API_KEY: 'test-api-key',
    SOGNI_AGENT_TEST_STATE_PATH: statePath,
    NODE_NO_WARNINGS: '1'
  };

  Object.assign(env, envOverrides);
  return { env, statePath, loaderPath, cliPath };
}

function readTestState(statePath) {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function runCli(args, envOverrides = {}) {
  const { env, statePath, loaderPath, cliPath } = prepareCliRun(envOverrides);

  const result = spawnSync(
    process.execPath,
    ['--loader', loaderPath, cliPath, ...args],
    { env, encoding: 'utf8' }
  );

  if (result.error) {
    throw result.error;
  }

  return {
    exitCode: result.status,
    state: readTestState(statePath),
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function runCliAsync(args, envOverrides = {}) {
  const { env, statePath, loaderPath, cliPath } = prepareCliRun(envOverrides);

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--loader', loaderPath, cliPath, ...args],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code, state: readTestState(statePath), stdout, stderr });
    });
  });
}

async function withTestApiServer(fn) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsedBody = null;
      if (body) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          parsedBody = body;
        }
      }
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody
      });

      res.setHeader('Content-Type', 'application/json');
      const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (
        (requestUrl.pathname === '/v2/media/uploadUrl' || requestUrl.pathname === '/v2/image/uploadUrl')
        && req.method === 'GET'
      ) {
        const type = requestUrl.searchParams.get('type') || 'reference';
        const jobId = requestUrl.searchParams.get('jobId') || 'job';
        const contentType = requestUrl.searchParams.get('contentType') || 'application/octet-stream';
        res.end(JSON.stringify({
          status: 'success',
          data: {
            url: `http://${req.headers.host}/test-v2-upload/${encodeURIComponent(type)}/${encodeURIComponent(jobId)}?signature=test`,
            fields: {
              key: `test/${type}/${jobId}`,
              'Content-Type': contentType,
              policy: 'test-policy',
            },
          },
        }));
        return;
      }
      if (requestUrl.pathname.startsWith('/test-v2-upload/') && req.method === 'POST') {
        res.end(JSON.stringify({ status: 'success' }));
        return;
      }
      if (
        (requestUrl.pathname === '/v2/media/downloadUrl' || requestUrl.pathname === '/v2/image/downloadUrl')
        && req.method === 'GET'
      ) {
        const type = requestUrl.searchParams.get('type') || 'reference';
        const jobId = requestUrl.searchParams.get('jobId') || 'job';
        res.end(JSON.stringify({
          status: 'success',
          data: {
            downloadUrl: `https://cdn.sogni.ai/test-v2-upload/${encodeURIComponent(type)}/${encodeURIComponent(jobId)}`,
          },
        }));
        return;
      }
      if (
        (requestUrl.pathname === '/v1/media/uploadUrl' || requestUrl.pathname === '/v1/image/uploadUrl')
        && req.method === 'GET'
      ) {
        const type = requestUrl.searchParams.get('type') || 'reference';
        const jobId = requestUrl.searchParams.get('jobId') || 'job';
        res.end(JSON.stringify({
          status: 'success',
          data: {
            uploadUrl: `http://${req.headers.host}/test-upload/${encodeURIComponent(type)}/${encodeURIComponent(jobId)}?signature=test`,
          },
        }));
        return;
      }
      if (requestUrl.pathname.startsWith('/test-upload/') && req.method === 'PUT') {
        res.end(JSON.stringify({ status: 'success' }));
        return;
      }
      if (
        (requestUrl.pathname === '/v1/media/downloadUrl' || requestUrl.pathname === '/v1/image/downloadUrl')
        && req.method === 'GET'
      ) {
        const type = requestUrl.searchParams.get('type') || 'reference';
        const jobId = requestUrl.searchParams.get('jobId') || 'job';
        res.end(JSON.stringify({
          status: 'success',
          data: {
            downloadUrl: `https://cdn.sogni.ai/test-upload/${encodeURIComponent(type)}/${encodeURIComponent(jobId)}`,
          },
        }));
        return;
      }
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        const content = parsedBody?.sogni_tool_execution === false
          ? [
            'Project Title: Neon Bakery Launch',
            'Total Duration: 12 seconds',
            '',
            'SCENE 01 - Hook',
            'TIME: 0s-2s',
            'PURPOSE: Establish the bakery reveal.',
            'VISUAL: A baker opens a glowing oven on a rainy neon street.',
            'ACTION: Steam rolls toward camera.',
            'CAMERA: Slow dolly in.',
            'LIGHTING/STYLE: Neon rain glow and warm oven light.',
            'TRANSITION: Steam wipe into the reveal.',
            'DIALOGUE/VO: [no dialogue]',
            'AUDIO/SFX: Oven thrum, rain.',
            'MUSIC: Soft rising synth pulse.',
            'VISIBLE TEXT: none',
            '',
            'SCENE 02 - Reveal',
            'TIME: 2s-5s',
            'PURPOSE: Show the product magic.',
            'VISUAL: Pastries turn into tiny floating signs for the product.',
            'ACTION: Signs orbit the baker.',
            'CAMERA: Smooth arc.',
            'LIGHTING/STYLE: Bright pastry glow against wet street reflections.',
            'TRANSITION: Orbiting sign becomes CTA underline.',
            'DIALOGUE/VO: [no dialogue]',
            'AUDIO/SFX: Sparkle whooshes.',
            'MUSIC: Synth pulse peaks.',
            'VISIBLE TEXT: none',
            '',
            'SCENE 03 - CTA',
            'TIME: 5s-12s',
            'PURPOSE: Resolve with a readable end card.',
            'VISUAL: Clean logo end card.',
            'ACTION: Light settles.',
            'CAMERA: Locked hero frame.',
            'LIGHTING/STYLE: Crisp high-key brand card.',
            'TRANSITION: Hold to end.',
            'DIALOGUE/VO: [no dialogue]',
            'AUDIO/SFX: Final chime.',
            'MUSIC: Soft resolve.',
            'VISIBLE TEXT: Start baking.'
          ].join('\n')
          : 'Test API chat response';
        res.end(JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop'
          }],
          creative_workflows: []
        }));
        return;
      }
      if (req.url === '/v1/models' && req.method === 'GET') {
        res.end(JSON.stringify({
          object: 'list',
          data: [
            { id: 'qwen3.6-35b-a3b-gguf-iq4xs', object: 'model', owned_by: 'sogni' },
            { id: 'qwen3.6-35b-a3b-gguf-q4km', object: 'model', owned_by: 'sogni' }
          ]
        }));
        return;
      }
      if (req.url === '/v1/models/qwen3.6-35b-a3b-gguf-iq4xs' && req.method === 'GET') {
        res.end(JSON.stringify({
          id: 'qwen3.6-35b-a3b-gguf-iq4xs',
          object: 'model',
          owned_by: 'sogni'
        }));
        return;
      }
      if (req.url === '/v1/replay/records?limit=7' && req.method === 'GET') {
        res.end(JSON.stringify({
          records: [{
            runId: 'run_test',
            schemaVersion: 1,
            userRequest: 'generate a poster',
            finalResponse: 'done',
            modelId: 'qwen3.6-35b-a3b-gguf-iq4xs',
            rounds: 2
          }]
        }));
        return;
      }
      if (req.url === '/v1/replay/records/run_test' && req.method === 'GET') {
        res.end(JSON.stringify({
          record: {
            schemaVersion: 1,
            run_id: 'run_test',
            user_request: 'generate a poster',
            rounds: []
          },
          createTime: '2026-05-13T00:00:00.000Z'
        }));
        return;
      }
      if (req.url === '/v1/replay/records' && req.method === 'POST') {
        res.statusCode = 201;
        res.end(JSON.stringify({
          runId: parsedBody?.run_id || 'run_ingested',
          schemaVersion: parsedBody?.schemaVersion || 1,
          redacted: true,
          createTime: '2026-05-13T00:00:00.000Z',
          updateTime: '2026-05-13T00:00:00.000Z'
        }));
        return;
      }
      if (req.url === '/v1/creative-agent/workflows' && req.method === 'POST') {
        res.statusCode = 201;
        res.end(JSON.stringify({
          status: 'success',
          data: {
            workflow: { workflowId: 'wf_test', status: 'queued', artifacts: [] }
          }
        }));
        return;
      }
      if (req.url === '/v1/creative-agent/workflows/wf_test/events/stream' && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.end('id: evt_1\nevent: workflow.status\ndata: {"status":"completed"}\n\n');
        return;
      }
      if (req.url === '/v1/creative-agent/workflows/wf_test/resume' && req.method === 'POST') {
        res.statusCode = 202;
        res.end(JSON.stringify({
          status: 'success',
          data: {
            resumed: true,
            workflow: { workflowId: 'wf_test', status: 'running', artifacts: [] }
          }
        }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'error', message: 'Not found' }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await fn(baseUrl, requests);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function expectCliError(args, messageIncludes) {
  const { exitCode, stderr } = runCli(args);
  assert.equal(exitCode, 1);
  if (messageIncludes) {
    assert.ok(
      stderr.includes(messageIncludes),
      `Expected stderr to include "${messageIncludes}", got: ${stderr}`
    );
  }
}

test('default image generation uses 512x512 and prompt', () => {
  const { exitCode, state } = runCli(['a cat wearing a hat']);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject, 'createImageProject was called');
  assert.equal(state.lastImageProject.width, 512);
  assert.equal(state.lastImageProject.height, 512);
  assert.equal(state.lastImageProject.positivePrompt, 'a cat wearing a hat');
  assert.equal(state.lastImageProject.tokenType, 'spark');
  assert.equal(state.lastImageProject.sizePreset, 'custom');
});

test('reuses one pooled app ID across separate CLI sessions', () => {
  const sharedHome = mkdtempSync(join(tmpdir(), 'sogni-agent-shared-home-'));
  const sharedEnv = { HOME: sharedHome, USERPROFILE: sharedHome };

  const first = runCli(['first image'], sharedEnv);
  const second = runCli(['second image'], sharedEnv);

  assert.equal(first.exitCode, 0);
  assert.equal(second.exitCode, 0);
  const firstAppId = first.state?.clientConfigs?.[0]?.appId;
  const secondAppId = second.state?.clientConfigs?.[0]?.appId;
  assert.ok(firstAppId, 'first session passed an app ID to the SDK');
  assert.match(firstAppId, /^sogni-agent-[0-9a-f-]{36}$/);
  assert.equal(secondAppId, firstAppId, 'sequential sessions reuse the released slot-0 identity');
  assert.equal(
    readFileSync(join(sharedHome, '.config', 'sogni', 'app-ids', 'slot-0'), 'utf8').trim(),
    firstAppId,
  );
  // The exited session must not leave a lease behind, or the next process
  // would burn a fresh slot (and eventually a fresh daily app ID).
  assert.throws(
    () => readFileSync(join(sharedHome, '.config', 'sogni', 'app-ids', 'slot-0.lease'), 'utf8'),
    { code: 'ENOENT' },
  );
});

test('SOGNI_APP_ID supplies a stable deployment identity without a home file', () => {
  const { exitCode, state } = runCli(
    ['a cat'],
    { SOGNI_APP_ID: 'fixed-container-install-id' },
  );
  assert.equal(exitCode, 0);
  assert.equal(state?.clientConfigs?.[0]?.appId, 'fixed-container-install-id');
});

test('app-id limit error explains persistence and the one-time UTC reset', () => {
  const { exitCode, stdout } = runCli(
    ['--json', 'a cat'],
    { SOGNI_AGENT_TEST_CONNECT_APP_ID_LIMIT: '1' },
  );
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, '4061');
  assert.match(payload.hint, /persists and reuses one installation app ID/i);
  assert.match(payload.hint, /00:00 UTC/);
});

test('unknown CLI flag returns a validation error', () => {
  const { exitCode, stderr } = runCli(['--not-a-real-flag', 'a cat wearing a hat']);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('Unknown option: --not-a-real-flag'));
});

test('invalid width returns a validation error', () => {
  const { exitCode, stderr } = runCli(['--width', 'foo', 'a cat wearing a hat']);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('--width must be an integer.'));
});

test('invalid seed returns a validation error', () => {
  const { exitCode, stderr } = runCli(['--seed', 'foo', 'a cat wearing a hat']);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('--seed must be an integer.'));
});

test('rejected API key (REST 401) exits cleanly with a dashboard hint', () => {
  const { exitCode, stdout, stderr } = runCli(
    ['a cat wearing a hat'],
    { SOGNI_AGENT_TEST_CONNECT_REST_401: '1' }
  );
  assert.equal(exitCode, 1);
  const combined = `${stdout}\n${stderr}`;
  assert.ok(/invalid .*api key/i.test(combined), `Expected an invalid-API-key message, got: ${combined}`);
  assert.ok(combined.includes('dashboard.sogni.ai'), `Expected a dashboard.sogni.ai hint, got: ${combined}`);
  // No raw Node crash / stack trace should leak to the user.
  assert.ok(!combined.includes("Unhandled 'error' event"), `Raw crash leaked: ${combined}`);
  assert.ok(!combined.includes('node:events'), `Raw stack leaked: ${combined}`);
});

test('detached auth-failure cascade during connect is caught, not crashed', () => {
  const { exitCode, stdout, stderr } = runCli(
    ['a cat wearing a hat'],
    { SOGNI_AGENT_TEST_CONNECT_WS_CRASH: '1' }
  );
  assert.equal(exitCode, 1);
  const combined = `${stdout}\n${stderr}`;
  assert.ok(/invalid .*api key/i.test(combined), `Expected an invalid-API-key message, got: ${combined}`);
  assert.ok(combined.includes('dashboard.sogni.ai'), `Expected a dashboard.sogni.ai hint, got: ${combined}`);
  assert.ok(!combined.includes("Unhandled 'error' event"), `Raw crash leaked: ${combined}`);
  assert.ok(!combined.includes('WebSocket was closed'), `Internal SDK error leaked: ${combined}`);
});

test('rejected API key in --json mode emits structured error with hint', () => {
  const { exitCode, stdout } = runCli(
    ['--json', 'a cat wearing a hat'],
    { SOGNI_AGENT_TEST_CONNECT_REST_401: '1' }
  );
  assert.equal(exitCode, 1);
  const lastJsonLine = stdout.trim().split('\n').filter(Boolean).pop();
  const payload = JSON.parse(lastJsonLine);
  assert.equal(payload.success, false);
  assert.ok(/invalid .*api key/i.test(payload.error), `Expected invalid-key error, got: ${payload.error}`);
  assert.ok(payload.hint && payload.hint.includes('dashboard.sogni.ai'), `Expected dashboard hint, got: ${payload.hint}`);
});

// --- Credentials file parsing (idiotproofing) ---

// Write a credentials file and return env overrides that make the CLI read it
// (env SOGNI_API_KEY cleared so the file is the only source).
function withCredentialsFile(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-creds-'));
  const credPath = join(dir, 'credentials');
  writeFileSync(credPath, contents);
  return { SOGNI_API_KEY: '', SOGNI_CREDENTIALS_PATH: credPath };
}

test('credentials file: quoted value is accepted (quotes stripped)', () => {
  const { exitCode, state } = runCli(['a cat'], withCredentialsFile('SOGNI_API_KEY="quoted-key-123"\n'));
  assert.equal(exitCode, 0);
  assert.equal(state?.clientConfigs?.[0]?.apiKey, 'quoted-key-123');
});

test('credentials file: UTF-8 BOM is tolerated', () => {
  const { exitCode, state } = runCli(['a cat'], withCredentialsFile('﻿SOGNI_API_KEY=bom-key-123\n'));
  assert.equal(exitCode, 0);
  assert.equal(state?.clientConfigs?.[0]?.apiKey, 'bom-key-123');
});

test('credentials file: value containing "=" is preserved (split on first = only)', () => {
  const { exitCode, state } = runCli(['a cat'], withCredentialsFile('SOGNI_API_KEY=ab=cd==ef\n'));
  assert.equal(exitCode, 0);
  assert.equal(state?.clientConfigs?.[0]?.apiKey, 'ab=cd==ef');
});

test('credentials file: export prefix, comments, and blank lines are handled', () => {
  const contents = '# my sogni key\n\nexport SOGNI_API_KEY=export-key-123\n';
  const { exitCode, state } = runCli(['a cat'], withCredentialsFile(contents));
  assert.equal(exitCode, 0);
  assert.equal(state?.clientConfigs?.[0]?.apiKey, 'export-key-123');
});

test('credentials file present but with no usable key gives a distinct hint', () => {
  const { exitCode, stderr } = runCli(['a cat'], withCredentialsFile('# no key here\nFOO=bar\n'));
  assert.equal(exitCode, 1);
  assert.ok(/no usable/i.test(stderr), `Expected a 'no usable key' hint, got: ${stderr}`);
  assert.ok(stderr.includes('dashboard.sogni.ai'), `Expected dashboard hint, got: ${stderr}`);
});

// --- Input validation (idiotproofing) ---

test('whitespace-only prompt is rejected like an empty prompt', () => {
  const { exitCode, stderr } = runCli(['   ']);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('No prompt provided'), `Expected 'No prompt provided', got: ${stderr}`);
});

test('absurdly large --width is rejected before any network call', () => {
  const { exitCode, stderr } = runCli(['--width', '100000', 'a cat']);
  assert.equal(exitCode, 1);
  assert.ok(/must be <= 8192/.test(stderr), `Expected a max-dimension error, got: ${stderr}`);
});

test('missing required value for --width returns a validation error', () => {
  expectCliError(['--width'], '--width requires a value.');
});

test('out-of-range seed returns a validation error', () => {
  expectCliError(['--seed', '4294967296', 'a cat'], '--seed must be between 0 and 4294967295.');
});

test('invalid token type returns a validation error', () => {
  expectCliError(['--token-type', 'gold', 'a cat'], '--token-type must be "spark", "sogni", or "auto".');
});

test('GPT Image 2 forces Spark token type even when SOGNI is requested', () => {
  const { exitCode, state } = runCli([
    '--token-type', 'sogni',
    '-m', 'gpt-image-2',
    'a cat wearing a hat'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject, 'createImageProject was called');
  assert.equal(state.lastImageProject.modelId, 'gpt-image-2');
  assert.equal(state.lastImageProject.tokenType, 'spark');
});

test('auto token fallback does not treat freeform insufficient text as balance authority', () => {
  const { exitCode, state, stderr } = runCli([
    '--json',
    '--video',
    '--token-type', 'auto',
    'a prompt with insufficient detail'
  ], {
    SOGNI_AGENT_TEST_VIDEO_PROJECT_ERROR: 'The prompt has insufficient detail for this render.'
  });

  assert.equal(exitCode, 1);
  assert.equal(state.clientConfigs.length, 1);
  assert.doesNotMatch(stderr, /retrying with SOGNI tokens/);
});

test('insufficient token balance offers Spark packs purchase link in json output', () => {
  const { exitCode, state, stdout, stderr } = runCli([
    '--json',
    '--video',
    '--token-type', 'auto',
    'a cinematic skyline at dusk'
  ], {
    SOGNI_AGENT_TEST_BALANCE_JSON: JSON.stringify({
      spark: 0,
      sogni: 0,
      lastUpdated: new Date().toISOString()
    })
  });

  assert.equal(exitCode, 1);
  assert.equal(state.clientConfigs.length, 2);
  assert.equal(state.clientConfigs[1].appId, state.clientConfigs[0].appId);
  assert.match(stderr, /retrying with SOGNI tokens/);

  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'INSUFFICIENT_BALANCE');
  assert.equal(payload.errorType, 'COST_LIMIT_EXCEEDED');
  assert.equal(payload.errorCategory, 'insufficient_credits');
  assert.equal(payload.purchaseAction, true);
  assert.equal(payload.purchaseLabel, 'Buy Spark Packs');
  assert.equal(payload.purchaseUrl, 'https://docs.sogni.ai/pricing/#spark-packs');
  assert.match(payload.hint, /https:\/\/docs\.sogni\.ai\/pricing\/#spark-packs/);
  assert.doesNotMatch(payload.hint, /free daily/i);
});

test('SDK-returned insufficient funds preserves code and surfaces Spark Packs CTA in json output', () => {
  // Simulates the realistic vendor path: the SDK returns an error-shaped
  // project result (e.g. `{ error: "Debit Error: Insufficient funds",
  // code: "INSUFFICIENT_BALANCE" }`) instead of throwing. Prior to the
  // `buildProjectResultError` helper, the throw sites stripped `code`
  // and the classifier never reached the `insufficient_credits` branch,
  // so the new `purchaseAction`/`purchaseLabel`/`purchaseUrl` payload
  // fields silently no-opped on this very common path.
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    'a cinematic skyline at dusk'
  ], {
    SOGNI_AGENT_TEST_VIDEO_PROJECT_RESULT_JSON: JSON.stringify({
      error: 'Debit Error: Insufficient funds',
      code: 'INSUFFICIENT_BALANCE'
    })
  });

  assert.equal(exitCode, 1);

  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'INSUFFICIENT_BALANCE');
  assert.equal(payload.errorCategory, 'insufficient_credits');
  assert.equal(payload.purchaseAction, true);
  assert.equal(payload.purchaseLabel, 'Buy Spark Packs');
  assert.equal(payload.purchaseUrl, 'https://docs.sogni.ai/pricing/#spark-packs');
  assert.match(payload.hint, /https:\/\/docs\.sogni\.ai\/pricing\/#spark-packs/);
  assert.doesNotMatch(payload.hint, /free daily/i);
});

test('subscription grace billing error (4080) surfaces subscription_billing guidance, not Buy Spark Packs', () => {
  // Renewal-retry grace: Unlimited access is paused. This is NOT a "buy credits"
  // situation — no purchase CTA, no generic Buy Spark Packs copy, and the agent
  // must not auto-retry the covered job (retryable false).
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    'a cinematic skyline at dusk'
  ], {
    SOGNI_AGENT_TEST_VIDEO_PROJECT_RESULT_JSON: JSON.stringify({
      error: 'Unlimited plan renewal payment is being retried — unlimited access resumes once renewal succeeds. You can keep rendering with Spark or SOGNI in the meantime.',
      code: '4080'
    })
  });

  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, '4080');
  assert.equal(payload.errorCategory, 'subscription_billing');
  assert.equal(payload.retryable, false);
  assert.notEqual(payload.purchaseAction, true);
  assert.match(payload.hint, /Spark or SOGNI/i);
  assert.doesNotMatch(payload.hint, /Buy Spark Packs/i);
});

test('subscription not-covered billing error (4078) offers Premium Spark, not generic credits', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    'a goat'
  ], {
    SOGNI_AGENT_TEST_IMAGE_PROJECT_RESULT_JSON: JSON.stringify({
      error: 'Unlimited billing is not available for this generation. Use Premium Spark or reconnect and try again.',
      code: '4078'
    })
  });

  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, '4078');
  assert.equal(payload.errorCategory, 'subscription_billing');
  assert.equal(payload.purchaseAction, true);
  assert.equal(payload.purchaseLabel, 'Get Premium Spark');
  assert.match(payload.hint, /Premium Spark/i);
});

test('SDK-returned insufficient funds prints Spark Packs hint in human output', () => {
  const { exitCode, stderr } = runCli([
    '--video',
    'a cinematic skyline at dusk'
  ], {
    SOGNI_AGENT_TEST_VIDEO_PROJECT_RESULT_JSON: JSON.stringify({
      error: 'Debit Error: Insufficient funds',
      code: 'INSUFFICIENT_BALANCE'
    })
  });

  assert.equal(exitCode, 1);
  assert.match(stderr, /Error: Debit Error: Insufficient funds/);
  assert.match(stderr, /Hint: Buy Spark Packs to continue: https:\/\/docs\.sogni\.ai\/pricing\/#spark-packs/);
  assert.doesNotMatch(stderr, /free daily/i);
});

test('SDK-returned insufficient funds from context image edit surfaces Spark Packs CTA', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    '-c', SCREENSHOT_FIXTURE,
    'turn this into anime style; keep everything the same'
  ], {
    SOGNI_AGENT_TEST_IMAGE_EDIT_PROJECT_RESULT_JSON: JSON.stringify({
      error: 'Debit Error: Insufficient funds',
      code: 'INSUFFICIENT_BALANCE'
    })
  });

  assert.equal(exitCode, 1);

  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'INSUFFICIENT_BALANCE');
  assert.equal(payload.errorCategory, 'insufficient_credits');
  assert.equal(payload.purchaseAction, true);
  assert.equal(payload.purchaseLabel, 'Buy Spark Packs');
  assert.equal(payload.purchaseUrl, 'https://docs.sogni.ai/pricing/#spark-packs');
  assert.match(payload.hint, /https:\/\/docs\.sogni\.ai\/pricing\/#spark-packs/);
});

test('Krea identity edit accepts two context images with worker-owned defaults', () => {
  const { exitCode, state } = runCli([
    '-c', SCREENSHOT_FIXTURE,
    '-c', SCREENSHOT_FIXTURE,
    '-m', 'krea2_identity_edit_v1_2',
    'editorial portrait, same identity, new wardrobe'
  ]);

  assert.equal(exitCode, 0);
  assert.ok(state?.lastEditProject, 'createImageEditProject was called');
  assert.equal(state.lastEditProject.modelId, 'krea2_identity_edit_v1_2');
  assert.equal(state.lastEditProject.contextImages.length, 2);
  assert.equal(state.lastEditProject.steps, undefined);
  assert.equal(state.lastEditProject.guidance, undefined);
  assert.equal(state.lastEditProject.sampler, undefined);
  assert.equal(state.lastEditProject.scheduler, undefined);
});

test('Krea identity edit preserves explicitly supplied execution controls', () => {
  const { exitCode, state } = runCli([
    '-c', SCREENSHOT_FIXTURE,
    '-m', 'krea2_identity_edit_v1_2',
    '--steps', '12',
    '--guidance', '1',
    '--sampler', 'dpmpp_2m',
    '--scheduler', 'beta',
    'put a retro red coat on the subject',
  ], {
    SOGNI_AGENT_TEST_MODEL_TIERS_JSON: JSON.stringify({
      krea2_identity_edit_v1_2: {
        steps: { min: 8, max: 12, default: 10 },
        guidance: { min: 1, max: 1, default: 1 },
        comfySampler: { default: 'euler' },
        comfyScheduler: { default: 'simple' },
      },
    }),
  });

  assert.equal(exitCode, 0);
  assert.ok(state?.lastEditProject, 'createImageEditProject was called');
  assert.equal(state.lastEditProject.steps, 12);
  assert.equal(state.lastEditProject.guidance, 1);
  assert.equal(state.lastEditProject.sampler, 'dpmpp_2m');
  assert.equal(state.lastEditProject.scheduler, 'beta');
});

test('multi-angle edits preserve their configured sampler and scheduler defaults', () => {
  const { exitCode, state } = runCli([
    '--multi-angle',
    '-c', SCREENSHOT_FIXTURE,
    '--azimuth', 'front-right',
    'studio portrait',
  ]);

  assert.equal(exitCode, 0);
  assert.ok(state?.lastEditProject, 'createImageEditProject was called');
  assert.equal(state.lastEditProject.sampler, 'euler');
  assert.equal(state.lastEditProject.scheduler, 'simple');
});

test('Dark Beast Krea 2 text generation uses live catalog defaults', () => {
  const { exitCode, state } = runCli([
    '-m', 'dark_beast_krea2_fp8',
    'editorial portrait in a chain-link courtyard'
  ], {
    SOGNI_AGENT_TEST_MODEL_TIERS_JSON: JSON.stringify({
      status: 'success',
      data: {
        model: {
          id: 'dark_beast_krea2_fp8',
          tierId: 'current_dark_beast_tier',
          parameters: {
          steps: { min: 8, max: 20, default: 16 },
          guidance: { min: 1, max: 1, default: 1 },
          comfySampler: { default: 'euler' },
          comfyScheduler: { default: 'simple' }
          }
        }
      }
    })
  });

  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject, 'createImageProject was called');
  assert.equal(state.lastImageProject.steps, 16);
  assert.equal(state.lastImageProject.guidance, 1);
});

test('Krea 2 preserves ordered LoRA stacks with bipolar strengths', () => {
  const { exitCode, state } = runCli([
    '-m', 'krea2_turbo_fp8_scaled',
    '--lora', 'krea2-detail-enhancer',
    '--lora-strength', '3',
    '--lora', 'krea2-amateur',
    '--lora-strength', '-2',
    'a candid editorial portrait',
  ]);
  assert.equal(exitCode, 0);
  assert.deepEqual(state.lastImageProject.loras, ['krea2-detail-enhancer', 'krea2-amateur']);
  assert.deepEqual(state.lastImageProject.loraStrengths, [3, -2]);
});

test('Dark Beast Krea 2 rejects settings outside the live catalog contract', () => {
  const { exitCode, stderr } = runCli([
    '-m', 'dark_beast_krea2_fp8',
    '--steps', '28',
    '--guidance', '2.5',
    'editorial portrait in a chain-link courtyard'
  ], {
    SOGNI_AGENT_TEST_MODEL_TIERS_JSON: JSON.stringify({
      dark_beast_krea2_fp8: {
        steps: { min: 8, max: 20, default: 16 },
        guidance: { min: 1, max: 1, default: 1 }
      }
    })
  });

  assert.equal(exitCode, 1);
  assert.match(stderr, /--steps 28 is outside the live catalog range/);
});

test('Dark Beast Krea 2 rejects OpenClaw defaults outside the live catalog contract', () => {
  const { exitCode, stderr } = runCli([
    '-m', 'dark_beast_krea2_fp8',
    'configured defaults must remain valid'
  ], {
    OPENCLAW_PLUGIN_CONFIG: JSON.stringify({
      modelDefaults: {
        dark_beast_krea2_fp8: { steps: 20, guidance: 7.5 }
      }
    }),
    SOGNI_AGENT_TEST_MODEL_TIERS_JSON: JSON.stringify({
      dark_beast_krea2_fp8: {
        steps: { min: 8, max: 20, default: 16 },
        guidance: { min: 1, max: 1, default: 1 }
      }
    })
  });

  assert.equal(exitCode, 1);
  assert.match(stderr, /Configured guidance 7.5 is outside the live catalog range/);
});

test('model catalog cache avoids a second API request within its TTL', () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'sogni-model-cache-test-'));
  const cachePath = join(cacheDir, 'catalog.json');
  const fixture = JSON.stringify({
    models: [{ id: 'dark_beast_krea2_fp8', tier: 'dark_beast_tier' }],
    tiers: {
      dark_beast_tier: {
        steps: { min: 8, max: 20, default: 16 },
        guidance: { min: 1, max: 1, default: 1 }
      }
    }
  });
  const first = runCli([
    '-m', 'dark_beast_krea2_fp8',
    'first render'
  ], {
    SOGNI_MODEL_CATALOG_CACHE_PATH: cachePath,
    SOGNI_AGENT_TEST_MODEL_TIERS_JSON: fixture
  });
  assert.equal(first.exitCode, 0);

  const second = runCli([
    '-m', 'dark_beast_krea2_fp8',
    'second render'
  ], {
    SOGNI_MODEL_CATALOG_CACHE_PATH: cachePath,
    SOGNI_AGENT_TEST_MODEL_TIERS_JSON: '{not valid JSON'
  });
  assert.equal(second.exitCode, 0);
  assert.equal(second.state.lastImageProject.steps, 16);
  assert.equal(second.state.lastImageProject.guidance, 1);
});

test('expired model catalog cache revalidates with ETag and accepts a 304', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'sogni-model-cache-etag-'));
  const cachePath = join(cacheDir, 'catalog.json');
  const requestHeaders = [];
  const server = createServer((req, res) => {
    requestHeaders.push(req.headers);
    if (req.headers['if-none-match'] === '"catalog-v1"') {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.setHeader('etag', '"catalog-v1"');
    res.end(JSON.stringify({
      status: 'success',
      data: {
        model: {
          id: 'dark_beast_krea2_fp8',
          parameters: {
            steps: { min: 8, max: 20, default: 16 },
            guidance: { min: 1, max: 1, default: 1 }
          }
        }
      }
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const env = {
    SOGNI_MODEL_CATALOG_URL: `http://127.0.0.1:${address.port}/v1/model-catalog`,
    SOGNI_MODEL_CATALOG_CACHE_PATH: cachePath
  };

  try {
    const first = await runCliAsync([
      '-m', 'dark_beast_krea2_fp8',
      'first conditional request'
    ], env);
    assert.equal(first.exitCode, 0);

    const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    cached.fetchedAt = Date.now() - (6 * 60 * 1000);
    writeFileSync(cachePath, JSON.stringify(cached));

    const second = await runCliAsync([
      '-m', 'dark_beast_krea2_fp8',
      'conditional revalidation'
    ], env);
    assert.equal(second.exitCode, 0);
    assert.equal(second.state.lastImageProject.steps, 16);
    assert.equal(requestHeaders.length, 2);
    assert.equal(requestHeaders[1]['if-none-match'], '"catalog-v1"');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test('expired model catalog cache is not used when refresh fails', () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'sogni-model-cache-expired-'));
  const cachePath = join(cacheDir, 'catalog.json');
  writeFileSync(cachePath, JSON.stringify({
    fetchedAt: Date.now() - (6 * 60 * 1000),
    models: [{ id: 'dark_beast_krea2_fp8', tier: 'dark_beast_tier' }],
    tiers: {
      dark_beast_tier: {
        steps: { min: 8, max: 20, default: 16 },
        guidance: { min: 1, max: 1, default: 1 }
      }
    }
  }));

  const { exitCode, stderr } = runCli([
    '-m', 'dark_beast_krea2_fp8',
    'expired cache must refresh'
  ], {
    SOGNI_MODEL_CATALOG_CACHE_PATH: cachePath,
    SOGNI_AGENT_TEST_MODEL_TIERS_JSON: '{not valid JSON'
  });

  assert.equal(exitCode, 1);
  assert.match(stderr, /Could not load the live Sogni model catalog/);
});

test('an unwritable model catalog cache target does not block generation', () => {
  const cacheTargetDirectory = mkdtempSync(join(tmpdir(), 'sogni-model-cache-directory-'));
  const { exitCode, state, stderr } = runCli([
    '-m', 'dark_beast_krea2_fp8',
    'cache writes are optional'
  ], {
    SOGNI_MODEL_CATALOG_CACHE_PATH: cacheTargetDirectory,
    SOGNI_AGENT_TEST_MODEL_TIERS_JSON: JSON.stringify({
      dark_beast_krea2_fp8: {
        steps: { min: 8, max: 20, default: 16 },
        guidance: { min: 1, max: 1, default: 1 }
      }
    })
  });

  assert.equal(exitCode, 0);
  assert.equal(state.lastImageProject.steps, 16);
  assert.match(stderr, /Warning: could not persist model catalog cache/);
});

test('Krea identity edit rejects a third context image', () => {
  expectCliError([
    '-c', SCREENSHOT_FIXTURE,
    '-c', SCREENSHOT_FIXTURE,
    '-c', SCREENSHOT_FIXTURE,
    '-m', 'dark_beast_krea2_identity_edit_v1_2',
    'same identity, cinematic styling'
  ], 'supports max 2 context images');
});

test('SDK-returned insufficient funds from image generation surfaces Spark Packs CTA', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    'a cat wearing a hat'
  ], {
    SOGNI_AGENT_TEST_IMAGE_PROJECT_RESULT_JSON: JSON.stringify({
      error: 'Debit Error: Insufficient funds',
      code: 'INSUFFICIENT_BALANCE'
    })
  });

  assert.equal(exitCode, 1);

  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'INSUFFICIENT_BALANCE');
  assert.equal(payload.errorCategory, 'insufficient_credits');
  assert.equal(payload.purchaseAction, true);
  assert.equal(payload.purchaseLabel, 'Buy Spark Packs');
  assert.equal(payload.purchaseUrl, 'https://docs.sogni.ai/pricing/#spark-packs');
  assert.match(payload.hint, /https:\/\/docs\.sogni\.ai\/pricing\/#spark-packs/);
});

test('invalid seed strategy returns a validation error', () => {
  expectCliError(['--seed-strategy', 'foo', 'a cat'], '--seed-strategy must be "random" or "prompt-hash".');
});

test('invalid image output format returns a validation error', () => {
  expectCliError(['--output-format', 'webp', 'a cat'], 'Image output format must be "png" or "jpg".');
});

test('invalid video output format returns a validation error', () => {
  expectCliError(['--video', '--output-format', 'jpg', 'a cat'], 'Video output format must be "mp4".');
});

test('default music generation uses ACE-Step turbo defaults and prompt', () => {
  const { exitCode, state, stdout } = runCli([
    '--music',
    '--json',
    'uplifting cinematic synthwave theme'
  ]);

  assert.equal(exitCode, 0);
  assert.ok(state?.lastAudioProject, 'createAudioProject was called');
  assert.equal(state.lastAudioProject.modelId, 'ace_step_1.5_xl_turbo');
  assert.equal(state.lastAudioProject.positivePrompt, 'uplifting cinematic synthwave theme');
  assert.equal(state.lastAudioProject.duration, 30);
  assert.equal(state.lastAudioProject.steps, 8);
  assert.equal(state.lastAudioProject.shift, 3);
  assert.equal(state.lastAudioProject.sampler, 'euler');
  assert.equal(state.lastAudioProject.scheduler, 'simple');
  assert.equal(state.lastAudioProject.outputFormat, 'mp3');
  assert.equal(state.lastAudioProject.tokenType, 'spark');

  const output = JSON.parse(stdout.trim());
  assert.equal(output.type, 'music');
  assert.deepEqual(output.urls, ['https://example.com/audioUrl-1.mp3']);
});

test('advanced music options are forwarded to audio project generation', () => {
  const { exitCode, state } = runCli([
    '--music',
    '--music-model', 'sft',
    '--lyrics', 'Rise with the morning light',
    '--language', 'es',
    '--duration', '90',
    '--bpm', '128',
    '--keyscale', 'F# minor',
    '--timesig', '6/8',
    '--composer-mode',
    '--prompt-strength', '4',
    '--creativity', '1.2',
    '--audio-format', 'flac',
    '--sampler', 'er_sde',
    '--scheduler', 'linear_quadratic',
    '--steps', '60',
    '--guidance', '6',
    '--music-shift', '4',
    '-n', '2',
    '-s', '42',
    'bright indie pop chorus'
  ]);

  assert.equal(exitCode, 0);
  assert.ok(state?.lastAudioProject, 'createAudioProject was called');
  assert.equal(state.lastAudioProject.modelId, 'ace_step_1.5_xl_sft');
  assert.equal(state.lastAudioProject.numberOfMedia, 2);
  assert.equal(state.lastAudioProject.seed, 42);
  assert.equal(state.lastAudioProject.duration, 90);
  assert.equal(state.lastAudioProject.bpm, 128);
  assert.equal(state.lastAudioProject.keyscale, 'F# minor');
  assert.equal(state.lastAudioProject.timesignature, '6');
  assert.equal(state.lastAudioProject.lyrics, 'Rise with the morning light');
  assert.equal(state.lastAudioProject.language, 'es');
  assert.equal(state.lastAudioProject.composerMode, true);
  assert.equal(state.lastAudioProject.promptStrength, 4);
  assert.equal(state.lastAudioProject.creativity, 1.2);
  assert.equal(state.lastAudioProject.outputFormat, 'flac');
  assert.equal(state.lastAudioProject.sampler, 'er_sde');
  assert.equal(state.lastAudioProject.scheduler, 'linear_quadratic');
  assert.equal(state.lastAudioProject.steps, 60);
  assert.equal(state.lastAudioProject.guidance, 6);
  assert.equal(state.lastAudioProject.shift, 4);
});

test('invalid music output format returns a validation error', () => {
  expectCliError(['--music', '--output-format', 'jpg', 'a song'], 'Music output format must be "mp3", "flac", or "wav".');
});

test('music keeps --audio reserved for video reference input', () => {
  expectCliError(['--music', '--audio', 'song.mp3', 'a song'], 'Video-only options');
});

test('video-only options without --video return a validation error', () => {
  expectCliError(['--workflow', 'i2v', 'a cat'], 'Video-only options');
});

test('t2v rejects reference assets', () => {
  expectCliError(['--video', '--workflow', 't2v', '--ref', 'screenshot.jpg', 'a cat'], 't2v does not accept reference image/audio/video.');
});

test('i2v requires ref and/or ref-end', () => {
  expectCliError(['--video', '--workflow', 'i2v', 'a cat'], 'i2v requires --ref and/or --ref-end.');
});

test('s2v requires both ref and ref-audio', () => {
  expectCliError(['--video', '--workflow', 's2v', '--ref', 'screenshot.jpg', 'a cat'], 's2v requires both --ref and --ref-audio.');
});

test('ia2v requires both ref and ref-audio', () => {
  expectCliError(['--video', '--workflow', 'ia2v', '--ref', 'screenshot.jpg', 'a cat'], 'ia2v requires both --ref and --ref-audio.');
});

test('a2v requires ref-audio only', () => {
  expectCliError(['--video', '--workflow', 'a2v', 'a cat'], 'a2v requires --ref-audio.');
});

test('audio-only video input infers a2v and LTX audio-to-video default model', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref-audio', SCREENSHOT_FIXTURE,
    'abstract music visualizer'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_a2v_distilled');
  assert.equal(state.lastVideoProject.referenceAudio != null, true);
  assert.equal(state.lastVideoProject.referenceImage == null, true);
});

test('image plus audio infers LTX image-audio-to-video instead of WAN s2v by default', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref', SCREENSHOT_FIXTURE,
    '--ref-audio', SCREENSHOT_FIXTURE,
    'music video with synchronized motion'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_ia2v_distilled');
  assert.equal(state.lastVideoProject.referenceImage != null, true);
  assert.equal(state.lastVideoProject.referenceAudio != null, true);
});

test('lip-sync image plus audio prompt infers WAN s2v', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref', SCREENSHOT_FIXTURE,
    '--ref-audio', SCREENSHOT_FIXTURE,
    'lip sync talking head'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'wan_v2.2-14b-fp8_s2v_lightx2v');
  assert.equal(state.lastVideoProject.referenceImage != null, true);
  assert.equal(state.lastVideoProject.referenceAudio != null, true);
});

test('text-to-video defaults to LTX 2.3 for native audio capable generation', () => {
  const { exitCode, state } = runCli([
    '--video',
    'a narrator says "welcome to the story" while ocean waves crash'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_t2v_distilled');
  assert.equal(state.lastVideoProject.fps, 24);
});

test('MiniMax H3 alias pins FL2VA t2v and snaps duration to the native frame grid', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'minimax-h3',
    '--duration', '5',
    'A locked cinematic shot with rain ambience and one spoken line.'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'minimax-h3-fl2va-fp8_t2v');
  assert.equal(state.lastVideoProject.frames, 124);
  assert.equal(state.lastVideoProject.fps, 24);
  assert.equal(state.lastVideoProject.width, 1344);
  assert.equal(state.lastVideoProject.height, 768);
});

test('MiniMax H3 bare alias selects the first/last-frame workflow when both references exist', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'minimax-h3',
    '--ref', SCREENSHOT_FIXTURE,
    '--ref-end', SCREENSHOT_FIXTURE,
    'The opening frame moves continuously into the final composition.'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'minimax-h3-fl2va-fp8_flf2v');
  assert.ok(state.lastVideoProject.referenceImage);
  assert.ok(state.lastVideoProject.referenceImageEnd);
  assert.equal(state.lastVideoProject.loras, undefined);
});

test('MiniMax H3 rejects off-grid explicit frame counts', () => {
  expectCliError(
    ['--video', '-m', 'minimax-h3', '--frames', '125', 'A short clip.'],
    'MiniMax H3 frames must be 124 + n×17'
  );
});

test('target resolution scales video short side while preserving aspect', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--target-resolution', '768',
    'wide cinematic landscape'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_t2v_distilled');
  assert.equal(state.lastVideoProject.width, 1344);
  assert.equal(state.lastVideoProject.height, 768);
});

test('video preflight infers natural-language duration and bare resolution tier', () => {
  const { exitCode, state } = runCli([
    '--video',
    'make a 12 second 720p video of ocean waves'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.duration, 12);
  assert.equal(state.lastVideoProject.width, 1216);
  assert.equal(state.lastVideoProject.height, 704);
});

test('video preflight infers orientation-qualified resolution pixels', () => {
  const { exitCode, state } = runCli([
    '--video',
    'make a 12 second 720p portrait video of ocean waves'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.duration, 12);
  assert.equal(state.lastVideoProject.width, 704);
  assert.equal(state.lastVideoProject.height, 1280);
});

test('video preflight applies explicit aspect ratios after model defaults', () => {
  const { exitCode, state } = runCli([
    '--video',
    'make a 9:16 portrait video of ocean waves'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.width, 1088);
  assert.equal(state.lastVideoProject.height, 1920);
});

test('literal video prompt bypasses prompt guardrail rewriting', () => {
  const { exitCode, state } = runCli([
    '--video',
    "Use this prompt exactly: HOST: 'Hello there'"
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.positivePrompt, "HOST: 'Hello there'");
});

test('seedance alias selects Seedance T2V without step overrides', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'seedance2',
    'cinematic product reveal with ambient audio'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'seedance-2-0');
  assert.equal(state.lastVideoProject.fps, 24);
  assert.equal(Object.hasOwn(state.lastVideoProject, 'steps'), false);
});

test('seedance forces Spark token type even when SOGNI is requested', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--token-type', 'sogni',
    '-m', 'seedance2',
    'cinematic product reveal with ambient audio'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'seedance-2-0');
  assert.equal(state.lastVideoProject.tokenType, 'spark');
});

test('seedance v2v alias does not require or send ControlNet', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'v2v',
    '-m', 'seedance2',
    '--ref-video', 'https://example.com/source.mp4',
    'make the clip more cinematic'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'seedance-2-0');
  assert.deepEqual(state.lastVideoProject.referenceVideoUrls, ['https://example.com/source.mp4']);
  assert.equal(state.lastVideoProject.controlNet, undefined);
});

test('seedance t2v forwards HTTPS multimodal references as URL arrays', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 't2v',
    '-m', 'seedance2',
    '--fps', '30',
    '--ref', 'https://example.com/product.png',
    '--ref-video', 'https://example.com/motion.mp4',
    '--ref-audio', 'https://example.com/music.mp3',
    'Use @Image1 for product identity, @Video1 for motion, and @Audio1 for rhythm.'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'seedance-2-0');
  assert.equal(state.lastVideoProject.fps, 24);
  assert.deepEqual(state.lastVideoProject.referenceImageUrls, ['https://example.com/product.png']);
  assert.deepEqual(state.lastVideoProject.referenceVideoUrls, ['https://example.com/motion.mp4']);
  assert.deepEqual(state.lastVideoProject.referenceAudioUrls, ['https://example.com/music.mp3']);
  assert.equal(state.lastVideoProject.referenceImage, undefined);
  assert.equal(state.lastVideoProject.referenceVideo, undefined);
  assert.equal(state.lastVideoProject.referenceAudio, undefined);
});

test('seedance rejects unsafe HTTPS reference URLs before forwarding', () => {
  expectCliError(
    ['--video', '--workflow', 't2v', '-m', 'seedance2', '--ref', 'https://127.0.0.1/product.png', 'Use @Image1 as reference.'],
    'Reference image URL is not safe to forward'
  );
});

test('storyboard upload mention routes to Seedance storyboard fallback', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref', SCREENSHOT_FIXTURE,
    'I am uploading a storyboard. Turn it into a 9 second video.'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'seedance-2-0');
  assert.equal(state.lastVideoProject.positivePrompt, SEEDANCE_STORYBOARD_REFERENCE_PROMPT);
  assert.equal(state.lastVideoProject.duration, 9);
  assert.equal(state.lastVideoProject.fps, 24);
  assert.equal(state.lastVideoProject.referenceImage != null, true);
  assert.equal(Object.hasOwn(state.lastVideoProject, 'steps'), false);
});

test('--last-image participates in video workflow inference', () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'sogni-agent-last-image-test-'));
  const lastRenderPath = join(tempHome, 'last-render.json');
  writeFileSync(lastRenderPath, JSON.stringify({ localPath: SCREENSHOT_FIXTURE }));

  const { exitCode, state } = runCli([
    '--video',
    '--last-image',
    'gentle camera pan'
  ], {
    SOGNI_LAST_RENDER_PATH: lastRenderPath
  });

  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'wan_v2.2-14b-fp8_i2v_lightx2v');
  assert.equal(state.lastVideoProject.referenceImage != null, true);
});

test('two-image first/last-frame animation defaults to the LTX-2.3 morph model', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref', SCREENSHOT_FIXTURE,
    '--ref-end', SCREENSHOT_FIXTURE,
    'the opening frame flows smoothly into the final frame'
  ]);

  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_i2v_distilled');
  assert.ok(state.lastVideoProject.referenceImage);
  assert.ok(state.lastVideoProject.referenceImageEnd);
  assert.deepEqual(state.lastVideoProject.loras, ['transition']);
  assert.match(state.lastVideoProject.positivePrompt, /\bzhuanchang\b/);
});

test('explicit -m wan keeps WAN for first/last-frame pairs', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'wan_v2.2-14b-fp8_i2v_lightx2v',
    '--ref', SCREENSHOT_FIXTURE,
    '--ref-end', SCREENSHOT_FIXTURE,
    'the opening frame flows smoothly into the final frame'
  ]);

  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'wan_v2.2-14b-fp8_i2v_lightx2v');
  assert.ok(state.lastVideoProject.referenceImageEnd);
  assert.equal(state.lastVideoProject.loras, undefined);
});

test('seedance rejects audio-only references before wrapper validation', () => {
  expectCliError(
    ['--video', '--workflow', 't2v', '-m', 'seedance2', '--ref-audio', 'https://cdn.example.com/music.mp3', 'music-led clip'],
    'Seedance audio references require --ref, --ref-video, or -c/--context image refs.'
  );
});

test('seedance multi-ref forwards repeated --ref-audio / --ref-video HTTPS URLs as URL arrays', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 't2v',
    '-m', 'seedance2',
    '--ref', 'https://example.com/cover.png',
    '--ref-audio', 'https://example.com/voice.mp3',
    '--ref-audio', 'https://example.com/bed.mp3',
    '--ref-audio', 'https://example.com/sfx.mp3',
    '--ref-video', 'https://example.com/motion.mp4',
    '--ref-video', 'https://example.com/transition.mp4',
    'Use @Image1 for product identity, @Audio1 for voice, @Audio2/@Audio3 for ambience, @Video1/@Video2 for motion cues.'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.deepEqual(state.lastVideoProject.referenceImageUrls, ['https://example.com/cover.png']);
  assert.deepEqual(state.lastVideoProject.referenceAudioUrls, [
    'https://example.com/voice.mp3',
    'https://example.com/bed.mp3',
    'https://example.com/sfx.mp3',
  ]);
  assert.deepEqual(state.lastVideoProject.referenceVideoUrls, [
    'https://example.com/motion.mp4',
    'https://example.com/transition.mp4',
  ]);
});

test('seedance enforces 3-audio cap with canonical error message', () => {
  expectCliError(
    [
      '--video', '--workflow', 't2v', '-m', 'seedance2',
      '--ref', 'https://example.com/cover.png',
      '--ref-audio', 'https://example.com/a1.mp3',
      '--ref-audio', 'https://example.com/a2.mp3',
      '--ref-audio', 'https://example.com/a3.mp3',
      '--ref-audio', 'https://example.com/a4.mp3',
      'Use @Audio1..@Audio4 for layered audio reference.',
    ],
    'Seedance can use up to 3 audio references per video; this request included 4.'
  );
});

test('seedance enforces 3-video cap with canonical error message', () => {
  expectCliError(
    [
      '--video', '--workflow', 't2v', '-m', 'seedance2',
      '--ref', 'https://example.com/cover.png',
      '--ref-video', 'https://example.com/v1.mp4',
      '--ref-video', 'https://example.com/v2.mp4',
      '--ref-video', 'https://example.com/v3.mp4',
      '--ref-video', 'https://example.com/v4.mp4',
      'Use @Video1..@Video4 for layered motion reference.',
    ],
    'Seedance can use up to 3 video references per video; this request included 4.'
  );
});

test('seedance enforces 12-asset combined-total cap', () => {
  // 9 images (max) + 3 videos (max) + 1 audio = 13 → assets cap fires
  expectCliError(
    [
      '--video', '--workflow', 't2v', '-m', 'seedance2',
      '-c', 'https://example.com/i1.png',
      '-c', 'https://example.com/i2.png',
      '-c', 'https://example.com/i3.png',
      '-c', 'https://example.com/i4.png',
      '-c', 'https://example.com/i5.png',
      '-c', 'https://example.com/i6.png',
      '-c', 'https://example.com/i7.png',
      '-c', 'https://example.com/i8.png',
      '-c', 'https://example.com/i9.png',
      '--ref-video', 'https://example.com/v1.mp4',
      '--ref-video', 'https://example.com/v2.mp4',
      '--ref-video', 'https://example.com/v3.mp4',
      '--ref-audio', 'https://example.com/a1.mp3',
      'Use @Image1..@Image9 plus @Video1..@Video3 and @Audio1 to layer the scene.',
    ],
    'Seedance can use up to 12 total references per video; this request included 13.'
  );
});

test('seedance rejects mixing --ref dedicated frame with -c/--context loose refs', () => {
  expectCliError(
    [
      '--video', '--workflow', 't2v', '-m', 'seedance2',
      '--ref', 'https://example.com/first.png',
      '-c', 'https://example.com/loose.png',
      'Mixing dedicated frame mode and loose-refs mode.',
    ],
    'Seedance reference modes are mutually exclusive'
  );
});

test('seedance rejects mixing --ref-end dedicated last-frame with -c/--context loose refs', () => {
  expectCliError(
    [
      '--video', '--workflow', 't2v', '-m', 'seedance2',
      '--ref-end', 'https://example.com/last.png',
      '-c', 'https://example.com/loose.png',
      'Mixing dedicated last-frame and loose refs.',
    ],
    'Seedance reference modes are mutually exclusive'
  );
});

test('seedance rejects local-file extras for --ref-audio in CLI direct-gen', () => {
  expectCliError(
    [
      '--video', '--workflow', 't2v', '-m', 'seedance2',
      '--ref', 'https://example.com/cover.png',
      '--ref-audio', 'https://example.com/primary.mp3',
      '--ref-audio', '/tmp/local-extra.m4a',
      'Layered audio test.',
    ],
    'Additional --ref-audio "/tmp/local-extra.m4a" must be an HTTPS URL.'
  );
});

test('seedance multi-ref accepts seedance2-fast model identically', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 't2v',
    '-m', 'seedance2-fast',
    '--ref', 'https://example.com/cover.png',
    '--ref-audio', 'https://example.com/voice.mp3',
    '--ref-audio', 'https://example.com/bed.mp3',
    'seedance fast with multi-ref audio.'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.referenceAudioUrls.length, 2);
});

test('seedance direct video uploads local MP3 reference audio to v2 media URLs', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'sogni-agent-seedance-audio-'));
  const audioPath = join(tempDir, 'voice.mp3');
  writeFileSync(audioPath, Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]));

  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, state } = await runCliAsync([
      '--api-base-url', apiBaseUrl,
      '--video',
      '--workflow', 't2v',
      '-m', 'seedance2-fast',
      '--ref', 'https://example.com/cover.png',
      '--ref-audio', audioPath,
      '--duration', '4',
      'Use @Image1 for subject identity and @Audio1 for speech rhythm.'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    assert.ok(state?.lastVideoProject, 'createVideoProject was called');
    assert.deepEqual(state.lastVideoProject.referenceImageUrls, ['https://example.com/cover.png']);
    assert.equal(state.lastVideoProject.referenceAudio, undefined);
    assert.equal(state.lastVideoProject.referenceAudioUrls.length, 1);
    assert.match(state.lastVideoProject.referenceAudioUrls[0], /^https:\/\/cdn\.sogni\.ai\/test-v2-upload\/referenceAudio\//);
    assert.equal(requests.filter(item => item.url.startsWith('/v2/media/uploadUrl')).length, 1);
    assert.equal(requests.filter(item => item.url.startsWith('/test-v2-upload/referenceAudio/')).length, 1);
    assert.equal(requests.filter(item => item.url.startsWith('/v2/media/downloadUrl')).length, 1);
    assert.match(requests.find(item => item.url.startsWith('/v2/media/uploadUrl')).url, /contentType=audio%2Fmpeg/);
  });
});

test('seedance direct video uploads local loose-reference -c image to v2 image URLs', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'sogni-agent-seedance-image-'));
  const imagePath = join(tempDir, 'lumina.png');
  // Minimal valid PNG (signature + IHDR) so buffer mime-sniffing detects image/png.
  writeFileSync(imagePath, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  ]));

  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, state } = await runCliAsync([
      '--api-base-url', apiBaseUrl,
      '--video',
      '--workflow', 't2v',
      '-m', 'seedance2-fast',
      '-c', imagePath,
      '--duration', '4',
      'Use @Image1 for the product bottle design while generating a fresh scene.'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    assert.ok(state?.lastVideoProject, 'createVideoProject was called');
    assert.equal(state.lastVideoProject.referenceImageUrls.length, 1);
    assert.match(state.lastVideoProject.referenceImageUrls[0], /^https:\/\/cdn\.sogni\.ai\/test-v2-upload\/contextImage1\//);
    assert.equal(requests.filter(item => item.url.startsWith('/v2/image/uploadUrl')).length, 1);
    assert.equal(requests.filter(item => item.url.startsWith('/test-v2-upload/contextImage1/')).length, 1);
    assert.equal(requests.filter(item => item.url.startsWith('/v2/image/downloadUrl')).length, 1);
    assert.match(requests.find(item => item.url.startsWith('/v2/image/uploadUrl')).url, /contentType=image%2Fpng/);
  });
});

test('seedance direct video uploads a local WebP loose-reference image (sniffed by magic bytes)', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'sogni-agent-seedance-webp-'));
  // Deliberately mislabel the extension (.png) to prove byte-sniffing wins over
  // the file extension — the bytes are a valid WebP (RIFF....WEBP) header.
  const imagePath = join(tempDir, 'product.png');
  writeFileSync(imagePath, Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, // "RIFF" + size
    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, // "WEBP" + "VP8 "
    0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]));

  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, state } = await runCliAsync([
      '--api-base-url', apiBaseUrl,
      '--video',
      '--workflow', 't2v',
      '-m', 'seedance2-fast',
      '-c', imagePath,
      '--duration', '4',
      'Use @Image1 for the product design.'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    assert.equal(state.lastVideoProject.referenceImageUrls.length, 1);
    assert.match(state.lastVideoProject.referenceImageUrls[0], /^https:\/\/cdn\.sogni\.ai\/test-v2-upload\/contextImage1\//);
    // contentType is the sniffed WebP, not the misleading .png extension.
    assert.match(requests.find(item => item.url.startsWith('/v2/image/uploadUrl')).url, /contentType=image%2Fwebp/);
  });
});

test('seedance v2v uploads local source video to v2 media URLs', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'sogni-agent-seedance-video-'));
  const videoPath = join(tempDir, 'source.mp4');
  writeFileSync(videoPath, Buffer.from('fake mp4 bytes'));

  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, state } = await runCliAsync([
      '--api-base-url', apiBaseUrl,
      '--video',
      '--workflow', 'v2v',
      '-m', 'seedance2-fast',
      '--ref-video', videoPath,
      '--duration', '4',
      'Make the source clip more cinematic.'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    assert.ok(state?.lastVideoProject, 'createVideoProject was called');
    assert.equal(state.lastVideoProject.referenceVideo, undefined);
    assert.equal(state.lastVideoProject.referenceVideoUrls.length, 1);
    assert.match(state.lastVideoProject.referenceVideoUrls[0], /^https:\/\/cdn\.sogni\.ai\/test-v2-upload\/referenceVideo\//);
    assert.equal(requests.filter(item => item.url.startsWith('/v2/media/uploadUrl')).length, 1);
    assert.equal(requests.filter(item => item.url.startsWith('/test-v2-upload/referenceVideo/')).length, 1);
    assert.equal(requests.filter(item => item.url.startsWith('/v2/media/downloadUrl')).length, 1);
    assert.match(requests.find(item => item.url.startsWith('/v2/media/uploadUrl')).url, /contentType=video%2Fmp4/);
  });
});

test('non-seedance video rejects multiple --ref-audio entries', () => {
  expectCliError(
    [
      '--video',
      '--workflow', 'ia2v',
      '-m', 'ltx23-22b-fp8_ia2v_distilled',
      '--ref', 'https://example.com/first.png',
      '--ref-audio', 'https://example.com/a1.m4a',
      '--ref-audio', 'https://example.com/a2.m4a',
      'LTX should reject multi-audio.',
    ],
    'Multiple --ref-audio entries are only supported for Seedance models'
  );
});

test('happyhorse alias selects HappyHorse T2V at fixed 24fps without step overrides', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'happyhorse',
    'a glowing jellyfish drifts through a neon city at night'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'happyhorse-1.1-t2v');
  assert.equal(state.lastVideoProject.fps, 24);
  assert.equal(Object.hasOwn(state.lastVideoProject, 'steps'), false);
});

test('happyhorse-1.1-t2v explicit selection routes to HappyHorse text-to-video', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'happyhorse-1.1-t2v',
    'a polished product reveal with native ambient sound'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'happyhorse-1.1-t2v');
  assert.equal(state.lastVideoProject.fps, 24);
});

test('happyhorse video defaults to 1080P (1920x1080), not the 512x512 square', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'happyhorse',
    'a calm forest river at golden hour'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'happyhorse-1.1-t2v');
  // HappyHorse spec default is 1080P (1920x1080, 16:9). The shared runtime
  // still does not carry the bare HappyHorse alias, so the skill-local fallback
  // supplies 1920x1080 with maxDimension=1920 and dimensionMultiple=1.
  assert.equal(state.lastVideoProject.width, 1920);
  assert.equal(state.lastVideoProject.height, 1080);
});

test('happyhorse video honors explicit -w/-h over the new default', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'happyhorse',
    '--width', '720',
    '--height', '1280',
    'a vertical clip of a calm forest river'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'happyhorse-1.1-t2v');
  assert.equal(state.lastVideoProject.width, 720);
  assert.equal(state.lastVideoProject.height, 1280);
});

test('happyhorse forces Spark token type even when SOGNI is requested', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--token-type', 'sogni',
    '-m', 'happyhorse',
    'cinematic product reveal with native audio'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'happyhorse-1.1-t2v');
  assert.equal(state.lastVideoProject.tokenType, 'spark');
});

test('happyhorse i2v forwards a single HTTPS first-frame image as a URL array', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'happyhorse',
    '--fps', '30',
    '--ref', 'https://example.com/first.png',
    'bring the scene to life'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'happyhorse-1.1-i2v');
  assert.equal(state.lastVideoProject.fps, 24);
  assert.deepEqual(state.lastVideoProject.referenceImageUrls, ['https://example.com/first.png']);
  assert.equal(state.lastVideoProject.referenceImage, undefined);
  assert.equal(state.lastVideoProject.referenceVideoUrls, undefined);
  assert.equal(state.lastVideoProject.referenceAudioUrls, undefined);
});

test('happyhorse i2v forwards a single local first-frame image as an inline buffer', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'happyhorse-1.1-i2v',
    '--ref', SCREENSHOT_FIXTURE,
    'animate this photo'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'happyhorse-1.1-i2v');
  assert.equal(state.lastVideoProject.referenceImage != null, true);
  assert.equal(state.lastVideoProject.referenceImageUrls, undefined);
});

test('happyhorse r2v forwards 1-9 HTTPS reference images as a URL array', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'happyhorse',
    '-c', 'https://example.com/a.png',
    '-c', 'https://example.com/b.png',
    '-c', 'https://example.com/c.png',
    'blend these references into one continuous shot'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'happyhorse-1.1-r2v');
  assert.equal(state.lastVideoProject.fps, 24);
  assert.deepEqual(state.lastVideoProject.referenceImageUrls, [
    'https://example.com/a.png',
    'https://example.com/b.png',
    'https://example.com/c.png',
  ]);
});

test('happyhorse r2v enforces the 9 image-reference cap with a canonical message', () => {
  expectCliError(
    [
      '--video',
      '-m', 'happyhorse-1.1-r2v',
      ...Array.from({ length: 10 }).flatMap((_, i) => ['-c', `https://example.com/${i}.png`]),
      'too many references',
    ],
    'HappyHorse (happyhorse-1.1-r2v) can use up to 9 image references per video; this request included 10.'
  );
});

test('happyhorse i2v rejects an end frame (single first-frame image only)', () => {
  expectCliError(
    [
      '--video',
      '-m', 'happyhorse-1.1-i2v',
      '--ref', 'https://example.com/first.png',
      '--ref-end', 'https://example.com/last.png',
      'morph between frames',
    ],
    'HappyHorse i2v accepts only a single first-frame image'
  );
});

test('happyhorse r2v rejects dedicated --ref frames in favor of -c/--context', () => {
  expectCliError(
    [
      '--video',
      '-m', 'happyhorse-1.1-r2v',
      '-c', 'https://example.com/a.png',
      '--ref', 'https://example.com/first.png',
      'mix dedicated and loose refs',
    ],
    'HappyHorse r2v takes reference images via -c/--context, not --ref/--ref-end.'
  );
});

test('happyhorse rejects ControlNet', () => {
  expectCliError(
    ['--video', '-m', 'happyhorse', '--controlnet-name', 'pose', 'apply controlnet'],
    'HappyHorse video models do not support ControlNet.'
  );
});

test('happyhorse rejects reference audio (audio is rendered natively)', () => {
  expectCliError(
    ['--video', '-m', 'happyhorse', '--ref-audio', 'https://example.com/music.mp3', 'music-led clip'],
    'does not accept reference'
  );
});

test('happyhorse clamps duration to the 3-15s range', () => {
  const low = runCli(['--video', '-m', 'happyhorse', '--duration', '1', 'too short']);
  assert.equal(low.exitCode, 0);
  assert.equal(low.state.lastVideoProject.duration, 3);

  const high = runCli(['--video', '-m', 'happyhorse', '--duration', '30', 'too long']);
  assert.equal(high.exitCode, 0);
  assert.equal(high.state.lastVideoProject.duration, 15);
});

test('happyhorse rejects a workflow that contradicts the concrete model id', () => {
  expectCliError(
    ['--video', '-m', 'happyhorse-1.1-i2v', '--workflow', 't2v', '--ref', 'https://example.com/first.png', 'mismatch'],
    'does not match model "happyhorse-1.1-i2v"'
  );
});

test('looping is only supported with i2v workflow', () => {
  expectCliError(['--video', '--workflow', 't2v', '--looping', 'a cat'], '--looping is only supported with i2v workflow.');
});

test('photobooth requires ref image', () => {
  expectCliError(['--photobooth', 'portrait'], '--photobooth requires --ref <face-image>.');
});

test('photobooth cannot be combined with video', () => {
  expectCliError(['--photobooth', '--video', '--ref', 'screenshot.jpg', 'portrait'], '--photobooth cannot be combined with --video.');
});

test('video rejects unsupported lora options', () => {
  expectCliError(['--video', '--lora', 'foo', 'a cat'], 'Video LoRA "foo" is not supported.');
});

test('image rejects more than eight ordered LoRAs', () => {
  const args = ['-m', 'krea2_turbo_fp8_scaled'];
  for (let index = 0; index < 9; index += 1) {
    args.push('--lora', `krea2-test-${index}`);
  }
  args.push('a portrait');
  expectCliError(args, 'Image generation supports at most 8 LoRAs per render.');
});

test('DR34ML4Y video LoRA requires compatible LTX I2V and the sensitive-content filter off', () => {
  expectCliError(
    ['--video', '--lora', 'dr34ml4y-v3', 'a mature scene'],
    'requires a supported LTX-2.3 I2V model'
  );
  expectCliError(
    [
      '--video',
      '--ref', SCREENSHOT_FIXTURE,
      '-m', '10eros',
      '--lora', 'dr34ml4y-v3',
      'a mature scene'
    ],
    'LTX-2.3 10Eros is an opt-in mature-theme model and requires --no-filter'
  );
});

test('DR34ML4Y supports regular LTX-2.3 I2V with the filter off', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref', SCREENSHOT_FIXTURE,
    '-m', 'ltx23-22b-fp8_i2v',
    '--lora', 'dr34ml4y-v3',
    '--no-filter',
    'Test motion prompt, c0wg1rl'
  ]);

  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_i2v');
  assert.deepEqual(state.lastVideoProject.loras, ['dr34ml4y-v3']);
  assert.deepEqual(state.lastVideoProject.loraStrengths, [1]);
});

test('the installed LTX DR34ML4Y artifact is rejected on WAN models', () => {
  expectCliError(
    [
      '--video',
      '--ref', SCREENSHOT_FIXTURE,
      '-m', 'wan_v2.2-14b-fp8_i2v',
      '--lora', 'dr34ml4y-v3',
      '--no-filter',
      'Test motion prompt'
    ],
    'The separately trained WAN DR34ML4Y artifact is not installed on Sogni'
  );
});

test('10Eros requires the sensitive-content filter off without a LoRA too', () => {
  expectCliError(
    ['--video', '--ref', SCREENSHOT_FIXTURE, '-m', '10eros', 'a mature scene'],
    'LTX-2.3 10Eros is an opt-in mature-theme model and requires --no-filter'
  );
});

test('10Eros alias forwards DR34ML4Y and its default strength for adult I2V', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref', SCREENSHOT_FIXTURE,
    '-m', '10eros',
    '--lora', 'dr34ml4y-v3',
    '--no-filter',
    'Test motion prompt, d0gg1e'
  ], {
    SOGNI_AGENT_TEST_MODEL_TIERS_JSON: JSON.stringify({
      status: 'success',
      data: {
        model: {
          id: 'ltx23-22b-10eros-v1.4-fp8mixed_i2v',
          parameters: {
            steps: { min: 9, max: 9, default: 9 },
            guidance: { min: 1, max: 1, default: 1 }
          }
        }
      }
    })
  });

  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-10eros-v1.4-fp8mixed_i2v');
  assert.equal(state.lastVideoProject.disableNSFWFilter, true);
  assert.deepEqual(state.lastVideoProject.loras, ['dr34ml4y-v3']);
  assert.deepEqual(state.lastVideoProject.loraStrengths, [1]);
  assert.equal(state.lastVideoProject.steps, 9);
  assert.equal(state.lastVideoProject.guidance, 1);
});

test('10Eros forwards DR34ML4Y without requiring an action token', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref', SCREENSHOT_FIXTURE,
    '-m', '10eros',
    '--lora', 'dr34ml4y-v3',
    '--no-filter',
    'A continuous mature-theme motion prompt'
  ]);

  assert.equal(exitCode, 0);
  assert.deepEqual(state.lastVideoProject.loras, ['dr34ml4y-v3']);
  assert.deepEqual(state.lastVideoProject.loraStrengths, [1]);
});

test('10Eros keyframes do not attach the incompatible transition LoRA', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref', SCREENSHOT_FIXTURE,
    '--ref-end', SCREENSHOT_FIXTURE,
    '-m', '10eros',
    '--no-filter',
    'One uninterrupted test motion'
  ]);

  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-10eros-v1.4-fp8mixed_i2v');
  assert.ok(state.lastVideoProject.referenceImage);
  assert.ok(state.lastVideoProject.referenceImageEnd);
  assert.equal(state.lastVideoProject.loras, undefined);
  assert.doesNotMatch(state.lastVideoProject.positivePrompt, /\bzhuanchang\b/);
});

test('10Eros supports last-frame-only generation', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref-end', SCREENSHOT_FIXTURE,
    '-m', '10eros',
    '--no-filter',
    'The continuous shot resolves precisely into the supplied final frame'
  ]);

  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-10eros-v1.4-fp8mixed_i2v');
  assert.equal(state.lastVideoProject.referenceImage, undefined);
  assert.ok(state.lastVideoProject.referenceImageEnd);
});

test('video rejects sampler/scheduler options', () => {
  expectCliError(['--video', '--sampler', 'euler', 'a cat'], '--sampler/--scheduler are image-only options.');
});

test('non-video rejects auto-resize-assets', () => {
  expectCliError(['--auto-resize-assets', 'a cat'], '--auto-resize-assets is only valid with --video.');
});

test('estimate-video-cost requires --video', () => {
  expectCliError(['--estimate-video-cost', 'a cat'], '--estimate-video-cost requires --video.');
});

test('unknown workflow returns a validation error', () => {
  expectCliError(['--video', '--workflow', 'foo', 'a cat'], 'Unknown workflow "foo".');
});

test('--version returns current package version', () => {
  const { exitCode, stdout } = runCli(['--version']);
  assert.equal(exitCode, 0);
  assert.equal(stdout.trim(), PACKAGE_VERSION);
});

test('--version with --json returns structured version information', () => {
  const { exitCode, stdout } = runCli(['--json', '--version']);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.type, 'version');
  assert.equal(payload.name, 'sogni-creative-agent-skill');
  assert.equal(payload.version, PACKAGE_VERSION);
  assert.ok(payload.timestamp);
});

test('state and account utility commands do not emit generation seed logs', () => {
  const runs = [
    runCli(['--json', '--memory-set', 'preferred_style', 'watercolor']),
    runCli(['--json', '--personality-set', 'Be concise.']),
    runCli(['--json', '--persona-list']),
    runCli(['--json', '--balance'])
  ];

  for (const run of runs) {
    assert.equal(run.exitCode, 0);
    assert.doesNotMatch(run.stderr, /Using .* seed|No previous render/);
    assert.equal(JSON.parse(run.stdout.trim()).success, true);
  }
});

test('--last-seed is ignored for non-generation utility commands', () => {
  const { exitCode, stdout, stderr } = runCli(['--last-seed', '--json', '--memory-list']);
  assert.equal(exitCode, 0);
  assert.equal(JSON.parse(stdout.trim()).success, true);
  assert.doesNotMatch(stderr, /Using seed from last render|No previous render|Using .* seed/);
});

test('--persona-resolve matches exact persona id but not relationship text', () => {
  const sharedDir = mkdtempSync(join(tmpdir(), 'sogni-agent-persona-resolve-'));
  const personasDir = join(sharedDir, 'personas');
  mkdirSync(personasDir, { recursive: true });
  writeFileSync(
    join(personasDir, 'index.json'),
    JSON.stringify([
      {
        id: 'persona-partner-1',
        name: 'Aleyna',
        slug: 'aleyna',
        relationship: 'partner',
        description: '',
        tags: [],
        voice: null,
        photoPath: null,
        voiceClipPath: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ], null, 2)
  );

  const byId = runCli(['--json', '--persona-resolve', 'persona-partner-1'], {
    SOGNI_PERSONAS_DIR: personasDir,
  });
  assert.equal(byId.exitCode, 0);
  assert.equal(JSON.parse(byId.stdout.trim()).persona.name, 'Aleyna');

  const byRelationship = runCli(['--json', '--persona-resolve', 'my wife'], {
    SOGNI_PERSONAS_DIR: personasDir,
  });
  assert.equal(byRelationship.exitCode, 0);
  assert.equal(JSON.parse(byRelationship.stdout.trim()).found, false);
});

test('--api-chat injects saved personas, memories, and personality into the system prompt', async () => {
  // Pre-populate the persona / memory / personality stores in a shared
  // temp dir so the CLI process picks them up via the SOGNI_* env vars
  // (which the skill prefers over the default HOME-relative paths).
  const sharedDir = mkdtempSync(join(tmpdir(), 'sogni-agent-dynamic-prompt-'));
  const personasDir = join(sharedDir, 'personas');
  const memoriesPath = join(sharedDir, 'memories.json');
  const personalityPath = join(sharedDir, 'personality.txt');

  // Seed personas index.
  (await import('node:fs')).mkdirSync(personasDir, { recursive: true });
  writeFileSync(
    join(personasDir, 'index.json'),
    JSON.stringify([
      {
        id: 'p1',
        name: 'Aleyna',
        slug: 'aleyna',
        relationship: 'partner',
        description: 'long brown hair',
        tags: ['wife'],
        voice: null,
        photoPath: null,
        voiceClipPath: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ], null, 2)
  );
  writeFileSync(
    memoriesPath,
    JSON.stringify([
      { id: 'm1', key: 'preferred_style', value: 'watercolor', category: 'preference', source: 'user', createdAt: 0, updatedAt: 0 },
    ], null, 2)
  );
  writeFileSync(personalityPath, 'Be concise and witty.');

  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      'Hello!'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1',
      SOGNI_PERSONAS_DIR: personasDir,
      SOGNI_MEMORIES_PATH: memoriesPath,
      SOGNI_PERSONALITY_PATH: personalityPath,
    });

    assert.equal(exitCode, 0);
    const request = requests.find(item => item.url === '/v1/chat/completions');
    assert.ok(request, 'expected a chat completions request');
    const systemContent = request.body.messages[0].content;
    assert.equal(request.body.messages[0].role, 'system');
    // Default hosted-chat prompt is Sogni-aware and v2-aware, not a generic
    // text-only assistant prompt.
    assert.match(systemContent, /V2 TURN ARCHITECTURE/);
    assert.match(systemContent, /GPT Image 2 in Sogni/);
    assert.match(systemContent, /generic text-only limitations/);
    assert.doesNotMatch(systemContent, /You are a concise creative production assistant/);
    // Persona name surfaced into the prompt.
    assert.match(systemContent, /Aleyna/);
    assert.match(systemContent, /partner/);
    assert.doesNotMatch(systemContent, /my wife/);
    // Memory key/value pair surfaced.
    assert.match(systemContent, /preferred_style: watercolor/);
    // Personality instruction surfaced.
    assert.match(systemContent, /Be concise and witty\./);
  });
});

test('--api-chat propagates --no-filter as safeContentFilter=false in the chat body', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--no-filter',
      '--json',
      'Test prompt'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const request = requests.find(item => item.url === '/v1/chat/completions');
    assert.ok(request);
    assert.equal(request.body.safeContentFilter, false);
  });
});

test('--api-chat omits safeContentFilter when --no-filter is absent', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      'Test prompt'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const request = requests.find(item => item.url === '/v1/chat/completions');
    assert.ok(request);
    assert.equal(Object.hasOwn(request.body, 'safeContentFilter'), false);
  });
});

test('--durable-chat without SDK transport enabled fails with a clear error', async () => {
  await withTestApiServer(async (apiBaseUrl) => {
    const { exitCode, stdout } = await runCliAsync([
      '--durable-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      'Hello'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1',
      // Ensure SDK transport is off
      SOGNI_SKILL_USE_SDK_TRANSPORT: ''
    });

    assert.notEqual(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, false);
    assert.match(payload.errorCode || '', /DURABLE_CHAT/);
  });
});

test('--api-chat posts to /v1/chat/completions with creative-agent tools', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      'Create a 4-shot product video concept for a red sneaker'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.type, 'api-chat');
    assert.equal(payload.content, 'Test API chat response');

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer test-api-key');
    assert.equal(request.headers['x-app-source'], 'sogni-creative-agent-skill');
    assert.equal(request.headers['x-sogni-interaction-kind'], 'external_agent');
    assert.equal(request.headers['x-sogni-workload-kind'], 'agent_mediated');
    assert.equal(request.headers['x-sogni-agent-framework'], 'unknown');
    assert.equal(request.headers['x-sogni-agent-surface'], 'cli');
    assert.equal(request.headers['x-sogni-operation-scope'], 'top_level');
    assert.match(request.headers['x-sogni-operation-id'], /^op_[0-9a-f-]{36}$/);
    assert.equal(
      request.headers['x-sogni-root-operation-id'],
      request.headers['x-sogni-operation-id'],
    );
    assert.equal(request.body.sogni_tools, 'creative-agent');
    assert.equal(request.body.sogni_tool_execution, true);
    assert.equal(request.body.token_type, 'spark');
    assert.equal(request.body.app_source, 'sogni-creative-agent-skill');
    assert.equal(Object.hasOwn(request.body, 'appSource'), false);
    assert.equal(request.body.messages[1].content, 'Create a 4-shot product video concept for a red sneaker');
  });
});

test('--api-chat forwards Sogni Intelligence chat controls', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--task-profile', 'reasoning',
      '--max-tokens', '123',
      '--no-thinking',
      'Plan a product video'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.body.task_profile, 'reasoning');
    assert.equal(request.body.max_tokens, 123);
    assert.deepEqual(request.body.chat_template_kwargs, { enable_thinking: false });
  });
});

test('--list-api-models fetches hosted LLM models', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--list-api-models',
      '--api-base-url', apiBaseUrl,
      '--json'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.type, 'api-models');
    assert.equal(payload.models[0].id, 'qwen3.6-35b-a3b-gguf-iq4xs');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/models');
  });
});

test('--get-api-model fetches one hosted LLM model descriptor', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--get-api-model', 'qwen3.6-35b-a3b-gguf-iq4xs',
      '--api-base-url', apiBaseUrl,
      '--json'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.action, 'get');
    assert.equal(payload.model.id, 'qwen3.6-35b-a3b-gguf-iq4xs');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/models/qwen3.6-35b-a3b-gguf-iq4xs');
  });
});

function testModelCatalog(models) {
  return JSON.stringify({
    status: 'success',
    data: {
      catalogVersion: 'test-catalog-v1',
      models: models.map(model => ({
        id: model.id,
        name: model.name,
        mediaType: model.media,
        availableNetworks: model.networks || ['fast'],
        workerCounts: model.workerCounts || { fast: model.workerCount },
        tierId: model.tierId || null,
        tags: model.tags || []
      }))
    }
  });
}

const TEST_LIVE_MODELS = [
  {
    id: 'dark_beast_krea2_fp8',
    name: 'Dark Beast KREA 2 黑兽',
    workerCount: 42,
    media: 'image',
    tags: ['new', 'spicy', 'standard', 'uncensored']
  },
  {
    id: 'ltx23-22b-fp8_t2v_distilled',
    name: 'LTX-2.3 22B',
    workerCount: 24,
    media: 'video',
    networks: ['fast', 'relaxed'],
    workerCounts: { fast: 24, relaxed: 1 },
    tags: ['fast', 'standard']
  },
  {
    id: 'ace_step_1.5_xl_turbo',
    name: 'ACE-Step 1.5 XL Turbo',
    workerCount: 12,
    media: 'audio',
    tags: ['standard']
  }
];

test('--search-models queries the public REST model catalog without a socket client', () => {
  const models = [
    {
      id: 'dark_beast_z_image_turbo_v9_bf16',
      name: 'Dark Beast Z-Image Turbo v9',
      workerCount: 51,
      media: 'image'
    },
    {
      id: 'dark_beast_krea2_identity_edit_v1_2',
      name: 'Dark Beast KREA 2 Identity Edit',
      workerCount: 38,
      media: 'image'
    },
    {
      id: 'ltx23-22b-fp8_t2v_distilled',
      name: 'LTX-2.3 22B',
      workerCount: 20,
      media: 'video'
    }
  ];
  const { exitCode, stdout, state } = runCli(
    ['--json', '--search-models', 'darkbeast'],
    {
      SOGNI_API_KEY: '',
      SOGNI_AGENT_TEST_MODEL_CATALOG_JSON: testModelCatalog(models)
    }
  );

  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.type, 'live-models');
  assert.equal(payload.network, 'fast');
  assert.equal(payload.query, 'darkbeast');
  assert.equal(payload.count, 2);
  assert.deepEqual(
    payload.models.map((model) => model.id),
    ['dark_beast_z_image_turbo_v9_bf16', 'dark_beast_krea2_identity_edit_v1_2']
  );
  assert.equal(state?.clientConfigs, undefined);
});

test('--search-models matches the spicy catalog tag', () => {
  const models = [
    {
      id: 'dark_beast_krea2_fp8',
      name: 'Dark Beast KREA 2',
      workerCount: 42,
      media: 'image'
    },
    {
      id: 'dark_beast_z_image_turbo_v9_bf16',
      name: 'Dark Beast Z-Image Turbo v9',
      workerCount: 31,
      media: 'image'
    }
  ];
  const { exitCode, stdout } = runCli(
    ['--json', '--search-models', 'spicy'],
    {
      SOGNI_AGENT_TEST_MODEL_CATALOG_JSON: testModelCatalog(models.map(model => ({
        ...model,
        tags: model.id === 'dark_beast_krea2_fp8'
          ? ['new', 'spicy', 'standard', 'uncensored']
          : ['community', 'premium', 'uncensored']
      })))
    }
  );

  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.catalogTagsAvailable, true);
  assert.equal(payload.count, 1);
  assert.deepEqual(payload.models[0].tags, ['new', 'spicy', 'standard', 'uncensored']);
  assert.equal(payload.models[0].id, 'dark_beast_krea2_fp8');
});

test('--model-tag filters available models with repeatable AND semantics', () => {
  const models = [
    {
      id: 'dark_beast_krea2_fp8',
      name: 'Dark Beast KREA 2',
      workerCount: 42,
      media: 'image'
    },
    {
      id: 'dark_beast_z_image_turbo_v9_bf16',
      name: 'Dark Beast Z-Image Turbo v9',
      workerCount: 31,
      media: 'image'
    },
    {
      id: 'ltx23-22b-fp8_t2v_distilled',
      name: 'LTX-2.3 22B',
      workerCount: 20,
      media: 'video'
    }
  ];
  const { exitCode, stdout } = runCli(
    ['--json', '--list-models', '--model-tag', 'uncensored', '--model-tag', 'spicy'],
    {
      SOGNI_AGENT_TEST_MODEL_CATALOG_JSON: testModelCatalog(models.map(model => ({
        ...model,
        tags: model.id === 'dark_beast_krea2_fp8'
          ? ['new', 'spicy', 'standard', 'uncensored']
          : model.id === 'dark_beast_z_image_turbo_v9_bf16'
            ? ['community', 'premium', 'uncensored']
            : ['fast', 'standard']
      })))
    }
  );

  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.deepEqual(payload.tagFilters, ['uncensored', 'spicy']);
  assert.equal(payload.count, 1);
  assert.equal(payload.models[0].id, 'dark_beast_krea2_fp8');
});

test('tag search fails clearly when catalog metadata is unavailable', () => {
  const { exitCode, stdout } = runCli(['--json', '--search-models', 'uncensored'], {
    SOGNI_AGENT_TEST_MODEL_CATALOG_JSON: JSON.stringify({
      data: { models: TEST_LIVE_MODELS.map(({ tags: _tags, ...model }) => model) }
    })
  });

  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'MODEL_CATALOG_INVALID');
  assert.match(payload.error, /does not include catalog tags/i);
  assert.match(payload.hint, /api\.sogni\.ai/);
});

test('--list-models supports media and network filters', () => {
  const { exitCode, stdout, state } = runCli([
    '--json',
    '--list-models',
    '--model-media', 'video',
    '--model-network', 'relaxed'
  ], {
    SOGNI_AGENT_TEST_MODEL_CATALOG_JSON: testModelCatalog(TEST_LIVE_MODELS)
  });

  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.network, 'relaxed');
  assert.equal(payload.media, 'video');
  assert.equal(payload.count, 1);
  assert.ok(payload.models.every((model) => model.media === 'video'));
  assert.equal(state?.clientConfigs, undefined);
});

test('--search-models matches Unicode model names', () => {
  const { exitCode, stdout } = runCli(['--json', '--search-models', '黑兽'], {
    SOGNI_AGENT_TEST_MODEL_CATALOG_JSON: testModelCatalog(TEST_LIVE_MODELS)
  });

  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.count, 1);
  assert.equal(payload.models[0].id, 'dark_beast_krea2_fp8');
});

test('model discovery cache revalidates the REST catalog with ETag', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'sogni-model-list-cache-etag-'));
  const cachePath = join(cacheDir, 'catalog.json');
  const requestHeaders = [];
  const server = createServer((req, res) => {
    requestHeaders.push(req.headers);
    if (req.headers['if-none-match'] === '"catalog-list-v1"') {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.setHeader('etag', '"catalog-list-v1"');
    res.end(testModelCatalog(TEST_LIVE_MODELS));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const env = {
    SOGNI_MODEL_CATALOG_URL: `http://127.0.0.1:${address.port}/v1/model-catalog`,
    SOGNI_MODEL_CATALOG_CACHE_PATH: cachePath
  };

  try {
    const first = await runCliAsync(['--json', '--list-models'], env);
    assert.equal(first.exitCode, 0);

    const listCachePath = `${cachePath}.models`;
    const cached = JSON.parse(readFileSync(listCachePath, 'utf8'));
    cached.fetchedAt = Date.now() - (6 * 60 * 1000);
    writeFileSync(listCachePath, JSON.stringify(cached));

    const second = await runCliAsync(['--json', '--list-models'], env);
    assert.equal(second.exitCode, 0);
    assert.equal(JSON.parse(second.stdout).count, TEST_LIVE_MODELS.length);
    assert.equal(requestHeaders.length, 2);
    assert.equal(requestHeaders[1]['if-none-match'], '"catalog-list-v1"');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test('live model filter flags require a model discovery action', () => {
  const { exitCode, stderr } = runCli(['--model-media', 'image']);

  assert.equal(exitCode, 1);
  assert.match(stderr, /require --list-models or --search-models/);
});

test('--api-chat rejects loopback api base without explicit unsafe opt-in before sending credentials', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      'Create a product video concept'
    ], {
      SOGNI_API_KEY: 'test-api-key'
    });

    assert.equal(exitCode, 1);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.errorCode, 'UNSAFE_API_BASE_URL');
    assert.match(payload.error, /SOGNI_ALLOW_UNSAFE_API_BASE_URL/);
    assert.equal(requests.length, 0, 'credentials must not be sent to an unsafe API base URL');
  });
});

test('--api-chat rejects api base URLs containing credentials', () => {
  const { exitCode, stdout } = runCli([
    '--api-chat',
    '--api-base-url', 'https://user:pass@api.sogni.ai',
    '--json',
    'Create a product video concept'
  ], {
    SOGNI_API_KEY: 'test-api-key'
  });

  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'UNSAFE_API_BASE_URL');
  assert.match(payload.error, /must not contain credentials/);
});

test('--api-chat forwards image references with server-side tool execution enabled', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--ref', SCREENSHOT_FIXTURE,
      'edit this image into a poster'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    const request = requests.find(item => item.url === '/v1/chat/completions');
    assert.ok(request);
    assert.equal(request.body.sogni_tool_execution, true);
    assert.equal(request.body.media_references[0].flag, '--ref');
    assert.equal(request.body.media_references[0].kind, 'image');
    assert.match(request.body.media_references[0].url, /^https:\/\/cdn\.sogni\.ai\/test-upload\/referenceImage\//);
    assert.equal(Object.hasOwn(request.body, 'api_media_references'), false);
    assert.equal(request.body.messages[1].content[0].type, 'text');
    assert.equal(request.body.messages[1].content[1].type, 'image_url');
    assert.match(request.body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  });
});

test('--api-chat forwards audio and video references in API metadata and prompt context', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--ref-audio', 'https://cdn.sogni.ai/music.mp3',
      '--ref-video', 'https://cdn.sogni.ai/source.mp4',
      'make a music video'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.body.media_references.length, 2);
    assert.equal(request.body.media_references[0].kind, 'audio');
    assert.equal(request.body.media_references[1].kind, 'video');
    assert.match(request.body.messages[1].content, /API media references:/);
    assert.match(request.body.messages[1].content, /music\.mp3/);
    assert.match(request.body.messages[1].content, /source\.mp4/);
  });
});

test('--api-chat uploads local audio and video references before hosted execution', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'sogni-agent-api-media-'));
  const audioPath = join(tempDir, 'music.mp3');
  const videoPath = join(tempDir, 'source.mp4');
  writeFileSync(audioPath, Buffer.from('fake mp3 bytes'));
  writeFileSync(videoPath, Buffer.from('fake mp4 bytes'));

  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--ref-audio', audioPath,
      '--ref-video', videoPath,
      'make a music video'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    const request = requests.find(item => item.url === '/v1/chat/completions');
    assert.ok(request);
    const mediaRefs = request.body.media_references;
    assert.equal(mediaRefs.length, 2);
    assert.equal(mediaRefs[0].kind, 'audio');
    assert.equal(mediaRefs[0].filename, 'music.mp3');
    assert.match(mediaRefs[0].url, /^https:\/\/cdn\.sogni\.ai\/test-upload\/referenceAudio\//);
    assert.equal(mediaRefs[0].dataUri, undefined);
    assert.equal(mediaRefs[1].kind, 'video');
    assert.equal(mediaRefs[1].filename, 'source.mp4');
    assert.match(mediaRefs[1].url, /^https:\/\/cdn\.sogni\.ai\/test-upload\/referenceVideo\//);
    assert.equal(mediaRefs[1].dataUri, undefined);
    assert.equal(requests.filter(item => item.url.startsWith('/v1/media/uploadUrl')).length, 2);
    assert.equal(requests.filter(item => item.url.startsWith('/test-upload/')).length, 2);
    assert.equal(requests.filter(item => item.url.startsWith('/v1/media/downloadUrl')).length, 2);
    for (const uploadUrlRequest of requests.filter(item => item.url.startsWith('/v1/media/uploadUrl'))) {
      assert.equal(uploadUrlRequest.headers['x-app-source'], 'sogni-creative-agent-skill');
      assert.equal(uploadUrlRequest.headers['x-sogni-interaction-kind'], 'external_agent');
    }
    for (const presignedUpload of requests.filter(item => item.url.startsWith('/test-upload/'))) {
      assert.equal(presignedUpload.headers.authorization, undefined);
      assert.equal(presignedUpload.headers['api-key'], undefined);
      assert.equal(presignedUpload.headers['x-app-source'], undefined);
      assert.equal(
        Object.keys(presignedUpload.headers).some(name => name.startsWith('x-sogni-')),
        false,
      );
    }
    assert.equal(Object.hasOwn(request.body, 'public_skill_contract_runtime'), false);
    assert.match(request.body.messages[1].content, /music\.mp3/);
    assert.match(request.body.messages[1].content, /source\.mp4/);
    assert.doesNotMatch(request.body.messages[1].content, /base64/);
  });
});

test('--api-chat accepts media-only planning requests for non-image references', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--ref-video', 'https://cdn.sogni.ai/source.mp4'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.media_references[0].kind, 'video');
    assert.match(requests[0].body.messages[1].content, /Describe the attached media/);
    assert.match(requests[0].body.messages[1].content, /source\.mp4/);
  });
});

test('--api-workflow starts an explicit durable generated-keyframe workflow', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--video-prompt', 'The camera slowly pushes in as the sketch comes alive',
      '--width', '1024',
      '--height', '576',
      '--duration', '5',
      'A graphite robot sketch on a drafting table'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.type, 'api-workflow');
    assert.equal(payload.workflow.workflowId, 'wf_test');

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.url, '/v1/creative-agent/workflows');
    assert.equal(request.method, 'POST');
    assert.equal(Object.hasOwn(request.body, 'kind'), false);
    assert.equal(request.body.token_type, 'spark');
    assert.equal(request.body.app_source, 'sogni-creative-agent-skill');
    assert.equal(request.body.input.title, 'Generated keyframe to video');
    const [imageStep, videoStep] = request.body.input.steps;
    assert.equal(imageStep.toolName, 'generate_image');
    assert.equal(imageStep.arguments.prompt, 'A graphite robot sketch on a drafting table');
    assert.equal(imageStep.arguments.width, 1024);
    assert.equal(imageStep.arguments.height, 576);
    assert.equal(videoStep.toolName, 'generate_video');
    assert.equal(videoStep.arguments.prompt, 'The camera slowly pushes in as the sketch comes alive');
    assert.equal(videoStep.arguments.width, 1024);
    assert.equal(videoStep.arguments.height, 576);
    assert.equal(videoStep.arguments.duration, 5);
    assert.deepEqual(videoStep.dependsOn, [{
      sourceStepId: 'keyframe',
      sourceArtifactIndex: 0,
      targetArgument: 'referenceImageIndices',
      mediaType: 'image',
      transform: 'image_index',
      required: true
    }]);
  });
});

test('--list-replays lists Sogni Intelligence replay records', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--list-replays', '7',
      '--api-base-url', apiBaseUrl,
      '--json'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.type, 'api-replay');
    assert.equal(payload.records[0].runId, 'run_test');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/replay/records?limit=7');
  });
});

test('--get-replay fetches one replay RunRecord', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--get-replay', 'run_test',
      '--api-base-url', apiBaseUrl,
      '--json'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.record.run_id, 'run_test');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/replay/records/run_test');
  });
});

test('--ingest-replay posts a replay RunRecord', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const record = {
      schemaVersion: 1,
      run_id: 'run_ingested',
      user_request: 'generate a poster',
      rounds: []
    };
    const { exitCode, stdout } = await runCliAsync([
      '--ingest-replay', JSON.stringify(record),
      '--api-base-url', apiBaseUrl,
      '--json'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.result.runId, 'run_ingested');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/replay/records');
    assert.deepEqual(requests[0].body, record);
  });
});

test('--ingest-replay reports structured errors for unreadable input files', () => {
  const missingPath = join(tmpdir(), `sogni-missing-replay-${Date.now()}.json`);
  const { exitCode, stdout } = runCli([
    '--ingest-replay', `@${missingPath}`,
    '--json'
  ], {
    SOGNI_API_KEY: 'test-api-key'
  });

  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'INVALID_REPLAY_INPUT');
  assert.match(payload.error, /Unable to read --ingest-replay file/);
});

test('--api-workflow forwards explicit durable workflow input', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const input = {
      title: 'Two-step product workflow',
      steps: [
        {
          id: 'hero_image',
          toolName: 'generate_image',
          arguments: {
            prompt: 'A red sneaker hero product photo on a clean studio plinth',
            width: 1024,
            height: 1024
          }
        },
        {
          id: 'hero_video',
          toolName: 'generate_video',
          arguments: {
            prompt: 'A slow push-in on the red sneaker hero product photo',
            duration: 5
          },
          dependsOn: [{
            sourceStepId: 'hero_image',
            sourceArtifactIndex: 0,
            targetArgument: 'reference_image_url',
            mediaType: 'image',
            transform: 'artifact_url',
            required: true
          }]
        }
      ]
    };

    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--workflow-input', JSON.stringify(input)
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.url, '/v1/creative-agent/workflows');
    assert.equal(request.method, 'POST');
    assert.equal(Object.hasOwn(request.body, 'kind'), false);
    assert.equal(request.body.token_type, 'spark');
    assert.equal(request.body.app_source, 'sogni-creative-agent-skill');
    assert.deepEqual(request.body.input, input);
    assert.equal(
      request.body.input.steps[0].toolName,
      'generate_image',
      'skill should forward durable tool names without an API-side start kind'
    );
  });
});

test('--api-workflow forwards CLI media references and cost controls', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--ref', SCREENSHOT_FIXTURE,
      '--workflow-max-cost', '25',
      '--confirm-cost',
      'animate this image'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    const request = requests.find(item => item.url === '/v1/creative-agent/workflows');
    assert.ok(request);
    assert.equal(request.url, '/v1/creative-agent/workflows');
    assert.equal(request.body.media_references[0].flag, '--ref');
    assert.equal(request.body.media_references[0].kind, 'image');
    assert.match(request.body.media_references[0].url, /^https:\/\/cdn\.sogni\.ai\/test-upload\/referenceImage\//);
    assert.equal(request.body.max_estimated_capacity_units, 25);
    assert.equal(request.body.confirm_cost, true);
    assert.equal(Object.hasOwn(request.body, 'cost_ceiling'), false);
  });
});

test('--api-workflow uploads local non-image media references before durable execution', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'sogni-agent-api-workflow-media-'));
  const audioPath = join(tempDir, 'music.mp3');
  const videoPath = join(tempDir, 'source.mp4');
  writeFileSync(audioPath, Buffer.from('fake mp3 bytes'));
  writeFileSync(videoPath, Buffer.from('fake mp4 bytes'));

  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--ref-audio', audioPath,
      '--ref-video', videoPath,
      '--workflow-input', JSON.stringify({
        steps: [{
          toolName: 'sound_to_video',
          arguments: { prompt: 'music visualizer', duration: 5 }
        }]
      })
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    const request = requests.find(item => item.url === '/v1/creative-agent/workflows');
    assert.ok(request);
    const mediaRefs = request.body.media_references;
    assert.equal(mediaRefs.length, 2);
    assert.match(mediaRefs[0].url, /^https:\/\/cdn\.sogni\.ai\/test-upload\/referenceAudio\//);
    assert.match(mediaRefs[1].url, /^https:\/\/cdn\.sogni\.ai\/test-upload\/referenceVideo\//);
    assert.equal(mediaRefs[0].dataUri, undefined);
    assert.equal(request.body.media_references[1].filename, 'source.mp4');
    assert.equal(Object.hasOwn(request.body, 'public_skill_contract_runtime'), false);
  });
});

test('--api-workflow uploads inline media references before durable execution', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--ref', 'data:image/png;base64,AAECAwQ=',
      '--workflow-input', JSON.stringify({
        steps: [{
          toolName: 'edit_image',
          arguments: { prompt: 'turn the uploaded image into a poster' }
        }]
      })
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    const request = requests.find(item => item.url === '/v1/creative-agent/workflows');
    assert.ok(request);
    const mediaRefs = request.body.media_references;
    assert.equal(mediaRefs.length, 1);
    assert.equal(mediaRefs[0].kind, 'image');
    assert.match(mediaRefs[0].url, /^https:\/\/cdn\.sogni\.ai\/test-upload\/referenceImage\//);
    assert.equal(mediaRefs[0].dataUri, undefined);
    assert.equal(mediaRefs[0].filename, 'inline-media-ref-image.png');
    assert.equal(requests.filter(item => item.url.startsWith('/v1/image/uploadUrl')).length, 1);
    assert.equal(requests.filter(item => item.url.startsWith('/test-upload/referenceImage/')).length, 1);
  });
});

test('shared cross-surface parity fixtures include public skill media-reference cases', () => {
  for (const fixture of CROSS_SURFACE_PARITY_FIXTURES) {
    assert.deepEqual(
      new Set(fixture.expectations.map((expectation) => expectation.surface)),
      new Set(CROSS_SURFACE_PARITY_SURFACES)
    );
  }

  const mediaRefsFixture = CROSS_SURFACE_PARITY_FIXTURES.find((fixture) => fixture.focus === 'skill_media_refs');
  assert.ok(mediaRefsFixture);
  const skillExpectation = mediaRefsFixture.expectations.find((expectation) => expectation.surface === 'public_skill');
  assert.ok(skillExpectation);
  assert.match(skillExpectation.entrypoint, /--api-chat/);
  assert.deepEqual(
    mediaRefsFixture.mediaReferences.map((ref) => ref.kind),
    ['audio', 'video']
  );
  assert.ok(skillExpectation.expectedBehavior.some((value) => /uploaded to Sogni media URLs/.test(value)));
});

test('--api-workflow uses OpenClaw cost defaults when CLI flags are omitted', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow',
      '--api-base-url', apiBaseUrl,
      '--json',
      'animate this image'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1',
      OPENCLAW_PLUGIN_CONFIG: JSON.stringify({
        defaultWorkflowMaxCost: 13,
        defaultWorkflowConfirmCost: false
      })
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.body.max_estimated_capacity_units, 13);
    assert.equal(request.body.confirm_cost, false);
    assert.equal(Object.hasOwn(request.body, 'cost_ceiling'), false);
  });
});

test('--api-workflow applies workflow title to generated durable input', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--workflow-title', 'Launch sketch',
      'A graphite robot sketch on a drafting table'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    assert.equal(JSON.parse(stdout.trim()).success, true);
    assert.equal(requests[0].body.input.title, 'Launch sketch');
  });
});

test('--api-workflow storyboard-video generates storyline and starts GPT Image 2 to Seedance sequence', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow', 'storyboard-video',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--storyboard-frames', '3',
      '--quality', 'fast',
      '--duration', '12',
      '--workflow-title', 'Neon bakery storyboard',
      '--workflow-idempotency-key', 'idem-storyboard-123',
      'Create a 12 second 9:16 bakery launch video with GPT Image 2 and Seedance.'
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.storyboardPlan.frameCount, 3);
    assert.equal(payload.storyboardPlan.image.model, 'gpt-image-2');
    assert.equal(payload.storyboardPlan.image.quality, 'low');
    assert.equal(payload.storyboardPlan.video.model, 'seedance2');
    assert.equal(payload.storyboardPlan.video.width, 720);
    assert.equal(payload.storyboardPlan.video.height, 1280);
    assert.equal(payload.storyboardPlan.video.duration, 12);
    assert.match(payload.storyline, /Neon Bakery Launch/);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, '/v1/chat/completions');
    assert.equal(requests[0].body.sogni_tool_execution, false);
    assert.match(requests[0].body.messages[0].content, /SCENE NN - Title block/);
    assert.match(requests[0].body.messages[0].content, /DIALOGUE\/VO: \[no dialogue\]/);
    assert.equal(requests[1].url, '/v1/creative-agent/workflows');
    assert.equal(requests[1].headers['idempotency-key'], 'idem-storyboard-123');
    assert.equal(Object.hasOwn(requests[1].body, 'kind'), false);
    assert.equal(Object.hasOwn(requests[1].body, 'idempotency_key'), false);
    assert.equal(requests[1].body.app_source, 'sogni-creative-agent-skill');
    assert.equal(requests[1].body.input.title, 'Neon bakery storyboard');

    const [imageStep, videoStep] = requests[1].body.input.steps;
    assert.equal(imageStep.toolName, 'generate_image');
    assert.equal(imageStep.arguments.model, 'gpt-image-2');
    assert.equal(imageStep.arguments.gptImageQuality, 'low');
    assert.equal(imageStep.arguments.outputFormat, 'png');
    assert.equal(imageStep.arguments.numberOfVariations, 1);
    assert.match(imageStep.arguments.prompt, /Create exactly 3 sequential video storyboard frames/);
    // 3 portrait 9:16 cells balance as a 3-col x 1-row grid -> 27:16 landscape sheet
    // (upstream layout logic: balance cell shape with grid to avoid distortion).
    assert.match(imageStep.arguments.prompt, /Overall storyboard canvas: 2592x1536 pixels \(27:16\)/);
    assert.match(imageStep.arguments.prompt, /Target final video aspect ratio: 9:16/);

    assert.equal(videoStep.toolName, 'generate_video');
    assert.equal(videoStep.arguments.videoModel, 'seedance2');
    assert.equal(videoStep.arguments.expandPrompt, false);
    assert.equal(videoStep.arguments.generateAudio, true);
    assert.equal(videoStep.arguments.numberOfVariations, 1);
    assert.match(videoStep.arguments.prompt, /@Image1: approved storyboard reference image/);
    assert.match(videoStep.arguments.prompt, /not as a collage, split-screen, grid/);
    assert.deepEqual(videoStep.dependsOn, [{
      sourceStepId: 'storyboard_image',
      sourceArtifactIndex: 0,
      targetArgument: 'referenceImageIndices',
      mediaType: 'image',
      transform: 'image_index',
      required: true
    }]);
  });
});

test('--stream-workflow parses hosted workflow SSE frames without wrapper parser support', async () => {
  await withTestApiServer(async (apiBaseUrl) => {
    const { exitCode, stdout } = await runCliAsync([
      '--stream-workflow', 'wf_test',
      '--api-base-url', apiBaseUrl
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    assert.match(stdout, /\[evt_1\] workflow\.status completed/);
  });
});

test('--resume-workflow posts the durable workflow resume endpoint', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--resume-workflow', 'wf_test',
      '--api-base-url', apiBaseUrl
    ], {
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    assert.match(stdout, /wf_test/);
    assert.equal(requests.at(-1).url, '/v1/creative-agent/workflows/wf_test/resume');
    assert.equal(requests.at(-1).method, 'POST');
  });
});

test('explicit 512x512, output format, and seed are applied', () => {
  const { exitCode, state } = runCli([
    '--width', '512',
    '--height', '512',
    '--output-format', 'jpg',
    '--seed', '42',
    'neon cyberpunk city'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject);
  assert.equal(state.lastImageProject.width, 512);
  assert.equal(state.lastImageProject.height, 512);
  assert.equal(state.lastImageProject.outputFormat, 'jpg');
  assert.equal(state.lastImageProject.seed, 42);
});

test('count is forwarded to image generation', () => {
  const { exitCode, state } = runCli([
    '--count', '2',
    'a watercolor landscape'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject);
  assert.equal(state.lastImageProject.numberOfMedia, 2);
});

test('i2v infers a 16-multiple video size from non-square reference when width/height not explicitly set', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'i2v',
    '--ref', SCREENSHOT_FIXTURE,
    '--duration', '1',
    'gentle camera pan'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  // screenshot.jpg is 2314x1200. Default requested size is 512x512, but i2v would resize it to 512x266.
  // An exact-aspect bounding box tops out at 1296x672 here, so the CLI instead pre-resizes the
  // reference to the model cap: 1536x800 keeps 41% more pixels for 0.43% of aspect drift.
  assert.equal(state.lastVideoProject.width, 1536);
  assert.equal(state.lastVideoProject.height, 800);
});

test('video dims are normalized to 16-multiples instead of hard failing', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '-m', 'wan_v2.2-14b-fp8_t2v_lightx2v',
    '--width', '500',
    '--height', '512',
    'ocean waves'
  ]);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.width, 496);
  assert.equal(payload.height, 512);
});

test('ltx2 distilled models default estimate steps to 8', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--estimate-video-cost',
    '--json',
    '-m', 'ltx2-19b-fp8_t2v_distilled',
    'ocean waves'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state?.lastEstimateVideoCost?.steps, 8);
});

test('ltx2.3 distilled models use LTX-family defaults for cost estimation', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--estimate-video-cost',
    '--json',
    '--duration', '20',
    '--fps', '24',
    '--width', '768',
    '--height', '768',
    '-m', 'ltx23-22b-fp8_t2v_distilled',
    'cinematic drone shot'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state?.lastEstimateVideoCost?.modelId, 'ltx23-22b-fp8_t2v_distilled');
  assert.equal(state?.lastEstimateVideoCost?.steps, 8);
  assert.equal(state?.lastEstimateVideoCost?.duration, 20);
});

test('seedance v2v cost estimation marks video input and omits steps', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--estimate-video-cost',
    '--json',
    '--workflow', 'v2v',
    '--ref-video', 'source.mp4',
    '-m', 'seedance2-v2v'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state?.lastEstimateVideoCost?.modelId, 'seedance-2-0');
  assert.equal(state?.lastEstimateVideoCost?.hasVideoInput, true);
  assert.equal(state?.lastEstimateVideoCost?.steps, undefined);
});

test('LTX 2.3 video dimensions follow wrapper 2048px cap and 64-multiple rules', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '-m', 'ltx23-22b-fp8_t2v_distilled',
    '--width', '3840',
    '--height', '2160',
    'cinematic ocean waves'
  ]);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.model, 'ltx23-22b-fp8_t2v_distilled');
  assert.equal(payload.width, 2048);
  assert.equal(payload.height, 1152);
});

test('10Eros and regular LTX 2.3 i2v share compatible portrait sizing without redundant resizing', async () => {
  const { default: sharp } = await import('sharp');
  const tmp = mkdtempSync(join(tmpdir(), 'sogni-agent-10eros-ref-'));
  const refPath = join(tmp, 'ref-832x1216.png');
  await sharp({
    create: { width: 832, height: 1216, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toFile(refPath);

  const models = [
    {
      id: 'ltx23-22b-10eros-v1.4-fp8mixed_i2v',
      args: ['-m', '10eros', '--lora', 'dr34ml4y-v3', '--no-filter']
    },
    {
      id: 'ltx23-22b-fp8_i2v_distilled',
      args: ['-m', 'ltx23-22b-fp8_i2v_distilled']
    }
  ];

  for (const model of models) {
    const catalogFixture = JSON.stringify({
      data: {
        model: {
          id: model.id,
          parameters: {
            width: { min: 640, max: 3840, step: 64 },
            height: { min: 640, max: 3840, step: 64 },
            defaultSize: '1920x1088'
          }
        }
      }
    });
    const { exitCode, state, stderr } = runCli([
      '--video',
      '--ref', refPath,
      ...model.args,
      '--billing-mode', 'subscription',
      '--duration', '5',
      'gentle camera motion'
    ], { SOGNI_AGENT_TEST_MODEL_TIERS_JSON: catalogFixture });
    assert.equal(exitCode, 0, model.id);
    assert.equal(state?.lastVideoProject?.width, 832, model.id);
    assert.equal(state?.lastVideoProject?.height, 1216, model.id);
    assert.equal(state?.lastVideoProject?.autoResizeVideoAssets, false, model.id);
    assert.doesNotMatch(
      stderr,
      /Auto-adjusted video dimensions|Auto-adjusted i2v video size/,
      model.id
    );
  }
});

test('WAN non-animate duration is clamped to wrapper max', () => {
  const { exitCode, state } = runCli([
    '--video',
    '-m', 'wan_v2.2-14b-fp8_t2v_lightx2v',
    '--duration', '20',
    'ocean waves'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.duration, 10);
});

test('quoted dialogue auto-extends implicit video duration', () => {
  const dialogue = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
  const { exitCode, state } = runCli([
    '--video',
    `a host says "${dialogue}" to camera`
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.duration, 9);
});

test('reference audio identity uses LTX native voice identity instead of ref-audio', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--reference-audio-identity', SCREENSHOT_FIXTURE,
    'a narrator says "this is my voice"'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_t2v_distilled');
  assert.equal(state.lastVideoProject.referenceAudioIdentity != null, true);
  assert.equal(state.lastVideoProject.referenceAudio == null, true);
  assert.ok(state.lastVideoProject.positivePrompt.includes('[SPEECH]'));
});

test('reference audio identity preserves browser voice clip MIME types', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'sogni-agent-audio-id-'));
  const voicePath = join(tempDir, 'voice.webm');
  writeFileSync(voicePath, Buffer.from('test voice clip'));

  const { exitCode, state } = runCli([
    '--video',
    '--reference-audio-identity', voicePath,
    'a narrator says "this is my voice"'
  ]);

  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.referenceAudioIdentity?.__blob, true);
  assert.equal(state.lastVideoProject.referenceAudioIdentity?.type, 'audio/webm');
  assert.equal(state.lastVideoProject.referenceAudio == null, true);
});

test('LTX 2.3 i2v forwards first frame and audio identity together', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--ref', SCREENSHOT_FIXTURE,
    '--reference-audio-identity', SCREENSHOT_FIXTURE,
    '--first-frame-strength', '0.82',
    'a presenter looks at the camera and says "this is my voice identity"'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_i2v_distilled');
  assert.equal(state.lastVideoProject.referenceImage != null, true);
  assert.equal(state.lastVideoProject.referenceAudioIdentity != null, true);
  assert.equal(state.lastVideoProject.referenceAudio == null, true);
  assert.equal(state.lastVideoProject.firstFrameStrength, 0.82);
  assert.ok(state.lastVideoProject.positivePrompt.includes('[SPEECH]'));
});

test('LTX 2.3 10Eros alias pins its required workflow settings', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'i2v',
    '--ref', SCREENSHOT_FIXTURE,
    '-m', 'ltx23-eros',
    '--no-filter',
    'slow camera push toward the subject'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-10eros-v1.4-fp8mixed_i2v');
  assert.equal(state.lastVideoProject.steps, 9);
  assert.equal(state.lastVideoProject.guidance, 1);
  assert.equal(state.lastVideoProject.sampler, 'euler_ancestral');
  assert.equal(state.lastVideoProject.scheduler, 'manual_sigmas');
  assert.equal(state.lastVideoProject.disableNSFWFilter, true);
});

test('LTX 2.3 10Eros requires explicit content-filter disablement', () => {
  expectCliError(
    [
      '--video',
      '--workflow', 'i2v',
      '--ref', SCREENSHOT_FIXTURE,
      '-m', 'ltx23-eros',
      'slow camera push toward the subject'
    ],
    'LTX-2.3 10Eros is an opt-in mature-theme model and requires --no-filter.'
  );
});

test('LTX 2.3 10Eros rejects incompatible fixed settings', () => {
  expectCliError(
    [
      '--video',
      '--workflow', 'i2v',
      '--ref', SCREENSHOT_FIXTURE,
      '-m', 'ltx23-eros',
      '--no-filter',
      '--steps', '8',
      'slow camera push toward the subject'
    ],
    'LTX-2.3 10Eros requires --steps 9.'
  );
});

test('api key auth is accepted', () => {
  const { exitCode, state } = runCli(
    ['a cat wearing a hat'],
    {
      SOGNI_API_KEY: 'test-api-key'
    }
  );
  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject, 'createImageProject was called');
});

test('socket model availability events are disabled after connect', () => {
  const { exitCode, state } = runCli(['a cat wearing a hat']);
  assert.equal(exitCode, 0);
  assert.equal(state?.clientConfigs?.[0]?.appSource, 'sogni-creative-agent-skill');
  assert.deepEqual(state?.socketEventSubscriptionUpdates, [
    {
      modelAvailability: false
    }
  ]);
});

test('host markers reach both the socket client and one top-level project operation', () => {
  const { exitCode, state } = runCli(
    ['a cat wearing a hat'],
    {
      SOGNI_AGENT_FRAMEWORK: 'codex',
      SOGNI_AGENT_SURFACE: 'personal_skill',
      SOGNI_AGENT_FRAMEWORK_VERSION: '0.77.0',
    },
  );
  assert.equal(exitCode, 0);

  const clientAttribution = state?.clientConfigs?.[0]?.attribution;
  assert.deepEqual(clientAttribution?.connection, {
    interactionKind: 'external_agent',
    agentFramework: 'codex',
    agentFrameworkVersion: '0.77.0',
    agentSurface: 'personal_skill',
    agentSurfaceVersion: PACKAGE_VERSION,
  });
  assert.deepEqual(clientAttribution?.workload, {
    workloadKind: 'agent_mediated',
    agentFramework: 'codex',
    agentFrameworkVersion: '0.77.0',
    agentSurface: 'personal_skill',
    agentSurfaceVersion: PACKAGE_VERSION,
  });

  const operation = state?.lastImageProject?.attribution;
  assert.equal(operation?.workloadKind, 'agent_mediated');
  assert.equal(operation?.agentFramework, 'codex');
  assert.equal(operation?.agentSurface, 'personal_skill');
  assert.equal(operation?.operationScope, 'top_level');
  assert.match(operation?.operationId ?? '', /^op_[0-9a-f-]{36}$/);
  assert.equal(operation?.rootOperationId, operation?.operationId);
  assert.equal(operation?.parentOperationId, undefined);
});

test('missing API key is rejected', () => {
  const { exitCode, stdout } = runCli(
    ['--json', 'a cat wearing a hat'],
    {
      SOGNI_API_KEY: '',
    }
  );
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'MISSING_CREDENTIALS');
  assert.equal(payload.errorType, 'PERMISSION_REQUIRED');
  assert.equal(payload.errorCategory, 'permission_required');
  assert.equal(payload.retryable, false);
  assert.equal(
    payload.hint,
    'Set SOGNI_API_KEY, or configure SOGNI_CREDENTIALS_PATH with SOGNI_API_KEY. You can find your API key by logging into https://dashboard.sogni.ai and opening the account menu.'
  );
});

test('json error: seedance real-person policy cancellation is safety rejected and friendly', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '--workflow', 't2v',
    '-m', 'seedance2-fast',
    'gentle product reveal'
  ], {
    SOGNI_AGENT_TEST_VIDEO_PROJECT_ERROR: 'Seedance rejected the input image because it may contain a real person.'
  });
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, false);
  assert.equal(payload.errorType, 'SAFETY_REJECTED');
  assert.equal(payload.errorCategory, 'content_refused');
  assert.equal(payload.retryable, false);
  assert.equal(payload.metadata.error, 'seedance_input_image_privacy_policy');
  assert.doesNotMatch(payload.error, /Vendor task|status=failed|cgt-/);
});

test('json error: seedance generated content policy cancellation hides vendor internals', () => {
  const vendorError = 'Seedance rejected the request: Vendor job failed: Vendor task cgt-test ended with status=failed: {"status":"failed","error":{"code":"SensitiveContentDetected","message":"The generated video failed a content policy check.","request_id":"req","type":"BadRequest"}}';
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '--workflow', 't2v',
    '-m', 'seedance2-fast',
    'gentle product reveal'
  ], {
    SOGNI_AGENT_TEST_VIDEO_PROJECT_ERROR: vendorError
  });
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, false);
  assert.equal(payload.errorType, 'SAFETY_REJECTED');
  assert.equal(payload.errorCategory, 'content_refused');
  assert.equal(payload.retryable, false);
  assert.equal(payload.metadata.error, 'seedance_content_policy');
  assert.equal(payload.metadata.vendorErrorCode, 'SensitiveContentDetected');
  assert.doesNotMatch(payload.error, /Vendor task|status=failed|cgt-test/);
  assert.match(payload.technicalError, /cgt-test/);
});

test('json error: seedance invalid audio format is parameter invalid and friendly', () => {
  const vendorError = 'Seedance rejected the request: Vendor job failed: Vendor task cgt-audio ended with status=failed: {"status":"failed","error":{"code":"InvalidParameter","message":"audio format from file https://example.com/audio.m4a not valid for model dreamina-seedance-2-0-fast in r2v, content[3].","request_id":"req","type":"BadRequest"}}';
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '--workflow', 't2v',
    '-m', 'seedance2-fast',
    'gentle product reveal'
  ], {
    SOGNI_AGENT_TEST_VIDEO_PROJECT_ERROR: vendorError
  });
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, false);
  assert.equal(payload.errorType, 'PARAMETER_INVALID');
  assert.equal(payload.errorCategory, 'schema_validation');
  assert.equal(payload.retryable, false);
  assert.match(payload.error, /audio reference format/);
  assert.doesNotMatch(payload.error, /content\[3\]|cgt-audio/);
  assert.match(payload.technicalError, /content\[3\]/);
});

test('json error: happyhorse vendor failure classifies as happyhorse, not seedance', () => {
  // Vendor-agnostic socket failure text (no "seedance"/"happyhorse" mention) that
  // BOTH the generic Seedance generation matcher and the HappyHorse generation
  // matcher accept. Because the failing model is HappyHorse, the HappyHorse
  // matcher must win — otherwise the error is misattributed to Seedance.
  const vendorError = 'Vendor job failed: Vendor task hh-task-1 ended with status=failed: {"output":{"task_status":"FAILED","code":"InternalError","message":"The generated video failed."}}';
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '-m', 'happyhorse-1.1-t2v',
    'a glowing jellyfish drifts through a neon city'
  ], {
    SOGNI_AGENT_TEST_VIDEO_PROJECT_ERROR: vendorError
  });
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, false);
  assert.equal(payload.metadata.error, 'happyhorse_generation_failed');
  assert.doesNotMatch(payload.metadata.error, /seedance/);
  assert.equal(payload.errorType, 'GPU_WORKER_FAILED');
  assert.equal(payload.errorCategory, 'transient_failure');
  assert.equal(payload.retryable, true);
  assert.match(payload.error, /HappyHorse/);
  assert.doesNotMatch(payload.error, /Seedance/);
});

test('json error: i2v rejects mismatched explicit size and suggests a compatible 16-multiple aspect', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    '--strict-size',
    '--video',
    '--workflow', 'i2v',
    '--ref', SCREENSHOT_FIXTURE,
    '--width', '512',
    '--height', '512',
    'gentle camera pan'
  ]);
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, false);
  assert.equal(payload.errorCode, 'INVALID_VIDEO_SIZE');
  assert.equal(payload.errorType, 'PARAMETER_INVALID');
  assert.equal(payload.errorCategory, 'schema_validation');
  assert.equal(payload.retryable, false);
  assert.ok(String(payload.hint || '').includes('--width 1296 --height 672'));
});

test('json error: i2v validates --ref-end sizing with strict-size', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    '--strict-size',
    '--video',
    '--workflow', 'i2v',
    '--ref-end', SCREENSHOT_FIXTURE,
    '--width', '512',
    '--height', '512',
    'gentle camera pan'
  ]);
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, false);
  assert.equal(payload.errorCode, 'INVALID_VIDEO_SIZE');
  assert.equal(payload.errorDetails.referenceType, 'refImageEnd');
});

test('i2v auto-adjust handles near-matching aspects that still round to a non-16 dimension', async () => {
  const { default: sharp } = await import('sharp');
  const tmp = mkdtempSync(join(tmpdir(), 'sogni-agent-ref-'));
  const refPath = join(tmp, 'ref-587x880.png');
  await sharp({
    create: { width: 587, height: 880, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toFile(refPath);

  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'i2v',
    '--ref', refPath,
    '--duration', '1',
    'gentle camera pan'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject);
  // The exact-aspect bounding box (832x720) would resize this reference down to 480x720.
  // Pre-resizing to 592x880 keeps 51% more pixels for 0.85% of aspect drift, so it wins.
  assert.equal(state.lastVideoProject.width, 592);
  assert.equal(state.lastVideoProject.height, 880);
});

test('i2v keeps the model pixel budget when the reference aspect has no large divisor-valid box', async () => {
  const { default: sharp } = await import('sharp');
  const tmp = mkdtempSync(join(tmpdir(), 'sogni-agent-ref-'));
  const refPath = join(tmp, 'ref-1600x896.png');
  // 1600x896 is 25:14. On a /16 model the largest box where BOTH the box and the resized
  // reference stay divisor-valid is 1200x672 — only 78% of the 1536x864 the model can reach.
  await sharp({
    create: { width: 1600, height: 896, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toFile(refPath);

  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'i2v',
    '-m', 'wan_v2.2-14b-fp8_i2v_lightx2v',
    '--ref', refPath,
    '--width', '1536',
    '--height', '864',
    '--duration', '1',
    'gentle motion'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.width, 1536);
  assert.equal(state.lastVideoProject.height, 864);
});

test('i2v reports pre-resized effective dims in --json rather than the fit-inside prediction', async () => {
  const { default: sharp } = await import('sharp');
  const tmp = mkdtempSync(join(tmpdir(), 'sogni-agent-ref-'));
  const refPath = join(tmp, 'ref-1600x896.png');
  await sharp({
    create: { width: 1600, height: 896, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toFile(refPath);

  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '--workflow', 'i2v',
    '-m', 'wan_v2.2-14b-fp8_i2v_lightx2v',
    '--ref', refPath,
    '--width', '1536',
    '--height', '864',
    '--duration', '1',
    'gentle motion'
  ]);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.adjustedVideoDims.reason, 'i2v-ref-pre-resize');
  assert.deepEqual(payload.adjustedVideoDims.resizedTo, { width: 1536, height: 864 });
  // The old behaviour would have silently shrunk the video to this instead.
  assert.deepEqual(payload.adjustedVideoDims.insteadOf, { width: 1200, height: 672 });
  assert.equal(payload.effectiveWidth, 1536);
  assert.equal(payload.effectiveHeight, 864);
});

test('i2v keeps the exact-aspect box when pre-resizing would distort the aspect too far', async () => {
  const { default: sharp } = await import('sharp');
  const tmp = mkdtempSync(join(tmpdir(), 'sogni-agent-ref-'));
  const refPath = join(tmp, 'ref-1000x500.png');
  // A clean 2:1 source already has large divisor-valid boxes, so no pre-resize trade is needed.
  await sharp({
    create: { width: 1000, height: 500, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toFile(refPath);

  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '--workflow', 'i2v',
    '-m', 'wan_v2.2-14b-fp8_i2v_lightx2v',
    '--ref', refPath,
    '--duration', '1',
    'gentle motion'
  ]);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  // Aspect must be preserved within the configured drift ceiling either way.
  const aspect = payload.effectiveWidth / payload.effectiveHeight;
  assert.ok(Math.abs(aspect - 2) / 2 <= 0.02, `expected ~2:1 output, got ${payload.effectiveWidth}x${payload.effectiveHeight}`);
});

test('--balance with --json returns balance information', () => {
  const { exitCode, stdout } = runCli(['--json', '--balance']);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.type, 'balance');
  assert.equal(payload.spark, 100);
  assert.equal(payload.sogni, 100);
  assert.ok(payload.tokenType);
  assert.ok(payload.timestamp);
});

test('--balances (alias) with --json returns balance information', () => {
  const { exitCode, stdout } = runCli(['--json', '--balances']);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.type, 'balance');
  assert.equal(payload.spark, 100);
  assert.equal(payload.sogni, 100);
});

test('--balance without --json displays human-readable output', () => {
  const { exitCode, stdout } = runCli(['--balance']);
  assert.equal(exitCode, 0);
  assert.ok(stdout.includes('SPARK:'));
  assert.ok(stdout.includes('SOGNI:'));
  assert.ok(stdout.includes('100'));
});

test('--balance does not require a prompt', () => {
  const { exitCode, stdout } = runCli(['--json', '--balance']);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.type, 'balance');
});

// --- Sogni Unlimited plan awareness -------------------------------------------

test('--balance --json includes account username and subscription state', () => {
  const { exitCode, stdout } = runCli(['--json', '--balance'], {
    SOGNI_AGENT_TEST_SUBSCRIPTION_JSON: JSON.stringify({ active: true, status: 'active', tier: 'unlimited' }),
    SOGNI_AGENT_TEST_ACCOUNT_INFO_JSON: JSON.stringify({ username: 'krunkosaurus', network: 'fast', isUnlimited: true })
  });
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.username, 'krunkosaurus');
  assert.deepEqual(payload.subscription, { active: true, status: 'active', tier: 'unlimited' });
});

test('--balance human output shows account and plan lines', () => {
  const { exitCode, stdout } = runCli(['--balance'], {
    SOGNI_AGENT_TEST_SUBSCRIPTION_JSON: JSON.stringify({ active: true, status: 'active', tier: 'unlimited' })
  });
  assert.equal(exitCode, 0);
  assert.ok(stdout.includes('Account: stub-user'), `expected account line, got: ${stdout}`);
  assert.ok(stdout.includes('Plan: Sogni Unlimited (active)'), `expected plan line, got: ${stdout}`);
  assert.ok(stdout.includes('SPARK:'));
});

test('--balance human output shows Plan: none without a subscription', () => {
  const { exitCode, stdout } = runCli(['--balance']);
  assert.equal(exitCode, 0);
  assert.ok(stdout.includes('Plan: none'), `expected plan none line, got: ${stdout}`);
});

test('active Unlimited plan skips the zero-balance video pre-flight block', () => {
  const { exitCode, state } = runCli(['--video', 'a cinematic skyline at dusk'], {
    SOGNI_AGENT_TEST_BALANCE_JSON: JSON.stringify({ spark: 0, sogni: 0, lastUpdated: new Date().toISOString() }),
    SOGNI_AGENT_TEST_SUBSCRIPTION_JSON: JSON.stringify({ active: true, status: 'active', tier: 'unlimited' })
  });
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
});

test('inactive subscription still blocks zero-balance video renders', () => {
  const { exitCode, stdout } = runCli(['--json', '--video', 'a cinematic skyline at dusk'], {
    SOGNI_AGENT_TEST_BALANCE_JSON: JSON.stringify({ spark: 0, sogni: 0, lastUpdated: new Date().toISOString() }),
    SOGNI_AGENT_TEST_SUBSCRIPTION_JSON: JSON.stringify({ active: false, status: 'grace_period', tier: 'unlimited' })
  });
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'INSUFFICIENT_BALANCE');
});

test('--billing-mode tokens opts out of the Unlimited pre-flight skip', () => {
  const { exitCode, stdout } = runCli(['--json', '--billing-mode', 'tokens', '--video', 'a cinematic skyline at dusk'], {
    SOGNI_AGENT_TEST_BALANCE_JSON: JSON.stringify({ spark: 0, sogni: 0, lastUpdated: new Date().toISOString() }),
    SOGNI_AGENT_TEST_SUBSCRIPTION_JSON: JSON.stringify({ active: true, status: 'active', tier: 'unlimited' })
  });
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'INSUFFICIENT_BALANCE');
});

test('subscription lookup failure falls back to the balance check', () => {
  const { exitCode, stdout } = runCli(['--json', '--video', 'a cinematic skyline at dusk'], {
    SOGNI_AGENT_TEST_BALANCE_JSON: JSON.stringify({ spark: 0, sogni: 0, lastUpdated: new Date().toISOString() }),
    SOGNI_AGENT_TEST_SUBSCRIPTION_ERROR: 'subscription endpoint unavailable'
  });
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'INSUFFICIENT_BALANCE');
});

test('--billing-mode passes through to the image project config', () => {
  const { exitCode, state } = runCli(['--billing-mode', 'auto', 'a duck on a skateboard']);
  assert.equal(exitCode, 0);
  assert.equal(state?.lastImageProject?.billingMode, 'auto');
});

test('billingMode is omitted from the project config by default', () => {
  const { exitCode, state } = runCli(['a duck on a skateboard']);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject);
  assert.equal('billingMode' in state.lastImageProject, false);
});

test('--billing-mode rejects unknown values', () => {
  expectCliError(
    ['--billing-mode', 'gold', 'a duck on a skateboard'],
    '--billing-mode must be "auto", "subscription", or "tokens".'
  );
});

test('--doctor --json reports identity and the subscription plan check', () => {
  const { exitCode, stdout } = runCli(['--doctor', '--json'], {
    SOGNI_AGENT_TEST_SUBSCRIPTION_JSON: JSON.stringify({ active: true, status: 'active', tier: 'unlimited_pro' })
  });
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop());
  const byId = Object.fromEntries(payload.checks.map((check) => [check.id, check]));
  assert.equal(byId.plan.status, 'pass');
  assert.ok(byId.plan.detail.includes('Sogni Unlimited Pro'), `expected tier label, got: ${byId.plan.detail}`);
  assert.ok(byId.auth.detail.includes('user stub-user'), `expected identity in auth check, got: ${byId.auth.detail}`);
});

test('--doctor warns when there is no subscription and no token balance', () => {
  const { exitCode, stdout } = runCli(['--doctor', '--json'], {
    SOGNI_AGENT_TEST_BALANCE_JSON: JSON.stringify({ spark: 0, sogni: 0, lastUpdated: new Date().toISOString() })
  });
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop());
  const byId = Object.fromEntries(payload.checks.map((check) => [check.id, check]));
  assert.equal(byId.plan.status, 'warn');
  assert.ok(byId.plan.detail.includes('renders will fail'), `expected warn detail, got: ${byId.plan.detail}`);
});

test('json error: i2v explicit size that rounds to non-16 suggests a compatible bbox', async () => {
  const { default: sharp } = await import('sharp');
  const tmp = mkdtempSync(join(tmpdir(), 'sogni-agent-ref-'));
  const refPath = join(tmp, 'ref-587x880.png');
  await sharp({
    create: { width: 587, height: 880, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toFile(refPath);

  const { exitCode, stdout } = runCli([
    '--json',
    '--strict-size',
    '--video',
    '--workflow', 'i2v',
    '--ref', refPath,
    '--width', '1024',
    '--height', '1536',
    '--duration', '1',
    'gentle camera pan'
  ]);
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, false);
  assert.equal(payload.errorCode, 'INVALID_VIDEO_SIZE');
  assert.ok(String(payload.hint || '').includes('--width 1024 --height 1296'));
});

// --- v2v workflow tests ---

test('v2v requires --ref-video', () => {
  expectCliError(
    ['--video', '--workflow', 'v2v', '--controlnet-name', 'canny', 'a cat'],
    'v2v requires --ref-video.'
  );
});

test('v2v requires --controlnet-name', () => {
  expectCliError(
    ['--video', '--workflow', 'v2v', '--ref-video', 'video.mp4', 'a cat'],
    'v2v requires --controlnet-name'
  );
});

test('v2v rejects reference audio', () => {
  expectCliError(
    ['--video', '--workflow', 'v2v', '--ref-video', 'video.mp4', '--controlnet-name', 'canny', '--ref-audio', 'audio.m4a', 'a cat'],
    'v2v does not accept reference audio.'
  );
});

test('v2v is recognized as a valid workflow', () => {
  // Should fail due to missing --ref-video, NOT unknown workflow
  const { exitCode, stderr } = runCli(['--video', '--workflow', 'v2v', '--controlnet-name', 'canny', 'a cat']);
  assert.equal(exitCode, 1);
  assert.ok(!stderr.includes('Unknown workflow'), `Should not report unknown workflow, got: ${stderr}`);
  assert.ok(stderr.includes('v2v requires --ref-video'), `Expected v2v validation error, got: ${stderr}`);
});

test('invalid --controlnet-name returns a validation error', () => {
  expectCliError(
    ['--video', '--workflow', 'v2v', '--ref-video', 'video.mp4', '--controlnet-name', 'invalid', 'a cat'],
    'Unknown --controlnet-name "invalid"'
  );
});

test('valid --controlnet-name values are accepted (canny)', () => {
  // This should fail due to missing ref-video file, NOT controlnet validation
  const { stderr } = runCli(['--video', '--workflow', 'v2v', '--ref-video', 'nonexistent.mp4', '--controlnet-name', 'canny', 'a cat']);
  assert.ok(!stderr.includes('Unknown --controlnet-name'), `Should accept canny, got: ${stderr}`);
});

test('v2v ControlNet applies chat-derived defaults', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'v2v',
    '--ref-video', SCREENSHOT_FIXTURE,
    '--controlnet-name', 'canny',
    'stylized edges'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.controlNet.name, 'canny');
  assert.equal(state.lastVideoProject.controlNet.strength, 0.85);
  assert.equal(state.lastVideoProject.detailerStrength, 0.6);
});

test('detailer ControlNet defaults to full preservation strength', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'v2v',
    '--ref-video', SCREENSHOT_FIXTURE,
    '--controlnet-name', 'detailer',
    'enhance details'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.controlNet.name, 'detailer');
  assert.equal(state.lastVideoProject.controlNet.strength, 1.0);
  assert.equal(state.lastVideoProject.detailerStrength, undefined);
});

test('LTX i2v with first and end frames auto-attaches transition LoRA', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'i2v',
    '-m', 'ltx23',
    '--ref', SCREENSHOT_FIXTURE,
    '--ref-end', SCREENSHOT_FIXTURE,
    'morph the opening frame into the final frame'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_i2v_distilled');
  assert.deepEqual(state.lastVideoProject.loras, ['transition']);
  assert.deepEqual(state.lastVideoProject.loraStrengths, [1]);
  assert.match(state.lastVideoProject.positivePrompt, /\bzhuanchang\b/);
});

test('LTX v2v outpaint forwards IC-LoRA control and positional canvas options', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'v2v',
    '-m', 'ltx23',
    '--ref-video', SCREENSHOT_FIXTURE,
    '--control-type', 'outpaint',
    '--outpaint-position', 'right',
    '--outpaint-aspect-ratio', '16:9',
    'extend the street scene into the new area'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_v2v_distilled');
  assert.deepEqual(state.lastVideoProject.controlNet, { name: 'outpaint', strength: 1.0 });
  assert.equal(state.lastVideoProject.outpaintPosition, 'right');
  assert.equal(state.lastVideoProject.detailerStrength, undefined);
  assert.equal(state.lastVideoProject.width % 64, 0);
  assert.equal(state.lastVideoProject.height % 64, 0);
});

test('LTX v2v inpaint forwards mask image without detailer sidecar', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'v2v',
    '-m', 'ltx23',
    '--ref-video', SCREENSHOT_FIXTURE,
    '--control-type', 'inpaint',
    '--mask', SCREENSHOT_FIXTURE,
    'make the masked region clean'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(state.lastVideoProject.modelId, 'ltx23-22b-fp8_v2v_distilled');
  assert.deepEqual(state.lastVideoProject.controlNet, { name: 'inpaint', strength: 1.0 });
  assert.ok(state.lastVideoProject.referenceMask, 'referenceMask was forwarded');
  assert.equal(state.lastVideoProject.detailerStrength, undefined);
});

test('LTX v2v inpaint requires a direct CLI mask image', () => {
  expectCliError(
    [
      '--video',
      '--workflow', 'v2v',
      '-m', 'ltx23',
      '--ref-video', SCREENSHOT_FIXTURE,
      '--control-type', 'inpaint',
      'make the masked region clean'
    ],
    'LTX-2.3 v2v inpaint requires --mask'
  );
});

test('audio and video start offsets are passed to video projects', () => {
  const audioRun = runCli([
    '--video',
    '--ref-audio', SCREENSHOT_FIXTURE,
    '--audio-start', '3.5',
    '--audio-duration', '8',
    'abstract visualizer'
  ]);
  assert.equal(audioRun.exitCode, 0);
  assert.equal(audioRun.state.lastVideoProject.audioStart, 3.5);
  assert.equal(audioRun.state.lastVideoProject.audioDuration, 8);

  const videoRun = runCli([
    '--video',
    '--workflow', 'v2v',
    '--ref-video', SCREENSHOT_FIXTURE,
    '--video-start', '12.25',
    '--controlnet-name', 'pose',
    'robot dance'
  ]);
  assert.equal(videoRun.exitCode, 0);
  assert.equal(videoRun.state.lastVideoProject.videoStart, 12.25);
});

test('--sam2-coordinates is only supported with animate-replace', () => {
  expectCliError(
    ['--video', '--workflow', 't2v', '--sam2-coordinates', '100,200', 'a cat'],
    '--sam2-coordinates is only supported with animate-replace'
  );
});

test('--trim-end-frame flag is recognized', () => {
  // Should not fail with unknown option
  const { stderr } = runCli(['--video', '--trim-end-frame', 'a cat']);
  assert.ok(!stderr.includes('Unknown option: --trim-end-frame'), `Should recognize --trim-end-frame, got: ${stderr}`);
});

test('--first-frame-strength and --last-frame-strength flags are recognized', () => {
  const { stderr } = runCli(['--video', '--first-frame-strength', '0.6', '--last-frame-strength', '0.8', 'a cat']);
  assert.ok(!stderr.includes('Unknown option'), `Should recognize frame strength flags, got: ${stderr}`);
});

test('--controlnet-strength flag is recognized', () => {
  const { stderr } = runCli(['--video', '--workflow', 'v2v', '--ref-video', 'vid.mp4', '--controlnet-name', 'canny', '--controlnet-strength', '0.7', 'a cat']);
  assert.ok(!stderr.includes('Unknown option: --controlnet-strength'), `Should recognize --controlnet-strength, got: ${stderr}`);
});

// --- Utility flag tests ---

test('--extract-last-frame requires both video and output args', () => {
  expectCliError(['--extract-last-frame'], '--extract-last-frame requires a value.');
});

test('--extract-last-frame with non-existent video file returns an error', () => {
  const { exitCode, stderr } = runCli(['--extract-last-frame', '/tmp/nonexistent_video_12345.mp4', '/tmp/frame.png']);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('not found') || stderr.includes('FILE_NOT_FOUND'), `Expected file-not-found error, got: ${stderr}`);
});

test('--concat-videos requires at least 2 clips', () => {
  expectCliError(['--concat-videos', '/tmp/out.mp4', '/tmp/a.mp4'], '--concat-videos requires at least 2 clip');
});

test('--concat-videos with missing output arg returns an error', () => {
  expectCliError(['--concat-videos'], '--concat-videos (output path) requires a value.');
});

test('--concat-audio flags are recognized with concat-videos', () => {
  const { stderr } = runCli([
    '--concat-videos', '/tmp/out.mp4', '/tmp/missing-a.mp4', '/tmp/missing-b.mp4',
    '--concat-audio', '/tmp/music.mp3',
    '--concat-audio-start', '2.5'
  ]);
  assert.ok(!stderr.includes('Unknown option'), `Should recognize concat audio flags, got: ${stderr}`);
});

test('--concat-fps is recognized with concat-videos', () => {
  const { stderr } = runCli([
    '--concat-videos', '/tmp/out.mp4', '/tmp/missing-a.mp4', '/tmp/missing-b.mp4',
    '--concat-fps', '30'
  ]);
  assert.ok(!stderr.includes('Unknown option'), `Should recognize --concat-fps, got: ${stderr}`);
});

test('--extract-first-frame requires both video and output args', () => {
  expectCliError(['--extract-first-frame'], '--extract-first-frame requires a value.');
});

test('--extract-first-frame with non-existent video file returns an error', () => {
  const { exitCode, stderr } = runCli(['--extract-first-frame', '/tmp/nonexistent_video_98765.mp4', '/tmp/frame.png']);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('not found') || stderr.includes('FILE_NOT_FOUND'), `Expected file-not-found error, got: ${stderr}`);
});

test('--extract-frame-at requires video, timestamp, and output arguments', () => {
  expectCliError(['--extract-frame-at', '/tmp/video.mp4'], '--extract-frame-at (seconds) requires a value.');
});

test('--extract-frame-at rejects a negative timestamp', () => {
  expectCliError(
    ['--extract-frame-at', '/tmp/video.mp4', '-1', '/tmp/frame.png'],
    '--extract-frame-at (seconds) must be >= 0.'
  );
});

test('--extract-frame-at with non-existent video file returns an error', () => {
  const { exitCode, stderr } = runCli([
    '--extract-frame-at', '/tmp/nonexistent_video_at_98765.mp4', '1.5', '/tmp/frame.png'
  ]);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('not found') || stderr.includes('FILE_NOT_FOUND'), `Expected file-not-found error, got: ${stderr}`);
});

test('--verify-video with non-existent video file returns an error', () => {
  const { exitCode, stderr } = runCli(['--verify-video', '/tmp/nonexistent_verify_video_98765.mp4']);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('not found') || stderr.includes('FILE_NOT_FOUND'), `Expected file-not-found error, got: ${stderr}`);
});

test('--remix-audio requires both input and output args', () => {
  expectCliError(['--remix-audio'], '--remix-audio (input video) requires a value.');
});

test('--remix-audio with non-existent input returns an error', () => {
  const { exitCode, stderr } = runCli(['--remix-audio', '/tmp/nonexistent_video_55555.mp4', '/tmp/out.mp4']);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('not found') || stderr.includes('FILE_NOT_FOUND'), `Expected file-not-found error, got: ${stderr}`);
});

test('--remix-audio audio flags are recognized', () => {
  const { stderr } = runCli([
    '--remix-audio', '/tmp/missing-in.mp4', '/tmp/out.mp4',
    '--bed-audio', '/tmp/bed.mp3',
    '--audio-loop',
    '--audio-fade-in', '1.5',
    '--audio-fade-out', '2',
    '--mix-audio', '/tmp/mix.mp3',
    '--mix-at', '18.01',
    '--mix-gain', '-3'
  ]);
  assert.ok(!stderr.includes('Unknown option'), `Should recognize remix-audio flags, got: ${stderr}`);
});

test('--list-media with valid type is recognized', () => {
  const { exitCode, stderr } = runCli(['--json', '--list-media', 'images']);
  assert.equal(exitCode, 0);
  assert.ok(!stderr.includes('Unknown option'), `Should recognize --list-media, got: ${stderr}`);
});

test('--list-media defaults to images when no type given', () => {
  const { exitCode, stdout } = runCli(['--json', '--list-media']);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.type, 'list-media');
  assert.equal(payload.mediaType, 'images');
});

test('--list-media with audio type is recognized', () => {
  const { exitCode, stdout } = runCli(['--json', '--list-media', 'audio']);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.mediaType, 'audio');
});

test('--list-media with all type is recognized', () => {
  const { exitCode, stdout } = runCli(['--json', '--list-media', 'all']);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.mediaType, 'all');
});

test('--list-media with invalid type falls back to images', () => {
  const { exitCode, stdout } = runCli(['--json', '--list-media', 'video']);
  // 'video' is not a valid type, so --list-media treats it as default (images)
  // and 'video' becomes the prompt
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, true);
  assert.equal(payload.mediaType, 'images');
});

test('new utility flags appear in --help output', () => {
  const { exitCode, stdout } = runCli(['--help']);
  assert.equal(exitCode, 0);
  assert.ok(stdout.includes('--extract-last-frame'), 'Help should include --extract-last-frame');
  assert.ok(stdout.includes('--concat-videos'), 'Help should include --concat-videos');
  assert.ok(stdout.includes('--extract-first-frame'), 'Help should include --extract-first-frame');
  assert.ok(stdout.includes('--extract-frame-at'), 'Help should include --extract-frame-at');
  assert.ok(stdout.includes('--verify-video'), 'Help should include --verify-video');
  assert.ok(stdout.includes('--remix-audio'), 'Help should include --remix-audio');
  assert.ok(stdout.includes('--list-media'), 'Help should include --list-media');
  assert.ok(stdout.includes('--list-models'), 'Help should include --list-models');
  assert.ok(stdout.includes('--search-models'), 'Help should include --search-models');
  assert.ok(stdout.includes('--model-media'), 'Help should include --model-media');
  assert.ok(stdout.includes('--model-network'), 'Help should include --model-network');
  assert.ok(stdout.includes('--model-tag'), 'Help should include --model-tag');
  assert.ok(stdout.includes('--api-chat'), 'Help should include --api-chat');
  assert.ok(stdout.includes('--api-workflow'), 'Help should include --api-workflow');
  assert.ok(stdout.includes('--generate-audio'), 'Help should include --generate-audio');
  assert.ok(stdout.includes('--expand-prompt'), 'Help should include --expand-prompt');
  assert.ok(
    stdout.includes('sogni-agent --video \'A narrator says "welcome to the story" as ocean waves crash\''),
    'Help should show a shell-safe quoted dialogue example'
  );
  assert.ok(
    stdout.includes('sogni-agent --video --reference-audio-identity voice.webm \'NARRATOR: "This is my voice."\''),
    'Help should show a shell-safe quoted voice identity example'
  );
});

// --- Phase-2 audit fixes: count cap, --last envelope, -- separator hint,
// --- inline-# credentials warning, media inbound fallback -------------------

test('-n above the safety cap is rejected with a SOGNI_MAX_COUNT hint', () => {
  const { exitCode, stdout, stderr } = runCli(['--json', '-n', '17', 'a cat']);
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop());
  assert.equal(payload.success, false);
  assert.equal(payload.errorCode, 'COUNT_LIMIT_EXCEEDED');
  assert.ok(/SOGNI_MAX_COUNT/.test(`${payload.hint}${stderr}`), 'hint should mention SOGNI_MAX_COUNT');
});

test('-n within the default cap is accepted', () => {
  const { exitCode, state } = runCli(['-n', '16', 'a cat']);
  assert.equal(exitCode, 0);
  assert.equal(state.lastImageProject.numberOfMedia, 16);
});

test('SOGNI_MAX_COUNT raises the -n cap deliberately', () => {
  const { exitCode, state } = runCli(['-n', '17', 'a cat'], { SOGNI_MAX_COUNT: '32' });
  assert.equal(exitCode, 0);
  assert.equal(state.lastImageProject.numberOfMedia, 17);
});

test('openclaw config defaultCount is clamped to the safety cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-openclaw-config-'));
  const configPath = join(dir, 'openclaw.json');
  writeFileSync(configPath, JSON.stringify({
    plugins: {
      entries: {
        'sogni-creative-agent-skill': {
          enabled: true,
          config: { defaultCount: 50 }
        }
      }
    }
  }));
  const { exitCode, state } = runCli(['a cat'], { OPENCLAW_CONFIG_PATH: configPath });
  assert.equal(exitCode, 0);
  assert.equal(state.lastImageProject.numberOfMedia, 16, 'config count above cap should clamp to 16');
});

test('--last --json with no previous render returns a structured failure', () => {
  const { exitCode, stdout } = runCli(['--last', '--json']);
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop());
  assert.equal(payload.success, false);
  assert.equal(payload.errorCode, 'NO_LAST_RENDER');
});

test('--last --json wraps the record in a success envelope (order-independent)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-last-render-'));
  const lastRenderPath = join(dir, 'last-render.json');
  writeFileSync(lastRenderPath, JSON.stringify({ type: 'image', urls: ['https://example.com/x.png'] }));
  // --last appears BEFORE --json on purpose: envelope must still apply.
  const { exitCode, stdout } = runCli(['--last', '--json'], { SOGNI_LAST_RENDER_PATH: lastRenderPath });
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop());
  assert.equal(payload.success, true);
  assert.equal(payload.type, 'image');
  assert.deepEqual(payload.urls, ['https://example.com/x.png']);
});

test('--last without --json still prints the raw record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-last-render-'));
  const lastRenderPath = join(dir, 'last-render.json');
  writeFileSync(lastRenderPath, JSON.stringify({ type: 'image', urls: [] }, null, 2));
  const { exitCode, stdout } = runCli(['--last'], { SOGNI_LAST_RENDER_PATH: lastRenderPath });
  assert.equal(exitCode, 0);
  assert.ok(stdout.includes('"type": "image"'), `raw record expected, got: ${stdout}`);
});

test('unknown option hint explains the -- separator for leading-dash prompts', () => {
  const { exitCode, stderr } = runCli(['-isometric robot']);
  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('"--" separator'), `hint should mention the -- separator, got: ${stderr}`);
});

test('a leading-dash prompt works after a standalone -- separator', () => {
  const { exitCode, state } = runCli(['--', '-5 degrees outside, frozen lake']);
  assert.equal(exitCode, 0);
  assert.equal(state.lastImageProject.positivePrompt, '-5 degrees outside, frozen lake');
});

test('credentials file: inline " #" in the value triggers a warning but is preserved', () => {
  const { exitCode, state, stderr } = runCli(['a cat'], withCredentialsFile('SOGNI_API_KEY=abc123 # my key\n'));
  assert.equal(exitCode, 0);
  assert.equal(state?.clientConfigs?.[0]?.apiKey, 'abc123 # my key');
  assert.ok(/inline comments are not stripped/i.test(stderr), `expected inline-comment warning, got: ${stderr}`);
});

test('--list-media falls back to the legacy ~/.clawdbot inbound dir when only it exists', () => {
  const home = mkdtempSync(join(tmpdir(), 'sogni-home-legacy-'));
  const legacyDir = join(home, '.clawdbot', 'media', 'inbound');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, 'legacy-photo.png'), 'x');
  const { exitCode, stdout } = runCli(['--json', '--list-media'], { HOME: home, USERPROFILE: home });
  assert.equal(exitCode, 0);
  assert.ok(stdout.includes('legacy-photo.png'), `legacy inbound file should be listed, got: ${stdout}`);
});

test('--list-media prefers ~/.openclaw inbound dir when present', () => {
  const home = mkdtempSync(join(tmpdir(), 'sogni-home-openclaw-'));
  const openclawDir = join(home, '.openclaw', 'media', 'inbound');
  const legacyDir = join(home, '.clawdbot', 'media', 'inbound');
  mkdirSync(openclawDir, { recursive: true });
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(openclawDir, 'current-photo.png'), 'x');
  writeFileSync(join(legacyDir, 'legacy-photo.png'), 'x');
  const { exitCode, stdout } = runCli(['--json', '--list-media'], { HOME: home, USERPROFILE: home });
  assert.equal(exitCode, 0);
  assert.ok(stdout.includes('current-photo.png'), `openclaw inbound file should be listed, got: ${stdout}`);
  assert.ok(!stdout.includes('legacy-photo.png'), 'legacy dir should be ignored when the openclaw dir exists');
});

// --- doctor / upgrade UX -----------------------------------------------------

test('--doctor --json reports healthy on a working install', () => {
  const { exitCode, stdout } = runCli(['--doctor', '--json']);
  assert.equal(exitCode, 0);
  const payload = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop());
  assert.equal(payload.success, true);
  assert.equal(payload.type, 'doctor');
  const byId = Object.fromEntries(payload.checks.map((check) => [check.id, check]));
  assert.equal(byId.node.status, 'pass');
  assert.equal(byId.credentials.status, 'pass');
  assert.equal(byId.auth.status, 'pass');
  assert.equal(byId['config-dir'].status, 'pass');
});

test('doctor subcommand form works without dashes', () => {
  const { exitCode, stdout } = runCli(['doctor']);
  assert.equal(exitCode, 0);
  assert.ok(stdout.includes('Result: healthy'), `expected healthy result, got: ${stdout}`);
});

test('--doctor fails with a rejected API key and points at the dashboard', () => {
  const { exitCode, stdout } = runCli(['--doctor', '--json'], { SOGNI_AGENT_TEST_CONNECT_REST_401: '1' });
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop());
  assert.equal(payload.success, false);
  const auth = payload.checks.find((check) => check.id === 'auth');
  assert.equal(auth.status, 'fail');
  assert.ok(auth.detail.includes('dashboard.sogni.ai'));
});

test('--doctor without credentials marks credentials failed and skips auth', () => {
  const { exitCode, stdout } = runCli(['--doctor', '--json'], {
    SOGNI_API_KEY: '',
    SOGNI_CREDENTIALS_PATH: '/nonexistent/credentials'
  });
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop());
  assert.equal(payload.success, false);
  const byId = Object.fromEntries(payload.checks.map((check) => [check.id, check]));
  assert.equal(byId.credentials.status, 'fail');
  assert.equal(byId.auth.status, 'skip');
});

test('--whats-new prints the current version changelog entry', () => {
  const { exitCode, stdout } = runCli(['--whats-new']);
  assert.equal(exitCode, 0);
  assert.ok(stdout.includes(PACKAGE_VERSION), `expected ${PACKAGE_VERSION} entry, got: ${stdout.slice(0, 200)}`);
});

test('--snooze-update with no pending update is a friendly no-op', () => {
  const { exitCode, stderr } = runCli(['--snooze-update']);
  assert.equal(exitCode, 0);
  assert.ok(stderr.includes('No pending update to snooze.'), `got: ${stderr}`);
});
