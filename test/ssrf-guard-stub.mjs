import { readFileSync } from 'node:fs';
import {
  assertSafeUrl,
  fetchSafeUrl as fetchSafeUrlReal,
  isBlockedIp,
} from '../ssrf-guard.mjs';

const TEST_MEDIA_URL = 'https://example.com/sogni-agent-test-reference.png';
const TEST_VIDEO_URL = 'https://example.com/sogni-agent-test-reference.mp4';

async function fetchSafeUrl(input, init, options) {
  const fixturePath = process.env.SOGNI_AGENT_TEST_MEDIA_FIXTURE_PATH;
  if (fixturePath && String(input) === TEST_MEDIA_URL) {
    return new Response(readFileSync(fixturePath), {
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

export { assertSafeUrl, fetchSafeUrl, isBlockedIp };
