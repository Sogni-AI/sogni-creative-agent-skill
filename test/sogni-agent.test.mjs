import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SEEDANCE_STORYBOARD_REFERENCE_PROMPT } from '../generated/creative-agent-runtime.mjs';

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
      if (req.url === '/v1/creative-agent/workflows' && req.method === 'POST') {
        res.statusCode = 201;
        res.end(JSON.stringify({
          status: 'success',
          data: {
            workflow: { workflowId: 'wf_test', kind: parsedBody?.kind || 'image_to_video', status: 'queued', artifacts: [] }
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
  assert.equal(state.lastAudioProject.modelId, 'ace_step_1.5_turbo');
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
  assert.equal(state.lastAudioProject.modelId, 'ace_step_1.5_sft');
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
    '--ref-video', SCREENSHOT_FIXTURE,
    'make the clip more cinematic'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'seedance-2-0');
  assert.equal(state.lastVideoProject.referenceVideo != null, true);
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
    '--ref-audio', 'https://example.com/music.m4a',
    'Use @Image1 for product identity, @Video1 for motion, and @Audio1 for rhythm.'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  assert.equal(state.lastVideoProject.modelId, 'seedance-2-0');
  assert.equal(state.lastVideoProject.fps, 24);
  assert.deepEqual(state.lastVideoProject.referenceImageUrls, ['https://example.com/product.png']);
  assert.deepEqual(state.lastVideoProject.referenceVideoUrls, ['https://example.com/motion.mp4']);
  assert.deepEqual(state.lastVideoProject.referenceAudioUrls, ['https://example.com/music.m4a']);
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

test('seedance rejects audio-only references before wrapper validation', () => {
  expectCliError(
    ['--video', '--workflow', 't2v', '-m', 'seedance2', '--ref-audio', 'https://cdn.example.com/music.m4a', 'music-led clip'],
    'Seedance audio references require --ref or --ref-video.'
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

test('video rejects lora options', () => {
  expectCliError(['--video', '--lora', 'foo', 'a cat'], '--lora options are image-only.');
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

test('--api-chat posts to /v1/chat/completions with rich creative-agent tools', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      'Create a 4-shot product video concept for a red sneaker'
    ], {
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
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
    assert.equal(request.body.sogni_tools, 'creative-agent');
    assert.equal(request.body.sogni_tool_execution, true);
    assert.equal(request.body.token_type, 'spark');
    assert.equal(request.body.appSource, 'sogni-creative-agent-skill');
    assert.equal(request.body.messages[1].content, 'Create a 4-shot product video concept for a red sneaker');
  });
});

test('--api-chat rejects loopback api base without explicit unsafe opt-in before sending credentials', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-chat',
      '--api-base-url', apiBaseUrl,
      '--json',
      'Create a product video concept'
    ], {
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
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
    SOGNI_USERNAME: '',
    SOGNI_PASSWORD: '',
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
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.body.sogni_tool_execution, true);
    assert.equal(request.body.api_media_references[0].flag, '--ref');
    assert.equal(request.body.api_media_references[0].kind, 'image');
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
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.body.api_media_references.length, 2);
    assert.equal(request.body.api_media_references[0].kind, 'audio');
    assert.equal(request.body.api_media_references[1].kind, 'video');
    assert.match(request.body.messages[1].content, /API media references:/);
    assert.match(request.body.messages[1].content, /music\.mp3/);
    assert.match(request.body.messages[1].content, /source\.mp4/);
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
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.api_media_references[0].kind, 'video');
    assert.match(requests[0].body.messages[1].content, /Describe the attached media/);
    assert.match(requests[0].body.messages[1].content, /source\.mp4/);
  });
});

test('--api-workflow starts durable image-to-video workflow through /v1/creative-agent/workflows', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow', 'image-to-video',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--video-prompt', 'The camera slowly pushes in as the sketch comes alive',
      '--width', '1024',
      '--height', '576',
      '--duration', '5',
      'A graphite robot sketch on a drafting table'
    ], {
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
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
    assert.equal(request.body.kind, 'image_to_video');
    assert.equal(request.body.token_type, 'spark');
    assert.equal(request.body.appSource, 'sogni-creative-agent-skill');
    assert.equal(request.body.input.prompt, 'A graphite robot sketch on a drafting table');
    assert.equal(request.body.input.videoPrompt, 'The camera slowly pushes in as the sketch comes alive');
    assert.equal(request.body.input.width, 1024);
    assert.equal(request.body.input.height, 576);
    assert.equal(request.body.input.duration, 5);
  });
});

test('--api-workflow creative-plan forwards shared plan for API compilation', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const plan = {
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
      '--api-workflow', 'creative-plan',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--workflow-input', JSON.stringify(plan)
    ], {
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.workflowKind, 'creative_plan');
    assert.equal(payload.workflow.kind, 'creative_plan');

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.url, '/v1/creative-agent/workflows');
    assert.equal(request.method, 'POST');
    assert.equal(request.body.kind, 'creative_plan');
    assert.equal(request.body.token_type, 'spark');
    assert.equal(request.body.appSource, 'sogni-creative-agent-skill');
    assert.deepEqual(request.body.input, plan);
    assert.equal(
      request.body.input.steps[0].toolName,
      'generate_image',
      'skill should forward the shared plan and let the API compile hosted tool names'
    );
  });
});

