import {
  SpeechModel, getSpeechMode, validateSpeechRequest, DEFAULT_SPEECH_VOICE,
  SPEECH_CREATIVITY, SPEECH_REFERENCE_SECONDS, MUSIC_MODELS, MusicModel
} from '@sogni-ai/sogni-intelligence-client/media';

export const PIXAL3D_MODEL_ID = 'pixal3d_int8_i23d';
export const BIREFNET_MODEL_ID = 'birefnet_image_background_removal_fp16';
export const MUSIC3_MODEL_ID = MusicModel.best;
export const MUSIC3_DEFAULTS = MUSIC_MODELS.best;
export { SPEECH_REFERENCE_SECONDS };

export const SPEECH_VALUE_FLAGS = {
  '--speech-mode': 'speechMode', '--speech-voice': 'speechVoice', '--voice-description': 'voiceDescription',
  '--voice-reference': 'voiceReference', '--voice-transcript': 'voiceTranscript'
};

export const MESH_FLAGS = {
  '--mesh-faces': ['meshTargetFaces', 5000, 700000],
  '--texture-size': ['textureSize', 1024, 4096],
  '--normal-map-size': ['normalMapSize', 512, 2048],
  '--ao-map-size': ['ambientOcclusionSize', 256, 1024],
  '--shape-resolution': ['shapeResolution', 1024, 1536]
};

// Validate explicit controls before image/video inference can reinterpret them.
export function prepareMediaUtilityOptions(options, explicit) {
  const fail = message => { throw new Error(message); };
  const selectedSpeechMode = getSpeechMode(options.model);
  if (selectedSpeechMode) {
    if (options.speechMode && options.speechMode !== selectedSpeechMode) fail('--speech-mode conflicts with --model.');
    options.speech = true;
    options.speechMode = selectedSpeechMode;
  }
  if (options.model === PIXAL3D_MODEL_ID && !options.imageTo3d) fail('Pixal3D requires --image-to-3d <original-image>.');
  if (options.model === BIREFNET_MODEL_ID && !options.removeBackground) fail('BiRefNet requires --remove-background <original-image>.');
  if (Object.keys(options.meshSettings).length && !options.imageTo3d) fail('Mesh settings require --image-to-3d.');
  if (options.matte && !options.removeBackground) fail('--matte requires --remove-background.');
  if (!options.speech && (options.speechMode || options.speechVoice || options.voiceDescription || options.voiceReference || options.voiceTranscript || options.speechCreativity !== null)) {
    fail('Speech controls require --speech.');
  }
  const active = options.speech || options.imageTo3d || options.removeBackground;
  if (!active) return;
  if ([options.speech, options.imageTo3d, options.removeBackground, options.music, options.video,
    options.segmentImage, options.upscaleImage, options.upscaleVideo, options.apiChat, options.apiWorkflowAction].filter(Boolean).length !== 1) {
    fail('Choose one generation mode: speech, image-to-3d, remove-background, music, video, segmentation, or upscale.');
  }
  const unsupported = ['quality', 'width', 'height', 'strictSize', 'duration', 'fps', 'frames', 'steps', 'guidance',
    'sampler', 'scheduler', 'context', 'refImage', 'refImageEnd', 'refAudio', 'refVideo', 'targetResolution',
    'musicLyrics', 'musicBpm', 'musicKeyscale', 'musicTimesig', 'musicComposerMode', 'musicPromptStrength',
    'musicCreativity', 'musicShift', 'returnLastFrame'];
  if (unsupported.some(key => explicit[key]) || options.contextImages.length || options.loras.length ||
    options.multiAngle || options.photobooth || options.looping || options.personaName || options.referenceAudioIdentity || options.voicePersonaName) {
    fail('This mode does not accept image/video references, sizing, diffusion, or music controls. Use its dedicated input flags.');
  }
  if (options.speech) {
    options.speechMode ||= 'voice';
    const model = SpeechModel[options.speechMode];
    if (!model) fail('Speech mode must be voice, clone, or design.');
    if (explicit.model && options.model !== model) fail('--model conflicts with the selected speech mode.');
    options.model = model;
    options.musicLanguage = (options.musicLanguage || 'auto').toLowerCase();
    const error = validateSpeechRequest({ mode: options.speechMode, script: options.prompt,
      language: options.musicLanguage, voice: options.speechVoice || undefined,
      instruct: options.voiceDescription || undefined, referenceText: options.voiceTranscript || undefined,
      hasReferenceAudio: Boolean(options.voiceReference) });
    if (error) fail(error);
    if (options.speechMode === 'voice') options.speechVoice ||= DEFAULT_SPEECH_VOICE;
    if (options.speechCreativity !== null && (!Number.isFinite(options.speechCreativity) ||
      options.speechCreativity < SPEECH_CREATIVITY.min || options.speechCreativity > SPEECH_CREATIVITY.max)) {
      fail(`--speech-creativity must be between ${SPEECH_CREATIVITY.min} and ${SPEECH_CREATIVITY.max}.`);
    }
    options.outputFormat = (options.outputFormat || 'wav').toLowerCase();
  } else {
    if (options.prompt) fail('Pixal3D and BiRefNet are promptless; supply only the original image.');
    if (options.count !== 1) fail('Image utilities accept one image and produce one result; --count must be 1.');
    if (explicit.musicLanguage || explicit.seed || options.lastSeed) fail('Image utilities do not accept language or seed controls.');
    const model = options.imageTo3d ? PIXAL3D_MODEL_ID : BIREFNET_MODEL_ID;
    if (explicit.model && options.model !== model) fail('--model conflicts with the selected image utility.');
    options.model = model;
    const format = options.imageTo3d ? 'glb' : 'png';
    if (options.outputFormat && options.outputFormat.toLowerCase() !== format) fail(`This mode produces ${format.toUpperCase()} only.`);
    options.outputFormat = format;
    if (options.imageTo3d && options.meshSettings.shapeResolution !== undefined && ![1024, 1536].includes(options.meshSettings.shapeResolution)) {
      fail('--shape-resolution must be 1024 or 1536.');
    }
  }
  if (options.output) {
    const extension = options.output.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase();
    if (extension && extension !== options.outputFormat) fail(`Output filename must use .${options.outputFormat}, matching --output-format.`);
  }
}

