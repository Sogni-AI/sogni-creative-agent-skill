import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareSemver,
  detectPackageManager,
  shouldSkipForEnvironment,
  formatUpdateNotice,
  readState,
  writeState,
  clearState,
  runForegroundCheck,
  maybeSpawnBackgroundCheck,
  getQueuedNotice,
  INTERNAL_FLAG,
  PACKAGE_NAME,
} from '../update-check.mjs';

function makeStatePath() {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-update-check-'));
  return join(dir, 'update-check.json');
}

const TTY_STDERR = { isTTY: true };
const PIPE_STDERR = { isTTY: false };

test('compareSemver — basic ordering', () => {
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
  assert.equal(compareSemver('1.2.3', '1.2.4'), -1);
  assert.equal(compareSemver('1.2.4', '1.2.3'), 1);
  assert.equal(compareSemver('2.0.0', '1.99.99'), 1);
  assert.equal(compareSemver('1.10.0', '1.9.9'), 1);
});

test('compareSemver — prereleases sort below releases', () => {
  assert.equal(compareSemver('1.2.3-beta.1', '1.2.3'), -1);
  assert.equal(compareSemver('1.2.3', '1.2.3-beta.1'), 1);
  assert.equal(compareSemver('1.2.3-alpha', '1.2.3-beta'), -1);
});

test('compareSemver — invalid inputs return 0', () => {
  assert.equal(compareSemver('not-a-version', '1.0.0'), 0);
  assert.equal(compareSemver('1.0', '1.0.0'), 0);
});

test('detectPackageManager — npm default', () => {
  const { manager, installCmd } = detectPackageManager({});
  assert.equal(manager, 'npm');
  assert.match(installCmd, /^npm install -g /);
  assert.ok(installCmd.endsWith(PACKAGE_NAME));
});

test('detectPackageManager — pnpm / yarn / bun', () => {
  assert.equal(detectPackageManager({ npm_config_user_agent: 'pnpm/9.5.0 node/v22 linux x64' }).manager, 'pnpm');
  assert.match(detectPackageManager({ npm_config_user_agent: 'pnpm/9.5.0' }).installCmd, /^pnpm add -g /);
  assert.equal(detectPackageManager({ npm_config_user_agent: 'yarn/4.3.0 npm/?' }).manager, 'yarn');
  assert.match(detectPackageManager({ npm_config_user_agent: 'yarn/4.3.0' }).installCmd, /^yarn global add /);
  assert.equal(detectPackageManager({ npm_config_user_agent: 'bun/1.1.20 linux x64' }).manager, 'bun');
  assert.match(detectPackageManager({ npm_config_user_agent: 'bun/1.1.20' }).installCmd, /^bun add -g /);
});

test('shouldSkipForEnvironment — opt-outs', () => {
  assert.equal(shouldSkipForEnvironment({ argv: ['node', 'cli', '--no-update-check'], env: {}, stderr: TTY_STDERR }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { SOGNI_NO_UPDATE_CHECK: '1' }, stderr: TTY_STDERR }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { NO_UPDATE_NOTIFIER: '1' }, stderr: TTY_STDERR }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { CI: 'true' }, stderr: TTY_STDERR }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { SOGNI_AGENT_TEST_STATE_PATH: '/tmp/x' }, stderr: TTY_STDERR }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { OPENCLAW_PLUGIN_CONFIG: '{}' }, stderr: TTY_STDERR }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { NODE_ENV: 'test' }, stderr: TTY_STDERR }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { npm_lifecycle_event: 'test' }, stderr: TTY_STDERR }), true);
  assert.equal(shouldSkipForEnvironment({ argv: ['node', 'cli', '--json'], env: {}, stderr: TTY_STDERR }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: {}, stderr: PIPE_STDERR }), true);
});

test('shouldSkipForEnvironment — runs in interactive TTY', () => {
  const result = shouldSkipForEnvironment({
    argv: ['node', 'cli'],
    env: {},
    stderr: TTY_STDERR,
    cliPath: '/usr/local/bin/sogni-agent',
  });
  assert.equal(result, false);
});

test('formatUpdateNotice — contains current/latest/install command', () => {
  const notice = formatUpdateNotice({
    currentVersion: '3.1.1',
    latestVersion: '3.1.2',
    installCmd: `npm install -g ${PACKAGE_NAME}`,
    useColor: false,
  });
  assert.match(notice, /3\.1\.1/);
  assert.match(notice, /3\.1\.2/);
  assert.match(notice, new RegExp(`npm install -g ${PACKAGE_NAME.replace(/[/@-]/g, '.')}`));
  assert.match(notice, /sogni-agent self-update/);
  assert.match(notice, /--no-update-check/);
});

