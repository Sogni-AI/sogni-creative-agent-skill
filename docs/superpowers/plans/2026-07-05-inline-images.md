# Inline Images in the Claude Desktop MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Image-producing MCP tools return full-resolution MCP image content blocks (rendered inline by Claude Desktop) ahead of the existing text block, per `docs/superpowers/specs/2026-07-04-inline-images-design.md`.

**Architecture:** A new pure module `desktop-extension/server/inline-images.mjs` turns (toolName, input, CLI stdout) into MCP image blocks — descriptor parsing, byte sourcing (localPath read / presigned-URL fetch), and a 3.5MB safety valve that downscales via the package's existing `sharp` (dynamic import). `index.mjs` calls it only on exit-code-0 for scoped tools and prepends the blocks; any failure silently degrades to today's text-only result.

**Tech Stack:** Node ≥22.11 built-ins (`node:fs/promises`, global `fetch`, `node:http` in tests), dynamic `import('sharp')` (already a package dependency — NOT a new one).

## Global Constraints

- Repo: `/Users/krunkosaurus/Documents/git/sogni/sogni-creative-agent-skill`, work on branch `feature/inline-images` cut from current `main`.
- No new `dependencies` in package.json. `sharp` is already a dependency; the server may only reach it via dynamic `import('sharp')` inside try/catch.
- MCP framing: server stdout is protocol-only; one JSON-RPC message per line. Never `console.log` from server code.
- Commitlint (husky): commit body REQUIRED — blank line after subject, body ≥72 chars total, body lines <120 chars, subject ≥16 chars.
- Failure posture (spec): any inline-pipeline failure degrades silently to the current text-only result; the inline step runs only when the CLI exited 0.
- Exact values from the spec: inline cap **4** images; size ceiling **3.5 MB raw** (`3.5 * 1024 * 1024` bytes = 3670016); downscale to fit **2048px**, JPEG quality **85**; opt-out env **`SOGNI_MCP_NO_INLINE_IMAGES=1`**; scoped tools: `generate_image`, `photobooth`, and `edit_video` actions `extract_first_frame`/`extract_last_frame`; too-large text note: `One image was too large to display inline; use the link above.`
- Scheme filter: accept `http://` and `https://` URLs (spec said https-only; relaxed to http(s) because URLs come from trusted CLI stdout and hermetic tests need a 127.0.0.1 http server — record this as an approved spec deviation in commit/report).
- `npm test` = `check:creative-agent-runtime` + all `test/*.test.mjs` (currently 337 passing). Focused file while iterating; full suite once before each commit.
- Do NOT touch the untracked `.sogni-installed.json`.

## File Structure

```
desktop-extension/server/inline-images.mjs   # NEW — all inline-image logic (pure of protocol concerns)
desktop-extension/server/index.mjs           # wire-in at the code===0 close path
desktop-extension/server/tools.mjs           # +1 sentence on 3 tool descriptions
test/fixtures/fake-sogni-agent.mjs           # +FAKE_AGENT_STDOUT_FILE mode
test/desktop-extension.test.mjs              # module tests + protocol tests
desktop-extension/README.md                  # short inline-images section
```

---

### Task 1: `inline-images.mjs` module + fixture stdout mode

**Files:**
- Create: `desktop-extension/server/inline-images.mjs`
- Modify: `test/fixtures/fake-sogni-agent.mjs`
- Test: `test/desktop-extension.test.mjs` (append module-level test block)

**Interfaces:**
- Consumes: nothing from the codebase (built-ins + optional dynamic sharp).
- Produces (used by Task 2):
  - `collectInlineImages({ toolName, input, stdout, env?, fetchImpl? }) → Promise<{ blocks: Array<{type:'image', data:string, mimeType:string}>, notes: string[] }>`
  - Never throws for expected failures (bad JSON, missing file, failed fetch) — returns empty/partial results; `notes` carries the too-large message.
- Produces (used by Task 1–2 tests): fixture env `FAKE_AGENT_STDOUT_FILE=<path>` — the fake agent prints that file's contents verbatim as its stdout instead of the default echo JSON.

- [ ] **Step 1: Extend the fixture**

In `test/fixtures/fake-sogni-agent.mjs`, replace the `console.log(JSON.stringify({...}))` statement with:

