import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, writeFile, appendFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readPreviewFile, readPreviewUrl, publicPreviewLookup } from '../desktop-extension/server/preview-source.mjs';
import { collectInlineImages } from '../desktop-extension/server/inline-images.mjs';
import { stageMcpb } from '../scripts/build-mcpb.mjs';

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sogni-preview-source-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  let requests = 0;
  return {
    get requests() { return requests; },
    requestImpl(url, options, callback) {
      requests += 1;
      assert.equal(options.lookup, publicPreviewLookup);
      return request(new URL(url.pathname + url.search, `http://127.0.0.1:${server.address().port}`), options, callback);
    },
  };
}

test('preview URL rejects local targets and embedded credentials before a request', async () => {
  for (const url of ['http://127.0.0.1/x', 'http://169.254.169.254/x', 'http://[::1]/x',
    'http://[::ffff:127.0.0.1]/x', 'https://user:secret@assets.example/x', 'file:///tmp/x']) {
    await assert.rejects(readPreviewUrl(url, { requestImpl() { assert.fail('must not connect'); } }), /unavailable/);
  }
});

test('preview socket lookup rejects private or mixed DNS results at connection time', async () => {
  for (const addresses of [[], [{ address: '127.0.0.1', family: 4 }],
    [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.2', family: 4 }],
    [{ address: 'fe80::1', family: 6 }]]) {
    await assert.rejects(new Promise((resolve, reject) => publicPreviewLookup('assets.example', { all: true },
      (error, value) => error ? reject(error) : resolve(value),
      (_host, options, callback) => { assert.equal(options.all, true); callback(null, addresses); })), /unavailable/);
  }
  for (const all of [true, false]) {
    const value = await new Promise((resolve, reject) => publicPreviewLookup('assets.example', { all },
      (error, address, family) => error ? reject(error) : resolve({ address, family }),
      (_host, _options, callback) => callback(null, [{ address: '93.184.215.14', family: 4 }])));
    assert.deepEqual(value, all
      ? { address: [{ address: '93.184.215.14', family: 4 }], family: undefined }
      : { address: '93.184.215.14', family: 4 });
  }
});

test('preview follows relative public redirects and preserves bytes and MIME', async t => {
  const http = await fixture(t, (req, res) => {
    if (req.url === '/start') { res.writeHead(302, { location: '/image' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'image/png; charset=binary' }); res.end('image bytes');
  });
  const result = await readPreviewUrl('https://assets.example/start', { requestImpl: http.requestImpl });
  assert.equal(result.data.toString(), 'image bytes');
  assert.equal(result.mime, 'image/png');
  assert.equal(http.requests, 2);
});

test('preview refuses private redirect destinations and bounds redirect loops', async t => {
  const http = await fixture(t, (req, res) => {
    res.writeHead(302, { location: req.url === '/private' ? 'http://127.0.0.1/private' : '/loop' });
    res.end();
  });
  await assert.rejects(readPreviewUrl('https://assets.example/private', { requestImpl: http.requestImpl }), /unavailable/);
  assert.equal(http.requests, 1);
  await assert.rejects(readPreviewUrl('https://assets.example/loop', { requestImpl: http.requestImpl }), /too many/);
  assert.equal(http.requests, 7);
});

test('preview bounds announced and chunked bodies before producing an inline block', async t => {
  const http = await fixture(t, (req, res) => {
    if (req.url === '/announced') { res.writeHead(200, { 'content-length': '1000000' }); res.flushHeaders(); return; }
    res.writeHead(200, { 'content-type': 'image/png' });
    res.write('12345678'); res.end('90123456');
  });
  await assert.rejects(readPreviewUrl('https://assets.example/announced', {
    requestImpl: http.requestImpl, maxBytes: 10,
  }), { code: 'PREVIEW_SOURCE_TOO_LARGE' });
  const result = await collectInlineImages({ toolName: 'generate_image', input: {}, env: {},
    stdout: JSON.stringify({ urls: ['https://assets.example/chunked'] }),
    requestImpl: http.requestImpl, sourceMaxBytes: 10 });
  assert.deepEqual(result, { blocks: [], notes: ['One image was too large to display inline; use the link above.'] });
});

test('preview aborts a response that stalls after its headers', { timeout: 2000 }, async t => {
  const http = await fixture(t, (_req, res) => { res.writeHead(200); res.flushHeaders(); res.write('x'); });
  const signal = AbortSignal.timeout(50);
  await assert.rejects(readPreviewUrl('https://assets.example/stall', {
    requestImpl: http.requestImpl, signal,
  }));
  assert.equal(signal.aborted, true);
});

test('preview files are regular, bounded, and read through one handle', async t => {
  const dir = await directory(t);
  const path = join(dir, 'image.png');
  await writeFile(path, '12345678');
  assert.equal((await readPreviewFile(path, 8)).toString(), '12345678');
  await assert.rejects(readPreviewFile(path, 7), { code: 'PREVIEW_SOURCE_TOO_LARGE' });
  await assert.rejects(readPreviewFile(dir), /regular file/);
  if (process.platform !== 'win32') {
    const fifo = join(dir, 'pipe.png');
    execFileSync('mkfifo', [fifo]);
    await assert.rejects(readPreviewFile(fifo), /regular file/);
  }
});

test('preview file growth after stat cannot exceed the read budget', async t => {
  const dir = await directory(t);
  const path = join(dir, 'growing.png');
  await writeFile(path, Buffer.alloc(64 * 1024, 1));
  const handle = await open(path, 'r');
  const prototype = Object.getPrototypeOf(handle);
  const original = prototype.read;
  await handle.close();
  let extended = false;
  t.mock.method(prototype, 'read', async function (...args) {
    const result = await original.apply(this, args);
    if (!extended) { extended = true; await appendFile(path, Buffer.alloc(2048, 2)); }
    return result;
  });
  await assert.rejects(readPreviewFile(path, 65 * 1024), { code: 'PREVIEW_SOURCE_TOO_LARGE' });
  assert.equal(extended, true);
});

test('standalone extension contains and loads the preview dependencies', async t => {
  const dir = await directory(t);
  stageMcpb(dir);
  const module = await import(pathToFileURL(join(dir, 'desktop-extension/server/inline-images.mjs')));
  assert.deepEqual(await module.collectInlineImages({ toolName: 'get_balance', input: {}, stdout: '', env: {} }),
    { blocks: [], notes: [] });
});

test('CLI fixture reports credential presence without echoing the credential', () => {
  const key = 'fixture-key-that-must-not-be-printed';
  const stdout = execFileSync(process.execPath, ['test/fixtures/fake-sogni-agent.mjs'], {
    env: { PATH: process.env.PATH, SOGNI_API_KEY: key }, encoding: 'utf8',
  });
  assert.equal(JSON.parse(stdout).env.SOGNI_API_KEY_PRESENT, true);
  assert.equal(stdout.includes(key), false);
});
