import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import {
  assertSafeUrl as assertSafeUrlReal,
  fetchSafeUrl as fetchSafeUrlReal,
  fetchUsesEnvProxy,
  isBlockedIp,
  readResponseBody,
  requestWithLookup,
} from '../ssrf-guard.mjs';

const TEST_MEDIA_URL = 'https://example.com/sogni-agent-test-reference.png';
const TEST_VIDEO_URL = 'https://example.com/sogni-agent-test-reference.mp4';
const FIXTURE_HOSTS = new Set(['example.com', 'cdn.example.com', 'cdn.sogni.ai']);

// Reference forwarding tests validate fixture hosts without external DNS.
// The real guard still decides whether the resulting address is allowed.
function fixtureLookup(hostname, options, callback) {
  const address = hostname === 'localhost' ? '127.0.0.1'
    : FIXTURE_HOSTS.has(hostname) ? '93.184.216.34' : null;
  queueMicrotask(() => {
    if (address === null) callback(Object.assign(new Error('Unknown fixture host'), { code: 'ENOTFOUND' }));
    else if (options?.all) callback(null, [{ address, family: 4 }]);
    else callback(null, address, 4);
  });
}

function isAllowedTestMediaOrigin(input) {
  const allowed = process.env.SOGNI_AGENT_TEST_RESULT_MEDIA_ORIGIN;
  if (!allowed) return false;
  try {
    const origin = new URL(input).origin;
    return allowed.split(',').map((item) => item.trim()).filter(Boolean).includes(origin);
  } catch {
    return false;
  }
}

async function assertSafeUrl(input, options) {
  const localApi = process.env.SOGNI_AGENT_TEST_HOSTED_API_BASE;
  if (localApi && new URL(input).origin === localApi) return new URL(input);
  if (isAllowedTestMediaOrigin(input)) return new URL(input);
  return assertSafeUrlReal(input, { lookup: fixtureLookup, ...options });
}

async function fetchSafeUrl(input, init, options) {
  const fixturePath = process.env.SOGNI_AGENT_TEST_MEDIA_FIXTURE_PATH;
  if (fixturePath && String(input) === TEST_MEDIA_URL) {
    const bytes = readFileSync(fixturePath);
    // SOGNI_AGENT_TEST_MEDIA_FIXTURE_STALL=1: send half the fixture, then nothing, like a stalled server.
    const body = process.env.SOGNI_AGENT_TEST_MEDIA_FIXTURE_STALL === '1'
      ? new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, Math.ceil(bytes.length / 2))); } })
      : bytes;
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  }
  const videoFixturePath = process.env.SOGNI_AGENT_TEST_VIDEO_FIXTURE_PATH;
  if (videoFixturePath && String(input) === TEST_VIDEO_URL) {
    return new Response(readFileSync(videoFixturePath), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });
  }
  if (!isAllowedTestMediaOrigin(input)) {
    if (!options?.fetchImpl && !fetchUsesEnvProxy(input)) {
      const checked = await assertSafeUrlReal(input, { lookup: fixtureLookup, ...options });
      if (FIXTURE_HOSTS.has(checked.hostname.toLowerCase())) {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      }
    }
    return fetchSafeUrlReal(input, init, { lookup: fixtureLookup, ...options });
  }
  const maxRedirects = options?.maxRedirects ?? 5;
  let current = new URL(input).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isAllowedTestMediaOrigin(current)) {
      return fetchSafeUrlReal(current, init, { lookup: fixtureLookup, ...options });
    }
    const response = await requestWithLookup(current, { ...init, redirect: 'manual' }, dns.lookup);
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel?.().catch(() => {});
    let nextUrl;
    try {
      nextUrl = new URL(location, current).toString();
    } catch {
      throw new Error('SSRF guard: redirect to an invalid URL');
    }
    current = nextUrl;
  }
  throw new Error(`SSRF guard: too many redirects (more than ${maxRedirects})`);
}

export { assertSafeUrl, fetchSafeUrl, isBlockedIp, readResponseBody };
