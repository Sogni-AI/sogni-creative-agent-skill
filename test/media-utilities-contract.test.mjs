import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectConfig } from '@sogni-ai/sogni-intelligence-client';
import { imageUtilityConfig, speechConfig, PIXAL3D_MODEL_ID, PIXAL3D_MULTIVIEW_MODEL_ID, BIREFNET_MODEL_ID } from '../media-utilities.mjs';

const require = createRequire(import.meta.url);
const serialize = require('../node_modules/@sogni-ai/sogni-client/dist/Projects/createJobRequestMessage.js').default;
const source = Buffer.from('original input bytes');
const imageOptions = { type: 'image', sampler: { allowed: [], default: null }, scheduler: { allowed: [], default: null }, vae: { allowed: [], default: null } };
const audioOptions = { type: 'audio', sampler: { allowed: [], default: null }, scheduler: { allowed: [], default: null } };

function wire(config, type, options) {
  const project = { ...config, type };
  validateProjectConfig(project);
  return serialize('00000000-0000-4000-8000-000000000001', project, options).keyFrames[0];
}

test('pinned SDK accepts Pixal3D original-image config and transports every mesh option', () => {
  const meshSettings = { meshTargetFaces: 30000, textureSize: 2048, normalMapSize: 1024, ambientOcclusionSize: 512, shapeResolution: 1024 };
  const config = imageUtilityConfig({ model: PIXAL3D_MODEL_ID, imageTo3d: 'original.png', meshSettings }, source);
  const message = wire(config, 'image', imageOptions);
  assert.equal(message.hasStartingImage, true);
  assert.equal(message.modelID, PIXAL3D_MODEL_ID);
  assert.equal(message.positivePrompt, '');
  for (const [key, value] of Object.entries(meshSettings)) assert.equal(message[key], value, key);
});

test('pinned SDK slots Pixal3D multi-view orbit views by the subject\'s own sides', () => {
  const views = { leftViewImage: Buffer.from('left'), backViewImage: Buffer.from('back'), rightViewImage: Buffer.from('right') };
  const options = { model: PIXAL3D_MULTIVIEW_MODEL_ID, imageTo3d: 'front.png', meshSettings: { meshTargetFaces: 30000 } };
  const all = wire(imageUtilityConfig(options, source, views), 'image', imageOptions);
  assert.equal(all.modelID, PIXAL3D_MULTIVIEW_MODEL_ID);
  assert.equal(all.hasStartingImage, true);
  // Worker slots: left contextImage1, back contextImage2, right contextImage3.
  assert.deepEqual([all.hasContextImage1, all.hasContextImage2, all.hasContextImage3], [true, true, true]);
  assert.equal(all.meshTargetFaces, 30000);
  const rightOnly = wire(imageUtilityConfig(options, source, { rightViewImage: views.rightViewImage }), 'image', imageOptions);
  assert.deepEqual([rightOnly.hasContextImage1, rightOnly.hasContextImage2, rightOnly.hasContextImage3], [false, false, true]);
  assert.throws(
    () => wire(imageUtilityConfig({ ...options, model: PIXAL3D_MODEL_ID }, source, views), 'image', imageOptions),
    /pixal3d_int8_i23d reconstructs from startingImage alone/
  );
});

test('pinned SDK transports BiRefNet applyMask at the correct level', () => {
  for (const matte of [false, true]) {
    const config = imageUtilityConfig({ model: BIREFNET_MODEL_ID, matte }, source);
    const message = wire(config, 'image', imageOptions);
    assert.equal(message.hasStartingImage, true);
    assert.equal(message.applyMask, !matte);
    assert.equal(message.sam3Prompt, undefined);
  }
});

test('pinned SDK transports Qwen speech scripts, speakers, directions, and clone audio', () => {
  for (const mode of ['voice', 'clone', 'design']) {
    const model = `qwen3_tts_1.7b_${mode === 'voice' ? 'custom_voice' : `voice_${mode}`}_bf16`;
    const config = speechConfig({ model, prompt: 'Speak exactly these words.', count: 1,
      musicLanguage: 'auto', outputFormat: 'wav', seed: null, speechCreativity: 0.9,
      speechVoice: mode === 'voice' ? 'ryan' : null,
      voiceDescription: mode === 'design' ? 'Warm, deep narrator' : null,
      voiceTranscript: mode === 'clone' ? 'Known words.' : null
    }, mode === 'clone' ? source : undefined);
    const message = wire(config, 'audio', audioOptions);
    assert.equal(message.positivePrompt, 'Speak exactly these words.');
    assert.equal(message.speaker, mode === 'voice' ? 'ryan' : undefined);
    assert.equal(message.instruct, mode === 'design' ? 'Warm, deep narrator' : undefined);
    assert.equal(message.referenceText, mode === 'clone' ? 'Known words.' : undefined);
    assert.equal(message.hasReferenceAudio, mode === 'clone' ? true : undefined);
    assert.equal(message.creativity, 0.9);
  }
});
