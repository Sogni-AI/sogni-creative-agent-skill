// desktop-extension/server/import-media.mjs
// Local handler for the import_media tool: decodes base64 chunks sent by the
// model and writes them into the Sogni media inbox, returning the absolute
// path the generation tools can consume. This exists because chat clients
// (e.g. Claude Desktop) cannot hand attachment bytes to a local MCP server —
// the model relays them as base64 instead, chunked for anything beyond one
// tool call's worth of output. Runs entirely locally: no CLI spawn, no network.
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';

// Decoded-bytes ceilings. A chunk is one tool call's `data` payload; the total
// bounds the finished file so a runaway chunk loop can't fill the disk.
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

// Media-only allowlist: this tool imports generation inputs, not arbitrary
// files, so executable/document extensions are rejected outright.
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp3', '.wav', '.flac', '.m4a', '.ogg',
  '.mp4', '.mov', '.webm',
]);

// Mirrors the CLI's inbound-dir resolution (sogni-agent.mjs): env override
// first, then the OpenClaw inbox with a legacy clawdbot-era fallback. Keeping
// the same directory means --list-media sees imported files immediately.
function resolveInboundDir(env, home) {
  if (env.SOGNI_MEDIA_INBOUND_DIR) return env.SOGNI_MEDIA_INBOUND_DIR;
  const openclaw = join(home, '.openclaw', 'media', 'inbound');
  const legacy = join(home, '.clawdbot', 'media', 'inbound');
  return !existsSync(openclaw) && existsSync(legacy) ? legacy : openclaw;
}

function decodeChunk(data, maxChunkBytes) {
  if (typeof data !== 'string' || data === '') {
    throw new Error('data is required — the base64-encoded bytes of this chunk.');
  }
  const compact = data.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error('data is not valid base64.');
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length > maxChunkBytes) {
    throw new Error(`Chunk too large: ${bytes.length} bytes decoded (max ${maxChunkBytes}). Send smaller chunks.`);
  }
  return bytes;
}

// New imports never clobber: pixel.png → pixel-2.png → pixel-3.png …
function uniquePath(dir, filename) {
  const ext = extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let candidate = join(dir, filename);
  for (let n = 2; existsSync(candidate); n += 1) {
    candidate = join(dir, `${stem}-${n}${ext}`);
  }
  return candidate;
}

export async function importMedia(input, {
  env = process.env,
  home = homedir(),
  maxChunkBytes = MAX_CHUNK_BYTES,
  maxTotalBytes = MAX_TOTAL_BYTES,
} = {}) {
  const bytes = decodeChunk(input.data, maxChunkBytes);
  const dir = resolveInboundDir(env, home);

  if (input.append_to_path) {
    const target = resolve(String(input.append_to_path));
    if (!target.startsWith(resolve(dir) + sep)) {
      throw new Error('append_to_path must be a path inside the Sogni media inbox returned by a previous import_media call.');
    }
    if (!existsSync(target)) {
      throw new Error('append_to_path does not exist — start the import with a filename first.');
    }
    const existing = statSync(target).size;
    if (existing + bytes.length > maxTotalBytes) {
      throw new Error(`Import would exceed the total size cap (${maxTotalBytes} bytes).`);
    }
    appendFileSync(target, bytes);
    return { path: target, bytes: existing + bytes.length };
  }

  const filename = basename(String(input.filename ?? ''));
  if (!filename || filename === '.' || filename === sep) {
    throw new Error('filename is required for a new import, e.g. "photo.jpg".');
  }
  const ext = extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported extension "${ext || '(none)'}" — allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}.`);
  }
  if (bytes.length > maxTotalBytes) {
    throw new Error(`Import would exceed the total size cap (${maxTotalBytes} bytes).`);
  }
  mkdirSync(dir, { recursive: true });
  const target = uniquePath(dir, filename);
  writeFileSync(target, bytes);
  return { path: target, bytes: bytes.length };
}

// Tool-call entry point used by index.mjs: wraps the core in the JSON shape
// the model reads back, including where to point the generation tools next.
export async function runImportMedia(input) {
  const { path, bytes } = await importMedia(input ?? {});
  return JSON.stringify({
    path,
    bytes,
    note: 'Saved locally. To add more chunks, call import_media again with append_to_path set to this path. '
      + 'When complete, pass this path as generate_video.ref, generate_image.context_images, photobooth.ref, or a persona ref.',
  });
}
