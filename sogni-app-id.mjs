/**
 * Persistent Sogni application identity.
 *
 * Sogni limits how many distinct app IDs may connect from one address each
 * UTC day. An app ID therefore represents an installation, not a process or
 * request. Keep it outside credentials so rotating an API key does not rotate
 * the installation identity.
 */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getEnv } from './env.mjs';

const DEFAULT_APP_ID_PATH = join(homedir(), '.config', 'sogni', 'app-id');
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
  if (error?.code === 'INVALID_APP_ID') return error;
  const wrapped = new Error(`Could not persist the Sogni app ID at ${appIdPath}: ${error?.message || error}`);
  wrapped.code = 'APP_ID_PERSISTENCE_FAILED';
  wrapped.hint = 'Make that location writable, set SOGNI_APP_ID_PATH to a persistent writable file, or set one stable SOGNI_APP_ID value for every session.';
  return wrapped;
}

/**
 * Return the stable app ID for this installation, creating it exactly once.
 *
 * `SOGNI_APP_ID` is an explicit value override for ephemeral/container homes.
 * `SOGNI_APP_ID_PATH` moves the persisted file to a durable mounted location.
 */
export function getOrCreateSogniAppId({
  appId = getEnv('SOGNI_APP_ID', { trim: true }),
  appIdPath = getEnv('SOGNI_APP_ID_PATH', { trim: true }) || DEFAULT_APP_ID_PATH,
  generateUuid = randomUUID,
} = {}) {
  if (appId) return validateAppId(appId, 'SOGNI_APP_ID');

  const resolvedPath = expandHomePath(appIdPath);
  try {
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
  } catch (error) {
    throw appIdPersistenceError(error, resolvedPath);
  }
}

export { DEFAULT_APP_ID_PATH };
