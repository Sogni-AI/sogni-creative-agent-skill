import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const upstreamSyncScript = process.env.SOGNI_CREATIVE_AGENT_SYNC_SCRIPT
  ? process.env.SOGNI_CREATIVE_AGENT_SYNC_SCRIPT
  : join(repoRoot, '..', 'sogni-creative-agent', 'scripts', 'sync-skill-runtime.mjs');
const generatedPath = join(repoRoot, 'generated', 'creative-agent-runtime.mjs');

const STALE_COST_LIMIT_REPAIR_NOTE =
  'You have hit the credit limit for this turn. Top up credits or wait for the daily refill.';
const SPARK_PACKS_COST_LIMIT_REPAIR_NOTE =
  'You have hit the credit limit for this turn. Buy Spark Packs to continue: https://docs.sogni.ai/pricing/#spark-packs';
const PUBLIC_RUNTIME_REEXPORT = "export * from '@sogni-ai/sogni-intelligence-client/public-skill-runtime';";
const PUBLIC_RUNTIME_OVERRIDE_MARKER = 'PUBLIC_SKILL_SPARK_PACKS_COST_LIMIT_OVERRIDE';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function applyPublicRuntimeOverrides(source) {
  let updated = source.replaceAll(STALE_COST_LIMIT_REPAIR_NOTE, SPARK_PACKS_COST_LIMIT_REPAIR_NOTE);
  if (updated.includes(PUBLIC_RUNTIME_REEXPORT) && !updated.includes(PUBLIC_RUNTIME_OVERRIDE_MARKER)) {
    const costLimitMessage = JSON.stringify(SPARK_PACKS_COST_LIMIT_REPAIR_NOTE);
    const overrideBlock = `
// ${PUBLIC_RUNTIME_OVERRIDE_MARKER}
import {
  PUBLIC_SKILL_DEFAULT_POLICIES as SOGNI_PUBLIC_SKILL_DEFAULT_POLICIES,
  PUBLIC_SKILL_DEFAULT_PROMPT_CONTRACTS as SOGNI_PUBLIC_SKILL_DEFAULT_PROMPT_CONTRACTS,
  PUBLIC_SKILL_DEFAULT_REPAIR_RECIPES as SOGNI_PUBLIC_SKILL_DEFAULT_REPAIR_RECIPES,
  createPublicSkillContractRuntime as createSogniPublicSkillContractRuntime,
} from '@sogni-ai/sogni-intelligence-client/public-skill-runtime';

export const PUBLIC_SKILL_DEFAULT_REPAIR_RECIPES = SOGNI_PUBLIC_SKILL_DEFAULT_REPAIR_RECIPES.map((recipe) =>
  recipe.errorCode === 'COST_LIMIT_EXCEEDED'
    ? { ...recipe, message: ${costLimitMessage} }
    : recipe
);

export function createPublicSkillDefaultContractRuntime(input = {}) {
  return createSogniPublicSkillContractRuntime({
    policies: [
      ...SOGNI_PUBLIC_SKILL_DEFAULT_POLICIES,
      ...(input.policies ?? []),
    ],
    promptContracts: [
      ...SOGNI_PUBLIC_SKILL_DEFAULT_PROMPT_CONTRACTS,
      ...(input.promptContracts ?? []),
    ],
    repairRecipes: [
      ...PUBLIC_SKILL_DEFAULT_REPAIR_RECIPES,
      ...(input.repairRecipes ?? []),
    ],
  });
}
`;
    updated = updated.replace(PUBLIC_RUNTIME_REEXPORT, `${PUBLIC_RUNTIME_REEXPORT}\n${overrideBlock}`);
  }
  return updated;
}

if (!existsSync(upstreamSyncScript)) {
  console.error(`Missing Sogni Creative Agent runtime sync script: ${upstreamSyncScript}`);
  console.error('Set SOGNI_CREATIVE_AGENT_SYNC_SCRIPT or check out sogni-creative-agent as a sibling repo.');
  process.exit(1);
}

const INTELLIGENCE_CLIENT = '@sogni-ai/sogni-intelligence-client';

function installedClientVersion(fromDir) {
  const manifest = join(fromDir, 'node_modules', INTELLIGENCE_CLIENT, 'package.json');
  if (!existsSync(manifest)) return null;
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version || null;
  } catch {
    return null;
  }
}

// The upstream sync script generates the prompt contracts from ITS OWN copy of the
// intelligence client, not ours. If that copy is older than the version this repo pins, the
// sync silently regenerates the runtime from stale contracts and DELETES everything added
// since — an easy change to land unnoticed, because it looks like a routine "runtime is
// stale" diff. Fail loudly on a version mismatch instead of emitting a downgrade.
const upstreamRoot = dirname(dirname(upstreamSyncScript));
const ourClientVersion = installedClientVersion(repoRoot);
const upstreamClientVersion = installedClientVersion(upstreamRoot);

if (ourClientVersion && upstreamClientVersion && ourClientVersion !== upstreamClientVersion) {
  console.error(`Refusing to sync: ${INTELLIGENCE_CLIENT} version mismatch.`);
  console.error(`  this repo:     ${ourClientVersion}`);
  console.error(`  ${upstreamRoot}: ${upstreamClientVersion}`);
  console.error('');
  console.error('The upstream sync script builds the prompt contracts from its own node_modules,');
  console.error('so syncing now would regenerate generated/creative-agent-runtime.mjs from the');
  console.error('older contract set and drop anything added since that version.');
  console.error('');
  console.error(`Fix: npm install --prefix ${upstreamRoot}`);
  process.exit(1);
}

if (!upstreamClientVersion) {
  console.warn(`Warning: could not resolve ${INTELLIGENCE_CLIENT} in ${upstreamRoot};`);
  console.warn('skipping version-parity check. Verify the generated diff before committing.');
}

const syncResult = run(process.execPath, [upstreamSyncScript], {
  env: {
    ...process.env,
    SOGNI_CREATIVE_AGENT_SKILL_DIR: repoRoot,
  },
  stdio: 'inherit',
});
if (syncResult.status !== 0) {
  process.exit(syncResult.status || 1);
}

if (!existsSync(generatedPath)) {
  console.error('Runtime sync completed but generated/creative-agent-runtime.mjs was not created.');
  process.exit(1);
}

const generated = readFileSync(generatedPath, 'utf8');
const updated = applyPublicRuntimeOverrides(generated);
if (updated !== generated) {
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, updated);
  console.log(`Applied public skill runtime overrides to ${generatedPath}`);
}
