import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QUALITY_TIERS } from '../generated/creative-agent-runtime.mjs';
import { VIDEO_MODEL_ALIASES } from '@sogni-ai/sogni-intelligence-client/public-skill-runtime';
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
  '.agents/skills/sogni-creative-agent-skill/SKILL.md',
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

test('release config keeps semantic version tags explicit', () => {
  const releaseConfig = JSON.parse(read('.releaserc.json'));
  assert.equal(releaseConfig.tagFormat, 'v${version}');
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

test('Krea identity routing follows typed shared policy without prose parsing', () => {
  const skill = read('SKILL.md');
  const models = read('references/models.md');

  for (const text of [skill, models]) {
    assert.match(text, /preserve likeness or\s+character identity/);
    assert.match(text, /explicitly requested model always wins/i);
    assert.match(text, /base scene first/);
    assert.match(text, /1-4 sentence delta instruction/);
    assert.match(text, /do not send a negative prompt/);
    assert.match(text, /leave steps, guidance, sampler,\s+and scheduler unset/);
    assert.match(text, /any\s+language; never route from keyword or regex matching/);
  }
  assert.match(skill, /agents must pass the Krea model explicitly/);
});

test('every runtime video model alias is documented in references/models.md', () => {
  // Data-driven guard: the alias map ships with the pinned intelligence-client,
  // so a new model family (e.g. Seedance 2.5) fails this test until models.md
  // documents its selectors — no hardcoded per-family checklist to forget.
  const aliases = Object.keys(VIDEO_MODEL_ALIASES);
  assert.ok(aliases.includes('seedance2') && aliases.includes('wan22-i2v'),
    'VIDEO_MODEL_ALIASES extraction sanity check');
  const models = read('references/models.md');
  const missing = aliases.filter((alias) => !models.includes(alias));
  assert.deepEqual(missing, [],
    `references/models.md never mentions these CLI video selectors the runtime resolves:\n${missing.join('\n')}`);
});

test('MiniMax H3 docs expose all Standard, Balanced, and Turbo workflows consistently', () => {
  const checkedFiles = ['SKILL.md', 'README.md', 'references/models.md', 'references/video-prompting.md'];
  for (const docFile of checkedFiles) {
    const text = read(docFile);
    assert.match(text, /minimax-h3-r2v/, `${docFile}: missing H3 r2v selector`);
    assert.match(text, /minimax-h3-balanced/, `${docFile}: missing generic H3 Balanced selector`);
    assert.match(text, /minimax-h3-i2v-balanced/, `${docFile}: missing H3 Balanced i2v selector`);
    assert.match(text, /minimax-h3-flf2v-balanced/, `${docFile}: missing H3 Balanced flf2v selector`);
    assert.match(text, /minimax-h3-r2v-balanced/, `${docFile}: missing H3 Balanced r2v selector`);
    assert.match(text, /8-step|8 steps|8 for Balanced/, `${docFile}: missing H3 Balanced step count`);
    assert.match(text, /Balanced[\s\S]{0,160}(?:Euler|euler)\/simple/, `${docFile}: missing H3 Balanced Euler\/simple recipe`);
    assert.match(text, /minimax-h3-turbo/, `${docFile}: missing generic H3 Turbo selector`);
    assert.match(text, /minimax-h3-i2v-turbo/, `${docFile}: missing H3 Turbo i2v selector`);
    assert.match(text, /minimax-h3-flf2v-turbo/, `${docFile}: missing H3 Turbo flf2v selector`);
    assert.match(text, /minimax-h3-r2v-turbo/, `${docFile}: missing H3 Turbo r2v selector`);
    assert.match(text, /4-step|4 steps/, `${docFile}: missing H3 Turbo step count`);
    assert.match(text, /FL2VA H3 Turbo defaults to `er_sde`/, `${docFile}: missing FL2VA Turbo ER-SDE default`);
    assert.match(text, /CLI omits (?:this field|the sampler) unless/, `${docFile}: missing Socket-owned default boundary`);
    assert.match(text, /euler/, `${docFile}: missing H3 Turbo Euler override`);
    assert.match(text, /er_sde/, `${docFile}: missing H3 Turbo ER-SDE override`);
    assert.match(text, /sa_solver/, `${docFile}: missing H3 Turbo SA-Solver sampler`);
    assert.match(text, /Ref2VA Turbo[\s\S]{0,120}(?:Euler|euler)/, `${docFile}: missing Ref2VA Turbo Euler recipe`);
    assert.doesNotMatch(text, /no CLI selector yet|has no `-m minimax-h3-r2v` selector/i,
      `${docFile}: stale claim that H3 r2v is unavailable in the CLI`);
  }
  const cliSource = read('sogni-agent.mjs');
  assert.match(
    cliSource,
    /H3 FL2VA Turbo sampler override[\s\S]{0,160}\(Socket default: er_sde; CLI omits unless set\)/,
    'sogni-agent --help must identify ER-SDE as the Socket-owned H3 Turbo default'
  );
  const skill = read('SKILL.md');
  const models = read('references/models.md');
  const prompting = read('references/video-prompting.md');
  for (const text of [skill, models, prompting]) {
    assert.match(text, /9 (?:reference )?images/);
    assert.match(text, /3 (?:reference )?videos/);
    assert.match(text, /3 (?:standalone |reference )?audio/);
    assert.match(text, /12 files/);
    assert.match(text, /<Picture 1>/);
    assert.match(text, /<Video 1>/);
    assert.match(text, /<Audio 1>/);
    assert.match(text, /at least one visual reference/i);
    assert.match(text, /audio(?:-only| alone)\s+(?:input\s+)?is invalid/i);
  }
});

test('music-locked video guidance forbids source-song substitution', () => {
  for (const docFile of ['SKILL.md', 'references/video-prompting.md', 'references/video-editing.md']) {
    const text = read(docFile);
    assert.match(text, /specific[\s\S]{0,100}trending/i, `${docFile}: missing specific/trending song rule`);
    assert.match(text, /audio reuse/, `${docFile}: missing H3 audio reuse task`);
    assert.match(text, /fully_copy/, `${docFile}: missing exact audio retention relationship`);
    assert.match(text, /stream-copy\/remux/, `${docFile}: missing exact final soundtrack operation`);
    assert.match(text, /never[\s\S]{0,100}(?:replace|substitut|recompos)/i,
      `${docFile}: missing prohibition on generated replacement music`);
    assert.match(text, /pose\/edit-controlled|pose\/edit controlled/i,
      `${docFile}: missing exact-choreography workflow boundary`);
  }
  assert.match(
    read('references/video-prompting.md'),
    /reference files themselves[\s\S]{0,180}normalize[\s\S]{0,180}time-distort/i,
  );
  assert.match(read('SKILL.md'), /Reference videos must themselves be exactly 24 fps/i);
});

test('prompt-only video authoring requires a registered native contract', () => {
  const skill = read('SKILL.md');
  const prompting = read('references/video-prompting.md');
  const generatedRuntime = read('generated/creative-agent-runtime.mjs');

  for (const text of [skill, prompting]) {
    assert.match(text, /any image or video model\/workflow|every video model and workflow/i);
    assert.match(text, /prompt text is the final deliverable|requested text is the final\s+deliverable/i);
    assert.match(text, /does not authorize\s+media generation|Do not invoke the CLI/i);
    assert.match(text, /no validated (?:native )?contract|has no validated (?:native )?contract/i);
    assert.match(text, /never substitute a generic prompt or another model's (?:format|syntax)/i);
    assert.match(text, /ordered-field (?:contract|document)/i);
    assert.match(text, /Do not invoke the CLI|without invoking\s+the CLI or hosted API/i);
    assert.match(text, /Markdown/);
    assert.match(text, /follow-up\s+question/);
  }
  assert.doesNotMatch(generatedRuntime, /model[- ]neutral prompts?/i);
  assert.match(generatedRuntime, /exact active destination model is absent/i);
});

test('prompt-only image authoring keeps model families and operations distinct', () => {
  const skill = read('SKILL.md');
  const prompting = read('references/image-prompting.md');
  const hermesPrompting = read('.agents/skills/sogni-creative-agent-skill/references/image-prompting.md');

  assert.equal(prompting, hermesPrompting, 'Hermes image-prompting reference drifted from the canonical guide');
  assert.match(skill, /image-prompting\.md/);
  assert.match(skill, /exact target|named model\/version/i);
  assert.match(skill, /never substitute a generic prompt or another model's format/i);
  assert.match(prompting, /never\s+substitute another destination model's prompt contract/i);
  for (const family of ['SD 1.5', 'SDXL', 'FLUX.1 Schnell', 'Chroma', 'Krea 2', 'Qwen Image 2512', 'Z-Image', 'GPT Image 2']) {
    assert.match(prompting, new RegExp(family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(prompting, /positive_prompt:[\s\S]*negative_prompt:/i);
  assert.match(prompting, /Turbo: prompt text only/i);
  assert.match(prompting, /generation-only selector[\s\S]*must not\s+silently accept an edit\s+request/i);
  assert.match(prompting, /typed model and operation metadata/i);
  for (const retired of ['flux1-dev-kontext', 'flux2', 'flux1-krea']) {
    assert.doesNotMatch(skill, new RegExp(retired, 'i'));
    assert.doesNotMatch(prompting, new RegExp(retired, 'i'));
  }
});

test('Seedance 2.5 docs keep the 2.0 grammar and publish only its capability overrides', () => {
  const models = read('references/models.md');
  const hosted = read('references/hosted-api.md');
  const hermesModels = read('.agents/skills/sogni-creative-agent-skill/references/models.md');
  const hermesHosted = read('.agents/skills/sogni-creative-agent-skill/references/hosted-api.md');

  assert.equal(models, hermesModels, 'Hermes model reference drifted from the canonical guide');
  assert.equal(hosted, hermesHosted, 'Hermes hosted reference drifted from the canonical guide');
  for (const text of [models, hosted]) {
    assert.match(text, /30 image\s*\/\s*10 video\s*\/\s*10 (?:standalone )?audio/i);
    assert.match(text, /50 (?:total|reference files total)/i);
  }
  assert.match(models, /4-30 s per clip/i);
  assert.match(models, /same `@Image1`[\s\S]*grammar[\s\S]*as Seedance 2\.0/i);
});

test('SKILL.md core stays lean (progressive disclosure guard)', () => {
  const lineCount = read('SKILL.md').split('\n').length;
  assert.ok(lineCount <= 500,
    `SKILL.md is ${lineCount} lines — keep the always-loaded core under 500 and move depth to references/`);
});
