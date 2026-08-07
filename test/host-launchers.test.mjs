import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('published host launchers set fixed framework and surface markers', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const expected = {
    'sogni-agent-codex': ['host-launchers/codex.mjs', 'codex', 'plugin'],
    'sogni-agent-claude-code': ['host-launchers/claude-code.mjs', 'claude-code', 'plugin'],
    'sogni-agent-hermes': ['host-launchers/hermes.mjs', 'hermes-agent', 'personal_skill'],
  };
  for (const [command, [path, framework, surface]] of Object.entries(expected)) {
    assert.equal(pkg.bin[command], path);
    assert.ok(pkg.files.includes('host-launchers/'));
    const source = readFileSync(join(ROOT, path), 'utf8');
    assert.match(source, new RegExp(`SOGNI_AGENT_FRAMEWORK = '${framework}'`));
    assert.match(source, new RegExp(`SOGNI_AGENT_SURFACE = '${surface}'`));
    assert.match(source, /import\('\.\.\/sogni-agent\.mjs'\)/);
  }
});

test('Claude and Codex plugin skills select their fixed launchers', () => {
  const claude = readFileSync(
    join(ROOT, 'plugin-skills/sogni-creative-agent/SKILL.md'),
    'utf8',
  );
  const codex = readFileSync(join(ROOT, 'skills/sogni-creative-agent/SKILL.md'), 'utf8');
  const claudeLoop = readFileSync(join(ROOT, 'plugin-skills/loop-maker/SKILL.md'), 'utf8');
  const codexLoop = readFileSync(join(ROOT, 'skills/loop-maker/SKILL.md'), 'utf8');
  assert.match(claude, /sogni-agent-claude-code/);
  assert.match(claudeLoop, /sogni-agent-claude-code/);
  assert.match(codex, /sogni-agent-codex/);
  assert.match(codexLoop, /sogni-agent-codex/);
});

test('root SKILL.md points plain installs at their host launcher', () => {
  // The Codex and Claude Code plugin surfaces pin their own launcher, but the
  // root SKILL.md is what a Hermes (or other plain) install receives, so it has
  // to name every launcher itself or those hosts fall back to bare
  // `sogni-agent` and report agentFramework "unknown".
  const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const command of Object.keys(pkg.bin)) {
    if (command === 'sogni-agent') continue;
    assert.match(
      skill,
      new RegExp(`\`${command}\``),
      `root SKILL.md does not document the ${command} launcher`,
    );
  }
});
