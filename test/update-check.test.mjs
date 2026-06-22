import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareSemver,
  detectPackageManager,
  formatSelfUpdatePermissionHint,
  shouldSkipForEnvironment,
  formatUpdateNotice,
  readState,
  writeState,
  clearState,
  runForegroundCheck,
  maybeSpawnBackgroundCheck,
  getQueuedNotice,
  formatAgentUpdateNotice,
  AGENT_NOTICE_THROTTLE_MS,
  snoozeUpdate,
  SNOOZE_LEVELS_MS,
  extractChangelogEntries,
  formatWhatsNew,
  runWhatsNew,
  runSelfUpdate,
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

test('formatSelfUpdatePermissionHint — platform-specific rerun guidance', () => {
  assert.match(
    formatSelfUpdatePermissionHint({ manager: 'npm', platform: 'darwin' }),
    /sudo sogni-agent self-update/
  );
  assert.match(
    formatSelfUpdatePermissionHint({ manager: 'npm', platform: 'win32' }),
    /Administrator/
  );
});

test('shouldSkipForEnvironment — hard opt-outs', () => {
  assert.equal(shouldSkipForEnvironment({ argv: ['node', 'cli', '--no-update-check'], env: {} }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { SOGNI_NO_UPDATE_CHECK: '1' } }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { NO_UPDATE_NOTIFIER: '1' } }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { CI: 'true' } }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { SOGNI_AGENT_TEST_STATE_PATH: '/tmp/x' } }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { NODE_ENV: 'test' } }), true);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { npm_lifecycle_event: 'test' } }), true);
});

test('shouldSkipForEnvironment — agent contexts are NOT hard-skipped anymore', () => {
  // Agents (non-TTY, --json, OpenClaw plugin runs) must still get update
  // notices — they relay them to the user instead of reading a TTY banner.
  assert.equal(shouldSkipForEnvironment({ argv: ['node', 'cli', '--json'], env: {}, cliPath: '/usr/local/bin/sogni-agent' }), false);
  assert.equal(shouldSkipForEnvironment({ argv: [], env: { OPENCLAW_PLUGIN_CONFIG: '{}' }, cliPath: '/usr/local/bin/sogni-agent' }), false);
});

test('shouldSkipForEnvironment — runs for an installed CLI', () => {
  const result = shouldSkipForEnvironment({
    argv: ['node', 'cli'],
    env: {},
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

const INSTALLED_CLI_PATH = '/usr/local/bin/sogni-agent';

test('getQueuedNotice — returns null when no state', () => {
  const path = makeStatePath();
  const result = getQueuedNotice({
    currentVersion: '3.1.1',
    statePath: path,
    env: {},
    stderr: TTY_STDERR,
    cliPath: INSTALLED_CLI_PATH,
  });
  assert.equal(result, null);
});

test('getQueuedNotice — null when env opts out even if newer version on disk', () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: Date.now(), lastKnownLatest: '99.0.0', currentVersion: '3.1.1' });
  const result = getQueuedNotice({
    currentVersion: '3.1.1',
    statePath: path,
    env: { CI: 'true' },
    stderr: TTY_STDERR,
    cliPath: INSTALLED_CLI_PATH,
  });
  assert.equal(result, null);
});

// --- agent-facing update notices (non-TTY contexts) ---

test('getQueuedNotice — TTY gets the interactive banner and no throttle stamp', () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: 1, lastKnownLatest: '9.0.0', currentVersion: '3.1.1' });
  const notice = getQueuedNotice({
    currentVersion: '3.1.1',
    statePath: path,
    env: {},
    stderr: TTY_STDERR,
    cliPath: INSTALLED_CLI_PATH,
    now: () => 1000,
  });
  assert.ok(notice && notice.includes('Update available'), `banner expected, got: ${notice}`);
  assert.ok(!notice.includes('[sogni-agent]'), 'TTY users get the banner, not the agent line');
  assert.equal(readState(path).lastNotifiedAt, undefined, 'TTY notices must not consume the agent throttle');
});

test('getQueuedNotice — non-TTY gets a one-line agent notice with relay instructions', () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: 1, lastKnownLatest: '9.0.0', currentVersion: '3.1.1' });
  const notice = getQueuedNotice({
    currentVersion: '3.1.1',
    statePath: path,
    env: {},
    stderr: PIPE_STDERR,
    cliPath: INSTALLED_CLI_PATH,
    now: () => 1000,
  });
  assert.ok(notice, 'agent notice expected');
  assert.ok(!notice.includes('\n'), 'agent notice must be a single line');
  assert.match(notice, /^\[sogni-agent\] Update available: 3\.1\.1 -> 9\.0\.0/);
  assert.match(notice, /self-update/);
  assert.match(notice, /--snooze-update/);
  assert.equal(readState(path).lastNotifiedAt, 1000, 'agent notice stamps the throttle');
});

