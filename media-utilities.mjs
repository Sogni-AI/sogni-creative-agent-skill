import {
  SpeechModel, SPEECH_MODELS, getSpeechMode, validateSpeechRequest, DEFAULT_SPEECH_VOICE,
  SPEECH_CREATIVITY, SPEECH_REFERENCE_SECONDS, MUSIC_MODELS, MusicModel,
  TranscriptionModel, TRANSCRIPTION_MODELS, DEFAULT_TRANSCRIPTION_ENGINE,
  TRANSCRIPTION_TIMESTAMP_GRANULARITIES, TRANSCRIPTION_OUTPUT_FORMATS,
  resolveTranscriptionEngineSelector, validateTranscriptionRequest,
  normalizeTranscriptArtifact, formatTranscriptAsText, formatTranscriptAsSrt, formatTranscriptAsVtt
} from '@sogni-ai/sogni-intelligence-client/media';

export const PIXAL3D_MODEL_ID = 'pixal3d_int8_i23d';
// A front view (--image-to-3d) plus any subset of three orbit views.
export const PIXAL3D_MULTIVIEW_MODEL_ID = 'pixal3d_multiview_int8_i23d';
export const BIREFNET_MODEL_ID = 'birefnet_image_background_removal_fp16';
export const MUSIC3_MODEL_ID = MusicModel.best;
export const MUSIC3_DEFAULTS = MUSIC_MODELS.best;
export {
  SPEECH_MODELS,
  SPEECH_REFERENCE_SECONDS,
  TRANSCRIPTION_MODELS,
  TRANSCRIPTION_OUTPUT_FORMATS,
  TRANSCRIPTION_TIMESTAMP_GRANULARITIES,
  validateTranscriptionRequest
};

export const SPEECH_VALUE_FLAGS = {
  '--speech-mode': 'speechMode', '--speech-voice': 'speechVoice', '--voice-description': 'voiceDescription',
  '--voice-reference': 'voiceReference', '--voice-transcript': 'voiceTranscript'
};

// Pixal3D multi-view orbit views, named by the SUBJECT's own sides, not the
// viewer's: --left-view shows the subject turned so its own left side faces the
// camera (it faces screen-left), --right-view its own right side (it faces
// screen-right), --back-view the subject from behind. Templates that label the
// subject's right side "left" build a model turned 180 degrees.
export const PIXAL3D_VIEW_FLAGS = {
  '--left-view': 'leftViewImage',
  '--back-view': 'backViewImage',
  '--right-view': 'rightViewImage'
};

export const MESH_FLAGS = {
  '--mesh-faces': ['meshTargetFaces', 5000, 700000],
  '--texture-size': ['textureSize', 1024, 4096],
  '--normal-map-size': ['normalMapSize', 512, 2048],
  '--ao-map-size': ['ambientOcclusionSize', 256, 1024],
  '--shape-resolution': ['shapeResolution', 1024, 1536]
};

export function resolveSpeechModeSelection(model, speechEnabled = false) {
  if (typeof model !== 'string' || !model.trim()) return undefined;
  const trimmed = model.trim();
  const byModelId = getSpeechMode(trimmed);
  if (byModelId) return byModelId;
  const normalized = trimmed.toLowerCase();
  if (normalized === 'drama3' || normalized === 'fish-drama-3') return 'drama3';
  if (speechEnabled && Object.hasOwn(SpeechModel, normalized)) return normalized;
  return undefined;
}

