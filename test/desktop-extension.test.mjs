import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, existsSync as fsExistsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  resolveAgentPath, resolveFfmpegPath, buildChildEnv,
} from '../desktop-extension/server/resolve.mjs';
import { TOOLS, getTool, hardKillTimeoutMs } from '../desktop-extension/server/tools.mjs';
import { collectInlineImages } from '../desktop-extension/server/inline-images.mjs';
import { importMedia } from '../desktop-extension/server/import-media.mjs';
import { allowedOutputDirs, checkOutputPath, lastFrameSiblings } from '../desktop-extension/server/output-paths.mjs';
import { PACKAGE_VERSION } from '../version.mjs';
import { MODEL_PROMPT_GUIDES, renderModelPromptGuide } from '@sogni-ai/sogni-intelligence-client/prompt-guides';
import { stageMcpb } from '../scripts/build-mcpb.mjs';

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'sogni-desktop-'));
}

// Route a public fixture URL to a local server without making external calls.
function previewRequestTo(server) {
  return (url, options, callback) => httpRequest(
    new URL(url.pathname + url.search, `http://127.0.0.1:${server.address().port}`), options, callback,
  );
}

test('desktop image tools forward explicit network, Priority and GPT Image 2.6 controls', () => {
  const args = getTool('generate_image').buildArgs({
    prompt: 'a waving robot', model: 'gpt-image-2.6-flare', network: 'fast',
    output_format: 'gif', image_complexity: 'high', image_frame_count: 9, image_frame_duration_ms: 120,
  });
  for (const [flag, value] of [['--network', 'fast'], ['--output-format', 'gif'], ['--image-complexity', 'high'], ['--image-frame-count', '9'], ['--image-frame-duration-ms', '120']]) {
    assert.equal(args[args.indexOf(flag) + 1], value);
  }
  assert.equal(args.includes('--priority'), false);
  assert.ok(getTool('generate_image').buildArgs({ prompt: 'a duck', priority: true }).includes('--priority'));
  const editArgs = getTool('generate_image').buildArgs({ prompt: 'edit the circled chair', image_markup_url: 'https://cdn.test/markup.png', context_images: ['/source.jpg'] });
  assert.equal(editArgs[editArgs.indexOf('--image-markup-url') + 1], 'https://cdn.test/markup.png');
});

test('desktop video and music tools forward explicit worker choices', () => {
  assert.ok(getTool('generate_video').buildArgs({ prompt: 'a duck', priority: true, return_last_frame: true }).includes('--return-last-frame'));
  assert.ok(getTool('generate_video').buildArgs({ prompt: 'a duck', priority: true }).includes('--priority'));
  const args = getTool('generate_music').buildArgs({ prompt: 'ambient pads', network: 'relaxed' });
  assert.equal(args[args.indexOf('--network') + 1], 'relaxed');
});

test('desktop Personas can list an account page and explicitly import a selected id', () => {
  assert.deepEqual(getTool('manage_personas').buildArgs({ action: 'list_account', after: 'next' }), ['--json', '--no-update-check', '--persona-list-account', '--persona-account-after', 'next']);
  assert.deepEqual(getTool('manage_personas').buildArgs({ action: 'import_account', account_persona_id: 'alice-id' }), ['--json', '--no-update-check', '--persona-import-account', 'alice-id']);
});

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
  assert.equal(
    resolveAgentPath({ env: {}, home, roots: [], bundledAgentPath: null }),
    join(npmGlobal, 'sogni-agent.mjs'),
  );

  const home2 = tempHome();
  const nvm = join(home2, '.nvm', 'versions', 'node', 'v22.11.0', rel);
  mkdirSync(nvm, { recursive: true });
  writeFileSync(join(nvm, 'sogni-agent.mjs'), '// stub');
  assert.equal(
    resolveAgentPath({ env: {}, home: home2, roots: [], bundledAgentPath: null }),
    join(nvm, 'sogni-agent.mjs'),
  );
});

test('resolveAgentPath returns null when nothing is installed', () => {
  assert.equal(
    resolveAgentPath({ env: {}, home: tempHome(), roots: [], bundledAgentPath: null }),
    null,
  );
});

test('resolveAgentPath uses the CLI bundled beside the published MCP server', () => {
  const root = join(HERE, '..');
  assert.equal(
    resolveAgentPath({ env: {}, home: tempHome(), roots: [] }),
    join(root, 'sogni-agent.mjs'),
  );
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

test('buildChildEnv applies canonical MCP markers and drops undeclared versions', () => {
  const env = buildChildEnv({
    env: {
      PATH: '/usr/bin',
      SOGNI_AGENT_FRAMEWORK: 'untrusted-parent',
      SOGNI_AGENT_FRAMEWORK_VERSION: 'private build',
    },
    agentPath: '/x/sogni-agent.mjs',
    attributionEnv: {
      SOGNI_AGENT_FRAMEWORK: 'codex',
      SOGNI_AGENT_FRAMEWORK_VERSION: undefined,
      SOGNI_AGENT_SURFACE: 'mcp',
      SOGNI_AGENT_SURFACE_VERSION: '3.21.0',
    },
  });
  assert.equal(env.SOGNI_AGENT_FRAMEWORK, 'codex');
  assert.equal('SOGNI_AGENT_FRAMEWORK_VERSION' in env, false);
  assert.equal(env.SOGNI_AGENT_SURFACE, 'mcp');
  assert.equal(env.SOGNI_AGENT_SURFACE_VERSION, '3.21.0');
});

test('TOOLS exposes the expected v1 tool names', () => {
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), [
    'account_balance', 'edit_video', 'generate_image', 'generate_music',
    'generate_speech', 'generate_video', 'import_media', 'list_media', 'manage_memories',
    'manage_personas', 'photobooth', 'prompt_guide', 'sogni_doctor',
    'transcribe_audio', 'upscale_image', 'upscale_video',
  ]);
  for (const t of TOOLS) {
    assert.equal(typeof t.description, 'string');
    assert.equal(t.inputSchema.type, 'object');
    // Tools either translate to CLI argv (buildArgs) or run inside the server (local).
    assert.ok(typeof t.buildArgs === 'function' || t.local === true, `${t.name} has no execution path`);
  }
});

// Hosts and the chat app read these tools as they were in 3.72.2: a digest of
// each one's schema, description, argv for sample inputs and kill deadline.
// Change a digest only when that tool is meant to change.
const EXISTING_TOOL_DIGESTS = {
  generate_image: 'b74b41ddb0460bba2babce34004a2ecdb1ce3089942e2da1a9f8e14191fa30dc',
  generate_video: '9adef5096589873d25e8a609032a9557076713149f4d26b2019ab7e5e81d48bc',
  prompt_guide: 'fdfcd12d08757698cf387e94db08c8a9780aac3722d7a7a8554abe23ed1d5266',
  generate_music: '098d41be333d1f629e5b4ebe81857165fbb974331384aad38989ac236a5d8c87',
  photobooth: 'c6a59a58b1db78b93223e0cee9c64376d6a9e76afac723ecc5aba53ca74818fe',
  edit_video: '65a3dafd84e8b7f7617d0f06339f5ccf68098d43bdabe9e1a385a632080c299d',
  import_media: '19c0e034eb27d476badaa732f91f4ae5e16fed95cefc68036cdff1e12bdda995',
  list_media: '0aaf2af9d438e3e783d41bdb65e449a13b794a38bcc1b8865101e88e902cd980',
  manage_personas: 'd73dac45894bd3b6efca5c5f4ea18c7ed6a9bb4a2936d79ded0d9ffb86eb7746',
  manage_memories: 'd6fd059ea657a6df2ccf64298267306029c09f26750989caec7eab5ec9e14fc2',
  sogni_doctor: 'e2a1cc16fcd124bf21d05eb398deac942108d076c8f252b83f2744bc34e8661c',
  account_balance: '8dfd577944243d0e1b3065d6dd76159aaea267b18c10c4b8697e0e7e54b958c2',
};

function sampleValue(key, schema) {
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'number') return 7;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'array' && schema.items?.type === 'object') {
    return [Object.fromEntries(Object.entries(schema.items.properties).map(([k, s]) => [k, sampleValue(k, s)]))];
  }
  if (schema.type === 'array') return [`/${key}-1`, `/${key}-2`];
  return `/${key}-value`;
}

function toolDigest(tool) {
  const { name, description, inputSchema, maxResultChars, local } = tool;
  const properties = inputSchema.properties ?? {};
  const full = Object.fromEntries(Object.entries(properties).map(([key, schema]) => [key, sampleValue(key, schema)]));
  const minimal = Object.fromEntries((inputSchema.required ?? []).map((key) => [key, full[key]]));
  const argvFor = (input) => {
    try {
      return tool.buildArgs(input);
    } catch (error) {
      return { error: error.message };
    }
  };
  const argv = local ? null : (properties.action?.enum ?? [undefined]).flatMap((action) => [
    argvFor(action ? { ...full, action } : full),
    argvFor(action ? { ...minimal, action } : minimal),
  ]);
  const hardKill = [hardKillTimeoutMs(name, {}), hardKillTimeoutMs(name, { timeout_seconds: 7200 })];
  const text = JSON.stringify({ name, description, inputSchema, maxResultChars, local, argv, hardKill });
  return createHash('sha256').update(text).digest('hex');
}

test('the 3.72.2 tools keep their order, schemas, descriptions, argv and kill deadlines', () => {
  const names = Object.keys(EXISTING_TOOL_DIGESTS);
  assert.deepEqual(TOOLS.slice(0, names.length).map((t) => t.name), names);
  for (const name of names) assert.equal(toolDigest(getTool(name)), EXISTING_TOOL_DIGESTS[name], `${name} changed`);
});

