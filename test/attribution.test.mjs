import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOGNI_APP_SOURCE,
  attributionEnvironment,
  attributionHeaders,
  clientAttribution,
  createInvocationLineage,
  normalizeMcpClientInfo,
  resolveAgentAttribution,
  semanticWorkloadAttribution,
} from '../attribution.mjs';

test('unmarked official CLI is an unattributed external agent, never human', () => {
  const attribution = resolveAgentAttribution({ env: {}, surfaceVersion: '3.21.0' });
  assert.deepEqual(attribution, {
    appSource: SOGNI_APP_SOURCE,
    interactionKind: 'external_agent',
    workloadKind: 'agent_mediated',
    agentFramework: 'unknown',
    agentFrameworkVersion: undefined,
    agentSurface: 'cli',
    agentSurfaceVersion: '3.21.0',
    executionMode: undefined,
    attributionMethod: 'known_source',
  });
});

test('explicit installer markers are normalized and cannot replace appSource', () => {
  const attribution = resolveAgentAttribution({
    env: {
      SOGNI_AGENT_FRAMEWORK: 'OpenAI_Codex',
      SOGNI_AGENT_FRAMEWORK_VERSION: '1.2.3',
      SOGNI_AGENT_SURFACE: 'personal-skill',
      SOGNI_AGENT_SURFACE_VERSION: '3.21.0',
    },
  });
  assert.equal(attribution.appSource, SOGNI_APP_SOURCE);
  assert.equal(attribution.agentFramework, 'codex');
  assert.equal(attribution.agentFrameworkVersion, '1.2.3');
  assert.equal(attribution.agentSurface, 'personal_skill');
  assert.equal(attribution.agentSurfaceVersion, '3.21.0');
  assert.equal(attribution.attributionMethod, 'wrapper_declared');
});

test('OpenClaw is declared only by its runtime-local environment marker', () => {
  const openclaw = resolveAgentAttribution({
    env: { OPENCLAW_PLUGIN_CONFIG: '{}' },
    surfaceVersion: '3.21.0',
  });
  assert.equal(openclaw.agentFramework, 'openclaw');
  assert.equal(openclaw.agentSurface, 'plugin');

  const configPathOnly = resolveAgentAttribution({
    env: { OPENCLAW_CONFIG_PATH: '/tmp/openclaw.json' },
    surfaceVersion: '3.21.0',
  });
  assert.equal(configPathOnly.agentFramework, 'unknown');
  assert.equal(configPathOnly.agentSurface, 'cli');
});

test('unrecognized free-form marker values collapse to bounded unknown values', () => {
  const attribution = resolveAgentAttribution({
    env: {
      SOGNI_AGENT_FRAMEWORK: '../../secret framework',
      SOGNI_AGENT_FRAMEWORK_VERSION: 'not a version with spaces',
      SOGNI_AGENT_SURFACE: 'somewhere',
    },
    surfaceVersion: '3.21.0',
  });
  assert.equal(attribution.agentFramework, 'unknown');
  assert.equal(attribution.agentFrameworkVersion, undefined);
  assert.equal(attribution.agentSurface, 'cli');
});

test('version metadata matches the bounded transport contract', () => {
  const prefixed = resolveAgentAttribution({
    env: {
      SOGNI_AGENT_FRAMEWORK: 'codex',
      SOGNI_AGENT_FRAMEWORK_VERSION: 'v1.2.3',
    },
    surfaceVersion: '3.21.0',
  });
  assert.equal(prefixed.agentFrameworkVersion, undefined);

  const oversized = resolveAgentAttribution({
    env: {
      SOGNI_AGENT_FRAMEWORK: 'codex',
      SOGNI_AGENT_FRAMEWORK_VERSION: `1${'2'.repeat(32)}`,
    },
    surfaceVersion: '3.21.0',
  });
  assert.equal(oversized.agentFrameworkVersion, undefined);
});

test('MCP clientInfo is allowlisted and raw names are never propagated', () => {
  const fallback = resolveAgentAttribution({ env: {}, surfaceVersion: '3.21.0' });
  const codex = normalizeMcpClientInfo(
    { name: 'openai-codex', version: '0.77.0' },
    { fallback, surfaceVersion: '3.21.0' },
  );
  assert.equal(codex.agentFramework, 'codex');
  assert.equal(codex.agentFrameworkVersion, '0.77.0');
  assert.equal(codex.agentSurface, 'mcp');

  const unknown = normalizeMcpClientInfo(
    { name: 'my-company laptop /Users/alice', version: 'private build' },
    { fallback, surfaceVersion: '3.21.0' },
  );
  assert.equal(unknown.agentFramework, 'unknown');
  assert.equal(unknown.agentFrameworkVersion, undefined);
  assert.equal(JSON.stringify(attributionEnvironment(unknown)).includes('alice'), false);
});

