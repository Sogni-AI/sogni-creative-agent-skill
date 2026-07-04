# Claude Desktop Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Desktop users generate images/video/music via Sogni by shipping a dependency-free local MCP server (wrapping the globally-installed `sogni-agent` CLI) as both an `.mcpb` bundle and an npm-shipped file, plus a `claude-desktop` adapter and an interactive ffmpeg install-offer in the `setup-sogni-agent-skill` installer.

**Architecture:** A thin, dependency-free MCP stdio server at `desktop-extension/server/` in the main repo translates ~10 MCP tools into `sogni-agent` CLI invocations, spawned with `process.execPath` and absolute paths (Claude Desktop launches with a minimal GUI PATH — nothing may rely on PATH lookup). The installer registers it programmatically by merging an entry into `claude_desktop_config.json`; the `.mcpb` bundle is the manual drag-drop alternative for no-terminal users. Both point at the same server file; personas/memories/credentials stay shared with Claude Code via `~/.config/sogni/`.

**Tech Stack:** Node ≥22.11 built-ins only (no new runtime deps), `node --test`, MCP protocol rev `2025-06-18` over newline-delimited JSON-RPC 2.0 stdio, `@anthropic-ai/mcpb` CLI (dev-time only) for packing.

## Global Constraints

- **Two repos.** Tasks 1–5: `/Users/krunkosaurus/Documents/git/sogni/sogni-creative-agent-skill` (main repo). Tasks 6–11: `/Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill` (installer repo). Never mix files across repos in one commit.
- **Main-repo commitlint (husky) REQUIRES a commit body**: body non-empty, ≥72 chars, blank line after subject, body lines ≤120 chars, subject ≥16 chars. Every main-repo commit command below includes a body — do not strip it. The installer repo has no commitlint; use the same conventional style anyway.
- **No new `dependencies` in either package.json.** The MCP server and adapter use Node built-ins only.
- **Never rely on PATH at runtime in the MCP server** — Claude Desktop's GUI environment lacks `/opt/homebrew/bin` and npm's global bin dir. Spawn via `process.execPath` + absolute script paths; pass `FFMPEG_PATH` explicitly.
- **MCP framing:** one JSON-RPC 2.0 message per line (newline-delimited), UTF-8, protocol logs to stderr only — a single stray `console.log` corrupts the protocol.
- **Config-file safety:** when touching `claude_desktop_config.json`, merge — never clobber. If it exists but is invalid JSON, fail with a clear message rather than overwrite.
- **Empty `SOGNI_API_KEY` env must be deleted, not passed through** — the `.mcpb` `user_config` template injects `""` when the user leaves the field blank, which would shadow `~/.config/sogni/credentials`.
- **Release ordering:** the installer's claude-desktop adapter requires main-repo package ≥3.7.0 (first version shipping `desktop-extension/`). Main repo publishes first (manual runbook: `npm version` → `sync:version` → CHANGELOG → test → commit → tag → publish). Installer release follows.
- Main repo `npm test` = `npm run check:creative-agent-runtime && node --test test/*.test.mjs`. Installer `npm test` = `node --test test/*.test.mjs test/setup.integration.mjs`. Run the full suite before every commit.

---

# Part 1 — Main repo: `sogni-creative-agent-skill`

**File structure created in Part 1:**

```
desktop-extension/
  manifest.json            # MCPB manifest v0.3, version stamped by sync-version
  server/
    index.mjs              # MCP stdio server: framing, dispatch, spawn, progress
    tools.mjs              # TOOLS registry: schemas + pure buildArgs() per tool
    resolve.mjs            # absolute-path resolution: agent, ffmpeg, child env
test/desktop-extension.test.mjs      # resolve + tools + manifest-parity + protocol tests
test/fixtures/fake-sogni-agent.mjs   # echo stub standing in for the real CLI
scripts/build-mcpb.mjs               # (not needed — npm script uses npx directly)
```

### Task 1: Path resolution module + fake-agent fixture

**Files:**
- Create: `desktop-extension/server/resolve.mjs`
- Create: `test/fixtures/fake-sogni-agent.mjs`
- Test: `test/desktop-extension.test.mjs` (new file, first test block)

**Interfaces:**
- Consumes: nothing (built-ins only).
- Produces (used by Task 3):
  - `resolveAgentPath({ env?, home? }) → string | null` — absolute path to `sogni-agent.mjs` or null.
  - `resolveFfmpegPath({ env? }) → string | null`
  - `buildChildEnv({ env?, agentPath, ffmpegPath? }) → object` — env for the spawned CLI: PATH prepended with common bin dirs, `FFMPEG_PATH` set when resolved, empty `SOGNI_API_KEY` deleted.
- Produces (used by Tasks 3–4 tests): `test/fixtures/fake-sogni-agent.mjs` — prints one JSON line `{argv, env:{SOGNI_API_KEY, FFMPEG_PATH}}`; exits with `FAKE_AGENT_EXIT` code if set; writes `FAKE_AGENT_STDERR` to stderr if set; sleeps `FAKE_AGENT_SLEEP_MS` first if set.

- [ ] **Step 1: Write the fixture**

```js
#!/usr/bin/env node
// test/fixtures/fake-sogni-agent.mjs
// Stand-in for the real CLI: echoes how it was invoked so tests can assert
// argv construction and env plumbing without touching the network.
if (process.env.FAKE_AGENT_SLEEP_MS) {
  await new Promise((r) => setTimeout(r, Number(process.env.FAKE_AGENT_SLEEP_MS)));
}
if (process.env.FAKE_AGENT_STDERR) {
  process.stderr.write(process.env.FAKE_AGENT_STDERR);
}
console.log(JSON.stringify({
  argv: process.argv.slice(2),
  env: {
    SOGNI_API_KEY: process.env.SOGNI_API_KEY ?? null,
    FFMPEG_PATH: process.env.FFMPEG_PATH ?? null,
  },
}));
process.exit(Number(process.env.FAKE_AGENT_EXIT ?? 0));
```

- [ ] **Step 2: Write the failing tests**

Create `test/desktop-extension.test.mjs` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import {
  resolveAgentPath, resolveFfmpegPath, buildChildEnv,
} from '../desktop-extension/server/resolve.mjs';

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'sogni-desktop-'));
}

test('resolveAgentPath honours SOGNI_AGENT_PATH when the file exists', () => {
  const home = tempHome();
  const agent = join(home, 'sogni-agent.mjs');
  writeFileSync(agent, '// stub');
  assert.equal(resolveAgentPath({ env: { SOGNI_AGENT_PATH: agent }, home }), agent);
});

test('resolveAgentPath returns null for a dangling SOGNI_AGENT_PATH', () => {
  const home = tempHome();
  assert.equal(resolveAgentPath({ env: { SOGNI_AGENT_PATH: join(home, 'missing.mjs') }, home }), null);
});

test('resolveAgentPath probes ~/.npm-global and nvm layouts', () => {
  const home = tempHome();
  const rel = join('lib', 'node_modules', '@sogni-ai', 'sogni-creative-agent-skill');
  const npmGlobal = join(home, '.npm-global', rel);
  mkdirSync(npmGlobal, { recursive: true });
  writeFileSync(join(npmGlobal, 'sogni-agent.mjs'), '// stub');
  assert.equal(resolveAgentPath({ env: {}, home }), join(npmGlobal, 'sogni-agent.mjs'));

  const home2 = tempHome();
  const nvm = join(home2, '.nvm', 'versions', 'node', 'v22.11.0', rel);
  mkdirSync(nvm, { recursive: true });
  writeFileSync(join(nvm, 'sogni-agent.mjs'), '// stub');
  assert.equal(resolveAgentPath({ env: {}, home: home2 }), join(nvm, 'sogni-agent.mjs'));
});

test('resolveAgentPath returns null when nothing is installed', () => {
  assert.equal(resolveAgentPath({ env: {}, home: tempHome() }), null);
});

test('buildChildEnv prepends bin dirs, sets FFMPEG_PATH, drops empty SOGNI_API_KEY', () => {
  const env = buildChildEnv({
    env: { PATH: '/usr/bin', SOGNI_API_KEY: '' },
    agentPath: '/g/node_modules/@sogni-ai/sogni-creative-agent-skill/sogni-agent.mjs',
    ffmpegPath: '/opt/homebrew/bin/ffmpeg',
  });
  const parts = env.PATH.split(delimiter);
  assert.ok(parts.includes('/opt/homebrew/bin'));
  assert.ok(parts.includes('/usr/local/bin'));
  assert.ok(parts.includes('/usr/bin'));
  assert.equal(env.FFMPEG_PATH, '/opt/homebrew/bin/ffmpeg');
  assert.equal('SOGNI_API_KEY' in env, false);
});

