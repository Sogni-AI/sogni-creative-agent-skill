import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSafeSogniEndpoints,
  shouldUseSdkTransport
} from '../sogni-hosted-client.mjs';

test('shouldUseSdkTransport is opt-in (defaults to false)', () => {
  const previous = process.env.SOGNI_SKILL_USE_SDK_TRANSPORT;
  delete process.env.SOGNI_SKILL_USE_SDK_TRANSPORT;
  try {
    assert.equal(shouldUseSdkTransport(), false);
    process.env.SOGNI_SKILL_USE_SDK_TRANSPORT = 'true';
    assert.equal(shouldUseSdkTransport(), true);
    process.env.SOGNI_SKILL_USE_SDK_TRANSPORT = '1';
    assert.equal(shouldUseSdkTransport(), true);
    process.env.SOGNI_SKILL_USE_SDK_TRANSPORT = 'off';
    assert.equal(shouldUseSdkTransport(), false);
  } finally {
    if (previous === undefined) {
      delete process.env.SOGNI_SKILL_USE_SDK_TRANSPORT;
    } else {
      process.env.SOGNI_SKILL_USE_SDK_TRANSPORT = previous;
    }
  }
});

test('assertSafeSogniEndpoints accepts a public https endpoint', async () => {
  // Public Sogni endpoint resolves to a non-private IP. SSRF guard returns
  // successfully (no throw). If the network is offline or DNS fails this
  // test will be skipped via the catch below.
  try {
    await assertSafeSogniEndpoints({
      restEndpoint: 'https://api.sogni.ai',
      socketEndpoint: 'wss://socket.sogni.ai'
    });
  } catch (err) {
    if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH/.test(String(err))) {
      // DNS unavailable in this environment — skip rather than fail.
      return;
    }
    throw err;
  }
});

test('assertSafeSogniEndpoints rejects a loopback host', async () => {
  await assert.rejects(
    () =>
      assertSafeSogniEndpoints({
        restEndpoint: 'http://127.0.0.1:8080'
      }),
    /SSRF guard|blocked|loopback|private|reserved/i
  );
});

test('assertSafeSogniEndpoints rejects a link-local cloud metadata host', async () => {
  await assert.rejects(
    () =>
      assertSafeSogniEndpoints({
        restEndpoint: 'http://169.254.169.254/latest/meta-data/'
      }),
    /SSRF guard|blocked|link-local|169\.254|metadata|reserved/i
  );
});

test('assertSafeSogniEndpoints rejects a non-http(s) scheme', async () => {
  await assert.rejects(
    () =>
      assertSafeSogniEndpoints({
        restEndpoint: 'file:///etc/passwd'
      }),
    /SSRF guard|scheme|protocol|invalid|file/i
  );
});

test('assertSafeSogniEndpoints rejects loopback socket endpoint via converted https check', async () => {
  await assert.rejects(
    () =>
      assertSafeSogniEndpoints({
        socketEndpoint: 'ws://127.0.0.1:3001'
      }),
    /SSRF guard|blocked|loopback|private|reserved/i
  );
});
