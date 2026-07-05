import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Verbatim TINY_PNG constant from test/desktop-extension.test.mjs
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// House CLI harness — mirrors test/sogni-agent.test.mjs (spawn via the loader
// that stubs the Sogni SDK import, hermetic env, temp HOME). Plan-only mode
// never touches the network, but the env/stub conventions still apply.
function prepareCliRun(envOverrides = {}) {
  const tempHome = mkdtempSync(join(tmpdir(), 'sogni-reel-test-'));
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
    NODE_NO_WARNINGS: '1',
  };
  Object.assign(env, envOverrides);
  return { env, loaderPath, cliPath };
}

function runCli(args, envOverrides = {}) {
  const { env, loaderPath, cliPath } = prepareCliRun(envOverrides);
  const result = spawnSync(
    process.execPath,
    ['--loader', loaderPath, cliPath, ...args],
    { env, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

function reelDir(count = 2) {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-reel-'));
  for (let i = 0; i < count; i++) writeFileSync(join(dir, `img-${i}.png`), TINY_PNG);
  return dir;
}

test('--source-reel --reel-plan-only prints a plan naming every image, without rendering', async () => {
  const dir = reelDir(3);
  const r = runCli(['--source-reel', dir, '--reel-plan-only', '--no-update-check']);
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  for (const f of ['img-0.png', 'img-1.png', 'img-2.png']) {
    assert.ok(r.stdout.includes(f), `plan must name ${f}\n${r.stdout}`);
  }
  assert.match(r.stdout, /transition/i);
  // Plan-only must not render: no "complete" / stitching messaging.
  assert.doesNotMatch(r.stdout, /SourceReel complete/);
  assert.match(r.stdout, /without --reel-plan-only to render/i);
});

test('plan-only respects --no-reel-loop (no final last->first transition)', async () => {
  const dir = reelDir(2);
  const looped = runCli(['--source-reel', dir, '--reel-plan-only', '--no-update-check']);
  const unlooped = runCli(['--source-reel', dir, '--reel-plan-only', '--no-reel-loop', '--no-update-check']);
  assert.equal(looped.exitCode, 0, `stderr: ${looped.stderr}`);
  assert.equal(unlooped.exitCode, 0, `stderr: ${unlooped.stderr}`);
  // Count planned transition entries via the "NN-to-NN" key format the plan prints.
  const keyCount = (s) => (s.match(/\d{2}-to-\d{2}/g) ?? []).length;
  assert.equal(keyCount(looped.stdout), 2, 'looped 2-image reel plans 2 transitions');
  assert.equal(keyCount(unlooped.stdout), 1, 'unlooped 2-image reel plans 1 transition');
  assert.ok(keyCount(looped.stdout) > keyCount(unlooped.stdout), 'loop plan has one more transition');
  assert.match(looped.stdout, /Loop last.*first: yes/i);
  assert.match(unlooped.stdout, /Loop last.*first: no/i);
});

test('--source-reel with a missing folder fails with a helpful error', async () => {
  const r = runCli(['--source-reel', '/nonexistent/reel-folder', '--reel-plan-only', '--no-update-check']);
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr + r.stdout, /folder|directory|not found|no such/i);
});

// DEVIATION from the brief sketch: the recovered implementation PERMITS a
// single-image folder (buildSourceReelPlan only fatals on ZERO images; a
// 1-image reel simply plans zero transitions). Pinning the actual behavior.
test('--source-reel with a single image is allowed and plans zero transitions', async () => {
  const dir = reelDir(1);
  const r = runCli(['--source-reel', dir, '--reel-plan-only', '--no-update-check']);
  assert.equal(r.exitCode, 0, `single-image reel should be allowed; stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes('img-0.png'), `plan must name the single image\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /\d{2}-to-\d{2}/, 'no transition keys for a single-image reel');
});

test('--source-reel with an empty folder fails with a helpful error', async () => {
  const dir = reelDir(0);
  const r = runCli(['--source-reel', dir, '--reel-plan-only', '--no-update-check']);
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr + r.stdout, /no source images|supported/i);
});

test('--reel-plan-only --json emits a machine-readable plan', async () => {
  const dir = reelDir(2);
  const r = runCli(['--source-reel', dir, '--reel-plan-only', '--json', '--no-update-check']);
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  const plan = JSON.parse(line);
  assert.equal(plan.success, true);
  assert.equal(plan.type, 'source-reel');
  assert.equal(plan.clips.length, 2);
  assert.equal(plan.transitions.length, 2);
});