test('MCP uses an installer-owned fallback when clientInfo is unknown', () => {
  const fallback = resolveAgentAttribution({
    env: {
      SOGNI_AGENT_FRAMEWORK: 'claude-desktop',
      SOGNI_AGENT_SURFACE: 'mcp',
    },
    surfaceVersion: '3.21.0',
  });
  const attribution = normalizeMcpClientInfo(
    { name: 'unknown-client', version: '1.0.0' },
    { fallback, surfaceVersion: '3.21.0' },
  );
  assert.equal(attribution.agentFramework, 'claude-desktop');
  assert.equal(attribution.agentFrameworkVersion, undefined);
  assert.equal(attribution.agentSurface, 'mcp');
});

test('lineage emits one top-level root and then children', () => {
  const ids = ['op_root', 'op_child_1', 'op_child_2'];
  const lineage = createInvocationLineage({
    env: {},
    generateOperationId: () => ids.shift(),
  });
  const top = lineage.next();
  const child = lineage.next();
  assert.deepEqual(top, {
    operationScope: 'top_level',
    operationId: 'op_root',
    rootOperationId: 'op_root',
  });
  assert.deepEqual(child, {
    operationScope: 'child',
    operationId: 'op_child_1',
    rootOperationId: 'op_root',
    parentOperationId: 'op_root',
  });
});

test('a planning child can precede the top-level intent without consuming it', () => {
  const ids = ['op_root', 'op_planning'];
  const lineage = createInvocationLineage({
    env: {},
    generateOperationId: () => ids.shift(),
  });
  const planning = lineage.next({ scope: 'child' });
  const workflow = lineage.next({ scope: 'top_level' });
  assert.equal(planning.operationScope, 'child');
  assert.equal(planning.rootOperationId, 'op_root');
  assert.equal(workflow.operationScope, 'top_level');
  assert.equal(workflow.operationId, 'op_root');
});

test('a nested child invocation cannot promote its workflow to top level', () => {
  const ids = ['op_nested_child'];
  const lineage = createInvocationLineage({
    env: {
      SOGNI_AGENT_OPERATION_SCOPE: 'child',
      SOGNI_AGENT_OPERATION_ID: 'op_nested',
      SOGNI_AGENT_ROOT_OPERATION_ID: 'op_outer_root',
      SOGNI_AGENT_PARENT_OPERATION_ID: 'op_outer_parent',
    },
    generateOperationId: () => ids.shift(),
  });

  const workflow = lineage.next({ scope: 'top_level' });
  const followup = lineage.next();
  assert.deepEqual(workflow, {
    operationScope: 'child',
    operationId: 'op_nested',
    rootOperationId: 'op_outer_root',
    parentOperationId: 'op_outer_parent',
  });
  assert.deepEqual(followup, {
    operationScope: 'child',
    operationId: 'op_nested_child',
    rootOperationId: 'op_outer_root',
    parentOperationId: 'op_nested',
  });
});

test('client config and REST headers use the same semantic attribution', () => {
  const attribution = resolveAgentAttribution({
    env: {
      SOGNI_AGENT_FRAMEWORK: 'claude-code',
      SOGNI_AGENT_SURFACE: 'plugin',
    },
    surfaceVersion: '3.21.0',
  });
  const lineage = createInvocationLineage({
    env: {},
    generateOperationId: () => 'op_root',
  });
  const workload = semanticWorkloadAttribution(attribution, lineage.next());
  const config = clientAttribution(attribution);
  const headers = attributionHeaders(attribution, workload);

  assert.equal(config.connection.interactionKind, 'external_agent');
  assert.equal(config.workload.workloadKind, 'agent_mediated');
  assert.equal('appSource' in config.connection, false);
  assert.equal('appSource' in config.workload, false);
  assert.equal('attributionMethod' in config.connection, false);
  assert.equal('attributionMethod' in config.workload, false);
  assert.equal(headers['X-App-Source'], SOGNI_APP_SOURCE);
  assert.equal(headers['X-Sogni-Agent-Framework'], 'claude-code');
  assert.equal('X-Sogni-Attribution-Method' in headers, false);
  assert.equal(headers['X-Sogni-Operation-Scope'], 'top_level');
  assert.equal(headers['X-Sogni-Operation-Id'], 'op_root');
});
