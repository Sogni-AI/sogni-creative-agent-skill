/**
 * Persistent Sogni application identity.
 *
 * Repeatedly registering distinct app IDs can exhaust the service allowance.
 * An app ID therefore represents an installation, not a process or request.
 * Keep it outside credentials so rotating an API key does not rotate the
 * installation identity.
 *
 * A single shared app ID is not enough once several agent harnesses (Claude
 * Code, Codex, OpenCode, hermes, ...) drive this CLI concurrently: the socket
 * server allows one live connection per app ID and answers a second claim
 * with SWITCH_CONNECTION (4015), kicking the first process mid-render. The
 * default mode is therefore a small pool of persistent per-slot app IDs under
 * `~/.config/sogni/app-ids/`. Each process leases the lowest free slot for
 * its lifetime (lease liveness = pid check), so concurrent processes get
 * distinct stable IDs, the pool only grows to the actual peak concurrency,
 * and no new ID is minted on routine runs.
 */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { getEnv } from './env.mjs';

const DEFAULT_APP_ID_PATH = join(homedir(), '.config', 'sogni', 'app-id');
const DEFAULT_APP_ID_POOL_DIR = join(homedir(), '.config', 'sogni', 'app-ids');
const DEFAULT_APP_ID_POOL_MAX = 32;
const GENERATED_APP_ID_PREFIX = 'sogni-agent-';
const MAX_APP_ID_LENGTH = 256;
const APP_ID_CREATE_RETRIES = 20;
const APP_ID_CREATE_RETRY_MS = 5;

function expandHomePath(rawPath) {
  if (rawPath === '~') return homedir();
  if (rawPath?.startsWith('~/') || rawPath?.startsWith('~\\')) {
    return join(homedir(), rawPath.slice(2));
  }
  return rawPath;
}

function validateAppId(value, source) {
  const appId = typeof value === 'string' ? value.trim() : '';
  if (!appId) {
    const error = new Error(`${source} is empty.`);
    error.code = 'INVALID_APP_ID';
    error.hint = 'Set SOGNI_APP_ID to one stable non-empty identifier, or remove the empty app-id file so the CLI can recreate it.';
    throw error;
  }
  if (appId.length > MAX_APP_ID_LENGTH || /[\x00-\x1f\x7f]/.test(appId)) {
    const error = new Error(`${source} must be at most ${MAX_APP_ID_LENGTH} characters and contain no control characters.`);
    error.code = 'INVALID_APP_ID';
    error.hint = 'Set SOGNI_APP_ID to one stable UUID-style identifier.';
    throw error;
  }
  return appId;
}

function waitForConcurrentWriter() {
  // Another process can observe the file in the tiny interval between its
  // exclusive creation and first write. Atomics.wait gives that writer a few
  // milliseconds without introducing an async API into client construction.
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, APP_ID_CREATE_RETRY_MS);
}

function readPersistedAppId(appIdPath) {
  return validateAppId(readFileSync(appIdPath, 'utf8'), `Sogni app-id file ${appIdPath}`);
}

function appIdPersistenceError(error, appIdPath) {
  if (error?.code === 'INVALID_APP_ID' || error?.code === 'APP_ID_POOL_EXHAUSTED') return error;
  const wrapped = new Error(`Could not persist the Sogni app ID at ${appIdPath}: ${error?.message || error}`);
  wrapped.code = 'APP_ID_PERSISTENCE_FAILED';
  wrapped.hint = 'Make that location writable, set SOGNI_APP_ID_PATH to a persistent writable file, or set one stable SOGNI_APP_ID value for every session.';
  return wrapped;
}

/**
 * Create-once/read-forever identity file. Concurrent first launches race on
 * exclusive create; losers reuse the winner's value.
 */