export function imageUtilityConfig(options, bytes) {
  return {
    modelId: options.model, positivePrompt: '', startingImage: bytes,
    numberOfMedia: 1, tokenType: options.tokenType || 'spark', waitForCompletion: false,
    ...(options.imageTo3d ? { ...options.meshSettings } : { applyMask: !options.matte, outputFormat: 'png' })
  };
}

export function speechConfig(options, referenceAudio) {
  return {
    modelId: options.model, positivePrompt: options.prompt, numberOfMedia: options.count,
    tokenType: options.tokenType || 'spark', waitForCompletion: false,
    language: options.musicLanguage, outputFormat: options.outputFormat,
    ...(options.speechVoice ? { speaker: options.speechVoice } : {}),
    ...(options.voiceDescription ? { instruct: options.voiceDescription } : {}),
    ...(referenceAudio ? { referenceAudio } : {}),
    ...(options.voiceTranscript ? { referenceText: options.voiceTranscript } : {}),
    ...(options.speechCreativity !== null ? { creativity: options.speechCreativity } : {}),
    ...(options.seed !== null ? { seed: options.seed } : {})
  };
}

export function utilityResultMetadata(options) {
  if (options.speech) return { speechMode: options.speechMode, speaker: options.speechVoice,
    language: options.musicLanguage,
    ...(options.voiceDescription ? { voiceDescription: options.voiceDescription } : {}),
    ...(options.voiceReference ? { voiceReference: options.voiceReference } : {}),
    ...(options.voiceTranscript ? { voiceTranscript: options.voiceTranscript } : {}),
    ...(options.speechCreativity !== null ? { creativity: options.speechCreativity } : {}) };
  if (options.imageTo3d) return { sourceImage: options.imageTo3d, meshSettings: { shapeResolution: 1024, ...options.meshSettings } };
  if (options.removeBackground) return { sourceImage: options.removeBackground, applyMask: !options.matte };
  return {};
}

export function validateGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error('Pixal3D returned an invalid GLB file; the result was not saved.');
  }
}
