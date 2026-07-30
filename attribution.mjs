import { randomUUID } from 'node:crypto';
import { PACKAGE_VERSION } from './version.mjs';

export const SOGNI_APP_SOURCE = 'sogni-creative-agent-skill';

const FRAMEWORK_ALIASES = new Map([
  ['codex', 'codex'],
  ['codex-cli', 'codex'],
  ['openai-codex', 'codex'],
  ['claude-code', 'claude-code'],
  ['claude-desktop', 'claude-desktop'],
  ['claude-ai', 'claude-desktop'],
  ['hermes', 'hermes-agent'],
  ['hermes-agent', 'hermes-agent'],
  ['openclaw', 'openclaw'],
  ['clawdbot', 'openclaw'],
]);

const SURFACES = new Set([
  'plugin',
  'personal_skill',
  'mcp',
  'cli',
]);

const EXECUTION_MODES = new Set(['browser', 'durable', 'server', 'unknown']);
// Keep this identical to the SDK/socket/API contract so accepted producer
// values are not silently discarded downstream.
const VERSION_PATTERN = /^[0-9][0-9A-Za-z._+-]{0,31}$/;
const OPERATION_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._:-]{0,127}$/;

function slug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function boundedVersion(value) {
  const normalized = String(value ?? '').trim();
  return VERSION_PATTERN.test(normalized) ? normalized : undefined;
}

function operationId(value) {
  const normalized = String(value ?? '').trim();
  return OPERATION_ID_PATTERN.test(normalized) ? normalized : undefined;
}

export function normalizeAgentFramework(value) {
  return FRAMEWORK_ALIASES.get(slug(value)) ?? 'unknown';
}

export function normalizeAgentSurface(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
  return SURFACES.has(normalized) ? normalized : undefined;
}

export function resolveAgentAttribution({
  env = process.env,
  surfaceVersion = PACKAGE_VERSION,
} = {}) {
  const declaredFramework = normalizeAgentFramework(env.SOGNI_AGENT_FRAMEWORK);
  const openClawInvocation = typeof env.OPENCLAW_PLUGIN_CONFIG === 'string'
    && env.OPENCLAW_PLUGIN_CONFIG.length > 0;
  const hasDeclaredFramework = declaredFramework !== 'unknown';
  const agentFramework = hasDeclaredFramework
    ? declaredFramework
    : openClawInvocation
      ? 'openclaw'
      : 'unknown';
  const declaredSurface = normalizeAgentSurface(env.SOGNI_AGENT_SURFACE);
  const agentSurface = declaredSurface ?? (openClawInvocation ? 'plugin' : 'cli');
  const agentFrameworkVersion = agentFramework === 'unknown'
    ? undefined
    : boundedVersion(env.SOGNI_AGENT_FRAMEWORK_VERSION);
  const executionMode = EXECUTION_MODES.has(String(env.SOGNI_AGENT_EXECUTION_MODE ?? '').trim())
    ? String(env.SOGNI_AGENT_EXECUTION_MODE).trim()
    : undefined;

  return Object.freeze({
    appSource: SOGNI_APP_SOURCE,
    interactionKind: 'external_agent',
    workloadKind: 'agent_mediated',
    agentFramework,
    agentFrameworkVersion,
    agentSurface,
    agentSurfaceVersion: boundedVersion(env.SOGNI_AGENT_SURFACE_VERSION)
      ?? boundedVersion(surfaceVersion)
      ?? undefined,
    executionMode,
    attributionMethod: hasDeclaredFramework || declaredSurface || openClawInvocation
      ? 'wrapper_declared'
      : 'known_source',
  });
}

export function normalizeMcpClientInfo(clientInfo, {
  fallback = resolveAgentAttribution(),
  surfaceVersion = PACKAGE_VERSION,
} = {}) {
  const framework = normalizeAgentFramework(clientInfo?.name);
  const useFallback = framework === 'unknown' && fallback?.agentFramework !== 'unknown';
  return Object.freeze({
    ...fallback,
    agentFramework: useFallback ? fallback.agentFramework : framework,
    agentFrameworkVersion: framework === 'unknown'
      ? (useFallback ? fallback.agentFrameworkVersion : undefined)
      : boundedVersion(clientInfo?.version),
    agentSurface: 'mcp',
    agentSurfaceVersion: boundedVersion(surfaceVersion),
    attributionMethod: framework === 'unknown' && !useFallback
      ? 'known_source'
      : 'wrapper_declared',
  });
}

export function attributionEnvironment(attribution) {
  return {
    SOGNI_AGENT_FRAMEWORK: attribution.agentFramework,
    SOGNI_AGENT_SURFACE: attribution.agentSurface,
    SOGNI_AGENT_SURFACE_VERSION: attribution.agentSurfaceVersion,
    SOGNI_AGENT_FRAMEWORK_VERSION: attribution.agentFrameworkVersion,
    SOGNI_AGENT_EXECUTION_MODE: attribution.executionMode,
  };
}

