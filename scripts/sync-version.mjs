/**
 * Stamp the package.json version into every other manifest that carries it:
 *   version.mjs, SKILL.md frontmatter, .claude-plugin/plugin.json,
 *   openclaw.plugin.json, desktop-extension/manifest.json.
 *
 * package.json is the single source of truth. The docs-consistency test (and
 * CI) fail when any of these drift, so run `npm run sync:version` after every
 * version bump instead of hand-editing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`package.json version "${version}" does not look like semver; refusing to stamp.`);
  process.exit(1);
}

const changes = [];

function stamp(relativePath, replacer) {
  const filePath = join(repoRoot, relativePath);
  const before = readFileSync(filePath, 'utf8');
  const after = replacer(before);
  if (after === before) return;
  writeFileSync(filePath, after);
  changes.push(relativePath);
}

stamp('version.mjs', () => `export const PACKAGE_VERSION = '${version}';\n`);

stamp('SKILL.md', (text) => {
  const updated = text.replace(/^(\s*version:\s*)"[^"]+"/m, `$1"${version}"`);
  if (!/^\s*version:\s*"/m.test(text)) {
    console.error('SKILL.md frontmatter has no version field to stamp.');
    process.exit(1);
  }
  return updated;
});

for (const manifest of ['.claude-plugin/plugin.json', 'openclaw.plugin.json', 'desktop-extension/manifest.json']) {
  stamp(manifest, (text) => {
    const parsed = JSON.parse(text);
    if (parsed.version === version) return text;
    // Targeted string replace preserves the existing key order and formatting.
    return text.replace(`"version": "${parsed.version}"`, `"version": "${version}"`);
  });
}

if (changes.length === 0) {
  console.log(`All manifests already at ${version}.`);
} else {
  console.log(`Stamped ${version} into: ${changes.join(', ')}`);
}