test('buildChildEnv keeps a non-empty SOGNI_API_KEY', () => {
  const env = buildChildEnv({ env: { PATH: '/usr/bin', SOGNI_API_KEY: 'sk-1' }, agentPath: '/x/sogni-agent.mjs' });
  assert.equal(env.SOGNI_API_KEY, 'sk-1');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/desktop-extension.test.mjs`
Expected: FAIL — `Cannot find module '../desktop-extension/server/resolve.mjs'`

- [ ] **Step 4: Implement `resolve.mjs`**

```js
// desktop-extension/server/resolve.mjs
// Claude Desktop launches MCP servers with a minimal GUI environment: no
// /opt/homebrew/bin, no npm global bin dir. Everything here resolves to
// absolute paths so the wrapper never depends on PATH lookup.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const PKG_REL = join('@sogni-ai', 'sogni-creative-agent-skill');

function nvmCandidates(home) {
  const base = join(home, '.nvm', 'versions', 'node');
  let versions;
  try {
    versions = readdirSync(base);
  } catch {
    return [];
  }
  return versions
    .sort()
    .reverse()
    .map((v) => join(base, v, 'lib', 'node_modules', PKG_REL, 'sogni-agent.mjs'));
}

export function resolveAgentPath({ env = process.env, home = homedir() } = {}) {
  if (env.SOGNI_AGENT_PATH) {
    return existsSync(env.SOGNI_AGENT_PATH) ? env.SOGNI_AGENT_PATH : null;
  }
  const candidates = [
    join('/opt/homebrew/lib/node_modules', PKG_REL, 'sogni-agent.mjs'),
    join('/usr/local/lib/node_modules', PKG_REL, 'sogni-agent.mjs'),
    join('/usr/lib/node_modules', PKG_REL, 'sogni-agent.mjs'),
    join(home, '.npm-global', 'lib', 'node_modules', PKG_REL, 'sogni-agent.mjs'),
    ...(env.APPDATA ? [join(env.APPDATA, 'npm', 'node_modules', PKG_REL, 'sogni-agent.mjs')] : []),
    ...nvmCandidates(home),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function resolveFfmpegPath({ env = process.env } = {}) {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function buildChildEnv({ env = process.env, agentPath, ffmpegPath = null } = {}) {
  const extraBins = ['/opt/homebrew/bin', '/usr/local/bin'];
  if (agentPath) extraBins.push(dirname(agentPath));
  const child = {
    ...env,
    PATH: [...extraBins, env.PATH ?? ''].filter(Boolean).join(delimiter),
  };
  if (ffmpegPath) child.FFMPEG_PATH = ffmpegPath;
  // The .mcpb user_config template injects "" when the API-key field is left
  // blank; an empty env var would shadow ~/.config/sogni/credentials.
  if (child.SOGNI_API_KEY === '') delete child.SOGNI_API_KEY;
  return child;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/desktop-extension.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test`
Expected: all existing tests still pass.

```bash
git add desktop-extension/server/resolve.mjs test/fixtures/fake-sogni-agent.mjs test/desktop-extension.test.mjs
git commit -m "feat(desktop): add path resolution for the Claude Desktop MCP wrapper" -m "Claude Desktop spawns MCP servers with a minimal GUI PATH, so the wrapper resolves the globally installed sogni-agent.mjs, ffmpeg, and the child process env to absolute paths. Includes a fake-agent test fixture used by later protocol tests."
```

---

### Task 2: MCP tool registry (`tools.mjs`) — schemas + pure argv builders

**Files:**
- Create: `desktop-extension/server/tools.mjs`
- Modify: `test/desktop-extension.test.mjs` (append test block)

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 3):
  - `TOOLS: Array<{name: string, description: string, inputSchema: object, buildArgs(input: object) → string[]}>`
  - `getTool(name: string) → tool | undefined`
  - `buildArgs` throws `Error` with a user-readable message on invalid input (missing required action fields); returns the full CLI argv (no command prefix).

Ten tools: `generate_image`, `generate_video`, `generate_music`, `photobooth`, `edit_video`, `list_media`, `manage_personas`, `manage_memories`, `sogni_doctor`, `account_balance`.

- [ ] **Step 1: Write the failing tests** (append to `test/desktop-extension.test.mjs`)

```js
import { TOOLS, getTool } from '../desktop-extension/server/tools.mjs';

test('TOOLS exposes the expected v1 tool names', () => {
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), [
    'account_balance', 'edit_video', 'generate_image', 'generate_music',
    'generate_video', 'list_media', 'manage_memories', 'manage_personas',
    'photobooth', 'sogni_doctor',
  ]);
  for (const t of TOOLS) {
    assert.equal(typeof t.description, 'string');
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(typeof t.buildArgs, 'function');
  }
});

test('generate_image builds quiet JSON argv with prompt last', () => {
  const args = getTool('generate_image').buildArgs({
    prompt: 'a cat wearing a hat',
    output_path: '/tmp/cat.png',
    quality: 'pro',
    width: 1024,
    height: 768,
    context_images: ['/tmp/a.jpg', '/tmp/b.jpg'],
  });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check',
    '-o', '/tmp/cat.png', '-Q', 'pro', '-w', '1024', '-h', '768',
    '-c', '/tmp/a.jpg', '-c', '/tmp/b.jpg',
    'a cat wearing a hat',
  ]);
});

test('generate_video maps refs and duration', () => {
  const args = getTool('generate_video').buildArgs({
    prompt: 'cat walks around',
    ref: '/tmp/cat.jpg',
    duration: 8,
    model: 'wan_v2.2-14b-fp8_i2v_lightx2v',
    output_path: '/tmp/cat.mp4',
  });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check', '--video',
    '-o', '/tmp/cat.mp4', '-m', 'wan_v2.2-14b-fp8_i2v_lightx2v',
    '--duration', '8', '--ref', '/tmp/cat.jpg',
    'cat walks around',
  ]);
});

test('generate_music maps lyrics and format', () => {
  const args = getTool('generate_music').buildArgs({
    prompt: 'bright indie pop chorus',
    lyrics: 'Rise with the morning light',
    duration: 30,
    bpm: 128,
    audio_format: 'mp3',
  });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check', '--music',
    '--lyrics', 'Rise with the morning light', '--duration', '30',
    '--bpm', '128', '--output-format', 'mp3',
    'bright indie pop chorus',
  ]);
});

test('photobooth requires ref', () => {
  assert.throws(() => getTool('photobooth').buildArgs({ prompt: 'headshot' }), /ref/);
  const args = getTool('photobooth').buildArgs({ prompt: 'headshot', ref: '/tmp/face.jpg', count: 4 });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check', '--photobooth',
    '--ref', '/tmp/face.jpg', '-n', '4', 'headshot',
  ]);
});

test('edit_video dispatches per action and validates inputs', () => {
  const t = getTool('edit_video');
  assert.deepEqual(
    t.buildArgs({ action: 'extract_last_frame', input: '/tmp/a.mp4', output: '/tmp/last.png' }),
    ['--no-update-check', '--extract-last-frame', '/tmp/a.mp4', '/tmp/last.png'],
  );
  assert.deepEqual(
    t.buildArgs({ action: 'concat_videos', clips: ['/a.mp4', '/b.mp4'], output: '/out.mp4', audio_path: '/song.mp3' }),
    ['--no-update-check', '--concat-videos', '/out.mp4', '/a.mp4', '/b.mp4', '--concat-audio', '/song.mp3'],
  );
  assert.deepEqual(
    t.buildArgs({ action: 'remix_audio', input: '/in.mp4', output: '/out.mp4', bed_audio: '/bed.mp3', audio_loop: true }),
    ['--no-update-check', '--remix-audio', '/in.mp4', '/out.mp4', '--bed-audio', '/bed.mp3', '--audio-loop'],
  );
  assert.throws(() => t.buildArgs({ action: 'concat_videos', clips: ['/only-one.mp4'], output: '/o.mp4' }), /two/i);
  assert.throws(() => t.buildArgs({ action: 'nope' }), /action/i);
});

test('manage_personas and manage_memories dispatch per action', () => {
  const p = getTool('manage_personas');
  assert.deepEqual(p.buildArgs({ action: 'list' }), ['--json', '--no-update-check', '--persona-list']);
  assert.deepEqual(
    p.buildArgs({ action: 'add', name: 'Mo', ref: '/tmp/mo.jpg', relationship: 'self' }),
    ['--no-update-check', '--persona-add', 'Mo', '--ref', '/tmp/mo.jpg', '--relationship', 'self'],
  );
  assert.throws(() => p.buildArgs({ action: 'add', name: 'Mo' }), /ref/);
  assert.throws(() => p.buildArgs({ action: 'remove' }), /name/);

  const m = getTool('manage_memories');
  assert.deepEqual(m.buildArgs({ action: 'list' }), ['--json', '--no-update-check', '--memory-list']);
  assert.deepEqual(
    m.buildArgs({ action: 'set', key: 'preferred_style', value: 'watercolor' }),
    ['--no-update-check', '--memory-set', 'preferred_style', 'watercolor'],
  );
  assert.throws(() => m.buildArgs({ action: 'set', key: 'k' }), /value/);
});

