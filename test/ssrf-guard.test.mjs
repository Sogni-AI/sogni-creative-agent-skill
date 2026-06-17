import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUrl, fetchSafeUrl, isBlockedIp } from '../ssrf-guard.mjs';

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