```js
if (process.env.FAKE_AGENT_STDOUT_FILE) {
  // Emit caller-supplied stdout verbatim (e.g. a --json result descriptor).
  const { readFileSync } = await import('node:fs');
  process.stdout.write(readFileSync(process.env.FAKE_AGENT_STDOUT_FILE, 'utf8'));
} else {
  console.log(JSON.stringify({
    argv: process.argv.slice(2),
    env: {
      SOGNI_API_KEY: process.env.SOGNI_API_KEY ?? null,
      FFMPEG_PATH: process.env.FFMPEG_PATH ?? null,
    },
  }));
}
```

(Keep the existing SLEEP/STDERR/EXIT/PAD handling around it exactly as-is; the PAD append must still work in both branches.)

- [ ] **Step 2: Write the failing module tests** (append to `test/desktop-extension.test.mjs`; reuse its existing imports — `mkdtempSync`, `writeFileSync`, `join`, `tmpdir` are already imported; add `collectInlineImages` to the import block at the top)

```js
import { collectInlineImages } from '../desktop-extension/server/inline-images.mjs';

// 1x1 red PNG, 67 bytes — a real decodable PNG for byte-identity assertions.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('collectInlineImages: localPath descriptor yields one PNG block', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const img = join(dir, 'out.png');
  writeFileSync(img, TINY_PNG);
  const stdout = JSON.stringify({ type: 'image', localPath: img, urls: [] });
  const { blocks, notes } = await collectInlineImages({ toolName: 'generate_image', input: {}, stdout, env: {} });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'image');
  assert.equal(blocks[0].mimeType, 'image/png');
  assert.ok(Buffer.from(blocks[0].data, 'base64').equals(TINY_PNG));
  assert.deepEqual(notes, []);
});

test('collectInlineImages: urls descriptor fetches bytes (http allowed for trusted CLI output)', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(TINY_PNG);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/img.png`;
  try {
    const stdout = JSON.stringify({ type: 'image', localPath: null, urls: [url] });
    const { blocks } = await collectInlineImages({ toolName: 'photobooth', input: {}, stdout, env: {} });
    assert.equal(blocks.length, 1);
    assert.ok(Buffer.from(blocks[0].data, 'base64').equals(TINY_PNG));
    assert.equal(blocks[0].mimeType, 'image/png');
  } finally {
    server.close();
  }
});

test('collectInlineImages: caps inline images at 4', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const img = join(dir, 'a.png');
  writeFileSync(img, TINY_PNG);
  // 6 urls, all file-backed via localPath being absent — use a local http server for realism-lite:
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(TINY_PNG); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const urls = Array.from({ length: 6 }, (_, i) => `${base}/${i}.png`);
    const { blocks } = await collectInlineImages({ toolName: 'generate_image', input: {}, stdout: JSON.stringify({ urls }), env: {} });
    assert.equal(blocks.length, 4);
  } finally {
    server.close();
  }
});

test('collectInlineImages: out-of-scope tools and opt-out env return nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const img = join(dir, 'out.png');
  writeFileSync(img, TINY_PNG);
  const stdout = JSON.stringify({ localPath: img });
  const video = await collectInlineImages({ toolName: 'generate_video', input: {}, stdout, env: {} });
  assert.deepEqual(video, { blocks: [], notes: [] });
  const optOut = await collectInlineImages({
    toolName: 'generate_image', input: {}, stdout, env: { SOGNI_MCP_NO_INLINE_IMAGES: '1' },
  });
  assert.deepEqual(optOut, { blocks: [], notes: [] });
});

test('collectInlineImages: edit_video frame extraction reads the output path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const frame = join(dir, 'frame.jpg');
  writeFileSync(frame, TINY_PNG); // bytes don't need to be real JPEG for sourcing
  const { blocks } = await collectInlineImages({
    toolName: 'edit_video',
    input: { action: 'extract_last_frame', input: '/x.mp4', output: frame },
    stdout: 'non-json wrapper output',
    env: {},
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].mimeType, 'image/jpeg');
  const concat = await collectInlineImages({
    toolName: 'edit_video', input: { action: 'concat_videos', clips: ['/a.mp4','/b.mp4'], output: '/o.mp4' },
    stdout: '', env: {},
  });
  assert.deepEqual(concat, { blocks: [], notes: [] });
});