// Validate explicit controls before image/video inference can reinterpret them.
export function prepareMediaUtilityOptions(options, explicit) {
  const fail = message => { throw new Error(message); };
  const selectedSpeechMode = !options.transcribe
    ? resolveSpeechModeSelection(options.model, Boolean(options.speech))
    : undefined;
  if (selectedSpeechMode) {
    if (options.speechMode && options.speechMode !== selectedSpeechMode) fail('--speech-mode conflicts with --model.');
    options.speech = true;
    options.speechMode = selectedSpeechMode;
    options.model = SpeechModel[selectedSpeechMode];
  }
  if (!options.transcribe && options.model && resolveTranscriptionEngineSelector(options.model)) {
    fail('Speech-to-text models require --transcribe <audio-path-or-url>.');
  }
  if (!options.transcribe && (options.transcribeModel || options.timestamps !== null || options.diarize || options.hotwords !== null)) {
    fail('Transcription controls require --transcribe <audio-path-or-url>.');
  }
  const orbitViews = Object.keys(options.pixal3dViews);
  if (options.model === PIXAL3D_MODEL_ID && !options.imageTo3d) fail('Pixal3D requires --image-to-3d <original-image>.');
  if (options.model === PIXAL3D_MULTIVIEW_MODEL_ID && !options.imageTo3d) {
    fail('Pixal3D multi-view requires --image-to-3d <front-view-image> plus --left-view, --back-view and/or --right-view.');
  }
  if (orbitViews.length && !options.imageTo3d) {
    fail('--left-view, --back-view and --right-view add views to --image-to-3d, which takes the front view.');
  }
  if (options.model === BIREFNET_MODEL_ID && !options.removeBackground) fail('BiRefNet requires --remove-background <original-image>.');
  if (Object.keys(options.meshSettings).length && !options.imageTo3d) fail('Mesh settings require --image-to-3d.');
  if (options.matte && !options.removeBackground) fail('--matte requires --remove-background.');
  const hasNonApiSpeechControl = options.speechMode || options.speechVoice || options.voiceDescription
    || options.voiceTranscript || options.speechCreativity !== null
    || (options.voiceReference && !options.apiChat);
  if (!options.speech && hasNonApiSpeechControl) {
    fail('Speech controls require --speech.');
  }
  const active = options.speech || options.transcribe || options.imageTo3d || options.removeBackground;
  if (!active) return;
  if ([options.speech, options.transcribe, options.imageTo3d, options.removeBackground, options.music, options.video,
    options.segmentImage, options.segmentVideo, options.upscaleImage, options.upscaleVideo, options.apiChat, options.apiWorkflowAction].filter(Boolean).length !== 1) {
    fail('Choose one generation mode: speech, transcribe, image-to-3d, remove-background, music, video, segmentation, or upscale.');
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
    options.speechMode = (options.speechMode || 'voice').toLowerCase();
    const model = SpeechModel[options.speechMode];
    if (!model) fail('Speech mode must be voice, clone, design, or drama3.');
    if (explicit.model && options.model !== model) fail('--model conflicts with the selected speech mode.');
    options.model = model;
    options.musicLanguage = (options.musicLanguage || 'auto').toLowerCase();
    const error = validateSpeechRequest({ mode: options.speechMode, script: options.prompt,
      language: options.musicLanguage, voice: options.speechVoice || undefined,
      instruct: options.voiceDescription || undefined, referenceText: options.voiceTranscript || undefined,
      hasReferenceAudio: Boolean(options.voiceReference) });
    if (error) fail(error);
    if (options.speechMode === 'voice') options.speechVoice ||= DEFAULT_SPEECH_VOICE;
    if (options.speechCreativity !== null) {
      if (!Number.isFinite(options.speechCreativity) ||
        options.speechCreativity < SPEECH_CREATIVITY.min || options.speechCreativity > SPEECH_CREATIVITY.max) {
        fail(`--speech-creativity must be between ${SPEECH_CREATIVITY.min} and ${SPEECH_CREATIVITY.max}.`);
      }
      if (SPEECH_MODELS[options.speechMode]?.creativity === false) {
        options.speechCreativity = null;
      }
    }
    options.outputFormat = (options.outputFormat || 'wav').toLowerCase();
  } else if (options.transcribe) {
    if (options.count !== 1) fail('Transcription accepts one recording and produces one transcript; --count must be 1.');
    if (explicit.musicLanguage || explicit.seed || options.lastSeed) fail('Transcription does not accept language or seed controls.');
    if (options.transcribeModel && explicit.model) {
      const fromFlag = resolveTranscriptionEngineSelector(options.transcribeModel);
      const fromModel = resolveTranscriptionEngineSelector(options.model);
      if (!fromFlag) fail(`Unknown transcription model: ${options.transcribeModel}`);
      if (!fromModel) fail(`Unknown transcription model: ${options.model}`);
      if (fromFlag !== fromModel) fail('--transcribe-model conflicts with --model.');
    }
    const requestedSelector = options.transcribeModel || (explicit.model ? options.model : undefined);
    const error = validateTranscriptionRequest({
      engine: requestedSelector,
      hasAudio: Boolean(options.transcribe),
      timestamps: options.timestamps ?? 'sentence',
      diarize: Boolean(options.diarize),
      hotwords: options.hotwords || undefined,
      prompt: options.prompt || undefined
    });
    if (error) fail(error);
    const engine = requestedSelector
      ? resolveTranscriptionEngineSelector(requestedSelector, {
          diarize: Boolean(options.diarize),
          hotwords: options.hotwords || undefined,
          prompt: options.prompt || undefined
        })
      : (options.diarize || options.hotwords?.trim() || options.prompt?.trim() ? 'nemotron' : DEFAULT_TRANSCRIPTION_ENGINE);
    options.transcribeEngine = engine;
    options.model = TranscriptionModel[engine];
    options.timestamps = options.timestamps || 'sentence';
    const outputExtension = options.output?.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase();
    if (options.outputFormat) {
      const normalizedFmt = options.outputFormat.trim().toLowerCase() === 'text' ? 'txt' : options.outputFormat.trim().toLowerCase();
      if (!TRANSCRIPTION_OUTPUT_FORMATS.includes(normalizedFmt)) {
        fail('Transcription output format must be json, txt, srt, or vtt.');
      }
      options.outputFormat = normalizedFmt;
    } else if (outputExtension && TRANSCRIPTION_OUTPUT_FORMATS.includes(outputExtension)) {
      options.outputFormat = outputExtension;
    } else {
      options.outputFormat = 'txt';
    }
  } else {
    if (options.prompt) fail('Pixal3D and BiRefNet are promptless; supply only the original image.');
    if (options.count !== 1) fail('Image utilities accept one image and produce one result; --count must be 1.');
    if (explicit.musicLanguage || explicit.seed || options.lastSeed) fail('Image utilities do not accept language or seed controls.');
    const model = options.imageTo3d
      ? (orbitViews.length ? PIXAL3D_MULTIVIEW_MODEL_ID : PIXAL3D_MODEL_ID)
      : BIREFNET_MODEL_ID;
    if (explicit.model && options.model !== model) {
      if (options.model === PIXAL3D_MULTIVIEW_MODEL_ID) {
        fail(`${PIXAL3D_MULTIVIEW_MODEL_ID} needs --left-view, --back-view and/or --right-view; a front image alone uses ${PIXAL3D_MODEL_ID}.`);
      }
      if (options.model === PIXAL3D_MODEL_ID && orbitViews.length) {
        fail(`${PIXAL3D_MODEL_ID} reconstructs from one image; orbit views use ${PIXAL3D_MULTIVIEW_MODEL_ID}.`);
      }
      fail('--model conflicts with the selected image utility.');
    }
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

// viewBytes maps leftViewImage/backViewImage/rightViewImage to image bytes.
export function imageUtilityConfig(options, bytes, viewBytes = {}) {
  return {
    modelId: options.model, positivePrompt: '', startingImage: bytes,
    numberOfMedia: 1, tokenType: options.tokenType || 'spark', waitForCompletion: false,
    ...(options.imageTo3d ? { ...options.meshSettings, ...viewBytes } : { applyMask: !options.matte, outputFormat: 'png' })
  };
}

export function speechConfig(options, referenceAudio) {
  const mode = options.speechMode || getSpeechMode(options.model);
  const supportsCreativity = SPEECH_MODELS[mode]?.creativity !== false && options.model !== SpeechModel.drama3;
  return {
    modelId: options.model, positivePrompt: options.prompt, numberOfMedia: options.count,
    tokenType: options.tokenType || 'spark', waitForCompletion: false,
    disableNSFWFilter: options.noFilter === true,
    language: options.musicLanguage, outputFormat: options.outputFormat,
    ...(options.speechVoice ? { speaker: options.speechVoice } : {}),
    ...(options.voiceDescription ? { instruct: options.voiceDescription } : {}),
    ...(referenceAudio ? { referenceAudio } : {}),
    ...(options.voiceTranscript ? { referenceText: options.voiceTranscript } : {}),
    ...(supportsCreativity && options.speechCreativity !== null ? { creativity: options.speechCreativity } : {}),
    ...(options.seed !== null ? { seed: options.seed } : {})
  };
}

export function transcriptionConfig(options, referenceAudio, duration) {
  return {
    type: 'audio',
    modelId: options.model,
    positivePrompt: options.prompt || '',
    referenceAudio,
    duration,
    numberOfMedia: 1,
    tokenType: options.tokenType || 'spark',
    waitForCompletion: false,
    disableNSFWFilter: options.noFilter === true,
    timestamps: options.timestamps || 'sentence',
    diarize: Boolean(options.diarize),
    ...(options.hotwords?.trim() ? { hotwords: options.hotwords.trim() } : {}),
    outputFormat: 'json'
  };
}

export function formatTranscriptResult(raw, format = 'txt', fallbackModel = undefined) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) && !raw.model && fallbackModel
    ? { ...raw, model: fallbackModel }
    : raw;
  const transcript = normalizeTranscriptArtifact(source);
  let formatted;
  switch (format) {
    case 'json':
      formatted = JSON.stringify(transcript, null, 2);
      break;
    case 'srt':
      formatted = formatTranscriptAsSrt(transcript);
      break;
    case 'vtt':
      formatted = formatTranscriptAsVtt(transcript);
      break;
    case 'txt':
    default:
      formatted = formatTranscriptAsText(transcript);
      break;
  }
  return { transcript, formatted };
}