test('doctor, balance, list_media argv', () => {
  assert.deepEqual(getTool('sogni_doctor').buildArgs({}), ['--doctor', '--json', '--no-update-check']);
  assert.deepEqual(getTool('account_balance').buildArgs({}), ['--balances', '--json', '--no-update-check']);
  assert.deepEqual(getTool('list_media').buildArgs({}), ['--json', '--no-update-check', '--list-media', 'images']);
  assert.deepEqual(getTool('list_media').buildArgs({ type: 'audio' }), ['--json', '--no-update-check', '--list-media', 'audio']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/desktop-extension.test.mjs`
Expected: FAIL — `Cannot find module '../desktop-extension/server/tools.mjs'`

- [ ] **Step 3: Implement `tools.mjs`**

```js
// desktop-extension/server/tools.mjs
// MCP tool registry: JSON Schemas shown to Claude Desktop plus pure
// buildArgs() functions that translate tool input into sogni-agent argv.
// buildArgs never spawns anything — index.mjs owns process execution.

const GEN_BASE = ['--json', '-q', '--no-update-check'];

function push(args, flag, value) {
  if (value !== undefined && value !== null && value !== '') args.push(flag, String(value));
}

function required(input, field, hint) {
  const v = input[field];
  if (v === undefined || v === null || v === '') {
    throw new Error(`${field} is required${hint ? ` — ${hint}` : ''}.`);
  }
  return v;
}

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

export const TOOLS = [
  {
    name: 'generate_image',
    description:
      'Generate one or more images from a text prompt on the Sogni GPU network. ' +
      'Pass output_path (absolute, .png/.jpg) to save locally; otherwise a hosted URL is returned. ' +
      'Use context_images for image editing ("make the background a beach") and persona to include a saved person.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: str('What to generate'),
        output_path: str('Absolute file path to save the image (optional)'),
        quality: { type: 'string', enum: ['fast', 'hq', 'pro'], description: 'Quality preset' },
        model: str('Model id (optional; overrides quality preset)'),
        width: num('Width in px (default 512)'),
        height: num('Height in px (default 512)'),
        count: num('Number of images (default 1)'),
        seed: num('Fixed seed for reproducibility'),
        context_images: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of context/edit images' },
        persona: str('Saved persona name to use as reference'),
        timeout_seconds: num('Generation timeout override'),
      },
      required: ['prompt'],
    },
    buildArgs(input) {
      const prompt = required(input, 'prompt');
      const args = [...GEN_BASE];
      push(args, '-o', input.output_path);
      push(args, '-Q', input.quality);
      push(args, '-m', input.model);
      push(args, '-w', input.width);
      push(args, '-h', input.height);
      push(args, '-n', input.count);
      push(args, '-s', input.seed);
      for (const c of input.context_images ?? []) push(args, '-c', c);
      push(args, '--persona', input.persona);
      push(args, '-t', input.timeout_seconds);
      args.push(prompt);
      return args;
    },
  },
  {
    name: 'generate_video',
    description:
      'Generate a video from a text prompt, optionally driven by reference media. ' +
      'ref = start frame image, ref_end = end frame, ref_audio = soundtrack/lip-sync audio, ref_video = motion reference. ' +
      'Rendering takes minutes; prefer output_path (absolute .mp4).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: str('Motion/scene description'),
        output_path: str('Absolute .mp4 path to save (optional)'),
        model: str('Video model id (optional)'),
        workflow: { type: 'string', enum: ['t2v', 'i2v', 's2v', 'ia2v', 'a2v', 'v2v', 'animate-move', 'animate-replace'] },
        duration: num('Duration in seconds (default 5)'),
        ref: str('Absolute path or URL of the start-frame image'),
        ref_end: str('Absolute path or URL of the end-frame image'),
        ref_audio: str('Absolute path or URL of reference audio'),
        ref_video: str('Absolute path or URL of reference video'),
        persona: str('Saved persona name (reference frame)'),
        target_resolution: num('Short-side target in px, preserves aspect'),
        timeout_seconds: num('Generation timeout override (default 300)'),
      },
      required: ['prompt'],
    },
    buildArgs(input) {
      const prompt = required(input, 'prompt');
      const args = [...GEN_BASE, '--video'];
      push(args, '-o', input.output_path);
      push(args, '-m', input.model);
      push(args, '--workflow', input.workflow);
      push(args, '--duration', input.duration);
      push(args, '--ref', input.ref);
      push(args, '--ref-end', input.ref_end);
      push(args, '--ref-audio', input.ref_audio);
      push(args, '--ref-video', input.ref_video);
      push(args, '--persona', input.persona);
      push(args, '--target-resolution', input.target_resolution);
      push(args, '-t', input.timeout_seconds);
      args.push(prompt);
      return args;
    },
  },
  {
    name: 'generate_music',
    description:
      'Generate music/audio from a text prompt. Omit lyrics for an instrumental. ' +
      'Duration 10-600 seconds. Prefer output_path (absolute .mp3/.wav/.flac).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: str('Style/mood description'),
        output_path: str('Absolute audio file path to save (optional)'),
        lyrics: str('Song lyrics (optional)'),
        duration: num('Seconds, 10-600 (default 30)'),
        bpm: num('Beats per minute (30-300)'),
        keyscale: str('Key/scale, e.g. "C major"'),
        music_model: str('turbo | sft | ace_step_1.5_turbo | ace_step_1.5_sft'),
        audio_format: { type: 'string', enum: ['mp3', 'flac', 'wav'] },
        timeout_seconds: num('Generation timeout override (default 600)'),
      },
      required: ['prompt'],
    },
    buildArgs(input) {
      const prompt = required(input, 'prompt');
      const args = [...GEN_BASE, '--music'];
      push(args, '-o', input.output_path);
      push(args, '--music-model', input.music_model);
      push(args, '--lyrics', input.lyrics);
      push(args, '--duration', input.duration);
      push(args, '--bpm', input.bpm);
      push(args, '--keyscale', input.keyscale);
      push(args, '--output-format', input.audio_format);
      push(args, '-t', input.timeout_seconds);
      args.push(prompt);
      return args;
    },
  },
  {
    name: 'photobooth',
    description:
      'Face-transfer portrait generation: renders the person in the ref photo into a new scene ' +
      '(e.g. "LinkedIn professional headshot", "80s fashion portrait").',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: str('Scene/style description'),
        ref: str('Absolute path or URL of the face photo'),
        output_path: str('Absolute image path to save (optional)'),
        count: num('Number of variations (default 1)'),
      },
      required: ['prompt', 'ref'],
    },
    buildArgs(input) {
      const prompt = required(input, 'prompt');
      const ref = required(input, 'ref', 'a face photo path or URL');
      const args = [...GEN_BASE, '--photobooth', '--ref', String(ref)];
      push(args, '-n', input.count);
      push(args, '-o', input.output_path);
      args.push(prompt);
      return args;
    },
  },
  {
    name: 'edit_video',
    description:
      'Safe local video utilities (ffmpeg wrappers): extract the first/last frame, ' +
      'concatenate clips (with optional soundtrack), or remix the audio of an existing video.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['extract_first_frame', 'extract_last_frame', 'concat_videos', 'remix_audio'] },
        input: str('Input video path (extract/remix actions)'),
        output: str('Output file path'),
        clips: { type: 'array', items: { type: 'string' }, description: 'Clip paths for concat_videos (min 2)' },
        audio_path: str('Soundtrack to mux over concat_videos output'),
        bed_audio: str('Audio bed for remix_audio'),
        audio_loop: { type: 'boolean', description: 'Loop the bed to cover the video (remix_audio)' },
      },
      required: ['action', 'output'],
    },
    buildArgs(input) {
      const action = required(input, 'action');
      const output = required(input, 'output');
      if (action === 'extract_first_frame' || action === 'extract_last_frame') {
        const src = required(input, 'input', 'the source video');
        return ['--no-update-check', `--${action.replaceAll('_', '-')}`, String(src), String(output)];
      }
      if (action === 'concat_videos') {
        const clips = input.clips ?? [];
        if (clips.length < 2) throw new Error('concat_videos needs at least two clips.');
        const args = ['--no-update-check', '--concat-videos', String(output), ...clips.map(String)];
        push(args, '--concat-audio', input.audio_path);
        return args;
      }
      if (action === 'remix_audio') {
        const src = required(input, 'input', 'the source video');
        const args = ['--no-update-check', '--remix-audio', String(src), String(output)];
        push(args, '--bed-audio', input.bed_audio);
        if (input.audio_loop) args.push('--audio-loop');
        return args;
      }
      throw new Error(`Unknown action "${action}".`);
    },
  },
  {
    name: 'list_media',
    description: 'List recent inbound media files the user sent to Sogni (images, audio, or all).',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['images', 'audio', 'all'] } },
    },
    buildArgs(input) {
      return ['--json', '--no-update-check', '--list-media', input.type ?? 'images'];
    },
  },
  {
    name: 'manage_personas',
    description:
      'Manage saved personas (named people with reference photos and optional voice clips). ' +
      'Actions: list, add (needs name + ref photo), remove, resolve (show details).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'remove', 'resolve'] },
        name: str('Persona name (add/remove/resolve)'),
        ref: str('Reference photo path or URL (add)'),
        relationship: { type: 'string', enum: ['self', 'partner', 'child', 'friend', 'pet'] },
        description: str('Appearance description (add)'),
        voice_clip: str('Voice clip audio path (add)'),
      },
      required: ['action'],
    },
    buildArgs(input) {
      const action = required(input, 'action');
      if (action === 'list') return ['--json', '--no-update-check', '--persona-list'];
      const name = required(input, 'name');
      if (action === 'remove') return ['--no-update-check', '--persona-remove', String(name)];
      if (action === 'resolve') return ['--json', '--no-update-check', '--persona-resolve', String(name)];
      if (action === 'add') {
        const ref = required(input, 'ref', 'a reference photo for the persona');
        const args = ['--no-update-check', '--persona-add', String(name), '--ref', String(ref)];
        push(args, '--relationship', input.relationship);
        push(args, '--description', input.description);
        push(args, '--voice-clip', input.voice_clip);
        return args;
      }
      throw new Error(`Unknown action "${action}".`);
    },
  },
  {
    name: 'manage_memories',
    description:
      'Manage persistent user preferences (e.g. preferred_style). Actions: list, get, set, remove.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'set', 'remove'] },
        key: str('Memory key (get/set/remove)'),
        value: str('Memory value (set)'),
        category: { type: 'string', enum: ['preference', 'fact', 'context'] },
      },
      required: ['action'],
    },
    buildArgs(input) {
      const action = required(input, 'action');
      if (action === 'list') return ['--json', '--no-update-check', '--memory-list'];
      const key = required(input, 'key');
      if (action === 'get') return ['--json', '--no-update-check', '--memory-get', String(key)];
      if (action === 'remove') return ['--no-update-check', '--memory-remove', String(key)];
      if (action === 'set') {
        const value = required(input, 'value');
        const args = ['--no-update-check', '--memory-set', String(key), String(value)];
        push(args, '--memory-category', input.category);
        return args;
      }
      throw new Error(`Unknown action "${action}".`);
    },
  },
  {
    name: 'sogni_doctor',
    description:
      'Health check for the Sogni install: Node, credentials, ffmpeg, live auth, version. ' +
      'Run only after another tool fails — not as a routine preflight.',
    inputSchema: { type: 'object', properties: {} },
    buildArgs() {
      return ['--doctor', '--json', '--no-update-check'];
    },
  },
  {
    name: 'account_balance',
    description: 'Show the SPARK/SOGNI token balances for the configured Sogni account.',
    inputSchema: { type: 'object', properties: {} },
    buildArgs() {
      return ['--balances', '--json', '--no-update-check'];
    },
  },
];