test('upscale_image, upscale_video and generate_speech map each argument to one CLI flag', () => {
  const base = ['--json', '-q', '--no-update-check'];
  // A prompt is no upscale argument, so it never reaches the promptless CLI mode.
  assert.deepEqual(getTool('upscale_image').buildArgs({ image: '/in.jpg', prompt: 'make it sharper' }), [...base, '--upscale', '/in.jpg']);
  assert.deepEqual(getTool('upscale_image').buildArgs({
    image: 'https://cdn.example/in.png', network: 'relaxed', priority: true, scale: 3, target_longest_edge: 3840,
    output_path: '/out.png', timeout_seconds: 300,
  }), [
    ...base, '--upscale', 'https://cdn.example/in.png', '--network', 'relaxed', '--priority',
    '--upscale-scale', '3', '--target-longest-edge', '3840', '-o', '/out.png', '-t', '300',
  ]);
  assert.deepEqual(getTool('upscale_video').buildArgs({ video: '/in.mp4' }), [...base, '--upscale-video', '/in.mp4']);
  assert.deepEqual(getTool('upscale_video').buildArgs({
    video: '/in.mp4', network: 'fast', upscale_model: 'relayvsr', resolution: 2160, output_path: '/out.mp4', timeout_seconds: 2400,
  }), [
    ...base, '--upscale-video', '/in.mp4', '--network', 'fast',
    '--upscale-model', 'relayvsr', '--upscale-resolution', '2160', '-o', '/out.mp4', '-t', '2400',
  ]);
  const speech = getTool('generate_speech');
  assert.equal(speech.inputSchema.properties.text.maxLength, 5000);
  assert.deepEqual(speech.inputSchema.properties.mode.enum, ['voice', 'clone', 'design', 'drama3']);
  assert.ok(speech.inputSchema.properties.language.enum.includes('arabic'));
  assert.equal(speech.buildArgs({ text: 'a'.repeat(5000), mode: 'drama3' }).at(-1)?.length, 5000);
  assert.throws(() => speech.buildArgs({ text: 'a'.repeat(5001), mode: 'drama3' }), /5000 characters/);
  assert.throws(() => speech.buildArgs({ text: 'a'.repeat(4097), mode: 'voice' }), /4096 characters/);
  assert.throws(() => speech.buildArgs({ text: 'a'.repeat(4097) }), /4096 characters/);
  assert.deepEqual(Object.keys(speech.inputSchema.properties).sort(), [
    'audio_format',
    'creativity',
    'language',
    'mode',
    'network',
    'output_path',
    'priority',
    'text',
    'timeout_seconds',
    'voice',
    'voice_description',
    'voice_reference',
    'voice_transcript',
  ]);
  assert.deepEqual(speech.buildArgs({ text: 'Hello there.' }), [...base, '--speech', '--', 'Hello there.']);
  assert.deepEqual(speech.buildArgs({
    text: 'Hello there.', priority: true, mode: 'clone', voice: 'ryan', voice_description: 'calm and slow',
    voice_reference: '/voice.m4a', voice_transcript: 'This is my voice.', creativity: 0.7, language: 'english',
    output_path: '/out.mp3', audio_format: 'mp3', timeout_seconds: 900,
  }), [
    ...base, '--speech', '--priority', '--speech-mode', 'clone', '--speech-voice', 'ryan',
    '--voice-description', 'calm and slow', '--voice-reference', '/voice.m4a', '--voice-transcript', 'This is my voice.',
    '--speech-creativity', '0.7', '--language', 'english', '-o', '/out.mp3', '--output-format', 'mp3', '-t', '900',
    '--', 'Hello there.',
  ]);
  assert.deepEqual(speech.buildArgs({
    text: '[sighs] Finally home. <whisper>Keep quiet.</whisper>',
    mode: 'drama3',
    voice_reference: '/ref.wav',
    voice_transcript: 'Known words.',
    creativity: 0.8,
    language: 'arabic',
    output_path: '/drama.wav',
  }), [
    ...base, '--speech', '--speech-mode', 'drama3',
    '--voice-reference', '/ref.wav', '--voice-transcript', 'Known words.',
    '--language', 'arabic', '-o', '/drama.wav',
    '--', '[sighs] Finally home. <whisper>Keep quiet.</whisper>',
  ]);
  const transcribe = getTool('transcribe_audio');
  assert.deepEqual(transcribe.buildArgs({ audio: '/in.m4a' }), [...base, '--transcribe', '/in.m4a']);
  assert.deepEqual(transcribe.buildArgs({
    audio: 'https://cdn.example/interview.mp3',
    network: 'fast',
    priority: true,
    model: 'nemotron',
    timestamps: 'word',
    diarize: true,
    hotwords: 'Sogni, Spark',
    prompt: '--interview context',
    format: 'srt',
    output_path: '/out.srt',
    timeout_seconds: 900,
  }), [
    ...base, '--transcribe', 'https://cdn.example/interview.mp3', '--network', 'fast', '--priority',
    '--transcribe-model', 'nemotron', '--timestamps', 'word', '--diarize',
    '--hotwords', 'Sogni, Spark', '--output-format', 'srt', '-o', '/out.srt', '-t', '900',
    '--', '--interview context',
  ]);
  for (const value of [null, '']) {
    assert.deepEqual(speech.buildArgs({ text: 'Hi.', mode: value, voice: value, voice_reference: value, output_path: value }), [...base, '--speech', '--', 'Hi.']);
    assert.deepEqual(getTool('upscale_video').buildArgs({ video: '/in.mp4', upscale_model: value, resolution: value }), [...base, '--upscale-video', '/in.mp4']);
    assert.deepEqual(transcribe.buildArgs({ audio: '/in.wav', model: value, timestamps: value, hotwords: value, prompt: value, format: value, output_path: value }), [...base, '--transcribe', '/in.wav']);
  }
  assert.throws(() => getTool('upscale_image').buildArgs({}), /^Error: image is required/);
  assert.throws(() => getTool('upscale_video').buildArgs({ video: '' }), /^Error: video is required/);
  assert.throws(() => speech.buildArgs({ text: null }), /^Error: text is required/);
  assert.throws(() => transcribe.buildArgs({ audio: '' }), /^Error: audio is required/);
});

test('generate_image builds quiet JSON argv with prompt last', () => {
  const args = getTool('generate_image').buildArgs({
    prompt: 'a cat wearing a hat',
    output_path: '/tmp/cat.png',
    quality: 'pro',
    width: 1024,
    height: 768,
    context_images: ['/tmp/a.jpg', '/tmp/b.jpg'],
  });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check',
    '-o', '/tmp/cat.png', '-Q', 'pro', '-w', '1024', '-h', '768',
    '-c', '/tmp/a.jpg', '-c', '/tmp/b.jpg',
    '--', 'a cat wearing a hat',
  ]);
});

test('generate_video maps refs and duration', () => {
  const args = getTool('generate_video').buildArgs({
    prompt: 'cat walks around',
    ref: '/tmp/cat.jpg',
    duration: 8,
    model: 'wan_v2.2-14b-fp8_i2v_lightx2v',
    output_path: '/tmp/cat.mp4',
  });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check', '--video',
    '-o', '/tmp/cat.mp4', '-m', 'wan_v2.2-14b-fp8_i2v_lightx2v',
    '--duration', '8', '--ref', '/tmp/cat.jpg',
    '--', 'cat walks around',
  ]);
});

test('generate_video maps Seedance 2.5 draft mode, and a finalize sends no prompt', () => {
  const tool = getTool('generate_video');
  assert.deepEqual(tool.buildArgs({ prompt: 'a storm rolls in', model: 'seedance2-5', seedance_draft: true }), [
    '--json', '-q', '--no-update-check', '--video', '-m', 'seedance2-5', '--seedance-draft', '--', 'a storm rolls in',
  ]);
  assert.deepEqual(tool.buildArgs({ model: 'seedance2-5', seedance_finalize: 'job-draft-1', output_path: '/tmp/final.mp4' }), [
    '--json', '-q', '--no-update-check', '--video', '-o', '/tmp/final.mp4', '-m', 'seedance2-5', '--seedance-finalize', 'job-draft-1',
  ]);
  assert.throws(() => tool.buildArgs({ model: 'seedance2-5' }), /prompt is required/);
  const final4k = tool.buildArgs({ model: 'seedance2-5', seedance_finalize: 'job-draft-1', target_resolution: 2160 });
  assert.equal(final4k[final4k.indexOf('--target-resolution') + 1], '2160');
  assert.equal(final4k[final4k.indexOf('--seedance-finalize') + 1], 'job-draft-1');
});

test('generate_video exposes MiniMax H3 r2v reference arrays and audio control', () => {
  const tool = getTool('generate_video');
  assert.ok(tool.inputSchema.properties.workflow.enum.includes('r2v'));
  const args = tool.buildArgs({
    prompt: '<Picture 1> controls identity. <Video 1> controls motion. <Audio 1> controls voice.',
    workflow: 'r2v',
    model: 'minimax-h3-r2v',
    ref: '/tmp/identity.jpg',
    reference_images: ['/tmp/wardrobe.jpg'],
    ref_video: '/tmp/motion.mp4',
    reference_videos: ['/tmp/camera.mp4'],
    ref_audio: '/tmp/voice.m4a',
    reference_audios: ['/tmp/rhythm.m4a'],
    generate_audio: false,
  });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check', '--video',
    '-m', 'minimax-h3-r2v', '--workflow', 'r2v',
    '--ref', '/tmp/identity.jpg',
    '--ref-audio', '/tmp/voice.m4a', '--ref-audio', '/tmp/rhythm.m4a',
    '--ref-video', '/tmp/motion.mp4', '--ref-video', '/tmp/camera.mp4',
    '-c', '/tmp/wardrobe.jpg', '--no-generate-audio',
    '--', '<Picture 1> controls identity. <Video 1> controls motion. <Audio 1> controls voice.',
  ]);
});

