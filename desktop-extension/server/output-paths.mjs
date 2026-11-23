// desktop-extension/server/output-paths.mjs
// Where MCP tool calls may write. A tool's output path comes from the model, so
// it is checked here before the CLI runs (and before anything is spent): the
// file must land inside an allowed folder and must not replace an existing file.
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// The folders people keep media in, under their home folder.
const HOME_MEDIA_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Videos'];

// The same inbox import_media and list_media use (see import-media.mjs).
function mediaInboxDir(env, home) {
  if (env.SOGNI_MEDIA_INBOUND_DIR) return env.SOGNI_MEDIA_INBOUND_DIR;
  const openclaw = join(home, '.openclaw', 'media', 'inbound');
  const legacy = join(home, '.clawdbot', 'media', 'inbound');
  return !existsSync(openclaw) && existsSync(legacy) ? legacy : openclaw;
}

// The CLI expands a leading ~ the same way (expandHomePath in sogni-agent.mjs).
function expandHome(path, home) {
  if (path === '~') return home;
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2));
  return path;
}

// Resolve symlinks in the part of the path that exists, so a link inside an
// allowed folder cannot carry a write somewhere else.
function realResolve(path) {
  const missing = [];
  let current = path;
  for (;;) {
    try {
      return join(realpathSync(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      missing.push(basename(current));
      current = parent;
    }
  }
}

function isInside(root, target) {
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

// The temp folder; on macOS also /tmp, which is not where tmpdir() points there.
function tempFolders() {
  return process.platform === 'darwin' ? [tmpdir(), '/tmp'] : [tmpdir()];
}

// A project folder under home, as Codex and other coding hosts start the server
// in. Not home itself, and nothing under a hidden folder, Library or AppData,
// where apps keep their own files.
function isWorkingFolder(cwd, home) {
  if (!isInside(home, cwd)) return false;
  const [first, ...rest] = relative(home, cwd).split(sep);
  return first !== 'Library' && first !== 'AppData' && ![first, ...rest].some((part) => part.startsWith('.'));
}

/**
 * The folders an MCP tool may write into: the home media folders, the media
 * inbox, the temp folder, the project folder the server was started in (see
 * isWorkingFolder), and any folders listed in SOGNI_MCP_OUTPUT_DIR (separated
 * like PATH).
 */
export function allowedOutputDirs({ env = process.env, home = homedir(), cwd = process.cwd(), temp = tempFolders() } = {}) {
  const dirs = HOME_MEDIA_FOLDERS.map((name) => join(home, name));
  dirs.push(mediaInboxDir(env, home), ...[temp].flat());
  if (isWorkingFolder(resolve(cwd), resolve(home))) dirs.push(resolve(cwd));
  for (const extra of String(env.SOGNI_MCP_OUTPUT_DIR ?? '').split(delimiter)) {
    if (extra.trim()) dirs.push(resolve(expandHome(extra.trim(), home)));
  }
  return [...new Set(dirs.map((dir) => resolve(dir)))];
}

function refuse(field, message) {
  const err = new Error(`${field} ${message}`);
  err.code = 'OUTPUT_PATH_REFUSED';
  return err;
}

/**
 * Check one output path and return it as an absolute path for the CLI.
 * Relative paths resolve against the server's folder, as the CLI would.
 * `siblings(path)` lists other files the CLI writes next to it.
 */
export function checkOutputPath(value, field, { siblings = () => [], ...context } = {}) {
  const env = context.env ?? process.env;
  const home = context.home ?? homedir();
  const cwd = context.cwd ?? process.cwd();
  if (typeof value !== 'string') throw refuse(field, 'must be a file path.');
  const target = resolve(cwd, expandHome(value, home));
  const roots = allowedOutputDirs({ ...context, env, home, cwd });
  const realTarget = realResolve(target);
  if (!roots.some((root) => isInside(realResolve(root), realTarget))) {
    throw refuse(
      field,
      `must be inside one of these folders: ${roots.join(', ')}. ` +
        'Choose a path there, or add a folder to SOGNI_MCP_OUTPUT_DIR in the server settings.',
    );
  }
  for (const path of [target, ...siblings(target)]) {
    let exists = false;
    try {
      lstatSync(path);
      exists = true;
    } catch {
      // Nothing there yet: the CLI may create it.
    }
    if (exists) throw refuse(field, `would replace ${path}, which already exists. Choose a new file name.`);
  }
  return target;
}

// generate_video's return_last_frame saves <name>-last-frame.<png|jpg|webp> beside the video.
export function lastFrameSiblings(path) {
  const stem = path.slice(0, path.length - extname(path).length);
  return ['png', 'jpg', 'jpeg', 'webp'].map((ext) => `${stem}-last-frame.${ext}`);
}
