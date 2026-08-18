import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = process.cwd();
const HERMES_SKILL = '.agents/skills/sogni-creative-agent-skill';
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const mirroredReferences = [
  'hosted-api.md',
  'loop-maker.md',
  'models.md',
  'personas-memory.md',
  'private-mature-video.md',
  'seamless-tiling.md',
  'video-editing.md',
  'video-prompting.md',
];

test('Hermes Hub skill has an exact, self-contained discovery path', () => {
  const skill = read(`${HERMES_SKILL}/SKILL.md`);
  assert.match(skill, /^---\nname: sogni-creative-agent-skill\n/);
  assert.match(skill, /metadata:\n(?:  [^\n]+\n)+  hermes:\n    category: creative/);
  assert.match(skill, /sogni-agent-hermes/);
  assert.doesNotMatch(skill, /\.\.\//, 'Hub skill must not escape its bundle');

  for (const match of skill.matchAll(/\]\(references\/([\w.-]+)\)/g)) {
    assert.ok(
      mirroredReferences.includes(match[1]),
      `unexpected Hermes reference ${match[1]}`,
    );
    assert.doesNotThrow(
      () => read(`${HERMES_SKILL}/references/${match[1]}`),
      `missing Hermes reference ${match[1]}`,
    );
  }
});

test('Hermes Hub reference mirrors stay byte-for-byte current', () => {
  for (const filename of mirroredReferences) {
    assert.equal(
      read(`${HERMES_SKILL}/references/${filename}`),
      read(`references/${filename}`),
      `${basename(filename)} drifted; run npm run sync:hermes-skill`,
    );
  }
});

test('Hermes documentation uses the installable skills.sh identifier', () => {
  const identifier =
    'skills-sh/sogni-ai/sogni-creative-agent-skill/sogni-creative-agent-skill';
  assert.match(read('README.md'), new RegExp(identifier));
  assert.match(read('llm.txt'), new RegExp(identifier));
});

test('npm package includes the self-contained Hermes distribution surface', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.files.includes('.agents/skills/sogni-creative-agent-skill/'));
  assert.ok(pkg.files.includes('scripts/sync-hermes-skill.mjs'));
});