test('getQueuedNotice — agent notice is throttled to once per window', () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: 1, lastKnownLatest: '9.0.0', currentVersion: '3.1.1' });
  const opts = { currentVersion: '3.1.1', statePath: path, env: {}, stderr: PIPE_STDERR, cliPath: INSTALLED_CLI_PATH };
  assert.ok(getQueuedNotice({ ...opts, now: () => 1000 }), 'first call notifies');
  assert.equal(getQueuedNotice({ ...opts, now: () => 1000 + AGENT_NOTICE_THROTTLE_MS - 1 }), null, 'within window: silent');
  assert.ok(getQueuedNotice({ ...opts, now: () => 1000 + AGENT_NOTICE_THROTTLE_MS + 1 }), 'after window: notifies again');
});

test('getQueuedNotice — --json and OpenClaw plugin contexts still receive the agent notice', () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: 1, lastKnownLatest: '9.0.0', currentVersion: '3.1.1' });
  const jsonNotice = getQueuedNotice({
    currentVersion: '3.1.1',
    statePath: path,
    env: {},
    argv: ['node', 'cli', '--json'],
    stderr: PIPE_STDERR,
    cliPath: INSTALLED_CLI_PATH,
    now: () => 1000,
  });
  assert.match(jsonNotice ?? '', /^\[sogni-agent\] Update available/);

  const path2 = makeStatePath();
  writeState(path2, { lastCheckedAt: 1, lastKnownLatest: '9.0.0', currentVersion: '3.1.1' });
  const openclawNotice = getQueuedNotice({
    currentVersion: '3.1.1',
    statePath: path2,
    env: { OPENCLAW_PLUGIN_CONFIG: '{}' },
    stderr: PIPE_STDERR,
    cliPath: INSTALLED_CLI_PATH,
    now: () => 1000,
  });
  assert.match(openclawNotice ?? '', /^\[sogni-agent\] Update available/);
});

test('getQueuedNotice — snooze suppresses the agent notice too', () => {
  const path = makeStatePath();
  writeState(path, { lastCheckedAt: 1, lastKnownLatest: '9.0.0', currentVersion: '3.1.1' });
  snoozeUpdate({ currentVersion: '3.1.1', statePath: path, now: () => 0 });
  const notice = getQueuedNotice({
    currentVersion: '3.1.1',
    statePath: path,
    env: {},
    stderr: PIPE_STDERR,
    cliPath: INSTALLED_CLI_PATH,
    now: () => 1,
  });
  assert.equal(notice, null);
});

test('formatAgentUpdateNotice — pure formatting contract', () => {
  const line = formatAgentUpdateNotice({ currentVersion: '1.0.0', latestVersion: '2.0.0' });
  assert.match(line, /^\[sogni-agent\] Update available: 1\.0\.0 -> 2\.0\.0\./);
  assert.ok(!line.includes('\n'));
});

// --- snooze (escalating backoff) ---

test('snoozeUpdate — no pending update is a no-op', () => {
  const statePath = makeStatePath();
  writeState(statePath, { lastCheckedAt: 1, lastKnownLatest: '1.0.0' });
  const result = snoozeUpdate({ currentVersion: '1.0.0', statePath, now: () => 1000 });
  assert.equal(result.snoozed, false);
  assert.equal(result.reason, 'no-pending-update');
});

test('snoozeUpdate — escalates 1 day → 2 days → 1 week and caps', () => {
  const statePath = makeStatePath();
  writeState(statePath, { lastCheckedAt: 1, lastKnownLatest: '2.0.0' });
  const now = () => 0;
  const first = snoozeUpdate({ currentVersion: '1.0.0', statePath, now });
  assert.deepEqual([first.level, first.until], [1, SNOOZE_LEVELS_MS[0]]);
  const second = snoozeUpdate({ currentVersion: '1.0.0', statePath, now });
  assert.deepEqual([second.level, second.until], [2, SNOOZE_LEVELS_MS[1]]);
  const third = snoozeUpdate({ currentVersion: '1.0.0', statePath, now });
  assert.deepEqual([third.level, third.until], [3, SNOOZE_LEVELS_MS[2]]);
  const fourth = snoozeUpdate({ currentVersion: '1.0.0', statePath, now });
  assert.deepEqual([fourth.level, fourth.until], [3, SNOOZE_LEVELS_MS[2]], 'level caps at the last rung');
});

