/**
 * sogni-agent update check — trailing-notification style.
 *
 * Public API:
 *   shouldSkipForEnvironment(opts)  → boolean   (pure)
 *   compareSemver(a, b)             → -1|0|1    (pure)
 *   detectPackageManager(env)       → { manager, installCmd }
 *   formatUpdateNotice(opts)        → string    (pure)
 *   readState(path)                 → state | null
 *   writeState(path, state)         → void
 *   runForegroundCheck(opts)        → Promise<void>   (used by --__update-check)
 *   maybeSpawnBackgroundCheck(opts) → 'spawned' | 'skipped' | 'fresh'
 *   getQueuedNotice(opts)           → string | null  (TTY banner, or a
 *                                     throttled one-line agent notice when
 *                                     stderr is not a TTY)
 *   formatAgentUpdateNotice(opts)   → string    (pure)
 *   runSelfUpdate(opts)             → number (exit code)
 *   snoozeUpdate(opts)              → { snoozed, version?, level?, until? }
 *   extractChangelogEntries(text)   → [{ version, heading, body }]  (pure)
 *   formatWhatsNew(opts)            → string | null                  (pure)
 *   runWhatsNew(opts)               → number (exit code)
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import https from 'https';

export const PACKAGE_NAME = '@sogni-ai/sogni-creative-agent-skill';
export const DEFAULT_STATE_PATH = join(homedir(), '.config', 'sogni', 'update-check.json');
export const DEFAULT_THROTTLE_MS = 24 * 60 * 60 * 1000; // 24h
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`;
const REGISTRY_TIMEOUT_MS = 1500;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const INTERNAL_FLAG = '--__update-check';

export { INTERNAL_FLAG };

// ---------- pure helpers ----------

function parseSemverPart(value) {
  const [main, prerelease] = String(value).split('-', 2);
  const nums = main.split('.').map((n) => Number.parseInt(n, 10));
  if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { nums, prerelease: prerelease || '' };
}

export function compareSemver(a, b) {
  const pa = parseSemverPart(a);
  const pb = parseSemverPart(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

export function detectPackageManager(env = process.env) {
  const ua = env.npm_config_user_agent || '';
  if (ua.startsWith('pnpm/')) {
    return { manager: 'pnpm', installCmd: `pnpm add -g ${PACKAGE_NAME}` };
  }
  if (ua.startsWith('yarn/')) {
    return { manager: 'yarn', installCmd: `yarn global add ${PACKAGE_NAME}` };
  }
  if (ua.startsWith('bun/')) {
    return { manager: 'bun', installCmd: `bun add -g ${PACKAGE_NAME}` };
  }
  return { manager: 'npm', installCmd: `npm install -g ${PACKAGE_NAME}` };
}

// Hard opt-outs only. Notices are deliberately NOT skipped for non-TTY
// stderr, --json, or OpenClaw plugin invocations anymore: those are exactly
// the agent contexts that should relay "an update is available" to the user
// (getQueuedNotice emits a compact single-line agent notice there instead of
// the interactive banner).
export function shouldSkipForEnvironment({
  argv = process.argv,
  env = process.env,
  cliPath = process.argv[1] || '',
} = {}) {
  if (Array.isArray(argv) && argv.includes('--no-update-check')) return true;
  if (env.SOGNI_NO_UPDATE_CHECK === '1' || env.SOGNI_NO_UPDATE_CHECK === 'true') return true;
  if (env.NO_UPDATE_NOTIFIER === '1' || env.NO_UPDATE_NOTIFIER === 'true') return true;
  if (env.CI) return true;
  if (env.SOGNI_AGENT_TEST_STATE_PATH) return true;
  if (env.NODE_ENV === 'test') return true;
  if (env.npm_lifecycle_event) return true; // running under `npm <script>`
  // Dev / source checkout: CLI directory contains .git
  if (cliPath) {
    try {
      const cliDir = dirname(cliPath);
      if (existsSync(join(cliDir, '.git'))) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export function formatUpdateNotice({
  currentVersion,
  latestVersion,
  installCmd,
  useColor,
} = {}) {
  const color = useColor !== false && !process.env.NO_COLOR && process.stderr.isTTY;
  const c = {
    dim: color ? '\x1b[2m' : '',
    bold: color ? '\x1b[1m' : '',
    yellow: color ? '\x1b[33m' : '',
    cyan: color ? '\x1b[36m' : '',
    reset: color ? '\x1b[0m' : '',
  };
  const headline = `Update available ${c.dim}${currentVersion}${c.reset} → ${c.bold}${c.yellow}${latestVersion}${c.reset}`;
  const cta = `Run ${c.cyan}${installCmd}${c.reset} to update`;
  const tip = `${c.dim}(or run ${c.reset}${c.cyan}sogni-agent self-update${c.reset}${c.dim}, disable with --no-update-check)${c.reset}`;
  return ['', headline, cta, tip, ''].join('\n');
}

// ---------- state file ----------

export function readState(path = DEFAULT_STATE_PATH) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeState(path, state) {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
  } catch {
    // best-effort; never throw
  }
}

export function clearState(path = DEFAULT_STATE_PATH) {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

// ---------- network ----------

function fetchLatestVersion({ url = REGISTRY_URL, timeoutMs = REGISTRY_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    let req;
    try {
      req = https.get(url, { headers: { accept: 'application/json' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(reject, new Error(`registry status ${res.statusCode}`));
          return;
        }
        let received = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            res.destroy();
            finish(reject, new Error('registry response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed.version === 'string') {
              finish(resolve, parsed.version);
            } else {
              finish(reject, new Error('registry response missing version'));
            }
          } catch (err) {
            finish(reject, err);
          }
        });
        res.on('error', (err) => finish(reject, err));
      });
    } catch (err) {
      finish(reject, err);
      return;
    }
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('registry timeout'));
    });
    req.on('error', (err) => finish(reject, err));
  });
}

// ---------- foreground (child) check ----------

export async function runForegroundCheck({
  currentVersion,
  statePath = DEFAULT_STATE_PATH,
  url = REGISTRY_URL,
  timeoutMs = REGISTRY_TIMEOUT_MS,
  fetcher = fetchLatestVersion,
  now = Date.now,
} = {}) {
  try {
    const latest = await fetcher({ url, timeoutMs });
    writeState(statePath, {
      lastCheckedAt: now(),
      lastKnownLatest: latest,
      currentVersion: currentVersion || null,
    });
  } catch {
    // Still record the attempt timestamp so we don't hammer the registry
    // when offline. Keep any previously-known latest version so the user
    // still sees the notice for an older known update.
    const prev = readState(statePath) || {};
    writeState(statePath, {
      lastCheckedAt: now(),
      lastKnownLatest: prev.lastKnownLatest || null,
      currentVersion: currentVersion || null,
    });
  }
}

// ---------- parent helpers ----------

export function maybeSpawnBackgroundCheck({
  cliPath = process.argv[1],
  statePath = DEFAULT_STATE_PATH,
  throttleMs = DEFAULT_THROTTLE_MS,
  now = Date.now,
  spawnFn = spawn,
  execPath = process.execPath,
  env = process.env,
} = {}) {
  if (shouldSkipForEnvironment({ env })) return 'skipped';
  const state = readState(statePath);
  if (state && typeof state.lastCheckedAt === 'number' && now() - state.lastCheckedAt < throttleMs) {
    return 'fresh';
  }
  try {
    const child = spawnFn(execPath, [cliPath, INTERNAL_FLAG], {
      detached: true,
      stdio: 'ignore',
      env,
    });
    child.on('error', () => {});
    if (typeof child.unref === 'function') child.unref();
    return 'spawned';
  } catch {
    return 'skipped';
  }
}

// Agent contexts (non-TTY stderr: Claude Code, Codex, Hermes, OpenClaw, …)
// get a compact one-line notice at most once per this window, instructing the
// agent to relay the update to the user — the gstack-style "there's an update,
// you should install it sometime" experience. Interactive TTY users keep the
// banner on every run as before.
export const AGENT_NOTICE_THROTTLE_MS = 24 * 60 * 60 * 1000;

export function formatAgentUpdateNotice({ currentVersion, latestVersion } = {}) {
  return `[sogni-agent] Update available: ${currentVersion} -> ${latestVersion}. ` +
    'Agent: after finishing the current task, let the user know a newer Sogni Creative Agent Skill exists ' +
    'and offer to run `sogni-agent self-update` (then `sogni-agent --whats-new`). ' +
    'If they decline, run `sogni-agent --snooze-update` to pause these reminders.';
}

export function getQueuedNotice({
  currentVersion,
  statePath = DEFAULT_STATE_PATH,
  env = process.env,
  argv = process.argv,
  stderr = process.stderr,
  cliPath = process.argv[1] || '',
  now = Date.now,
} = {}) {
  if (shouldSkipForEnvironment({ argv, env, cliPath })) return null;
  const state = readState(statePath);
  if (!state || typeof state.lastKnownLatest !== 'string') return null;
  if (compareSemver(state.lastKnownLatest, currentVersion) <= 0) return null;
  // Respect an active snooze for this specific target version. A newer
  // release than the snoozed one starts nagging again immediately.
  if (
    state.snooze &&
    state.snooze.version === state.lastKnownLatest &&
    typeof state.snooze.until === 'number' &&
    now() < state.snooze.until
  ) {
    return null;
  }

  const interactive = Boolean(stderr && stderr.isTTY);
  if (interactive) {
    const { installCmd } = detectPackageManager(env);
    return formatUpdateNotice({
      currentVersion,
      latestVersion: state.lastKnownLatest,
      installCmd,
    });
  }

  // Agent mode: throttle so long agent sessions see this occasionally, not on
  // every single command.
  if (
    typeof state.lastNotifiedAt === 'number' &&
    now() - state.lastNotifiedAt < AGENT_NOTICE_THROTTLE_MS
  ) {
    return null;
  }
  writeState(statePath, { ...state, lastNotifiedAt: now() });
  return formatAgentUpdateNotice({ currentVersion, latestVersion: state.lastKnownLatest });
}

// Escalating snooze backoff: declining the same update nags less and less
// (1 day → 2 days → 1 week), and a new release resets the ladder.
export const SNOOZE_LEVELS_MS = [
  24 * 60 * 60 * 1000,
  48 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
];

export function snoozeUpdate({
  currentVersion,
  statePath = DEFAULT_STATE_PATH,
  now = Date.now,
} = {}) {
  const state = readState(statePath) || {};
  const target = typeof state.lastKnownLatest === 'string' ? state.lastKnownLatest : null;
  if (!target || compareSemver(target, currentVersion) <= 0) {
    return { snoozed: false, reason: 'no-pending-update' };
  }
  const priorLevel = state.snooze && state.snooze.version === target ? (state.snooze.level || 0) : 0;
  const level = Math.min(priorLevel + 1, SNOOZE_LEVELS_MS.length);
  const until = now() + SNOOZE_LEVELS_MS[level - 1];
  writeState(statePath, { ...state, snooze: { version: target, level, until } });
  return { snoozed: true, version: target, level, until };
}

// ---------- what's new (CHANGELOG summaries) ----------

// Parses keep-a-changelog style sections: `## [x.y.z] - date` headings.
export function extractChangelogEntries(changelogText) {
  const entries = [];
  const lines = String(changelogText || '').split('\n');
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+\[?(\d+\.\d+\.\d+)\]?(.*)$/);
    if (heading) {
      if (current) entries.push(current);
      current = { version: heading[1], heading: line.trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) entries.push(current);
  return entries.map((entry) => ({
    version: entry.version,
    heading: entry.heading,
    body: entry.body.join('\n').trim(),
  }));
}

export function formatWhatsNew({
  changelogText,
  currentVersion,
  sinceVersion = null,
  maxEntries = 10,
} = {}) {
  const entries = extractChangelogEntries(changelogText);
  if (entries.length === 0) return null;
  let selected;
  if (sinceVersion) {
    selected = entries.filter((entry) =>
      compareSemver(entry.version, sinceVersion) > 0 &&
      (!currentVersion || compareSemver(entry.version, currentVersion) <= 0));
  } else {
    selected = entries.filter((entry) => entry.version === currentVersion);
    if (selected.length === 0) selected = [entries[0]];
  }
  if (selected.length === 0) return null;
  const sections = selected.slice(0, maxEntries).map((entry) =>
    `${entry.heading}\n\n${entry.body}`.trim());
  return sections.join('\n\n');
}

export function runWhatsNew({
  changelogPath,
  currentVersion,
  sinceVersion = null,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let changelogText;
  try {
    changelogText = readFileSync(changelogPath, 'utf8');
  } catch {
    stderr.write(`No CHANGELOG.md found at ${changelogPath}.\n`);
    stderr.write(`See https://github.com/Sogni-AI/sogni-creative-agent-skill/blob/main/CHANGELOG.md\n`);
    return 1;
  }
  const summary = formatWhatsNew({ changelogText, currentVersion, sinceVersion });
  if (!summary) {
    stderr.write(sinceVersion
      ? `No changelog entries found after ${sinceVersion}.\n`
      : 'No changelog entries found.\n');
    return 1;
  }
  stdout.write(summary + '\n');
  return 0;
}

export function runSelfUpdate({
  env = process.env,
  statePath = DEFAULT_STATE_PATH,
  spawnSyncFn = spawnSync,
  stdio = 'inherit',
} = {}) {
  const { manager, installCmd } = detectPackageManager(env);
  const [command, ...args] = installCmd.split(' ');
  console.error(`Running: ${installCmd}`);
  const result = spawnSyncFn(command, args, { stdio, env });
  if (result.error) {
    console.error(`self-update failed: ${result.error.message}`);
    if (manager === 'npm' && /EACCES|EPERM/i.test(result.error.message)) {
      console.error('Hint: re-run with sudo, or install with a Node version manager (nvm/fnm/volta).');
    }
    return 1;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    return result.status;
  }
  clearState(statePath);
  console.error('Updated. Run `sogni-agent --whats-new` to see what changed.');
  return 0;
}
