import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const syncScript = join(repoRoot, 'scripts', 'sync-creative-agent-runtime.mjs');
const generatedPath = join(repoRoot, 'generated', 'creative-agent-runtime.mjs');
const generatedRelativePath = 'generated/creative-agent-runtime.mjs';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

if (!existsSync(syncScript)) {
  console.error(`Missing Sogni Creative Agent runtime sync script: ${syncScript}`);
  console.error('Set SOGNI_CREATIVE_AGENT_SYNC_SCRIPT or check out sogni-creative-agent as a sibling repo.');
  process.exit(1);
}

if (!existsSync(generatedPath)) {
  console.error(`Missing generated runtime file: ${generatedRelativePath}`);
  process.exit(1);
}

// The freshness check needs the private sogni-creative-agent repo to
// regenerate the bundle. External contributors don't have it — the committed
// bundle is the source of truth for them, so skip instead of blocking every
// `npm test`. Publishing stays gated: prepack sets SOGNI_REQUIRE_RUNTIME_SYNC=1.
const upstreamSyncScript = process.env.SOGNI_CREATIVE_AGENT_SYNC_SCRIPT
  || join(repoRoot, '..', 'sogni-creative-agent', 'scripts', 'sync-skill-runtime.mjs');
const requireRuntimeSync = ['1', 'true', 'yes'].includes(
  String(process.env.SOGNI_REQUIRE_RUNTIME_SYNC || '').toLowerCase()
);
if (!existsSync(upstreamSyncScript)) {
  if (requireRuntimeSync) {
    console.error(`Missing upstream runtime sync script: ${upstreamSyncScript}`);
    console.error('SOGNI_REQUIRE_RUNTIME_SYNC=1 is set (publish gate) — the private sogni-creative-agent checkout is required.');
    process.exit(1);
  }
  console.warn('SKIPPING runtime freshness check: the private sogni-creative-agent repo is not available.');
  console.warn(`Tests will run against the committed ${generatedRelativePath}.`);
  process.exit(0);
}

const beforeSync = readFileSync(generatedPath, 'utf8');
const syncResult = run(process.execPath, [syncScript], {
  env: {
    ...process.env,
    SOGNI_CREATIVE_AGENT_SKILL_DIR: repoRoot,
  },
  stdio: 'inherit',
});
if (syncResult.status !== 0) {
  process.exit(syncResult.status || 1);
}

const afterSync = readFileSync(generatedPath, 'utf8');
if (afterSync !== beforeSync) {
  const diffResult = run('git', ['diff', '--', generatedRelativePath]);
  if (diffResult.stdout) process.stderr.write(diffResult.stdout);
  if (diffResult.stderr) process.stderr.write(diffResult.stderr);
  console.error(
    `${generatedRelativePath} is stale. Run npm run sync:creative-agent-runtime and commit the result.`,
  );
  process.exit(1);
}

console.log(`${generatedRelativePath} is fresh.`);
