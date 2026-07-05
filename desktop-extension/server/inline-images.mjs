// desktop-extension/server/inline-images.mjs
// Turns a successful CLI run into MCP image content blocks so Claude Desktop
// renders results inline. Pure of protocol concerns: index.mjs decides when
// to call this and how to compose the result. Every expected failure (bad
// JSON, missing file, failed fetch, oversized bytes) degrades silently —
// callers must never end up worse off than the text-only result.
//
// Size budget: Claude Desktop rejects any tool result over 1MB total ("Tool
// result is too large. Maximum size is 1MB."). Inline previews therefore share
// a cumulative raw-byte budget (INLINE_BUDGET_RAW) that leaves headroom for
// base64 expansion (~4/3) plus the text block, keeping the whole result under
// the 1MB host cap. Each image attaches as-is if it fits the remaining budget;
// otherwise it is downscaled through a deterministic sharp ladder to the first
// rung that fits. The text block always carries the full-resolution URL/path —
// the inline block is only a preview.
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const INLINE_TOOLS = new Set(['generate_image', 'photobooth']);
const FRAME_ACTIONS = new Set(['extract_first_frame', 'extract_last_frame']);
const MAX_INLINE_IMAGES = 4;
// Cumulative raw-byte budget across all inline images. ≈933KB once base64-
// encoded, which plus the text block stays safely under the 1MB host cap.
const INLINE_BUDGET_RAW = 700 * 1024;
// Deterministic downscale rungs, largest first; attach the first rung whose
// JPEG output fits the remaining budget.
const DOWNSCALE_LADDER = [
  { dim: 1024, q: 80 },
  { dim: 768, q: 70 },
  { dim: 512, q: 60 },
];
const FETCH_TIMEOUT_MS = 20_000; // inline fetch must never meaningfully delay the text result
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

async function obtainBytes(candidate, fetchImpl, fetchTimeoutMs) {
  if (candidate.kind === 'file') {
    return { data: await readFile(candidate.ref), mime: mimeFromPath(candidate.ref) ?? 'image/png' };
  }
  // AbortSignal.timeout bounds headers AND body for undici fetch; an abort
  // rejects the await, which the caller's per-image try/catch degrades silently.
  const res = await fetchImpl(candidate.ref, { signal: AbortSignal.timeout(fetchTimeoutMs) });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const headerMime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const mime = headerMime.startsWith('image/') ? headerMime : (mimeFromPath(candidate.ref) ?? 'image/png');
  return { data: Buffer.from(await res.arrayBuffer()), mime };
}

// Fit one image into the REMAINING cumulative budget. If the original bytes
// already fit, attach them unchanged. Otherwise downscale through the ladder
// (sharp ships with the package) and attach the first rung whose JPEG output
// fits. If no rung fits, or sharp is unavailable/throws, return null so the
// caller skips the image with a note rather than breaking the whole call.
async function fitToBudget(entry, remaining) {
  if (entry.data.length <= remaining) return entry;
  try {
    const { default: sharp } = await import('sharp');
    for (const { dim, q } of DOWNSCALE_LADDER) {
      const data = await sharp(entry.data)
        .resize({ width: dim, height: dim, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: q })
        .toBuffer();
      if (data.length <= remaining) return { data, mime: 'image/jpeg' };
    }
    return null;
  } catch {
    return null;
  }
}

export async function collectInlineImages({
  toolName, input, stdout, env = process.env, fetchImpl = fetch,
  fetchTimeoutMs = FETCH_TIMEOUT_MS, budgetRaw = INLINE_BUDGET_RAW,
}) {
  const empty = { blocks: [], notes: [] };
  if (env.SOGNI_MCP_NO_INLINE_IMAGES === '1') return empty;
  if (!isInlineScoped(toolName, input)) return empty;

  const blocks = [];
  const notes = [];
  let attachedRawTotal = 0;
  for (const candidate of sourceCandidates(toolName, input, stdout)) {
    if (blocks.length >= MAX_INLINE_IMAGES) break;
    try {
      const remaining = budgetRaw - attachedRawTotal;
      const fitted = await fitToBudget(await obtainBytes(candidate, fetchImpl, fetchTimeoutMs), remaining);
      if (!fitted) {
        if (!notes.includes(TOO_LARGE_NOTE)) notes.push(TOO_LARGE_NOTE);
        continue;
      }
      attachedRawTotal += fitted.data.length;
      blocks.push({ type: 'image', data: fitted.data.toString('base64'), mimeType: fitted.mime });
    } catch {
      // Silent per-image degradation: the text block still carries the link.
    }
  }
  return { blocks, notes };
}
