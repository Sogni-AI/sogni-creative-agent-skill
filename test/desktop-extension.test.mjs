import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync as fsExistsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  resolveAgentPath, resolveFfmpegPath, buildChildEnv,
} from '../desktop-extension/server/resolve.mjs';
import { TOOLS, getTool } from '../desktop-extension/server/tools.mjs';
import { collectInlineImages } from '../desktop-extension/server/inline-images.mjs';

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
  assert.equal(resolveAgentPath({ env: {}, home, roots: [] }), join(npmGlobal, 'sogni-agent.mjs'));

  const home2 = tempHome();
  const nvm = join(home2, '.nvm', 'versions', 'node', 'v22.11.0', rel);
  mkdirSync(nvm, { recursive: true });
  writeFileSync(join(nvm, 'sogni-agent.mjs'), '// stub');
  assert.equal(resolveAgentPath({ env: {}, home: home2, roots: [] }), join(nvm, 'sogni-agent.mjs'));
});

test('resolveAgentPath returns null when nothing is installed', () => {
  assert.equal(resolveAgentPath({ env: {}, home: tempHome(), roots: [] }), null);
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

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'desktop-extension', 'server', 'index.mjs');
const FAKE_AGENT = join(HERE, 'fixtures', 'fake-sogni-agent.mjs');

// 1x1 red PNG, 67 bytes — a real decodable PNG for byte-identity assertions.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

test('oversized success output keeps the head (front-loaded JSON), not the tail', async (t) => {
  // Append 30k pad chars AFTER the JSON line so the CLI output far exceeds the
  // 20k cap; the client must still receive the parseable JSON prefix.
  const client = new McpClient({ FAKE_AGENT_PAD: '30000' });
  t.after(() => client.close());
  const res = await client.request('tools/call', {
    name: 'generate_image',
    arguments: { prompt: 'a red fox', quality: 'fast' },
  });
  assert.equal(res.result.isError ?? false, false);
  const text = res.result.content[0].text;
  assert.equal(text.length, 20000);
  assert.ok(
    text.startsWith('{"argv":["--json","-q","--no-update-check","-Q","fast","a red fox"]'),
    'expected the head (result JSON) to survive truncation, not the trailing pad',
  );
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