test('generate_video maps MiniMax H3 keyframes to repeatable --keyframe image@seconds', () => {
  const tool = getTool('generate_video');
  const schema = tool.inputSchema.properties.keyframes;
  assert.equal(schema.type, 'array');
  assert.equal(schema.maxItems, 8);
  assert.deepEqual(schema.items.required, ['image', 'at_seconds']);
  assert.match(schema.description, /^MiniMax H3 only\. Pin up to 8 images at exact moments inside the video/);
  assert.match(schema.description, /strictly inside the clip \(not on the first or last frame\) and at distinct times/);
  assert.match(schema.description, /a keyframe with a new angle, place or light starts a new shot/);
  assert.match(schema.description, /Two keyframes are included in the price; each additional keyframe adds a little/);

  const args = tool.buildArgs({
    prompt: '<FLF2V preamble plus three-field H3 prompt>',
    model: 'minimax-h3-fasth3-flf2v-turbo',
    ref: '/tmp/first.png',
    ref_end: '/tmp/last.png',
    keyframes: [
      { image: '/tmp/turn.png', at_seconds: 3.5 },
      { image: 'https://cdn.example.com/wave.png', at_seconds: 6 },
    ],
    duration: 8,
  });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check', '--video',
    '-m', 'minimax-h3-fasth3-flf2v-turbo', '--duration', '8',
    '--ref', '/tmp/first.png', '--ref-end', '/tmp/last.png',
    '--keyframe', '/tmp/turn.png@3.5', '--keyframe', 'https://cdn.example.com/wave.png@6',
    '--', '<FLF2V preamble plus three-field H3 prompt>',
  ]);
  assert.throws(
    () => tool.buildArgs({ prompt: 'x', keyframes: [{ image: '/tmp/turn.png' }] }),
    /keyframes items need image \(a path or URL\) and at_seconds/,
  );
});

test('generate_music maps lyrics and format', () => {
  const args = getTool('generate_music').buildArgs({
    prompt: 'bright indie pop chorus',
    lyrics: 'Rise with the morning light',
    duration: 30,
    bpm: 128,
    audio_format: 'mp3',
  });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check', '--music',
    '--lyrics', 'Rise with the morning light', '--duration', '30',
    '--bpm', '128', '--output-format', 'mp3',
    '--', 'bright indie pop chorus',
  ]);
});

test('generate_music defaults to Music 3 and passes a named model through', () => {
  const tool = getTool('generate_music');
  assert.match(tool.description, /MiniMax Music 3 by default/);
  assert.match(tool.inputSchema.properties.music_model.description, /^music3 \(default\)/);
  const args = tool.buildArgs({ prompt: 'long ambient drone', music_model: 'turbo', duration: 420 });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check', '--music',
    '--music-model', 'turbo', '--duration', '420',
    '--', 'long ambient drone',
  ]);
});

test('photobooth requires ref', () => {
  assert.throws(() => getTool('photobooth').buildArgs({ prompt: 'headshot' }), /ref/);
  const args = getTool('photobooth').buildArgs({ prompt: 'headshot', ref: '/tmp/face.jpg', count: 4 });
  assert.deepEqual(args, [
    '--json', '-q', '--no-update-check', '--photobooth',
    '--ref', '/tmp/face.jpg', '-n', '4', '--', 'headshot',
  ]);
});

const OUTPUT_CASES = [
  ['generate_image', { prompt: 'a duck' }, 'output_path'],
  ['generate_video', { prompt: 'a duck' }, 'output_path'],
  ['generate_music', { prompt: 'soft piano' }, 'output_path'],
  ['photobooth', { prompt: 'a portrait', ref: '/face.jpg' }, 'output_path'],
  ['edit_video', { action: 'extract_first_frame', input: '/in.mp4' }, 'output'],
  ['edit_video', { action: 'extract_last_frame', input: '/in.mp4' }, 'output'],
  ['edit_video', { action: 'concat_videos', clips: ['/a.mp4', '/b.mp4'] }, 'output'],
  ['edit_video', { action: 'remix_audio', input: '/in.mp4' }, 'output'],
  ['upscale_image', { image: '/in.png' }, 'output_path'],
  ['upscale_video', { video: '/in.mp4' }, 'output_path'],
  ['generate_speech', { text: 'Hello.' }, 'output_path'],
  ['transcribe_audio', { audio: '/in.wav' }, 'output_path'],
];

// buildArgs passes an output path through as given; the server checks it first
// (output-paths.mjs) and hands buildArgs the absolute path it checked.
test('buildArgs passes each output path through unchanged', () => {
  for (const [name, input, field] of OUTPUT_CASES) {
    for (const path of [
      '~/Desktop/render.png', 'relative/render.mp4', '/Users/me/.openclaw/media/inbound/render.png',
      '/media/render.webm', '/media/render.m4a', '/media/render', '/media/render.PNG',
    ]) {
      assert.ok(getTool(name).buildArgs({ ...input, [field]: path }).includes(path), `${name}: ${path}`);
    }
  }
});

test('a null or empty optional field counts as not given', () => {
  for (const [name, input, field] of OUTPUT_CASES.slice(0, 4)) {
    for (const value of [null, '']) {
      assert.deepEqual(
        getTool(name).buildArgs({ ...input, [field]: value, persona: value, timeout_seconds: value }),
        getTool(name).buildArgs(input),
        `${name}: ${JSON.stringify(value)}`,
      );
    }
  }
  const t = getTool('edit_video');
  for (const value of [null, '']) {
    assert.deepEqual(
      t.buildArgs({ action: 'concat_videos', output: '/out.mp4', clips: ['/a.mp4', '/b.mp4'], audio_path: value, input: value }),
      ['--no-update-check', '--concat-videos', '/out.mp4', '/a.mp4', '/b.mp4'],
    );
    assert.deepEqual(
      t.buildArgs({ action: 'remix_audio', input: '/in.mp4', output: '/out.mp4', bed_audio: value }),
      ['--no-update-check', '--remix-audio', '/in.mp4', '/out.mp4'],
    );
  }
  assert.deepEqual(
    getTool('generate_video').buildArgs({ prompt: null, model: 'seedance2-5', seedance_finalize: 'job-1', keyframes: null }),
    ['--json', '-q', '--no-update-check', '--video', '-m', 'seedance2-5', '--seedance-finalize', 'job-1'],
  );
});

test('loosely typed values reach the CLI, which checks and normalizes them', () => {
  assert.deepEqual(
    getTool('generate_image').buildArgs({ prompt: 'a cat', width: '1024', quality: 'HQ', output_format: 'jpeg', context_images: null }),
    ['--json', '-q', '--no-update-check', '--output-format', 'jpeg', '-Q', 'HQ', '-w', '1024', '--', 'a cat'],
  );
  assert.deepEqual(
    getTool('generate_video').buildArgs({ prompt: 'a cat walks', workflow: 'T2V', duration: '8' }),
    ['--json', '-q', '--no-update-check', '--video', '--workflow', 'T2V', '--duration', '8', '--', 'a cat walks'],
  );
  assert.deepEqual(
    getTool('manage_personas').buildArgs({ action: 'resolve', name: '-dash' }),
    ['--json', '--no-update-check', '--persona-resolve', '-dash'],
  );
  assert.deepEqual(
    getTool('manage_memories').buildArgs({ action: 'set', key: '-k', value: 5, category: 'style' }),
    ['--no-update-check', '--memory-set', '-k', '5', '--memory-category', 'style'],
  );
});

const PROMPT_CASES = [
  ['generate_image', {}, '/out.png'],
  ['generate_video', {}, '/out.mp4'],
  ['generate_music', {}, '/out.mp3'],
  ['photobooth', { ref: '/face.jpg' }, '/out.png'],
];

test('generation tools place the whole prompt after the final separator', () => {
  for (const [name, input, output] of PROMPT_CASES) {
    for (const prompt of ['a sunny day', '-5 degrees outside', '--personality-clear', '- Shot 1: a cat -- then a dog']) {
      const args = getTool(name).buildArgs({ ...input, prompt, output_path: output });
      assert.deepEqual(args.slice(-2), ['--', prompt], name);
      assert.equal(args.indexOf('--'), args.length - 2, name);
      assert.ok(args.indexOf('-o') < args.length - 2);
    }
  }
  for (const text of ['Hello.', '-5 degrees outside', '--personality-clear', '- First -- then']) {
    const args = getTool('generate_speech').buildArgs({ text, voice_description: '--calm', output_path: '/out.wav' });
    assert.deepEqual(args.slice(-2), ['--', text]);
    assert.equal(args.indexOf('--'), args.length - 2);
  }
});

test('edit_video refuses a concat clip that the CLI would read as an option', () => {
  for (const clip of ['--personality-set', '-clip.mp4']) {
    assert.throws(() => getTool('edit_video').buildArgs({
      action: 'concat_videos', output: '/out.mp4', clips: ['/a.mp4', '/b.mp4', clip],
    }), { message: 'clip paths cannot start with "-".' });
  }
  // Any other clip reaches the CLI as on main; the CLI reports a missing file itself.
  assert.deepEqual(
    getTool('edit_video').buildArgs({ action: 'concat_videos', output: '/out.mp4', clips: ['/a.mp4', '', 42, null] }),
    ['--no-update-check', '--concat-videos', '/out.mp4', '/a.mp4', '', '42', 'null'],
  );
});

