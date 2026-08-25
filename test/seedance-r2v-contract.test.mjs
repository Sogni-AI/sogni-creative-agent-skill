import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const clientPackage = require('@sogni-ai/sogni-client/package.json');
const createJobRequestMessage = require(
  '../node_modules/@sogni-ai/sogni-client/dist/Projects/createJobRequestMessage.js'
).default;

const VIDEO_OPTIONS = {
  type: 'video',
  width: { min: 480, max: 1470, step: 8, default: 1280 },
  height: { min: 432, max: 1280, step: 8, default: 720 },
  sampler: { allowed: [], default: null },
  scheduler: { allowed: [], default: null }
};

function urls(kind, count, extension) {
  return Array.from(
    { length: count },
    (_, index) => `https://cdn.example.com/${kind}-${index + 1}.${extension}`
  );
}

function request(overrides) {
  return createJobRequestMessage(
    '00000000-0000-4000-8000-000000000001',
    {
      type: 'video',
      modelId: 'seedance-2-5',
      positivePrompt: 'Use the numbered media references.',
      numberOfMedia: 1,
      duration: 5,
      width: 1280,
      height: 720,
      ...overrides
    },
    VIDEO_OPTIONS
  );
}

test('pinned SDK transports every Seedance 2.5 R2V task and the 50-file budget', () => {
  assert.equal(clientPackage.version, '5.19.0');

  for (const seedanceTaskType of ['reference', 'edit', 'extend']) {
    const message = request({
      seedanceTaskType,
      ...(seedanceTaskType === 'reference'
        ? { referenceAudioUrls: ['https://cdn.example.com/voice.mp3'] }
        : { referenceVideoUrls: ['https://cdn.example.com/source.mp4'] })
    });
    assert.equal(message.keyFrames[0].seedanceTaskType, seedanceTaskType);
  }

  const maximum = request({
    seedanceTaskType: 'reference',
    referenceImageUrls: urls('image', 30, 'jpg'),
    referenceVideoUrls: urls('video', 10, 'mp4'),
    referenceAudioUrls: urls('audio', 10, 'mp3')
  });
  assert.equal(maximum.keyFrames[0].referenceImageURLs.length, 30);
  assert.equal(maximum.keyFrames[0].referenceVideoURLs.length, 10);
  assert.equal(maximum.keyFrames[0].referenceAudioURLs.length, 10);
});

test('pinned SDK keeps frame mode separate from typed R2V operations', () => {
  const frame = request({ referenceImage: new Blob(['frame'], { type: 'image/png' }) });
  assert.equal(frame.keyFrames[0].seedanceTaskType, undefined);
  assert.throws(
    () =>
      request({
        referenceImage: new Blob(['frame'], { type: 'image/png' }),
        seedanceTaskType: 'reference'
      }),
    /omit it for first\/last-frame generation/
  );
});