test('readState / writeState / clearState round-trip', () => {
  const path = makeStatePath();
  assert.equal(readState(path), null);
  writeState(path, { lastCheckedAt: 1, lastKnownLatest: '3.2.0', currentVersion: '3.1.1' });
  const state = readState(path);
  assert.deepEqual(state, { lastCheckedAt: 1, lastKnownLatest: '3.2.0', currentVersion: '3.1.1' });
  clearState(path);
  assert.equal(existsSync(path), false);
  assert.equal(readState(path), null);
});

test('readState — malformed JSON returns null without throwing', () => {
  const path = makeStatePath();
  writeFileSync(path, '{not json');
  assert.equal(readState(path), null);
});

test('runForegroundCheck — happy path writes latest version', async () => {
  const path = makeStatePath();
  const fakeFetcher = async () => '4.0.0';
  await runForegroundCheck({
    currentVersion: '3.1.1',
    statePath: path,
    fetcher: fakeFetcher,
    now: () => 12345,
  });
  const state = readState(path);
  assert.equal(state.lastCheckedAt, 12345);
  assert.equal(state.lastKnownLatest, '4.0.0');
  assert.equal(state.currentVersion, '3.1.1');
});

test('runForegroundCheck — network failure keeps prior known-latest', async () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: 1, lastKnownLatest: '3.2.0', currentVersion: '3.1.1' });
  const fakeFetcher = async () => { throw new Error('offline'); };
  await runForegroundCheck({
    currentVersion: '3.1.1',
    statePath: path,
    fetcher: fakeFetcher,
    now: () => 99999,
  });
  const state = readState(path);
  assert.equal(state.lastCheckedAt, 99999, 'timestamp refreshed');
  assert.equal(state.lastKnownLatest, '3.2.0', 'prior latest preserved');
});

test('maybeSpawnBackgroundCheck — skipped when env opts out', () => {
  let spawned = 0;
  const fakeSpawn = () => { spawned++; return { on() {}, unref() {} }; };
  const result = maybeSpawnBackgroundCheck({
    cliPath: '/usr/local/bin/sogni-agent',
    statePath: makeStatePath(),
    env: { CI: 'true' },
    spawnFn: fakeSpawn,
  });
  assert.equal(result, 'skipped');
  assert.equal(spawned, 0);
});

test('maybeSpawnBackgroundCheck — fresh when within throttle window', () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: 1000, lastKnownLatest: '3.1.1', currentVersion: '3.1.1' });
  let spawned = 0;
  const fakeSpawn = () => { spawned++; return { on() {}, unref() {} }; };
  const result = maybeSpawnBackgroundCheck({
    cliPath: '/usr/local/bin/sogni-agent',
    statePath: path,
    throttleMs: 60_000,
    now: () => 30_000,
    env: {},
    spawnFn: fakeSpawn,
  });
  assert.equal(result, 'fresh');
  assert.equal(spawned, 0);
});

test('maybeSpawnBackgroundCheck — spawns when stale', () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: 1000, lastKnownLatest: '3.1.1', currentVersion: '3.1.1' });
  let spawnedWith = null;
  const fakeSpawn = (cmd, args, opts) => {
    spawnedWith = { cmd, args, opts };
    return { on() {}, unref() {} };
  };
  const result = maybeSpawnBackgroundCheck({
    cliPath: '/usr/local/bin/sogni-agent',
    statePath: path,
    throttleMs: 60_000,
    now: () => 10_000_000,
    env: {},
    spawnFn: fakeSpawn,
    execPath: '/usr/bin/node',
  });
  assert.equal(result, 'spawned');
  assert.equal(spawnedWith.cmd, '/usr/bin/node');
  assert.deepEqual(spawnedWith.args, ['/usr/local/bin/sogni-agent', INTERNAL_FLAG]);
  assert.equal(spawnedWith.opts.detached, true);
  assert.equal(spawnedWith.opts.stdio, 'ignore');
});

test('getQueuedNotice — returns null when no state', () => {
  const path = makeStatePath();
  const result = getQueuedNotice({
    currentVersion: '3.1.1',
    statePath: path,
    env: {},
  });
  // Skipped because process.stderr isn't a TTY under the test runner.
  // We can't change that, but the function should still return null safely.
  assert.equal(result, null);
});

test('getQueuedNotice — null when env opts out even if newer version on disk', () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: Date.now(), lastKnownLatest: '99.0.0', currentVersion: '3.1.1' });
  const result = getQueuedNotice({
    currentVersion: '3.1.1',
    statePath: path,
    env: { CI: 'true' },
  });
  assert.equal(result, null);
});