test('edit_video dispatches per action and validates inputs', () => {
  const t = getTool('edit_video');
  assert.deepEqual(
    t.buildArgs({ action: 'extract_last_frame', input: '/tmp/a.mp4', output: '/tmp/last.png' }),
    ['--no-update-check', '--extract-last-frame', '/tmp/a.mp4', '/tmp/last.png'],
  );
  assert.deepEqual(
    t.buildArgs({ action: 'concat_videos', clips: ['/a.mp4', '/b.mp4'], output: '/out.mp4', audio_path: '/song.mp3' }),
    ['--no-update-check', '--concat-videos', '/out.mp4', '/a.mp4', '/b.mp4', '--concat-audio', '/song.mp3'],
  );
  assert.deepEqual(
    t.buildArgs({ action: 'remix_audio', input: '/in.mp4', output: '/out.mp4', bed_audio: '/bed.mp3', audio_loop: true }),
    ['--no-update-check', '--remix-audio', '/in.mp4', '/out.mp4', '--bed-audio', '/bed.mp3', '--audio-loop'],
  );
  assert.throws(() => t.buildArgs({ action: 'concat_videos', clips: ['/only-one.mp4'], output: '/o.mp4' }), /two/i);
  assert.throws(() => t.buildArgs({ action: 'nope' }), /action/i);
});

test('manage_personas and manage_memories dispatch per action', () => {
  const p = getTool('manage_personas');
  assert.deepEqual(p.buildArgs({ action: 'list' }), ['--json', '--no-update-check', '--persona-list']);
  assert.deepEqual(
    p.buildArgs({ action: 'add', name: 'Mo', ref: '/tmp/mo.jpg', relationship: 'self' }),
    ['--no-update-check', '--persona-add', 'Mo', '--ref', '/tmp/mo.jpg', '--relationship', 'self'],
  );
  assert.throws(() => p.buildArgs({ action: 'add', name: 'Mo' }), /ref/);
  assert.throws(() => p.buildArgs({ action: 'remove' }), /name/);

  const m = getTool('manage_memories');
  assert.deepEqual(m.buildArgs({ action: 'list' }), ['--json', '--no-update-check', '--memory-list']);
  assert.deepEqual(
    m.buildArgs({ action: 'set', key: 'preferred_style', value: 'watercolor' }),
    ['--no-update-check', '--memory-set', 'preferred_style', 'watercolor'],
  );
  assert.throws(() => m.buildArgs({ action: 'set', key: 'k' }), /value/);
});

test('prompt_guide builds offline prompt-guide argv; the generate tools point at it', () => {
  const tool = getTool('prompt_guide');
  assert.deepEqual(tool.buildArgs({}), ['prompt-guide', '--no-update-check']);
  assert.deepEqual(
    tool.buildArgs({ model: 'seedance2-5', mode: 'i2v' }),
    ['prompt-guide', '--model', 'seedance2-5', '--mode', 'i2v', '--no-update-check'],
  );
  assert.equal(tool.inputSchema.required, undefined);
  for (const name of ['generate_image', 'generate_video']) {
    assert.match(getTool(name).description, /Before writing the prompt, call prompt_guide for the model you chose/);
  }
});

test('doctor, balance, list_media argv', () => {
  assert.deepEqual(getTool('sogni_doctor').buildArgs({}), ['--doctor', '--json', '--no-update-check']);
  assert.deepEqual(getTool('account_balance').buildArgs({}), ['--balances', '--json', '--no-update-check']);
  assert.deepEqual(getTool('list_media').buildArgs({}), ['--json', '--no-update-check', '--list-media', 'images']);
  assert.deepEqual(getTool('list_media').buildArgs({ type: 'audio' }), ['--json', '--no-update-check', '--list-media', 'audio']);
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'desktop-extension', 'server', 'index.mjs');
const FAKE_AGENT = join(HERE, 'fixtures', 'fake-sogni-agent.mjs');

// 1x1 red PNG, 67 bytes — a real decodable PNG for byte-identity assertions.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// Minimal line-delimited JSON-RPC client for driving the server under test.
class McpClient {
  constructor(extraEnv = {}, serverPath = SERVER) {
    this.child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, SOGNI_AGENT_PATH: FAKE_AGENT, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pending = new Map();
    this.notifications = [];
    this.nextId = 1;
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id != null && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        } else {
          this.notifications.push(msg);
        }
      }
    });
  }
  request(method, params) {
    const id = this.nextId++;
    const p = new Promise((resolve) => this.pending.set(id, resolve));
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  }
  raw(text) {
    this.child.stdin.write(text + '\n');
  }
  close() {
    this.child.kill();
  }
}

test('initialize handshake returns serverInfo and tools capability', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  assert.equal(res.result.protocolVersion, '2025-06-18');
  assert.equal(res.result.serverInfo.name, 'sogni-creative-agent');
  assert.ok(res.result.capabilities.tools);
  // The MCPB has no SKILL.md; its world-building guidance travels as instructions.
  assert.match(res.result.instructions, /https:\/\/github\.com\/Sogni-AI\/sogni-worlds-kit/);
  assert.match(res.result.instructions, /node world setup/);
  assert.match(res.result.instructions, /skills\/sogni-worlds\/SKILL\.md/);
  assert.match(res.result.instructions, /H\.264 CRF 23 under a per-tier bitrate cap/);
});

test('standalone MCPB starts outside the checkout with its shared modules', { timeout: 5000 }, async (t) => {
  const staging = tempHome();
  const manifest = stageMcpb(staging);
  const client = new McpClient({}, join(staging, manifest.server.entry_point));
  t.after(() => {
    client.close();
    rmSync(staging, { recursive: true, force: true });
  });
  const initialized = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'goose', version: '1.47.0' },
  });
  assert.equal(initialized.result.serverInfo.version, PACKAGE_VERSION);
  const listed = await client.request('tools/list', {});
  assert.equal(listed.result.tools.length, TOOLS.length);
  const called = await client.request('tools/call', { name: 'sogni_doctor', arguments: {} });
  assert.equal(called.result.isError ?? false, false);
  assert.deepEqual(JSON.parse(called.result.content[0].text).argv, ['--doctor', '--json', '--no-update-check']);
});

test('tools/list returns all registered tools', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('tools/list', {});
  assert.equal(res.result.tools.length, TOOLS.length);
  assert.ok(res.result.tools.every((tool) => tool.name && tool.description && tool.inputSchema));
});

test('tools/call spawns the CLI with built argv and returns its stdout', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('tools/call', {
    name: 'generate_image',
    arguments: { prompt: 'a red fox', quality: 'fast' },
  });
  assert.equal(res.result.isError ?? false, false);
  const echoed = JSON.parse(res.result.content[0].text);
  assert.deepEqual(echoed.argv, ['--json', '-q', '--no-update-check', '-Q', 'fast', '--', 'a red fox']);
});

test('MCP initialize allowlists clientInfo before injecting child attribution', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'openai-codex', version: '0.77.0' },
  });
  const res = await client.request('tools/call', {
    name: 'generate_image',
    arguments: { prompt: 'a red fox' },
  });
  const echoed = JSON.parse(res.result.content[0].text);
  assert.equal(echoed.env.SOGNI_AGENT_FRAMEWORK, 'codex');
  assert.equal(echoed.env.SOGNI_AGENT_FRAMEWORK_VERSION, '0.77.0');
  assert.equal(echoed.env.SOGNI_AGENT_SURFACE, 'mcp');
  assert.equal(echoed.env.SOGNI_AGENT_SURFACE_VERSION, PACKAGE_VERSION);
});

test('MCP never forwards raw unknown clientInfo into child attribution', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'private /Users/alice client', version: 'secret build' },
  });
  const res = await client.request('tools/call', {
    name: 'generate_image',
    arguments: { prompt: 'a red fox' },
  });
  const echoed = JSON.parse(res.result.content[0].text);
  assert.equal(echoed.env.SOGNI_AGENT_FRAMEWORK, 'unknown');
  assert.equal(echoed.env.SOGNI_AGENT_FRAMEWORK_VERSION, null);
  assert.equal(JSON.stringify(echoed.env).includes('alice'), false);
  assert.equal(JSON.stringify(echoed.env).includes('secret'), false);
});

test('oversized success output keeps the head (front-loaded JSON), not the tail', async (t) => {
  // Append 30k pad chars AFTER the JSON line so the CLI output far exceeds the
  // 20k cap; the client must still receive the parseable JSON prefix.
  const client = new McpClient({ FAKE_AGENT_PAD: '30000' });
  t.after(() => client.close());
  const res = await client.request('tools/call', {
    name: 'generate_image',
    arguments: { prompt: 'a red fox', quality: 'fast' },
  });
  assert.equal(res.result.isError ?? false, false);
  const text = res.result.content[0].text;
  assert.equal(text.length, 20000);
  assert.ok(
    text.startsWith('{"argv":["--json","-q","--no-update-check","-Q","fast","--","a red fox"]'),
    'expected the head (result JSON) to survive truncation, not the trailing pad',
  );
});

test('prompt_guide returns the whole guide from the real CLI, past the 20k default cap', { timeout: 20000 }, async (t) => {
  const client = new McpClient({ SOGNI_AGENT_PATH: join(HERE, '..', 'sogni-agent.mjs'), SOGNI_API_KEY: '' });
  t.after(() => client.close());
  const res = await client.request('tools/call', {
    name: 'prompt_guide',
    arguments: { model: 'minimax-h3-r2v-balanced', mode: 'r2v' },
  });
  assert.equal(res.result.isError ?? false, false);
  const text = res.result.content[0].text;
  const rendered = renderModelPromptGuide(MODEL_PROMPT_GUIDES['minimax-h3'].r2v, { audience: 'agent' });
  assert.ok(rendered.length > 20000, 'fixture must exceed the default result cap');
  assert.ok(text.startsWith(`${rendered}\n\n-m minimax-h3-r2v-balanced resolves to `), 'guide was clipped or changed');

  const unknown = await client.request('tools/call', { name: 'prompt_guide', arguments: { model: 'not-a-model' } });
  assert.equal(unknown.result.isError, true);
  assert.match(unknown.result.content[0].text, /No prompt guide for model "not-a-model"/);
});

test('tools/call surfaces CLI failure as isError with stderr included', async (t) => {
  const client = new McpClient({ FAKE_AGENT_EXIT: '3', FAKE_AGENT_STDERR: 'boom: no credentials' });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'sogni_doctor', arguments: {} });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /boom: no credentials/);
});

