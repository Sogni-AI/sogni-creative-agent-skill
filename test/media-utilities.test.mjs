import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareMediaUtilityOptions,
  speechConfig,
  transcriptionConfig,
  formatTranscriptResult,
  utilityResultMetadata,
} from '../media-utilities.mjs';

function makeOptions(overrides = {}) {
  return {
    prompt: null,
    output: null,
    model: null,
    count: 1,
    tokenType: null,
    outputFormat: null,
    seed: null,
    lastSeed: false,
    noFilter: false,
    speech: false,
    speechMode: null,
    speechVoice: null,
    voiceDescription: null,
    voiceReference: null,
    voiceTranscript: null,
    speechCreativity: null,
    transcribe: null,
    transcribeModel: null,
    transcribeEngine: null,
    timestamps: null,
    diarize: false,
    hotwords: null,
    imageTo3d: null,
    pixal3dViews: {},
    removeBackground: null,
    matte: false,
    meshSettings: {},
    music: false,
    musicLanguage: null,
    video: false,
    segmentImage: null,
    segmentVideo: null,
    upscaleImage: null,
    upscaleVideo: null,
    apiChat: false,
    apiWorkflowAction: null,
    contextImages: [],
    loras: [],
    multiAngle: false,
    photobooth: false,
    looping: false,
    personaName: null,
    referenceAudioIdentity: null,
    voicePersonaName: null,
    ...overrides,
  };
}

test('prepareMediaUtilityOptions supports Fish Drama 3 via --speech-mode drama3, -m drama3, and -m fish_drama_3_nvfp4', () => {
  for (const [overrides, explicit] of [
    [{ speech: true, speechMode: 'drama3', prompt: '[sighs] Hello there.' }, {}],
    [{ model: 'drama3', prompt: '[laughs] Good to see you.' }, { model: true }],
    [{ model: 'fish_drama_3_nvfp4', prompt: '<whisper>Stay quiet.</whisper>' }, { model: true }],
    [{ speech: true, speechMode: 'DRAMA3', model: 'drama3', prompt: '[sighs] Case-insensitive agreement.' }, { model: true }],
    [{ speechMode: 'Drama3', model: 'FISH_DRAMA_3_NVFP4', prompt: '[warmly] Uppercase model ID.' }, { model: true }],
  ]) {
    const options = makeOptions(overrides);
    prepareMediaUtilityOptions(options, explicit);
    assert.equal(options.speech, true);
    assert.equal(options.speechMode, 'drama3');
    assert.equal(options.model, 'fish_drama_3_nvfp4');
    assert.equal(options.outputFormat, 'wav');
  }

  assert.throws(
    () => prepareMediaUtilityOptions(makeOptions({ speech: true, speechMode: 'VOICE', model: 'drama3', prompt: 'Conflict' }), { model: true }),
    /--speech-mode conflicts with --model/,
  );

  const drama5000 = makeOptions({ speech: true, speechMode: 'drama3', prompt: 'a'.repeat(5000) });
  assert.doesNotThrow(() => prepareMediaUtilityOptions(drama5000, {}));
  assert.throws(
    () => prepareMediaUtilityOptions(makeOptions({ speech: true, speechMode: 'drama3', prompt: 'a'.repeat(5001) }), {}),
    /5000 characters/,
  );
  assert.throws(
    () => prepareMediaUtilityOptions(makeOptions({ speech: true, speechMode: 'voice', prompt: 'a'.repeat(4097) }), {}),
    /4096 characters/,
  );
});

test('Fish Drama 3 omits creativity and accepts up to 2000-character voice transcripts with reference audio', () => {
  const longTranscript = 'a'.repeat(1800);
  const options = makeOptions({
    speech: true,
    speechMode: 'drama3',
    prompt: '[warmly] Welcome home.',
    voiceReference: '/tmp/ref.wav',
    voiceTranscript: longTranscript,
    speechCreativity: 1.2,
  });
  prepareMediaUtilityOptions(options, {});
  assert.equal(options.speechCreativity, null);
  const config = speechConfig(options, Buffer.from('wav'));
  assert.equal(config.modelId, 'fish_drama_3_nvfp4');
  assert.equal('creativity' in config, false);
  assert.equal(config.referenceText, longTranscript);
  const meta = utilityResultMetadata(options);
  assert.equal('creativity' in meta, false);
  assert.equal(meta.speechMode, 'drama3');

  assert.throws(
    () => prepareMediaUtilityOptions(makeOptions({
      speech: true,
      speechMode: 'drama3',
      prompt: 'Hello',
      voiceReference: '/tmp/ref.wav',
      voiceTranscript: 'a'.repeat(2001),
    }), {}),
    /2000 characters/,
  );
});

