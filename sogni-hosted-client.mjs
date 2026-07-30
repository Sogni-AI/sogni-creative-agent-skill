/**
 * Sogni Hosted Client Factory (Phase 6 P0).
 *
 * Wraps the SDK-backed client re-exported by
 * `@sogni-ai/sogni-intelligence-client` for the durable hosted workflow +
 * chat surfaces the skill needs, while preserving the skill's SSRF guard
 * contract.
 *
 * The skill historically called these endpoints via `fetchApiJson` ->
 * `buildSafeApiUrl` -> `assertSafeUrl`. Migrating to the SDK directly
 * would lose the SSRF check because `SogniClient.createInstance`
 * accepts an arbitrary `restEndpoint`. This factory closes the gap:
 *   - Validate the resolved REST + Socket endpoints via `assertSafeUrl`
 *     **before** constructing the client.
 *   - Pin the resolved endpoint on the client so subsequent SDK calls
 *     can't be redirected to an unsafe host.
 *   - Expose a narrow `withClient(apiKey, work)` pattern that
 *     constructs + disposes the SDK client per task, mirroring the
 *     short-lived per-request shape the skill already used for fetch.
 *
 * Opt-in: callers receive the factory only when
 * `SOGNI_SKILL_USE_SDK_TRANSPORT` is truthy. The legacy fetch path
 * remains the default until the durable chat run methods are
 * battle-tested in production.
 */
import { createRequire } from 'node:module';
import { assertSafeUrl } from './ssrf-guard.mjs';
import { getOrCreateSogniAppId } from './sogni-app-id.mjs';

const require = createRequire(import.meta.url);
const { SogniClient } = require('@sogni-ai/sogni-intelligence-client');

