import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QUALITY_TIERS } from '../generated/creative-agent-runtime.mjs';
import { checkVersionSync } from '../scripts/check-version-sync.mjs';

const repoRoot = process.cwd();
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8');

// Flags that legitimately appear in docs but belong to OTHER tools
// (git, npm, and the separate setup-sogni-agent-skill installer).
const NON_SOGNI_FLAG_ALLOWLIST = new Set([
  '--ff-only',         // git pull
  '--prefix',          // npm
  '--global',          // npm
  '--package-lock-only', // npm
  '--only',            // setup-sogni-agent-skill
  '--uninstall',       // setup-sogni-agent-skill
  '--remove-cli',      // setup-sogni-agent-skill
  '--purge',           // setup-sogni-agent-skill
  '--yes',             // setup-sogni-agent-skill
  '--no-credentials',  // setup-sogni-agent-skill
]);

const DOC_FILES = [
  'SKILL.md',
  'README.md',
  'llm.txt',
  'plugin-skills/sogni-creative-agent/SKILL.md',
  ...readdirSync(join(repoRoot, 'references'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `references/${name}`),
];

function parserFlags() {
  const source = read('sogni-agent.mjs');
  const flags = new Set();
  // Every flag the parser understands is compared as a string literal:
  //   arg === '--flag'   or   RAW_ARGS[0] === '--flag'
  for (const match of source.matchAll(/===\s*'(--[a-z][a-z0-9-]*)'/g)) {
    flags.add(match[1]);
  }
  return flags;
}

function docFlags(text) {
  const flags = new Set();
  for (const match of text.matchAll(/(?<![\w/-])--[a-z][a-z0-9-]*/g)) {
    flags.add(match[0]);
  }
  return flags;
}

test('every CLI flag mentioned in the docs exists in the parser', () => {
  const known = parserFlags();
  assert.ok(known.has('--video') && known.has('--json'), 'parser flag extraction sanity check');
  const problems = [];
  for (const docFile of DOC_FILES) {
    for (const flag of docFlags(read(docFile))) {
      if (NON_SOGNI_FLAG_ALLOWLIST.has(flag)) continue;
      if (!known.has(flag)) problems.push(`${docFile}: ${flag}`);
    }
  }
  assert.deepEqual(problems, [], `Docs mention flags the CLI parser does not define:\n${problems.join('\n')}`);
});

test('version metadata is in sync across every manifest', () => {
  const { problems } = checkVersionSync({ repoRoot });
  assert.deepEqual(problems, [], `Version metadata drifted — run npm run sync:version:\n${problems.join('\n')}`);
});

test('quality preset tables match the generated runtime QUALITY_TIERS', () => {
  assert.ok(QUALITY_TIERS && QUALITY_TIERS.fast && QUALITY_TIERS.hq && QUALITY_TIERS.pro,
    'QUALITY_TIERS missing from the generated runtime');
  for (const docFile of ['README.md', 'references/models.md']) {
    const text = read(docFile);
    for (const [tier, config] of Object.entries(QUALITY_TIERS)) {
      assert.ok(text.includes(config.model), `${docFile}: tier "${tier}" model ${config.model} missing`);
      // shortSide null means the tier inherits the CLI default (512).
      const size = config.shortSide ?? 512;
      assert.ok(text.includes(`${size}x${size}`) || text.includes(`${size}×${size}`),
        `${docFile}: tier "${tier}" size ${size} missing`);
    }
  }
});

test('installer docs describe ChatGPT setup as explicit, not default', () => {
  const checkedFiles = ['README.md', 'llm.txt'];
  const staleClaims = [];
  for (const docFile of checkedFiles) {
    const text = read(docFile);
    if (!text.includes('npx setup-sogni-agent-skill --only=chatgpt')) {
      staleClaims.push(`${docFile}: missing explicit --only=chatgpt setup command`);
    }
    if (/npx setup-sogni-agent-skill[` ]+.*prints ChatGPT Custom-GPT instructions/i.test(text)) {
      staleClaims.push(`${docFile}: implies the default setup run prints ChatGPT instructions`);
    }
  }
  assert.deepEqual(staleClaims, [], staleClaims.join('\n'));
});

test('installer docs mention explicit local-only setup requires existing runtime config dirs', () => {
  const readme = read('README.md');
  const llm = read('llm.txt');

  assert.match(readme, /Start Codex once before running the installer so `~\/\.codex\/` exists/);
  assert.match(readme, /Start Hermes once before running the installer so `~\/\.hermes\/` exists/);
  assert.match(readme, /selected local runtime is not detected, setup exits before installing anything/);
  assert.match(llm, /start Codex once first so ~\/\.codex\/ exists/);
  assert.match(llm, /start Hermes once first so ~\/\.hermes\/ exists/);
});

test('Claude plugin skill does not tell agents to install a duplicate personal Claude skill', () => {
  const pluginSkill = read('plugin-skills/sogni-creative-agent/SKILL.md');

  assert.match(pluginSkill, /npm install -g @sogni-ai\/sogni-creative-agent-skill@latest/);
  assert.doesNotMatch(pluginSkill, /Install everything.*npx setup-sogni-agent-skill/);
  assert.match(pluginSkill, /separate personal skill registration in `~\/\.claude\/skills\/`/);
  assert.match(pluginSkill, /cleanup command does not uninstall the Claude Code plugin itself/);
});

test('plugin and marketplace manifests are valid JSON with the expected shape', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(plugin.name, 'sogni-creative-agent');
  assert.equal(plugin.skills, './plugin-skills');

  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(marketplace.name, 'sogni');
  assert.equal(marketplace.plugins?.[0]?.name, 'sogni-creative-agent');

  const openclaw = JSON.parse(read('openclaw.plugin.json'));
  assert.ok(openclaw.configSchema || openclaw.config || openclaw.version, 'openclaw manifest parsed');
});

test('SKILL.md reference pointers resolve to real files', () => {
  const text = read('SKILL.md');
  for (const match of text.matchAll(/\]\(\.\/((?:references|skills)\/[\w./-]+)\)/g)) {
    assert.doesNotThrow(() => read(match[1]), `SKILL.md points at missing file ${match[1]}`);
  }
});

test('10Eros prompting guidance preserves start-frame and cinematic performance intent', () => {
  const skill = read('SKILL.md');
  const text = read('references/private-mature-video.md');

  assert.match(skill, /Whenever the creator explicitly requests 10Eros/);
  assert.match(text, /4-8 present-tense sentences/);
  assert.match(text, /Use the supplied start image exactly as the first frame/);
  assert.match(text, /passing it through\s+`--ref`/);
  assert.match(text, /micro-expressions, small pauses/);
  assert.match(text, /natural and cinematic/);
  assert.match(text, /Do not introduce extra characters/);
  assert.match(text, /"one for this image"/);
  assert.match(text, /Do not answer with generic prompting advice/);
  assert.match(text, /Do not\s+emit section labels such as `Performance:` or `Dialogue:`/);
});

test('SKILL.md core stays lean (progressive disclosure guard)', () => {
  const lineCount = read('SKILL.md').split('\n').length;
  assert.ok(lineCount <= 500,
    `SKILL.md is ${lineCount} lines — keep the always-loaded core under 500 and move depth to references/`);
});