test('collectInlineImages: unparseable stdout and unreadable files degrade silently', async () => {
  const garbage = await collectInlineImages({ toolName: 'generate_image', input: {}, stdout: 'not json at all', env: {} });
  assert.deepEqual(garbage, { blocks: [], notes: [] });
  const missing = await collectInlineImages({
    toolName: 'generate_image', input: {}, stdout: JSON.stringify({ localPath: '/nonexistent/nope.png' }), env: {},
  });
  assert.deepEqual(missing, { blocks: [], notes: [] });
});

test('collectInlineImages: oversize non-image bytes are skipped with a note', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const big = join(dir, 'big.png');
  writeFileSync(big, Buffer.alloc(4 * 1024 * 1024, 7)); // >3.5MB, not a real PNG → sharp fails → skip
  const { blocks, notes } = await collectInlineImages({
    toolName: 'generate_image', input: {}, stdout: JSON.stringify({ localPath: big }), env: {},
  });
  assert.equal(blocks.length, 0);
  assert.deepEqual(notes, ['One image was too large to display inline; use the link above.']);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/desktop-extension.test.mjs`
Expected: FAIL — `Cannot find module '../desktop-extension/server/inline-images.mjs'`

- [ ] **Step 4: Implement `inline-images.mjs`**

```js
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/desktop-extension.test.mjs`
Expected: PASS (all prior + 7 new)

- [ ] **Step 6: Full suite, then commit**

Run: `npm test` — Expected: pass (344+), fail 0.

```bash
git add desktop-extension/server/inline-images.mjs test/fixtures/fake-sogni-agent.mjs test/desktop-extension.test.mjs
git commit -m "feat(desktop): add inline-image collection module for MCP results" -m "Parses the CLI's --json descriptor (localPath or presigned urls), sources the
bytes, and returns full-resolution MCP image blocks with a 3.5MB safety valve
that downscales via the package's existing sharp dependency. Expected failures
degrade silently so callers never do worse than the text-only result. Approved
spec deviation: URL filter accepts http(s), not https-only, since URLs come
from trusted CLI stdout and hermetic tests use a 127.0.0.1 http server."
```

---

### Task 2: Wire into `index.mjs` + tool descriptions + protocol tests

**Files:**
- Modify: `desktop-extension/server/index.mjs:89-96` (the `child.on('close')` handler) and the import block
- Modify: `desktop-extension/server/tools.mjs` (3 descriptions)
- Test: `test/desktop-extension.test.mjs` (append protocol test block)

**Interfaces:**
- Consumes: `collectInlineImages({ toolName, input, stdout, env?, fetchImpl? })` from Task 1; existing `McpClient` test helper and `FAKE_AGENT` fixture path already defined in the test file; fixture env `FAKE_AGENT_STDOUT_FILE`.
- Produces: `tools/call` results for scoped tools shaped `{ content: [...imageBlocks, {type:'text', text}], isError:false }`.

- [ ] **Step 1: Write the failing protocol tests** (append; `McpClient`, `FAKE_AGENT`, `mkdtempSync`, `writeFileSync`, `join`, `tmpdir`, and `TINY_PNG` already exist in the file)

```js
test('tools/call generate_image returns inline image block ahead of text', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-proto-'));
  const img = join(dir, 'render.png');
  writeFileSync(img, TINY_PNG);
  const stdoutFile = join(dir, 'stdout.json');
  writeFileSync(stdoutFile, JSON.stringify({ type: 'image', localPath: img, urls: ['https://example.invalid/x.png'] }) + '\n');
  const client = new McpClient({ FAKE_AGENT_STDOUT_FILE: stdoutFile });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'generate_image', arguments: { prompt: 'a red pixel' } });
  assert.equal(res.result.isError ?? false, false);
  assert.equal(res.result.content.length, 2);
  assert.equal(res.result.content[0].type, 'image');
  assert.equal(res.result.content[0].mimeType, 'image/png');
  assert.ok(Buffer.from(res.result.content[0].data, 'base64').equals(TINY_PNG));
  assert.equal(res.result.content[1].type, 'text');
  assert.match(res.result.content[1].text, /localPath/);
});

