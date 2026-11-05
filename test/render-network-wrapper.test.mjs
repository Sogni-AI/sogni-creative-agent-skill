import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SogniClientWrapper } from '@sogni-ai/sogni-intelligence-client';

// The CLI's --network depends on this real client behaviour: a project's own
// network is sent as given, and a project without one is sent as 'fast' whatever
// the connection's network is. If the second half changes, the CLI could stop
// setting it on every project; if the first half changes, --network stops working.
async function networkSentFor(projectNetwork) {
  const wrapper = new SogniClientWrapper({
    apiKey: 'test-api-key',
    authType: 'apiKey',
    network: 'relaxed',
    autoConnect: false
  });
  const sent = [];
  wrapper.ensureConnected = async () => {};
  wrapper.client = {
    projects: {
      create: async (params) => {
        sent.push(params.network);
        throw new Error('stop before sending');
      }
    }
  };
  await assert.rejects(wrapper.createProject({
    type: 'image',
    modelId: 'z_image_turbo_bf16',
    positivePrompt: 'a duck',
    steps: 4,
    ...(projectNetwork ? { network: projectNetwork } : {})
  }));
  return sent[0];
}

test('the client wrapper sends a project\'s own network', async () => {
  assert.equal(await networkSentFor('relaxed'), 'relaxed');
});

test('the client wrapper sends fast for a project without a network, even on a Relaxed connection', async () => {
  assert.equal(await networkSentFor(undefined), 'fast');
});