function getOrCreateAppIdFile(resolvedPath, generateUuid) {
  try {
    return readPersistedAppId(resolvedPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  const candidate = validateAppId(
    `${GENERATED_APP_ID_PREFIX}${generateUuid()}`,
    'Generated Sogni app ID',
  );
  let descriptor;
  let createdFile = false;
  try {
    descriptor = openSync(resolvedPath, 'wx', 0o600);
    createdFile = true;
    writeFileSync(descriptor, `${candidate}\n`, 'utf8');
    return candidate;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;

    // A concurrent first launch won the exclusive create. Reuse its value
    // once the short write window closes.
    let lastError = error;
    for (let attempt = 0; attempt < APP_ID_CREATE_RETRIES; attempt += 1) {
      try {
        return readPersistedAppId(resolvedPath);
      } catch (readError) {
        lastError = readError;
        if (attempt + 1 < APP_ID_CREATE_RETRIES) waitForConcurrentWriter();
      }
    }
    throw lastError;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    // Do not strand an empty/corrupt identity if this process created the
    // file but could not finish writing it.
    if (createdFile) {
      try {
        readPersistedAppId(resolvedPath);
      } catch {
        try { unlinkSync(resolvedPath); } catch { /* best effort */ }
      }
    }
  }
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but belongs to another user; treat as alive.
    return error?.code === 'EPERM';
  }
}

function leaseIsStale(leasePath, { isPidAlive, ownPid }) {
  let record;
  try {
    record = JSON.parse(readFileSync(leasePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return false; // released while we looked
    return true; // unreadable/corrupt lease can never be released by its owner
  }
  const pid = record?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return true;
  // A lease naming our own pid cannot be live: this process acquires at most
  // one lease and caches it, so this is a leftover from a recycled pid.
  if (pid === ownPid) return true;
  return !isPidAlive(pid);
}

function tryCreateLease(leasePath, ownPid) {
  let descriptor;
  try {
    descriptor = openSync(leasePath, 'wx', 0o600);
    const record = {
      pid: ownPid,
      tool: basename(process.argv[1] || 'sogni-agent'),
      acquiredAt: new Date().toISOString(),
    };
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * One-time migration: the pre-pool single `app-id` file becomes slot-0 so an
 * upgraded installation keeps its already-registered identity instead of
 * burning a new one. The legacy file is removed so a stray old-CLI process
 * cannot share (and steal) slot-0's connection.
 */
function migrateLegacyAppId(poolDir, legacyAppIdPath) {
  if (!legacyAppIdPath) return;
  let legacyValue;
  try {
    legacyValue = readPersistedAppId(legacyAppIdPath);
  } catch {
    return; // absent or corrupt legacy identity: nothing worth migrating
  }
  let descriptor;
  try {
    descriptor = openSync(join(poolDir, 'slot-0'), 'wx', 0o600);
    writeFileSync(descriptor, `${legacyValue}\n`, 'utf8');
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return; // pool already initialized; leave the legacy file alone
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  try { unlinkSync(legacyAppIdPath); } catch { /* best effort */ }
}

function parsePoolMax(rawValue) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_APP_ID_POOL_MAX;
}

let processLease = null;
let exitCleanupRegistered = false;

/** Release this process's pool lease (also used by tests to reset state). */
export function releaseSogniAppId() {
  if (!processLease) return;
  try { unlinkSync(processLease.leasePath); } catch { /* best effort */ }
  processLease = null;
}

function registerExitCleanup() {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.on('exit', releaseSogniAppId);
}

function acquireSlotLease({ poolDir, poolMax, generateUuid, isPidAlive, ownPid, legacyAppIdPath }) {
  mkdirSync(poolDir, { recursive: true, mode: 0o700 });
  migrateLegacyAppId(poolDir, legacyAppIdPath);
  for (let slot = 0; slot < poolMax; slot += 1) {
    const slotPath = join(poolDir, `slot-${slot}`);
    const appId = getOrCreateAppIdFile(slotPath, generateUuid);
    const leasePath = `${slotPath}.lease`;
    if (tryCreateLease(leasePath, ownPid)) return { appId, leasePath };
    if (leaseIsStale(leasePath, { isPidAlive, ownPid })) {
      try { unlinkSync(leasePath); } catch { /* another reclaimer won */ }
      if (tryCreateLease(leasePath, ownPid)) return { appId, leasePath };
    }
  }
  const error = new Error(`All ${poolMax} Sogni app-ID slots in ${poolDir} are leased by live processes.`);
  error.code = 'APP_ID_POOL_EXHAUSTED';
  error.hint = 'Raise SOGNI_APP_ID_POOL_MAX, or give long-lived daemons their own stable SOGNI_APP_ID so they stay out of the shared pool.';
  throw error;
}

/**
 * Return the stable app ID for this process, creating identity state at most
 * once per installation.
 *
 * Resolution order:
 * 1. `SOGNI_APP_ID` — explicit pinned value (ephemeral/container homes and
 *    long-lived daemons that must keep one identity). No files touched.
 * 2. `SOGNI_APP_ID_PATH` — legacy single-file mode for callers that manage
 *    their own concurrency; behaves exactly like pre-pool releases.
 * 3. Default — lease a slot from the persistent pool so concurrent agent
 *    processes each hold a distinct stable ID (`SOGNI_APP_ID_POOL_DIR`,
 *    `SOGNI_APP_ID_POOL_MAX`). The lease is released on process exit and
 *    reclaimed via pid-liveness if the process dies uncleanly.
 */
export function getOrCreateSogniAppId({
  appId = getEnv('SOGNI_APP_ID', { trim: true }),
  appIdPath = getEnv('SOGNI_APP_ID_PATH', { trim: true }),
  poolDir = getEnv('SOGNI_APP_ID_POOL_DIR', { trim: true }) || DEFAULT_APP_ID_POOL_DIR,
  poolMax = parsePoolMax(getEnv('SOGNI_APP_ID_POOL_MAX', { trim: true })),
  generateUuid = randomUUID,
  isPidAlive = defaultIsPidAlive,
  ownPid = process.pid,
  legacyAppIdPath,
} = {}) {
  if (appId) return validateAppId(appId, 'SOGNI_APP_ID');

  if (appIdPath) {
    const resolvedPath = expandHomePath(appIdPath);
    try {
      return getOrCreateAppIdFile(resolvedPath, generateUuid);
    } catch (error) {
      throw appIdPersistenceError(error, resolvedPath);
    }
  }

  if (processLease) return processLease.appId;
  const resolvedPoolDir = expandHomePath(poolDir);
  if (legacyAppIdPath === undefined) {
    // Only the real default pool inherits the real pre-pool identity file; a
    // custom pool location must never consume (and delete) it as a side effect.
    legacyAppIdPath = resolvedPoolDir === DEFAULT_APP_ID_POOL_DIR ? DEFAULT_APP_ID_PATH : null;
  }
  try {
    processLease = acquireSlotLease({
      poolDir: resolvedPoolDir,
      poolMax,
      generateUuid,
      isPidAlive,
      ownPid,
      legacyAppIdPath,
    });
  } catch (error) {
    throw appIdPersistenceError(error, resolvedPoolDir);
  }
  registerExitCleanup();
  return processLease.appId;
}

/** Diagnostic view of the pool for doctor/debug output. */
export function describeSogniAppIdPool({
  poolDir = getEnv('SOGNI_APP_ID_POOL_DIR', { trim: true }) || DEFAULT_APP_ID_POOL_DIR,
  isPidAlive = defaultIsPidAlive,
} = {}) {
  const resolvedPoolDir = expandHomePath(poolDir);
  let names;
  try {
    names = readdirSync(resolvedPoolDir);
  } catch {
    return { poolDir: resolvedPoolDir, slots: [] };
  }
  const slots = names
    .filter((name) => /^slot-\d+$/.test(name))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((name) => {
      const slotPath = join(resolvedPoolDir, name);
      let appId = null;
      try { appId = readPersistedAppId(slotPath); } catch { /* corrupt slot */ }
      let lease = null;
      try {
        lease = JSON.parse(readFileSync(`${slotPath}.lease`, 'utf8'));
        lease.live = Number.isInteger(lease?.pid) && lease.pid > 0 && isPidAlive(lease.pid);
      } catch { /* no lease */ }
      return { slot: name, appId, lease };
    });
  return { poolDir: resolvedPoolDir, slots };
}

export { DEFAULT_APP_ID_PATH, DEFAULT_APP_ID_POOL_DIR };