test('tools/call inline opt-out env yields text-only', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-proto-'));
  const img = join(dir, 'render.png');
  writeFileSync(img, TINY_PNG);
  const stdoutFile = join(dir, 'stdout.json');
  writeFileSync(stdoutFile, JSON.stringify({ localPath: img }) + '\n');
  const client = new McpClient({ FAKE_AGENT_STDOUT_FILE: stdoutFile, SOGNI_MCP_NO_INLINE_IMAGES: '1' });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'generate_image', arguments: { prompt: 'x' } });
  assert.equal(res.result.content.length, 1);
  assert.equal(res.result.content[0].type, 'text');
});

test('tools/call failing CLI never attaches images', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-proto-'));
  const img = join(dir, 'render.png');
  writeFileSync(img, TINY_PNG);
  const stdoutFile = join(dir, 'stdout.json');
  writeFileSync(stdoutFile, JSON.stringify({ localPath: img }) + '\n');
  const client = new McpClient({ FAKE_AGENT_STDOUT_FILE: stdoutFile, FAKE_AGENT_EXIT: '2', FAKE_AGENT_STDERR: 'boom' });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'generate_image', arguments: { prompt: 'x' } });
  assert.equal(res.result.isError, true);
  assert.equal(res.result.content.length, 1);
  assert.equal(res.result.content[0].type, 'text');
});

test('tools/call generate_video stays text-only', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-proto-'));
  const stdoutFile = join(dir, 'stdout.json');
  writeFileSync(stdoutFile, JSON.stringify({ type: 'video', localPath: null, urls: ['https://example.invalid/v.mp4'] }) + '\n');
  const client = new McpClient({ FAKE_AGENT_STDOUT_FILE: stdoutFile });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'generate_video', arguments: { prompt: 'x' } });
  assert.equal(res.result.content.length, 1);
  assert.equal(res.result.content[0].type, 'text');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/desktop-extension.test.mjs`
Expected: the first two new tests FAIL (content.length is 1, no image block); the failing-CLI and video tests may already pass — note which in the report.

- [ ] **Step 3: Wire `index.mjs`**

Add to the import block:

```js
import { collectInlineImages } from './inline-images.mjs';
```

Replace the `child.on('close', ...)` handler (currently lines 89–96) with:

```js
    child.on('close', async (code) => {
      const text = [stdout.trim(), code === 0 ? '' : stderr.trim()].filter(Boolean).join('\n')
        || `sogni-agent exited with code ${code}`;
      // Success output is front-loaded (e.g. result JSON) so keep the head; on
      // failure the actionable error is at the tail, so keep the tail instead.
      const clipped = code === 0 ? text.slice(0, MAX_RESULT_CHARS) : text.slice(-MAX_RESULT_CHARS);
      if (code !== 0) {
        finish(textResult(clipped, true));
        return;
      }
      // Inline images: best-effort. Any failure here must not degrade the
      // text result, so the whole step is fenced.
      let inline = { blocks: [], notes: [] };
      try {
        inline = await collectInlineImages({ toolName: name, input: input ?? {}, stdout });
      } catch {
        inline = { blocks: [], notes: [] };
      }
      const finalText = [clipped, ...inline.notes].join('\n');
      finish({ content: [...inline.blocks, { type: 'text', text: finalText }], isError: false });
    });
```

(`name` and `input` are already in scope as `callTool`'s parameters. `finish` resolves once; the async handler is safe because `finish` is idempotent against the error path.)

- [ ] **Step 4: Update the three tool descriptions in `tools.mjs`**

Append one sentence to the `description` string of `generate_image`, `photobooth`, and `edit_video` (exact copy): `Image results are attached inline in the tool result.` — for `edit_video`, use: `Extracted frames are attached inline in the tool result.`

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/desktop-extension.test.mjs`
Expected: PASS (all).

- [ ] **Step 6: Full suite, then commit**

Run: `npm test` — Expected: fail 0.

```bash
git add desktop-extension/server/index.mjs desktop-extension/server/tools.mjs test/desktop-extension.test.mjs
git commit -m "feat(desktop): attach inline image blocks to successful tool results" -m "On exit-code-0 for generate_image, photobooth, and frame-extraction calls the
server now prepends MCP image content blocks so Claude Desktop renders results
inline; the text block (URL, path, seed details) is unchanged and any inline
failure is fenced so results never regress below today's text-only behavior."
```