function readBoolEnv(name) {
  const raw = process.env[name];
  if (!raw) return false;
  const value = String(raw).trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * Returns true when the skill should route hosted operations through
 * the SDK transport. Default: false. Operators opt in via
 * `SOGNI_SKILL_USE_SDK_TRANSPORT=1` once they've validated the SDK
 * path in their environment.
 */
export function shouldUseSdkTransport() {
  return readBoolEnv('SOGNI_SKILL_USE_SDK_TRANSPORT');
}

/**
 * Validate the resolved API endpoint via the SSRF guard.
 *
 * Accepts `restEndpoint` (https://api.sogni.ai) and `socketEndpoint`
 * (wss://socket.sogni.ai) shaped values. Throws when either fails the
 * guard so the caller can fall back to the legacy fetch path or abort
 * cleanly.
 */
export async function assertSafeSogniEndpoints({ restEndpoint, socketEndpoint }) {
  if (restEndpoint) await assertSafeUrl(restEndpoint);
  if (socketEndpoint) {
    // assertSafeUrl validates `http(s)` schemes; convert ws(s) → https for
    // host/IP resolution checks. The actual websocket connection still
    // uses the original scheme.
    const httpsEquivalent = socketEndpoint.replace(/^ws/i, 'http');
    await assertSafeUrl(httpsEquivalent);
  }
}

export function buildHostedClientConfig({
  apiKey,
  restEndpoint,
  socketEndpoint,
  appSource,
  appId,
  attribution,
}) {
  return {
    appId: appId ?? getOrCreateSogniAppId(),
    apiKey,
    appSource: appSource ?? 'sogni-creative-agent-skill',
    ...(attribution ? { attribution } : {}),
    logLevel: 'error',
    ...(restEndpoint ? { restEndpoint } : {}),
    ...(socketEndpoint ? { socketEndpoint } : {}),
    // Every operation routed through this factory is REST or SSE. Avoid
    // creating a short-lived WebSocket for each hosted call or upload-URL
    // lookup; those connections would add noise to connection telemetry.
    disableSocket: true,
    socketEventSubscriptions: { modelAvailability: false }
  };
}

/**
 * Construct a managed `SogniClient` for the duration of `work`. Disposes
 * the socket connection on completion (matching the per-request shape
 * the skill already used for fetch). The skill is short-lived enough
 * that pooling isn't required; the API process owns long-running pools
 * via `SogniClientSessionService`.
 */
export async function withHostedClient({
  apiKey,
  restEndpoint,
  socketEndpoint,
  appSource,
  appId,
  attribution,
}, work) {
  await assertSafeSogniEndpoints({ restEndpoint, socketEndpoint });
  const client = await SogniClient.createInstance(buildHostedClientConfig({
    apiKey,
    restEndpoint,
    socketEndpoint,
    appSource,
    appId,
    attribution,
  }));
  try {
    return await work(client);
  } finally {
    try {
      client.dispose();
    } catch {
      // Best-effort dispose; do not mask the original error.
    }
  }
}

/**
 * Helper: start a durable creative workflow via the SDK and return the
 * resulting record. Caller is responsible for SSRF endpoint validation;
 * the factory handles that via `withHostedClient`.
 */
export async function sdkStartCreativeWorkflow(client, input, options = {}) {
  return client.workflows.start(input, options);
}

export async function sdkGetCreativeWorkflow(client, workflowId) {
  return client.workflows.get(workflowId);
}

export async function sdkListCreativeWorkflows(client, options = {}) {
  return client.workflows.list(options);
}

export async function sdkListCreativeWorkflowEvents(client, workflowId) {
  return client.workflows.events(workflowId);
}

export async function sdkCancelCreativeWorkflow(client, workflowId) {
  return client.workflows.cancel(workflowId);
}

/**
 * SSE iterator wrapper. The underlying SDK iterator yields parsed
 * `CreativeWorkflowSseEvent`s; the skill's UI loop already knows how
 * to interpret them, so we forward as-is.
 */
export async function* sdkStreamCreativeWorkflowEvents(client, workflowId, options = {}) {
  yield* client.workflows.streamEvents(workflowId, options);
}

/**
 * Synchronous hosted chat completion. Mirrors the
 * `POST /v1/chat/completions` REST surface but goes through the SDK so
 * the SSRF guard runs at client construction and the SDK's typed
 * `HostedChatCompletionParams` shape is enforced. Returns the raw
 * `HostedChatCompletionResult` so the skill's existing extractors
 * (`extractChatMessage`, `extractChatWorkflows`) keep working.
 */
export async function sdkChatHostedCreate(client, params) {
  return client.chat.hosted.create(params);
}

/**
 * Submit a durable hosted chat run. Returns the persisted record
 * immediately; the executor drives the LLM/tool loop server-side.
 */
export async function sdkChatRunsCreate(client, params) {
  return client.chat.runs.create(params);
}

export async function sdkChatRunsGet(client, runId) {
  return client.chat.runs.get(runId);
}

export async function sdkChatRunsCancel(client, runId, reason) {
  return client.chat.runs.cancel(runId, reason);
}

/**
 * SSE iterator for durable chat run events. Honors `lastEventId` in
 * `options` so callers can resume after disconnect via Last-Event-ID
 * replay.
 */
export async function* sdkChatRunsStreamEvents(client, runId, options = {}) {
  yield* client.chat.runs.streamEvents(runId, options);
}

/**
 * Image asset upload URL. Mirrors `GET /v1/image/uploadUrl` and
 * returns the presigned URL string. Params shape:
 *   { imageId, jobId, type: 'referenceImage'|'referenceImageEnd'|'contextImageN'|..., contentType? }
 *
 * Returns the URL string the caller should `PUT` the asset to.
 */
export async function sdkImageUploadUrl(client, params) {
  return client.projects.uploadUrl(params);
}

/**
 * Image asset download URL. Mirrors `GET /v1/image/downloadUrl`.
 */
export async function sdkImageDownloadUrl(client, params) {
  return client.projects.downloadUrl(params);
}

/**
 * Media (audio/video) asset upload URL. Mirrors `GET /v1/media/uploadUrl`.
 * Params shape:
 *   { id?, jobId, type: 'referenceAudio'|'referenceVideo'|..., contentType? }
 */
export async function sdkMediaUploadUrl(client, params) {
  return client.projects.mediaUploadUrl(params);
}

/**
 * Media (audio/video) asset download URL. Mirrors
 * `GET /v1/media/downloadUrl`.
 */
export async function sdkMediaDownloadUrl(client, params) {
  return client.projects.mediaDownloadUrl(params);
}
