import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import {
  resolveAgentPath, resolveFfmpegPath, buildChildEnv,
} from '../desktop-extension/server/resolve.mjs';

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'sogni-desktop-'));
}

test('resolveAgentPath honours SOGNI_AGENT_PATH when the file exists', () => {
  const home = tempHome();
  const agent = join(home, 'sogni-agent.mjs');
  writeFileSync(agent, '// stub');
  assert.equal(resolveAgentPath({ env: { SOGNI_AGENT_PATH: agent }, home }), agent);
});

test('resolveAgentPath returns null for a dangling SOGNI_AGENT_PATH', () => {
  const home = tempHome();
  assert.equal(resolveAgentPath({ env: { SOGNI_AGENT_PATH: join(home, 'missing.mjs') }, home }), null);
});

test('resolveAgentPath probes ~/.npm-global and nvm layouts', () => {
  const home = tempHome();
  const rel = join('lib', 'node_modules', '@sogni-ai', 'sogni-creative-agent-skill');
  const npmGlobal = join(home, '.npm-global', rel);
  mkdirSync(npmGlobal, { recursive: true });
  writeFileSync(join(npmGlobal, 'sogni-agent.mjs'), '// stub');
  assert.equal(resolveAgentPath({ env: {}, home, roots: [] }), join(npmGlobal, 'sogni-agent.mjs'));

  const home2 = tempHome();
  const nvm = join(home2, '.nvm', 'versions', 'node', 'v22.11.0', rel);
  mkdirSync(nvm, { recursive: true });
  writeFileSync(join(nvm, 'sogni-agent.mjs'), '// stub');
  assert.equal(resolveAgentPath({ env: {}, home: home2, roots: [] }), join(nvm, 'sogni-agent.mjs'));
});

test('resolveAgentPath returns null when nothing is installed', () => {
  assert.equal(resolveAgentPath({ env: {}, home: tempHome(), roots: [] }), null);
});

test('buildChildEnv prepends bin dirs, sets FFMPEG_PATH, drops empty SOGNI_API_KEY', () => {
  const env = buildChildEnv({
    env: { PATH: '/usr/bin', SOGNI_API_KEY: '' },
    agentPath: '/g/node_modules/@sogni-ai/sogni-creative-agent-skill/sogni-agent.mjs',
    ffmpegPath: '/opt/homebrew/bin/ffmpeg',
  });
  const parts = env.PATH.split(delimiter);
  assert.ok(parts.includes('/opt/homebrew/bin'));
  assert.ok(parts.includes('/usr/local/bin'));
  assert.ok(parts.includes('/usr/bin'));
  assert.equal(env.FFMPEG_PATH, '/opt/homebrew/bin/ffmpeg');
  assert.equal('SOGNI_API_KEY' in env, false);
});

test('buildChildEnv keeps a non-empty SOGNI_API_KEY', () => {
  const env = buildChildEnv({ env: { PATH: '/usr/bin', SOGNI_API_KEY: 'sk-1' }, agentPath: '/x/sogni-agent.mjs' });
  assert.equal(env.SOGNI_API_KEY, 'sk-1');
});