test('tools/call with invalid input returns isError without spawning', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'photobooth', arguments: { prompt: 'x' } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /ref/);
});

test('tools/call passes input to the CLI as main does, including null and loose values', async (t) => {
  const home = tempHome();
  const client = new McpClient({ HOME: home, USERPROFILE: home, SOGNI_MEDIA_INBOUND_DIR: join(home, 'inbound') });
  t.after(() => { client.close(); rmSync(home, { recursive: true, force: true }); });
  const call = async (name, args) => {
    const res = await client.request('tools/call', { name, arguments: args });
    const text = res.result.content.at(-1).text;
    assert.equal(res.result.isError ?? false, false, `${name} ${JSON.stringify(args)}: ${text}`);
    return text;
  };
  const argv = async (name, args) => JSON.parse((await call(name, args)).split('\n')[0]).argv;
  assert.deepEqual(await argv('account_balance', null), ['--balances', '--json', '--no-update-check']);
  assert.deepEqual(await argv('list_media', null), ['--json', '--no-update-check', '--list-media', 'images']);
  assert.deepEqual(
    await argv('generate_image', { prompt: 'a cat', output_path: '~/Desktop/cat.png', width: '1024', quality: 'HQ', persona: null }),
    ['--json', '-q', '--no-update-check', '-o', join(home, 'Desktop', 'cat.png'), '-Q', 'HQ', '-w', '1024', '--', 'a cat'],
  );
  assert.deepEqual(
    await argv('generate_video', { prompt: null, model: 'seedance2-5', seedance_finalize: 'job-1' }),
    ['--json', '-q', '--no-update-check', '--video', '-m', 'seedance2-5', '--seedance-finalize', 'job-1'],
  );
  assert.deepEqual(
    await argv('edit_video', { action: 'concat_videos', output: join(home, 'inbound', 'joined.webm'), clips: ['/a.mp4', '/b.mp4'], audio_path: '' }),
    ['--no-update-check', '--concat-videos', join(home, 'inbound', 'joined.webm'), '/a.mp4', '/b.mp4'],
  );
  assert.deepEqual(
    await argv('manage_memories', { action: 'set', key: '-k', value: 'v', category: 'style' }),
    ['--no-update-check', '--memory-set', '-k', 'v', '--memory-category', 'style'],
  );
  assert.match(await call('import_media', { data: TINY_PNG.toString('base64'), filename: 'dot.png', append_to_path: null }), /dot\.png/);
});

function realCliEnv(home) {
  return {
    HOME: home, USERPROFILE: home, PATH: process.env.PATH, TMPDIR: tmpdir(),
    SOGNI_API_KEY: '', SOGNI_CREDENTIALS_PATH: join(home, 'no-credentials'),
    SOGNI_PERSONALITY_PATH: join(home, '.config', 'sogni', 'personality.txt'),
    OPENCLAW_CONFIG_PATH: join(home, 'openclaw.json'), OPENCLAW_PLUGIN_CONFIG: '',
  };
}

