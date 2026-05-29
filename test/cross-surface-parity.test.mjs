import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_BUILT_IN_SKILLS,
  CROSS_SURFACE_PARITY_FIXTURES,
  CROSS_SURFACE_PARITY_SURFACES,
  PUBLIC_SKILL_DEFAULT_POLICIES,
  PUBLIC_SKILL_DEFAULT_PROMPT_CONTRACTS,
  PUBLIC_SKILL_DEFAULT_REPAIR_RECIPES,
  PUBLIC_SKILL_DEFAULT_TOOL_DEFINITIONS,
  PUBLIC_SKILL_DEFAULT_TOOL_NAMES,
  classifyPublicSkillTurn,
  compilePublicSkillToolSurface,
  createPublicSkillDefaultContractRuntime,
  dispatchPublicSkillToolCall
} from '../generated/creative-agent-runtime.mjs';

// The skill must be a first-class surface in the shared parity contract.
test('CROSS_SURFACE_PARITY_SURFACES includes public_skill', () => {
  assert.ok(
    CROSS_SURFACE_PARITY_SURFACES.includes('public_skill'),
    `expected public_skill in surfaces, got ${CROSS_SURFACE_PARITY_SURFACES.join(', ')}`
  );
});

test('every CROSS_SURFACE_PARITY_FIXTURES entry covers public_skill', () => {
  assert.ok(CROSS_SURFACE_PARITY_FIXTURES.length > 0, 'fixtures bundle should not be empty');
  const missing = [];
  for (const fixture of CROSS_SURFACE_PARITY_FIXTURES) {
    const expectation = fixture.expectations.find((entry) => entry.surface === 'public_skill');
    if (!expectation) {
      missing.push(fixture.id);
      continue;
    }
    assert.equal(typeof expectation.entrypoint, 'string', `${fixture.id}: public_skill expectation needs an entrypoint`);
    const hasTools = Array.isArray(expectation.expectedTools) && expectation.expectedTools.length > 0;
    const hasBehavior = Array.isArray(expectation.expectedBehavior) && expectation.expectedBehavior.length > 0;
    assert.ok(hasTools || hasBehavior, `${fixture.id}: public_skill expectation needs expectedTools or expectedBehavior`);
  }
  assert.equal(missing.length, 0, `fixtures missing public_skill expectations: ${missing.join(', ')}`);
});

test('every tool named in a public_skill expectation is exposed by the default tool surface', () => {
  const toolNames = new Set(PUBLIC_SKILL_DEFAULT_TOOL_NAMES);
  const offenders = [];
  for (const fixture of CROSS_SURFACE_PARITY_FIXTURES) {
    const expectation = fixture.expectations.find((entry) => entry.surface === 'public_skill');
    if (!expectation || !Array.isArray(expectation.expectedTools)) continue;
    for (const tool of expectation.expectedTools) {
      if (!toolNames.has(tool)) offenders.push(`${fixture.id}:${tool}`);
    }
  }
  assert.equal(
    offenders.length,
    0,
    `public_skill expects tools that aren't in PUBLIC_SKILL_DEFAULT_TOOL_NAMES: ${offenders.join(', ')}`
  );
});

// The default contract runtime is what the CLI's --turn-classify /
// --compile-tools / --dispatch-tool flags exercise. If the registry
// shape changes, the CLI breaks silently — pin it here.
test('default contract runtime exposes policies, prompt contracts, and repair recipes', () => {
  const runtime = createPublicSkillDefaultContractRuntime();
  assert.equal(runtime.policies.length, PUBLIC_SKILL_DEFAULT_POLICIES.length);
  assert.equal(runtime.promptContracts.length, PUBLIC_SKILL_DEFAULT_PROMPT_CONTRACTS.length);
  assert.equal(runtime.repairRecipes.length, PUBLIC_SKILL_DEFAULT_REPAIR_RECIPES.length);
});

