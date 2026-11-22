import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { proxiedPath, startLocalProxy } from './local-proxy.mjs';
import {
  assertSafeUrl, fetchSafeUrl, fetchUsesEnvProxy, guardedLookup, isBlockedIp, readResponseBody, requestWithLookup
} from '../ssrf-guard.mjs';

// Public IP literals are used throughout so assertSafeUrl validates without a
// DNS lookup — every test below runs fully offline via an injected fetchImpl.
const PUBLIC_A = 'https://93.184.216.34/media.png';
const PUBLIC_B = 'https://203.0.114.7/elsewhere.png';

function fakeResponse(status, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null }
  };
}

test('isBlockedIp blocks loopback, metadata, and private ranges', () => {
  assert.equal(isBlockedIp('127.0.0.1'), true);
  assert.equal(isBlockedIp('169.254.169.254'), true);
  assert.equal(isBlockedIp('10.1.2.3'), true);
  assert.equal(isBlockedIp('192.168.1.1'), true);
  assert.equal(isBlockedIp('::1'), true);
  assert.equal(isBlockedIp('93.184.216.34'), false);
});

test('fetchSafeUrl returns a non-redirect response directly', async () => {
  const calls = [];
  const response = await fetchSafeUrl(PUBLIC_A, {}, {
    fetchImpl: async (url, init) => {
      calls.push({ url, redirect: init.redirect });
      return fakeResponse(200);
    }
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, 'manual', 'must fetch with manual redirects');
});

test('fetchSafeUrl follows a redirect to another public address', async () => {
  const calls = [];
  const response = await fetchSafeUrl(PUBLIC_A, {}, {
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return fakeResponse(302, { location: PUBLIC_B });
      return fakeResponse(200);
    }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [PUBLIC_A, PUBLIC_B]);
});

test('fetchSafeUrl blocks a redirect to the cloud metadata endpoint', async () => {
  await assert.rejects(
    fetchSafeUrl(PUBLIC_A, {}, {
      fetchImpl: async () => fakeResponse(302, { location: 'http://169.254.169.254/latest/meta-data/' })
    }),
    /blocked IP/
  );
});

test('fetchSafeUrl blocks a redirect to loopback', async () => {
  await assert.rejects(
    fetchSafeUrl(PUBLIC_A, {}, {
      fetchImpl: async () => fakeResponse(301, { location: 'https://127.0.0.1/internal' })
    }),
    /blocked IP/
  );
});

test('fetchSafeUrl resolves relative redirect locations against the current URL', async () => {
  const calls = [];
  const response = await fetchSafeUrl(PUBLIC_A, {}, {
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return fakeResponse(302, { location: '/moved/media.png' });
      return fakeResponse(200);
    }
  });
  assert.equal(response.status, 200);
  assert.equal(calls[1], 'https://93.184.216.34/moved/media.png');
});

test('fetchSafeUrl gives up after too many redirects', async () => {
  await assert.rejects(
    fetchSafeUrl(PUBLIC_A, {}, {
      maxRedirects: 3,
      fetchImpl: async () => fakeResponse(302, { location: PUBLIC_B })
    }),
    /too many redirects/
  );
});

test('fetchSafeUrl returns a 3xx response with no location header as-is', async () => {
  const response = await fetchSafeUrl(PUBLIC_A, {}, {
    fetchImpl: async () => fakeResponse(304)
  });
  assert.equal(response.status, 304);
});

test('fetchSafeUrl rejects an initial private URL before any fetch', async () => {
  let fetched = false;
  await assert.rejects(
    fetchSafeUrl('https://192.168.0.10/x.png', {}, {
      fetchImpl: async () => { fetched = true; return fakeResponse(200); }
    }),
    /blocked IP/
  );
  assert.equal(fetched, false, 'no fetch should happen for a blocked initial URL');
});

