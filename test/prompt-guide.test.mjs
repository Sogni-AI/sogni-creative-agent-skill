import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MODEL_PROMPT_GUIDES,
  getModelPromptGuide,
  renderModelPromptGuide,
} from '@sogni-ai/sogni-intelligence-client/prompt-guides';

const CLI_PATH = join(process.cwd(), 'sogni-agent.mjs');
const LOADER_PATH = join(process.cwd(), 'test', 'loader.mjs');

// No API key and an empty HOME: prompt-guide must need no credentials. The
// stubbed SDK records a state file whenever a client is used, so its absence
// shows the command never reached the SDK.
function runPromptGuide(args) {
  const home = mkdtempSync(join(tmpdir(), 'sogni-prompt-guide-'));
  const statePath = join(home, 'state.json');
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    OPENCLAW_CONFIG_PATH: join(home, 'openclaw.json'),
    OPENCLAW_PLUGIN_CONFIG: '',
    SOGNI_AGENT_TEST_STATE_PATH: statePath,
    NODE_NO_WARNINGS: '1',
  };
  delete env.SOGNI_API_KEY;
  const result = spawnSync(process.execPath, ['--loader', LOADER_PATH, CLI_PATH, 'prompt-guide', ...args], {
    env,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr, usedSdk: existsSync(statePath) };
}

const agentText = (guide) => renderModelPromptGuide(guide, { audience: 'agent' });

test('prompt-guide prints the agent rendering of a known model, offline and without credentials', () => {
  const { exitCode, stdout, stderr, usedSdk } = runPromptGuide(['seedance2-5']);
  assert.equal(exitCode, 0, stderr);
  assert.equal(usedSdk, false);
  const guide = MODEL_PROMPT_GUIDES['seedance-2.5'].t2v;
  assert.equal(
    stdout,
    `${agentText(guide)}\n\n`
      + '-m seedance2-5 resolves to seedance-2-5 in this mode.\n'
      + 'Other modes: i2v, l2v, flf, v2v. Print one with: sogni-agent prompt-guide seedance2-5 --mode <mode>\n',
  );
});

test('prompt-guide resolves -m aliases the way the CLI does, by model id', () => {
  // Selectors only the CLI's own alias layer knows.
  for (const [model, family, mode] of [
    ['happyhorse', 'happyhorse-1.1', 't2v'],
    ['minimax-h3-balanced', 'minimax-h3', 't2v'],
    ['sunburst', 'gpt-image', 'generate'],
    ['seedream-uncensored', 'seedream', 'generate'],
  ]) {
    assert.equal(getModelPromptGuide(model), null, `${model} should need the CLI alias layer`);
    const { exitCode, stdout, stderr } = runPromptGuide([model, '--json']);
    assert.equal(exitCode, 0, stderr);
    const payload = JSON.parse(stdout);
    assert.equal(payload.family, family, model);
    assert.equal(payload.mode, mode, model);
    assert.deepEqual(payload.guide, MODEL_PROMPT_GUIDES[family][mode]);
  }
  // With a workflow, -m wan22 renders text-to-video on LTX 2.5, so that is its guide;
  // its speech-to-video mode stays on WAN 2.2.
  const wan22 = JSON.parse(runPromptGuide(['wan22', '--json']).stdout);
  assert.equal(wan22.resolvedModel, 'ltx25-22b-int8_t2v_distilled');
  assert.equal(wan22.family, 'ltx-2.5');
  const wan22Speech = JSON.parse(runPromptGuide(['wan22', '--mode', 's2v', '--json']).stdout);
  assert.equal(wan22Speech.family, 'wan-2.2');
  assert.equal(wan22Speech.mode, 's2v');
  // -m works as well as the positional model.
  assert.equal(JSON.parse(runPromptGuide(['-m', 'ltx25-i2v', '--json']).stdout).mode, 'i2v');
});