test('prepareMediaUtilityOptions allows --voice-reference with --api-chat while rejecting standalone speech flags', () => {
  const apiOptions = makeOptions({ apiChat: true, voiceReference: '/tmp/voice.wav', prompt: 'Have her say hello' });
  assert.doesNotThrow(() => prepareMediaUtilityOptions(apiOptions, {}));
  assert.equal(apiOptions.speech, false);

  assert.throws(
    () => prepareMediaUtilityOptions(makeOptions({ voiceReference: '/tmp/voice.wav', prompt: 'Hello' }), {}),
    /Speech controls require --speech/,
  );
});

test('prepareMediaUtilityOptions resolves transcription engine and auto-selects nemotron for diarize/hotwords/prompt', () => {
  const defaultOpts = makeOptions({ transcribe: '/tmp/clip.wav' });
  prepareMediaUtilityOptions(defaultOpts, { transcribe: true });
  assert.equal(defaultOpts.transcribeEngine, 'parakeet');
  assert.equal(defaultOpts.model, 'parakeet_tdt_0.6b_v3_bf16');
  assert.equal(defaultOpts.timestamps, 'sentence');
  assert.equal(defaultOpts.outputFormat, 'txt');

  for (const extra of [
    { diarize: true },
    { hotwords: 'Sogni, Spark' },
    { prompt: 'Podcast interview' },
  ]) {
    const autoNemotron = makeOptions({ transcribe: '/tmp/clip.wav', ...extra });
    prepareMediaUtilityOptions(autoNemotron, { transcribe: true });
    assert.equal(autoNemotron.transcribeEngine, 'nemotron');
    assert.equal(autoNemotron.model, 'nemotron_3.5_transcribe_30b_a4b_nvfp4');
  }

  const srtFromPath = makeOptions({ transcribe: '/tmp/clip.wav', output: '/tmp/captions.srt' });
  prepareMediaUtilityOptions(srtFromPath, { transcribe: true, output: true });
  assert.equal(srtFromPath.outputFormat, 'srt');

  assert.throws(
    () => prepareMediaUtilityOptions(makeOptions({ transcribe: '/tmp/clip.wav', transcribeModel: 'parakeet', diarize: true }), { transcribe: true, transcribeModel: true }),
    /does not support speaker diarization/,
  );
  assert.throws(
    () => prepareMediaUtilityOptions(makeOptions({ model: 'parakeet_tdt_0.6b_v3_bf16' }), { model: true }),
    /require --transcribe/,
  );
});

test('transcriptionConfig and formatTranscriptResult build canonical audio jobs and txt/json/srt/vtt outputs', () => {
  const options = makeOptions({
    transcribe: '/tmp/clip.wav',
    transcribeEngine: 'nemotron',
    model: 'nemotron_3.5_transcribe_30b_a4b_nvfp4',
    timestamps: 'word',
    diarize: true,
    hotwords: 'Sogni, Supernet',
    prompt: 'Keynote Q&A',
  });
  const audioBytes = Buffer.from('audio-bytes');
  const config = transcriptionConfig(options, audioBytes, 12.5);
  assert.deepEqual(config, {
    type: 'audio',
    modelId: 'nemotron_3.5_transcribe_30b_a4b_nvfp4',
    positivePrompt: 'Keynote Q&A',
    referenceAudio: audioBytes,
    duration: 12.5,
    numberOfMedia: 1,
    tokenType: 'spark',
    waitForCompletion: false,
    disableNSFWFilter: false,
    timestamps: 'word',
    diarize: true,
    hotwords: 'Sogni, Supernet',
    outputFormat: 'json',
  });

  const rawArtifact = {
    duration: 3.4,
    language: 'en',
    diarized: true,
    segments: [
      { id: 0, start: 0, end: 1.5, text: 'Hello Sogni.', speaker: 'S01' },
      { id: 1, start: 1.6, end: 3.4, text: 'Welcome aboard.', speaker: 'S02' },
    ],
  };
  assert.equal(
    formatTranscriptResult(rawArtifact, 'txt').formatted,
    '[S01] Hello Sogni.\n[S02] Welcome aboard.',
  );
  assert.match(formatTranscriptResult(rawArtifact, 'srt').formatted, /1\n00:00:00,000 --> 00:00:01,500\n\[S01\] Hello Sogni\./);
  assert.match(formatTranscriptResult(rawArtifact, 'vtt').formatted, /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.500\n<v S01>Hello Sogni\./);
  assert.equal(JSON.parse(formatTranscriptResult(rawArtifact, 'json', options.model).formatted).model, 'nemotron_3.5_transcribe_30b_a4b_nvfp4');
});