test('a prompt or media path that looks like an option reaches the real CLI as text', { timeout: 45000 }, async (t) => {
  const oldHome = tempHome();
  const newHome = tempHome();
  t.after(() => {
    rmSync(oldHome, { recursive: true, force: true });
    rmSync(newHome, { recursive: true, force: true });
  });
  const cli = join(HERE, '..', 'sogni-agent.mjs');
  const personalityPath = (home) => realCliEnv(home).SOGNI_PERSONALITY_PATH;
  for (const home of [oldHome, newHome]) {
    mkdirSync(dirname(personalityPath(home)), { recursive: true });
    writeFileSync(personalityPath(home), 'Use a cheerful tone.');
  }
  // Without the separator, the CLI ran the prompt as its own command.
  const old = spawnSync(process.execPath, [cli, '--json', '-q', '--no-update-check', '--personality-clear'], {
    env: realCliEnv(oldHome), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(old.status, 0, old.stderr);
  assert.equal(fsExistsSync(personalityPath(oldHome)), false);

  const client = new McpClient({ ...realCliEnv(newHome), SOGNI_AGENT_PATH: cli });
  t.after(() => client.close());
  for (const prompt of ['--personality-clear', '-5 degrees outside']) {
    const res = await client.request('tools/call', { name: 'generate_image', arguments: { prompt } });
    const text = res.result.content.at(-1).text;
    // No key is configured, so the CLI stops at credentials after reading the prompt.
    assert.equal(res.result.isError, true);
    assert.match(text, /"errorCode":"MISSING_CREDENTIALS"/);
    assert.ok(text.includes(`"prompt":${JSON.stringify(prompt)}`), text);
  }
  // Media paths are flag values, so one that looks like an option is still read as a path.
  for (const [name, args, prompt] of [
    ['generate_speech', { text: '--personality-clear' }, '--personality-clear'],
    ['generate_speech', { text: 'Hello.', mode: 'clone', voice_reference: '--personality-clear' }, 'Hello.'],
    ['generate_speech', { text: 'Hello.', mode: 'clone', voice_reference: '/ref.wav', voice_transcript: '--personality-clear' }, 'Hello.'],
    ['transcribe_audio', { audio: '--personality-clear' }, null],
    ['transcribe_audio', { audio: '/in.wav', hotwords: '--personality-clear' }, null],
    ['upscale_image', { image: '--personality-clear' }, null],
    ['upscale_video', { video: '--personality-clear' }, null],
  ]) {
    const res = await client.request('tools/call', { name, arguments: args });
    const text = res.result.content.at(-1).text;
    assert.equal(res.result.isError, true, name);
    assert.match(text, /"errorCode":"MISSING_CREDENTIALS"/, name);
    assert.ok(text.includes(`"prompt":${JSON.stringify(prompt)}`), text);
  }
  assert.equal(readFileSync(personalityPath(newHome), 'utf8'), 'Use a cheerful tone.');
});

test('concat clip validation leaves personality unchanged with the real CLI', { timeout: 20000 }, async (t) => {
  const oldHome = tempHome();
  const newHome = tempHome();
  t.after(() => {
    rmSync(oldHome, { recursive: true, force: true });
    rmSync(newHome, { recursive: true, force: true });
  });
  const cli = join(HERE, '..', 'sogni-agent.mjs');
  const clips = ['/a.mp4', '/b.mp4', '--personality-set', 'Use a cheerful tone.'];
  const personalityPath = (home) => realCliEnv(home).SOGNI_PERSONALITY_PATH;
  const old = spawnSync(process.execPath, [cli, '--no-update-check', '--concat-videos', join(oldHome, 'out.mp4'), ...clips], {
    env: realCliEnv(oldHome), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(old.status, 0, old.stderr);
  assert.equal(readFileSync(personalityPath(oldHome), 'utf8'), 'Use a cheerful tone.');

  const input = { action: 'concat_videos', output: join(newHome, 'out.mp4'), clips };
  assert.throws(() => getTool('edit_video').buildArgs(input), { message: 'clip paths cannot start with "-".' });
  const client = new McpClient({ ...realCliEnv(newHome), SOGNI_AGENT_PATH: cli });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'edit_video', arguments: input });
  assert.equal(res.result.isError, true);
  assert.equal(res.result.content[0].text, 'clip paths cannot start with "-".');
  assert.equal(fsExistsSync(personalityPath(newHome)), false);
});

test('list_media refuses a type the CLI would read as an option, with the real CLI', { timeout: 20000 }, async (t) => {
  const oldHome = tempHome();
  const newHome = tempHome();
  t.after(() => {
    rmSync(oldHome, { recursive: true, force: true });
    rmSync(newHome, { recursive: true, force: true });
  });
  const cli = join(HERE, '..', 'sogni-agent.mjs');
  const personalityPath = (home) => realCliEnv(home).SOGNI_PERSONALITY_PATH;
  for (const home of [oldHome, newHome]) {
    mkdirSync(dirname(personalityPath(home)), { recursive: true });
    writeFileSync(personalityPath(home), 'Use a cheerful tone.');
  }
  // The argv main built for this type: --list-media skips it, so the CLI ran it as a command.
  const old = spawnSync(process.execPath, [cli, '--json', '--no-update-check', '--list-media', '--personality-clear'], {
    env: realCliEnv(oldHome), cwd: oldHome, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(old.status, 0, old.stderr);
  assert.equal(fsExistsSync(personalityPath(oldHome)), false);

  for (const type of ['--personality-clear', '-x', ['--personality-clear']]) {
    assert.throws(() => getTool('list_media').buildArgs({ type }), { message: 'type cannot start with "-".' });
  }
  const client = new McpClient({ ...realCliEnv(newHome), SOGNI_AGENT_PATH: cli, SOGNI_MEDIA_INBOUND_DIR: join(newHome, 'inbound') });
  t.after(() => client.close());
  const refused = await client.request('tools/call', { name: 'list_media', arguments: { type: '--personality-clear' } });
  assert.equal(refused.result.isError, true);
  assert.equal(refused.result.content[0].text, 'type cannot start with "-".');
  // Every type main accepted still runs: known ones, and any other word, which lists images.
  for (const [type, mediaType] of [[undefined, 'images'], ['audio', 'audio'], ['all', 'all'], ['videos', 'images'], ['', 'images']]) {
    const res = await client.request('tools/call', { name: 'list_media', arguments: type === undefined ? {} : { type } });
    assert.equal(res.result.isError ?? false, false, String(type));
    assert.equal(JSON.parse(res.result.content[0].text).mediaType, mediaType, String(type));
  }
  assert.equal(readFileSync(personalityPath(newHome), 'utf8'), 'Use a cheerful tone.');
});

// Every value a tool call carries, put where the CLI might read an option:
// one field at a time, every action, through the real CLI. Each value reaches
// the CLI as text (or is refused), so the saved personality never changes.
test('no tool input reaches the real CLI as an option', { timeout: 240000 }, async (t) => {
  const home = tempHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const cli = join(HERE, '..', 'sogni-agent.mjs');
  const SENTINEL = '--personality-clear';
  // Each run gets a personality file of its own, so runs can overlap.
  let runs = 0;
  const runCli = (args) => new Promise((resolveRun) => {
    const env = { ...realCliEnv(home), SOGNI_MEDIA_INBOUND_DIR: join(home, 'inbound') };
    env.SOGNI_PERSONALITY_PATH = join(home, 'personality', `${runs++}.txt`);
    mkdirSync(dirname(env.SOGNI_PERSONALITY_PATH), { recursive: true });
    writeFileSync(env.SOGNI_PERSONALITY_PATH, 'Use a cheerful tone.');
    const child = spawn(process.execPath, [cli, ...args], { env, cwd: home, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('close', () => {
      clearTimeout(timer);
      const path = env.SOGNI_PERSONALITY_PATH;
      resolveRun(fsExistsSync(path) && readFileSync(path, 'utf8') === 'Use a cheerful tone.');
    });
  });
  // The probe can see an option: the argv main built for list_media clears it.
  assert.equal(await runCli(['--json', '--no-update-check', '--list-media', SENTINEL]), false);

  const cases = [];
  for (const tool of TOOLS.filter((candidate) => typeof candidate.buildArgs === 'function')) {
    const properties = tool.inputSchema.properties ?? {};
    const valid = Object.fromEntries(Object.entries(properties).map(([key, schema]) => [key, sampleValue(key, schema)]));
    const required = Object.fromEntries((tool.inputSchema.required ?? []).map((key) => [key, valid[key]]));
    for (const action of properties.action?.enum ?? [undefined]) {
      const base = action ? { ...valid, action } : required;
      for (const [key, schema] of Object.entries(properties)) {
        if (key === 'action') continue;
        let value = SENTINEL;
        if (schema.type === 'array' && schema.items?.type === 'object') value = [{ ...valid[key][0], image: SENTINEL }];
        else if (schema.type === 'array') value = ['/first', SENTINEL];
        cases.push({ name: `${tool.name}${action ? `:${action}` : ''}.${key}`, tool, input: { ...base, [key]: value } });
      }
    }
  }
  assert.ok(cases.length > 100, `only ${cases.length} probes`);
  const leaked = [];
  const queue = [...cases];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      let args;
      try {
        args = next.tool.buildArgs(next.input);
      } catch {
        continue; // refused before the CLI runs
      }
      if (!(await runCli(args))) leaked.push(next.name);
    }
  }));
  assert.deepEqual(leaked.sort(), []);
});

test('output paths must land in an allowed folder', () => {
  const home = tempHome();
  const project = join(home, 'code', 'site');
  mkdirSync(project, { recursive: true });
  const context = { env: { SOGNI_MEDIA_INBOUND_DIR: join(home, 'inbound') }, home, cwd: project, temp: join(home, 'tmp') };
  for (const [path, expected] of [
    ['~/Desktop/render.png', join(home, 'Desktop', 'render.png')],
    [join(home, 'Downloads', 'new', 'clip.mp4'), join(home, 'Downloads', 'new', 'clip.mp4')],
    ['~/Documents/.drafts/take.mp3', join(home, 'Documents', '.drafts', 'take.mp3')],
    [join(home, 'inbound', 'joined.webm'), join(home, 'inbound', 'joined.webm')],
    [join(home, 'tmp', 'a.png'), join(home, 'tmp', 'a.png')],
    ['public/hero.png', join(project, 'public', 'hero.png')],
    ['render', join(project, 'render')],
  ]) {
    assert.equal(checkOutputPath(path, 'output_path', context), expected, path);
  }
  for (const path of [
    '~/.zshrc', '~/.ssh/authorized_keys', '~/Library/LaunchAgents/a.plist', '/etc/hosts.png', '~/render.png',
    '~/Desktop', '~/Desktop/../.bashrc', join(home, 'code', 'other', 'x.png'),
  ]) {
    assert.throws(() => checkOutputPath(path, 'output_path', context), (error) => {
      assert.equal(error.code, 'OUTPUT_PATH_REFUSED');
      assert.match(error.message, /^output_path must be inside one of these folders: .*Desktop.*SOGNI_MCP_OUTPUT_DIR/);
      return true;
    }, path);
  }
  for (const value of [42, ['~/Desktop/a.png'], { path: '~/Desktop/a.png' }]) {
    assert.throws(() => checkOutputPath(value, 'output', context), { message: 'output must be a file path.' });
  }
  // SOGNI_MCP_OUTPUT_DIR adds folders, separated like PATH.
  const extra = { ...context, env: { ...context.env, SOGNI_MCP_OUTPUT_DIR: [join(home, 'renders'), '~/code/other'].join(delimiter) } };
  assert.equal(checkOutputPath('~/renders/a.png', 'output_path', extra), join(home, 'renders', 'a.png'));
  assert.equal(checkOutputPath('~/code/other/x.png', 'output_path', extra), join(home, 'code', 'other', 'x.png'));
});

test('the server folder counts only when it is a project folder of its own', () => {
  const home = tempHome();
  const dirs = (cwd) => allowedOutputDirs({ env: {}, home, cwd, temp: join(home, 'tmp') });
  for (const cwd of ['/', home, join(home, '.config', 'app'), join(home, 'Library', 'Application Support'), join(home, 'AppData', 'Local', 'App')]) {
    assert.equal(dirs(cwd).includes(cwd), false, cwd);
  }
  assert.ok(dirs(join(home, 'code', 'site')).includes(join(home, 'code', 'site')));
});

test('output paths never replace an existing file or follow a link out', () => {
  const home = tempHome();
  const desktop = join(home, 'Desktop');
  mkdirSync(desktop, { recursive: true });
  const context = { env: {}, home, cwd: '/', temp: join(home, 'tmp') };
  writeFileSync(join(desktop, 'cat.png'), 'old');
  assert.throws(() => checkOutputPath('~/Desktop/cat.png', 'output_path', context), {
    message: `output_path would replace ${join(desktop, 'cat.png')}, which already exists. Choose a new file name.`,
  });
  assert.equal(readFileSync(join(desktop, 'cat.png'), 'utf8'), 'old');
  // return_last_frame also writes <name>-last-frame.<ext> beside the video.
  writeFileSync(join(desktop, 'clip-last-frame.jpg'), 'old');
  assert.equal(checkOutputPath('~/Desktop/clip.mp4', 'output_path', context), join(desktop, 'clip.mp4'));
  assert.throws(() => checkOutputPath('~/Desktop/clip.mp4', 'output_path', { ...context, siblings: lastFrameSiblings }), /clip-last-frame\.jpg, which already exists/);
  // A link inside an allowed folder cannot carry the write elsewhere.
  mkdirSync(join(home, '.ssh'));
  symlinkSync(join(home, '.ssh'), join(desktop, 'keys'));
  assert.throws(() => checkOutputPath('~/Desktop/keys/authorized_keys', 'output_path', context), /must be inside one of these folders/);
  symlinkSync(join(home, '.zshrc'), join(desktop, 'dangling.png'));
  assert.throws(() => checkOutputPath('~/Desktop/dangling.png', 'output_path', context), /already exists|must be inside/);
});

test('tools/call checks every output field before the CLI runs', async (t) => {
  const home = tempHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  // The test home sits in the run's temp folder, so the server gets a temp folder of its own.
  const client = new McpClient({
    HOME: home, USERPROFILE: home, TMPDIR: join(home, 'tmp'), TMP: join(home, 'tmp'), TEMP: join(home, 'tmp'),
    SOGNI_MEDIA_INBOUND_DIR: join(home, 'inbound'),
  });
  t.after(() => client.close());
  mkdirSync(join(home, 'Movies'), { recursive: true });
  writeFileSync(join(home, 'Movies', 'taken.mp4'), 'old');
  const outputCalls = [
    ['generate_image', { prompt: 'a duck' }, 'output_path'],
    ['generate_video', { prompt: 'a duck' }, 'output_path'],
    ['generate_music', { prompt: 'soft piano' }, 'output_path'],
    ['photobooth', { prompt: 'a portrait', ref: '/face.jpg' }, 'output_path'],
    ['edit_video', { action: 'extract_first_frame', input: '/in.mp4' }, 'output'],
    ['edit_video', { action: 'extract_last_frame', input: '/in.mp4' }, 'output'],
    ['edit_video', { action: 'concat_videos', clips: ['/a.mp4', '/b.mp4'] }, 'output'],
    ['edit_video', { action: 'remix_audio', input: '/in.mp4' }, 'output'],
    ['upscale_image', { image: '/in.png' }, 'output_path'],
    ['upscale_video', { video: '/in.mp4' }, 'output_path'],
    ['generate_speech', { text: 'Hello.' }, 'output_path'],
    ['transcribe_audio', { audio: '/in.wav' }, 'output_path'],
  ];
  for (const [name, input, field] of outputCalls) {
    for (const [path, pattern] of [['~/.zshrc', /must be inside one of these folders/], ['~/Movies/taken.mp4', /already exists/]]) {
      const res = await client.request('tools/call', { name, arguments: { ...input, [field]: path } });
      assert.equal(res.result.isError, true, `${name} ${path}`);
      assert.match(res.result.content[0].text, new RegExp(`^${field} `), name);
      assert.match(res.result.content[0].text, pattern, name);
    }
    const res = await client.request('tools/call', { name, arguments: { ...input, [field]: '~/Movies/new.mp4' } });
    assert.equal(res.result.isError ?? false, false, name);
    assert.ok(JSON.parse(res.result.content[0].text).argv.includes(join(home, 'Movies', 'new.mp4')), name);
  }
  writeFileSync(join(home, 'Movies', 'clip-last-frame.png'), 'old');
  const lastFrame = await client.request('tools/call', {
    name: 'generate_video', arguments: { prompt: 'a duck', return_last_frame: true, output_path: '~/Movies/clip.mp4' },
  });
  assert.equal(lastFrame.result.isError, true);
  assert.match(lastFrame.result.content[0].text, /clip-last-frame\.png, which already exists/);
});

test('tools/call ignores fields outside the schema', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('tools/call', {
    name: 'generate_video', arguments: { prompt: '-5 degrees outside', extra: { arbitrary: true }, keyframes: [{ image: '/a.png', at_seconds: 2, extra: '--help' }] },
  });
  assert.equal(res.result.isError, false);
  assert.deepEqual(JSON.parse(res.result.content[0].text).argv, [
    '--json', '-q', '--no-update-check', '--video', '--keyframe', '/a.png@2', '--', '-5 degrees outside',
  ]);
});

test('missing CLI yields a setup hint, not a crash', async (t) => {
  const client = new McpClient({ SOGNI_AGENT_PATH: '/nonexistent/sogni-agent.mjs' });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'account_balance', arguments: {} });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /setup-sogni-agent-skill/);
});