export function getTool(name) {
  return TOOLS.find((t) => t.name === name);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/desktop-extension.test.mjs`
Expected: PASS (all Task 1 + Task 2 tests)

- [ ] **Step 5: Run full suite, then commit**

Run: `npm test`

```bash
git add desktop-extension/server/tools.mjs test/desktop-extension.test.mjs
git commit -m "feat(desktop): add MCP tool registry mapping tools to sogni-agent argv" -m "Ten v1 tools (image/video/music/photobooth generation, safe video editing, media listing, personas, memories, doctor, balance) as pure buildArgs functions with JSON Schemas, so the server layer stays a thin spawn loop and argv construction is unit-testable."
```

---

### Task 3: MCP stdio server (`index.mjs`) — framing, dispatch, spawn, progress

**Files:**
- Create: `desktop-extension/server/index.mjs`
- Modify: `test/desktop-extension.test.mjs` (append protocol test block)

**Interfaces:**
- Consumes: `TOOLS`, `getTool` (Task 2); `resolveAgentPath`, `resolveFfmpegPath`, `buildChildEnv` (Task 1).
- Produces: a stdio MCP server implementing `initialize`, `notifications/initialized` (ignored), `ping`, `tools/list`, `tools/call` (with `notifications/progress` when the client passes `_meta.progressToken`), JSON-RPC errors `-32700` (parse), `-32601` (unknown method). This file is the target of both the `.mcpb` manifest (Task 4) and the installer's config entry (Task 8) — its path `desktop-extension/server/index.mjs` is a published contract.

- [ ] **Step 1: Write the failing protocol tests** (append to `test/desktop-extension.test.mjs`)

```js
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'desktop-extension', 'server', 'index.mjs');
const FAKE_AGENT = join(HERE, 'fixtures', 'fake-sogni-agent.mjs');

// Minimal line-delimited JSON-RPC client for driving the server under test.
class McpClient {
  constructor(extraEnv = {}) {
    this.child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, SOGNI_AGENT_PATH: FAKE_AGENT, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pending = new Map();
    this.notifications = [];
    this.nextId = 1;
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id != null && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        } else {
          this.notifications.push(msg);
        }
      }
    });
  }
  request(method, params) {
    const id = this.nextId++;
    const p = new Promise((resolve) => this.pending.set(id, resolve));
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  }
  raw(text) {
    this.child.stdin.write(text + '\n');
  }
  close() {
    this.child.kill();
  }
}

test('initialize handshake returns serverInfo and tools capability', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  assert.equal(res.result.protocolVersion, '2025-06-18');
  assert.equal(res.result.serverInfo.name, 'sogni-creative-agent');
  assert.ok(res.result.capabilities.tools);
});

test('tools/list returns all registered tools', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('tools/list', {});
  assert.equal(res.result.tools.length, TOOLS.length);
  assert.ok(res.result.tools.every((tool) => tool.name && tool.description && tool.inputSchema));
});

test('tools/call spawns the CLI with built argv and returns its stdout', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('tools/call', {
    name: 'generate_image',
    arguments: { prompt: 'a red fox', quality: 'fast' },
  });
  assert.equal(res.result.isError ?? false, false);
  const echoed = JSON.parse(res.result.content[0].text);
  assert.deepEqual(echoed.argv, ['--json', '-q', '--no-update-check', '-Q', 'fast', 'a red fox']);
});

test('tools/call surfaces CLI failure as isError with stderr included', async (t) => {
  const client = new McpClient({ FAKE_AGENT_EXIT: '3', FAKE_AGENT_STDERR: 'boom: no credentials' });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'sogni_doctor', arguments: {} });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /boom: no credentials/);
});

test('tools/call with invalid input returns isError without spawning', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'photobooth', arguments: { prompt: 'x' } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /ref/);
});

test('missing CLI yields a setup hint, not a crash', async (t) => {
  const client = new McpClient({ SOGNI_AGENT_PATH: '/nonexistent/sogni-agent.mjs' });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'account_balance', arguments: {} });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /setup-sogni-agent-skill/);
});

test('unknown method returns -32601; parse error returns -32700', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('bogus/method', {});
  assert.equal(res.error.code, -32601);
  client.raw('{not json');
  await new Promise((r) => setTimeout(r, 200));
  const parseErr = client.notifications.find((m) => m.error?.code === -32700);
  assert.ok(parseErr, 'expected a -32700 response');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/desktop-extension.test.mjs`
Expected: FAIL — server file missing / connection tests time out quickly with module-not-found on spawn stderr.

- [ ] **Step 3: Implement `index.mjs`**

```js
#!/usr/bin/env node
// desktop-extension/server/index.mjs
// Dependency-free MCP stdio server for Claude Desktop. Translates tool calls
// into sogni-agent CLI invocations. Protocol: JSON-RPC 2.0, one message per
// line over stdio. IMPORTANT: stdout is protocol-only — log to stderr.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, getTool } from './tools.mjs';
import { buildChildEnv, resolveAgentPath, resolveFfmpegPath } from './resolve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_FALLBACK = '2025-06-18';
const HARD_KILL_MS = 15 * 60 * 1000; // generation ceiling; CLI enforces its own -t timeouts sooner
const PROGRESS_INTERVAL_MS = 10_000;
const MAX_RESULT_CHARS = 20_000;

let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(join(HERE, '..', 'manifest.json'), 'utf8')).version;
} catch {
  // Running outside a packaged layout (e.g. unit tests before Task 4); harmless.
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function callTool(name, input, progressToken) {
  const tool = getTool(name);
  if (!tool) return textResult(`Unknown tool: ${name}`, true);

  const agentPath = resolveAgentPath();
  if (!agentPath) {
    return textResult(
      'The sogni-agent CLI is not installed. Open a terminal, run `npx setup-sogni-agent-skill`, then retry.',
      true,
    );
  }

  let args;
  try {
    args = tool.buildArgs(input ?? {});
  } catch (err) {
    return textResult(err.message, true);
  }

  const env = buildChildEnv({ agentPath, ffmpegPath: resolveFfmpegPath() });

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [agentPath, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const started = Date.now();
    const ticker = progressToken == null
      ? null
      : setInterval(() => {
          send({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: Math.round((Date.now() - started) / 1000),
              message: `sogni-agent ${name} running…`,
            },
          });
        }, PROGRESS_INTERVAL_MS);
    const killer = setTimeout(() => child.kill('SIGKILL'), HARD_KILL_MS);

    const finish = (result) => {
      if (ticker) clearInterval(ticker);
      clearTimeout(killer);
      resolve(result);
    };

    child.on('error', (err) => finish(textResult(`Failed to launch sogni-agent: ${err.message}`, true)));
    child.on('close', (code) => {
      const text = [stdout.trim(), code === 0 ? '' : stderr.trim()].filter(Boolean).join('\n')
        || `sogni-agent exited with code ${code}`;
      finish(textResult(text.slice(-MAX_RESULT_CHARS), code !== 0));
    });
  });
}

async function dispatch(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_FALLBACK,
        capabilities: { tools: {} },
        serverInfo: { name: 'sogni-creative-agent', version: VERSION },
      },
    });
    return;
  }
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      },
    });
    return;
  }
  if (method === 'tools/call') {
    const result = await callTool(params?.name, params?.arguments, params?._meta?.progressToken);
    send({ jsonrpc: '2.0', id, result });
    return;
  }
  if (!isRequest || method?.startsWith('notifications/')) {
    return; // notifications need no response
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  dispatch(msg).catch((err) => {
    if (msg.id !== undefined && msg.id !== null) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err.message } });
    } else {
      process.stderr.write(`sogni desktop server error: ${err.stack}\n`);
    }
  });
});
rl.on('close', () => process.exit(0));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/desktop-extension.test.mjs`
Expected: PASS (all tests from Tasks 1–3)

- [ ] **Step 5: Run full suite, then commit**

Run: `npm test`

```bash
git add desktop-extension/server/index.mjs test/desktop-extension.test.mjs
git commit -m "feat(desktop): implement dependency-free MCP stdio server for Claude Desktop" -m "Newline-delimited JSON-RPC 2.0 loop implementing initialize, ping, tools/list, and tools/call. Spawns the globally installed sogni-agent via process.execPath with absolute paths, streams progress notifications for long renders, surfaces CLI failures as isError results, and hints at npx setup-sogni-agent-skill when the CLI is missing."
```

---

### Task 4: MCPB manifest, version stamping, npm packaging, build script

**Files:**
- Create: `desktop-extension/manifest.json`
- Modify: `scripts/sync-version.mjs` (add manifest to the stamp loop)
- Modify: `package.json` (`files` array + `build:mcpb` script)
- Modify: `.gitignore` (add `dist/`)
- Test: `test/desktop-extension.test.mjs` (append manifest-parity block)

**Interfaces:**
- Consumes: `desktop-extension/server/index.mjs` path (Task 3).
- Produces: `desktop-extension/` shipped in the npm tarball (contract for installer Task 8: `<npmRoot>/@sogni-ai/sogni-creative-agent-skill/desktop-extension/server/index.mjs` exists after global install); `npm run build:mcpb` → `dist/sogni-creative-agent.mcpb`.

- [ ] **Step 1: Write the failing parity tests** (append to `test/desktop-extension.test.mjs`)

```js
import { readFileSync, existsSync as fsExistsSync } from 'node:fs';

