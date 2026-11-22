import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';

import {
  assertSafeSogniEndpoints,
  buildHostedClientConfig,
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

test('hosted REST/SSE clients preserve attribution without opening a socket', () => {
  const attribution = {
    connection: {
      interactionKind: 'external_agent',
      agentFramework: 'codex',
      agentSurface: 'personal_skill',
    },
    workload: {
      workloadKind: 'agent_mediated',
      agentFramework: 'codex',
      agentSurface: 'personal_skill',
    },
  };
  const config = buildHostedClientConfig({
    apiKey: 'test-api-key',
    appId: 'test-app-id',
    appSource: 'sogni-creative-agent-skill',
    attribution,
    restEndpoint: 'https://api.sogni.ai',
    socketEndpoint: 'wss://socket.sogni.ai',
  });

  assert.equal(config.disableSocket, true);
  assert.equal(config.appSource, 'sogni-creative-agent-skill');
  assert.deepEqual(config.attribution, attribution);
});

test('assertSafeSogniEndpoints accepts public https and websocket endpoints', async (t) => {
  const hosts = [];
  t.mock.method(dns, 'lookup', (hostname, options, callback) => {
    hosts.push(hostname);
    assert.equal(options.all, true);
    queueMicrotask(() => callback(null, [{ address: '93.184.216.34', family: 4 }]));
  });
  await assertSafeSogniEndpoints({
    restEndpoint: 'https://api.sogni.ai',
    socketEndpoint: 'wss://socket.sogni.ai'
  });
  assert.deepEqual(hosts, ['api.sogni.ai', 'socket.sogni.ai']);
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