export function utilityResultMetadata(options) {
  if (options.speech) {
    const supportsCreativity = SPEECH_MODELS[options.speechMode]?.creativity !== false && options.model !== SpeechModel.drama3;
    return {
      speechMode: options.speechMode, speaker: options.speechVoice,
      language: options.musicLanguage,
      ...(options.voiceDescription ? { voiceDescription: options.voiceDescription } : {}),
      ...(options.voiceReference ? { voiceReference: options.voiceReference } : {}),
      ...(options.voiceTranscript ? { voiceTranscript: options.voiceTranscript } : {}),
      ...(supportsCreativity && options.speechCreativity !== null ? { creativity: options.speechCreativity } : {})
    };
  }
  if (options.transcribe) {
    return {
      sourceAudio: options.transcribe,
      transcribeEngine: options.transcribeEngine,
      timestamps: options.timestamps,
      diarize: Boolean(options.diarize),
      ...(options.hotwords?.trim() ? { hotwords: options.hotwords.trim() } : {}),
      ...(Number.isFinite(options._transcribeDuration) ? { duration: options._transcribeDuration } : {})
    };
  }
  if (options.imageTo3d) return { sourceImage: options.imageTo3d,
    ...(Object.keys(options.pixal3dViews).length ? { orbitViews: { ...options.pixal3dViews } } : {}),
    meshSettings: { shapeResolution: 1024, ...options.meshSettings } };
  if (options.removeBackground) return { sourceImage: options.removeBackground, applyMask: !options.matte };
  return {};
}

export function validateGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error('Pixal3D returned an invalid GLB file; the result was not saved.');
  }
}