test('manifest.json version matches package.json and entry point exists', () => {
  const root = join(HERE, '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'desktop-extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.server.type, 'node');
  assert.ok(fsExistsSync(join(root, 'desktop-extension', manifest.server.entry_point)));
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.mjs']);
  assert.ok(pkg.files.includes('desktop-extension/'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/desktop-extension.test.mjs`
Expected: FAIL — manifest.json missing.

- [ ] **Step 3: Create `desktop-extension/manifest.json`**

Use the current `package.json` version (check with `node -p "require('./package.json').version"` — the value below assumes 3.6.4; use whatever is current):

```json
{
  "manifest_version": "0.3",
  "name": "sogni-creative-agent",
  "display_name": "Sogni Creative Agent",
  "version": "3.6.4",
  "description": "Generate images, video, and music on Sogni AI's decentralized GPU network — with personas, memories, and safe video editing tools.",
  "author": { "name": "Sogni AI", "url": "https://sogni.ai" },
  "homepage": "https://sogni.ai",
  "server": {
    "type": "node",
    "entry_point": "server/index.mjs",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.mjs"],
      "env": {
        "SOGNI_API_KEY": "${user_config.api_key}"
      }
    }
  },
  "user_config": {
    "api_key": {
      "type": "string",
      "title": "Sogni API key",
      "description": "Optional if you've already run `npx setup-sogni-agent-skill` (which saves ~/.config/sogni/credentials). Get a key at https://dashboard.sogni.ai.",
      "sensitive": true,
      "required": false
    }
  },
  "compatibility": {
    "platforms": ["darwin", "win32", "linux"]
  }
}
```

- [ ] **Step 4: Add manifest to the version-stamp loop**

In `scripts/sync-version.mjs`, change:

```js
for (const manifest of ['.claude-plugin/plugin.json', 'openclaw.plugin.json']) {
```

to:

```js
for (const manifest of ['.claude-plugin/plugin.json', 'openclaw.plugin.json', 'desktop-extension/manifest.json']) {
```

(The targeted `"version": "<old>"` string-replace cannot collide with `"manifest_version": "0.3"` because it interpolates the parsed package version.)

- [ ] **Step 5: Update `package.json`**

Add `"desktop-extension/"` to the `files` array (after `"references/"`), and add to `scripts`:

```json
"build:mcpb": "npx -y @anthropic-ai/mcpb pack desktop-extension dist/sogni-creative-agent.mcpb"
```

Append `dist/` on its own line to `.gitignore`.

- [ ] **Step 6: Verify tests, sync, pack, and tarball**

Run: `node --test test/desktop-extension.test.mjs` — Expected: PASS
Run: `npm run sync:version` — Expected: `All manifests already at <version>.`
Run: `npm run build:mcpb` — Expected: `dist/sogni-creative-agent.mcpb` created (zip containing manifest.json + server/). If the mcpb CLI warns about missing optional fields, that's fine; a hard error on manifest shape must be fixed before proceeding.
Run: `npm pack --dry-run 2>&1 | grep desktop-extension` — Expected: the three desktop-extension files listed. (If `prepack` fails on the private-sibling gate, sync it per the release runbook or run `npm pack --dry-run --ignore-scripts` just to inspect the file list.)

- [ ] **Step 7: Run full suite, then commit**

Run: `npm test`

```bash
git add desktop-extension/manifest.json scripts/sync-version.mjs package.json .gitignore test/desktop-extension.test.mjs
git commit -m "feat(desktop): add MCPB manifest, npm packaging, and build script" -m "manifest.json (spec 0.3) with optional keychain-stored API key falling back to the shared credentials file. desktop-extension/ ships in the npm tarball so the installer can point Claude Desktop at the server inside the global package; npm run build:mcpb packs the drag-and-drop bundle."
```

---

### Task 5: Documentation (main repo)

**Files:**
- Modify: `README.md` (new "Claude Desktop" section, after the existing install sections)
- Create: `desktop-extension/README.md`

**Interfaces:** none (docs only). Do not bump the version or touch CHANGELOG.md here — that happens in the release runbook.

- [ ] **Step 1: Add a "Claude Desktop" section to `README.md`**

Find the installation area (near the plugin-vs-skill warning at the "Pick one registration per machine" note) and add:

```markdown
## Claude Desktop

Claude Desktop can't run skills against your local files, so Sogni ships as a local MCP server instead. Two ways to install:

**Recommended — one command (also installs the CLI, saves your API key, and offers to install ffmpeg):**

    npx setup-sogni-agent-skill

This registers the Sogni tools in `claude_desktop_config.json`. Fully quit and reopen Claude Desktop afterwards.

**Manual — drag-and-drop bundle:** download `sogni-creative-agent.mcpb` from the GitHub Releases page and drop it onto Claude Desktop's Settings → Extensions page. You'll be prompted for your Sogni API key (stored in the OS keychain) unless you've already run the installer.

Don't use both — you'd get duplicate Sogni tools. The extension wraps the same globally installed `sogni-agent` CLI used by Claude Code, so personas, memories, and credentials are shared.

Video/audio editing features need ffmpeg on your machine; the `npx` installer offers to install it for you.
```

- [ ] **Step 2: Create `desktop-extension/README.md`**

```markdown
# Sogni Creative Agent — Claude Desktop extension

A dependency-free MCP stdio server that wraps the globally installed
`sogni-agent` CLI. `manifest.json` follows the MCPB spec (v0.3).

## Layout

- `server/index.mjs` — JSON-RPC 2.0 stdio loop (initialize, tools/list, tools/call)
- `server/tools.mjs` — tool schemas + pure argv builders
- `server/resolve.mjs` — absolute-path resolution (agent, ffmpeg, child env);
  Claude Desktop's GUI environment has a minimal PATH, so nothing here relies on PATH lookup

## Build the .mcpb bundle

    npm run build:mcpb   # → dist/sogni-creative-agent.mcpb

## Install paths

1. `npx setup-sogni-agent-skill` writes a `claude_desktop_config.json` entry
   pointing at this server inside the global npm package (preferred).
2. The packed `.mcpb` is the manual drag-and-drop alternative
   (Claude Desktop → Settings → Extensions).

The server needs the CLI installed globally (`npm i -g @sogni-ai/sogni-creative-agent-skill`);
when missing, every tool returns a hint to run `npx setup-sogni-agent-skill`.

## Testing

    node --test test/desktop-extension.test.mjs
```

- [ ] **Step 3: Sanity-check docs consistency, then commit**

Run: `npm test` (the docs-consistency suite runs as part of it)
Expected: PASS.

```bash
git add README.md desktop-extension/README.md
git commit -m "docs(desktop): document Claude Desktop install paths" -m "README gains a Claude Desktop section steering users to npx setup-sogni-agent-skill (config-file registration) with the .mcpb drag-and-drop bundle as the manual alternative, plus a duplicate-registration warning mirroring the plugin-vs-skill note."
```

---

# Part 2 — Installer repo: `setup-sogni-agent-skill`

Work in `/Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill`. Test helper facts: `test/helpers.mjs` exports `withTempHome(t)` (redirects `HOME` to a temp dir; `os.homedir()` follows `$HOME` on POSIX) and `FIXTURE_SKILL_SRC` (a fake installed-package dir). Read both before starting Task 7.

### Task 6: Accept `desktop` as a runtime filter

**Files:**
- Modify: `src/flags.mjs`
- Modify: `bin/setup.mjs` (HELP text)
- Test: `test/flags.test.mjs` (append)

**Interfaces:**
- Produces: `parseFlags(['--only=desktop'])` → `{ only: ['desktop'], ... }`; `'desktop'` valid in `--exclude` too. Short key `'desktop'` is consumed by Task 9's ADAPTERS map.

- [ ] **Step 1: Write the failing tests** (append to `test/flags.test.mjs`, matching its existing import style)

```js
test('--only=desktop is accepted', () => {
  const flags = parseFlags(['--only=desktop']);
  assert.deepEqual(flags.only, ['desktop']);
});

test('--exclude=desktop is accepted alongside others', () => {
  const flags = parseFlags(['--exclude=desktop,chatgpt']);
  assert.deepEqual(flags.exclude, ['desktop', 'chatgpt']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/flags.test.mjs`
Expected: FAIL — `Invalid runtime for --only: desktop`

- [ ] **Step 3: Implement**

In `src/flags.mjs`:
- `const RUNTIME_FILTERS = new Set(['claude', 'desktop', 'codex', 'hermes', 'chatgpt']);`
- Update both error strings that enumerate runtimes to `claude, desktop, codex, hermes, chatgpt` (the one in `parseRuntimeFilterFlag` — two messages — and the one in `validateSelectedRuntimes`).

In `bin/setup.mjs` HELP, change the `--only` line to:

```
  --only=claude,desktop,codex,hermes,chatgpt
```

- [ ] **Step 4: Run tests, commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/flags.mjs bin/setup.mjs test/flags.test.mjs
git commit -m "feat: accept desktop runtime filter for Claude Desktop support"
```

---

### Task 7: Detect Claude Desktop

**Files:**
- Modify: `src/detect.mjs`
- Test: `test/detect.test.mjs` (append)

**Interfaces:**
- Consumes: `claudeDesktopConfigPath` — defined here (not in the adapter) so `detect.mjs` stays dependency-light; the Task 8 adapter imports it from `./detect.mjs`.
- Produces:
  - `claudeDesktopConfigPath({ platform?, home?, env? }) → string` (exported)
  - `detectAll()` now includes a `{ runtime: 'claude-desktop', status, path, skillDir: null, installedVersion }` record, inserted right after the claude-code record. `installedVersion` reads `mcpServers['sogni-creative-agent'].env.SOGNI_SKILL_VERSION` from the config file (null when absent/invalid).

- [ ] **Step 1: Write the failing tests** (append to `test/detect.test.mjs`, following its existing `withTempHome` usage)

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { claudeDesktopConfigPath } from '../src/detect.mjs';

test('claudeDesktopConfigPath per platform', () => {
  assert.equal(
    claudeDesktopConfigPath({ platform: 'darwin', home: '/Users/x', env: {} }),
    '/Users/x/Library/Application Support/Claude/claude_desktop_config.json',
  );
  assert.equal(
    claudeDesktopConfigPath({ platform: 'win32', home: 'C:\\Users\\x', env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' } }),
    require('node:path').join('C:\\Users\\x\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'),
  );
  assert.equal(
    claudeDesktopConfigPath({ platform: 'linux', home: '/home/x', env: {} }),
    '/home/x/.config/Claude/claude_desktop_config.json',
  );
});

test('detectAll reports claude-desktop not-found without the config dir', (t) => {
  withTempHome(t);
  const d = detectAll().find((r) => r.runtime === 'claude-desktop');
  assert.equal(d.status, 'not-found');
});

test('detectAll reports claude-desktop available with installed version', (t) => {
  const home = withTempHome(t);
  const dir = join(home, 'Library', 'Application Support', 'Claude');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: { 'sogni-creative-agent': { command: 'node', args: [], env: { SOGNI_SKILL_VERSION: '3.7.0' } } },
  }));
  const d = detectAll().find((r) => r.runtime === 'claude-desktop');
  assert.equal(d.status, 'available');
  assert.equal(d.installedVersion, '3.7.0');
});
```

Note: this test block assumes darwin (the dev machine). If `test/detect.test.mjs` uses ESM (it does — no `require`), replace the `require('node:path').join(...)` line with a `join` import: `join('C:\\Users\\x\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json')`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/detect.test.mjs`
Expected: FAIL — `claudeDesktopConfigPath` is not exported.

- [ ] **Step 3: Implement in `src/detect.mjs`**

Add near the top (imports for `platform` from `node:os` and `dirname` from `node:path` as needed):

```js
import { platform as osPlatform } from 'node:os';
import { dirname } from 'node:path';

const DESKTOP_SERVER_KEY = 'sogni-creative-agent';

export function claudeDesktopConfigPath({ platform = osPlatform(), home = homedir(), env = process.env } = {}) {
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

function detectClaudeDesktop() {
  const configPath = claudeDesktopConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    return { runtime: 'claude-desktop', status: 'not-found', path: null, skillDir: null, installedVersion: null };
  }
  let installedVersion = null;
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    installedVersion = cfg?.mcpServers?.[DESKTOP_SERVER_KEY]?.env?.SOGNI_SKILL_VERSION ?? null;
  } catch {
    // Missing or malformed config file — treat as available with nothing installed.
  }
  return { runtime: 'claude-desktop', status: 'available', path: dir, skillDir: null, installedVersion };
}
```

And change `detectAll` to:

```js
export function detectAll() {
  return [detectClaudeCode(), detectClaudeDesktop(), detectCodexCli(), detectHermes(), detectChatgptWeb()];
}
```

- [ ] **Step 4: Run tests, commit**

Run: `npm test`
Expected: PASS — if `test/setup.integration.mjs` or `test/detect.test.mjs` asserts on `detectAll()` length/order, update those assertions to include the new record.

```bash
git add src/detect.mjs test/detect.test.mjs
git commit -m "feat: detect Claude Desktop config directory and installed Sogni server version"
```

---

### Task 8: `claude-desktop` adapter (config merge, install/uninstall)

**Files:**
- Create: `src/adapters/claude-desktop.mjs`
- Test: `test/adapters.claude-desktop.test.mjs`

**Interfaces:**
- Consumes: `claudeDesktopConfigPath` (Task 7); `srcDir`/`version` from `resolveSkillSource()` (existing) — `srcDir` is the global package dir, so the server lives at `join(srcDir, 'desktop-extension', 'server', 'index.mjs')` (contract from Part 1 Task 4).
- Produces: default export `{ name, detect(), install({srcDir, version, dryRun}), uninstall() }` matching the existing adapter shape (`status`: `installed | upgraded | up-to-date | would-install`, plus `previousVersion`, `written`, `notes`). Consumed by Task 9's ADAPTERS map. `install()` env-vars the entry with `SOGNI_SKILL_VERSION` (read back by detect) and `FFMPEG_PATH` when `which/where ffmpeg` resolves.

- [ ] **Step 1: Write the failing tests**

Create `test/adapters.claude-desktop.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import adapter from '../src/adapters/claude-desktop.mjs';
import { withTempHome, FIXTURE_SKILL_SRC } from './helpers.mjs';

function desktopDir(home) {
  return join(home, 'Library', 'Application Support', 'Claude');
}

function configPathFor(home) {
  return join(desktopDir(home), 'claude_desktop_config.json');
}

function setupDesktop(home) {
  mkdirSync(desktopDir(home), { recursive: true });
}

// The adapter validates that the skill package actually ships the server file.
function setupServerFile() {
  const serverDir = join(FIXTURE_SKILL_SRC, 'desktop-extension', 'server');
  mkdirSync(serverDir, { recursive: true });
  writeFileSync(join(serverDir, 'index.mjs'), '// stub server');
}

test('install writes a merged mcpServers entry', (t) => {
  const home = withTempHome(t);
  setupDesktop(home);
  setupServerFile();
  writeFileSync(configPathFor(home), JSON.stringify({ mcpServers: { other: { command: 'x' } }, theme: 'dark' }));

  const result = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '3.7.0' });
  assert.equal(result.status, 'installed');

  const cfg = JSON.parse(readFileSync(configPathFor(home), 'utf8'));
  assert.equal(cfg.theme, 'dark');                       // untouched sibling keys
  assert.ok(cfg.mcpServers.other);                       // untouched sibling server
  const entry = cfg.mcpServers['sogni-creative-agent'];
  assert.equal(entry.command, process.execPath);         // absolute node — GUI PATH is minimal
  assert.deepEqual(entry.args, [join(FIXTURE_SKILL_SRC, 'desktop-extension', 'server', 'index.mjs')]);
  assert.equal(entry.env.SOGNI_AGENT_PATH, join(FIXTURE_SKILL_SRC, 'sogni-agent.mjs'));
  assert.equal(entry.env.SOGNI_SKILL_VERSION, '3.7.0');
});

test('install creates the config file when absent', (t) => {
  const home = withTempHome(t);
  setupDesktop(home);
  setupServerFile();
  const result = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '3.7.0' });
  assert.equal(result.status, 'installed');
  assert.ok(existsSync(configPathFor(home)));
});

test('install is idempotent and reports upgrades', (t) => {
  const home = withTempHome(t);
  setupDesktop(home);
  setupServerFile();
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '3.7.0' });
  assert.equal(adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '3.7.0' }).status, 'up-to-date');
  const up = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '3.8.0' });
  assert.equal(up.status, 'upgraded');
  assert.equal(up.previousVersion, '3.7.0');
});

test('install refuses to clobber invalid JSON', (t) => {
  const home = withTempHome(t);
  setupDesktop(home);
  setupServerFile();
  writeFileSync(configPathFor(home), '{broken');
  assert.throws(() => adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '3.7.0' }), /not valid JSON/);
  assert.equal(readFileSync(configPathFor(home), 'utf8'), '{broken'); // untouched
});

test('install fails clearly when the package lacks desktop-extension', (t) => {
  const home = withTempHome(t);
  setupDesktop(home);
  const { rmSync } = require('node:fs');
  rmSync(join(FIXTURE_SKILL_SRC, 'desktop-extension'), { recursive: true, force: true });
  assert.throws(() => adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '3.7.0' }), /3\.7\.0/);
});

test('uninstall removes only our entry', (t) => {
  const home = withTempHome(t);
  setupDesktop(home);
  setupServerFile();
  writeFileSync(configPathFor(home), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '3.7.0' });
  const result = adapter.uninstall();
  assert.equal(result.removed.length, 1);
  const cfg = JSON.parse(readFileSync(configPathFor(home), 'utf8'));
  assert.ok(cfg.mcpServers.other);
  assert.equal('sogni-creative-agent' in cfg.mcpServers, false);
});

test('dryRun writes nothing', (t) => {
  const home = withTempHome(t);
  setupDesktop(home);
  setupServerFile();
  const result = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '3.7.0', dryRun: true });
  assert.equal(result.status, 'would-install');
  assert.equal(existsSync(configPathFor(home)), false);
});
```

Notes for the engineer: (a) this file is ESM — replace the `require('node:fs')` line with `rmSync` added to the top-level `node:fs` import; (b) `setupServerFile` mutates the shared `FIXTURE_SKILL_SRC` fixture — if other test files run concurrently and assert on its exact contents, instead copy the fixture into the temp home and use that copy as `srcDir` (check how `test/helpers.mjs` builds `FIXTURE_SKILL_SRC` first); (c) tests assume darwin paths — fine for this machine and CI on macOS; if installer CI runs Linux, derive the expected dir from `claudeDesktopConfigPath()` instead of hardcoding `Library/Application Support`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/adapters.claude-desktop.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/adapters/claude-desktop.mjs`**

```js
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';
import { dirname, join } from 'node:path';
import { claudeDesktopConfigPath } from '../detect.mjs';

const SERVER_KEY = 'sogni-creative-agent';

// Claude Desktop launches MCP servers from a GUI context with a minimal PATH,
// so the registered entry uses only absolute paths: the node binary running
// this installer, the server script inside the global package, and ffmpeg.
function resolveFfmpeg() {
  const cmd = osPlatform() === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, ['ffmpeg'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/)[0].trim() || null;
}

function readConfig(configPath) {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error(`${configPath} is not valid JSON — fix or remove it, then re-run.`);
  }
}

export default {
  name: 'claude-desktop',

  detect() {
    const configPath = claudeDesktopConfigPath();
    const dir = dirname(configPath);
    if (!existsSync(dir)) return { found: false, path: null, installedVersion: null };
    let installedVersion = null;
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      installedVersion = cfg?.mcpServers?.[SERVER_KEY]?.env?.SOGNI_SKILL_VERSION ?? null;
    } catch {
      // fall through — treat as no version installed
    }
    return { found: true, path: dir, installedVersion };
  },

  install({ srcDir, version, dryRun = false }) {
    const configPath = claudeDesktopConfigPath();
    const serverPath = join(srcDir, 'desktop-extension', 'server', 'index.mjs');
    if (!existsSync(serverPath)) {
      throw new Error(
        `Desktop extension server not found at ${serverPath} — ` +
        'upgrade @sogni-ai/sogni-creative-agent-skill to a version that ships desktop-extension/ (>= 3.7.0).',
      );
    }
    if (dryRun) {
      return { status: 'would-install', written: [], notes: [`Would register ${SERVER_KEY} in ${configPath}`] };
    }

    const config = readConfig(configPath);
    const existing = config.mcpServers?.[SERVER_KEY];
    const previousVersion = existing?.env?.SOGNI_SKILL_VERSION ?? null;

    const entry = {
      command: process.execPath,
      args: [serverPath],
      env: {
        SOGNI_AGENT_PATH: join(srcDir, 'sogni-agent.mjs'),
        SOGNI_SKILL_VERSION: version,
      },
    };
    const ffmpeg = resolveFfmpeg();
    if (ffmpeg) entry.env.FFMPEG_PATH = ffmpeg;

    if (existing && JSON.stringify(existing) === JSON.stringify(entry)) {
      return { status: 'up-to-date', written: [], notes: [`Already at ${version}`] };
    }

    config.mcpServers = { ...(config.mcpServers ?? {}), [SERVER_KEY]: entry };
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    return {
      status: existing ? 'upgraded' : 'installed',
      previousVersion,
      written: [configPath],
      notes: ['Fully quit and reopen Claude Desktop to load the Sogni tools.'],
    };
  },

  uninstall() {
    const configPath = claudeDesktopConfigPath();
    if (!existsSync(configPath)) return { removed: [] };
    let config;
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      return { removed: [] }; // don't touch a broken file on uninstall
    }
    if (!config.mcpServers?.[SERVER_KEY]) return { removed: [] };
    delete config.mcpServers[SERVER_KEY];
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    return { removed: [configPath] };
  },
};
```

- [ ] **Step 4: Run tests, commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/adapters/claude-desktop.mjs test/adapters.claude-desktop.test.mjs
git commit -m "feat: add claude-desktop adapter registering the Sogni MCP server"
```

---

### Task 9: Wire the adapter into run/summary

**Files:**
- Modify: `src/run.mjs` (ADAPTERS map)
- Modify: `src/summary.mjs` (`nextSteps` restart hint)
- Test: `test/summary.test.mjs` (append), `test/setup.integration.mjs` (update expectations if needed)

**Interfaces:**
- Consumes: adapter (Task 8), `desktop` short key (Task 6), detect record (Task 7).
- Produces: `--only=desktop` end-to-end flow; summary prints "Fully quit and reopen Claude Desktop…" after a desktop install.

- [ ] **Step 1: Write the failing summary test** (append to `test/summary.test.mjs`, following its existing output-capture pattern — read the file first and mimic how existing tests capture `console.log`)

```js
test('summary tells the user to restart Claude Desktop after a desktop install', () => {
  const lines = captureSummary({
    adapterResults: [{
      runtime: 'claude-desktop', label: 'Claude Desktop', status: 'installed',
      version: '3.7.0', previousVersion: null, target: '/tmp/Claude', notes: [],
    }],
    cli: { skipped: false, spec: '@sogni-ai/sogni-creative-agent-skill@3.7.0' },
    credentials: { action: 'skipped-file', path: '/tmp/credentials' },
  });
  assert.ok(lines.some((l) => /quit and reopen Claude Desktop/i.test(l)));
});
```

(`captureSummary` = whatever helper the existing summary tests use to invoke `printSummary` and capture output; reuse it verbatim.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/summary.test.mjs`
Expected: FAIL — no restart line.

- [ ] **Step 3: Implement**

In `src/run.mjs`, import and register the adapter (order puts desktop right after claude-code, matching `detectAll`):

```js
import claudeDesktop from './adapters/claude-desktop.mjs';

const ADAPTERS = {
  'claude-code': { adapter: claudeCode, label: 'Claude Code', shortKey: 'claude' },
  'claude-desktop': { adapter: claudeDesktop, label: 'Claude Desktop', shortKey: 'desktop' },
  'codex-cli': { adapter: codexCli, label: 'OpenAI Codex CLI', shortKey: 'codex' },
  'hermes': { adapter: hermes, label: 'Hermes Agent', shortKey: 'hermes' },
  'chatgpt-web': { adapter: chatgptWeb, label: 'ChatGPT (web)', shortKey: 'chatgpt' },
};
```

No other `run.mjs` changes: the desktop record flows through `selectedLocalRuntimes` / `printDetectionTable` / the adapter loop generically (its runtime is not `chatgpt-web` and needs no special opts).

In `src/summary.mjs` `nextSteps`, inside the `if (installed || cliInstalled)` branch, before `return steps;` add:

```js
    if (adapterResults.some((r) => r.runtime === 'claude-desktop' && ['installed', 'upgraded'].includes(r.status))) {
      steps.unshift('Fully quit and reopen Claude Desktop so it loads the Sogni tools.');
    }
```

- [ ] **Step 4: Run the whole suite including integration**

Run: `npm test`
Expected: PASS. If `test/setup.integration.mjs` asserts on the detection-table rows or adapter counts, update those expectations to include the `Claude Desktop` row (status `not found` under a temp HOME).

- [ ] **Step 5: Manual smoke test (dry-run only, real machine)**

Run: `node bin/setup.mjs --dry-run --no-ui`
Expected: detection table now lists `Claude Desktop` with a real path (this machine has Claude Desktop) and `Dry run — nothing will be written.`

- [ ] **Step 6: Commit**

```bash
git add src/run.mjs src/summary.mjs test/summary.test.mjs test/setup.integration.mjs
git commit -m "feat: wire claude-desktop adapter into the install flow and summary"
```

---

### Task 10: ffmpeg install offer (upgrade from recommend-only)

**Files:**
- Modify: `src/check-ffmpeg.mjs`
- Modify: `src/run.mjs` (call site)
- Test: `test/check-ffmpeg.test.mjs` (append)

**Interfaces:**
- Consumes: `prompts` (already a dependency), `isSudoRoot` (already imported in run.mjs).
- Produces:
  - `detectInstaller({ platform?, exec? }) → { label, command, args } | null`
  - `offerFfmpegInstall({ interactive?, exec?, check? }) → { installed: boolean, via?: string }` — prompts to run brew/winget/apt-get/dnf/pacman when interactive and a manager is present; falls back to `recommendFfmpeg()` otherwise. `recommendFfmpeg` stays exported (unchanged behavior).
  - `run.mjs` calls `await offerFfmpegInstall({ interactive: !flags.yes && !isSudoRoot() })` — non-interactive and sudo runs never auto-install system packages.

- [ ] **Step 1: Write the failing tests** (append to `test/check-ffmpeg.test.mjs`; it already manipulates `SOGNI_TEST_SKIP_FFMPEG_CHECK`)

```js
import prompts from 'prompts';
import { detectInstaller, offerFfmpegInstall } from '../src/check-ffmpeg.mjs';

test('detectInstaller picks brew on darwin when present', () => {
  const exec = (bin) => ({ status: bin === 'brew' ? 0 : 1 });
  const found = detectInstaller({ platform: 'darwin', exec });
  assert.deepEqual(found, { label: 'Homebrew', command: 'brew', args: ['install', 'ffmpeg'] });
});

test('detectInstaller returns null when no manager exists', () => {
  const exec = () => ({ status: 1 });
  assert.equal(detectInstaller({ platform: 'darwin', exec }), null);
});

test('detectInstaller uses sudo apt-get on linux', () => {
  const exec = (bin) => ({ status: bin === 'apt-get' ? 0 : 1 });
  const found = detectInstaller({ platform: 'linux', exec });
  assert.deepEqual(found, { label: 'apt', command: 'sudo', args: ['apt-get', 'install', '-y', 'ffmpeg'] });
});

test('offerFfmpegInstall runs the installer when the user confirms', async () => {
  const calls = [];
  let installed = false;
  const exec = (cmd, args = ['--version']) => {
    calls.push([cmd, ...args]);
    if (cmd === 'brew' && args[0] === 'install') installed = true;
    return { status: 0 };
  };
  prompts.inject([true]);
  const result = await offerFfmpegInstall({
    interactive: true,
    exec,
    check: () => installed,
    platformOverride: 'darwin',
    ttyOverride: true,
  });
  assert.equal(result.installed, true);
  assert.equal(result.via, 'Homebrew');
  assert.ok(calls.some((c) => c[0] === 'brew' && c[1] === 'install' && c[2] === 'ffmpeg'));
});

test('offerFfmpegInstall falls back to recommendations when declined', async () => {
  prompts.inject([false]);
  const result = await offerFfmpegInstall({
    interactive: true,
    exec: () => ({ status: 0 }),
    check: () => false,
    platformOverride: 'darwin',
    ttyOverride: true,
  });
  assert.equal(result.installed, false);
});

test('offerFfmpegInstall never prompts when non-interactive', async () => {
  // prompts.inject is NOT set — an unexpected prompt would hang/throw.
  const result = await offerFfmpegInstall({
    interactive: false,
    exec: () => ({ status: 0 }),
    check: () => false,
  });
  assert.equal(result.installed, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/check-ffmpeg.test.mjs`
Expected: FAIL — `detectInstaller` not exported.

- [ ] **Step 3: Implement in `src/check-ffmpeg.mjs`**

Add imports: `import prompts from 'prompts';` and extend the existing `spawnSync` import usage. Append:

```js
export function detectInstaller({ platform = osPlatform(), exec = spawnSync } = {}) {
  const has = (bin) => {
    const r = exec(bin, ['--version'], { stdio: 'ignore' });
    return !r.error && r.status === 0;
  };
  if (platform === 'darwin' && has('brew')) {
    return { label: 'Homebrew', command: 'brew', args: ['install', 'ffmpeg'] };
  }
  if (platform === 'win32' && has('winget')) {
    return { label: 'winget', command: 'winget', args: ['install', '--id', 'Gyan.FFmpeg', '-e', '--source', 'winget'] };
  }
  if (platform === 'linux') {
    if (has('apt-get')) return { label: 'apt', command: 'sudo', args: ['apt-get', 'install', '-y', 'ffmpeg'] };
    if (has('dnf')) return { label: 'dnf', command: 'sudo', args: ['dnf', 'install', '-y', 'ffmpeg'] };
    if (has('pacman')) return { label: 'pacman', command: 'sudo', args: ['pacman', '-S', '--noconfirm', 'ffmpeg'] };
  }
  return null;
}

export async function offerFfmpegInstall({
  interactive = true,
  exec = spawnSync,
  check = isFfmpegInstalled,
  platformOverride = null,
  ttyOverride = null,
} = {}) {
  if (check()) return { installed: true };

  const isTty = ttyOverride ?? process.stdin.isTTY === true;
  const installer = interactive && isTty
    ? detectInstaller({ platform: platformOverride ?? osPlatform(), exec })
    : null;

  if (installer) {
    console.log('');
    console.log(kleur.yellow().bold('ffmpeg was not found on your computer.'));
    console.log('Sogni uses it to stitch videos, extract frames, and add music to clips.');
    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: `Install ffmpeg now with ${installer.label}? (recommended)`,
      initial: true,
    });
    if (ok === true) {
      const r = exec(installer.command, installer.args, { stdio: 'inherit' });
      if (r.status === 0 && check()) {
        console.log(kleur.green('ffmpeg installed.'));
        return { installed: true, via: installer.label };
      }
      console.log(kleur.yellow('ffmpeg install did not complete — showing manual instructions instead.'));
    }
  }
  return recommendFfmpeg();
}
```

(`osPlatform` = the existing `platform` import from `node:os`; keep the existing import name and use it consistently.)

In `src/run.mjs`, replace the call at the `// 1b.` comment:

```js
  // 1b. Offer ffmpeg (interactive installs only) — used by clip merging and frame extraction.
  await offerFfmpegInstall({ interactive: !flags.yes && !isSudoRoot() });
```

and update the import: `import { offerFfmpegInstall } from './check-ffmpeg.mjs';`

- [ ] **Step 4: Run tests, commit**

Run: `npm test`
Expected: PASS (integration test runs non-interactively → no prompt fires).

```bash
git add src/check-ffmpeg.mjs src/run.mjs test/check-ffmpeg.test.mjs
git commit -m "feat: offer to install ffmpeg via brew/winget/apt instead of recommend-only"
```

---

### Task 11: Installer docs + release notes

**Files:**
- Modify: `README.md` (runtimes list + Claude Desktop blurb + `--only=desktop`)
- Modify: `CHANGELOG.md` (new entry)
- Modify: `package.json` (version bump to 0.6.0)

**Interfaces:** none. Publishing to npm is a separate manual step for the user — do not run `npm publish`.

- [ ] **Step 1: Update `README.md`**

Add `Claude Desktop` to the supported-runtimes list with a line like:

```markdown
- **Claude Desktop** — registers a local MCP server entry in `claude_desktop_config.json`
  pointing at the globally installed CLI (requires skill package ≥ 3.7.0).
  Fully quit and reopen Claude Desktop after install. Restrict with `--only=desktop`.
```

Update any `--only=` examples to include `desktop`. Mention the ffmpeg install offer where ffmpeg is currently described.

- [ ] **Step 2: Update `CHANGELOG.md` + bump version**

```bash
npm version 0.6.0 --no-git-tag-version
```

Add a `## [0.6.0] - 2026-07-03` entry (match the file's existing style): Added — Claude Desktop runtime (config-file MCP registration, `--only=desktop`); Added — interactive ffmpeg install offer (brew/winget/apt/dnf/pacman); Changed — detection table now lists Claude Desktop.

- [ ] **Step 3: Full suite + commit**

Run: `npm test`
Expected: PASS (fix `docs-consistency.test.mjs` failures if the installer has one — it does: `test/docs-consistency.test.mjs`; align README flag docs with `flags.mjs`).

```bash
git add README.md CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): prepare 0.6.0 with Claude Desktop support"
```

---

### Task 12: End-to-end verification on this machine (both repos)

**Files:** none created — verification only. Requires Tasks 1–11 complete.

- [ ] **Step 1: Link the local skill package globally so the installer can see desktop-extension/**

```bash
cd /Users/krunkosaurus/Documents/git/sogni/sogni-creative-agent-skill && npm link
```

Expected: global symlink to the working copy (which now contains `desktop-extension/`).

- [ ] **Step 2: Run the installer against Claude Desktop only**

```bash
cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && INSTALL_CLI=skip node bin/setup.mjs --only=desktop --no-ui --yes --no-credentials
```

Expected: detection table shows `Claude Desktop … ✓`; summary shows `Claude Desktop → installed 3.6.4` (linked version) and the "Fully quit and reopen Claude Desktop" next step.

- [ ] **Step 3: Inspect the written config**

```bash
cat "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
```

Expected: `mcpServers["sogni-creative-agent"]` with absolute `command` (node), `args[0]` ending in `desktop-extension/server/index.mjs`, env containing `SOGNI_AGENT_PATH` and (if ffmpeg is installed) `FFMPEG_PATH`. Any pre-existing servers untouched.

- [ ] **Step 4: Drive the registered server by hand over stdio**

```bash
CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
SERVER=$(node -p "JSON.parse(require('fs').readFileSync(process.env.CONFIG,'utf8')).mcpServers['sogni-creative-agent'].args[0]" CONFIG="$CONFIG" 2>/dev/null || node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).mcpServers['sogni-creative-agent'].args[0])")
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node "$SERVER"
```

Expected: two JSON lines — an initialize result naming `sogni-creative-agent`, and a tools list with 10 tools.

- [ ] **Step 5: Live test in Claude Desktop (user-visible)**

Fully quit Claude Desktop (Cmd-Q) and reopen. In a new chat, confirm the Sogni tools appear in the tools menu, then ask: "Use sogni to generate an image of a sunset over mountains". Expected: `generate_image` runs and returns a URL or saved file.

- [ ] **Step 6: Verify the .mcpb builds and cleanup**

```bash
cd /Users/krunkosaurus/Documents/git/sogni/sogni-creative-agent-skill && npm run build:mcpb && ls -la dist/
```

Expected: `sogni-creative-agent.mcpb` exists. (Optionally drag it into Claude Desktop → Settings → Extensions on a machine without the config entry — do NOT install it alongside the config entry on this machine; that creates duplicate tools.)

Then decide with the user whether to keep or unlink the `npm link` (`npm unlink -g @sogni-ai/sogni-creative-agent-skill` restores the registry version).

---

## Self-Review Notes

- **Spec coverage:** MCP wrapper (T1–3), .mcpb + packaging (T4), main docs (T5), installer flag/detect/adapter/wiring (T6–9), ffmpeg offer (T10), installer docs/release (T11), E2E (T12). Release ordering captured in Global Constraints; main-repo npm release itself follows the existing manual runbook and is deliberately out of scope.
- **Type consistency:** the config entry key `sogni-creative-agent`, env names `SOGNI_AGENT_PATH` / `SOGNI_SKILL_VERSION` / `FFMPEG_PATH`, the server path `desktop-extension/server/index.mjs`, and adapter statuses match across Tasks 3/4/7/8/9 and the main-repo Task 1 resolve module.
- **Known judgment calls:** protocol tests use a hand-rolled client (no SDK dep, matching the dependency-free constraint); `tools/call` tool-level failures return `isError` results rather than JSON-RPC errors (per MCP spec); `--yes` deliberately does NOT auto-install system packages.
