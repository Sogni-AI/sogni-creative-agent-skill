import { readFileSync } from 'node:fs';
import {
  assertSafeUrl as assertSafeUrlReal,
  fetchSafeUrl as fetchSafeUrlReal,
  isBlockedIp,
  readResponseBody,
} from '../ssrf-guard.mjs';

const TEST_MEDIA_URL = 'https://example.com/sogni-agent-test-reference.png';
const TEST_VIDEO_URL = 'https://example.com/sogni-agent-test-reference.mp4';

async function assertSafeUrl(input, options) {
  const localApi = process.env.SOGNI_AGENT_TEST_HOSTED_API_BASE;
  if (localApi && new URL(input).origin === localApi) return new URL(input);
  return assertSafeUrlReal(input, options);
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
  return fetchSafeUrlReal(input, init, options);
}

export { assertSafeUrl, fetchSafeUrl, isBlockedIp, readResponseBody };