test('unknown method returns -32601; parse error returns -32700', async (t) => {
  const client = new McpClient();
  t.after(() => client.close());
  const res = await client.request('bogus/method', {});
  assert.equal(res.error.code, -32601);
  client.raw('{not json');
  await new Promise((r) => setTimeout(r, 200));
  const parseErr = client.notifications.find((m) => m.error?.code === -32700);
  assert.ok(parseErr, 'expected a -32700 response');
});

test('manifest.json version matches package.json and entry point exists', () => {
  const root = join(HERE, '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'desktop-extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.server.type, 'node');
  assert.ok(fsExistsSync(join(root, 'desktop-extension', manifest.server.entry_point)));
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.mjs']);
  assert.ok(pkg.files.includes('desktop-extension/'));
  assert.equal(pkg.bin['sogni-agent-mcp'], 'desktop-extension/server/index.mjs');
});

test('collectInlineImages: localPath descriptor yields one PNG block', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const img = join(dir, 'out.png');
  writeFileSync(img, TINY_PNG);
  const stdout = JSON.stringify({ type: 'image', localPath: img, urls: [] });
  const { blocks, notes } = await collectInlineImages({ toolName: 'generate_image', input: {}, stdout, env: {} });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'image');
  assert.equal(blocks[0].mimeType, 'image/png');
  assert.ok(Buffer.from(blocks[0].data, 'base64').equals(TINY_PNG));
  assert.deepEqual(notes, []);
});

test('collectInlineImages: public urls descriptor fetches bytes', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(TINY_PNG);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://assets.example/img.png';
  try {
    const stdout = JSON.stringify({ type: 'image', localPath: null, urls: [url] });
    const { blocks } = await collectInlineImages({ toolName: 'photobooth', input: {}, stdout, env: {}, requestImpl: previewRequestTo(server) });
    assert.equal(blocks.length, 1);
    assert.ok(Buffer.from(blocks[0].data, 'base64').equals(TINY_PNG));
    assert.equal(blocks[0].mimeType, 'image/png');
  } finally {
    server.close();
  }
});

test('collectInlineImages: caps inline images at 4', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const img = join(dir, 'a.png');
  writeFileSync(img, TINY_PNG);
  // 6 urls, all file-backed via localPath being absent — use a local http server for realism-lite:
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(TINY_PNG); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://assets.example';
  try {
    const urls = Array.from({ length: 6 }, (_, i) => `${base}/${i}.png`);
    const { blocks } = await collectInlineImages({ toolName: 'generate_image', input: {}, stdout: JSON.stringify({ urls }), env: {}, requestImpl: previewRequestTo(server) });
    assert.equal(blocks.length, 4);
  } finally {
    server.close();
  }
});

test('collectInlineImages: out-of-scope tools and opt-out env return nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const img = join(dir, 'out.png');
  writeFileSync(img, TINY_PNG);
  const stdout = JSON.stringify({ localPath: img });
  const video = await collectInlineImages({ toolName: 'generate_video', input: {}, stdout, env: {} });
  assert.deepEqual(video, { blocks: [], notes: [] });
  const optOut = await collectInlineImages({
    toolName: 'generate_image', input: {}, stdout, env: { SOGNI_MCP_NO_INLINE_IMAGES: '1' },
  });
  assert.deepEqual(optOut, { blocks: [], notes: [] });
});

test('collectInlineImages: edit_video frame extraction reads the output path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const frame = join(dir, 'frame.jpg');
  writeFileSync(frame, TINY_PNG); // bytes don't need to be real JPEG for sourcing
  const { blocks } = await collectInlineImages({
    toolName: 'edit_video',
    input: { action: 'extract_last_frame', input: '/x.mp4', output: frame },
    stdout: 'non-json wrapper output',
    env: {},
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].mimeType, 'image/jpeg');
  const concat = await collectInlineImages({
    toolName: 'edit_video', input: { action: 'concat_videos', clips: ['/a.mp4','/b.mp4'], output: '/o.mp4' },
    stdout: '', env: {},
  });
  assert.deepEqual(concat, { blocks: [], notes: [] });
});

test('collectInlineImages: unparseable stdout and unreadable files degrade silently', async () => {
  const garbage = await collectInlineImages({ toolName: 'generate_image', input: {}, stdout: 'not json at all', env: {} });
  assert.deepEqual(garbage, { blocks: [], notes: [] });
  const missing = await collectInlineImages({
    toolName: 'generate_image', input: {}, stdout: JSON.stringify({ localPath: '/nonexistent/nope.png' }), env: {},
  });
  assert.deepEqual(missing, { blocks: [], notes: [] });
});

test('collectInlineImages: oversize non-image bytes are skipped with a note', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const big = join(dir, 'big.png');
  writeFileSync(big, Buffer.alloc(900 * 1024, 7)); // >700KB budget, not a real PNG → ladder fails → skip
  const { blocks, notes } = await collectInlineImages({
    toolName: 'generate_image', input: {}, stdout: JSON.stringify({ localPath: big }), env: {},
  });
  assert.equal(blocks.length, 0);
  assert.deepEqual(notes, ['One image was too large to display inline; use the link above.']);
});

test('collectInlineImages: oversize real image is downscaled through the ladder under budget', async () => {
  const { default: sharp } = await import('sharp');
  // Random noise barely compresses, so this PNG is several MB — well over budget.
  const noise = Buffer.from(Array.from({ length: 1400 * 1400 * 3 }, () => Math.floor(Math.random() * 256)));
  const bigPng = await sharp(noise, { raw: { width: 1400, height: 1400, channels: 3 } }).png().toBuffer();
  assert.ok(bigPng.length > 700 * 1024); // guard the premise: fixture must exceed the budget
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-'));
  const big = join(dir, 'big.png');
  writeFileSync(big, bigPng);
  const { blocks, notes } = await collectInlineImages({
    toolName: 'generate_image', input: {}, stdout: JSON.stringify({ localPath: big }), env: {},
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].mimeType, 'image/jpeg');
  assert.ok(Buffer.from(blocks[0].data, 'base64').length <= 700 * 1024);
  assert.deepEqual(notes, []);
});

test('collectInlineImages: cumulative budget attaches the first image and skips the second', async () => {
  const { createServer } = await import('node:http');
  const payload = Buffer.alloc(500 * 1024, 7); // 500KB apiece, garbage bytes served as PNG
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(payload); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://assets.example';
  try {
    const urls = [`${base}/a.png`, `${base}/b.png`];
    const { blocks, notes } = await collectInlineImages({
      toolName: 'generate_image', input: {}, stdout: JSON.stringify({ urls }), env: {}, budgetRaw: 700 * 1024,
      requestImpl: previewRequestTo(server),
    });
    // First fits (500KB ≤ 700KB) as-is; second (500KB > 200KB remaining, garbage → ladder fails) is skipped.
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].mimeType, 'image/png');
    assert.deepEqual(notes, ['One image was too large to display inline; use the link above.']);
  } finally {
    server.close();
  }
});

test('collectInlineImages: stalled URL fetch aborts on fetchTimeoutMs and degrades silently', async () => {
  const { createServer } = await import('node:http');
  const server = createServer(() => {}); // never responds — simulates a stalling CDN
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://assets.example/stall.png';
  try {
    const result = await collectInlineImages({
      toolName: 'generate_image',
      input: {},
      stdout: JSON.stringify({ type: 'image', localPath: null, urls: [url] }),
      env: {},
      fetchTimeoutMs: 100,
      requestImpl: previewRequestTo(server),
    });
    assert.deepEqual(result, { blocks: [], notes: [] });
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('tools/call generate_image returns inline image block ahead of text', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-proto-'));
  const img = join(dir, 'render.png');
  writeFileSync(img, TINY_PNG);
  const stdoutFile = join(dir, 'stdout.json');
  writeFileSync(stdoutFile, JSON.stringify({ type: 'image', localPath: img, urls: ['https://example.invalid/x.png'] }) + '\n');
  const client = new McpClient({ FAKE_AGENT_STDOUT_FILE: stdoutFile });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'generate_image', arguments: { prompt: 'a red pixel' } });
  assert.equal(res.result.isError ?? false, false);
  assert.equal(res.result.content.length, 2);
  assert.equal(res.result.content[0].type, 'image');
  assert.equal(res.result.content[0].mimeType, 'image/png');
  assert.ok(Buffer.from(res.result.content[0].data, 'base64').equals(TINY_PNG));
  assert.equal(res.result.content[1].type, 'text');
  assert.match(res.result.content[1].text, /localPath/);
});

