import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bundlePath = join(repoRoot, 'generated', 'creative-agent-runtime.mjs');
const bundle = readFileSync(bundlePath, 'utf8');

// Substrings the public skill runtime must never bundle. Each entry pairs a
// forbidden token with the reason it would be a leak so failures explain the
// rule rather than just printing a needle.
const FORBIDDEN_TOKENS = [
  ['SOGNI_USERNAME', 'backend service credentials must not be embedded'],
  ['SOGNI_PASSWORD', 'backend service credentials must not be embedded'],
  ['process.env.SOGNI_PASSWORD', 'env access for private secrets must not leak'],
  ['process.env.SOGNI_USERNAME', 'env access for private secrets must not leak'],
  ['process.env.OPENAI_API_KEY', 'env access for private secrets must not leak'],
  ['BEARER ', 'no bearer tokens should be inlined'],
  [
    "from '../sogni-api",
    'imports must not cross into private sogni-api sources',
  ],
  [
    "from '../sogni-chat",
    'imports must not cross into private sogni-chat sources',
  ],
  [
    "from '../sogni-socket",
    'imports must not cross into private sogni-socket sources',
  ],
  [
    'sogni-api/src/',
    'private sogni-api paths must not appear in public bundle',
  ],
  [
    'sogni-chat/src/',
    'private sogni-chat paths must not appear in public bundle',
  ],
  [
    'sogni-socket/src/',
    'private sogni-socket paths must not appear in public bundle',
  ],
  [
    'server/.env',
    'server env file paths must not appear in public bundle',
  ],
  ['createSecretCipher', 'private credential cipher helpers must not be bundled'],
  ['INTERNAL_PROMPT_ONLY', 'internal-only prompt marker must not appear'],
];

test('public skill runtime bundle has no private-import or secret leakage', () => {
  for (const [token, reason] of FORBIDDEN_TOKENS) {
    if (bundle.includes(token)) {
      assert.fail(`Found forbidden token "${token}" in generated/creative-agent-runtime.mjs: ${reason}`);
    }
  }
});

function extractImportSpecifiers(source) {
  // Match top-level ES module import / export-from statements only.
  // Anchored with multiline `^` to avoid false positives inside string literals
  // (e.g. `'duration: ' + value + ' seconds'`).
  const patterns = [
    /^\s*import\s+[^'";]*from\s+(['"])([^'"]+)\1\s*;?\s*$/gm,
    /^\s*import\s+(['"])([^'"]+)\1\s*;?\s*$/gm,
    /^\s*export\s+[^'";]*from\s+(['"])([^'"]+)\1\s*;?\s*$/gm,
  ];
  const specifiers = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[2]);
    }
  }
  return specifiers;
}

test('public skill runtime bundle has no relative import statements', () => {
  // Sync script must inline everything; any surviving relative import means a
  // private module slipped through the bundling step.
  const specifiers = extractImportSpecifiers(bundle);
  const relative = specifiers.filter((spec) => spec.startsWith('./') || spec.startsWith('../'));
  if (relative.length > 0) {
    assert.fail(
      `Expected 0 relative imports in generated bundle, found ${relative.length}:\n  ${relative.slice(0, 5).join('\n  ')}`,
    );
  }
});

// Bare specifiers the runtime is permitted to re-export from. The skill ships
// alongside @sogni-ai/sogni-intelligence-client, so subpath exports of that
// package are bundled by reference rather than inlined. Any other bare import
// would break the LLM-tool environment, which has no package manager.
const ALLOWED_BARE_SPECIFIER_PREFIXES = [
  '@sogni-ai/sogni-intelligence-client',
];

function isAllowedBareSpecifier(spec) {
  return ALLOWED_BARE_SPECIFIER_PREFIXES.some(
    (prefix) => spec === prefix || spec.startsWith(`${prefix}/`),
  );
}

test('public skill runtime bundle has no node: protocol or disallowed bare specifier dependencies', () => {
  const specifiers = extractImportSpecifiers(bundle);
  const nodeProtoSpecs = specifiers.filter((spec) => spec.startsWith('node:'));
  const bareSpecs = specifiers.filter(
    (spec) => !spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('node:'),
  );
  const disallowedBareSpecs = bareSpecs.filter((spec) => !isAllowedBareSpecifier(spec));
  assert.equal(
    nodeProtoSpecs.length,
    0,
    `Public runtime must not import node: builtins (found ${nodeProtoSpecs.length}): ${nodeProtoSpecs.slice(0, 3).join(', ')}`,
  );
  assert.equal(
    disallowedBareSpecs.length,
    0,
    `Public runtime may only import from allowed bundled packages (${ALLOWED_BARE_SPECIFIER_PREFIXES.join(', ')}); found ${disallowedBareSpecs.length} disallowed: ${disallowedBareSpecs.slice(0, 3).join(', ')}`,
  );
});