test('snoozeUpdate — a newer release resets the ladder', () => {
  const statePath = makeStatePath();
  writeState(statePath, { lastCheckedAt: 1, lastKnownLatest: '2.0.0' });
  snoozeUpdate({ currentVersion: '1.0.0', statePath, now: () => 0 });
  snoozeUpdate({ currentVersion: '1.0.0', statePath, now: () => 0 });
  writeState(statePath, { ...readState(statePath), lastKnownLatest: '3.0.0' });
  const result = snoozeUpdate({ currentVersion: '1.0.0', statePath, now: () => 0 });
  assert.equal(result.level, 1, 'new target version starts back at level 1');
});

test('getQueuedNotice — suppressed while snoozed, returns after expiry', () => {
  const statePath = makeStatePath();
  writeState(statePath, { lastCheckedAt: 1, lastKnownLatest: '2.0.0' });
  snoozeUpdate({ currentVersion: '1.0.0', statePath, now: () => 1000 });
  const env = {};
  const during = getQueuedNotice({ currentVersion: '1.0.0', statePath, env, now: () => 1000 + 1 });
  assert.equal(during, null, 'notice suppressed during the snooze window');
  const after = getQueuedNotice({ currentVersion: '1.0.0', statePath, env, now: () => 1000 + SNOOZE_LEVELS_MS[0] + 1 });
  assert.ok(after && after.includes('2.0.0'), 'notice returns once the snooze expires');
});

test('getQueuedNotice — snooze for an older version does not mute a newer one', () => {
  const statePath = makeStatePath();
  writeState(statePath, { lastCheckedAt: 1, lastKnownLatest: '2.0.0' });
  snoozeUpdate({ currentVersion: '1.0.0', statePath, now: () => 0 });
  writeState(statePath, { ...readState(statePath), lastKnownLatest: '2.1.0' });
  const notice = getQueuedNotice({ currentVersion: '1.0.0', statePath, env: {}, now: () => 1 });
  assert.ok(notice && notice.includes('2.1.0'));
});

// --- what's new (CHANGELOG parsing) ---

const SAMPLE_CHANGELOG = `# Changelog

## [3.4.0] - 2026-05-30

### Added
- Video stitching.

## [3.3.5] - 2026-05-20

### Fixed
- Photobooth routing.

## [3.3.0] - 2026-05-01

### Added
- Music generation.
`;

test('extractChangelogEntries parses keep-a-changelog headings', () => {
  const entries = extractChangelogEntries(SAMPLE_CHANGELOG);
  assert.deepEqual(entries.map((entry) => entry.version), ['3.4.0', '3.3.5', '3.3.0']);
  assert.ok(entries[0].body.includes('Video stitching.'));
});

test('formatWhatsNew — current version entry by default', () => {
  const out = formatWhatsNew({ changelogText: SAMPLE_CHANGELOG, currentVersion: '3.3.5' });
  assert.ok(out.includes('[3.3.5]'));
  assert.ok(!out.includes('[3.4.0]'));
});

test('formatWhatsNew — falls back to the newest entry for unknown versions', () => {
  const out = formatWhatsNew({ changelogText: SAMPLE_CHANGELOG, currentVersion: '9.9.9' });
  assert.ok(out.includes('[3.4.0]'));
});

test('formatWhatsNew — sinceVersion selects everything after it up to current', () => {
  const out = formatWhatsNew({ changelogText: SAMPLE_CHANGELOG, currentVersion: '3.4.0', sinceVersion: '3.3.0' });
  assert.ok(out.includes('[3.4.0]'));
  assert.ok(out.includes('[3.3.5]'));
  assert.ok(!out.includes('[3.3.0]'));
});

test('runWhatsNew — missing changelog fails with a pointer', () => {
  const stderrChunks = [];
  const code = runWhatsNew({
    changelogPath: '/nonexistent/CHANGELOG.md',
    currentVersion: '1.0.0',
    stdout: { write: () => {} },
    stderr: { write: (chunk) => stderrChunks.push(chunk) },
  });
  assert.equal(code, 1);
  assert.ok(stderrChunks.join('').includes('No CHANGELOG.md found'));
});

test('runSelfUpdate — nonzero npm exit prints permission recovery hint', () => {
  const logs = [];
  const code = runSelfUpdate({
    env: {},
    stdio: 'pipe',
    platform: 'darwin',
    log: (line) => logs.push(line),
    spawnSyncFn: (command, args) => {
      assert.equal(command, 'npm');
      assert.deepEqual(args, ['install', '-g', PACKAGE_NAME]);
      return { status: 1, stderr: Buffer.from('npm error code EACCES\n') };
    },
  });
  const output = logs.join('\n');
  assert.equal(code, 1);
  assert.match(output, /exited with code 1/);
  assert.match(output, /sudo sogni-agent self-update/);
});
