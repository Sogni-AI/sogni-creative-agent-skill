#!/usr/bin/env node
/**
 * Verify that the private sibling repo used to generate the public runtime is
 * a clean checkout of its remote default branch HEAD.
 *
 * The generated runtime check can only prove "fresh relative to this local
 * checkout"; this script prevents publish/pack from validating against stale
 * or uncommitted private source.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const strictNetwork = args.has('--strict-network');
const allowDirty = process.env.SOGNI_CREATIVE_AGENT_ALLOW_DIRTY === '1';
const creativeAgentRoot = resolve(
  repoRoot,
  process.env.SOGNI_CREATIVE_AGENT_DIR || join('..', 'sogni-creative-agent'),
);

function runGit(gitArgs, options = {}) {
  const result = spawnSync('git', gitArgs, {
    cwd: creativeAgentRoot,
    encoding: 'utf8',
    timeout: options.timeout,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`git ${gitArgs.join(' ')} failed in ${creativeAgentRoot}: ${reason}`);
  }
  return result.stdout.trim();
}

function resolveRemoteDefaultHead() {
  const result = spawnSync('git', ['ls-remote', '--symref', 'origin', 'HEAD'], {
    cwd: creativeAgentRoot,
    encoding: 'utf8',
    timeout: Number(process.env.SOGNI_CREATIVE_AGENT_LS_REMOTE_TIMEOUT_MS || 10000),
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`git ls-remote --symref origin HEAD failed: ${reason}`);
  }

  let branch = '(default)';
  let sha;
  for (const line of result.stdout.split('\n')) {
    const symrefMatch = line.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/);
    if (symrefMatch) {
      branch = symrefMatch[1];
      continue;
    }
    const headMatch = line.match(/^([0-9a-f]{40})\s+HEAD$/i);
    if (headMatch) sha = headMatch[1].toLowerCase();
  }
  if (!sha) {
    throw new Error('Could not parse remote default HEAD SHA.');
  }
  return { branch, sha };
}

if (!existsSync(join(creativeAgentRoot, '.git'))) {
  console.error(`Missing sibling sogni-creative-agent checkout at ${creativeAgentRoot}`);
  console.error('Set SOGNI_CREATIVE_AGENT_DIR if the private repo lives elsewhere.');
  process.exit(1);
}

const localSha = runGit(['rev-parse', 'HEAD']).toLowerCase();
const status = runGit(['status', '--porcelain']);
if (status && !allowDirty) {
  console.error(`sogni-creative-agent has uncommitted changes at ${creativeAgentRoot}.`);
  console.error('Public runtime publishing must be generated from committed private source.');
  console.error(status);
  console.error('Set SOGNI_CREATIVE_AGENT_ALLOW_DIRTY=1 only for intentional local validation.');
  process.exit(1);
}

let remoteHead;
try {
  remoteHead = resolveRemoteDefaultHead();
} catch (error) {
  const message = `Could not resolve sogni-creative-agent remote default HEAD: ${error.message}`;
  if (strictNetwork) {
    console.error(`${message}. Refusing to continue in strict-network mode.`);
    process.exit(1);
  }
  console.warn(`${message}. Skipping remote freshness check.`);
}

if (remoteHead && localSha !== remoteHead.sha) {
  console.error('sogni-creative-agent checkout is not at the remote default branch HEAD.');
  console.error(`Remote ${remoteHead.branch}: ${remoteHead.sha}`);
  console.error(`Local HEAD:      ${localSha}`);
  console.error(`Fix: git -C ${creativeAgentRoot} fetch origin && git -C ${creativeAgentRoot} checkout ${remoteHead.sha}`);
  process.exit(1);
}

const dirtySuffix = status ? ' with allowed local changes' : '';
console.log(
  `sogni-creative-agent source OK (${localSha.slice(0, 12)}${remoteHead ? ` matches origin/${remoteHead.branch}` : ''}${dirtySuffix}).`,
);
