/**
 * SDK transport coverage for Phase 6 P0.
 *
 * Asserts each factory helper in `sogni-hosted-client.mjs` forwards to
 * the expected `SogniClient` method with the args the migrated skill
 * call-sites send. This is the contract every dispatcher
 * (`dispatchWorkflowActionViaSdk`, `dispatchChatHostedViaSdk`) relies
 * on — if a helper is renamed, mis-spells a method, or stops passing
 * an argument through, this suite turns red without needing a live
 * SDK or a running API.
 *
 * The factory's own opt-in + SSRF behavior is covered by
 * `test/sogni-hosted-client.test.mjs`; this suite is purely about
 * "the helper called the right SDK method with the right args".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sdkStartCreativeWorkflow,
  sdkGetCreativeWorkflow,
  sdkListCreativeWorkflows,
  sdkListCreativeWorkflowEvents,
  sdkCancelCreativeWorkflow,
  sdkStreamCreativeWorkflowEvents,
  sdkChatHostedCreate,
  sdkChatRunsCreate,
  sdkChatRunsGet,
  sdkChatRunsCancel,
  sdkChatRunsStreamEvents
} from '../sogni-hosted-client.mjs';

function recordingClient() {
  const calls = [];
  const record = (group, method) => (...args) => {
    calls.push({ group, method, args });
    return { group, method, echo: args };
  };
  async function* recordIter(group, method) {
    // Forwarded args are captured before the first yield so the caller
    // can assert them even if it never consumes the iterator.
    return; // no-op iterator body; helpers re-yield via for-await
  }
  return {
    calls,
    workflows: {
      start: record('workflows', 'start'),
      get: record('workflows', 'get'),
      list: record('workflows', 'list'),
      events: record('workflows', 'events'),
      cancel: record('workflows', 'cancel'),
      streamEvents: (...args) => {
        calls.push({ group: 'workflows', method: 'streamEvents', args });
        return recordIter('workflows', 'streamEvents');
      }
    },
    chat: {
      hosted: {
        create: record('chat.hosted', 'create')
      },
      runs: {
        create: record('chat.runs', 'create'),
        get: record('chat.runs', 'get'),
        cancel: record('chat.runs', 'cancel'),
        streamEvents: (...args) => {
          calls.push({ group: 'chat.runs', method: 'streamEvents', args });
          return recordIter('chat.runs', 'streamEvents');
        }
      }
    }
  };
}

test('sdkStartCreativeWorkflow forwards input + options to client.workflows.start', async () => {
  const client = recordingClient();
  const input = { steps: [{ toolName: 'generate_image', arguments: { prompt: 'a' } }] };
  const options = { idempotencyKey: 'abc-123' };
  await sdkStartCreativeWorkflow(client, input, options);
  assert.deepEqual(client.calls, [
    { group: 'workflows', method: 'start', args: [input, options] }
  ]);
});

test('sdkGetCreativeWorkflow forwards workflowId to client.workflows.get', async () => {
  const client = recordingClient();
  await sdkGetCreativeWorkflow(client, 'wf_42');
  assert.deepEqual(client.calls, [
    { group: 'workflows', method: 'get', args: ['wf_42'] }
  ]);
});

test('sdkListCreativeWorkflows forwards list options', async () => {
  const client = recordingClient();
  await sdkListCreativeWorkflows(client, { limit: 20 });
  assert.deepEqual(client.calls, [
    { group: 'workflows', method: 'list', args: [{ limit: 20 }] }
  ]);
});

test('sdkListCreativeWorkflowEvents forwards workflowId to client.workflows.events', async () => {
  const client = recordingClient();
  await sdkListCreativeWorkflowEvents(client, 'wf_77');
  assert.deepEqual(client.calls, [
    { group: 'workflows', method: 'events', args: ['wf_77'] }
  ]);
});

test('sdkCancelCreativeWorkflow forwards workflowId to client.workflows.cancel', async () => {
  const client = recordingClient();
  await sdkCancelCreativeWorkflow(client, 'wf_88');
  assert.deepEqual(client.calls, [
    { group: 'workflows', method: 'cancel', args: ['wf_88'] }
  ]);
});

test('sdkStreamCreativeWorkflowEvents forwards options to client.workflows.streamEvents', async () => {
  const client = recordingClient();
  // Trigger the iterator factory; we only assert the args were
  // captured. The recordingClient's iterator body is a no-op.
  const iter = sdkStreamCreativeWorkflowEvents(client, 'wf_55', { lastEventId: 7 });
  // Drive the iterator once so the underlying call happens.
  await iter.next();
  assert.deepEqual(client.calls, [
    { group: 'workflows', method: 'streamEvents', args: ['wf_55', { lastEventId: 7 }] }
  ]);
});

test('sdkChatHostedCreate forwards the full hosted chat body to client.chat.hosted.create', async () => {
  const client = recordingClient();
  const body = {
    model: 'qwen3.6-35b-a3b-gguf-iq4xs',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.4,
    max_tokens: 1600,
    token_type: 'spark',
    app_source: 'sogni-creative-agent-skill',
    sogni_tools: 'creative-agent',
    sogni_tool_execution: true,
    task_profile: 'general',
    chat_template_kwargs: { enable_thinking: false },
    media_references: [{ kind: 'image', url: 'https://example/x.png' }]
  };
  await sdkChatHostedCreate(client, body);
  assert.deepEqual(client.calls, [
    { group: 'chat.hosted', method: 'create', args: [body] }
  ]);
});

test('sdkChatRunsCreate forwards the durable run params to client.chat.runs.create', async () => {
  const client = recordingClient();
  const params = {
    model: 'qwen3.6-35b-a3b-gguf-iq4xs',
    messages: [{ role: 'user', content: 'kick off durable run' }],
    tokenType: 'spark',
    appSource: 'sogni-creative-agent-skill',
    idempotencyKey: 'idem-1'
  };
  await sdkChatRunsCreate(client, params);
  assert.deepEqual(client.calls, [
    { group: 'chat.runs', method: 'create', args: [params] }
  ]);
});

test('sdkChatRunsGet forwards runId to client.chat.runs.get', async () => {
  const client = recordingClient();
  await sdkChatRunsGet(client, 'run_123');
  assert.deepEqual(client.calls, [
    { group: 'chat.runs', method: 'get', args: ['run_123'] }
  ]);
});

test('sdkChatRunsCancel forwards runId + reason to client.chat.runs.cancel', async () => {
  const client = recordingClient();
  await sdkChatRunsCancel(client, 'run_456', 'user-requested');
  assert.deepEqual(client.calls, [
    { group: 'chat.runs', method: 'cancel', args: ['run_456', 'user-requested'] }
  ]);
});

test('sdkChatRunsStreamEvents forwards runId + options to client.chat.runs.streamEvents', async () => {
  const client = recordingClient();
  const iter = sdkChatRunsStreamEvents(client, 'run_789', { lastEventId: 12 });
  await iter.next();
  assert.deepEqual(client.calls, [
    { group: 'chat.runs', method: 'streamEvents', args: ['run_789', { lastEventId: 12 }] }
  ]);
});
