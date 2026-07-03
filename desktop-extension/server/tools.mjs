// desktop-extension/server/tools.mjs
// MCP tool registry: JSON Schemas shown to Claude Desktop plus pure
// buildArgs() functions that translate tool input into sogni-agent argv.
// buildArgs never spawns anything — index.mjs owns process execution.

const GEN_BASE = ['--json', '-q', '--no-update-check'];

function push(args, flag, value) {
  if (value !== undefined && value !== null && value !== '') args.push(flag, String(value));
}

function required(input, field, hint) {
  const v = input[field];
  if (v === undefined || v === null || v === '') {
    throw new Error(`${field} is required${hint ? ` — ${hint}` : ''}.`);
  }
  return v;
}

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

export const TOOLS = [
  {
    name: 'generate_image',
    description:
      'Generate one or more images from a text prompt on the Sogni GPU network. ' +
      'Pass output_path (absolute, .png/.jpg) to save locally; otherwise a hosted URL is returned. ' +
      'Use context_images for image editing ("make the background a beach") and persona to include a saved person.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: str('What to generate'),
        output_path: str('Absolute file path to save the image (optional)'),
        quality: { type: 'string', enum: ['fast', 'hq', 'pro'], description: 'Quality preset' },
        model: str('Model id (optional; overrides quality preset)'),
        width: num('Width in px (default 512)'),
        height: num('Height in px (default 512)'),
        count: num('Number of images (default 1)'),
        seed: num('Fixed seed for reproducibility'),
        context_images: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of context/edit images' },
        persona: str('Saved persona name to use as reference'),
        timeout_seconds: num('Generation timeout override'),
      },
      required: ['prompt'],
    },
    buildArgs(input) {
      const prompt = required(input, 'prompt');
      const args = [...GEN_BASE];
      push(args, '-o', input.output_path);
      push(args, '-Q', input.quality);
      push(args, '-m', input.model);
      push(args, '-w', input.width);
      push(args, '-h', input.height);
      push(args, '-n', input.count);
      push(args, '-s', input.seed);
      for (const c of input.context_images ?? []) push(args, '-c', c);
      push(args, '--persona', input.persona);
      push(args, '-t', input.timeout_seconds);
      args.push(prompt);
      return args;
    },
  },
  {
    name: 'generate_video',
    description:
      'Generate a video from a text prompt, optionally driven by reference media. ' +
      'ref = start frame image, ref_end = end frame, ref_audio = soundtrack/lip-sync audio, ref_video = motion reference. ' +
      'Rendering takes minutes; prefer output_path (absolute .mp4).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: str('Motion/scene description'),
        output_path: str('Absolute .mp4 path to save (optional)'),
        model: str('Video model id (optional)'),
        workflow: { type: 'string', enum: ['t2v', 'i2v', 's2v', 'ia2v', 'a2v', 'v2v', 'animate-move', 'animate-replace'] },
        duration: num('Duration in seconds (default 5)'),
        ref: str('Absolute path or URL of the start-frame image'),
        ref_end: str('Absolute path or URL of the end-frame image'),
        ref_audio: str('Absolute path or URL of reference audio'),
        ref_video: str('Absolute path or URL of reference video'),
        persona: str('Saved persona name (reference frame)'),
        target_resolution: num('Short-side target in px, preserves aspect'),
        timeout_seconds: num('Generation timeout override (default 300)'),
      },
      required: ['prompt'],
    },
    buildArgs(input) {
      const prompt = required(input, 'prompt');
      const args = [...GEN_BASE, '--video'];
      push(args, '-o', input.output_path);
      push(args, '-m', input.model);
      push(args, '--workflow', input.workflow);
      push(args, '--duration', input.duration);
      push(args, '--ref', input.ref);
      push(args, '--ref-end', input.ref_end);
      push(args, '--ref-audio', input.ref_audio);
      push(args, '--ref-video', input.ref_video);
      push(args, '--persona', input.persona);
      push(args, '--target-resolution', input.target_resolution);
      push(args, '-t', input.timeout_seconds);
      args.push(prompt);
      return args;
    },
  },
  {
    name: 'generate_music',
    description:
      'Generate music/audio from a text prompt. Omit lyrics for an instrumental. ' +
      'Duration 10-600 seconds. Prefer output_path (absolute .mp3/.wav/.flac).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: str('Style/mood description'),
        output_path: str('Absolute audio file path to save (optional)'),
        lyrics: str('Song lyrics (optional)'),
        duration: num('Seconds, 10-600 (default 30)'),
        bpm: num('Beats per minute (30-300)'),
        keyscale: str('Key/scale, e.g. "C major"'),
        music_model: str('turbo | sft | ace_step_1.5_turbo | ace_step_1.5_sft'),
        audio_format: { type: 'string', enum: ['mp3', 'flac', 'wav'] },
        timeout_seconds: num('Generation timeout override (default 600)'),
      },
      required: ['prompt'],
    },
    buildArgs(input) {
      const prompt = required(input, 'prompt');
      const args = [...GEN_BASE, '--music'];
      push(args, '-o', input.output_path);
      push(args, '--music-model', input.music_model);
      push(args, '--lyrics', input.lyrics);
      push(args, '--duration', input.duration);
      push(args, '--bpm', input.bpm);
      push(args, '--keyscale', input.keyscale);
      push(args, '--output-format', input.audio_format);
      push(args, '-t', input.timeout_seconds);
      args.push(prompt);
      return args;
    },
  },
  {
    name: 'photobooth',
    description:
      'Face-transfer portrait generation: renders the person in the ref photo into a new scene ' +
      '(e.g. "LinkedIn professional headshot", "80s fashion portrait").',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: str('Scene/style description'),
        ref: str('Absolute path or URL of the face photo'),
        output_path: str('Absolute image path to save (optional)'),
        count: num('Number of variations (default 1)'),
      },
      required: ['prompt', 'ref'],
    },
    buildArgs(input) {
      const prompt = required(input, 'prompt');
      const ref = required(input, 'ref', 'a face photo path or URL');
      const args = [...GEN_BASE, '--photobooth', '--ref', String(ref)];
      push(args, '-n', input.count);
      push(args, '-o', input.output_path);
      args.push(prompt);
      return args;
    },
  },
  {
    name: 'edit_video',
    description:
      'Safe local video utilities (ffmpeg wrappers): extract the first/last frame, ' +
      'concatenate clips (with optional soundtrack), or remix the audio of an existing video.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['extract_first_frame', 'extract_last_frame', 'concat_videos', 'remix_audio'] },
        input: str('Input video path (extract/remix actions)'),
        output: str('Output file path'),
        clips: { type: 'array', items: { type: 'string' }, description: 'Clip paths for concat_videos (min 2)' },
        audio_path: str('Soundtrack to mux over concat_videos output'),
        bed_audio: str('Audio bed for remix_audio'),
        audio_loop: { type: 'boolean', description: 'Loop the bed to cover the video (remix_audio)' },
      },
      required: ['action', 'output'],
    },
    buildArgs(input) {
      const action = required(input, 'action');
      if (action === 'extract_first_frame' || action === 'extract_last_frame') {
        const src = required(input, 'input', 'the source video');
        const output = required(input, 'output');
        return ['--no-update-check', `--${action.replaceAll('_', '-')}`, String(src), String(output)];
      }
      if (action === 'concat_videos') {
        const output = required(input, 'output');
        const clips = input.clips ?? [];
        if (clips.length < 2) throw new Error('concat_videos needs at least two clips.');
        const args = ['--no-update-check', '--concat-videos', String(output), ...clips.map(String)];
        push(args, '--concat-audio', input.audio_path);
        return args;
      }
      if (action === 'remix_audio') {
        const src = required(input, 'input', 'the source video');
        const output = required(input, 'output');
        const args = ['--no-update-check', '--remix-audio', String(src), String(output)];
        push(args, '--bed-audio', input.bed_audio);
        if (input.audio_loop) args.push('--audio-loop');
        return args;
      }
      throw new Error(`Unknown action "${action}".`);
    },
  },
  {
    name: 'list_media',
    description: 'List recent inbound media files the user sent to Sogni (images, audio, or all).',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['images', 'audio', 'all'] } },
    },
    buildArgs(input) {
      return ['--json', '--no-update-check', '--list-media', input.type ?? 'images'];
    },
  },
  {
    name: 'manage_personas',
    description:
      'Manage saved personas (named people with reference photos and optional voice clips). ' +
      'Actions: list, add (needs name + ref photo), remove, resolve (show details).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'remove', 'resolve'] },
        name: str('Persona name (add/remove/resolve)'),
        ref: str('Reference photo path or URL (add)'),
        relationship: { type: 'string', enum: ['self', 'partner', 'child', 'friend', 'pet'] },
        description: str('Appearance description (add)'),
        voice_clip: str('Voice clip audio path (add)'),
      },
      required: ['action'],
    },
    buildArgs(input) {
      const action = required(input, 'action');
      if (action === 'list') return ['--json', '--no-update-check', '--persona-list'];
      const name = required(input, 'name');
      if (action === 'remove') return ['--no-update-check', '--persona-remove', String(name)];
      if (action === 'resolve') return ['--json', '--no-update-check', '--persona-resolve', String(name)];
      if (action === 'add') {
        const ref = required(input, 'ref', 'a reference photo for the persona');
        const args = ['--no-update-check', '--persona-add', String(name), '--ref', String(ref)];
        push(args, '--relationship', input.relationship);
        push(args, '--description', input.description);
        push(args, '--voice-clip', input.voice_clip);
        return args;
      }
      throw new Error(`Unknown action "${action}".`);
    },
  },
  {
    name: 'manage_memories',
    description:
      'Manage persistent user preferences (e.g. preferred_style). Actions: list, get, set, remove.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'set', 'remove'] },
        key: str('Memory key (get/set/remove)'),
        value: str('Memory value (set)'),
        category: { type: 'string', enum: ['preference', 'fact', 'context'] },
      },
      required: ['action'],
    },
    buildArgs(input) {
      const action = required(input, 'action');
      if (action === 'list') return ['--json', '--no-update-check', '--memory-list'];
      const key = required(input, 'key');
      if (action === 'get') return ['--json', '--no-update-check', '--memory-get', String(key)];
      if (action === 'remove') return ['--no-update-check', '--memory-remove', String(key)];
      if (action === 'set') {
        const value = required(input, 'value');
        const args = ['--no-update-check', '--memory-set', String(key), String(value)];
        push(args, '--memory-category', input.category);
        return args;
      }
      throw new Error(`Unknown action "${action}".`);
    },
  },
  {
    name: 'sogni_doctor',
    description:
      'Health check for the Sogni install: Node, credentials, ffmpeg, live auth, version. ' +
      'Run only after another tool fails — not as a routine preflight.',
    inputSchema: { type: 'object', properties: {} },
    buildArgs() {
      return ['--doctor', '--json', '--no-update-check'];
    },
  },
  {
    name: 'account_balance',
    description: 'Show the SPARK/SOGNI token balances for the configured Sogni account.',
    inputSchema: { type: 'object', properties: {} },
    buildArgs() {
      return ['--balances', '--json', '--no-update-check'];
    },
  },
];

export function getTool(name) {
  return TOOLS.find((t) => t.name === name);
}
