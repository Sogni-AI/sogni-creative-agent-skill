import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('loop-maker plugin skill routes to the canonical workflow', () => {
  const skill = read('plugin-skills/loop-maker/SKILL.md');
  assert.match(skill, /^---\n[\s\S]*description:/);
  assert.match(skill, /\/sogni-creative-agent:loop-maker IMAGE_FOLDER/);
  assert.match(skill, /\$sogni-creative-agent:loop-maker/);
  assert.doesNotMatch(skill, /CLAUDE_PLUGIN_ROOT/);
  assert.match(skill, /references\/loop-maker\.md/);
  assert.doesNotMatch(skill, /motion=orbit/);
  assert.match(skill, /Do not route true 360 novel-view synthesis here/);
  assert.match(skill, /Do not use HyperFrames or Remotion unless/);
});

test('loop-maker workflow pins direct LTX first/last-frame rendering and verification', () => {
  const workflow = read('references/loop-maker.md');
  assert.match(workflow, /ltx25-22b-int8_i2v_distilled/);
  assert.match(workflow, /--ref .*--ref-end|--ref-end/s);
  assert.match(workflow, /--no-auto-resize-assets/);
  assert.match(workflow, /--first-frame-strength 1 --last-frame-strength 1/);
  assert.match(workflow, /one-clip-per-pair/i);
  assert.match(workflow, /--extract-first-frame/);
  assert.match(workflow, /--extract-frame-at/);
  assert.match(workflow, /--extract-last-frame/);
  assert.match(workflow, /--verify-video/);
  assert.match(workflow, /--remix-audio/);
});

test('loop-maker rejects unverified single-image orbit claims and stays compositor-free by default', () => {
  const workflow = read('references/loop-maker.md');
  assert.match(workflow, /Do not advertise or label a direct single-image LTX transition as a 360 orbit/);
  assert.match(workflow, /fixed-camera pose changes, hat and sheet wipes, and ordinary morphs/);
  assert.match(workflow, /front, quarter, side, rear, opposite-side, and return viewpoints/);
  assert.match(workflow, /background parallax/);
  assert.match(workflow, /Never count a turning subject, changing pose, zoom, crop, wipe, or morph as a camera orbit/);
  assert.doesNotMatch(read('README.md'), /motion=orbit/);
  assert.match(workflow, /Do not initialize or depend on HyperFrames or Remotion/);
  assert.match(workflow, /use it only when the user explicitly asks for timed text, titles, overlays, or effects/);
});

test('loop-maker plugin files are included in npm packaging metadata', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.files.includes('.claude-plugin/'));
  assert.ok(pkg.files.includes('.codex-plugin/'));
  assert.ok(pkg.files.includes('plugin-skills/'));

  const claudeManifest = JSON.parse(read('.claude-plugin/plugin.json'));
  const codexManifest = JSON.parse(read('.codex-plugin/plugin.json'));
  assert.equal(claudeManifest.skills, './plugin-skills');
  assert.equal(codexManifest.skills, './skills');
  assert.equal(codexManifest.name, claudeManifest.name);
  assert.match(read('skills/loop-maker/SKILL.md'), /plugin-skills\/loop-maker\/SKILL\.md/);
  assert.match(read('skills/loop-maker/agents/openai.yaml'), /\$loop-maker/);
});