test('tools/call inline opt-out env yields text-only', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-proto-'));
  const img = join(dir, 'render.png');
  writeFileSync(img, TINY_PNG);
  const stdoutFile = join(dir, 'stdout.json');
  writeFileSync(stdoutFile, JSON.stringify({ localPath: img }) + '\n');
  const client = new McpClient({ FAKE_AGENT_STDOUT_FILE: stdoutFile, SOGNI_MCP_NO_INLINE_IMAGES: '1' });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'generate_image', arguments: { prompt: 'x' } });
  assert.equal(res.result.content.length, 1);
  assert.equal(res.result.content[0].type, 'text');
});

test('tools/call failing CLI never attaches images', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-proto-'));
  const img = join(dir, 'render.png');
  writeFileSync(img, TINY_PNG);
  const stdoutFile = join(dir, 'stdout.json');
  writeFileSync(stdoutFile, JSON.stringify({ localPath: img }) + '\n');
  const client = new McpClient({ FAKE_AGENT_STDOUT_FILE: stdoutFile, FAKE_AGENT_EXIT: '2', FAKE_AGENT_STDERR: 'boom' });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'generate_image', arguments: { prompt: 'x' } });
  assert.equal(res.result.isError, true);
  assert.equal(res.result.content.length, 1);
  assert.equal(res.result.content[0].type, 'text');
});

test('tools/call generate_video stays text-only', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-proto-'));
  const stdoutFile = join(dir, 'stdout.json');
  writeFileSync(stdoutFile, JSON.stringify({ type: 'video', localPath: null, urls: ['https://example.invalid/v.mp4'] }) + '\n');
  const client = new McpClient({ FAKE_AGENT_STDOUT_FILE: stdoutFile });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'generate_video', arguments: { prompt: 'x' } });
  assert.equal(res.result.content.length, 1);
  assert.equal(res.result.content[0].type, 'text');
});

test('tools/call upscale_image attaches its image inline; upscale_video and generate_speech stay text-only', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-inline-proto-'));
  const img = join(dir, 'upscaled.png');
  writeFileSync(img, TINY_PNG);
  const stdoutFile = join(dir, 'stdout.json');
  // Every tool gets the same readable image result, so only the tool decides whether it is attached.
  writeFileSync(stdoutFile, JSON.stringify({ success: true, type: 'image', localPath: img, urls: [] }) + '\n');
  const client = new McpClient({ FAKE_AGENT_STDOUT_FILE: stdoutFile });
  t.after(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const upscaled = await client.request('tools/call', { name: 'upscale_image', arguments: { image: '/in.png' } });
  assert.deepEqual(upscaled.result.content.map((block) => block.type), ['image', 'text']);
  assert.ok(Buffer.from(upscaled.result.content[0].data, 'base64').equals(TINY_PNG));
  for (const [name, args] of [['upscale_video', { video: '/in.mp4' }], ['generate_speech', { text: 'Hello.' }], ['transcribe_audio', { audio: '/in.wav' }]]) {
    const res = await client.request('tools/call', { name, arguments: args });
    assert.deepEqual(res.result.content.map((block) => block.type), ['text'], name);
  }
});

test('importMedia writes decoded base64 into the inbound dir and returns path + bytes', async () => {
  const dir = join(tempHome(), 'inbound'); // does not exist yet — must be created
  const result = await importMedia(
    { data: TINY_PNG.toString('base64'), filename: 'pixel.png' },
    { env: { SOGNI_MEDIA_INBOUND_DIR: dir } },
  );
  assert.equal(result.path, join(dir, 'pixel.png'));
  assert.equal(result.bytes, TINY_PNG.length);
  assert.ok(readFileSync(result.path).equals(TINY_PNG));
});

test('importMedia sanitizes traversal filenames to their basename', async () => {
  const dir = join(tempHome(), 'inbound');
  const result = await importMedia(
    { data: TINY_PNG.toString('base64'), filename: '../../evil.png' },
    { env: { SOGNI_MEDIA_INBOUND_DIR: dir } },
  );
  assert.equal(result.path, join(dir, 'evil.png'));
});

test('importMedia never overwrites an existing file — it suffixes the name', async () => {
  const dir = join(tempHome(), 'inbound');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pixel.png'), Buffer.from('original'));
  const result = await importMedia(
    { data: TINY_PNG.toString('base64'), filename: 'pixel.png' },
    { env: { SOGNI_MEDIA_INBOUND_DIR: dir } },
  );
  assert.equal(result.path, join(dir, 'pixel-2.png'));
  assert.equal(readFileSync(join(dir, 'pixel.png'), 'utf8'), 'original');
  assert.ok(readFileSync(result.path).equals(TINY_PNG));
});

test('importMedia appends subsequent chunks via append_to_path', async () => {
  const dir = join(tempHome(), 'inbound');
  const env = { SOGNI_MEDIA_INBOUND_DIR: dir };
  const first = await importMedia(
    { data: TINY_PNG.subarray(0, 40).toString('base64'), filename: 'chunked.png' },
    { env },
  );
  const second = await importMedia(
    { data: TINY_PNG.subarray(40).toString('base64'), append_to_path: first.path },
    { env },
  );
  assert.equal(second.path, first.path);
  assert.equal(second.bytes, TINY_PNG.length);
  assert.ok(readFileSync(second.path).equals(TINY_PNG));
});

test('importMedia rejects append targets outside the inbound dir', async () => {
  const home = tempHome();
  const dir = join(home, 'inbound');
  const outside = join(home, 'elsewhere', 'x.png');
  mkdirSync(dirname(outside), { recursive: true });
  writeFileSync(outside, 'x');
  await assert.rejects(
    importMedia({ data: TINY_PNG.toString('base64'), append_to_path: outside }, { env: { SOGNI_MEDIA_INBOUND_DIR: dir } }),
    /inbox/i,
  );
});

test('importMedia rejects appends to a file that does not exist', async () => {
  const dir = join(tempHome(), 'inbound');
  mkdirSync(dir, { recursive: true });
  await assert.rejects(
    importMedia(
      { data: TINY_PNG.toString('base64'), append_to_path: join(dir, 'never-started.png') },
      { env: { SOGNI_MEDIA_INBOUND_DIR: dir } },
    ),
    /filename/i,
  );
});

test('importMedia validates required fields, extension, and base64', async () => {
  const env = { SOGNI_MEDIA_INBOUND_DIR: join(tempHome(), 'inbound') };
  await assert.rejects(importMedia({ filename: 'a.png' }, { env }), /data/);
  await assert.rejects(importMedia({ data: TINY_PNG.toString('base64') }, { env }), /filename/);
  await assert.rejects(importMedia({ data: TINY_PNG.toString('base64'), filename: 'run.sh' }, { env }), /extension/i);
  await assert.rejects(importMedia({ data: 'not base64!!', filename: 'a.png' }, { env }), /base64/i);
});

test('importMedia enforces per-chunk and total-size caps', async () => {
  const dir = join(tempHome(), 'inbound');
  const env = { SOGNI_MEDIA_INBOUND_DIR: dir };
  await assert.rejects(
    importMedia({ data: TINY_PNG.toString('base64'), filename: 'big.png' }, { env, maxChunkBytes: 16 }),
    /chunk/i,
  );
  const first = await importMedia({ data: TINY_PNG.toString('base64'), filename: 'total.png' }, { env, maxTotalBytes: 100 });
  await assert.rejects(
    importMedia({ data: TINY_PNG.toString('base64'), append_to_path: first.path }, { env, maxTotalBytes: 100 }),
    /total|exceed/i,
  );
});

test('media-consuming tools warn about chat attachments and point at import_media', () => {
  for (const name of ['generate_image', 'generate_video', 'photobooth', 'manage_personas', 'upscale_image', 'upscale_video', 'generate_speech', 'transcribe_audio']) {
    const { description } = getTool(name);
    assert.match(description, /chat/i, `${name} should mention chat attachments`);
    assert.match(description, /import_media/, `${name} should point at import_media`);
  }
  const listMedia = getTool('list_media').description;
  assert.match(listMedia, /messaging|inbox/i);
  assert.match(listMedia, /import_media/);
  assert.match(getTool('import_media').description, /base64/i);
});

test('tools/call import_media saves the file locally even when the CLI is missing', async (t) => {
  const inbound = join(tempHome(), 'inbound');
  const client = new McpClient({
    SOGNI_AGENT_PATH: '/nonexistent/sogni-agent.mjs',
    SOGNI_MEDIA_INBOUND_DIR: inbound,
  });
  t.after(() => client.close());
  const res = await client.request('tools/call', {
    name: 'import_media',
    arguments: { data: TINY_PNG.toString('base64'), filename: 'chat-upload.png' },
  });
  assert.equal(res.result.isError ?? false, false);
  const parsed = JSON.parse(res.result.content[0].text);
  assert.equal(parsed.path, join(inbound, 'chat-upload.png'));
  assert.equal(parsed.bytes, TINY_PNG.length);
  assert.ok(readFileSync(parsed.path).equals(TINY_PNG));
});

test('tools/call import_media surfaces validation failures as isError', async (t) => {
  const client = new McpClient({ SOGNI_MEDIA_INBOUND_DIR: join(tempHome(), 'inbound') });
  t.after(() => client.close());
  const res = await client.request('tools/call', { name: 'import_media', arguments: { filename: 'a.png' } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /data/);
});

test('the safety kill outlasts the CLI wait for a render on Relaxed', async () => {
  const { hardKillTimeoutMs } = await import('../desktop-extension/server/tools.mjs');
  // The CLI waits at least 30 minutes on Relaxed, then reports the project id.
  // A kill before that would lose the id, so every render tool has to allow more.
  for (const name of ['generate_image', 'generate_video', 'generate_music', 'photobooth', 'upscale_image', 'upscale_video', 'generate_speech', 'transcribe_audio']) {
    assert.ok(hardKillTimeoutMs(name, {}) > 30 * 60 * 1000, `${name} would be killed first`);
  }
  // A longer explicit wait still gets a margin past it.
  assert.equal(hardKillTimeoutMs('generate_video', { timeout_seconds: 7200 }), (7200 + 60) * 1000);
});