---

### Task 3: Docs + PR

**Files:**
- Modify: `desktop-extension/README.md` (after the Layout section)
- Modify: `README.md` (one sentence in the `## Claude Desktop` section)

**Interfaces:** none (docs), then branch push + PR.

- [ ] **Step 1: `desktop-extension/README.md`** — add after the Layout section:

```markdown
## Inline images

Successful `generate_image`, `photobooth`, and frame-extraction calls attach
the rendered image(s) to the tool result as MCP image content blocks, which
Claude Desktop displays inline (up to 4 per call, full resolution; images
that would exceed the ~3.5MB content ceiling are downscaled via `sharp`, or
skipped with a note if that fails). The text block always keeps the hosted
URL / saved path. Set `SOGNI_MCP_NO_INLINE_IMAGES=1` in the server env to
disable.
```

- [ ] **Step 2: `README.md`** — in the `## Claude Desktop` section, append this sentence to the paragraph describing the recommended install: `Generated images display inline in the chat automatically.`

- [ ] **Step 3: Full suite (docs-consistency), then commit**

Run: `npm test` — Expected: fail 0.

```bash
git add desktop-extension/README.md README.md
git commit -m "docs(desktop): document inline image rendering behavior" -m "Documents the inline MCP image blocks (scope, 4-image cap, 3.5MB safety valve
with sharp downscale, SOGNI_MCP_NO_INLINE_IMAGES opt-out) in the extension
README and adds a one-line mention to the main README's Claude Desktop section."
```

- [ ] **Step 4: Push branch, open PR**

```bash
git push -u origin feature/inline-images
gh pr create --repo Sogni-AI/sogni-creative-agent-skill --head feature/inline-images \
  --title "feat: inline image rendering in Claude Desktop tool results" \
  --body "Implements docs/superpowers/specs/2026-07-04-inline-images-design.md: image-producing MCP tools attach full-resolution image content blocks (localPath read or presigned-URL fetch from the CLI --json descriptor) ahead of the existing text block. 4-image cap, 3.5MB safety valve via existing sharp dep, silent text-only degradation, SOGNI_MCP_NO_INLINE_IMAGES opt-out.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR URL printed; CI (package contents + Node 22.11/24 tests) green.

---

### Task 4: Merge + release 3.11.0 + prod refresh (controller-level; follows the release-process runbook)

- [ ] Merge the PR once CI is green: `gh pr merge <n> --repo Sogni-AI/sogni-creative-agent-skill --merge --delete-branch`
- [ ] `git checkout main && git pull`
- [ ] Release: `GITHUB_TOKEN=$(gh auth token) npx semantic-release --no-ci` → expect **3.11.0** published (feat commits → minor)
- [ ] Post-release commits (runbook): `git add package-lock.json` + `chore(deps): sync skill lockfile version` (with commitlint body); then `npm run sync:version` + `chore(release): stamp 3.11.0 version metadata across manifests` (with body); push
- [ ] `npm test` → fail 0
- [ ] Verify: `npm view @sogni-ai/sogni-creative-agent-skill version` → 3.11.0; `npm pack @sogni-ai/sogni-creative-agent-skill@3.11.0 --dry-run 2>&1 | grep inline-images` → file listed
- [ ] Refresh this machine: `npm i -g @sogni-ai/sogni-creative-agent-skill@3.11.0`, then stdio smoke (initialize + tools/list) against the config entry's server path → serverInfo 3.11.0, 10 tools

---

## Self-Review Notes

- Spec coverage: scope table → Task 1 (`isInlineScoped` + tests), sourcing → Task 1, safety valve → Task 1 (skip branch tested; downscale-success branch is code-reviewed only — sharp-generated >3.5MB fixtures are size-unstable, accepted gap), failure posture → Tasks 1–2 tests, opt-out → both levels, content order → Task 2 test, docs → Task 3, ship → Task 4.
- Deviation ledger: http(s) scheme filter (recorded in Task 1 commit body).
- Type consistency: `collectInlineImages` signature identical in Task 1 definition, Task 1 tests, and Task 2 wiring; `TINY_PNG`/`McpClient`/`FAKE_AGENT_STDOUT_FILE` names consistent.