test('public skill cost-limit repairs point users to Spark Packs', () => {
  const costLimitRecipes = PUBLIC_SKILL_DEFAULT_REPAIR_RECIPES.filter(
    (recipe) => recipe.errorCode === 'COST_LIMIT_EXCEEDED'
  );

  assert.ok(costLimitRecipes.length > 0, 'expected cost-limit repair recipes');
  for (const recipe of costLimitRecipes) {
    assert.match(recipe.message, /Spark Packs/);
    assert.match(recipe.message, /https:\/\/docs\.sogni\.ai\/pricing\/#spark-packs/);
    assert.doesNotMatch(recipe.message, /daily refill|free daily/i);
  }
});

test('classifyPublicSkillTurn returns a stable turn policy with no session signals', () => {
  const runtime = createPublicSkillDefaultContractRuntime();
  const turnPolicy = classifyPublicSkillTurn({
    availableTools: PUBLIC_SKILL_DEFAULT_TOOL_NAMES,
    sessionState: {},
    runtime,
  });
  assert.ok(Array.isArray(turnPolicy.visibleTools));
  assert.ok(Array.isArray(turnPolicy.forbiddenTools));
  assert.ok(Array.isArray(turnPolicy.requiredTools));
  // Every visible tool should be either in the defaults or carried in from
  // availableTools — never a phantom emitted by the runtime.
  for (const name of turnPolicy.visibleTools) {
    assert.ok(
      PUBLIC_SKILL_DEFAULT_TOOL_NAMES.includes(name),
      `turn policy surfaced unknown tool ${name}`
    );
  }
});

test('compilePublicSkillToolSurface filters tools to visible names and attaches prompt fragments', () => {
  const runtime = createPublicSkillDefaultContractRuntime();
  const compiled = compilePublicSkillToolSurface({
    tools: PUBLIC_SKILL_DEFAULT_TOOL_DEFINITIONS,
    sessionState: {},
    runtime,
  });
  assert.ok(Array.isArray(compiled.tools));
  assert.ok(compiled.tools.length <= PUBLIC_SKILL_DEFAULT_TOOL_DEFINITIONS.length);
  for (const tool of compiled.tools) {
    assert.ok(tool.function?.name, 'compiled tool missing function.name');
    assert.ok(
      compiled.turnPolicy.visibleTools.includes(tool.function.name),
      `compiled tool ${tool.function.name} is not in turn policy visibleTools`
    );
  }
});

test('dispatchPublicSkillToolCall returns a verdict shape compatible with --dispatch-tool', () => {
  const runtime = createPublicSkillDefaultContractRuntime();
  const turnPolicy = classifyPublicSkillTurn({
    availableTools: PUBLIC_SKILL_DEFAULT_TOOL_NAMES,
    sessionState: {},
    runtime,
  });
  const target = PUBLIC_SKILL_DEFAULT_TOOL_NAMES[0];
  const verdict = dispatchPublicSkillToolCall({
    toolName: target,
    arguments: {},
    turnPolicy,
    runtime,
  });
  assert.equal(typeof verdict.allowed, 'boolean');
  assert.ok(typeof verdict.mode === 'string' && verdict.mode.length > 0);
});

test('ALL_BUILT_IN_SKILLS covers every skill manifest shipped under skills/*.md', () => {
  const ids = new Set(ALL_BUILT_IN_SKILLS.map((skill) => skill.id));
  // Mirror the skills/*.md docs the CLI ships. These ids must stay in
  // sync with the canonical manifest in @sogni/creative-agent.
  const expectedSubset = [
    'session_control',
    'asset_reference_management',
    'quality_audit',
    'image_generation',
    'image_editing',
    'video_generation',
    'video_editing',
    'music_generation',
    'media_analysis',
    'persona_management',
    'app_settings',
    'composition_planning'
  ];
  for (const expected of expectedSubset) {
    assert.ok(ids.has(expected), `ALL_BUILT_IN_SKILLS missing ${expected}`);
  }
});