test('prompt-guide --mode picks the mode and accepts flf2v for flf', () => {
  const i2v = runPromptGuide(['seedance2-5', '--mode', 'i2v']);
  assert.equal(i2v.exitCode, 0, i2v.stderr);
  assert.ok(i2v.stdout.startsWith(`${agentText(MODEL_PROMPT_GUIDES['seedance-2.5'].i2v)}\n\n`));
  assert.match(i2v.stdout, /^Other modes: t2v, l2v, flf, v2v\./m);

  const flf = JSON.parse(runPromptGuide(['minimax-h3', '--mode', 'flf2v', '--json']).stdout);
  assert.equal(flf.mode, 'flf');
  assert.deepEqual(flf.guide, MODEL_PROMPT_GUIDES['minimax-h3'].flf);
});

test('prompt-guide --json returns the guide object, the resolved id and the modes', () => {
  const { exitCode, stdout, stderr } = runPromptGuide(['krea2_identity_edit_v1_2', '--json']);
  assert.equal(exitCode, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), {
    success: true,
    type: 'prompt-guide',
    model: 'krea2_identity_edit_v1_2',
    resolvedModel: 'krea2_identity_edit_v1_2',
    family: 'krea2',
    mode: 'edit',
    modes: ['edit'],
    guide: JSON.parse(JSON.stringify(MODEL_PROMPT_GUIDES.krea2.edit)),
  });
});

test('prompt-guide with no model lists every family, mode and model id', () => {
  const expected = Object.entries(MODEL_PROMPT_GUIDES).map(([family, modes]) => ({
    family,
    modes: Object.keys(modes),
    models: [...new Set(Object.values(modes).flatMap((guide) => guide.models))],
  }));
  const json = runPromptGuide(['--json']);
  assert.equal(json.exitCode, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).families, expected);

  const text = runPromptGuide([]);
  assert.equal(text.exitCode, 0, text.stderr);
  assert.match(text.stdout, /^Usage: sogni-agent prompt-guide <model> \[--mode <mode>\] \[--json\]/);
  for (const { family, modes } of expected) {
    assert.ok(text.stdout.includes(`${family}\n  modes:  ${modes.join(', ')}\n`), family);
  }
});

test('prompt-guide fails on an unknown model with the list', () => {
  const text = runPromptGuide(['not-a-model']);
  assert.equal(text.exitCode, 1);
  assert.equal(text.stdout, '');
  assert.match(text.stderr, /^Usage: sogni-agent prompt-guide/);
  assert.match(text.stderr, /\nseedance-2\.5\n  modes:  t2v, i2v, l2v, flf, v2v\n/);
  assert.match(text.stderr, /Error: No prompt guide for model "not-a-model"\./);

  const json = runPromptGuide(['not-a-model', '--json']);
  assert.equal(json.exitCode, 1);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.success, false);
  assert.equal(payload.errorCode, 'INVALID_ARGUMENT');
  assert.equal(payload.errorDetails.families.length, Object.keys(MODEL_PROMPT_GUIDES).length);
});

test('prompt-guide fails on a mode the model has with that model\'s modes', () => {
  const video = runPromptGuide(['seedance2-5', '--mode', 'edit']);
  assert.equal(video.exitCode, 1);
  assert.match(video.stderr, /No "edit" prompt guide for seedance2-5\. Its modes: t2v, i2v, l2v, flf, v2v\./);

  // Image selectors carry their own operations: Krea Identity Edit only edits.
  const image = JSON.parse(runPromptGuide(['krea2_identity_edit_v1_2', '--mode', 'generate', '--json']).stdout);
  assert.equal(image.success, false);
  assert.deepEqual(image.errorDetails.modes, ['edit']);

  const noModel = runPromptGuide(['--mode', 't2v']);
  assert.equal(noModel.exitCode, 1);
  assert.match(noModel.stderr, /prompt-guide --mode needs a model\./);
});
