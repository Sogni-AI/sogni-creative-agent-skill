// desktop-extension/server/inline-images.mjs
// Turns a successful CLI run into MCP image content blocks so Claude Desktop
// renders results inline. Pure of protocol concerns: index.mjs decides when
// to call this and how to compose the result. Every expected failure (bad
// JSON, missing file, failed fetch, oversized bytes) degrades silently —
// callers must never end up worse off than the text-only result.
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const INLINE_TOOLS = new Set(['generate_image', 'photobooth']);
const FRAME_ACTIONS = new Set(['extract_first_frame', 'extract_last_frame']);
const MAX_INLINE_IMAGES = 4;
const MAX_RAW_BYTES = 3.5 * 1024 * 1024; // ≈5MB once base64-encoded — the practical content ceiling
const DOWNSCALE_MAX_DIM = 2048;
const DOWNSCALE_JPEG_QUALITY = 85;
const TOO_LARGE_NOTE = 'One image was too large to display inline; use the link above.';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function mimeFromPath(p) {
  return MIME_BY_EXT[extname(String(p).split('?')[0]).toLowerCase()] ?? null;
}

function isInlineScoped(toolName, input) {
  if (INLINE_TOOLS.has(toolName)) return true;
  return toolName === 'edit_video' && FRAME_ACTIONS.has(input?.action);
}

// The CLI's --json output is a single JSON document, but be tolerant of any
// stray wrapper lines: fall back to the outermost {...} span.
function parseDescriptor(stdout) {
  const raw = String(stdout ?? '').trim();
  for (const candidate of [raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function sourceCandidates(toolName, input, stdout) {
  if (toolName === 'edit_video') {
    // Frame extractions write straight to the caller-provided output path and
    // emit no --json descriptor.
    return input?.output ? [{ kind: 'file', ref: String(input.output) }] : [];
  }
  const desc = parseDescriptor(stdout);
  if (!desc) return [];
  if (desc.localPath) return [{ kind: 'file', ref: String(desc.localPath) }];
  if (Array.isArray(desc.urls)) {
    return desc.urls
      .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
      .slice(0, MAX_INLINE_IMAGES)
      .map((u) => ({ kind: 'url', ref: u }));
  }
  return [];
}

async function obtainBytes(candidate, fetchImpl) {
  if (candidate.kind === 'file') {
    return { data: await readFile(candidate.ref), mime: mimeFromPath(candidate.ref) ?? 'image/png' };
  }
  const res = await fetchImpl(candidate.ref);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const headerMime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const mime = headerMime.startsWith('image/') ? headerMime : (mimeFromPath(candidate.ref) ?? 'image/png');
  return { data: Buffer.from(await res.arrayBuffer()), mime };
}

// Full-resolution by default; only an image that would blow the content
// ceiling gets downscaled (sharp ships with the package), and if that is
// impossible the image is skipped with a note rather than breaking the call.
async function fitBytes(entry) {
  if (entry.data.length <= MAX_RAW_BYTES) return entry;
  try {
    const { default: sharp } = await import('sharp');
    const data = await sharp(entry.data)
      .resize({ width: DOWNSCALE_MAX_DIM, height: DOWNSCALE_MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: DOWNSCALE_JPEG_QUALITY })
      .toBuffer();
    if (data.length <= MAX_RAW_BYTES) return { data, mime: 'image/jpeg' };
    return null;
  } catch {
    return null;
  }
}

export async function collectInlineImages({ toolName, input, stdout, env = process.env, fetchImpl = fetch }) {
  const empty = { blocks: [], notes: [] };
  if (env.SOGNI_MCP_NO_INLINE_IMAGES === '1') return empty;
  if (!isInlineScoped(toolName, input)) return empty;

  const blocks = [];
  const notes = [];
  for (const candidate of sourceCandidates(toolName, input, stdout)) {
    if (blocks.length >= MAX_INLINE_IMAGES) break;
    try {
      const fitted = await fitBytes(await obtainBytes(candidate, fetchImpl));
      if (!fitted) {
        if (!notes.includes(TOO_LARGE_NOTE)) notes.push(TOO_LARGE_NOTE);
        continue;
      }
      blocks.push({ type: 'image', data: fitted.data.toString('base64'), mimeType: fitted.mime });
    } catch {
      // Silent per-image degradation: the text block still carries the link.
    }
  }
  return { blocks, notes };
}
