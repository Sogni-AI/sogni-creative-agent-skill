#!/usr/bin/env node
/**
 * Verify that package.json's version has been stamped into every manifest
 * that carries package identity. Keep this separate from sync-version so
 * release gates can fail without mutating the tree.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRepoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function read(repoRoot, relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function readJson(repoRoot, relativePath, problems) {
  try {
    return JSON.parse(read(repoRoot, relativePath));
  } catch (error) {
    problems.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function expectVersion(problems, label, actual, expected) {
  if (actual !== expected) {
    problems.push(`${label}: expected ${expected}, found ${actual ?? '(missing)'}`);
  }
}

export function checkVersionSync({ repoRoot = defaultRepoRoot } = {}) {
  const problems = [];
  const pkg = readJson(repoRoot, 'package.json', problems);
  const version = pkg?.version;
  if (!version) {
    problems.push('package.json: missing version');
    return { version, problems };
  }

  const versionModule = read(repoRoot, 'version.mjs').match(/^export const PACKAGE_VERSION = '([^']+)';\s*$/m);
  expectVersion(problems, 'version.mjs PACKAGE_VERSION', versionModule?.[1], version);

  const skill = read(repoRoot, 'SKILL.md').match(/^\s*version:\s*"([^"]+)"/m);
  expectVersion(problems, 'SKILL.md metadata.version', skill?.[1], version);

  for (const manifest of [
    '.claude-plugin/plugin.json',
    'openclaw.plugin.json',
    'desktop-extension/manifest.json',
  ]) {
    const parsed = readJson(repoRoot, manifest, problems);
    if (parsed) expectVersion(problems, `${manifest} version`, parsed.version, version);
  }

  return { version, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version, problems } = checkVersionSync();
  if (problems.length > 0) {
    console.error(`Version metadata drifted from package.json${version ? ` (${version})` : ''}:`);
    for (const problem of problems) console.error(`- ${problem}`);
    console.error('Run `npm run sync:version` and include the changed stamp files in the release.');
    process.exit(1);
  }
  console.log(`Version metadata OK (${version}).`);
}