export function connectionAttribution(attribution) {
  return {
    interactionKind: attribution.interactionKind,
    agentFramework: attribution.agentFramework,
    ...(attribution.agentFrameworkVersion
      ? { agentFrameworkVersion: attribution.agentFrameworkVersion }
      : {}),
    agentSurface: attribution.agentSurface,
    ...(attribution.agentSurfaceVersion
      ? { agentSurfaceVersion: attribution.agentSurfaceVersion }
      : {}),
    ...(attribution.executionMode ? { executionMode: attribution.executionMode } : {}),
  };
}

export function workloadAttributionDefaults(attribution) {
  return {
    workloadKind: attribution.workloadKind,
    agentFramework: attribution.agentFramework,
    ...(attribution.agentFrameworkVersion
      ? { agentFrameworkVersion: attribution.agentFrameworkVersion }
      : {}),
    agentSurface: attribution.agentSurface,
    ...(attribution.agentSurfaceVersion
      ? { agentSurfaceVersion: attribution.agentSurfaceVersion }
      : {}),
    ...(attribution.executionMode ? { executionMode: attribution.executionMode } : {}),
  };
}

export function clientAttribution(attribution) {
  return {
    connection: connectionAttribution(attribution),
    workload: workloadAttributionDefaults(attribution),
  };
}

function generatedOperationId() {
  return `op_${randomUUID()}`;
}

export function createInvocationLineage({
  env = process.env,
  generateOperationId = generatedOperationId,
} = {}) {
  const declaredScope = env.SOGNI_AGENT_OPERATION_SCOPE === 'child' ? 'child' : 'top_level';
  const declaredRoot = operationId(env.SOGNI_AGENT_ROOT_OPERATION_ID);
  const rootOperationId = declaredRoot ?? operationId(env.SOGNI_AGENT_OPERATION_ID)
    ?? generateOperationId();
  const declaredOperation = operationId(env.SOGNI_AGENT_OPERATION_ID);
  const declaredParent = operationId(env.SOGNI_AGENT_PARENT_OPERATION_ID);
  let topLevelIssued = declaredScope === 'child';
  let firstIssued = false;
  let lastOperationId = declaredParent ?? rootOperationId;

  return {
    rootOperationId,
    next({ scope = 'auto', parentOperationId } = {}) {
      // A command invoked as a child cannot promote one of its internal calls
      // into a second top-level workload, even if that code path normally owns
      // the root when the CLI runs standalone.
      const resolvedScope = declaredScope === 'child'
        ? 'child'
        : scope === 'top_level' || scope === 'child'
          ? scope
          : (!topLevelIssued ? 'top_level' : 'child');
      let nextOperationId;
      if (!firstIssued && declaredOperation) {
        nextOperationId = declaredOperation;
      } else if (resolvedScope === 'top_level' && !topLevelIssued) {
        nextOperationId = rootOperationId;
      } else {
        nextOperationId = generateOperationId();
      }
      const resolvedParent = resolvedScope === 'child'
        ? operationId(parentOperationId)
          ?? (!firstIssued ? declaredParent : undefined)
          ?? lastOperationId
          ?? rootOperationId
        : undefined;
      firstIssued = true;
      if (resolvedScope === 'top_level') topLevelIssued = true;
      lastOperationId = nextOperationId;
      return {
        operationScope: resolvedScope,
        operationId: nextOperationId,
        rootOperationId,
        ...(resolvedParent ? { parentOperationId: resolvedParent } : {}),
      };
    },
  };
}

export function semanticWorkloadAttribution(attribution, lineage) {
  return {
    ...workloadAttributionDefaults(attribution),
    ...lineage,
  };
}

export function attributionHeaders(attribution, workload) {
  const headers = {
    'X-App-Source': attribution.appSource,
    'X-Sogni-Interaction-Kind': attribution.interactionKind,
    'X-Sogni-Workload-Kind': workload?.workloadKind ?? attribution.workloadKind,
    'X-Sogni-Agent-Framework': attribution.agentFramework,
    'X-Sogni-Agent-Surface': attribution.agentSurface,
  };
  if (attribution.agentFrameworkVersion) {
    headers['X-Sogni-Agent-Framework-Version'] = attribution.agentFrameworkVersion;
  }
  if (attribution.agentSurfaceVersion) {
    headers['X-Sogni-Agent-Surface-Version'] = attribution.agentSurfaceVersion;
  }
  if (attribution.executionMode) {
    headers['X-Sogni-Execution-Mode'] = attribution.executionMode;
  }
  if (workload?.operationScope) {
    headers['X-Sogni-Operation-Scope'] = workload.operationScope;
  }
  if (workload?.operationId) {
    headers['X-Sogni-Operation-Id'] = workload.operationId;
  }
  if (workload?.rootOperationId) {
    headers['X-Sogni-Root-Operation-Id'] = workload.rootOperationId;
  }
  if (workload?.parentOperationId) {
    headers['X-Sogni-Parent-Operation-Id'] = workload.parentOperationId;
  }
  return headers;
}