test('assertSafeUrl still rejects credentials and bad schemes', async () => {
  await assert.rejects(assertSafeUrl('https://user:pass@93.184.216.34/x'), /credentials/);
  await assert.rejects(assertSafeUrl('file:///etc/passwd'), /protocol/);
});

test('isBlockedIp blocks IPv6 forms that reach a private, loopback, or reserved host', () => {
  for (const ip of [
    '::7f00:1',               // IPv4-compatible 127.0.0.1
    '::127.0.0.1',
    'fec0::1',                // site-local
    '2002:c0a8:101::1',       // 6to4 embedding 192.168.1.1
    '2002:7f00:1::',          // 6to4 embedding 127.0.0.1
    '100::1',                 // discard-only
    '64:ff9b::a00:1',         // NAT64 embedding 10.0.0.1
    '64:ff9b::169.254.169.254',
    '64:ff9b:1::1',           // local-use NAT64
    '::ffff:127.0.0.1',       // IPv4-mapped, dotted
    '::ffff:7f00:1',          // IPv4-mapped, hex (how URL serializes it)
    '0:0:0:0:0:ffff:a9fe:a9fe',
    '::ffff:0:a00:1',         // IPv4-translated 10.0.0.1
    '2001::1',                // Teredo
    '2001:db8::1',
    '3fff::1',
    'fc00::1',
    'fe80::1%en0',
    'ff02::1',
    '::',
    '::1',
    '0.0.0.0',
    '0.1.2.3',
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
});

test('isBlockedIp allows public IPv4 and IPv6 hosts, including IPv6 forms that embed a public IPv4 address', () => {
  for (const ip of [
    '93.184.216.34',
    '2606:4700:4700::1111',
    '2a00:1450:4001:82a::200e',
    '::ffff:93.184.216.34',
    '64:ff9b::5db8:d822',
    '2002:5db8:d822::1',
  ]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test('assertSafeUrl rejects IPv6 and zero-network literals that reach blocked hosts', async () => {
  for (const url of [
    'http://[::7f00:1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fec0::1]/',
    'http://[2002:c0a8:101::1]/',
    'http://[100::1]/',
    'http://[64:ff9b::a9fe:a9fe]/latest/meta-data/',
    'http://0.0.0.0/',
    'http://0/',
  ]) {
    await assert.rejects(assertSafeUrl(url), /blocked IP/, url);
  }
});

function answers(...addresses) {
  return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

function scriptedLookup(...responses) {
  const calls = [];
  const lookup = (hostname, options, callback) => {
    calls.push({ hostname, options });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    process.nextTick(() => callback(null, next));
  };
  return { lookup, calls };
}

test('guardedLookup hands a socket every answer only when none is blocked', async () => {
  const { lookup } = scriptedLookup(answers('93.184.216.34', '2606:4700:4700::1111'));
  const pinned = guardedLookup(lookup);
  const all = await new Promise((resolve, reject) => pinned('media.example', { all: true }, (error, list) => (error ? reject(error) : resolve(list))));
  assert.deepEqual(all.map(({ address }) => address), ['93.184.216.34', '2606:4700:4700::1111']);
  const single = await new Promise((resolve, reject) => pinned('media.example', {}, (error, address, family) => (error ? reject(error) : resolve({ address, family }))));
  assert.deepEqual(single, { address: '93.184.216.34', family: 4 });
});

test('guardedLookup refuses a socket when any answer is blocked', async () => {
  const { lookup } = scriptedLookup(answers('93.184.216.34', '10.0.0.5'));
  const error = await new Promise((resolve) => guardedLookup(lookup)('mixed.example', { all: true }, resolve));
  assert.match(error.message, /mixed\.example resolves to blocked IP 10\.0\.0\.5/);
  assert.equal(error.code, 'SSRF_BLOCKED');
});

async function withLocalServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('fetchSafeUrl never connects to a private address a rebinding name answers after the check', async () => {
  let served = 0;
  await withLocalServer((req, res) => { served += 1; res.end('INTERNAL-SECRET from 127.0.0.1'); }, async (port) => {
    // The check sees a public address; the connection's own lookup sees loopback.
    const { lookup, calls } = scriptedLookup(answers('93.184.216.34'), answers('127.0.0.1'));
    await assert.rejects(
      fetchSafeUrl(`http://rebind.example:${port}/media.png`, {}, { lookup }),
      /rebind\.example resolves to blocked IP 127\.0\.0\.1/
    );
    assert.equal(calls.length, 2, 'one lookup for the check, one for the connection');
  });
  assert.equal(served, 0, 'the private server must receive no request');
});

test('fetchSafeUrl refuses a redirect hop whose connection lookup rebinds to a private address', async () => {
  let served = 0;
  await withLocalServer((req, res) => { served += 1; res.end('INTERNAL-SECRET'); }, async (port) => {
    const { lookup } = scriptedLookup(answers('93.184.216.34'), answers('127.0.0.1'));
    await assert.rejects(
      fetchSafeUrl('https://93.184.216.34/start.png', {}, {
        lookup,
        fetchImpl: async (url, init) => {
          if (url === 'https://93.184.216.34/start.png') return fakeResponse(302, { location: `http://hop.example:${port}/x.png` });
          return requestWithLookup(url, init, guardedLookup(lookup));
        }
      }),
      /hop\.example resolves to blocked IP 127\.0\.0\.1/
    );
  });
  assert.equal(served, 0);
});

test('requestWithLookup connects to the lookup answer, sends fetch defaults, and decodes gzip', async () => {
  const seen = [];
  await withLocalServer((req, res) => {
    seen.push({ url: req.url, method: req.method, headers: req.headers });
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/elsewhere' });
      res.end('moved');
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png', 'content-encoding': 'gzip' });
    res.end(gzipSync(Buffer.from('png bytes')));
  }, async (port) => {
    const lookup = (hostname, options, callback) => {
      seen.push({ lookup: hostname });
      if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
      else callback(null, '127.0.0.1', 4);
    };
    const response = await requestWithLookup(`http://media.example:${port}/x.png`, {}, lookup);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'png bytes');

    const redirect = await requestWithLookup(`http://media.example:${port}/redirect`, {}, lookup);
    assert.equal(redirect.status, 302, 'redirects are returned, not followed');
    assert.equal(redirect.headers.get('location'), '/elsewhere');
    await redirect.body.cancel();

    const head = await requestWithLookup(`http://media.example:${port}/x.png`, { method: 'HEAD' }, lookup);
    assert.equal(head.body, null);
  });
  assert.deepEqual(seen.filter((entry) => entry.lookup).map((entry) => entry.lookup), ['media.example', 'media.example', 'media.example']);
  const first = seen.find((entry) => entry.url === '/x.png');
  assert.equal(first.headers['user-agent'], 'node');
  assert.equal(first.headers.accept, '*/*');
  assert.equal(first.headers['accept-encoding'], 'gzip, deflate');
  assert.equal(seen.filter((entry) => entry.url === '/elsewhere').length, 0);
});

test('requestWithLookup refuses request bodies and non-HTTP protocols', () => {
  assert.throws(() => requestWithLookup('http://media.example/', { method: 'POST', body: 'x' }, () => {}), /only GET and HEAD/);
  assert.throws(() => requestWithLookup('ftp://media.example/', {}, () => {}), /not http or https/);
});

function streamedResponse(chunks, { headers = {}, holdOpen = false } = {}) {
  const state = { cancelled: false };
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      if (!holdOpen) controller.close();
    },
    cancel() { state.cancelled = true; }
  });
  return { response: new Response(body, { status: 200, headers }), state };
}

test('readResponseBody returns the whole body within the limits', async () => {
  const { response } = streamedResponse(['ab', 'cd', 'ef']);
  const bytes = await readResponseBody(response, { maxBytes: 6, stallMs: 1000 });
  assert.equal(bytes.toString(), 'abcdef');
});

test('readResponseBody refuses a declared length over the limit before reading', async () => {
  const { response, state } = streamedResponse(['0123456789'], { headers: { 'content-length': '10' } });
  await assert.rejects(readResponseBody(response, { maxBytes: 4 }), (error) => error.code === 'BODY_TOO_LARGE' && error.maxBytes === 4);
  assert.equal(state.cancelled, true);
});

test('readResponseBody stops a streamed body at the limit', async () => {
  const { response, state } = streamedResponse(['0123', '4567', '89'], { holdOpen: true });
  await assert.rejects(readResponseBody(response, { maxBytes: 6 }), (error) => error.code === 'BODY_TOO_LARGE');
  assert.equal(state.cancelled, true);
});

test('readResponseBody gives up on a body that stops sending data', async () => {
  const { response, state } = streamedResponse(['first bytes'], { holdOpen: true });
  const started = Date.now();
  await assert.rejects(readResponseBody(response, { maxBytes: 1024, stallMs: 50 }), (error) => error.code === 'BODY_STALLED' && error.stallMs === 50);
  assert.ok(Date.now() - started < 5000);
  assert.equal(state.cancelled, true);
});

function proxyContext(env, { execArgv = [], nodeVersion = '24.11.0' } = {}) {
  return { env, execArgv, nodeVersion };
}

test('fetchUsesEnvProxy follows each Node version\'s rule for turning the environment proxy on', () => {
  const https = 'https://media.example/a.png';
  const proxied = { HTTPS_PROXY: 'http://proxy:3128' };
  const uses = (env, nodeVersion, execArgv = []) => fetchUsesEnvProxy(https, proxyContext(env, { nodeVersion, execArgv }));
  assert.equal(uses({ NODE_USE_ENV_PROXY: '1' }, '24.22.3'), false, 'no proxy variable');
  for (const nodeVersion of ['22.11.0', '22.20.0', '22.21.0', '24.0.0', '24.22.3', '26.6.0']) {
    assert.equal(uses(proxied, nodeVersion), false, `${nodeVersion}: a proxy variable alone`);
  }
  for (const nodeVersion of ['22.11.0', '22.20.0']) {
    assert.equal(uses({ ...proxied, NODE_USE_ENV_PROXY: '1' }, nodeVersion), false, `${nodeVersion} reads no proxy`);
  }
  for (const nodeVersion of ['22.21.0', '24.5.0', '24.22.3', '26.6.0']) {
    assert.equal(uses({ ...proxied, NODE_USE_ENV_PROXY: '1' }, nodeVersion), true, nodeVersion);
    assert.equal(uses({ ...proxied, NODE_USE_ENV_PROXY: 'true' }, nodeVersion), false, `${nodeVersion}: only 1 turns it on`);
    assert.equal(uses(proxied, nodeVersion, ['--use-env-proxy']), true, `${nodeVersion}: the flag`);
    assert.equal(uses({ ...proxied, NODE_OPTIONS: '--max-old-space-size=4096 --use-env-proxy' }, nodeVersion), true, `${nodeVersion}: NODE_OPTIONS`);
    assert.equal(uses({ ...proxied, NODE_USE_ENV_PROXY: '1' }, nodeVersion, ['--no-use-env-proxy']), false, `${nodeVersion}: the flag wins`);
  }
  for (const nodeVersion of ['24.0.0', '24.4.1']) {
    for (const value of ['1', 'true', '0']) {
      assert.equal(uses({ ...proxied, NODE_USE_ENV_PROXY: value }, nodeVersion), true, `${nodeVersion}: any non-empty value (${value})`);
    }
    assert.equal(uses({ ...proxied, NODE_USE_ENV_PROXY: '' }, nodeVersion), false);
  }
  for (const nodeVersion of ['23.11.0', '25.2.1', '27.0.0']) {
    assert.equal(uses(proxied, nodeVersion), true, `${nodeVersion}: an unknown rule leaves any proxied request to fetch()`);
  }
});

test('fetchUsesEnvProxy picks the scheme\'s proxy and pins only a host every undici NO_PROXY rule sends direct', () => {
  const uses = (url, env, nodeVersion = '24.22.3') => fetchUsesEnvProxy(url, proxyContext({ NODE_USE_ENV_PROXY: '1', ...env }, { nodeVersion }));
  assert.equal(uses('http://media.example/a.png', { HTTPS_PROXY: 'http://p:1' }), false, 'http needs an http proxy');
  assert.equal(uses('https://media.example/a.png', { HTTP_PROXY: 'http://p:1' }), true, 'https falls back to the http proxy');
  assert.equal(uses('http://media.example/a.png', { http_proxy: '', HTTP_PROXY: 'http://p:1' }), false, 'lowercase wins, even empty');
  const proxied = { HTTPS_PROXY: 'http://p:1' };
  for (const [url, noProxy, viaFetch, why] of [
    ['https://media.example/a.png', 'media.example', false, 'an exact entry'],
    ['https://cdn.media.example/a.png', '.media.example', false, 'a subdomain of a dotted entry'],
    ['https://cdn.media.example/a.png', '*.media.example', false, 'a subdomain of a wildcard entry'],
    ['https://cdn.media.example/a.png', 'media.example', true, 'older undici matches a plain entry only exactly'],
    ['https://media.example/a.png', '.media.example', true, 'older undici matches a dotted entry only as a suffix'],
    ['https://othermedia.example/a.png', 'media.example', true, 'no match without a dot'],
    ['https://media.example/a.png', 'media.example:8443', true, 'another port'],
    ['https://media.example:8443/a.png', 'media.example:8443', false, 'the same port'],
    ['https://media.example/a.png', '*', false, 'every host'],
    ['https://media.example/a.png', 'a.example, media.example', false, 'a list'],
  ]) {
    assert.equal(uses(url, { ...proxied, NO_PROXY: noProxy }), viaFetch, `${why}: ${url} with NO_PROXY=${noProxy}`);
  }
  assert.equal(uses('https://media.example/a.png', { ...proxied, no_proxy: 'other.example', NO_PROXY: 'media.example' }), true, 'lowercase wins');
});

test('fetchSafeUrl sends a hop through Node fetch() and the environment proxy when Node would use one', { timeout: 30_000 }, async (t) => {
  const childEnv = { ...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '', no_proxy: '' };
  if (!fetchUsesEnvProxy('http://93.184.216.34/media.png', { env: childEnv, execArgv: [] })) {
    t.skip(`Node ${process.versions.node} fetch() reads no proxy from the environment`);
    return;
  }
  const proxy = await startLocalProxy((req, res) => {
    res.writeHead(proxiedPath(req) === '/media.png' ? 200 : 404, { 'content-type': 'image/png' });
    res.end('proxied media bytes');
  });
  try {
    // The child gives up after 5 s, so a request that does not reach the proxy fails instead of hanging.
    const script = `import { fetchSafeUrl, readResponseBody } from ${JSON.stringify(new URL('../ssrf-guard.mjs', import.meta.url).href)};
const response = await fetchSafeUrl('http://93.184.216.34/media.png', { signal: AbortSignal.timeout(5000) });
process.stdout.write((await readResponseBody(response, { maxBytes: 1024, stallMs: 5000 })).toString());`;
    const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
      env: { ...childEnv, HTTP_PROXY: proxy.url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const kill = setTimeout(() => child.kill('SIGKILL'), 15_000);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.on('close', resolve));
    clearTimeout(kill);
    assert.equal(code, 0, stderr);
    assert.equal(stdout, 'proxied media bytes');
    assert.ok(
      proxy.requests.includes('GET http://93.184.216.34/media.png') || proxy.requests.includes('CONNECT 93.184.216.34:80'),
      `the proxy received ${JSON.stringify(proxy.requests)}`
    );
  } finally {
    await proxy.close();
  }
});