test('--api-workflow forwards CLI media references and cost controls', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow', 'image-to-video',
      '--api-base-url', apiBaseUrl,
      '--json',
      '--ref', SCREENSHOT_FIXTURE,
      '--workflow-max-cost', '25',
      '--confirm-cost',
      'animate this image'
    ], {
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.url, '/v1/creative-agent/workflows');
    assert.equal(request.body.api_media_references[0].flag, '--ref');
    assert.equal(request.body.api_media_references[0].kind, 'image');
    assert.equal(request.body.max_estimated_capacity_units, 25);
    assert.equal(request.body.cost_ceiling, 25);
    assert.equal(request.body.confirm_cost, true);
  });
});

test('--api-workflow uses OpenClaw cost defaults when CLI flags are omitted', async () => {
  await withTestApiServer(async (apiBaseUrl, requests) => {
    const { exitCode, stdout } = await runCliAsync([
      '--api-workflow', 'image-to-video',
      '--api-base-url', apiBaseUrl,
      '--json',
      'animate this image'
    ], {
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
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
    assert.equal(request.body.cost_ceiling, 13);
    assert.equal(request.body.confirm_cost, false);
  });
});

test('--api-workflow image-to-video rejects unsupported workflow title flag', () => {
  const { exitCode, stderr } = runCli([
    '--api-workflow', 'image-to-video',
    '--workflow-title', 'Launch sketch',
    'A graphite robot sketch on a drafting table'
  ], {
    SOGNI_USERNAME: '',
    SOGNI_PASSWORD: '',
    SOGNI_API_KEY: 'test-api-key'
  });

  assert.equal(exitCode, 1);
  assert.ok(stderr.includes('--workflow-title is currently only supported'));
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
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.trim());
    assert.equal(payload.success, true);
    assert.equal(payload.workflowKind, 'storyboard_video');
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
    assert.equal(requests[1].body.kind, 'hosted_tool_sequence');
    assert.equal(requests[1].body.idempotency_key, 'idem-storyboard-123');
    assert.equal(requests[1].body.input.title, 'Neon bakery storyboard');

    const [imageStep, videoStep] = requests[1].body.input.steps;
    assert.equal(imageStep.toolName, 'sogni_generate_image');
    assert.equal(imageStep.arguments.model, 'gpt-image-2');
    assert.equal(imageStep.arguments.gpt_image_quality, 'low');
    assert.equal(imageStep.arguments.output_format, 'png');
    assert.match(imageStep.arguments.prompt, /Create exactly 3 sequential video storyboard frames/);
    assert.match(imageStep.arguments.prompt, /Overall storyboard canvas: 2560x1440 pixels \(16:9\)/);
    assert.match(imageStep.arguments.prompt, /Target final video aspect ratio: 9:16/);

    assert.equal(videoStep.toolName, 'sogni_generate_video');
    assert.equal(videoStep.arguments.model, 'seedance2');
    assert.equal(videoStep.arguments.expand_prompt, false);
    assert.equal(videoStep.arguments.generate_audio, true);
    assert.match(videoStep.arguments.prompt, /@Image1: approved GPT Image 2 storyboard board/);
    assert.match(videoStep.arguments.prompt, /not as a collage, split-screen, grid/);
    assert.deepEqual(videoStep.dependsOn, [{
      sourceStepId: 'storyboard_image',
      sourceArtifactIndex: 0,
      targetArgument: 'reference_image_url',
      mediaType: 'image',
      transform: 'artifact_url',
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
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
      SOGNI_API_KEY: 'test-api-key',
      SOGNI_ALLOW_UNSAFE_API_BASE_URL: '1'
    });

    assert.equal(exitCode, 0);
    assert.match(stdout, /\[evt_1\] workflow\.status completed/);
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
  // The CLI auto-picks a compatible bounding box so the resized reference remains divisible by 16.
  assert.equal(state.lastVideoProject.width, 1296);
  assert.equal(state.lastVideoProject.height, 672);
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
  assert.equal(state.lastVideoProject.duration, 10);
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

test('api key auth is accepted when username/password are absent', () => {
  const { exitCode, state } = runCli(
    ['a cat wearing a hat'],
    {
      SOGNI_USERNAME: '',
      SOGNI_PASSWORD: '',
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

test('username/password auth is not accepted without an api key', () => {
  const { exitCode, stdout } = runCli(
    ['--json', 'a cat wearing a hat'],
    {
      SOGNI_API_KEY: '',
      SOGNI_USERNAME: 'test-user',
      SOGNI_PASSWORD: 'test-pass'
    }
  );
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.errorCode, 'MISSING_CREDENTIALS');
  assert.equal(payload.errorType, 'PERMISSION_REQUIRED');
  assert.equal(payload.errorCategory, 'permission_required');
  assert.equal(payload.retryable, false);
  assert.match(payload.hint, /SOGNI_API_KEY/);
  assert.doesNotMatch(payload.hint, /SOGNI_USERNAME|SOGNI_PASSWORD/);
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
  // CLI chooses a compatible bounding box near the WAN i2v model default.
  assert.equal(state.lastVideoProject.width, 832);
  assert.equal(state.lastVideoProject.height, 720);
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
  assert.ok(stdout.includes('--list-media'), 'Help should include --list-media');
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
