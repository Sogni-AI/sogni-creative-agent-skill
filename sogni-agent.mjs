#!/usr/bin/env node
/**
 * sogni-agent - Generate images, videos, and music using Sogni AI
 * Usage: sogni-agent [options] "prompt"
 */

// Must be first: a zero-dependency Node.js version guard that runs before
// `sharp` / the Sogni SDK load, so an unsupported Node prints a clear message
// instead of a cryptic native/ESM crash.
import './node-version-check.mjs';
import JSON5 from 'json5';
import { createHash, randomBytes } from 'crypto';
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, statSync, readdirSync, realpathSync, lstatSync, unlinkSync, rmdirSync, rmSync } from 'fs';
import { join, dirname, basename, extname, sep, resolve } from 'path';
import { homedir, tmpdir } from 'os';
import sharp from 'sharp';
import { getEnv, hasEnv } from './env.mjs';
import { PACKAGE_VERSION } from './version.mjs';
import { assertSafeUrl, fetchSafeUrl } from './ssrf-guard.mjs';
import {
  INTERNAL_FLAG as UPDATE_CHECK_INTERNAL_FLAG,
  runForegroundCheck as runUpdateCheckForeground,
  maybeSpawnBackgroundCheck as maybeSpawnUpdateCheck,
  getQueuedNotice as getUpdateCheckNotice,
  runSelfUpdate as runSogniSelfUpdate,
  snoozeUpdate as snoozeSogniUpdate,
  runWhatsNew as runSogniWhatsNew,
  readState as readUpdateCheckState,
  compareSemver as compareSogniSemver,
} from './update-check.mjs';
import { fileURLToPath } from 'url';
import {
  LTX23_WORKFLOW_MODELS,
  PUBLIC_SKILL_DEFAULT_TOOL_DEFINITIONS,
  PUBLIC_SKILL_DEFAULT_TOOL_NAMES,
  QUALITY_TIERS,
  SEEDANCE_V2V_REFERENCE_MAX_DURATION_SECONDS,
  VIDEO_WORKFLOW_DEFAULT_MODELS,
  buildStoryboardProject,
  buildStoryboardVideoHostedToolSequenceInput,
  classifyPublicSkillTurn,
  classifySkillError,
  compileForModel,
  compilePublicSkillToolSurface,
  composeAdapterPromptGuidance,
  createPublicSkillDefaultContractRuntime,
  detectReferenceAudioFormat,
  dimensionsForAspectRatio,
  dimensionsWithShortSide,
  dispatchPublicSkillToolCall,
  getModelDefaults,
  getVideoPromptGuardrailPlan,
  inferVideoWorkflowFromAssets,
  inferVideoWorkflowFromModel,
  isLtx2Model,
  isSeedanceModel,
  isSeedanceModelSelection,
  normalizeReferenceAudioMimeType,
  normalizeVideoWorkflow,
  planCliVideoBrain,
  resolveVideoControlNetStrength,
  resolveVideoModelAlias,
  resolveVideoSteps,
  sanitizeMessagesForLlm,
  sanitizeBatchPrompt,
  selectDefaultVideoModel,
  shouldTrimSeedanceV2VSourceVideo,
  workflowRequiresImage
} from '@sogni-ai/sogni-intelligence-client/public-skill-runtime';
import {
  redactPayload,
  redactRunRecord
} from '@sogni-ai/sogni-intelligence-client/replay';
import {
  extractToolCallProgressUpdate
} from '@sogni-ai/sogni-intelligence-client/chatRun';
import {
  SEEDANCE_R2V_REFERENCE_AUDIO_MAX_DURATION_SECONDS,
  prepareSeedanceV2VSourceVideo as prepareSharedSeedanceV2VSourceVideo
} from '@sogni-ai/sogni-intelligence-client/media';
import {
  SEEDANCE_REFERENCE_LIMITS,
  SeedanceReferenceLimitError,
  seedanceTerminalGenerationFailurePayloadFromError,
  seedanceTerminalPolicyPayloadFromError,
  validateSeedanceReferenceCounts
} from '@sogni-ai/sogni-intelligence-client/tools';

const SPARK_PACKS_PURCHASE_URL = 'https://docs.sogni.ai/pricing/#spark-packs';
const SPARK_PACKS_PURCHASE_HINT = `Buy Spark Packs to continue: ${SPARK_PACKS_PURCHASE_URL}`;

const require = createRequire(import.meta.url);
const rootClientModule = process.env.SOGNI_AGENT_TEST_STATE_PATH
  ? await import('@sogni-ai/sogni-intelligence-client')
  : require('@sogni-ai/sogni-intelligence-client');
const {
  SogniClientWrapper,
  ClientEvent,
  getMaxContextImages: getWrapperMaxContextImages,
  parseCreativeWorkflowSseChunk
} = rootClientModule;

// ---------------------------------------------------------------------------
// Path sanitization — defense-in-depth for any value that becomes a file path
// or process argument. execaSync runs argument arrays without shell expansion,
// so classic shell injection is not possible. These checks guard against:
//   • null-byte injection (can truncate paths at the C level)
//   • control-character injection
//   • FFMPEG_PATH pointing to a non-ffmpeg binary
// ---------------------------------------------------------------------------

/**
 * Reject null bytes and control characters in a path string.
 * Returns the path unchanged when valid; throws otherwise.
 */
function sanitizePath(p, label) {
  if (typeof p !== 'string') {
    const err = new Error(`${label || 'Path'} must be a string.`);
    err.code = 'INVALID_PATH';
    throw err;
  }
  if (p.includes('\0')) {
    const err = new Error(`${label || 'Path'} contains a null byte.`);
    err.code = 'INVALID_PATH';
    throw err;
  }
  // Reject ASCII control characters except tab (\x09), newline (\x0a), carriage return (\x0d)
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(p)) {
    const err = new Error(`${label || 'Path'} contains invalid control characters.`);
    err.code = 'INVALID_PATH';
    throw err;
  }
  // Expand a leading `~`/`~/` so quoted paths (where the shell didn't expand it,
  // e.g. --ref "~/face.jpg") and agent-passed literals resolve to the home dir.
  return expandHomePath(p);
}

const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.config', 'sogni', 'credentials');
const DEFAULT_LAST_RENDER_PATH = join(homedir(), '.config', 'sogni', 'last-render.json');
const DEFAULT_OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');
// Current OpenClaw home, with a fallback to the legacy clawdbot-era directory
// for installs that predate the rename. Only used when neither
// SOGNI_MEDIA_INBOUND_DIR nor the OpenClaw plugin config overrides it.
const OPENCLAW_MEDIA_INBOUND_DIR = join(homedir(), '.openclaw', 'media', 'inbound');
const LEGACY_MEDIA_INBOUND_DIR = join(homedir(), '.clawdbot', 'media', 'inbound');
const DEFAULT_MEDIA_INBOUND_DIR =
  !existsSync(OPENCLAW_MEDIA_INBOUND_DIR) && existsSync(LEGACY_MEDIA_INBOUND_DIR)
    ? LEGACY_MEDIA_INBOUND_DIR
    : OPENCLAW_MEDIA_INBOUND_DIR;
const DEFAULT_MEMORIES_PATH = join(homedir(), '.config', 'sogni', 'memories.json');
const DEFAULT_PERSONALITY_PATH = join(homedir(), '.config', 'sogni', 'personality.txt');
const DEFAULT_PERSONAS_DIR = join(homedir(), '.config', 'sogni', 'personas');
const DEFAULT_PERSONAS_INDEX_PATH = join(homedir(), '.config', 'sogni', 'personas', 'index.json');
const DEFAULT_API_MEDIA_REFERENCE_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_API_BASE_URL = 'https://api.sogni.ai';
const DEFAULT_SAFE_API_HOSTS = Object.freeze(['api.sogni.ai']);
const LOOPBACK_API_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1']);
const DEFAULT_LLM_MODEL = 'qwen3.6-35b-a3b-gguf-iq4xs';
const VALID_API_TASK_PROFILES = new Set(['general', 'coding', 'reasoning']);
const SOGNI_APP_SOURCE = 'sogni-creative-agent-skill';
const OPENCLAW_CONFIG_PATH = getEnv('OPENCLAW_CONFIG_PATH') || DEFAULT_OPENCLAW_CONFIG_PATH;
const IS_OPENCLAW_INVOCATION = Boolean(getEnv('OPENCLAW_PLUGIN_CONFIG'));
const RAW_ARGS = process.argv.slice(2);
const CLI_WANTS_JSON = RAW_ARGS.includes('--json');
const JSON_ERROR_MODE = CLI_WANTS_JSON || IS_OPENCLAW_INVOCATION;

// --- Update-check entry points --------------------------------------------
// Internal mode: the detached background child that fetches the npm registry.
if (RAW_ARGS[0] === UPDATE_CHECK_INTERNAL_FLAG) {
  await runUpdateCheckForeground({ currentVersion: PACKAGE_VERSION });
  process.exit(0);
}
// User-facing subcommand: `sogni-agent self-update`
if (RAW_ARGS[0] === 'self-update') {
  process.exit(runSogniSelfUpdate({}));
}
// `--snooze-update`: pause reminders for the currently pending update
// (escalating backoff: 1 day → 2 days → 1 week; a newer release resets it).
if (RAW_ARGS[0] === '--snooze-update') {
  const result = snoozeSogniUpdate({ currentVersion: PACKAGE_VERSION });
  if (result.snoozed) {
    console.error(`Update reminders for v${result.version} snoozed until ${new Date(result.until).toISOString()}.`);
  } else {
    console.error('No pending update to snooze.');
  }
  process.exit(0);
}
// `--whats-new [since-version]`: print the bundled CHANGELOG entries for the
// installed version, or everything after <since-version>.
if (RAW_ARGS[0] === '--whats-new') {
  const sinceVersion = RAW_ARGS[1] && !RAW_ARGS[1].startsWith('-') ? RAW_ARGS[1] : null;
  process.exit(runSogniWhatsNew({
    changelogPath: join(dirname(fileURLToPath(import.meta.url)), 'CHANGELOG.md'),
    currentVersion: PACKAGE_VERSION,
    sinceVersion,
  }));
}
// Fire-and-forget background check (no-op when throttled or skipped)
try { maybeSpawnUpdateCheck({ cliPath: process.argv[1] }); } catch { /* never break the CLI */ }
// Trailing notice on exit, if a newer version is on file
process.on('exit', () => {
  try {
    const notice = getUpdateCheckNotice({ currentVersion: PACKAGE_VERSION });
    if (notice) process.stderr.write(notice + '\n');
  } catch { /* never break exit */ }
});
// --- Temp-dir lifecycle ------------------------------------------------------
// Every transient directory the CLI creates is registered here and removed on
// normal exit, fatal error, or signal. Ctrl-C during a long video job is the
// common case that used to orphan directories under os.tmpdir().
const TRACKED_TEMP_DIRS = new Set();

function createTrackedTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  TRACKED_TEMP_DIRS.add(dir);
  return dir;
}

function cleanupTrackedTempDirs() {
  for (const dir of TRACKED_TEMP_DIRS) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    TRACKED_TEMP_DIRS.delete(dir);
  }
}

process.on('exit', cleanupTrackedTempDirs);
// 128 + signal number is the conventional shell exit code for a signal death.
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
  process.on(signal, () => {
    // process.exit() fires the 'exit' handlers above (temp cleanup + update
    // notice); the OS tears down any open SDK socket with the process.
    process.exit(SIGNAL_EXIT_CODES[signal]);
  });
}

const SOCKET_EVENT_SUBSCRIPTIONS = Object.freeze({
  modelAvailability: false
});
const MUSIC_MODEL_IDS = {
  turbo: 'ace_step_1.5_turbo',
  speed: 'ace_step_1.5_turbo',
  fast: 'ace_step_1.5_turbo',
  sft: 'ace_step_1.5_sft',
  lyrics: 'ace_step_1.5_sft',
  lyric: 'ace_step_1.5_sft'
};
const MUSIC_MODEL_DEFAULTS = {
  'ace_step_1.5_turbo': {
    steps: { min: 4, max: 16, default: 8 },
    shift: { min: 1, max: 6, default: 3 },
    sampler: { allowed: ['euler', 'euler_ancestral'], default: 'euler' },
    scheduler: { allowed: ['simple'], default: 'simple' }
  },
  'ace_step_1.5_sft': {
    steps: { min: 10, max: 100, default: 50 },
    guidance: { min: 1, max: 15, default: 5 },
    shift: { min: 1, max: 6, default: 3 },
    sampler: { allowed: ['euler', 'euler_ancestral', 'er_sde'], default: 'er_sde' },
    scheduler: { allowed: ['simple', 'linear_quadratic'], default: 'linear_quadratic' }
  }
};
const MUSIC_DURATION_LIMITS = { min: 10, max: 600, default: 30 };
const MUSIC_BPM_LIMITS = { min: 30, max: 300, default: 120 };
const MUSIC_PROMPT_STRENGTH_LIMITS = { min: 0, max: 10 };
const MUSIC_CREATIVITY_LIMITS = { min: 0, max: 2 };
const MUSIC_OUTPUT_FORMATS = new Set(['mp3', 'flac', 'wav']);
const MUSIC_TIME_SIGNATURES = new Set(['2', '3', '4', '6']);

function expandHomePath(rawPath) {
  if (typeof rawPath !== 'string') return rawPath;
  if (rawPath === '~') return homedir();
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return join(homedir(), rawPath.slice(2));
  }
  return rawPath;
}

function resolveConfiguredPath(rawPath, fallbackPath, label) {
  const candidate = expandHomePath(rawPath) || fallbackPath;
  return sanitizePath(candidate, label);
}

async function disableLiveModelAvailabilityEvents(wrapper) {
  const sdkClient = wrapper?.client;

  try {
    if (typeof sdkClient?.setSocketEventSubscriptions === 'function') {
      await sdkClient.setSocketEventSubscriptions(SOCKET_EVENT_SUBSCRIPTIONS);
    }
  } catch (err) {
    // Subscription optimization is best-effort and must not block generation.
  }
}

function isPathWithinBase(basePath, targetPath) {
  return targetPath === basePath || targetPath.startsWith(`${basePath}${sep}`);
}

function buildCliErrorPayload({ message, code, details, hint, prompt }) {
  const classified = classifyCliError({ message, code });
  const payload = {
    success: false,
    error: classified.message || message || 'Unknown error',
    errorType: classified.error_type,
    errorCategory: classified.category,
    retryable: classified.retryable,
    prompt: prompt ?? null
  };
  if (classified.metadata) payload.metadata = classified.metadata;
  if (classified.technicalError && classified.technicalError !== payload.error) {
    payload.technicalError = classified.technicalError;
  }
  if (code) payload.errorCode = code;
  if (details) payload.errorDetails = details;
  if (hint) payload.hint = hint;
  if (classified.category === 'insufficient_credits') {
    payload.purchaseAction = true;
    payload.purchaseLabel = 'Buy Spark Packs';
    payload.purchaseUrl = SPARK_PACKS_PURCHASE_URL;
    payload.purchaseReason = SPARK_PACKS_PURCHASE_HINT;
    if (!payload.hint) payload.hint = SPARK_PACKS_PURCHASE_HINT;
  }
  payload.timestamp = new Date().toISOString();
  payload.node = process.versions.node;
  payload.cwd = process.cwd();
  if (IS_OPENCLAW_INVOCATION) payload.openclaw = true;
  return payload;
}

function cliErrorMessage(error) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || String(error);
  if (error && typeof error === 'object') {
    const record = error;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.error === 'string') return record.error;
  }
  return String(error ?? 'Unknown error');
}

function seedanceFriendlyGenerationMessage(payload) {
  const raw = [
    payload?.message,
    payload?.vendorError,
    payload?.vendorErrorCode
  ].filter(Boolean).join(' ');
  if (/\baudio\s+format\b[\s\S]{0,120}\b(?:not valid|invalid)\b/i.test(raw)) {
    return 'Seedance rejected the audio reference format for this model. Try a different audio file, trim/convert the clip, or use a non-Seedance audio-driven workflow such as LTX sound-to-video.';
  }
  return payload?.message || 'Seedance could not complete this video.';
}

function classifyCliError(error) {
  const rawMessage = cliErrorMessage(error);
  const seedancePolicyPayload = seedanceTerminalPolicyPayloadFromError(error);
  if (seedancePolicyPayload) {
    return {
      error_type: 'SAFETY_REJECTED',
      category: 'content_refused',
      message: seedancePolicyPayload.message,
      retryable: false,
      metadata: seedancePolicyPayload,
      technicalError: rawMessage
    };
  }

  const seedanceGenerationPayload = seedanceTerminalGenerationFailurePayloadFromError(error);
  if (seedanceGenerationPayload) {
    const vendorCode = seedanceGenerationPayload.vendorErrorCode;
    const isInvalidParameter = vendorCode === 'InvalidParameter' ||
      seedanceGenerationPayload.error === 'seedance_reference_audio_too_long';
    return {
      error_type: isInvalidParameter ? 'PARAMETER_INVALID' : 'GPU_WORKER_FAILED',
      category: isInvalidParameter ? 'schema_validation' : 'transient_failure',
      message: seedanceFriendlyGenerationMessage(seedanceGenerationPayload),
      retryable: !isInvalidParameter,
      metadata: seedanceGenerationPayload,
      technicalError: rawMessage
    };
  }

  return classifySkillError(error);
}

function addCanonicalErrorFields(payload, error) {
  const classified = classifyCliError(error);
  payload.error = classified.message;
  payload.errorType = classified.error_type;
  payload.errorCategory = classified.category;
  payload.retryable = classified.retryable;
  if (classified.metadata) payload.metadata = classified.metadata;
  if (classified.technicalError && classified.technicalError !== classified.message) {
    payload.technicalError = classified.technicalError;
  }
  if (classified.category === 'insufficient_credits') {
    payload.purchaseAction = true;
    payload.purchaseLabel = 'Buy Spark Packs';
    payload.purchaseUrl = SPARK_PACKS_PURCHASE_URL;
    payload.purchaseReason = SPARK_PACKS_PURCHASE_HINT;
    if (!payload.hint) payload.hint = SPARK_PACKS_PURCHASE_HINT;
  }
  return payload;
}

// Human-facing twin of addCanonicalErrorFields: print the classified, friendly
// message (with the raw message as a detail line when it differs) so human
// users get the same quality of error JSON consumers already receive.
function printHumanError(error) {
  let classified = null;
  try { classified = classifyCliError(error); } catch { /* fall back to raw */ }
  const message = classified?.message || error?.message || String(error);
  console.error(`Error: ${message}`);
  if (classified?.technicalError && classified.technicalError !== message) {
    console.error(`Details: ${classified.technicalError}`);
  }
  const hint = error?.hint
    || (classified?.category === 'insufficient_credits' ? SPARK_PACKS_PURCHASE_HINT : null);
  if (hint) console.error(`Hint: ${hint}`);
}

function fatalCliError(message, opts = {}) {
  let prompt = opts.prompt;
  if (prompt === undefined) {
    try {
      // If parsing already populated options, include prompt for better downstream reporting.
      prompt = options?.prompt ?? null;
    } catch (e) {
      prompt = null;
    }
  }
  const payload = buildCliErrorPayload({
    message,
    code: opts.code,
    details: opts.details,
    hint: opts.hint,
    prompt
  });

  if (JSON_ERROR_MODE) {
    console.log(JSON.stringify(payload));
    if (!CLI_WANTS_JSON) {
      // OpenClaw expects JSON, but humans still benefit from stderr.
      console.error(`Error: ${payload.error}`);
      if (payload.hint) console.error(`Hint: ${payload.hint}`);
    }
  } else {
    console.error(`Error: ${payload.error}`);
    if (payload.hint) console.error(`Hint: ${payload.hint}`);
  }
  process.exit(1);
}

// Friendly guidance shown when the Sogni API key is missing or rejected.
const INVALID_API_KEY_HINT =
  'Your Sogni API key was rejected. Verify it — or generate a new one — by ' +
  'logging into https://dashboard.sogni.ai and opening the account menu. ' +
  "If you don't have a Sogni account yet, create one there first, then add its API key.";

// Detect an invalid/rejected API key across the several shapes the SDK can
// surface it in. The SDK reports the REST 401 directly (ApiError with
// status/errorCode), but it can also cascade: a 401 triggers
// ApiKeyAuthManager.clear(), which tears down the socket and re-throws as an
// unhandled "WebSocket was closed before the connection was established"
// error whose only auth fingerprint is the stack frame.
function isInvalidApiKeyError(error) {
  if (!error) return false;
  const status = error.status ?? error.statusCode ?? error?.payload?.status;
  const apiCode = error?.payload?.errorCode ?? error?.errorCode;
  if (status === 401 || apiCode === 101) return true;
  const message = (cliErrorMessage(error) || '').toLowerCase();
  if (message.includes('invalid api key')) return true;
  const stack = (typeof error?.stack === 'string' ? error.stack : '').toLowerCase();
  if (stack.includes('apikeyauthmanager') || stack.includes('handleauthupdated')) return true;
  return false;
}

// Last line of defense. The SDK can reject from a detached promise or emit an
// unhandled 'error' event during connect, which escapes main()'s try/catch and
// crashes the process with a raw stack trace. These handlers turn any such
// fatal into the same clean `Error:`/`Hint:` (or JSON) output as every other
// CLI error path, and exit 1.
let __fatalReported = false;
function reportFatalError(error) {
  if (__fatalReported) {
    try { process.exit(1); } catch (_) { /* already exiting */ }
    return;
  }
  __fatalReported = true;
  if (getEnv('SOGNI_DEBUG') || getEnv('DEBUG')) {
    console.error(error?.stack || String(error));
  }
  if (isInvalidApiKeyError(error)) {
    fatalCliError('Invalid Sogni API key.', {
      code: 'INVALID_API_KEY',
      hint: INVALID_API_KEY_HINT
    });
    return;
  }
  fatalCliError(cliErrorMessage(error), {
    code: error?.code,
    details: error?.details,
    hint: error?.hint
  });
}
process.on('uncaughtException', reportFatalError);
process.on('unhandledRejection', reportFatalError);

// Connect to Sogni, mapping a rejected connection into a clean auth error
// where we can. (Detached SDK failures that never reach this await are caught
// by the global handlers above.)
async function connectSogniClient(client) {
  try {
    await client.connect();
  } catch (error) {
    if (isInvalidApiKeyError(error) && !error.hint) {
      error.hint = INVALID_API_KEY_HINT;
      if (!error.code) error.code = 'INVALID_API_KEY';
    }
    throw error;
  }
}

function applyVideoPromptGuardrails() {
  if (!options.video || !options.prompt) return;
  if (options._literalPrompt) return;

  const plan = getVideoPromptGuardrailPlan({
    prompt: options.prompt,
    duration: options.duration,
    frames: options.frames,
    fps: options.fps,
    durationExplicit: cliSet.duration,
    referenceAudioIdentity: options.referenceAudioIdentity,
    voiceName: options._voicePersonaResolvedName || options.voicePersonaName || 'SPEAKER'
  });
  options.prompt = plan.prompt;
  options.duration = plan.duration;
  if (!options.quiet) {
    for (const warning of plan.warnings) {
      console.error(warning.message);
    }
  }
}

function applyCreativeBrainPreflight() {
  if (!options.video || !options.prompt) return;

  const plan = planCliVideoBrain({
    video: options.video,
    prompt: options.prompt,
    model: options.model,
    workflow: options.videoWorkflow,
    width: options.width,
    height: options.height,
    duration: options.duration,
    frames: options.frames,
    targetResolution: options.targetResolution,
    refImage: options.refImage,
    refImageEnd: options.refImageEnd,
    refAudio: options.refAudio,
    refVideo: options.refVideo,
    cliSet: {
      model: cliSet.model,
      workflow: cliSet.workflow,
      width: cliSet.width,
      height: cliSet.height,
      targetResolution: cliSet.targetResolution,
      duration: cliSet.duration,
      frames: cliSet.frames
    }
  });

  if (plan.literalPrompt) {
    options._literalPrompt = true;
  }
  if (plan.prompt && plan.prompt !== options.prompt) {
    options.prompt = plan.prompt;
  }
  if (plan.model && !cliSet.model) {
    options.model = plan.model;
  }
  if (plan.workflow && !cliSet.workflow) {
    options.videoWorkflow = plan.workflow;
  }
  if (Number.isFinite(plan.duration) && !cliSet.duration && !cliSet.frames) {
    options.duration = plan.duration;
    durationFromPrompt = true;
  }
  if (
    plan.dimensionSource === 'exact' &&
    Number.isFinite(plan.width) &&
    Number.isFinite(plan.height) &&
    !cliSet.width &&
    !cliSet.height
  ) {
    options.width = plan.width;
    options.height = plan.height;
    widthFromPrompt = true;
    heightFromPrompt = true;
  }
  if (plan.dimensionSource === 'aspect' && plan.aspectRatio && !cliSet.width && !cliSet.height) {
    aspectRatioFromPrompt = plan.aspectRatio;
  }
  if (
    Number.isFinite(plan.targetResolution) &&
    !cliSet.targetResolution &&
    !cliSet.width &&
    !cliSet.height &&
    !widthFromPrompt &&
    !heightFromPrompt
  ) {
    options.targetResolution = plan.targetResolution;
    targetResolutionFromPrompt = true;
  }
  if (plan.storyboard) {
    options._seedanceStoryboardPlan = plan.storyboard;
  }
}

function normalizeSeedStrategy(value) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'random') return 'random';
  if (normalized === 'prompt-hash' || normalized === 'prompt_hash') return 'prompt-hash';
  return null;
}

function normalizeApiToolMode(value) {
  const normalized = String(value || 'creative-agent').toLowerCase();
  if (normalized === 'creative-agent') return 'creative-agent';
  if (normalized === 'creative-tools') return 'creative-tools';
  if (normalized === 'true') return true;
  if (normalized === 'none' || normalized === 'false') return false;
  return null;
}

function normalizeApiWorkflowTemplate(value) {
  const normalized = String(value || '').toLowerCase().replace(/-/g, '_');
  if (normalized === 'storyboard_video' || normalized === 'storyboard_to_video' || normalized === 'gpt_image_2_seedance' || normalized === 'gpt_image_seedance') {
    return 'storyboard_video';
  }
  return null;
}

function appendApiPath(baseUrl, path) {
  const base = String(baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function getApiBaseUrl() {
  return options.apiBaseUrl || getEnv('SOGNI_API_BASE_URL') || getEnv('SOGNI_REST_ENDPOINT') || DEFAULT_API_BASE_URL;
}

function getApiAllowedHosts() {
  const configured = String(getEnv('SOGNI_API_ALLOWED_HOSTS') || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_SAFE_API_HOSTS, ...configured]));
}

function allowUnsafeApiBaseUrl() {
  return getEnv('SOGNI_ALLOW_UNSAFE_API_BASE_URL') === '1';
}

function isLoopbackApiUrl(parsed) {
  return LOOPBACK_API_HOSTS.includes(parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase());
}

async function buildSafeApiUrl(path) {
  const url = appendApiPath(getApiBaseUrl(), path);
  const unsafeAllowed = allowUnsafeApiBaseUrl();

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const err = new Error('Invalid Sogni API base URL.');
    err.code = 'INVALID_API_BASE_URL';
    throw err;
  }

  const hasEmbeddedCredentials = Boolean(parsed['user' + 'name'] || parsed['pass' + 'word']);
  if (hasEmbeddedCredentials) {
    const err = new Error('Sogni API base URL must not contain credentials.');
    err.code = 'UNSAFE_API_BASE_URL';
    throw err;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error(`Sogni API URL protocol ${parsed.protocol} is not allowed.`);
    err.code = 'UNSAFE_API_BASE_URL';
    throw err;
  }

  if (unsafeAllowed) return url;

  if (isLoopbackApiUrl(parsed)) {
    const err = new Error('Loopback Sogni API base URLs require SOGNI_ALLOW_UNSAFE_API_BASE_URL=1 for isolated local testing.');
    err.code = 'UNSAFE_API_BASE_URL';
    throw err;
  }

  try {
    await assertSafeUrl(url, {
      allowedProtocols: ['https:'],
      allowedHosts: getApiAllowedHosts()
    });
  } catch (err) {
    const wrapped = new Error(
      `${err.message}. Set SOGNI_API_ALLOWED_HOSTS for a trusted custom API host, or SOGNI_ALLOW_UNSAFE_API_BASE_URL=1 for isolated local testing.`
    );
    wrapped.code = 'UNSAFE_API_BASE_URL';
    wrapped.cause = err;
    throw wrapped;
  }

  return url;
}

function generateRandomSeed() {
  return randomBytes(4).readUInt32BE(0);
}

// ---------------------------------------------------------------------------
// Dynamic prompt variations — {option1|option2|option3} syntax
// For count > 1, cycles through options sequentially per image.
// ---------------------------------------------------------------------------
const VARIATION_PATTERN = /\{([^}]+)\}/g;

function hasPromptVariations(prompt) {
  return /\{[^}]+\}/.test(prompt);
}

function expandPromptVariation(prompt, index) {
  return prompt.replace(VARIATION_PATTERN, (_match, group) => {
    const options = group.split('|').map(s => s.trim());
    return options[index % options.length];
  });
}

function computePromptHashSeed(opts) {
  const payload = {
    prompt: opts.prompt || '',
    model: opts.model || '',
    workflow: opts.video ? opts.videoWorkflow : opts.music ? 'music' : 'image',
    width: opts.width,
    height: opts.height,
    azimuth: opts.azimuth || '',
    elevation: opts.elevation || '',
    distance: opts.distance || '',
    angleDescription: opts.angleDescription || '',
    outputFormat: opts.outputFormat || '',
    sampler: opts.sampler || '',
    scheduler: opts.scheduler || '',
    musicLyrics: opts.musicLyrics || '',
    musicLanguage: opts.musicLanguage || '',
    musicBpm: opts.musicBpm ?? null,
    musicKeyscale: opts.musicKeyscale || '',
    musicTimesig: opts.musicTimesig || '',
    musicComposerMode: opts.musicComposerMode ?? null,
    musicPromptStrength: opts.musicPromptStrength ?? null,
    musicCreativity: opts.musicCreativity ?? null,
    musicShift: opts.musicShift ?? null,
    targetResolution: opts.targetResolution ?? null,
    loras: opts.loras || [],
    loraStrengths: opts.loraStrengths || [],
    refImage: opts.refImage || '',
    refImageEnd: opts.refImageEnd || '',
    refAudio: opts.refAudio || '',
    audioStart: opts.audioStart ?? null,
    audioDuration: opts.audioDuration ?? null,
    referenceAudioIdentity: opts.referenceAudioIdentity || '',
    refVideo: opts.refVideo || '',
    videoStart: opts.videoStart ?? null,
    contextImages: opts.contextImages || [],
    autoResizeVideoAssets: opts.autoResizeVideoAssets,
    tokenType: opts.tokenType || '',
    steps: opts.steps ?? null,
    guidance: opts.guidance ?? null
  };
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest();
  return hash.readUInt32BE(0);
}

function parseCsv(value) {
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseNumberValue(raw, flagName) {
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    fatalCliError(`${flagName} must be a number.`, {
      code: 'INVALID_ARGUMENT',
      details: { flag: flagName, value: raw }
    });
  }
  return num;
}

function parseNonNegativeNumberValue(raw, flagName) {
  const num = parseNumberValue(raw, flagName);
  if (num < 0) {
    fatalCliError(`${flagName} must be >= 0.`, {
      code: 'INVALID_ARGUMENT',
      details: { flag: flagName, value: raw, min: 0 }
    });
  }
  return num;
}

function parseNumberList(raw, flagName) {
  const entries = parseCsv(raw);
  return entries.map((entry) => parseNumberValue(entry, flagName));
}

function parseBoundedNumberValue(raw, flagName, limits) {
  const num = parseNumberValue(raw, flagName);
  if (num < limits.min || num > limits.max) {
    fatalCliError(`${flagName} must be between ${limits.min} and ${limits.max}.`, {
      code: 'INVALID_ARGUMENT',
      details: { flag: flagName, value: raw, min: limits.min, max: limits.max }
    });
  }
  return num;
}

function requireFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (value === undefined) {
    fatalCliError(`${flagName} requires a value.`, {
      code: 'INVALID_ARGUMENT',
      details: { flag: flagName }
    });
  }
  return value;
}

function parseIntegerValue(raw, flagName) {
  const num = Number(raw);
  if (!Number.isInteger(num)) {
    fatalCliError(`${flagName} must be an integer.`, {
      code: 'INVALID_ARGUMENT',
      details: { flag: flagName, value: raw }
    });
  }
  return num;
}

function parsePositiveIntegerValue(raw, flagName, min = 1, max = Infinity) {
  const num = parseIntegerValue(raw, flagName);
  if (num < min) {
    fatalCliError(`${flagName} must be >= ${min}.`, {
      code: 'INVALID_ARGUMENT',
      details: { flag: flagName, value: raw, min }
    });
  }
  if (num > max) {
    fatalCliError(`${flagName} must be <= ${max}.`, {
      code: 'INVALID_ARGUMENT',
      details: { flag: flagName, value: raw, max }
    });
  }
  return num;
}

// Sanity ceiling for image dimensions — well above any model's real maximum,
// just large enough to catch obvious typos (e.g. a stray extra zero) before
// they waste a round-trip or blow up local memory.
const MAX_IMAGE_DIMENSION = 8192;

// Safety cap for -n/--count: every output is a paid generation, so a typo like
// `-n 1000` (meant `-n 10`) must not launch a thousand-render batch. Raise
// deliberately with SOGNI_MAX_COUNT when a bigger batch is really wanted.
const DEFAULT_MAX_COUNT = 16;
const MAX_COUNT = (() => {
  const raw = Number.parseInt(getEnv('SOGNI_MAX_COUNT') || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_COUNT;
})();

function parseSeedValue(raw, flagName) {
  const num = parseIntegerValue(raw, flagName);
  if (num < 0 || num > 0xFFFFFFFF) {
    fatalCliError(`${flagName} must be between 0 and 4294967295.`, {
      code: 'INVALID_ARGUMENT',
      details: { flag: flagName, value: raw }
    });
  }
  return num;
}

function formatTokenValue(value) {
  if (!Number.isFinite(value)) return 'unknown';
  return value.toFixed(2);
}

function parseCostEstimate(estimate, tokenType) {
  if (!estimate) return null;
  const raw = tokenType === 'sogni'
    ? estimate.sogni ?? estimate.token
    : estimate.spark ?? estimate.token;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function buildBalanceError(message, details) {
  const err = new Error(message);
  err.code = 'INSUFFICIENT_BALANCE';
  err.details = details || null;
  err.hint = SPARK_PACKS_PURCHASE_HINT;
  return err;
}

function isStructuredInsufficientBalanceError(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'INSUFFICIENT_BALANCE');
}

/**
 * Build an Error from an SDK project result that signals failure via
 * `{ error, message, code, details, hint }` fields instead of throwing.
 * Preserving `code` is critical — without it, downstream classification
 * (auto-fallback retry via `isStructuredInsufficientBalanceError`, and
 * the `insufficient_credits` payload enrichment in `buildCliErrorPayload`
 * / `addCanonicalErrorFields`) cannot tell that the failure is e.g.
 * `INSUFFICIENT_BALANCE`, so the "Buy Spark Packs" CTA silently no-ops.
 */
function buildProjectResultError(projectResult) {
  const message = projectResult?.error || projectResult?.message || 'Project failed';
  const err = new Error(message);
  if (projectResult?.code) err.code = projectResult.code;
  if (projectResult?.details) err.details = projectResult.details;
  if (projectResult?.hint) err.hint = projectResult.hint;
  if (classifyCliError(err).category === 'insufficient_credits' && !err.hint) {
    err.hint = SPARK_PACKS_PURCHASE_HINT;
  }
  return err;
}

function gcdInt(a, b) {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function isHttpUrl(value) {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function getPngDimensions(buffer) {
  if (!buffer || buffer.length < 24) return null;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47 ||
    buffer[4] !== 0x0D || buffer[5] !== 0x0A || buffer[6] !== 0x1A || buffer[7] !== 0x0A
  ) {
    return null;
  }
  try {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height) return null;
    return { width, height, type: 'png' };
  } catch {
    return null;
  }
}

function getJpegDimensions(buffer) {
  if (!buffer || buffer.length < 4) return null;
  // JPEG SOI: FF D8
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;

  // Walk segments until we find a Start Of Frame marker that contains dimensions.
  // Common SOF markers: C0 (baseline), C1, C2 (progressive), C3, C5-C7, C9-CB, CD-CF
  let i = 2;
  while (i + 9 < buffer.length) {
    // Find marker prefix 0xFF
    if (buffer[i] !== 0xFF) {
      i++;
      continue;
    }
    // Skip fill bytes 0xFF
    while (i < buffer.length && buffer[i] === 0xFF) i++;
    if (i >= buffer.length) break;
    const marker = buffer[i];
    i++;

    // Markers without a length field
    if (marker === 0xD9 || marker === 0xDA) break; // EOI or SOS
    if (marker >= 0xD0 && marker <= 0xD7) continue; // RSTn

    if (i + 1 >= buffer.length) break;
    const segmentLength = buffer.readUInt16BE(i);
    if (segmentLength < 2) break;
    const segmentStart = i + 2;

    const isSof =
      (marker >= 0xC0 && marker <= 0xC3) ||
      (marker >= 0xC5 && marker <= 0xC7) ||
      (marker >= 0xC9 && marker <= 0xCB) ||
      (marker >= 0xCD && marker <= 0xCF);

    if (isSof) {
      if (segmentStart + 7 >= buffer.length) break;
      try {
        const height = buffer.readUInt16BE(segmentStart + 1);
        const width = buffer.readUInt16BE(segmentStart + 3);
        if (!width || !height) return null;
        return { width, height, type: 'jpg' };
      } catch {
        return null;
      }
    }

    i = segmentStart + (segmentLength - 2);
  }

  return null;
}

function getImageDimensionsFromBuffer(buffer) {
  return getPngDimensions(buffer) || getJpegDimensions(buffer);
}

const DEFAULT_VIDEO_DIMENSION_RULES = {
  minDimension: 480,
  maxDimension: 1536,
  dimensionMultiple: 16
};
const WRAPPER_MAX_VIDEO_DIMENSION = 2048;
const WRAPPER_MAX_WAN_VIDEO_DIMENSION = 1536;
const VIDEO_DIMENSION_MULTIPLE = DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple;

function isWanVideoModelId(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('wan_');
}

function isWanAnimateVideoModelId(modelId) {
  return typeof modelId === 'string' && (
    modelId.includes('_animate-move') ||
    modelId.includes('_animate-replace') ||
    modelId.includes('_animate_move') ||
    modelId.includes('_animate_replace')
  );
}

function isGptImage2ModelSelection(modelId) {
  const normalized = String(modelId || '').trim().toLowerCase();
  return ['gpt-image-2', 'gptimage2', 'gpt-image', 'gpt_image_2'].includes(normalized);
}

function normalizeMusicModelId(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/-/g, '_').replace(/ace_step_1_5/g, 'ace_step_1.5');
  return MUSIC_MODEL_IDS[normalized] || (MUSIC_MODEL_DEFAULTS[normalized] ? normalized : null);
}

function getMusicModelDefaults(modelId) {
  return MUSIC_MODEL_DEFAULTS[normalizeMusicModelId(modelId)] || null;
}

function normalizeMusicTimeSignature(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^([2346])(?:\s*\/\s*(?:4|8))?$/);
  return match ? match[1] : raw;
}

function requiresSparkOnlyToken(modelId) {
  return isGptImage2ModelSelection(modelId) || isSeedanceModel(modelId);
}

function getMaxContextImages(modelId) {
  if (isGptImage2ModelSelection(modelId)) return 16;
  return getWrapperMaxContextImages(modelId);
}

function videoDurationLimitsLikeWrapper(modelId) {
  if (isSeedanceModel(modelId)) return { min: 4, max: 15 };
  if (isLtx2Model(modelId) || isWanAnimateVideoModelId(modelId)) return { min: 1, max: 20 };
  return { min: 1, max: 10 };
}

function wrapperMaxVideoDimension(modelId) {
  return isWanVideoModelId(modelId) ? WRAPPER_MAX_WAN_VIDEO_DIMENSION : WRAPPER_MAX_VIDEO_DIMENSION;
}

function videoDimensionRulesFromDefaults(modelDefaults, modelId) {
  const wrapperMax = wrapperMaxVideoDimension(modelId);
  const configuredMax = modelDefaults?.maxDimension || DEFAULT_VIDEO_DIMENSION_RULES.maxDimension;
  return {
    minDimension: modelDefaults?.minDimension || DEFAULT_VIDEO_DIMENSION_RULES.minDimension,
    maxDimension: Math.min(configuredMax, wrapperMax),
    dimensionMultiple: modelDefaults?.dimensionMultiple || DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple
  };
}

/**
 * Resizes an image buffer to model-compatible dimensions while maintaining aspect ratio.
 * Uses sharp's fit:inside to preserve aspect, then rounds to the model divisor.
 */
async function resizeImageBufferForVideo(buffer, originalWidth, originalHeight, rules = DEFAULT_VIDEO_DIMENSION_RULES) {
  const multiple = rules.dimensionMultiple || VIDEO_DIMENSION_MULTIPLE;
  const roundToMultiple = (n) => Math.max(multiple, Math.round(n / multiple) * multiple);
  const targetWidth = Math.max(rules.minDimension, Math.min(rules.maxDimension, roundToMultiple(originalWidth)));
  const targetHeight = Math.max(rules.minDimension, Math.min(rules.maxDimension, roundToMultiple(originalHeight)));

  // Resize using sharp with fit:inside (maintains aspect ratio)
  const resizedBuffer = await sharp(buffer)
    .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();

  // Get actual dimensions after resize
  const metadata = await sharp(resizedBuffer).metadata();
  const actualWidth = roundToMultiple(metadata.width);
  const actualHeight = roundToMultiple(metadata.height);

  // If dimensions aren't exactly model-compatible, do a final resize/crop.
  if (metadata.width !== actualWidth || metadata.height !== actualHeight) {
    return await sharp(resizedBuffer)
      .resize(actualWidth, actualHeight, { fit: 'cover' })
      .toBuffer();
  }

  return resizedBuffer;
}

function normalizeVideoDimensionsLikeWrapper(width, height, rules = DEFAULT_VIDEO_DIMENSION_RULES) {
  let targetWidth = Number(width);
  let targetHeight = Number(height);
  let adjusted = false;

  const effectiveMin = rules.minDimension || DEFAULT_VIDEO_DIMENSION_RULES.minDimension;
  const effectiveMax = rules.maxDimension || DEFAULT_VIDEO_DIMENSION_RULES.maxDimension;
  const effectiveMultiple = rules.dimensionMultiple || DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple;

  if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight)) {
    return { width: targetWidth, height: targetHeight, adjusted: false };
  }

  if (targetWidth > effectiveMax || targetHeight > effectiveMax) {
    const scaleFactor = Math.min(effectiveMax / targetWidth, effectiveMax / targetHeight);
    targetWidth = Math.floor(targetWidth * scaleFactor);
    targetHeight = Math.floor(targetHeight * scaleFactor);
    adjusted = true;
  }

  if (targetWidth < effectiveMin || targetHeight < effectiveMin) {
    const scaleFactor = Math.max(effectiveMin / targetWidth, effectiveMin / targetHeight);
    targetWidth = Math.floor(targetWidth * scaleFactor);
    targetHeight = Math.floor(targetHeight * scaleFactor);
    adjusted = true;
    if (targetWidth > effectiveMax || targetHeight > effectiveMax) {
      const downscaleFactor = Math.min(effectiveMax / targetWidth, effectiveMax / targetHeight);
      targetWidth = Math.floor(targetWidth * downscaleFactor);
      targetHeight = Math.floor(targetHeight * downscaleFactor);
    }
  }

  const roundedWidth = Math.floor(targetWidth / effectiveMultiple) * effectiveMultiple;
  const roundedHeight = Math.floor(targetHeight / effectiveMultiple) * effectiveMultiple;
  if (roundedWidth !== targetWidth || roundedHeight !== targetHeight) {
    adjusted = true;
  }
  targetWidth = roundedWidth;
  targetHeight = roundedHeight;

  if (targetWidth < effectiveMin) {
    targetWidth = Math.ceil(effectiveMin / effectiveMultiple) * effectiveMultiple;
    adjusted = true;
  }
  if (targetHeight < effectiveMin) {
    targetHeight = Math.ceil(effectiveMin / effectiveMultiple) * effectiveMultiple;
    adjusted = true;
  }

  return { width: targetWidth, height: targetHeight, adjusted };
}

function predictSharpInsideResizeDims(refWidth, refHeight, targetWidth, targetHeight) {
  const rw = Number(refWidth);
  const rh = Number(refHeight);
  const tw = Number(targetWidth);
  const th = Number(targetHeight);
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || !Number.isFinite(tw) || !Number.isFinite(th) || rw <= 0 || rh <= 0 || tw <= 0 || th <= 0) {
    return null;
  }

  // Matches sharp(vips) behavior in SogniClientWrapper.resizeImageBuffer(..., fit: 'inside'):
  // Choose limiting dimension; keep it exact; compute the other dimension with Math.round().
  const scaleW = tw / rw;
  const scaleH = th / rh;
  const widthLimited = scaleW <= scaleH;
  if (widthLimited) {
    return { width: tw, height: Math.round(rh * tw / rw) };
  }
  return { width: Math.round(rw * th / rh), height: th };
}

function pickCompatibleI2vBoundingBox(refWidth, refHeight, desiredWidth, desiredHeight, { allowImperfect = false, rules = DEFAULT_VIDEO_DIMENSION_RULES } = {}) {
  const effectiveMin = rules.minDimension || DEFAULT_VIDEO_DIMENSION_RULES.minDimension;
  const effectiveMax = rules.maxDimension || DEFAULT_VIDEO_DIMENSION_RULES.maxDimension;
  const effectiveMultiple = rules.dimensionMultiple || DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple;
  const desiredW = Number.isFinite(Number(desiredWidth)) ? Number(desiredWidth) : 512;
  const desiredH = Number.isFinite(Number(desiredHeight)) ? Number(desiredHeight) : 512;
  const desiredMax = Math.max(effectiveMin, Math.min(effectiveMax, Math.max(desiredW, desiredH)));
  let best = null;
  let bestImperfect = null;

  for (let w = effectiveMin; w <= effectiveMax; w += effectiveMultiple) {
    for (let h = effectiveMin; h <= effectiveMax; h += effectiveMultiple) {
      const normalized = normalizeVideoDimensionsLikeWrapper(w, h, rules);
      if (!Number.isFinite(normalized.width) || !Number.isFinite(normalized.height)) continue;
      const out = predictSharpInsideResizeDims(refWidth, refHeight, normalized.width, normalized.height);
      if (!out) continue;
      // Require both output dimensions >= model minimum for API compatibility.
      if (out.width < effectiveMin || out.height < effectiveMin) continue;

      const isPerfect = out.width % effectiveMultiple === 0 && out.height % effectiveMultiple === 0;

      const outMax = Math.max(out.width, out.height);
      const distance = Math.abs(normalized.width - desiredW) + Math.abs(normalized.height - desiredH);
      // Prefer a bounding box close to what the user asked for, then output close to requested max, then maximize output area.
      const score = -distance * 1e9 - Math.abs(outMax - desiredMax) * 1e8 + out.width * out.height * 1e3 - (normalized.width * normalized.height);

      if (isPerfect) {
        if (!best || score > best.score) {
          best = { width: normalized.width, height: normalized.height, output: out, score, perfect: true };
        }
      } else if (allowImperfect) {
        // Track imperfect candidates: prefer those closest to the model divisor.
        const widthRemainder = out.width % effectiveMultiple;
        const heightRemainder = out.height % effectiveMultiple;
        const divisorDistance = Math.min(widthRemainder, effectiveMultiple - widthRemainder) +
                            Math.min(heightRemainder, effectiveMultiple - heightRemainder);
        const imperfectScore = -divisorDistance * 1e10 + score;
        if (!bestImperfect || imperfectScore > bestImperfect.score) {
          const adjustedWidth = Math.round(out.width / effectiveMultiple) * effectiveMultiple;
          const adjustedHeight = Math.round(out.height / effectiveMultiple) * effectiveMultiple;
          bestImperfect = {
            width: normalized.width,
            height: normalized.height,
            output: out,
            adjustedOutput: { width: adjustedWidth, height: adjustedHeight },
            score: imperfectScore,
            perfect: false
          };
        }
      }
    }
  }

  return best || (allowImperfect ? bestImperfect : null);
}

const MULTI_ANGLE_AZIMUTHS = [
  { key: 'front', prompt: 'front view' },
  { key: 'front-right', prompt: 'front-right quarter view' },
  { key: 'right', prompt: 'right side view' },
  { key: 'back-right', prompt: 'back-right quarter view' },
  { key: 'back', prompt: 'back view' },
  { key: 'back-left', prompt: 'back-left quarter view' },
  { key: 'left', prompt: 'left side view' },
  { key: 'front-left', prompt: 'front-left quarter view' }
];

const MULTI_ANGLE_ELEVATIONS = [
  { key: 'low-angle', prompt: 'low-angle shot' },
  { key: 'eye-level', prompt: 'eye-level shot' },
  { key: 'elevated', prompt: 'elevated shot' },
  { key: 'high-angle', prompt: 'high-angle shot' }
];

const MULTI_ANGLE_DISTANCES = [
  { key: 'close-up', prompt: 'close-up' },
  { key: 'medium', prompt: 'medium shot' },
  { key: 'wide', prompt: 'wide shot' }
];

const MULTI_ANGLE_AZIMUTH_ALIASES = new Map([
  ['front-right quarter', 'front-right'],
  ['front right quarter', 'front-right'],
  ['back-right quarter', 'back-right'],
  ['back right quarter', 'back-right'],
  ['back-left quarter', 'back-left'],
  ['back left quarter', 'back-left'],
  ['front-left quarter', 'front-left'],
  ['front left quarter', 'front-left']
]);

const MULTI_ANGLE_ELEVATION_ALIASES = new Map([
  ['low angle', 'low-angle'],
  ['eye level', 'eye-level'],
  ['high angle', 'high-angle']
]);

const MULTI_ANGLE_DISTANCE_ALIASES = new Map([
  ['close up', 'close-up'],
  ['medium shot', 'medium'],
  ['wide shot', 'wide']
]);

function normalizeMultiAngleValue(value, aliases, allowedKeys, label) {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ').trim();
  const aliased = aliases.get(normalized) || normalized;
  if (!allowedKeys.includes(aliased)) {
    fatalCliError(`Invalid ${label} "${value}".`, {
      code: 'INVALID_ARGUMENT',
      details: { field: label, value, allowed: allowedKeys }
    });
  }
  return aliased;
}

function buildMultiAnglePrompt({ azimuth, elevation, distance, description }) {
  const azimuthPrompt = MULTI_ANGLE_AZIMUTHS.find((a) => a.key === azimuth)?.prompt;
  const elevationPrompt = MULTI_ANGLE_ELEVATIONS.find((e) => e.key === elevation)?.prompt;
  const distancePrompt = MULTI_ANGLE_DISTANCES.find((d) => d.key === distance)?.prompt;
  const parts = ['<sks>', azimuthPrompt, elevationPrompt, distancePrompt].filter(Boolean);
  if (description) parts.push(description);
  return parts.join(' ');
}

function loadOpenClawPluginConfig() {
  const openclawPluginConfig = getEnv('OPENCLAW_PLUGIN_CONFIG');
  if (openclawPluginConfig) {
    try {
      return JSON5.parse(openclawPluginConfig);
    } catch (e) {
      // Warn (don't crash): a malformed inline config silently dropping all the
      // user's defaults is a confusing trap.
      console.error(`Warning: OPENCLAW_PLUGIN_CONFIG is not valid JSON5 (${e?.message || e}); ignoring it and using defaults.`);
      return null;
    }
  }
  if (!existsSync(OPENCLAW_CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(OPENCLAW_CONFIG_PATH, 'utf8');
    const parsed = JSON5.parse(raw);
    return parsed?.plugins?.entries?.['sogni-creative-agent-skill']?.config || null;
  } catch (e) {
    console.error(`Warning: could not parse ${OPENCLAW_CONFIG_PATH} (${e?.message || e}); ignoring it and using defaults.`);
    return null;
  }
}

const openclawConfig = loadOpenClawPluginConfig();
const CREDENTIALS_PATH = resolveConfiguredPath(
  getEnv('SOGNI_CREDENTIALS_PATH') || openclawConfig?.credentialsPath,
  DEFAULT_CREDENTIALS_PATH,
  'SOGNI API key credentials path'
);
const LAST_RENDER_PATH = resolveConfiguredPath(
  getEnv('SOGNI_LAST_RENDER_PATH') || openclawConfig?.lastRenderPath,
  DEFAULT_LAST_RENDER_PATH,
  'SOGNI last render path'
);
const MEDIA_INBOUND_DIR = resolveConfiguredPath(
  getEnv('SOGNI_MEDIA_INBOUND_DIR') || openclawConfig?.mediaInboundDir,
  DEFAULT_MEDIA_INBOUND_DIR,
  'SOGNI media inbound path'
);

// Parse arguments
const args = process.argv.slice(2);
const options = {
  prompt: null,
  output: null,
  model: null, // Will be set based on type
  width: 512,
  height: 512,
  count: 1,
  json: false,
  quiet: false,
  timeout: 30000,
  strictSize: false,
  quality: null, // Quality tier: fast|hq|pro — auto-selects model, steps, dimensions
  tokenType: null,
  steps: null,
  guidance: null,
  outputFormat: null,
  sampler: null,
  scheduler: null,
  loras: [],
  loraStrengths: [],
  multiAngle: false,
  angles360: false,
  azimuth: 'front',
  elevation: 'eye-level',
  distance: 'medium',
  angleStrength: null,
  angleDescription: '',
  seed: null,
  lastSeed: false,
  seedStrategy: null,
  music: false,
  musicLyrics: null,
  musicLanguage: null,
  musicBpm: null,
  musicKeyscale: null,
  musicTimesig: null,
  musicComposerMode: null,
  musicPromptStrength: null,
  musicCreativity: null,
  musicShift: null,
  video: false,
  videoWorkflow: null,
  fps: 16,
  duration: 5,
  frames: null,
  targetResolution: null, // Short-side target for video, preserving aspect ratio
  autoResizeVideoAssets: null,
  estimateVideoCost: false,
  showBalance: false,
  showVersion: false,
  doctor: false,
  angles360Video: null,
  refImage: null, // Reference image for video (start frame)
  refImageEnd: null, // End frame for video interpolation
  refAudio: null, // Uploaded/generated audio for ia2v/a2v, or s2v lip-sync (primary)
  refAudios: [], // Additional Seedance loose audio refs; first --ref-audio fills refAudio, subsequent calls append here
  audioStart: null, // Optional start offset into reference audio
  audioDuration: null, // Optional duration slice for reference audio
  referenceAudioIdentity: null, // Voice identity reference for LTX native audio
  voicePersonaName: null,
  refVideo: null, // Reference video for animate workflows (primary)
  refVideos: [], // Additional Seedance loose video refs; first --ref-video fills refVideo, subsequent calls append here
  videoStart: null, // Optional start offset into reference video
  contextImages: [], // Context images for image editing
  looping: false, // Create looping video (i2v only): generate A→B then B→A and concatenate
  photobooth: false, // Photobooth mode (InstantID face transfer)
  cnStrength: null, // ControlNet strength override
  cnGuidanceEnd: null, // ControlNet guidance end override
  videoControlNetName: null, // ControlNet name for v2v: canny|pose|depth|detailer
  videoControlNetStrength: null, // ControlNet strength for v2v (0.0-1.0)
  sam2Coordinates: null, // SAM2 coordinates for animate-replace [{x,y}]
  trimEndFrame: false, // Trim last frame for seamless stitching
  firstFrameStrength: null, // Keyframe interpolation (0.0-1.0)
  lastFrameStrength: null, // Keyframe interpolation (0.0-1.0)
  extractLastFrame: null, // --extract-last-frame <video> <image>
  extractLastFrameOutput: null,
  concatVideos: null, // --concat-videos <out> <clip1> <clip2> [...]
  concatVideosClips: null,
  concatAudio: null, // Optional audio file to mux over concatenated clips
  concatAudioStart: null,
  concatFps: null, // --concat-fps <n>: override target fps for concat normalization
  extractFirstFrame: null, // --extract-first-frame <video> <image>
  extractFirstFrameOutput: null,
  // Audio remix (--remix-audio <in_video> <out_video>): loop/fade/mix without re-encoding video
  remixAudio: null,
  remixAudioOutput: null,
  bedAudio: null, // --bed-audio <path|video>: audio bed (defaults to input video's own audio)
  audioLoop: false, // --audio-loop: loop the bed to cover the full video duration
  audioFadeIn: null, // --audio-fade-in <sec>
  audioFadeOut: null, // --audio-fade-out <sec>
  mixAudio: null, // --mix-audio <path|video>: one extra track to overlay
  mixAt: null, // --mix-at <sec>: offset for the mix track (default 0)
  mixGain: null, // --mix-gain <db>: gain applied to the mix track (default 0)
  listMedia: null, // --list-media [images|audio|all]
  // Memory, personality, persona commands
  memoryAction: null, // set|get|list|remove
  memoryKey: null,
  memoryValue: null,
  memoryCategory: null,
  personalityAction: null, // set|get|clear
  personalityText: null,
  personaAction: null, // add|list|remove|resolve
  personaName: null,
  personaRelationship: null,
  personaDescription: null,
  personaTags: null,
  personaVoice: null,
  personaVoiceClip: null,
  personaPhoto: null, // alias for --ref when used with --persona-add
  apiChat: false,
  durableChat: false,
  apiBaseUrl: null,
  llmModel: DEFAULT_LLM_MODEL,
  apiTaskProfile: null,
  apiMaxTokens: null,
  apiThinking: null,
  apiTools: 'creative-agent',
  apiToolExecution: true,
  apiSystemPrompt: null,
  apiModelAction: null, // list|get
  apiModelId: null,
  apiReplayAction: null, // list|get|ingest
  apiReplayId: null,
  apiReplayInput: null,
  apiReplayLimit: 50,
  apiWorkflowAction: null, // start|list|get|events|stream|cancel|resume
  apiWorkflowTemplate: null, // storyboard_video
  apiWorkflowInput: null,
  apiWorkflowTitle: null,
  apiWorkflowIdempotencyKey: null,
  apiWorkflowId: null,
  apiWorkflowWatch: false,
  apiWorkflowMaxCost: null,
  apiWorkflowConfirmCost: null,
  apiVideoPrompt: null,
  apiNegativePrompt: null,
  apiGenerateAudio: null,
  apiExpandPrompt: null,
  storyboardFrames: null,
  skipRedact: false, // --skip-redact: bypass redactRunRecord (debug only)
  // Tier 4 contract-runtime debug surface (shared with sogni-chat + sogni-api):
  contractAction: null, // classify|compile|dispatch
  contractToolName: null,
  contractToolArgs: null,
  contractTurnSource: null, // hosted_chat|durable_chat|durable_workflow|public_skill
  // Tier 2 local storyboard planning surface:
  storyboardPlanAction: false,
  storyboardPlanFrames: null,
  storyboardPlanModel: null, // seedance|seedance2|gpt-image-2|ltx23|wan
  storyboardPlanStage: null, // storyboard_image|scene_clip
  noFilter: false // Disable NSFW content filter
};
const cliSet = {
  output: false,
  model: false,
  width: false,
  height: false,
  count: false,
  timeout: false,
  strictSize: false,
  quality: false,
  tokenType: false,
  steps: false,
  guidance: false,
  outputFormat: false,
  sampler: false,
  scheduler: false,
  loras: false,
  loraStrengths: false,
  multiAngle: false,
  azimuth: false,
  elevation: false,
  distance: false,
  angleStrength: false,
  angleDescription: false,
  seed: false,
  seedStrategy: false,
  music: false,
  musicLyrics: false,
  musicLanguage: false,
  musicBpm: false,
  musicKeyscale: false,
  musicTimesig: false,
  musicComposerMode: false,
  musicPromptStrength: false,
  musicCreativity: false,
  musicShift: false,
  video: false,
  workflow: false,
  fps: false,
  duration: false,
  frames: false,
  targetResolution: false,
  autoResizeVideoAssets: false,
  angles360Video: false,
  videoModel: false,
  refImage: false,
  refImageEnd: false,
  refAudio: false,
  refAudios: false,
  audioStart: false,
  audioDuration: false,
  referenceAudioIdentity: false,
  voicePersonaName: false,
  refVideo: false,
  refVideos: false,
  videoStart: false,
  context: false,
  looping: false,
  photobooth: false,
  cnStrength: false,
  cnGuidanceEnd: false,
  videoControlNetName: false,
  videoControlNetStrength: false,
  sam2Coordinates: false,
  trimEndFrame: false,
  firstFrameStrength: false,
  lastFrameStrength: false,
  apiBaseUrl: false,
  llmModel: false,
  apiTaskProfile: false,
  apiMaxTokens: false,
  apiThinking: false,
  apiTools: false,
  apiSystemPrompt: false,
  apiWorkflowTemplate: false,
  apiWorkflowInput: false,
  apiWorkflowTitle: false,
  apiWorkflowIdempotencyKey: false,
  apiWorkflowMaxCost: false,
  apiWorkflowConfirmCost: false,
  apiVideoPrompt: false,
  apiNegativePrompt: false,
  apiGenerateAudio: false,
  apiExpandPrompt: false,
  storyboardFrames: false
};

// Parse CLI args
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-o' || arg === '--output') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.output = expandHomePath(raw);
    cliSet.output = true;
  } else if (arg === '-m' || arg === '--model') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.model = raw;
    cliSet.model = true;
  } else if (arg === '-w' || arg === '--width') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.width = parsePositiveIntegerValue(raw, arg, 1, MAX_IMAGE_DIMENSION);
    cliSet.width = true;
  } else if (arg === '-h' || arg === '--height') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.height = parsePositiveIntegerValue(raw, arg, 1, MAX_IMAGE_DIMENSION);
    cliSet.height = true;
  } else if (arg === '-n' || arg === '--count') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    const parsedCount = parsePositiveIntegerValue(raw, arg);
    if (parsedCount > MAX_COUNT) {
      fatalCliError(`${arg} ${parsedCount} exceeds the safety cap of ${MAX_COUNT} outputs per invocation.`, {
        code: 'COUNT_LIMIT_EXCEEDED',
        details: { flag: arg, value: parsedCount, max: MAX_COUNT },
        hint: `Each output is a paid generation. Set SOGNI_MAX_COUNT=${parsedCount} to raise the cap deliberately.`
      });
    }
    options.count = parsedCount;
    cliSet.count = true;
  } else if (arg === '-t' || arg === '--timeout') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.timeout = parsePositiveIntegerValue(raw, arg) * 1000;
    cliSet.timeout = true;
  } else if (arg === '--quality' || arg === '-Q') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.quality = raw.toLowerCase();
    cliSet.quality = true;
  } else if (arg === '--token-type' || arg === '--token') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.tokenType = raw;
    cliSet.tokenType = true;
  } else if (arg === '--steps') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.steps = parsePositiveIntegerValue(raw, arg);
    cliSet.steps = true;
  } else if (arg === '--guidance') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.guidance = parseNumberValue(raw, arg);
    cliSet.guidance = true;
  } else if (arg === '--output-format' || arg === '--format') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.outputFormat = raw;
    cliSet.outputFormat = true;
  } else if (arg === '--sampler') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.sampler = raw;
    cliSet.sampler = true;
  } else if (arg === '--scheduler') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.scheduler = raw;
    cliSet.scheduler = true;
  } else if (arg === '--multi-angle' || arg === '--multiple-angles') {
    options.multiAngle = true;
    cliSet.multiAngle = true;
  } else if (arg === '--angles-360') {
    options.angles360 = true;
    options.multiAngle = true;
    cliSet.multiAngle = true;
  } else if (arg === '--angles-360-video') {
    options.angles360Video = true;
    cliSet.angles360Video = true;
    if (args[i + 1] && !args[i + 1].startsWith('-')) {
      options.angles360Video = args[++i];
    }
  } else if (arg === '--video-model' || arg === '--i2v-model') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.videoModel = raw;
    cliSet.videoModel = true;
  } else if (arg === '--azimuth') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.azimuth = raw;
    cliSet.azimuth = true;
  } else if (arg === '--elevation') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.elevation = raw;
    cliSet.elevation = true;
  } else if (arg === '--distance') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.distance = raw;
    cliSet.distance = true;
  } else if (arg === '--angle-strength' || arg === '--strength') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.angleStrength = parseNumberValue(raw, arg);
    cliSet.angleStrength = true;
  } else if (arg === '--angle-description' || arg === '--angle-anchor' || arg === '--description' || arg === '--anchor') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.angleDescription = raw;
    cliSet.angleDescription = true;
  } else if (arg === '--lora' || arg === '--lora-model') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.loras.push(raw);
    cliSet.loras = true;
  } else if (arg === '--loras') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.loras.push(...parseCsv(raw));
    cliSet.loras = true;
  } else if (arg === '--lora-strength') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.loraStrengths.push(parseNumberValue(raw, arg));
    cliSet.loraStrengths = true;
  } else if (arg === '--lora-strengths') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.loraStrengths.push(...parseNumberList(raw, arg));
    cliSet.loraStrengths = true;
  } else if (arg === '-s' || arg === '--seed') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.seed = parseSeedValue(raw, arg);
    cliSet.seed = true;
  } else if (arg === '--seed-strategy') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.seedStrategy = raw;
    cliSet.seedStrategy = true;
  } else if (arg === '--last-seed' || arg === '--reseed') {
    options.lastSeed = true;
  } else if (arg === '--music' || arg === '--generate-music') {
    options.music = true;
    cliSet.music = true;
  } else if (arg === '--music-model' || arg === '--audio-model') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.model = raw;
    cliSet.model = true;
  } else if (arg === '--lyrics') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.musicLyrics = raw;
    cliSet.musicLyrics = true;
  } else if (arg === '--language' || arg === '--lyrics-language') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.musicLanguage = raw;
    cliSet.musicLanguage = true;
  } else if (arg === '--bpm') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.musicBpm = parseBoundedNumberValue(raw, arg, MUSIC_BPM_LIMITS);
    cliSet.musicBpm = true;
  } else if (arg === '--keyscale' || arg === '--key-scale' || arg === '--key') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.musicKeyscale = raw;
    cliSet.musicKeyscale = true;
  } else if (arg === '--timesig' || arg === '--time-signature') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.musicTimesig = normalizeMusicTimeSignature(raw);
    cliSet.musicTimesig = true;
  } else if (arg === '--composer-mode') {
    options.musicComposerMode = true;
    cliSet.musicComposerMode = true;
  } else if (arg === '--no-composer-mode') {
    options.musicComposerMode = false;
    cliSet.musicComposerMode = true;
  } else if (arg === '--prompt-strength') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.musicPromptStrength = parseBoundedNumberValue(raw, arg, MUSIC_PROMPT_STRENGTH_LIMITS);
    cliSet.musicPromptStrength = true;
  } else if (arg === '--creativity') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.musicCreativity = parseBoundedNumberValue(raw, arg, MUSIC_CREATIVITY_LIMITS);
    cliSet.musicCreativity = true;
  } else if (arg === '--music-shift' || arg === '--audio-shift') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.musicShift = parseNumberValue(raw, arg);
    cliSet.musicShift = true;
  } else if (arg === '--audio-format') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.outputFormat = raw;
    cliSet.outputFormat = true;
  } else if (arg === '--length') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.duration = parsePositiveIntegerValue(raw, arg);
    cliSet.duration = true;
  } else if (arg === '--video' || arg === '-v') {
    options.video = true;
    cliSet.video = true;
  } else if (arg === '--workflow') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.videoWorkflow = raw;
    cliSet.workflow = true;
  } else if (arg === '--fps') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.fps = parsePositiveIntegerValue(raw, arg);
    cliSet.fps = true;
  } else if (arg === '--duration') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.duration = parsePositiveIntegerValue(raw, arg);
    cliSet.duration = true;
  } else if (arg === '--frames') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.frames = parsePositiveIntegerValue(raw, arg);
    cliSet.frames = true;
  } else if (arg === '--target-resolution' || arg === '--short-side') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.targetResolution = parsePositiveIntegerValue(raw, arg);
    cliSet.targetResolution = true;
  } else if (arg === '--auto-resize-assets') {
    options.autoResizeVideoAssets = true;
    cliSet.autoResizeVideoAssets = true;
  } else if (arg === '--no-auto-resize-assets') {
    options.autoResizeVideoAssets = false;
    cliSet.autoResizeVideoAssets = true;
  } else if (arg === '--ref' || arg === '--reference') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    options.refImage = raw;
    cliSet.refImage = true;
  } else if (arg === '--ref-end' || arg === '--end') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    options.refImageEnd = raw;
    cliSet.refImageEnd = true;
  } else if (arg === '--ref-audio' || arg === '--audio') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    if (!options.refAudio) {
      options.refAudio = raw;
      cliSet.refAudio = true;
    } else {
      options.refAudios.push(raw);
      cliSet.refAudios = true;
    }
  } else if (arg === '--audio-start') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.audioStart = parseNonNegativeNumberValue(raw, arg);
    cliSet.audioStart = true;
  } else if (arg === '--audio-duration') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.audioDuration = parseNonNegativeNumberValue(raw, arg);
    cliSet.audioDuration = true;
  } else if (arg === '--reference-audio-identity' || arg === '--voice-identity') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    options.referenceAudioIdentity = raw;
    cliSet.referenceAudioIdentity = true;
  } else if (arg === '--voice-persona') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.voicePersonaName = raw;
    cliSet.voicePersonaName = true;
  } else if (arg === '--ref-video') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    if (!options.refVideo) {
      options.refVideo = raw;
      cliSet.refVideo = true;
    } else {
      options.refVideos.push(raw);
      cliSet.refVideos = true;
    }
  } else if (arg === '--video-start' || arg === '--video-start-offset') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.videoStart = parseNonNegativeNumberValue(raw, arg);
    cliSet.videoStart = true;
  } else if (arg === '--looping' || arg === '--loop') {
    options.looping = true;
    cliSet.looping = true;
  } else if (arg === '-c' || arg === '--context') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    options.contextImages.push(raw);
    cliSet.context = true;
  } else if (arg === '--photobooth') {
    options.photobooth = true;
    cliSet.photobooth = true;
  } else if (arg === '--cn-strength') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.cnStrength = parseNumberValue(raw, arg);
    cliSet.cnStrength = true;
  } else if (arg === '--cn-guidance-end') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.cnGuidanceEnd = parseNumberValue(raw, arg);
    cliSet.cnGuidanceEnd = true;
  } else if (arg === '--controlnet-name') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.videoControlNetName = raw;
    cliSet.videoControlNetName = true;
  } else if (arg === '--controlnet-strength') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.videoControlNetStrength = parseNumberValue(raw, arg);
    cliSet.videoControlNetStrength = true;
  } else if (arg === '--sam2-coordinates') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    // Parse "x,y" or "x1,y1;x2,y2" format
    options.sam2Coordinates = raw.split(';').map(pair => {
      const [x, y] = pair.split(',').map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        fatalCliError(`Invalid --sam2-coordinates format "${raw}". Use x,y or x1,y1;x2,y2.`, {
          code: 'INVALID_ARGUMENT',
          details: { flag: '--sam2-coordinates', value: raw }
        });
      }
      return { x, y };
    });
    cliSet.sam2Coordinates = true;
  } else if (arg === '--trim-end-frame') {
    options.trimEndFrame = true;
    cliSet.trimEndFrame = true;
  } else if (arg === '--first-frame-strength') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.firstFrameStrength = parseNumberValue(raw, arg);
    cliSet.firstFrameStrength = true;
  } else if (arg === '--last-frame-strength') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.lastFrameStrength = parseNumberValue(raw, arg);
    cliSet.lastFrameStrength = true;
  } else if (arg === '--extract-last-frame') {
    const videoArg = requireFlagValue(args, i, arg);
    i++;
    const imageArg = requireFlagValue(args, i, arg + ' (output image)');
    i++;
    options.extractLastFrame = videoArg;
    options.extractLastFrameOutput = imageArg;
  } else if (arg === '--concat-videos') {
    // Consume remaining positional args: <output> <clip1> <clip2> [clip3...]
    const outArg = requireFlagValue(args, i, arg + ' (output path)');
    i++;
    const clips = [];
    while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
      i++;
      clips.push(args[i]);
    }
    if (clips.length < 2) {
      fatalCliError('--concat-videos requires at least 2 clip paths after the output path.', {
        code: 'INVALID_ARGUMENT',
        details: { flag: '--concat-videos', clipsProvided: clips.length }
      });
    }
    options.concatVideos = outArg;
    options.concatVideosClips = clips;
  } else if (arg === '--concat-audio') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.concatAudio = raw;
  } else if (arg === '--concat-audio-start') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.concatAudioStart = parseNonNegativeNumberValue(raw, arg);
  } else if (arg === '--concat-fps') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.concatFps = parseNumberValue(raw, arg);
  } else if (arg === '--extract-first-frame') {
    const videoArg = requireFlagValue(args, i, arg);
    i++;
    const imageArg = requireFlagValue(args, i, arg + ' (output image)');
    i++;
    options.extractFirstFrame = videoArg;
    options.extractFirstFrameOutput = imageArg;
  } else if (arg === '--remix-audio') {
    const inArg = requireFlagValue(args, i, arg + ' (input video)');
    i++;
    const outArg = requireFlagValue(args, i, arg + ' (output video)');
    i++;
    options.remixAudio = inArg;
    options.remixAudioOutput = outArg;
  } else if (arg === '--bed-audio') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.bedAudio = raw;
  } else if (arg === '--audio-loop') {
    options.audioLoop = true;
  } else if (arg === '--audio-fade-in') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.audioFadeIn = parseNonNegativeNumberValue(raw, arg);
  } else if (arg === '--audio-fade-out') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.audioFadeOut = parseNonNegativeNumberValue(raw, arg);
  } else if (arg === '--mix-audio') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.mixAudio = raw;
  } else if (arg === '--mix-at') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.mixAt = parseNonNegativeNumberValue(raw, arg);
  } else if (arg === '--mix-gain') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.mixGain = parseNumberValue(raw, arg);
  } else if (arg === '--list-media') {
    // Optional type argument (images|audio|all), default: images
    const next = args[i + 1];
    if (next && !next.startsWith('-') && ['images', 'audio', 'all'].includes(next)) {
      i++;
      options.listMedia = next;
    } else {
      options.listMedia = 'images';
    }
  // --- Hosted Sogni API paths ---
  } else if (arg === '--api-chat') {
    options.apiChat = true;
  } else if (arg === '--durable-chat') {
    options.apiChat = true;
    options.durableChat = true;
  } else if (arg === '--api-base-url' || arg === '--api-base') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiBaseUrl = raw;
    cliSet.apiBaseUrl = true;
  } else if (arg === '--llm-model') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.llmModel = raw;
    cliSet.llmModel = true;
  } else if (arg === '--task-profile') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiTaskProfile = raw;
    cliSet.apiTaskProfile = true;
  } else if (arg === '--max-tokens' || arg === '--max-completion-tokens') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiMaxTokens = parsePositiveIntegerValue(raw, arg);
    cliSet.apiMaxTokens = true;
  } else if (arg === '--thinking') {
    options.apiThinking = true;
    cliSet.apiThinking = true;
  } else if (arg === '--no-thinking') {
    options.apiThinking = false;
    cliSet.apiThinking = true;
  } else if (arg === '--api-tools') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiTools = raw;
    cliSet.apiTools = true;
  } else if (arg === '--no-api-tool-execution') {
    options.apiToolExecution = false;
  } else if (arg === '--system') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiSystemPrompt = raw;
    cliSet.apiSystemPrompt = true;
  } else if (arg === '--list-api-models' || arg === '--api-models') {
    options.apiModelAction = 'list';
  } else if (arg === '--get-api-model' || arg === '--api-model') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiModelAction = 'get';
    options.apiModelId = raw;
  } else if (arg === '--list-replays' || arg === '--list-replay-records') {
    options.apiReplayAction = 'list';
    const next = args[i + 1];
    if (next && !next.startsWith('-')) {
      i++;
      options.apiReplayLimit = parsePositiveIntegerValue(next, arg);
    }
  } else if (arg === '--get-replay' || arg === '--get-replay-record') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiReplayAction = 'get';
    options.apiReplayId = raw;
  } else if (arg === '--ingest-replay' || arg === '--ingest-replay-record') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiReplayAction = 'ingest';
    options.apiReplayInput = raw;
  } else if (arg === '--skip-redact' || arg === '--no-redact') {
    // Escape hatch for trusted offline debugging only. By default every
    // RunRecord that leaves the CLI is run through redactRunRecord /
    // redactPayload so signed URLs, bearer tokens, and JWTs can't leak.
    options.skipRedact = true;
  } else if (arg === '--turn-classify') {
    options.contractAction = 'classify';
  } else if (arg === '--compile-tools') {
    options.contractAction = 'compile';
  } else if (arg === '--dispatch-tool') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.contractAction = 'dispatch';
    options.contractToolName = raw;
  } else if (arg === '--tool-args') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.contractToolArgs = raw;
  } else if (arg === '--turn-source') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.contractTurnSource = raw;
  } else if (arg === '--storyboard-plan') {
    // Local-only: build a storyboard project + per-model compiled prompt
    // using the shared buildStoryboardProject / compileForModel adapters
    // (the same primitives that drive the hosted storyboard pipeline)
    // and print the result. Does not call the network.
    options.storyboardPlanAction = true;
  } else if (arg === '--storyboard-frames-local' || arg === '--storyboard-plan-frames') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.storyboardPlanFrames = parsePositiveIntegerValue(raw, arg);
  } else if (arg === '--storyboard-plan-model') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.storyboardPlanModel = raw;
  } else if (arg === '--storyboard-plan-stage') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.storyboardPlanStage = raw;
  } else if (arg === '--api-workflow' || arg === '--creative-workflow') {
    options.apiWorkflowAction = 'start';
    const next = args[i + 1];
    if (next && !next.startsWith('-') && normalizeApiWorkflowTemplate(next)) {
      i++;
      options.apiWorkflowTemplate = next;
      cliSet.apiWorkflowTemplate = true;
    }
  } else if (arg === '--workflow-input') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiWorkflowInput = raw;
    cliSet.apiWorkflowInput = true;
  } else if (arg === '--workflow-title') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiWorkflowTitle = raw;
    cliSet.apiWorkflowTitle = true;
  } else if (arg === '--workflow-idempotency-key' || arg === '--idempotency-key') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiWorkflowIdempotencyKey = raw;
    cliSet.apiWorkflowIdempotencyKey = true;
  } else if (arg === '--workflow-max-cost' || arg === '--max-workflow-cost') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiWorkflowMaxCost = parseNonNegativeNumberValue(raw, arg);
    cliSet.apiWorkflowMaxCost = true;
  } else if (arg === '--confirm-cost') {
    options.apiWorkflowConfirmCost = true;
    cliSet.apiWorkflowConfirmCost = true;
  } else if (arg === '--no-confirm-cost') {
    options.apiWorkflowConfirmCost = false;
    cliSet.apiWorkflowConfirmCost = true;
  } else if (arg === '--storyboard-frames') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.storyboardFrames = parsePositiveIntegerValue(raw, arg);
    cliSet.storyboardFrames = true;
  } else if (arg === '--video-prompt') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiVideoPrompt = raw;
    cliSet.apiVideoPrompt = true;
  } else if (arg === '--negative-prompt') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiNegativePrompt = raw;
    cliSet.apiNegativePrompt = true;
  } else if (arg === '--generate-audio') {
    options.apiGenerateAudio = true;
    cliSet.apiGenerateAudio = true;
  } else if (arg === '--no-generate-audio') {
    options.apiGenerateAudio = false;
    cliSet.apiGenerateAudio = true;
  } else if (arg === '--expand-prompt') {
    options.apiExpandPrompt = true;
    cliSet.apiExpandPrompt = true;
  } else if (arg === '--no-expand-prompt') {
    options.apiExpandPrompt = false;
    cliSet.apiExpandPrompt = true;
  } else if (arg === '--watch-workflow' || arg === '--watch') {
    options.apiWorkflowWatch = true;
  } else if (arg === '--list-workflows') {
    options.apiWorkflowAction = 'list';
  } else if (arg === '--get-workflow') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiWorkflowAction = 'get';
    options.apiWorkflowId = raw;
  } else if (arg === '--workflow-events') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiWorkflowAction = 'events';
    options.apiWorkflowId = raw;
  } else if (arg === '--stream-workflow') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiWorkflowAction = 'stream';
    options.apiWorkflowId = raw;
  } else if (arg === '--cancel-workflow') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiWorkflowAction = 'cancel';
    options.apiWorkflowId = raw;
  } else if (arg === '--resume-workflow') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.apiWorkflowAction = 'resume';
    options.apiWorkflowId = raw;
  // --- Memory commands ---
  } else if (arg === '--memory-set') {
    options.memoryAction = 'set';
    options.memoryKey = requireFlagValue(args, i, arg); i++;
    options.memoryValue = requireFlagValue(args, i, arg + ' (value)'); i++;
  } else if (arg === '--memory-get') {
    options.memoryAction = 'get';
    options.memoryKey = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--memory-list') {
    options.memoryAction = 'list';
  } else if (arg === '--memory-remove' || arg === '--memory-delete') {
    options.memoryAction = 'remove';
    options.memoryKey = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--memory-category') {
    options.memoryCategory = requireFlagValue(args, i, arg); i++;
  // --- Personality commands ---
  } else if (arg === '--personality-set') {
    options.personalityAction = 'set';
    options.personalityText = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--personality-get') {
    options.personalityAction = 'get';
  } else if (arg === '--personality-clear') {
    options.personalityAction = 'clear';
  // --- Persona commands ---
  } else if (arg === '--persona-add') {
    options.personaAction = 'add';
    options.personaName = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--persona-list') {
    options.personaAction = 'list';
  } else if (arg === '--persona-remove' || arg === '--persona-delete') {
    options.personaAction = 'remove';
    options.personaName = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--persona-resolve') {
    options.personaAction = 'resolve';
    options.personaName = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--persona') {
    // Shorthand: resolve persona + generate with context
    options.personaAction = 'generate';
    options.personaName = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--relationship') {
    options.personaRelationship = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--description') {
    options.personaDescription = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--tags') {
    options.personaTags = requireFlagValue(args, i, arg).split(',').map(s => s.trim()); i++;
  } else if (arg === '--voice') {
    options.personaVoice = requireFlagValue(args, i, arg); i++;
  } else if (arg === '--voice-clip') {
    options.personaVoiceClip = expandHomePath(requireFlagValue(args, i, arg)); i++;
  // --- Content filter ---
  } else if (arg === '--no-filter') {
    options.noFilter = true;
  } else if (arg === '--last-image') {
    // Use image from last render as reference/context
    if (existsSync(LAST_RENDER_PATH)) {
      const lastRender = JSON.parse(readFileSync(LAST_RENDER_PATH, 'utf8'));
      let lastImagePath = null;
      if (lastRender.localPath && existsSync(lastRender.localPath)) {
        lastImagePath = lastRender.localPath;
      } else if (lastRender.urls?.[0]) {
        lastImagePath = lastRender.urls[0];
      }
      if (lastImagePath) {
        // Will be resolved later: video uses refImage, image editing uses contextImages
        options._lastImagePath = lastImagePath;
      }
    }
  } else if (arg === '--last') {
    // Show last render info. Use CLI_WANTS_JSON (precomputed from raw argv)
    // because --json may appear after --last in the argument list.
    if (existsSync(LAST_RENDER_PATH)) {
      const rawLastRender = readFileSync(LAST_RENDER_PATH, 'utf8');
      if (CLI_WANTS_JSON) {
        let lastRecord;
        try { lastRecord = JSON.parse(rawLastRender); } catch { lastRecord = { raw: rawLastRender }; }
        console.log(JSON.stringify({ success: true, ...lastRecord }));
      } else {
        console.log(rawLastRender);
      }
      process.exit(0);
    }
    if (CLI_WANTS_JSON) {
      console.log(JSON.stringify({
        success: false,
        error: 'No previous render found.',
        errorCode: 'NO_LAST_RENDER',
        hint: 'Generate something first; the last render is recorded automatically.'
      }));
    } else {
      console.error('No previous render found.');
    }
    process.exit(1);
  } else if (arg === '--json') {
    options.json = true;
  } else if (arg === '--strict-size') {
    options.strictSize = true;
    cliSet.strictSize = true;
  } else if (arg === '-q' || arg === '--quiet') {
    options.quiet = true;
  } else if (arg === '--estimate-video-cost') {
    options.estimateVideoCost = true;
  } else if (arg === '--balance' || arg === '--balances') {
    options.showBalance = true;
  } else if (arg === '--version' || arg === '-V') {
    options.showVersion = true;
  } else if (arg === '--doctor' || (arg === 'doctor' && i === 0)) {
    options.doctor = true;
  } else if (arg === '--no-update-check') {
    // Update-check opt-out handled at module load; no-op here so the parser
    // doesn't reject it as an unknown option.
  } else if (arg === '--help') {
    console.log(`
sogni-agent - Generate images, videos, and music using Sogni AI

Usage: sogni-agent [options] "prompt"

Image Options:
  -o, --output <path>   Save to file (otherwise prints URL)
  -Q, --quality <tier>  Quality preset: fast|hq|pro (auto-selects model/steps/size)
  -m, --model <id>      Model (default: z_image_turbo_bf16, overrides --quality)
  -w, --width <px>      Width (default: 512)
  -h, --height <px>     Height (default: 512)
  -n, --count <num>     Number of outputs (default: 1)
  -s, --seed <num>      Use specific seed
  --last-seed           Reuse seed from previous render
  --seed-strategy <s>   Seed strategy: random|prompt-hash
  --multi-angle         Multiple angles LoRA mode (Qwen Image Edit)
  --angles-360          Generate 8 azimuths (front -> front-left)
  --angles-360-video [path]  Assemble a looping 360 mp4 using i2v between angles (requires ffmpeg)
  --video-model <id>    Override i2v model for 360 video (e.g. wan_v2.2-14b-fp8_i2v for higher quality)
  --azimuth <key>       front|front-right|right|back-right|back|back-left|left|front-left
  --elevation <key>     low-angle|eye-level|elevated|high-angle
  --distance <key>      close-up|medium|wide
  --angle-strength <n>  LoRA strength for multiple_angles (default: 0.9)
  --angle-description <text>  Optional subject description
  --output-format <f>   Image output format: png|jpg (webp for gpt-image-2)
  --sampler <name>      Sampler (model-dependent)
  --scheduler <name>    Scheduler (model-dependent)
  --lora <id>           LoRA id (repeatable, edit only)
  --loras <ids>         Comma-separated LoRA ids
  --lora-strength <n>   LoRA strength (repeatable)
  --lora-strengths <n>  Comma-separated LoRA strengths
  -c, --context <path>  Context image for editing (can use multiple)
  --last-image          Use last generated image as context

Photobooth (Face Transfer):
  --photobooth            Face transfer mode (InstantID + SDXL Turbo)
  --ref <path|url>        Face image (required with --photobooth)
  --cn-strength <n>       ControlNet strength (default: 0.8)
  --cn-guidance-end <n>   ControlNet guidance end point (default: 0.3)

Music Options:
  --music               Generate music/audio instead of image
  --music-model <id>    Music model: turbo|sft|ace_step_1.5_turbo|ace_step_1.5_sft
  --lyrics <text>       Optional song lyrics (omit for instrumental)
  --language <code>     Lyrics language code (default: en)
  --duration <sec>      Music duration in seconds (10-600, default: 30)
  --length <sec>        Alias for --duration
  --bpm <num>           Beats per minute (30-300)
  --keyscale <text>     Key/scale, e.g. "C major" or "A minor"
  --timesig <n>         Time signature: 2|3|4|6 (also accepts 4/4)
  --composer-mode       Enable AI composer mode
  --no-composer-mode    Disable AI composer mode
  --prompt-strength <n> Prompt adherence (0-10)
  --creativity <n>      Composition variation/temperature (0-2)
  --music-shift <n>     Audio model shift parameter (1-6)
  --audio-format <f>    Alias for --output-format: mp3|flac|wav

Video Options:
  --video, -v           Generate video instead of image
  --workflow <type>     Video workflow: t2v|i2v|s2v|ia2v|a2v|v2v|animate-move|animate-replace
  --fps <num>           Frames per second (model default unless set)
  --duration <sec>      Duration in seconds (default: 5)
  --frames <num>        Override total frames (optional)
  --target-resolution <px> Short-side target that preserves aspect ratio
  --auto-resize-assets  Auto-resize video reference assets (default)
  --no-auto-resize-assets  Disable auto-resize for video assets
  --estimate-video-cost Estimate video cost and exit
  --ref <path|url>      Reference image for video (start/first frame on Seedance)
  --ref-end <path|url>  End frame for interpolation/morphing (last frame on Seedance)
  --ref-audio <path|url> Audio reference. Repeatable on Seedance models (up to 3 total);
                         first entry is the primary, extras must be HTTPS URLs in CLI
                         direct-gen (use --api-chat for multi local-file uploads).
                         On LTX/WAN: single primary only (for ia2v/a2v/s2v lip-sync).
  --audio-start <sec>   Start offset into --ref-audio for audio-driven clips
  --audio-duration <sec> Duration slice from --ref-audio
  --reference-audio-identity <path>  Voice identity clip for LTX native audio
  --voice-persona <name>  Use saved persona voice clip as LTX voice identity
  --ref-video <path|url> Video reference. Repeatable on Seedance models (up to 3 total);
                         first entry is the primary, extras must be HTTPS URLs in CLI
                         direct-gen. On LTX/WAN: single primary for animate/v2v workflows.

Seedance Reference Modes (mutually exclusive on seedance2 / seedance2-fast):
  - DEDICATED FRAME MODE: --ref (first frame) and/or --ref-end (last frame).
    Best when you want canonical first/last frame anchoring; max 2 images.
  - LOOSE REFERENCE MODE: -c/--context image refs plus optional --ref-audio /
    --ref-video extras. Anchor frame intent in the prompt with @Image1, @Image2,
    @Video1, @Audio1 etc. (e.g. "Use @Image1 as the opening shot reference").
    Up to 9 image / 3 video / 3 audio / 12 total references per video request.
  Combining --ref/--ref-end with -c/--context on Seedance is rejected client-side.
  All three modalities pull caps from the canonical
  @sogni-ai/sogni-protocol seedance-reference-limits catalog.
  --video-start <sec>   Start offset into --ref-video for segmented V2V/animate
  --controlnet-name <n> ControlNet type for v2v: canny|pose|depth|detailer
  --controlnet-strength <n>  ControlNet strength for v2v (0.0-1.0, default: 0.8)
  --sam2-coordinates <coords>  SAM2 click coords for animate-replace (x,y or x1,y1;x2,y2)
  --trim-end-frame      Trim last frame for seamless video stitching
  --first-frame-strength <n>  Keyframe strength for start frame (0.0-1.0)
  --last-frame-strength <n>   Keyframe strength for end frame (0.0-1.0)
  --looping, --loop     Create seamless loop (i2v only): A→B→A
  --last-image          Use last generated image as reference

Hosted API Modes:
  --api-chat            Use /v1/chat/completions with Sogni creative-agent tools
  --durable-chat        Like --api-chat but routes through durable /v1/chat/runs + SSE
  --api-tools <mode>    creative-agent|creative-tools|none (default: creative-agent)
  --no-api-tool-execution  Ask for tool calls/plans but do not execute Sogni tools
  --llm-model <id>      LLM model for --api-chat (default: ${DEFAULT_LLM_MODEL})
  --task-profile <p>    LLM task profile for --api-chat: general|coding|reasoning
  --max-tokens <num>    Max chat completion tokens for --api-chat and storyboard planning
  --thinking, --no-thinking  Toggle chat_template_kwargs.enable_thinking
  --system <text>       System prompt for --api-chat
  --list-api-models     List Sogni Intelligence LLM models from /v1/models
  --get-api-model <id>  Fetch one Sogni Intelligence model descriptor
  --list-replays [n]    List recent /v1/replay/records (default: 50)
  --get-replay <id>     Fetch one replay RunRecord
  --ingest-replay <json|@path>  POST a RunRecord to /v1/replay/records (use @path to load JSON from a file)
  --api-workflow       Start /v1/creative-agent/workflows with durable input.steps
                         Optional preset: storyboard-video
  --workflow-input <json|@path> JSON durable workflow input (use @path to load JSON from a file)
  --workflow-title <text> Title for generated workflow input
  --workflow-idempotency-key <key> Reuse safely when retrying a workflow start request
  --workflow-max-cost <n> Reject the workflow if estimated capacity units exceed n
  --confirm-cost, --no-confirm-cost  Forward explicit workflow cost confirmation
  --storyboard-frames <n> Frame/beat count for the storyboard-video preset
  --video-prompt <text> Motion prompt for the generated-keyframe durable workflow
  --negative-prompt <text> Negative prompt for generated workflow steps
  --generate-audio, --no-generate-audio  Toggle audio generation for generated video steps
  --expand-prompt, --no-expand-prompt    Toggle prompt expansion for generated video steps
  --watch-workflow      Stream workflow events after starting
  --list-workflows      List recent durable creative workflows
  --get-workflow <id>   Fetch a workflow snapshot
  --workflow-events <id> Fetch workflow event history
  --stream-workflow <id> Stream workflow events over SSE
  --cancel-workflow <id> Cancel a running workflow
  --resume-workflow <id> Resume a failed, partial, waiting, or running durable workflow
  --api-base-url <url>  Sogni API base URL (default: ${DEFAULT_API_BASE_URL})

General:
  -t, --timeout <sec>   Timeout in seconds (default: 30, video: 300, music: 600)
  --steps <num>         Override steps (model-dependent)
  --guidance <num>      Override guidance (model-dependent)
  --token-type <type>   Token type: spark|sogni|auto (default: spark, auto retries with alternate)
  --balance, --balances Show SPARK/SOGNI balances and exit
  --doctor              Health check: Node, credentials, ffmpeg, auth, config, version
  --snooze-update       Snooze the pending update reminder (1 day → 2 days → 1 week)
  --whats-new [version] Show bundled CHANGELOG entries (everything after <version> if given)
  --version, -V         Show sogni-agent version and exit
  --no-update-check     Skip the once-daily npm update check for this run
  self-update           Upgrade sogni-agent in place (npm/pnpm/yarn/bun auto-detected)
  --extract-last-frame <video> <image>  Extract last frame from a video (safe ffmpeg wrapper)
  --extract-first-frame <video> <image> Extract first frame from a video (safe ffmpeg wrapper)
  --concat-videos <out> <clips...>      Concatenate video clips (safe ffmpeg wrapper, min 2 clips).
                        Normalizes fps/size and fills silent audio so mismatched clips stitch cleanly.
  --concat-fps <n>      Override target fps for --concat-videos (default: highest clip fps)
  --concat-audio <path> Optional audio track to mux over --concat-videos output
  --concat-audio-start <sec> Start offset into --concat-audio
  --remix-audio <in> <out>  Rebuild a video's audio without re-encoding video (safe ffmpeg wrapper).
                        Combine with the audio flags below.
  --bed-audio <path>    Audio bed for --remix-audio (path or video; defaults to input's own audio)
  --audio-loop          Loop the bed to cover the full video duration (--remix-audio)
  --audio-fade-in <sec> Fade the bed in over <sec> seconds (--remix-audio)
  --audio-fade-out <sec> Fade the bed out over <sec> seconds at the tail (--remix-audio)
  --mix-audio <path>    Overlay one extra audio track, mixed with the bed (--remix-audio)
  --mix-at <sec>        Start offset for --mix-audio (default: 0)
  --mix-gain <db>       Gain in dB applied to --mix-audio (default: 0)
  --list-media [type]   List recent inbound media files (images|audio|all, default: images)
  --no-filter           Disable NSFW content filter
  --last                Show last render info (JSON)
  --json                Output JSON with all details
  --strict-size         Do not auto-adjust video size to satisfy i2v reference resizing constraints
  -q, --quiet           Suppress progress output

Memory (persistent user preferences):
  --memory-set <key> <value>  Save a preference (e.g. --memory-set preferred_style "watercolor")
  --memory-get <key>          Get a specific memory
  --memory-list               List all saved memories
  --memory-remove <key>       Delete a memory
  --memory-category <cat>     Category for --memory-set: preference|fact|context (default: preference)

Personality (custom agent instructions):
  --personality-set <text>    Set personality (e.g. --personality-set "Be concise, use cinematic lighting")
  --personality-get           Show current personality
  --personality-clear         Reset to default personality

Personas (named people with reference photos):
  --persona-add <name>        Add a persona (combine with --ref, --relationship, --description, --voice-clip)
  --persona-list              List all saved personas
  --persona-remove <name>     Remove a persona and its files
  --persona-resolve <name>    Show persona details and file paths
  --persona <name>            Generate using a persona's reference photo (image context, video ref frame)
  --relationship <type>       Persona relationship: self|partner|child|friend|pet (default: friend)
  --description <text>        Persona appearance description
  --tags <names>              Comma-separated nicknames/aliases
  --voice <text>              Voice description (accent, tone, pitch)
  --voice-clip <path>         Voice clip audio file for LTX 2.3 voice cloning

Image Models:
  z_image_turbo_bf16              Fast, general purpose (default)
  gpt-image-2                     OpenAI GPT Image 2 text-to-image and edit (up to 16 context images)
  flux1-schnell-fp8               Very fast
  flux2_dev_fp8                   High quality (slow)
  qwen_image_edit_2511_fp8        Image editing with context (up to 3 images)
  qwen_image_edit_2511_fp8_lightning  Fast image editing

Recommended LTX 2.3 Video Models:
  ltx23-22b-fp8_t2v_distilled     Text-to-video with native dialogue/audio
  ltx23-22b-fp8_i2v_distilled     Image-to-video with native dialogue/audio
  ltx23-22b-fp8_ia2v_distilled    Image+audio-to-video
  ltx23-22b-fp8_a2v_distilled     Audio-to-video
  ltx23-22b-fp8_v2v_distilled     Video-to-video with ControlNet

Music Models:
  ace_step_1.5_turbo              Default direct music generation
  ace_step_1.5_sft                Experimental model with stronger lyric handling

Seedance 2.0 Video Model Selectors:
  seedance2                         Text-to-video, 4-15s, native audio, HTTPS multimodal refs
  seedance2-fast                    Fast 720p-capped text-to-video
  seedance2-ia2v                    Image+audio-to-video
  seedance2-v2v                     Video-to-video without ControlNet

WAN 2.2 Video Models:
  wan_v2.2-14b-fp8_t2v_lightx2v   Text-to-video (fast)
  wan_v2.2-14b-fp8_i2v_lightx2v   Fast simple image-to-video
  wan_v2.2-14b-fp8_i2v            Higher quality
  wan_v2.2-14b-fp8_s2v_lightx2v   Face lip-sync with uploaded audio (fast)
  wan_v2.2-14b-fp8_s2v            Sound-to-video (quality)
  wan_v2.2-14b-fp8_animate-move_lightx2v     Animate-move (fast)
  wan_v2.2-14b-fp8_animate-replace_lightx2v  Animate-replace (fast)

LTX-2 / LTX-2.3 Video Models:
  ltx2-19b-fp8_t2v_distilled      Text-to-video, fast 8-step
  ltx2-19b-fp8_t2v                Text-to-video, quality 20-step
  ltx2-19b-fp8_i2v_distilled      Image-to-video, fast 8-step
  ltx2-19b-fp8_i2v                Image-to-video, quality 20-step
  ltx2-19b-fp8_ia2v_distilled     Image+audio-to-video, fast 8-step
  ltx2-19b-fp8_a2v_distilled      Audio-to-video, fast 8-step
  ltx2-19b-fp8_v2v_distilled      Video-to-video with ControlNet (fast)
  ltx2-19b-fp8_v2v                Video-to-video with ControlNet (quality)

Examples:
  sogni-agent "a cat wearing a hat"
  sogni-agent -o cat.jpg "a cat" 
  sogni-agent --multi-angle -c subject.jpg --azimuth front-right --elevation eye-level --distance medium "studio portrait"
  sogni-agent --angles-360 -c subject.jpg "studio portrait"
  sogni-agent --video --ref cat.jpg -o cat.mp4 "cat walks around"
  sogni-agent --video 'A narrator says "welcome to the story" as ocean waves crash'
  sogni-agent --video --ref cat.jpg --ref-audio speech.m4a -m wan_v2.2-14b-fp8_s2v_lightx2v "lip sync"
  sogni-agent --video --ref cover.jpg --ref-audio song.mp3 "music video"
  sogni-agent --video --ref-audio song.mp3 "abstract music visualizer"
  sogni-agent --music --duration 30 "uplifting cinematic synthwave theme for a product launch"
  sogni-agent --music --lyrics "Rise with the morning light" --bpm 128 --keyscale "C major" --output-format mp3 "bright indie pop chorus"
  sogni-agent --video --reference-audio-identity voice.webm 'NARRATOR: "This is my voice."'
  sogni-agent --api-chat "Create a 4-shot product video concept for a red sneaker"
  sogni-agent --api-workflow --video-prompt "slow push-in as it comes alive" "a graphite robot sketch"
  sogni-agent --api-workflow --workflow-input @workflow.json
  sogni-agent --api-workflow storyboard-video --storyboard-frames 6 "Create a 12s 9:16 bakery launch video with GPT Image 2 and Seedance"
  sogni-agent --video -m ltx23-22b-fp8_t2v_distilled --duration 20 "A wide cinematic aerial shot opens over steep tropical cliffs at golden hour, warm sunlight grazing the rock faces while sea mist drifts above the water below. Palm trees bend gently along the ridge as waves roll against the shoreline, leaving bright bands of foam across the dark stone. The camera glides forward in one continuous pass, revealing more of the coastline as sunlight flickers across wet surfaces and distant birds wheel through the haze. The scene holds a calm, upscale travel-film mood with smooth stabilized motion and crisp environmental detail."
  sogni-agent --video --ref subject.jpg --ref-video motion.mp4 --workflow animate-move "transfer motion"
  sogni-agent --video --last-image "gentle camera pan"
  sogni-agent -c photo.jpg "make the background a beach" -m qwen_image_edit_2511_fp8
  sogni-agent -c subject.jpg -c style.jpg "apply the style to the subject"
  sogni-agent --photobooth --ref face.jpg "80s fashion portrait"
  sogni-agent --photobooth --ref face.jpg -n 4 "LinkedIn professional headshot"
  sogni-agent -Q pro "a beautiful mountain landscape at sunset"
  sogni-agent -n 3 "a {red|blue|green} sports car on a highway"
`);
    process.exit(0);
  } else if (arg === '--') {
    if (!options.prompt && args[i + 1] !== undefined) {
      options.prompt = args[i + 1];
    }
    break;
  } else if (arg.startsWith('-')) {
    fatalCliError(`Unknown option: ${arg}`, {
      code: 'INVALID_ARGUMENT',
      hint: 'Use --help to see supported options. If your prompt itself begins with "-", pass it after a standalone "--" separator, e.g. sogni-agent -- "-5 degrees outside".'
    });
  } else if (!options.prompt) {
    options.prompt = arg;
  }
}

let timeoutFromConfig = false;
let widthFromConfig = false;
let heightFromConfig = false;
let fpsFromConfig = false;
let widthFromPrompt = false;
let heightFromPrompt = false;
let targetResolutionFromPrompt = false;
let durationFromPrompt = false;
let aspectRatioFromPrompt = null;
let configuredDefaultVideoWorkflow = null;
if (openclawConfig) {
  const isNumber = (value) => Number.isFinite(value);
  if (!cliSet.width && isNumber(openclawConfig.defaultWidth)) {
    options.width = openclawConfig.defaultWidth;
    widthFromConfig = true;
  }
  if (!cliSet.height && isNumber(openclawConfig.defaultHeight)) {
    options.height = openclawConfig.defaultHeight;
    heightFromConfig = true;
  }
  if (!cliSet.count && isNumber(openclawConfig.defaultCount)) {
    options.count = Math.min(openclawConfig.defaultCount, MAX_COUNT);
  }
  if (!cliSet.tokenType && openclawConfig.defaultTokenType) {
    options.tokenType = openclawConfig.defaultTokenType;
  }
  if (!cliSet.apiBaseUrl && openclawConfig.apiBaseUrl) {
    options.apiBaseUrl = openclawConfig.apiBaseUrl;
  }
  if (!cliSet.llmModel && openclawConfig.defaultLlmModel) {
    options.llmModel = openclawConfig.defaultLlmModel;
  }
  if (!cliSet.apiTaskProfile && openclawConfig.defaultTaskProfile) {
    options.apiTaskProfile = openclawConfig.defaultTaskProfile;
  }
  if (!cliSet.apiMaxTokens && Number.isSafeInteger(openclawConfig.defaultApiMaxTokens)) {
    if (openclawConfig.defaultApiMaxTokens < 1) {
      fatalCliError('OpenClaw config defaultApiMaxTokens must be a positive integer.', {
        code: 'INVALID_CONFIG',
        details: { field: 'defaultApiMaxTokens', value: openclawConfig.defaultApiMaxTokens }
      });
    }
    options.apiMaxTokens = openclawConfig.defaultApiMaxTokens;
  }
  if (!cliSet.apiThinking && typeof openclawConfig.defaultApiThinking === 'boolean') {
    options.apiThinking = openclawConfig.defaultApiThinking;
  }
  if (!cliSet.apiTools && openclawConfig.defaultApiToolMode) {
    options.apiTools = openclawConfig.defaultApiToolMode;
  }
  if (!cliSet.apiWorkflowMaxCost && isNumber(openclawConfig.defaultWorkflowMaxCost)) {
    if (openclawConfig.defaultWorkflowMaxCost < 0) {
      fatalCliError('OpenClaw config defaultWorkflowMaxCost must be a non-negative number.', {
        code: 'INVALID_CONFIG',
        details: { field: 'defaultWorkflowMaxCost', value: openclawConfig.defaultWorkflowMaxCost }
      });
    }
    options.apiWorkflowMaxCost = openclawConfig.defaultWorkflowMaxCost;
  }
  if (!cliSet.apiWorkflowConfirmCost && typeof openclawConfig.defaultWorkflowConfirmCost === 'boolean') {
    options.apiWorkflowConfirmCost = openclawConfig.defaultWorkflowConfirmCost;
  }
  if (!cliSet.seedStrategy && openclawConfig.seedStrategy) {
    options.seedStrategy = openclawConfig.seedStrategy;
  }
  if (options.music) {
    if (!cliSet.duration && isNumber(openclawConfig.defaultMusicDurationSec)) {
      options.duration = openclawConfig.defaultMusicDurationSec;
    }
    if (!cliSet.timeout && isNumber(openclawConfig.defaultMusicTimeoutSec)) {
      options.timeout = openclawConfig.defaultMusicTimeoutSec * 1000;
      timeoutFromConfig = true;
    }
  } else if (options.video) {
    if (!cliSet.workflow && openclawConfig.defaultVideoWorkflow) {
      configuredDefaultVideoWorkflow = openclawConfig.defaultVideoWorkflow;
    }
    if (!cliSet.fps && isNumber(openclawConfig.defaultFps)) {
      options.fps = openclawConfig.defaultFps;
      fpsFromConfig = true;
    }
    if (!cliSet.frames && !cliSet.duration && isNumber(openclawConfig.defaultDurationSec)) {
      options.duration = openclawConfig.defaultDurationSec;
    }
    if (!cliSet.timeout && isNumber(openclawConfig.defaultVideoTimeoutSec)) {
      options.timeout = openclawConfig.defaultVideoTimeoutSec * 1000;
      timeoutFromConfig = true;
    }
  } else if (!cliSet.timeout && isNumber(openclawConfig.defaultImageTimeoutSec)) {
    options.timeout = openclawConfig.defaultImageTimeoutSec * 1000;
    timeoutFromConfig = true;
  }
}

if (options.tokenType) {
  const token = options.tokenType.toLowerCase();
  if (token !== 'spark' && token !== 'sogni' && token !== 'auto') {
    fatalCliError('--token-type must be "spark", "sogni", or "auto".', {
      code: 'INVALID_ARGUMENT',
      details: { flag: '--token-type', value: options.tokenType }
    });
  }
  options.tokenType = token;
}

if (options.apiTaskProfile) {
  const profile = String(options.apiTaskProfile).trim().toLowerCase();
  if (!VALID_API_TASK_PROFILES.has(profile)) {
    fatalCliError('--task-profile must be "general", "coding", or "reasoning".', {
      code: 'INVALID_ARGUMENT',
      details: { flag: '--task-profile', value: options.apiTaskProfile }
    });
  }
  options.apiTaskProfile = profile;
}

const normalizedApiToolMode = normalizeApiToolMode(options.apiTools);
if (normalizedApiToolMode === null) {
  fatalCliError('--api-tools must be "creative-agent", "creative-tools", or "none".', {
    code: 'INVALID_ARGUMENT',
    details: { flag: '--api-tools', value: options.apiTools }
  });
}
options.apiTools = normalizedApiToolMode;

if (options.apiWorkflowTemplate) {
  const normalized = normalizeApiWorkflowTemplate(options.apiWorkflowTemplate);
  if (!normalized) {
    fatalCliError('--api-workflow preset must be "storyboard-video".', {
      code: 'INVALID_ARGUMENT',
      details: { flag: '--api-workflow', value: options.apiWorkflowTemplate }
    });
  }
  options.apiWorkflowTemplate = normalized;
}

if (options.quality) {
  if (!QUALITY_TIERS[options.quality]) {
    fatalCliError('--quality must be "fast", "hq", or "pro".', {
      code: 'INVALID_ARGUMENT',
      details: { flag: '--quality', value: options.quality }
    });
  }
  if (options.music) {
    fatalCliError('--quality is not used for --music. Use --music-model turbo|sft for music model selection.', {
      code: 'INVALID_ARGUMENT'
    });
  }
  const tier = QUALITY_TIERS[options.quality];
  if (!options.video && !options.music) {
    // Only apply model if user didn't explicitly set one.
    if (!cliSet.model) {
      options.model = tier.model;
    }
    // Only apply steps if user didn't explicitly set them.
    if (!cliSet.steps && tier.steps) {
      options.steps = tier.steps;
    }
    // Auto-target short-side dimension if user didn't set width/height.
    if (tier.shortSide && !cliSet.width && !cliSet.height) {
      options.width = tier.shortSide;
      options.height = tier.shortSide;
    }
  }
}

if (options.seedStrategy) {
  const normalizedStrategy = normalizeSeedStrategy(options.seedStrategy);
  if (!normalizedStrategy) {
    fatalCliError('--seed-strategy must be "random" or "prompt-hash".', {
      code: 'INVALID_ARGUMENT',
      details: { flag: '--seed-strategy', value: options.seedStrategy }
    });
  }
  options.seedStrategy = normalizedStrategy;
}

if (cliSet.steps && !Number.isFinite(options.steps)) {
  fatalCliError('--steps must be a number.', {
    code: 'INVALID_ARGUMENT',
    details: { flag: '--steps', value: options.steps }
  });
}

if (cliSet.guidance && !Number.isFinite(options.guidance)) {
  fatalCliError('--guidance must be a number.', {
    code: 'INVALID_ARGUMENT',
    details: { flag: '--guidance', value: options.guidance }
  });
}

if (options.music && options.video) {
  fatalCliError('--music cannot be combined with --video.', { code: 'INVALID_ARGUMENT' });
}

if (options.music && (
  cliSet.width ||
  cliSet.height ||
  options.strictSize ||
  options.multiAngle ||
  options.angles360Video ||
  options.photobooth ||
  options.contextImages.length > 0 ||
  options.refImage ||
  options.refImageEnd
)) {
  fatalCliError('--music cannot be combined with image/video reference or sizing options.', {
    code: 'INVALID_ARGUMENT'
  });
}

if (options.multiAngle) {
  if (options.video) {
    fatalCliError('--multi-angle is only for image editing.', { code: 'INVALID_ARGUMENT' });
  }
  if (options.angles360Video && !options.angles360) {
    fatalCliError('--angles-360-video requires --angles-360.', { code: 'INVALID_ARGUMENT' });
  }
  if (options.angles360Video && options.count !== 1) {
    fatalCliError('--angles-360-video requires --count 1.', {
      code: 'INVALID_ARGUMENT',
      details: { count: options.count }
    });
  }
  if (options._lastImagePath && options.contextImages.length === 0) {
    options.contextImages.push(options._lastImagePath);
    delete options._lastImagePath;
  }
  if (options.contextImages.length === 0) {
    fatalCliError('--multi-angle requires a reference image (--context or --last-image).', {
      code: 'INVALID_ARGUMENT'
    });
  }
  const azimuthKeys = MULTI_ANGLE_AZIMUTHS.map((a) => a.key);
  const elevationKeys = MULTI_ANGLE_ELEVATIONS.map((e) => e.key);
  const distanceKeys = MULTI_ANGLE_DISTANCES.map((d) => d.key);

  if (!options.angles360) {
    options.azimuth = normalizeMultiAngleValue(options.azimuth, MULTI_ANGLE_AZIMUTH_ALIASES, azimuthKeys, 'azimuth');
  } else if (!options.quiet && cliSet.azimuth) {
    console.error('Warning: --azimuth ignored for --angles-360.');
  }
  options.elevation = normalizeMultiAngleValue(options.elevation, MULTI_ANGLE_ELEVATION_ALIASES, elevationKeys, 'elevation');
  options.distance = normalizeMultiAngleValue(options.distance, MULTI_ANGLE_DISTANCE_ALIASES, distanceKeys, 'distance');

  if (options.model && !options.model.includes('qwen_image_edit_2511')) {
    fatalCliError('--multi-angle requires a Qwen Image Edit 2511 model.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model }
    });
  }
  if (!options.model) {
    options.model = 'qwen_image_edit_2511_fp8_lightning';
  }
  if (!options.outputFormat) {
    options.outputFormat = 'jpg';
  }
  if (!options.sampler) {
    options.sampler = 'euler';
  }
  if (!options.scheduler) {
    options.scheduler = 'simple';
  }
  if (!options.angleDescription && options.prompt) {
    options.angleDescription = options.prompt;
  }
  if (options.loras.length === 0 && options.loraStrengths.length > 0) {
    if (options.loraStrengths.length > 1) {
      fatalCliError('--lora-strengths requires explicit --loras when using --multi-angle.', {
        code: 'INVALID_ARGUMENT'
      });
    }
    if (options.angleStrength === null || options.angleStrength === undefined) {
      options.angleStrength = options.loraStrengths[0];
    }
    options.loraStrengths = [];
  }
  if (!cliSet.guidance && (options.guidance === null || options.guidance === undefined)) {
    options.guidance = options.model.includes('lightning') ? 1.0 : 4.0;
  }
  if (options.angleStrength === null || options.angleStrength === undefined) {
    options.angleStrength = 0.9;
  }

  const multiAngleStrength = options.angleStrength;
  let multiAngleIndex = options.loras.indexOf('multiple_angles');
  if (multiAngleIndex === -1) {
    options.loras.push('multiple_angles');
    multiAngleIndex = options.loras.length - 1;
    if (options.loraStrengths.length > 0) {
      options.loraStrengths.push(multiAngleStrength);
    }
  }

  if (options.loraStrengths.length === 0 && options.loras.length > 0) {
    options.loraStrengths = options.loras.map((id) => (id === 'multiple_angles' ? multiAngleStrength : 1.0));
  } else if (options.loraStrengths.length === options.loras.length) {
    if (options.loraStrengths[multiAngleIndex] === undefined || options.loraStrengths[multiAngleIndex] === null) {
      options.loraStrengths[multiAngleIndex] = multiAngleStrength;
    }
  }
}

if (options.outputFormat) {
  const normalized = options.outputFormat.toLowerCase();
  options.outputFormat = normalized === 'jpeg' ? 'jpg' : normalized;
  if (options.music) {
    if (!MUSIC_OUTPUT_FORMATS.has(options.outputFormat)) {
      fatalCliError('Music output format must be "mp3", "flac", or "wav".', {
        code: 'INVALID_ARGUMENT',
        details: { outputFormat: options.outputFormat }
      });
    }
  } else if (options.video) {
    if (options.outputFormat !== 'mp4') {
      fatalCliError('Video output format must be "mp4".', {
        code: 'INVALID_ARGUMENT',
        details: { outputFormat: options.outputFormat }
      });
    }
  } else if (!['png', 'jpg', ...(isGptImage2ModelSelection(options.model) ? ['webp'] : [])].includes(options.outputFormat)) {
    fatalCliError(isGptImage2ModelSelection(options.model) ? 'GPT Image 2 output format must be "png", "jpg", or "webp".' : 'Image output format must be "png" or "jpg".', {
      code: 'INVALID_ARGUMENT',
      details: { outputFormat: options.outputFormat }
    });
  }
}

if (options.loraStrengths.length > 0 && options.loras.length === 0) {
  fatalCliError('--lora-strength requires at least one --lora.', { code: 'INVALID_ARGUMENT' });
}

if (options.loraStrengths.length > 0 && options.loras.length > 0 &&
    options.loraStrengths.length !== options.loras.length) {
  fatalCliError('--lora-strengths count must match --loras count.', {
    code: 'INVALID_ARGUMENT',
    details: { loras: options.loras.length, loraStrengths: options.loraStrengths.length }
  });
}

if ((options.video || options.music) && options.loras.length > 0) {
  fatalCliError('--lora options are image-only.', { code: 'INVALID_ARGUMENT' });
}

if (options.video && (options.sampler || options.scheduler)) {
  fatalCliError('--sampler/--scheduler are image-only options.', { code: 'INVALID_ARGUMENT' });
}

applyPersonaAndVoiceReferences();

if (!options.video && options.autoResizeVideoAssets !== null) {
  fatalCliError('--auto-resize-assets is only valid with --video.', { code: 'INVALID_ARGUMENT' });
}

if (options.estimateVideoCost && !options.video) {
  fatalCliError('--estimate-video-cost requires --video.', { code: 'INVALID_ARGUMENT' });
}

if (options.angles360Video && !options.angles360) {
  fatalCliError('--angles-360-video requires --angles-360.', { code: 'INVALID_ARGUMENT' });
}

// Normalize/validate video workflow before applying defaults
if (options.video) {
  if (options.videoWorkflow) {
    const normalized = normalizeVideoWorkflow(options.videoWorkflow);
    if (!normalized) {
      fatalCliError(`Unknown workflow "${options.videoWorkflow}". Use t2v|i2v|s2v|ia2v|a2v|v2v|animate-move|animate-replace.`, {
        code: 'INVALID_ARGUMENT',
        details: { workflow: options.videoWorkflow }
      });
    }
    options.videoWorkflow = normalized;
  }

  if (
    options._lastImagePath &&
    !options.refImage &&
    (!options.videoWorkflow || workflowRequiresImage(options.videoWorkflow) || isSeedanceModelSelection(options.model))
  ) {
    options.refImage = options._lastImagePath;
    delete options._lastImagePath;
  }

  applyCreativeBrainPreflight();

  if (!options.videoWorkflow && isSeedanceModelSelection(options.model)) {
    if (options.refVideo) {
      options.videoWorkflow = 'v2v';
    } else if (options.refAudio && (options.refImage || options.refImageEnd)) {
      options.videoWorkflow = 'ia2v';
    } else {
      options.videoWorkflow = 't2v';
    }
  }

  const workflowFromModel = inferVideoWorkflowFromModel(resolveVideoModelAlias(options.model, options.videoWorkflow));
  if (options.videoWorkflow && workflowFromModel && options.videoWorkflow !== workflowFromModel) {
    fatalCliError(`Workflow "${options.videoWorkflow}" does not match model "${options.model}".`, {
      code: 'INVALID_ARGUMENT',
      details: { workflow: options.videoWorkflow, model: options.model }
    });
  }
  if (!options.videoWorkflow) {
    options.videoWorkflow = workflowFromModel || inferVideoWorkflowFromAssets(options) || configuredDefaultVideoWorkflow || 't2v';
  }
  if (options.model) {
    options.model = resolveVideoModelAlias(options.model, options.videoWorkflow);
  }
}

// Resolve --last-image after workflow is known
if (options._lastImagePath) {
  if (options.video) {
    if (workflowRequiresImage(options.videoWorkflow)) {
      if (!options.refImage) options.refImage = options._lastImagePath;
    } else if (!options.quiet) {
      console.error(`Warning: --last-image ignored for ${options.videoWorkflow || 'current'} workflow.`);
    }
  } else if (options.photobooth) {
    if (!options.refImage) options.refImage = options._lastImagePath;
  } else {
    options.contextImages.push(options._lastImagePath);
  }
  delete options._lastImagePath;
}

// Set defaults based on type and context
if (options.music) {
  const configuredMusicModel = options.model || openclawConfig?.defaultMusicModel || 'turbo';
  options.model = normalizeMusicModelId(configuredMusicModel);
  if (!options.model) {
    fatalCliError(`Unknown music model "${configuredMusicModel}". Use turbo, sft, ace_step_1.5_turbo, or ace_step_1.5_sft.`, {
      code: 'INVALID_ARGUMENT',
      details: { flag: cliSet.model ? '--model' : 'defaultMusicModel', value: configuredMusicModel }
    });
  }
  const musicDefaults = getMusicModelDefaults(options.model);
  if (!cliSet.duration || !Number.isFinite(options.duration)) {
    options.duration = MUSIC_DURATION_LIMITS.default;
  }
  if (!options.outputFormat) {
    options.outputFormat = 'mp3';
  }
  if (!cliSet.steps) {
    options.steps = musicDefaults.steps.default;
  }
  if (!cliSet.guidance && musicDefaults.guidance) {
    options.guidance = musicDefaults.guidance.default;
  }
  if (!cliSet.sampler) {
    options.sampler = musicDefaults.sampler.default;
  }
  if (!cliSet.scheduler) {
    options.scheduler = musicDefaults.scheduler.default;
  }
  if (!cliSet.musicShift) {
    options.musicShift = musicDefaults.shift.default;
  }
  if (!cliSet.timeout && !timeoutFromConfig && options.timeout === 30000) {
    options.timeout = 600000;
  }
} else if (options.video) {
  options.model = options.model || selectDefaultVideoModel(options.videoWorkflow, options, openclawConfig) || 'wan_v2.2-14b-fp8_i2v_lightx2v';
  options.model = resolveVideoModelAlias(options.model, options.videoWorkflow);
  const videoModelDefaults = getModelDefaults(options.model, openclawConfig);
  const isSeedanceVideo = isSeedanceModel(options.model);
  if (!cliSet.width && !widthFromConfig && !widthFromPrompt && Number.isFinite(videoModelDefaults?.defaultWidth)) {
    options.width = videoModelDefaults.defaultWidth;
  }
  if (!cliSet.height && !heightFromConfig && !heightFromPrompt && Number.isFinite(videoModelDefaults?.defaultHeight)) {
    options.height = videoModelDefaults.defaultHeight;
  }
  if (!cliSet.fps && !fpsFromConfig && Number.isFinite(videoModelDefaults?.fps)) {
    options.fps = videoModelDefaults.fps;
  }
  const videoQuality = options.quality ? QUALITY_TIERS[options.quality]?.video : null;
  if (videoQuality) {
    if (!isSeedanceVideo && !cliSet.steps && Number.isFinite(videoQuality.steps)) {
      options.steps = videoQuality.steps;
    }
  }
  const videoShortSide = (cliSet.targetResolution || targetResolutionFromPrompt)
    ? options.targetResolution
    : (!isSeedanceVideo ? videoQuality?.shortSide : null);
  if (videoShortSide && !cliSet.width && !cliSet.height && !widthFromConfig && !heightFromConfig && !widthFromPrompt && !heightFromPrompt) {
    const dims = dimensionsWithShortSide(options.width, options.height, videoShortSide);
    options.width = dims.width;
    options.height = dims.height;
  }
  if (aspectRatioFromPrompt && !cliSet.width && !cliSet.height) {
    const dims = dimensionsForAspectRatio(options.width, options.height, aspectRatioFromPrompt);
    if (dims) {
      options.width = dims.width;
      options.height = dims.height;
      widthFromPrompt = true;
      heightFromPrompt = true;
    }
  }
  if (!cliSet.timeout && !timeoutFromConfig && options.timeout === 30000) {
    options.timeout = 300000; // 5 min for video
  }
} else if (options.photobooth) {
  // Photobooth uses SDXL Turbo + InstantID ControlNet
  options.model = options.model || openclawConfig?.defaultPhotoboothModel || 'coreml-sogniXLturbo_alpha1_ad';
  if (!cliSet.width) options.width = 1024;
  if (!cliSet.height) options.height = 1024;
  if (!cliSet.timeout && !timeoutFromConfig && options.timeout === 30000) {
    options.timeout = 60000;
  }
} else if (options.contextImages.length > 0) {
  // Use qwen edit model when context images provided (unless model explicitly set)
  options.model = options.model || openclawConfig?.defaultEditModel || 'qwen_image_edit_2511_fp8_lightning';
  if (!cliSet.timeout && !timeoutFromConfig && options.timeout === 30000) {
    options.timeout = 60000; // 1 min for editing
  }
} else {
  options.model = options.model || openclawConfig?.defaultImageModel || 'z_image_turbo_bf16';
}

if (options.music) {
  const musicDefaults = getMusicModelDefaults(options.model);
  if (options.duration < MUSIC_DURATION_LIMITS.min || options.duration > MUSIC_DURATION_LIMITS.max) {
    fatalCliError(`Music duration must be between ${MUSIC_DURATION_LIMITS.min} and ${MUSIC_DURATION_LIMITS.max} seconds.`, {
      code: 'INVALID_ARGUMENT',
      details: { duration: options.duration }
    });
  }
  if (options.musicBpm !== null && options.musicBpm !== undefined) {
    if (options.musicBpm < MUSIC_BPM_LIMITS.min || options.musicBpm > MUSIC_BPM_LIMITS.max) {
      fatalCliError(`Music BPM must be between ${MUSIC_BPM_LIMITS.min} and ${MUSIC_BPM_LIMITS.max}.`, {
        code: 'INVALID_ARGUMENT',
        details: { bpm: options.musicBpm }
      });
    }
  }
  if (options.musicTimesig && !MUSIC_TIME_SIGNATURES.has(options.musicTimesig)) {
    fatalCliError('--timesig must be one of 2, 3, 4, or 6.', {
      code: 'INVALID_ARGUMENT',
      details: { timesig: options.musicTimesig }
    });
  }
  if (options.steps !== null && options.steps !== undefined) {
    const { min, max } = musicDefaults.steps;
    if (!Number.isFinite(options.steps) || options.steps < min || options.steps > max) {
      fatalCliError(`--steps for ${options.model} must be between ${min} and ${max}.`, {
        code: 'INVALID_ARGUMENT',
        details: { model: options.model, steps: options.steps, min, max }
      });
    }
  }
  if (options.guidance !== null && options.guidance !== undefined && musicDefaults.guidance) {
    const { min, max } = musicDefaults.guidance;
    if (!Number.isFinite(options.guidance) || options.guidance < min || options.guidance > max) {
      fatalCliError(`--guidance for ${options.model} must be between ${min} and ${max}.`, {
        code: 'INVALID_ARGUMENT',
        details: { model: options.model, guidance: options.guidance, min, max }
      });
    }
  }
  if (options.musicShift !== null && options.musicShift !== undefined) {
    const { min, max } = musicDefaults.shift;
    if (!Number.isFinite(options.musicShift) || options.musicShift < min || options.musicShift > max) {
      fatalCliError(`--music-shift for ${options.model} must be between ${min} and ${max}.`, {
        code: 'INVALID_ARGUMENT',
        details: { model: options.model, shift: options.musicShift, min, max }
      });
    }
  }
  if (options.sampler && !musicDefaults.sampler.allowed.includes(options.sampler)) {
    fatalCliError(`--sampler for ${options.model} must be one of ${musicDefaults.sampler.allowed.join('|')}.`, {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, sampler: options.sampler, allowed: musicDefaults.sampler.allowed }
    });
  }
  if (options.scheduler && !musicDefaults.scheduler.allowed.includes(options.scheduler)) {
    fatalCliError(`--scheduler for ${options.model} must be one of ${musicDefaults.scheduler.allowed.join('|')}.`, {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, scheduler: options.scheduler, allowed: musicDefaults.scheduler.allowed }
    });
  }
}

const apiWorkflowUtilityAction = options.apiWorkflowAction && options.apiWorkflowAction !== 'start';
const apiWorkflowStartAction = options.apiWorkflowAction === 'start';
const apiWorkflowStartHasExternalInput = options.apiWorkflowAction === 'start' && options.apiWorkflowInput;
const apiWorkflowTemplate = options.apiWorkflowTemplate || 'generated_keyframe_video';
const apiModelUtilityAction = Boolean(options.apiModelAction);
const apiReplayUtilityAction = Boolean(options.apiReplayAction);
const personaUtilityAction = Boolean(options.personaAction && options.personaAction !== 'generate');
const contractUtilityAction = Boolean(options.contractAction);
const storyboardPlanUtilityAction = Boolean(options.storyboardPlanAction);
const commandUsesGenerationSeed = !options.apiChat &&
  !apiWorkflowUtilityAction &&
  !apiModelUtilityAction &&
  !apiReplayUtilityAction &&
  !contractUtilityAction &&
  !storyboardPlanUtilityAction &&
  !options.estimateVideoCost &&
  !options.showBalance &&
  !options.showVersion &&
  !options.doctor &&
  !options.extractLastFrame &&
  !options.extractFirstFrame &&
  !options.concatVideos &&
  !options.remixAudio &&
  !options.listMedia &&
  !options.memoryAction &&
  !options.personalityAction &&
  !personaUtilityAction;
if (apiWorkflowStartAction && apiWorkflowTemplate === 'generated_keyframe_video' && !options.prompt && !apiWorkflowStartHasExternalInput) {
  fatalCliError('--api-workflow requires a prompt or --workflow-input JSON.', { code: 'INVALID_ARGUMENT' });
}
if (apiWorkflowStartAction && apiWorkflowTemplate === 'storyboard_video' && !options.prompt && !apiWorkflowStartHasExternalInput) {
  fatalCliError('--api-workflow storyboard-video preset requires a prompt or --workflow-input JSON.', { code: 'INVALID_ARGUMENT' });
}
// Normalize a whitespace-only prompt to empty so the guard below treats it as
// "no prompt" rather than silently sending blank text to the server.
if (typeof options.prompt === 'string' && options.prompt.trim() === '') {
  options.prompt = '';
}
if (!options.prompt && !options.apiChat && !apiWorkflowUtilityAction && !apiWorkflowStartAction && !apiModelUtilityAction && !apiReplayUtilityAction && !contractUtilityAction && !storyboardPlanUtilityAction && !options.estimateVideoCost && !options.multiAngle && !options.showBalance && !options.showVersion && !options.doctor && !options.extractLastFrame && !options.extractFirstFrame && !options.concatVideos && !options.remixAudio && !options.listMedia && !options.memoryAction && !options.personalityAction && !personaUtilityAction) {
  fatalCliError('No prompt provided. Use --help for usage.', { code: 'INVALID_ARGUMENT' });
}

if (contractUtilityAction && options.contractAction === 'dispatch' && !options.contractToolName) {
  fatalCliError('--dispatch-tool requires a tool name.', { code: 'INVALID_ARGUMENT' });
}
if (storyboardPlanUtilityAction && !options.prompt) {
  fatalCliError('--storyboard-plan requires a prompt describing the scene.', { code: 'INVALID_ARGUMENT' });
}

if (options.apiChat && !options.prompt && getApiModeMediaReferences().length === 0) {
  fatalCliError('--api-chat requires a prompt or media reference for planning.', { code: 'INVALID_ARGUMENT' });
}

if (!options.video && !options.apiChat && !options.apiWorkflowAction && (options.refAudio || options.refVideo || options.referenceAudioIdentity || options.voicePersonaName || options.videoWorkflow || options.frames || options.targetResolution || options.audioStart !== null || options.audioDuration !== null || options.videoStart !== null)) {
  fatalCliError('Video-only options (--workflow/--frames/--target-resolution/--ref-audio/--ref-video/--reference-audio-identity/--voice-persona) require --video.', {
    code: 'INVALID_ARGUMENT'
  });
}

if (options.photobooth) {
  if (!options.refImage) {
    fatalCliError('--photobooth requires --ref <face-image>.', { code: 'INVALID_ARGUMENT' });
  }
  if (options.video) {
    fatalCliError('--photobooth cannot be combined with --video.', { code: 'INVALID_ARGUMENT' });
  }
  if (options.contextImages.length > 0) {
    fatalCliError('--photobooth cannot be combined with -c/--context.', { code: 'INVALID_ARGUMENT' });
  }
}

if (options.video) {
  const isSeedanceVideo = isSeedanceModel(options.model);
  if (isSeedanceVideo && !['t2v', 'ia2v', 'v2v'].includes(options.videoWorkflow)) {
    fatalCliError('Seedance models support only t2v, ia2v, or v2v workflows.', {
      code: 'INVALID_ARGUMENT',
      details: { workflow: options.videoWorkflow, model: options.model }
    });
  }

  if (options.videoWorkflow === 't2v') {
    if (!isSeedanceVideo && (options.refImage || options.refImageEnd || options.refAudio || options.refVideo)) {
      fatalCliError('t2v does not accept reference image/audio/video.', {
        code: 'INVALID_ARGUMENT'
      });
    }
  } else if (options.videoWorkflow === 'i2v') {
    if (!options.refImage && !options.refImageEnd) {
      fatalCliError('i2v requires --ref and/or --ref-end.', { code: 'INVALID_ARGUMENT' });
    }
    if (options.refAudio || options.refVideo) {
      fatalCliError('i2v does not accept reference audio/video.', { code: 'INVALID_ARGUMENT' });
    }
  } else if (options.videoWorkflow === 's2v') {
    if (!options.refImage || !options.refAudio) {
      fatalCliError('s2v requires both --ref and --ref-audio.', { code: 'INVALID_ARGUMENT' });
    }
    if (options.refVideo) {
      fatalCliError('s2v does not accept reference video.', { code: 'INVALID_ARGUMENT' });
    }
  } else if (options.videoWorkflow === 'ia2v') {
    if (isSeedanceVideo) {
      if (!options.refAudio || (!options.refImage && !options.refImageEnd && !options.refVideo)) {
        fatalCliError('Seedance ia2v requires --ref-audio plus --ref or --ref-video.', { code: 'INVALID_ARGUMENT' });
      }
    } else if (!options.refImage || !options.refAudio) {
      fatalCliError('ia2v requires both --ref and --ref-audio.', { code: 'INVALID_ARGUMENT' });
    }
    if (!isSeedanceVideo && (options.refImageEnd || options.refVideo)) {
      fatalCliError('ia2v does not accept --ref-end or --ref-video.', { code: 'INVALID_ARGUMENT' });
    }
  } else if (options.videoWorkflow === 'a2v') {
    if (!options.refAudio) {
      fatalCliError('a2v requires --ref-audio.', { code: 'INVALID_ARGUMENT' });
    }
    if (options.refImage || options.refImageEnd || options.refVideo) {
      fatalCliError('a2v does not accept reference image/video.', { code: 'INVALID_ARGUMENT' });
    }
  } else if (options.videoWorkflow === 'v2v') {
    if (!options.refVideo) {
      fatalCliError('v2v requires --ref-video.', { code: 'INVALID_ARGUMENT' });
    }
    if (!options.videoControlNetName && !isSeedanceModel(options.model)) {
      fatalCliError('v2v requires --controlnet-name (canny|pose|depth|detailer).', { code: 'INVALID_ARGUMENT' });
    }
    if (!isSeedanceVideo && options.refAudio) {
      fatalCliError('v2v does not accept reference audio.', { code: 'INVALID_ARGUMENT' });
    }
  } else if (options.videoWorkflow === 'animate-move' || options.videoWorkflow === 'animate-replace') {
    if (!options.refImage || !options.refVideo) {
      fatalCliError('animate workflows require both --ref and --ref-video.', { code: 'INVALID_ARGUMENT' });
    }
    if (options.refAudio) {
      fatalCliError('animate workflows do not accept reference audio.', { code: 'INVALID_ARGUMENT' });
    }
  }

  if ((options.audioStart !== null || options.audioDuration !== null) && !options.refAudio) {
    fatalCliError('--audio-start/--audio-duration require --ref-audio.', { code: 'INVALID_ARGUMENT' });
  }
  if (options.videoStart !== null && !options.refVideo) {
    fatalCliError('--video-start requires --ref-video.', { code: 'INVALID_ARGUMENT' });
  }
  if (isSeedanceVideo && options.refAudio && !options.refImage && !options.refImageEnd && !options.refVideo
      && (!Array.isArray(options.contextImages) || options.contextImages.length === 0)) {
    fatalCliError('Seedance audio references require --ref, --ref-video, or -c/--context image refs.', { code: 'INVALID_ARGUMENT' });
  }

  // Seedance reference modes are mutually exclusive:
  //   - DEDICATED FRAME MODE: --ref (first frame) and/or --ref-end (last frame).
  //     Up to 2 images; the platform pins them as parameter-mode firstFrame/lastFrame.
  //   - LOOSE REFERENCE MODE: -c/--context (repeatable image refs), --ref-audio extras,
  //     --ref-video extras. Up to 9 images / 3 videos / 3 audios / 12 total.
  //     Anchor frame intent in the prompt with @Image1 / @Video1 / @Audio1 etc.
  // Mixing dedicated frames with loose image refs is rejected at sogni-socket
  // (jobsController.js) so we catch it client-side with a clearer message.
  if (isSeedanceVideo
      && (options.refImage || options.refImageEnd)
      && Array.isArray(options.contextImages) && options.contextImages.length > 0) {
    fatalCliError(
      'Seedance reference modes are mutually exclusive: --ref/--ref-end (dedicated first/last frame) cannot be combined with -c/--context (loose image references). '
      + 'Pick one: use --ref/--ref-end for first-class first-frame/last-frame anchoring (max 2 images), '
      + 'or use -c/--context (plus optional @Image1/@Image2 prompt language) for up to 9 loose image references.',
      { code: 'INVALID_ARGUMENT', details: {
          dedicatedFrames: [options.refImage, options.refImageEnd].filter(Boolean),
          looseImageRefs: options.contextImages,
        } },
    );
  }
  // Non-Seedance video models do not understand multi-ref audio/video extras —
  // they only support a single primary --ref-audio / --ref-video each.
  if (!isSeedanceVideo) {
    if (Array.isArray(options.refAudios) && options.refAudios.length > 0) {
      fatalCliError('Multiple --ref-audio entries are only supported for Seedance models (seedance2, seedance2-fast).', {
        code: 'INVALID_ARGUMENT',
        details: { model: options.model, extras: options.refAudios },
      });
    }
    if (Array.isArray(options.refVideos) && options.refVideos.length > 0) {
      fatalCliError('Multiple --ref-video entries are only supported for Seedance models (seedance2, seedance2-fast).', {
        code: 'INVALID_ARGUMENT',
        details: { model: options.model, extras: options.refVideos },
      });
    }
  }

  if (options.referenceAudioIdentity && !['t2v', 'i2v'].includes(options.videoWorkflow)) {
    fatalCliError('--reference-audio-identity/--voice-persona is only supported for LTX native-audio t2v/i2v workflows.', {
      code: 'INVALID_ARGUMENT'
    });
  }
  if (options.referenceAudioIdentity && !isLtx2Model(options.model)) {
    fatalCliError('--reference-audio-identity/--voice-persona requires an LTX video model.', {
      code: 'INVALID_ARGUMENT',
      hint: `Use -m ${LTX23_WORKFLOW_MODELS[options.videoWorkflow] || LTX23_WORKFLOW_MODELS.t2v}`
    });
  }

  // Validate controlnet-name values
  if (options.videoControlNetName) {
    const validControlNets = ['canny', 'pose', 'depth', 'detailer'];
    if (!validControlNets.includes(options.videoControlNetName)) {
      fatalCliError(`Unknown --controlnet-name "${options.videoControlNetName}". Use: ${validControlNets.join('|')}`, {
        code: 'INVALID_ARGUMENT',
        details: { flag: '--controlnet-name', value: options.videoControlNetName, allowed: validControlNets }
      });
    }
  }

  // Validate SAM2 coordinates (only for animate-replace)
  if (options.sam2Coordinates && options.videoWorkflow !== 'animate-replace') {
    fatalCliError('--sam2-coordinates is only supported with animate-replace workflow.', { code: 'INVALID_ARGUMENT' });
  }

  // Validate looping flag
  if (options.looping) {
    if (!options.video) {
      fatalCliError('--looping requires --video.', { code: 'INVALID_ARGUMENT' });
    }
    if (options.videoWorkflow !== 'i2v') {
      fatalCliError('--looping is only supported with i2v workflow.', { code: 'INVALID_ARGUMENT' });
    }
    if (!options.refImage) {
      fatalCliError('--looping requires --ref (reference image).', { code: 'INVALID_ARGUMENT' });
    }
    if (options.refImageEnd) {
      fatalCliError('--looping cannot be used with --ref-end (end frame is auto-generated).', { code: 'INVALID_ARGUMENT' });
    }
  }
}

applyVideoPromptGuardrails();

if (options.video && isSeedanceModel(options.model) && options.fps !== 24) {
  const originalFps = options.fps;
  options.fps = 24;
  if (!options.quiet) {
    console.error(`Adjusted Seedance fps from ${originalFps} to 24 (Seedance uses fixed 24fps video generation).`);
  }
}

if (options.video && !options.frames) {
  const durationLimits = videoDurationLimitsLikeWrapper(options.model);
  const clampedDuration = Math.max(durationLimits.min, Math.min(durationLimits.max, options.duration));
  if (clampedDuration !== options.duration) {
    if (!options.quiet) {
      console.error(
        `Adjusted video duration from ${options.duration}s to ${clampedDuration}s ` +
        `(supported range for ${options.model}: ${durationLimits.min}-${durationLimits.max}s).`
      );
    }
    options.duration = clampedDuration;
  }
}

// Video dimensions:
// - Sogni video pipelines have model-specific min/max dimensions and divisors.
// - When using i2v (or any ref-based workflow), the Sogni client wrapper will *resize the reference image*
//   with sharp `fit: inside` and then override the project width/height with the resized reference dims.
//   That means a "valid" requested size can still fail if the resized ref lands off the model divisor.
if (options.video) {
  const videoDimensionRules = videoDimensionRulesFromDefaults(getModelDefaults(options.model, openclawConfig), options.model);
  if (!Number.isFinite(options.width) || options.width <= 0 || !Number.isFinite(options.height) || options.height <= 0) {
    fatalCliError('Video width/height must be positive numbers.', {
      code: 'INVALID_ARGUMENT',
      details: { width: options.width, height: options.height }
    });
  }

  const originalVideoWidth = options.width;
  const originalVideoHeight = options.height;
  const normalizedVideoDims = normalizeVideoDimensionsLikeWrapper(options.width, options.height, videoDimensionRules);
  options.width = normalizedVideoDims.width;
  options.height = normalizedVideoDims.height;
  if (normalizedVideoDims.adjusted && !options.quiet) {
    console.error(
      `Auto-adjusted video dimensions from ${originalVideoWidth}x${originalVideoHeight} ` +
      `to ${options.width}x${options.height} to meet video requirements.`
    );
  }

  if (options.videoWorkflow === 'i2v' && (options.refImage || options.refImageEnd)) {
    const references = [
      {
        key: 'refImage',
        path: options.refImage,
        label: 'Reference image',
        resizeFlag: '_needsRefResize'
      },
      {
        key: 'refImageEnd',
        path: options.refImageEnd,
        label: 'End reference image',
        resizeFlag: '_needsRefEndResize'
      }
    ];
    const localRefDims = new Map();

    const isIncompatible = (predicted) => Boolean(predicted) && (
      predicted.width % videoDimensionRules.dimensionMultiple !== 0 ||
      predicted.height % videoDimensionRules.dimensionMultiple !== 0 ||
      predicted.width < videoDimensionRules.minDimension ||
      predicted.height < videoDimensionRules.minDimension
    );

    for (const ref of references) {
      if (!ref.path || isHttpUrl(ref.path) || !existsSync(ref.path)) continue;
      const buffer = readFileSync(ref.path);
      const dims = getImageDimensionsFromBuffer(buffer);
      if (!dims?.width || !dims?.height) continue;
      localRefDims.set(ref.key, dims);

      const predicted = predictSharpInsideResizeDims(dims.width, dims.height, options.width, options.height);
      if (!isIncompatible(predicted)) continue;

      const candidate = pickCompatibleI2vBoundingBox(dims.width, dims.height, options.width, options.height, { allowImperfect: true, rules: videoDimensionRules });
      if (!candidate) {
        options[ref.resizeFlag] = true;
        if (!options.quiet) {
          console.error(
            `${ref.label} ${dims.width}x${dims.height} will be pre-resized to model-compatible dimensions ` +
            'because no compatible bounding box exists for i2v workflow.'
          );
        }
        continue;
      }

      if ((cliSet.width || cliSet.height) && options.strictSize) {
        fatalCliError(
          `${ref.label} ${dims.width}x${dims.height} would resize to ${predicted.width}x${predicted.height}, ` +
          `but both dimensions must be divisible by ${videoDimensionRules.dimensionMultiple}.`,
          {
            code: 'INVALID_VIDEO_SIZE',
            details: {
              referenceType: ref.key,
              referencePath: ref.path,
              reference: { width: dims.width, height: dims.height },
              requested: { width: options.width, height: options.height },
              resized: predicted
            },
            hint: `Try: --width ${candidate.width} --height ${candidate.height} (or omit --strict-size)`
          }
        );
      }

      const beforeW = options.width;
      const beforeH = options.height;
      options.width = candidate.width;
      options.height = candidate.height;

      const predictedAfter = predictSharpInsideResizeDims(dims.width, dims.height, options.width, options.height);
      options._adjustedVideoDims = {
        reason: 'i2v-ref-model-divisor',
        referenceType: ref.key,
        requested: { width: beforeW, height: beforeH },
        adjusted: { width: options.width, height: options.height },
        resizedFrom: predicted,
        resizedTo: predictedAfter || null
      };
      if (!options.quiet) {
        const mode = cliSet.width || cliSet.height ? 'Warning: Adjusted' : 'Auto-adjusted';
        console.error(
          `${mode} i2v video size from ${beforeW}x${beforeH} to ${options.width}x${options.height} ` +
          `because resized reference would be ${predicted.width}x${predicted.height}.`
        );
      }
    }

    for (const ref of references) {
      const dims = localRefDims.get(ref.key);
      if (!dims) continue;
      const predicted = predictSharpInsideResizeDims(dims.width, dims.height, options.width, options.height);
      if (isIncompatible(predicted)) {
        options[ref.resizeFlag] = true;
      }
    }

    const effectiveDimsSource = localRefDims.get('refImage') || localRefDims.get('refImageEnd') || null;
    if (effectiveDimsSource) {
      const predicted = predictSharpInsideResizeDims(
        effectiveDimsSource.width,
        effectiveDimsSource.height,
        options.width,
        options.height
      );
      if (predicted) {
        options._effectiveVideoDims = {
          width: predicted.width,
          height: predicted.height,
          refWidth: effectiveDimsSource.width,
          refHeight: effectiveDimsSource.height,
          requestedWidth: options.width,
          requestedHeight: options.height
        };
      }
    }

    if ((options._needsRefResize || options._needsRefEndResize) && !options.quiet) {
      console.error('One or more i2v references require pre-resize to ensure model-compatible dimensions.');
    }
  }
}

// Validate context images against model limits
if (options.contextImages.length > 0 && !options.video) {
  const maxImages = getMaxContextImages(options.model);
  if (maxImages === 0) {
    fatalCliError(`Model ${options.model} does not support context images.`, {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model },
      hint: 'Try: qwen_image_edit_2511_fp8 or qwen_image_edit_2511_fp8_lightning'
    });
  }
  if (options.contextImages.length > maxImages) {
    fatalCliError(`Model ${options.model} supports max ${maxImages} context images, got ${options.contextImages.length}.`, {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, maxImages, provided: options.contextImages.length }
    });
  }
}

// Load last render seed if requested for a command that can use it.
if (options.lastSeed && commandUsesGenerationSeed) {
  if (existsSync(LAST_RENDER_PATH)) {
    try {
      const lastRender = JSON.parse(readFileSync(LAST_RENDER_PATH, 'utf8'));
      if (lastRender.seed) {
        options.seed = lastRender.seed;
        if (!options.quiet) console.error(`Using seed from last render: ${options.seed}`);
      }
    } catch (e) {
      console.error('Warning: Could not load last render seed');
    }
  } else {
    console.error('Warning: No previous render found, generating seed');
  }
}

if (commandUsesGenerationSeed && (options.seed === null || options.seed === undefined)) {
  const strategy = options.seedStrategy || openclawConfig?.seedStrategy || 'prompt-hash';
  const normalized = normalizeSeedStrategy(strategy) || 'prompt-hash';
  options.seedStrategy = normalized;
  options.seed = normalized === 'random'
    ? generateRandomSeed()
    : computePromptHashSeed(options);
  if (!options.quiet) console.error(`Using ${normalized} seed: ${options.seed}`);
}

// Load credentials
// Parse a `KEY=value` credentials file robustly. Tolerates: a UTF-8 BOM, an
// optional `export ` prefix, `#` comments, blank lines, CRLF endings, surrounding
// whitespace, surrounding single/double quotes, and `=` characters inside the
// value (only the first `=` splits). Hand-edited files are the norm here.
function parseCredentialsFile(content) {
  const creds = {};
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content; // strip BOM
  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    let quoted = false;
    if (value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
         (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
      quoted = true;
    }
    if (key) {
      // Inline `#` is NOT treated as a comment (a key could legitimately
      // contain one), but `VALUE # note` is almost always a dotenv habit that
      // silently corrupts the key — warn instead of failing later with a 401.
      if (!quoted && / #/.test(value)) {
        process.stderr.write(
          `Warning: the ${key} value in the credentials file contains " #". ` +
          'Inline comments are not stripped — move the comment to its own line if that was the intent.\n'
        );
      }
      creds[key] = value;
    }
  }
  return creds;
}

function loadCredentials() {
  let credentialsFileExisted = false;
  if (existsSync(CREDENTIALS_PATH)) {
    credentialsFileExisted = true;
    let content;
    try {
      content = readFileSync(CREDENTIALS_PATH, 'utf8');
    } catch (readErr) {
      const err = new Error(`Could not read Sogni credentials file at ${CREDENTIALS_PATH}.`);
      err.code = 'CREDENTIALS_UNREADABLE';
      err.hint = readErr?.code === 'EACCES'
        ? 'Fix the file permissions (e.g. `chmod 600 ' + CREDENTIALS_PATH + '`), or set SOGNI_API_KEY in the environment instead.'
        : 'Check the file, or set SOGNI_API_KEY in the environment instead.';
      err.details = { triedFile: CREDENTIALS_PATH, cause: readErr?.code || String(readErr) };
      throw err;
    }
    const creds = parseCredentialsFile(content);
    if (creds.SOGNI_API_KEY) {
      return {
        SOGNI_API_KEY: creds.SOGNI_API_KEY
      };
    }
  }

  if (hasEnv('SOGNI_API_KEY')) {
    return {
      SOGNI_API_KEY: getEnv('SOGNI_API_KEY')
    };
  }

  // Distinguish "file exists but has no usable key" from "no file at all" —
  // the former is a common hand-edit mistake (typo, wrong line, stray quotes).
  const err = new Error('No Sogni API key found.');
  err.code = 'MISSING_CREDENTIALS';
  err.hint = credentialsFileExisted
    ? `Found ${CREDENTIALS_PATH} but it has no usable "SOGNI_API_KEY=..." line. Check for typos/extra quotes, or set SOGNI_API_KEY in the environment. Get your key at https://dashboard.sogni.ai (account menu).`
    : 'Set SOGNI_API_KEY, or configure SOGNI_CREDENTIALS_PATH with SOGNI_API_KEY. You can find your API key by logging into https://dashboard.sogni.ai and opening the account menu.';
  err.details = {
    triedEnv: ['SOGNI_API_KEY'],
    triedFile: CREDENTIALS_PATH,
    credentialsFileExisted
  };
  throw err;
}

// Save last render info
function saveLastRender(info) {
  try {
    const dir = dirname(LAST_RENDER_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LAST_RENDER_PATH, JSON.stringify(info, null, 2));
  } catch (e) {
    // Ignore save errors
  }
}

function requireApiKeyCredentials(creds, modeLabel) {
  if (creds?.SOGNI_API_KEY) return creds.SOGNI_API_KEY;
  const err = new Error(`${modeLabel} requires SOGNI_API_KEY API-key authentication.`);
  err.code = 'MISSING_API_KEY';
  err.hint = 'Create an API key and set SOGNI_API_KEY; this command only supports API-key authentication.';
  throw err;
}

function apiRequestHeaders(apiKey, extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'api-key': apiKey,
    ...extra
  };
}

/**
 * Phase 6 P0 — SDK transport dispatch for hosted workflow operations.
 *
 * When `SOGNI_SKILL_USE_SDK_TRANSPORT=1` is set, route hosted workflow
 * start / get / list / events / cancel through
 * `@sogni-ai/sogni-intelligence-client`'s SDK-backed client via the
 * SSRF-validated `SogniHostedClientFactory` in
 * `sogni-hosted-client.mjs`. Otherwise fall back to the legacy
 * `fetchApiJson` path so existing users on older SDK versions are
 * unaffected.
 *
 * The SDK methods produce identical wire payloads to the legacy fetch
 * (same `/v1/creative-agent/workflows*` request shape), so callers do
 * not have to branch — they hand off to `dispatchWorkflowAction` and
 * receive an envelope shape compatible with `workflowFromPayload`,
 * `workflowsFromPayload`, and `eventsFromPayload`.
 *
 * Returns `null` when SDK transport is off, signalling the caller to
 * use the legacy `fetchApiJson` path.
 */
async function dispatchWorkflowActionViaSdk(action, apiKey, params) {
  let helpers;
  try {
    helpers = await import('./sogni-hosted-client.mjs');
  } catch {
    return null; // SDK transport unavailable; fall back to fetch.
  }
  if (!helpers.shouldUseSdkTransport()) return null;
  const restEndpoint = await buildSafeApiUrl('/');
  const restBase = new URL(restEndpoint).origin;
  return helpers.withHostedClient(
    {
      apiKey,
      restEndpoint: restBase,
      socketEndpoint: process.env.SOGNI_SOCKET_ENDPOINT || undefined,
      appSource: SOGNI_APP_SOURCE,
      appId: `sogni-skill-sdk-${process.pid}-${Date.now()}`,
    },
    async (client) => {
      if (action === 'list') {
        const records = await helpers.sdkListCreativeWorkflows(client, {
          limit: params.limit ?? 20,
        });
        return { status: 'success', data: { workflows: records }, sdkTransport: true };
      }
      if (action === 'get') {
        const record = await helpers.sdkGetCreativeWorkflow(client, params.workflowId);
        return { status: 'success', data: { workflow: record }, sdkTransport: true };
      }
      if (action === 'events') {
        const events = await helpers.sdkListCreativeWorkflowEvents(client, params.workflowId);
        return { status: 'success', data: { events }, sdkTransport: true };
      }
      if (action === 'cancel') {
        const record = await helpers.sdkCancelCreativeWorkflow(client, params.workflowId);
        return { status: 'success', data: { workflow: record }, sdkTransport: true };
      }
      if (action === 'start') {
        const record = await helpers.sdkStartCreativeWorkflow(
          client,
          {
            input: params.input,
            tokenType: params.tokenType,
            appSource: SOGNI_APP_SOURCE,
            ...(params.mediaReferences?.length ? { mediaReferences: params.mediaReferences } : {}),
            ...(params.maxEstimatedCapacityUnits != null
              ? { maxEstimatedCapacityUnits: params.maxEstimatedCapacityUnits }
              : {}),
            ...(params.confirmCost != null ? { confirmCost: params.confirmCost } : {}),
            ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
          },
          {},
        );
        return { status: 'success', data: { workflow: record }, sdkTransport: true };
      }
      return null;
    },
  );
}

/**
 * Phase 6 P0 — SDK transport dispatch for hosted chat completions.
 *
 * When `SOGNI_SKILL_USE_SDK_TRANSPORT=1` is set, route synchronous
 * hosted chat through `@sogni-ai/sogni-intelligence-client`'s SDK-backed
 * client via the SSRF-validated factory. The SDK's `chat.hosted.create`
 * accepts the same field
 * names the legacy fetch sends (`model`, `messages`, `temperature`,
 * `max_tokens`, `token_type`, `app_source`, `sogni_tools`,
 * `sogni_tool_execution`, `task_profile`, `chat_template_kwargs`,
 * `media_references`), so the bridge forwards the body unchanged. The
 * SDK returns a `HostedChatCompletionResult` whose flat shape is
 * already handled by `extractChatMessage` / `extractChatWorkflows`'s
 * fallback path.
 *
 * Returns `null` when SDK transport is off so the caller falls back
 * to `fetchApiJson`.
 */
async function dispatchChatHostedViaSdk(apiKey, body) {
  let helpers;
  try {
    helpers = await import('./sogni-hosted-client.mjs');
  } catch {
    return null;
  }
  if (!helpers.shouldUseSdkTransport()) return null;
  const restEndpoint = await buildSafeApiUrl('/');
  const restBase = new URL(restEndpoint).origin;
  return helpers.withHostedClient(
    {
      apiKey,
      restEndpoint: restBase,
      socketEndpoint: process.env.SOGNI_SOCKET_ENDPOINT || undefined,
      appSource: SOGNI_APP_SOURCE,
      appId: `sogni-skill-sdk-${process.pid}-${Date.now()}`,
    },
    async (client) => helpers.sdkChatHostedCreate(client, body),
  );
}

/**
 * Phase 6 P1 — SDK transport dispatch for media-reference upload/download
 * URL acquisition.
 *
 * The skill historically called `/v1/image/{action}Url` and
 * `/v1/media/{action}Url` directly via `fetchApiJson`. alpha.22's
 * `ProjectsApi` already exposes those endpoints as
 * `uploadUrl` / `downloadUrl` (image) and
 * `mediaUploadUrl` / `mediaDownloadUrl` (audio/video) with the exact
 * same query-param shape (`imageId|id`, `jobId`, `type`, `contentType`)
 * and accepts `'referenceImage'` / `'referenceImageEnd'` /
 * `'referenceAudio'` / `'referenceVideo'` in the type union the skill
 * uses.
 *
 * The SDK methods return the presigned URL **string** directly (they
 * already unwrap `r.data.uploadUrl` internally). To keep
 * `apiStoredMediaUrl` working as a drop-in extractor, the bridge wraps
 * the URL in a `{data: {uploadUrl|downloadUrl: '...'}, sdkTransport: true}`
 * envelope. Returns `null` when SDK transport is off so the caller
 * falls back to `fetchApiJson`.
 */
async function dispatchMediaReferenceUrlViaSdk({ ref, file, index, jobId, action, apiKey }) {
  let helpers;
  try {
    helpers = await import('./sogni-hosted-client.mjs');
  } catch {
    return null;
  }
  if (!helpers.shouldUseSdkTransport()) return null;
  const restEndpoint = await buildSafeApiUrl('/');
  const restBase = new URL(restEndpoint).origin;
  return helpers.withHostedClient(
    {
      apiKey,
      restEndpoint: restBase,
      socketEndpoint: process.env.SOGNI_SOCKET_ENDPOINT || undefined,
      appSource: SOGNI_APP_SOURCE,
      appId: `sogni-skill-sdk-${process.pid}-${Date.now()}`,
    },
    async (client) => {
      const type = apiMediaReferenceUploadType(ref, index);
      if (ref.kind === 'image') {
        const params = {
          imageId: `media_ref_${index + 1}`,
          jobId,
          type,
          contentType: file.mimeType,
        };
        const url = action === 'upload'
          ? await helpers.sdkImageUploadUrl(client, params)
          : await helpers.sdkImageDownloadUrl(client, params);
        const key = action === 'upload' ? 'uploadUrl' : 'downloadUrl';
        return { data: { [key]: url }, sdkTransport: true };
      }
      const params = {
        id: `media_ref_${index + 1}`,
        jobId,
        type,
        contentType: file.mimeType,
      };
      const url = action === 'upload'
        ? await helpers.sdkMediaUploadUrl(client, params)
        : await helpers.sdkMediaDownloadUrl(client, params);
      const key = action === 'upload' ? 'uploadUrl' : 'downloadUrl';
      return { data: { [key]: url }, sdkTransport: true };
    },
  );
}

// Default HTTP timeout for plain REST calls and downloads. Without this, a
// black-holing proxy / captive portal makes the CLI hang forever with no
// output. Override via SOGNI_HTTP_TIMEOUT_MS. (The SDK generation wait is
// governed separately by --timeout.)
const DEFAULT_HTTP_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(getEnv('SOGNI_HTTP_TIMEOUT_MS') || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 30000;
})();

// Uploads keep the timer running for the whole request-body send (the fetch
// promise only resolves once the server responds), so they get a longer budget
// than the connect-phase default that suffices for GET/download/stream calls.
const UPLOAD_HTTP_TIMEOUT_MS = Math.max(DEFAULT_HTTP_TIMEOUT_MS, 120000);

// fetch() with an AbortController-based timeout that maps a timeout/abort into a
// clean, coded error instead of a hang or an opaque "aborted" stack.
async function fetchWithTimeout(resource, init = {}, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const err = new Error(`Sogni network request timed out after ${Math.round(timeoutMs / 1000)}s.`);
      err.code = 'NETWORK_TIMEOUT';
      err.hint = 'Check your internet connection. If you are behind a corporate proxy/VPN or firewall, it may be blocking api.sogni.ai. You can raise the limit with SOGNI_HTTP_TIMEOUT_MS.';
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchApiJson(path, { apiKey, method = 'GET', body = undefined, headers = {} } = {}) {
  const url = await buildSafeApiUrl(path);
  const init = {
    method,
    headers: apiRequestHeaders(apiKey, headers),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };

  const response = await fetchWithTimeout(url, init);
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    const err = new Error(payload?.message || payload?.error?.message || response.statusText || 'Sogni API request failed');
    err.code = 'API_REQUEST_FAILED';
    err.details = { url, status: response.status, payload };
    throw err;
  }
  return payload;
}

function getApiModeMediaReferences() {
  const refs = [];
  for (const value of options.contextImages || []) {
    if (value) refs.push({ flag: '-c/--context', value, kind: 'image' });
  }
  if (options.refImage) refs.push({ flag: '--ref', value: options.refImage, kind: 'image' });
  if (options.refImageEnd) refs.push({ flag: '--ref-end', value: options.refImageEnd, kind: 'image' });
  if (options.refAudio) refs.push({ flag: '--ref-audio', value: options.refAudio, kind: 'audio' });
  for (const value of options.refAudios || []) {
    if (value) refs.push({ flag: '--ref-audio', value, kind: 'audio' });
  }
  if (options.referenceAudioIdentity) refs.push({ flag: '--reference-audio-identity', value: options.referenceAudioIdentity, kind: 'audio' });
  if (options.refVideo) refs.push({ flag: '--ref-video', value: options.refVideo, kind: 'video' });
  for (const value of options.refVideos || []) {
    if (value) refs.push({ flag: '--ref-video', value, kind: 'video' });
  }
  return refs;
}

function formatApiMediaFlags(refs) {
  return [...new Set(refs.map(ref => ref.flag))].join(', ');
}

function apiMediaReferenceMaxBytes() {
  const configured = Number(getEnv('SOGNI_API_MEDIA_REFERENCE_MAX_BYTES') || '');
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_API_MEDIA_REFERENCE_MAX_BYTES;
}

function isRemoteApiMediaReference(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function isInlineApiMediaReference(value) {
  return /^data:[^,]+,/i.test(String(value || ''));
}

function mimeTypeForMediaReference(ref) {
  const value = String(ref.value || '');
  const clean = value.split('?')[0].toLowerCase();
  if (ref.kind === 'video') {
    if (clean.endsWith('.webm')) return 'video/webm';
    if (clean.endsWith('.m4v')) return 'video/mp4';
  }
  if (ref.kind === 'audio' && clean.endsWith('.webm')) return 'audio/webm';
  return mimeTypeForPath(value, `${ref.kind}/unknown`);
}

function localApiMediaReferenceFile(ref) {
  const filePath = sanitizePath(String(ref.value || ''), `${ref.flag} media reference`);
  if (!existsSync(filePath)) {
    const err = new Error(`${ref.flag} file not found: ${filePath}`);
    err.code = 'MEDIA_REFERENCE_NOT_FOUND';
    err.hint = `Check the path is correct and relative to your current directory (${process.cwd()}). Use ~ for your home directory, or pass an http(s) URL.`;
    err.details = { flag: ref.flag, path: filePath };
    throw err;
  }
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    const err = new Error(`${ref.flag} must point to a file when using local API media references.`);
    err.code = 'INVALID_MEDIA_REFERENCE';
    throw err;
  }
  const maxBytes = apiMediaReferenceMaxBytes();
  if (stat.size > maxBytes) {
    const err = new Error(`${ref.flag} media reference is ${stat.size} bytes, above the ${maxBytes} byte API upload limit.`);
    err.code = 'MEDIA_REFERENCE_TOO_LARGE';
    throw err;
  }
  const mimeType = mimeTypeForMediaReference(ref);
  return {
    filePath,
    filename: basename(filePath),
    byteLength: stat.size,
    mimeType,
  };
}

function apiMediaReferenceUploadType(ref, index) {
  if (ref.kind === 'audio') return 'referenceAudio';
  if (ref.kind === 'video') return 'referenceVideo';
  if (ref.flag === '--ref-end') return 'referenceImageEnd';
  if (ref.flag === '-c/--context') return `contextImage${Math.min(index + 1, 16)}`;
  return 'referenceImage';
}

function apiMediaReferenceEndpoint(ref, action) {
  return ref.kind === 'image'
    ? `/v1/image/${action}Url`
    : `/v1/media/${action}Url`;
}

function apiMediaReferenceV2Endpoint(ref, action) {
  return ref.kind === 'image'
    ? `/v2/image/${action}Url`
    : `/v2/media/${action}Url`;
}

function apiMediaReferenceUrlPath(ref, file, index, action, jobId) {
  const params = new URLSearchParams();
  params.set('type', apiMediaReferenceUploadType(ref, index));
  params.set('jobId', jobId);
  params.set('contentType', file.mimeType);
  if (ref.kind === 'image') {
    params.set('imageId', `media_ref_${index + 1}`);
  } else {
    params.set('id', `media_ref_${index + 1}`);
  }
  return `${apiMediaReferenceEndpoint(ref, action)}?${params.toString()}`;
}

function apiMediaReferenceV2UrlPath(ref, file, index, action, jobId) {
  const params = new URLSearchParams();
  params.set('type', apiMediaReferenceUploadType(ref, index));
  params.set('jobId', jobId);
  params.set('contentType', file.mimeType);
  if (ref.kind === 'image') {
    params.set('imageId', `media_ref_${index + 1}`);
  } else {
    params.set('id', `media_ref_${index + 1}`);
  }
  return `${apiMediaReferenceV2Endpoint(ref, action)}?${params.toString()}`;
}

function apiStoredMediaUrl(payload, key) {
  const data = extractApiEnvelopeData(payload);
  const value = data?.[key] || payload?.[key];
  if (typeof value === 'string' && value) return value;
  const err = new Error(`Sogni API did not return ${key} for media reference upload.`);
  err.code = 'MEDIA_UPLOAD_FAILED';
  err.details = { payload };
  throw err;
}

function apiStoredMediaUploadPost(payload) {
  const data = extractApiEnvelopeData(payload);
  const url = data?.url || data?.uploadUrl;
  if (typeof url === 'string' && url) {
    const fields = data?.fields && typeof data.fields === 'object' ? data.fields : {};
    return { url, fields };
  }
  const err = new Error('Sogni API did not return a presigned POST URL for media reference upload.');
  err.code = 'MEDIA_UPLOAD_FAILED';
  err.details = { payload };
  throw err;
}

async function postApiMediaUploadForm(uploadPayload, file) {
  const { url, fields } = apiStoredMediaUploadPost(uploadPayload);
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    form.append(key, String(value));
  }
  const body = file.buffer || readFileSync(file.filePath);
  form.append('file', new Blob([body], { type: file.mimeType }), file.filename);

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    body: form,
  }, UPLOAD_HTTP_TIMEOUT_MS);
  if (!response.ok) {
    const err = new Error(`Failed to upload ${file.filename} (${response.status} ${response.statusText}).`);
    err.code = 'MEDIA_UPLOAD_FAILED';
    err.details = { uploadUrl: url, status: response.status, statusText: response.statusText };
    throw err;
  }
}

async function putApiMediaUpload(uploadUrl, file) {
  const response = await fetchWithTimeout(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.mimeType },
    body: file.buffer || readFileSync(file.filePath),
  }, UPLOAD_HTTP_TIMEOUT_MS);
  if (!response.ok) {
    const err = new Error(`Failed to upload ${file.filename} (${response.status} ${response.statusText}).`);
    err.code = 'MEDIA_UPLOAD_FAILED';
    err.details = { uploadUrl, status: response.status, statusText: response.statusText };
    throw err;
  }
}

function extensionForApiMediaReference(mimeType, kind) {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3';
  if (normalized === 'audio/mp4' || normalized === 'audio/m4a' || normalized === 'audio/x-m4a') return 'm4a';
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav' || normalized === 'audio/wave') return 'wav';
  if (normalized === 'video/quicktime') return 'mov';
  if (normalized === 'video/mp4') return 'mp4';
  return kind === 'image' ? 'jpg' : kind;
}

function decodeInlineApiMediaReference(ref) {
  const raw = String(ref.value || '');
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/is.exec(raw);
  if (!match) {
    const err = new Error(`${ref.flag} inline media reference must be a base64 data URI.`);
    err.code = 'INVALID_MEDIA_REFERENCE';
    throw err;
  }
  const mimeType = match[1].trim().toLowerCase();
  const base64 = match[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    const err = new Error(`${ref.flag} inline media reference has invalid base64 data.`);
    err.code = 'INVALID_MEDIA_REFERENCE';
    throw err;
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
    const err = new Error(`${ref.flag} inline media reference has invalid base64 data.`);
    err.code = 'INVALID_MEDIA_REFERENCE';
    throw err;
  }
  const maxBytes = apiMediaReferenceMaxBytes();
  if (buffer.length > maxBytes) {
    const err = new Error(`${ref.flag} media reference is ${buffer.length} bytes, above the ${maxBytes} byte API upload limit.`);
    err.code = 'MEDIA_REFERENCE_TOO_LARGE';
    throw err;
  }
  return {
    buffer,
    filename: `inline-media-ref-${ref.kind}.${extensionForApiMediaReference(mimeType, ref.kind)}`,
    byteLength: buffer.length,
    mimeType,
  };
}

async function uploadPreparedApiMediaReference(ref, index, apiKey, file) {
  if (!apiKey) {
    const err = new Error(`${ref.flag} media references require SOGNI_API_KEY so the CLI can upload them before hosted execution.`);
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const jobId = `sogni-agent-${Date.now()}-${index + 1}-${randomBytes(4).toString('hex')}`;
  const uploadPayload =
    (await dispatchMediaReferenceUrlViaSdk({ ref, file, index, jobId, action: 'upload', apiKey }))
    ?? (await fetchApiJson(apiMediaReferenceUrlPath(ref, file, index, 'upload', jobId), { apiKey }));
  const uploadUrl = apiStoredMediaUrl(uploadPayload, 'uploadUrl');
  await putApiMediaUpload(uploadUrl, file);
  const downloadPayload =
    (await dispatchMediaReferenceUrlViaSdk({ ref, file, index, jobId, action: 'download', apiKey }))
    ?? (await fetchApiJson(apiMediaReferenceUrlPath(ref, file, index, 'download', jobId), { apiKey }));
  const url = apiStoredMediaUrl(downloadPayload, 'downloadUrl');
  return {
    url,
    filename: file.filename,
    byte_length: file.byteLength,
    mime_type: file.mimeType,
    prompt_label: file.filename,
    storage: {
      jobId,
      type: apiMediaReferenceUploadType(ref, index),
    },
  };
}

async function uploadPreparedApiMediaReferenceV2(ref, index, apiKey, file) {
  if (!apiKey) {
    const err = new Error(`${ref.flag} media references require SOGNI_API_KEY so the CLI can upload them before execution.`);
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const jobId = `sogni-agent-${Date.now()}-${index + 1}-${randomBytes(4).toString('hex')}`;
  const uploadPayload = await fetchApiJson(apiMediaReferenceV2UrlPath(ref, file, index, 'upload', jobId), { apiKey });
  await postApiMediaUploadForm(uploadPayload, file);
  const downloadPayload = await fetchApiJson(apiMediaReferenceV2UrlPath(ref, file, index, 'download', jobId), { apiKey });
  const url = apiStoredMediaUrl(downloadPayload, 'downloadUrl');
  return {
    url,
    filename: file.filename,
    byte_length: file.byteLength,
    mime_type: file.mimeType,
    prompt_label: file.filename,
    storage: {
      jobId,
      type: apiMediaReferenceUploadType(ref, index),
      version: 'v2',
    },
  };
}

async function uploadLocalApiMediaReference(ref, index, apiKey) {
  return uploadPreparedApiMediaReference(ref, index, apiKey, localApiMediaReferenceFile(ref));
}

async function uploadInlineApiMediaReference(ref, index, apiKey) {
  return uploadPreparedApiMediaReference(ref, index, apiKey, decodeInlineApiMediaReference(ref));
}

async function buildApiMediaReferencePayloadItem(ref, index, apiKey, { requireUploadedMedia = false } = {}) {
  const mimeType = mimeTypeForMediaReference(ref);
  const base = {
    id: `media_ref_${index + 1}`,
    source: 'cli',
    flag: ref.flag,
    kind: ref.kind,
    mime_type: mimeType,
  };
  if (isInlineApiMediaReference(ref.value)) {
    if (requireUploadedMedia) {
      const uploaded = await uploadInlineApiMediaReference(ref, index, apiKey);
      return {
        ...base,
        ...uploaded,
        filename: uploaded.filename,
        mime_type: uploaded.mime_type,
      };
    }
    return {
      ...base,
      dataUri: ref.value,
      filename: `inline-${base.id}`,
      prompt_label: `inline-${base.id}`,
    };
  }
  if (isRemoteApiMediaReference(ref.value)) {
    return {
      ...base,
      url: ref.value,
      prompt_label: ref.value,
    };
  }
  const local = await uploadLocalApiMediaReference(ref, index, apiKey);
  return {
    ...base,
    ...local,
    filename: local.filename,
    mime_type: local.mime_type,
  };
}

async function buildApiMediaReferencesPayload(refs = getApiModeMediaReferences(), { apiKey, requireUploadedMedia = false } = {}) {
  return Promise.all(refs.map((ref, index) =>
    buildApiMediaReferencePayloadItem(ref, index, apiKey, { requireUploadedMedia })
  ));
}

function formatApiMediaReferencesForPrompt(mediaReferences) {
  if (!mediaReferences.length) return '';
  const lines = mediaReferences.map(ref => {
    const label = ref.prompt_label || ref.url || ref.filename || ref.id;
    return `- ${ref.id} ${ref.kind} (${ref.flag}): ${label}`;
  });
  return `API media references:\n${lines.join('\n')}`;
}

function extractApiEnvelopeData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function extractChatMessage(payload) {
  const data = extractApiEnvelopeData(payload);
  return data?.choices?.[0]?.message || data?.choices?.[0]?.delta || payload?.choices?.[0]?.message || {};
}

function extractChatWorkflows(payload) {
  const data = extractApiEnvelopeData(payload);
  return data?.creative_workflows || payload?.creative_workflows || [];
}

function mimeTypeForPath(pathOrUrl, fallback = 'application/octet-stream') {
  const clean = String(pathOrUrl || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.mp3')) return 'audio/mpeg';
  if (clean.endsWith('.wav')) return 'audio/wav';
  if (clean.endsWith('.m4a')) return 'audio/mp4';
  if (clean.endsWith('.webm')) return 'audio/webm';
  if (clean.endsWith('.ogg')) return 'audio/ogg';
  if (clean.endsWith('.flac')) return 'audio/flac';
  if (clean.endsWith('.mp4')) return 'video/mp4';
  if (clean.endsWith('.mov')) return 'video/quicktime';
  return fallback;
}

async function imageDataUriFromPathOrUrl(pathOrUrl) {
  const mimeType = mimeTypeForPath(pathOrUrl);
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
    const err = new Error(`API chat vision supports PNG or JPEG image references, got ${pathOrUrl}.`);
    err.code = 'UNSUPPORTED_MEDIA_TYPE';
    throw err;
  }
  const buffer = await fetchMediaBuffer(pathOrUrl);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

const DEFAULT_API_CHAT_SYSTEM_PROMPT = `ROLE: You are Sogni Agent, a practical creative production assistant for Sogni's media tools. Be direct, specific, inventive, and warm. Avoid generic text-only LLM framing and describe Sogni's real media capabilities when they are relevant.

V2 TURN ARCHITECTURE:
- Hosted chat may run a classifier/planner before the assistant round. That stage proposes text/tool/workflow mode and the allowed tool surface; it does not call tools or spend credits.
- In the assistant/execution round, use only the tools currently exposed to you. If the user asked Sogni to generate, edit, animate, render, analyze, or otherwise execute media and the matching tool is available, call it.
- If the current round is text-only, answer the question completely in prose. Product, model, pricing, credit, capability, and "what can you do?" questions are usually text-only until the user asks you to start making media.
- If required input is missing, ask a concise clarifying question. For underspecified creative taste, choose a reasonable default and proceed.
- Do not narrate hidden planning, tool selection, JSON, function names, or internal architecture to the user.

SOGNI PRODUCT KNOWLEDGE:
- Sogni can create and edit images, generate and transform videos, compose music/lyrics, restore photos, apply styles, analyze media, and use uploaded or generated assets as references.
- GPT Image 2 in Sogni creates images from text prompts, edits/restyles uploaded or generated references, builds storyboard/keyframe sheets, character/reference boards, ad/product composites, and layout/text-heavy stills.
- For action requests, use image generation for text-to-image and image editing when references guide identity, likeness, composition, style, objects, logos, or products. Paid renders show a preflight estimate before spending.
- Featured workflow: GPT Image 2 storyboard/keyframes -> Seedance 2.0 for finished social videos such as ads, trailers, character intros, and storyboard-to-video flows.
- For Sogni, model, GPT Image, Seedance, or creative capability questions, describe the media tools Sogni can use instead of falling back to generic text-only limitations.
- For unknown product facts, state uncertainty and point to docs.sogni.ai or Discord.`;

/**
 * Build the persona/memory/personality dynamic-system-prompt suffix the
 * skill injects into `/v1/chat/completions` (and durable
 * `/v1/chat/runs`). Mirrors sogni-chat's `buildChatDynamicSystemPrompt`
 * (chatService.ts ~line 12031) so a user's saved personas, memories,
 * and personality text are visible to the hosted LLM regardless of
 * which surface they're chatting from.
 *
 * Returns the empty string when no personas/memories/personality are
 * configured, so the base system prompt is unchanged for fresh
 * installs.
 */
function buildSkillDynamicSystemPrompt() {
  let suffix = '';

  // Persona context — capped at 8 names to match sogni-chat's
  // buildPersonaContext.
  try {
    const personas = loadPersonas();
    if (personas.length > 0) {
      const MAX_PERSONAS = 8;
      const shown = personas.slice(0, MAX_PERSONAS);
      let personaContext = shown
        .map((p) => {
          const nicknames = p.tags?.length ? ` aka ${p.tags.join('/')}` : '';
          const voice = p.voiceClipPath ? ', has voice clip' : '';
          return `${p.name}${nicknames} (${p.relationship}${voice})`;
        })
        .join(', ');
      if (personas.length > MAX_PERSONAS) {
        personaContext += ` and ${personas.length - MAX_PERSONAS} more`;
      }
      suffix += `\nUser's people: ${personaContext}.`;
      suffix += '\n\nPERSONA RULES:'
        + '\n- Match personas only by explicit listed name or tag/alias. Do not infer persona identity from relationship phrases alone.'
        + '\n- When creating images of personas, prefer image-editing with the persona\'s reference photo over generating from scratch.'
        + '\n- If the user mentions someone not listed, suggest adding them via `--persona-add`.';
    }
  } catch {
    // best-effort — never block chat on a corrupt personas index
  }

  // Memory context — flat "key: value" list matching sogni-chat's
  // buildMemoryContext format.
  try {
    const memories = loadMemories();
    if (memories.length > 0) {
      const memoryContext = memories.map((m) => `${m.key}: ${m.value}`).join('; ');
      suffix += `\nUser preferences (apply unless the latest user request overrides them): ${memoryContext}`;
    }
  } catch {
    // best-effort
  }

  // Personality context — verbatim user instruction wrapped in the same
  // framing sogni-chat uses so the LLM treats it as an override.
  try {
    const personality = loadPersonality();
    if (personality) {
      suffix += `\nUSER PERSONALITY PREFERENCE: The user has customized your personality as follows: "${personality}". Adopt this personality while following all other instructions above.`;
    }
  } catch {
    // best-effort
  }

  return suffix;
}

async function buildApiChatMessages(apiMediaRefs, apiMediaReferences) {
  // composeAdapterPromptGuidance() returns the same per-model storyboard
  // routing guidance the hosted chat and durable workflow surfaces inject
  // (Seedance @ImageN refs, GPT Image 2 bracketed refs, LTX23 context
  // tokens, Wan numeric tokens). Wiring it through here keeps the public
  // skill's --api-chat behavior aligned with sogni-chat and the
  // /v1/chat/completions endpoint when references are present.
  const baseSystem = options.apiSystemPrompt || DEFAULT_API_CHAT_SYSTEM_PROMPT;
  const dynamicSuffix = buildSkillDynamicSystemPrompt();
  const systemWithDynamic = dynamicSuffix ? `${baseSystem}${dynamicSuffix}` : baseSystem;
  const system = apiMediaRefs.length > 0
    ? `${systemWithDynamic}\n\n${composeAdapterPromptGuidance()}`
    : systemWithDynamic;
  const imageRefs = apiMediaRefs.filter(ref => ref.kind === 'image');
  const nonImageRefs = apiMediaReferences.filter(ref => ref.kind !== 'image');
  const promptText = [
    options.prompt || 'Describe the attached media.',
    formatApiMediaReferencesForPrompt(nonImageRefs)
  ].filter(Boolean).join('\n\n');

  const messages = [{ role: 'system', content: system }];
  if (imageRefs.length === 0) {
    messages.push({ role: 'user', content: promptText });
    return messages;
  }

  const content = [{ type: 'text', text: promptText }];
  for (const ref of imageRefs) {
    content.push({ type: 'image_url', image_url: { url: await imageDataUriFromPathOrUrl(ref.value) } });
  }
  messages.push({ role: 'user', content });
  return messages;
}

function apiChatTemplateKwargs() {
  if (typeof options.apiThinking !== 'boolean') return null;
  return { enable_thinking: options.apiThinking };
}

function chatRunEventPayload(event) {
  if (!event || typeof event !== 'object') return event;
  return event.payload || event.data || event;
}

function chatRunAssistantDelta(type, payload) {
  if (type === 'assistant_message_delta' && typeof payload?.content === 'string') {
    return payload.content;
  }
  if (
    chatRunTerminalStatus(type, payload)
    || chatRunFailureStatus(type)
    || chatRunWaitingStatus(type)
    || type === 'tool_call_progress'
  ) {
    return null;
  }
  return payload?.delta?.content
    || payload?.choices?.[0]?.delta?.content
    || (typeof payload?.content === 'string' ? payload.content : null);
}

function chatRunTerminalStatus(type, payload) {
  if (type === 'run_completed' || type === 'run.completed' || type === 'completed' || type === 'done') {
    return payload?.status || 'completed';
  }
  if (type === 'run_partial_failure') return payload?.status || 'partial_failure';
  if (type === 'run_cancelled' || type === 'cancelled') return payload?.status || 'cancelled';
  return null;
}

function chatRunFailureStatus(type) {
  return type === 'run_failed' || type === 'run.failed' || type === 'failed' || type === 'error';
}

function chatRunWaitingStatus(type) {
  return type === 'run_waiting_for_user' || type === 'waiting_for_user';
}

async function runApiChat(log) {
  const creds = loadCredentials();
  const apiKey = requireApiKeyCredentials(creds, '--api-chat');
  const apiMediaRefs = getApiModeMediaReferences();
  const apiMediaReferences = await buildApiMediaReferencesPayload(apiMediaRefs, { apiKey });
  const messages = sanitizeMessagesForLlm(await buildApiChatMessages(apiMediaRefs, apiMediaReferences));
  const chatTemplateKwargs = apiChatTemplateKwargs();
  const body = {
    model: options.llmModel || DEFAULT_LLM_MODEL,
    messages,
    temperature: 0.4,
    max_tokens: options.apiMaxTokens || 1600,
    token_type: options.tokenType || 'spark',
    app_source: SOGNI_APP_SOURCE,
    sogni_tools: options.apiTools,
    sogni_tool_execution: options.apiToolExecution,
    ...(options.apiTaskProfile ? { task_profile: options.apiTaskProfile } : {}),
    ...(chatTemplateKwargs ? { chat_template_kwargs: chatTemplateKwargs } : {}),
    // Propagate the NSFW-filter preference into the chat request body so
    // the hosted LLM round/tool dispatcher honors `--no-filter` for both
    // the LLM moderation pass and any server-executed tool calls. Mirrors
    // sogni-chat's `runtimeConfig.safeContentFilter` propagation
    // (chatService.ts ~line 12460).
    ...(options.noFilter === true ? { safeContentFilter: false } : {}),
    ...(apiMediaReferences.length > 0 ? { media_references: apiMediaReferences } : {})
  };
  if (options.durableChat) {
    return runApiChatDurable(log, { apiKey, body });
  }
  const payload =
    (await dispatchChatHostedViaSdk(apiKey, body))
    ?? (await fetchApiJson('/v1/chat/completions', {
      apiKey,
      method: 'POST',
      body
    }));
  const message = extractChatMessage(payload);
  const workflows = extractChatWorkflows(payload);
  const toolCalls = message.tool_calls || message.toolCalls || [];

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      type: 'api-chat',
      content: message.content || '',
      toolCalls,
      workflows,
      raw: payload
    }));
    return;
  }

  if (message.content) console.log(message.content);
  if (toolCalls.length > 0) {
    console.log('\nTool calls:');
    for (const call of toolCalls) {
      console.log(`  - ${call.function?.name || call.name || call.id || 'tool_call'}`);
    }
  }
  if (workflows.length > 0) {
    console.log('\nCreative workflows:');
    for (const workflow of workflows) {
      console.log(`  - ${workflow.workflowId || workflow.id}: ${workflow.status || 'submitted'}`);
    }
  }
  if (!message.content && toolCalls.length === 0 && workflows.length === 0) {
    log('No API chat content returned.');
  }
}

/**
 * Durable chat dispatch (Phase 6 P0 follow-up).
 *
 * Routes the synchronous `/v1/chat/completions` body through the SDK's
 * durable `client.chat.runs.create` + `streamEvents` pair. Mirrors
 * sogni-chat's durable chat run flow so a single skill invocation can
 * survive the executor restarting mid-tool-call and resume via
 * Last-Event-ID replay.
 *
 * Requires `SOGNI_SKILL_USE_SDK_TRANSPORT=1` since the durable surface
 * is only exposed via the SDK. When the flag is off (or the SDK isn't
 * installed) we fail with a clear error rather than silently falling
 * back to the synchronous endpoint.
 */
async function runApiChatDurable(log, { apiKey, body }) {
  let helpers;
  try {
    helpers = await import('./sogni-hosted-client.mjs');
  } catch (err) {
    const error = new Error('--durable-chat requires @sogni-ai/sogni-intelligence-client (SDK transport).');
    error.code = 'DURABLE_CHAT_UNAVAILABLE';
    error.cause = err;
    throw error;
  }
  if (!helpers.shouldUseSdkTransport()) {
    const error = new Error('--durable-chat requires SOGNI_SKILL_USE_SDK_TRANSPORT=1 to route through the durable SDK transport.');
    error.code = 'DURABLE_CHAT_TRANSPORT_DISABLED';
    throw error;
  }

  // Translate the synchronous chat-completions body to the durable
  // `StartChatRunParams` shape the SDK expects. Field names switch
  // from snake_case to camelCase per the durable contract.
  const sampling = {
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
    ...(body.task_profile ? { taskProfile: body.task_profile } : {}),
    ...(body.chat_template_kwargs?.enable_thinking !== undefined
      ? { think: body.chat_template_kwargs.enable_thinking }
      : {}),
  };
  const runParams = {
    model: body.model,
    messages: body.messages,
    ...(Object.keys(sampling).length > 0 ? { sampling } : {}),
    ...(body.token_type ? { tokenType: body.token_type } : {}),
    appSource: body.app_source || SOGNI_APP_SOURCE,
    ...(body.media_references ? { mediaReferences: body.media_references } : {}),
    ...(typeof body.safeContentFilter === 'boolean'
      ? { runtimeConfig: { safeContentFilter: body.safeContentFilter } }
      : {}),
  };

  const restEndpoint = await buildSafeApiUrl('/');
  const restBase = new URL(restEndpoint).origin;

  const assistantParts = [];
  const toolCalls = [];
  const workflows = [];
  let runId = null;
  let finalStatus = null;

  await helpers.withHostedClient(
    {
      apiKey,
      restEndpoint: restBase,
      socketEndpoint: process.env.SOGNI_SOCKET_ENDPOINT || undefined,
      appSource: SOGNI_APP_SOURCE,
      appId: `sogni-skill-sdk-${process.pid}-${Date.now()}`,
    },
    async (client) => {
      const created = await helpers.sdkChatRunsCreate(client, runParams);
      runId = created?.runId || created?.id || created?.run?.id || null;
      if (!runId) {
        const error = new Error('Durable chat run did not return a runId.');
        error.code = 'DURABLE_CHAT_NO_RUN_ID';
        error.details = { created };
        throw error;
      }
      if (!options.json) log(`Durable chat run started: ${runId}`);

      // Per-job tool_call_progress dedupe state. The sogni-api throttled
      // emitter sends 1 Hz `jobETA` countdowns + per-step progress
      // ticks per job; we log only when the value actually changes
      // (and only in non-JSON CLI mode) so a 16-image batch doesn't
      // pour ~16 lines/sec into the log file.
      const perJobLogState = new Map();
      const logJobUpdate = (line) => {
        if (options.json) return;
        log(line);
      };

      for await (const event of helpers.sdkChatRunsStreamEvents(client, runId, {})) {
        const type = event?.type || event?.event || '';
        const payload = chatRunEventPayload(event);
        // Stream assistant message deltas as they arrive.
        const delta = chatRunAssistantDelta(type, payload);
        if (typeof delta === 'string' && delta) {
          assistantParts.push(delta);
          if (!options.json) {
            process.stdout.write(delta);
          }
        }
        // Per-job progress / ETA / completion / error log lines for
        // CLI watchers. The sogni-api `tool_call_progress` SSE event
        // packs `jobIndex` + per-job fields (`jobProgress`,
        // `jobEtaSeconds`, `resultUrl`, `jobError`) for vendor-emulated
        // jobs (GPT, Seedance — 1 Hz `jobETA` heartbeat from
        // sogni-socket) and real workers (per-step progress).
        // Untouched payloads from older sogni-api builds simply lack
        // `jobIndex` and skip this block — forward-compatible.
        if (type === 'tool_call_progress' && payload && typeof payload === 'object') {
          const {
            jobIndex,
            jobProgress,
            jobEtaSeconds,
            resultUrl,
            jobError,
          } = extractToolCallProgressUpdate(payload);
          if (jobIndex !== undefined) {
            const state = perJobLogState.get(jobIndex) ?? {};
            if (jobError && state.error !== jobError) {
              logJobUpdate(`[job ${jobIndex}] error: ${jobError}`);
              state.error = jobError;
            } else if (resultUrl && state.resultUrl !== resultUrl) {
              logJobUpdate(`[job ${jobIndex}] done${jobProgress !== undefined ? ` (${Math.round(jobProgress * 100)}%)` : ''} → ${resultUrl}`);
              state.resultUrl = resultUrl;
              state.progress = jobProgress ?? state.progress;
            } else if (jobProgress !== undefined || jobEtaSeconds !== undefined) {
              // Dedupe: only emit when progress moved >=5% or ETA changed.
              const pctBefore = state.progress !== undefined ? Math.round(state.progress * 100) : -1;
              const pctNow = jobProgress !== undefined ? Math.round(jobProgress * 100) : pctBefore;
              const progressChanged = jobProgress !== undefined && Math.abs(pctNow - pctBefore) >= 5;
              const etaChanged = jobEtaSeconds !== undefined && jobEtaSeconds !== state.eta;
              if (progressChanged || etaChanged) {
                const parts = [`[job ${jobIndex}]`];
                if (jobProgress !== undefined) parts.push(`${pctNow}%`);
                else if (state.progress !== undefined) parts.push(`${pctBefore}%`);
                if (jobEtaSeconds !== undefined) parts.push(`(${jobEtaSeconds}s)`);
                logJobUpdate(parts.join(' '));
                if (jobProgress !== undefined) state.progress = jobProgress;
                if (jobEtaSeconds !== undefined) state.eta = jobEtaSeconds;
              }
            }
            perJobLogState.set(jobIndex, state);
          }
        }
        const eventToolCalls =
          payload?.toolCalls
          || payload?.tool_calls
          || payload?.choices?.[0]?.message?.tool_calls
          || [];
        if (Array.isArray(eventToolCalls) && eventToolCalls.length > 0) {
          toolCalls.push(...eventToolCalls);
        }
        const eventWorkflows =
          payload?.creative_workflows
          || payload?.creativeWorkflows
          || [];
        if (Array.isArray(eventWorkflows) && eventWorkflows.length > 0) {
          workflows.push(...eventWorkflows);
        }
        const terminalStatus = chatRunTerminalStatus(type, payload);
        if (terminalStatus) {
          finalStatus = terminalStatus;
          break;
        }
        if (chatRunFailureStatus(type)) {
          const error = new Error(payload?.error?.message || 'Durable chat run failed.');
          error.code = payload?.error?.code || 'DURABLE_CHAT_RUN_FAILED';
          error.details = { runId, payload };
          throw error;
        }
        if (chatRunWaitingStatus(type)) {
          finalStatus = payload?.status || 'waiting_for_user';
          if (!options.json) {
            const reason = payload?.reason || payload?.waiting?.reason || 'user input required';
            log(`Durable chat run is waiting for user input: ${reason}`);
          }
          break;
        }
      }
    },
  );

  const content = assistantParts.join('');
  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      type: 'durable-chat',
      runId,
      status: finalStatus,
      content,
      toolCalls,
      workflows,
    }));
    return;
  }
  if (assistantParts.length > 0) process.stdout.write('\n');
  if (toolCalls.length > 0) {
    console.log('\nTool calls:');
    for (const call of toolCalls) {
      console.log(`  - ${call.function?.name || call.name || call.id || 'tool_call'}`);
    }
  }
  if (workflows.length > 0) {
    console.log('\nCreative workflows:');
    for (const workflow of workflows) {
      console.log(`  - ${workflow.workflowId || workflow.id}: ${workflow.status || 'submitted'}`);
    }
  }
  if (!content && toolCalls.length === 0 && workflows.length === 0) {
    log('No durable chat content returned.');
  }
}

function parseJsonArgument(raw, label, code = 'INVALID_JSON_INPUT') {
  if (!raw) return null;
  let text;
  if (raw.startsWith('@')) {
    // Explicit @path sigil — strip, expand home, sanitize, read.
    const sourcePath = sanitizePath(expandHomePath(raw.slice(1)), `${label} file path`);
    try {
      text = readFileSync(sourcePath, 'utf8');
    } catch (error) {
      const err = new Error(`Unable to read ${label} file: ${error?.message || String(error)}`);
      err.code = code;
      err.details = { path: sourcePath };
      throw err;
    }
  } else {
    // Everything else is inline JSON. Do NOT auto-detect filesystem paths —
    // that turns CLI args into a file-existence oracle.
    text = raw;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = raw.startsWith('@')
      ? `Invalid ${label} JSON: ${error?.message || String(error)}`
      : `Invalid ${label} JSON (use @path to load JSON from a file): ${error?.message || String(error)}`;
    const err = new Error(message);
    err.code = code;
    throw err;
  }
}

function parseWorkflowInput(raw) {
  return parseJsonArgument(raw, '--workflow-input', 'INVALID_WORKFLOW_INPUT');
}

function buildGeneratedKeyframeVideoWorkflowInput() {
  const parsed = parseWorkflowInput(options.apiWorkflowInput);
  if (parsed) return parsed;
  const imageArgs = {
    prompt: options.prompt,
  };
  if (options.apiNegativePrompt) imageArgs.negativePrompt = options.apiNegativePrompt;
  if (Number.isFinite(options.width)) imageArgs.width = options.width;
  if (Number.isFinite(options.height)) imageArgs.height = options.height;
  if (options.model) imageArgs.model = options.model;
  if (Number.isFinite(options.count)) imageArgs.numberOfVariations = options.count;
  if (options.seed !== null && options.seed !== undefined) imageArgs.seed = options.seed;

  const videoArgs = {
    prompt: options.apiVideoPrompt || options.prompt,
  };
  if (options.apiNegativePrompt) videoArgs.negativePrompt = options.apiNegativePrompt;
  if (Number.isFinite(options.width)) videoArgs.width = options.width;
  if (Number.isFinite(options.height)) videoArgs.height = options.height;
  if (Number.isFinite(options.duration)) videoArgs.duration = options.duration;
  if (options.videoModel) videoArgs.videoModel = options.videoModel;
  if (Number.isFinite(options.count)) videoArgs.numberOfVariations = options.count;
  if (options.apiGenerateAudio !== null) videoArgs.generateAudio = options.apiGenerateAudio;
  if (options.apiExpandPrompt !== null) videoArgs.expandPrompt = options.apiExpandPrompt;

  return {
    title: options.apiWorkflowTitle || 'Generated keyframe to video',
    steps: [
      {
        id: 'keyframe',
        toolName: 'generate_image',
        arguments: imageArgs,
      },
      {
        id: 'clip',
        toolName: 'generate_video',
        arguments: videoArgs,
        dependsOn: [
          {
            sourceStepId: 'keyframe',
            sourceArtifactIndex: 0,
            targetArgument: 'referenceImageIndices',
            mediaType: 'image',
            transform: 'image_index',
            required: true,
          },
        ],
      },
    ],
  };
}

function storyboardWorkflowImageQualityFromCli() {
  if (!cliSet.quality || !options.quality) return undefined;
  if (options.quality === 'pro') return 'high';
  if (options.quality === 'fast') return 'low';
  return 'medium';
}

function storyboardWorkflowInputFromParsedValue(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (Array.isArray(parsed.steps)) return parsed;

  const storyline = typeof parsed.storyline === 'string'
    ? parsed.storyline
    : typeof parsed.script === 'string'
      ? parsed.script
      : typeof parsed.storyboardScript === 'string'
        ? parsed.storyboardScript
        : null;
  if (!storyline) return null;
  const explicitCliVideoModel = options.videoModel
    || (cliSet.model && isSeedanceModelSelection(options.model) ? options.model : undefined);
  const explicitCliImageModel = cliSet.model && !isSeedanceModelSelection(options.model) ? options.model : undefined;

  return buildStoryboardVideoHostedToolSequenceInput({
    storyline,
    userIntentText: typeof parsed.userIntentText === 'string'
      ? parsed.userIntentText
      : typeof parsed.prompt === 'string'
        ? parsed.prompt
        : options.prompt || storyline,
    title: typeof parsed.title === 'string' ? parsed.title : options.apiWorkflowTitle,
    frameCount: typeof parsed.frameCount === 'number'
      ? parsed.frameCount
      : typeof parsed.storyboardFrames === 'number'
        ? parsed.storyboardFrames
        : options.storyboardFrames ?? undefined,
    videoDurationSec: typeof parsed.videoDurationSec === 'number'
      ? parsed.videoDurationSec
      : cliSet.duration && Number.isFinite(options.duration)
        ? options.duration
        : undefined,
    videoTargetResolution: Number.isFinite(parsed.videoTargetResolution)
      ? parsed.videoTargetResolution
      : cliSet.targetResolution && Number.isFinite(options.targetResolution)
        ? options.targetResolution
        : undefined,
    imageModel: typeof parsed.imageModel === 'string' ? parsed.imageModel : explicitCliImageModel,
    imageQuality: typeof parsed.imageQuality === 'string'
      ? parsed.imageQuality
      : typeof parsed.gptImageQuality === 'string'
        ? parsed.gptImageQuality
        : storyboardWorkflowImageQualityFromCli(),
    imageOutputFormat: typeof parsed.imageOutputFormat === 'string'
      ? parsed.imageOutputFormat
      : typeof parsed.outputFormat === 'string'
        ? parsed.outputFormat
        : cliSet.outputFormat
          ? options.outputFormat
          : undefined,
    videoModel: typeof parsed.videoModel === 'string' ? parsed.videoModel : explicitCliVideoModel,
    generateAudio: typeof parsed.generateAudio === 'boolean' ? parsed.generateAudio : options.apiGenerateAudio ?? undefined,
  });
}

function buildStoryboardStorylineMessages() {
  const durationLine = cliSet.duration && Number.isFinite(options.duration)
    ? `Target duration: ${options.duration} seconds.`
    : 'Target duration: infer a Seedance-safe duration between 4 and 15 seconds from the request.';
  const frameLine = Number.isFinite(options.storyboardFrames)
    ? `Storyboard beat count: exactly ${options.storyboardFrames}.`
    : 'Storyboard beat count: infer a compact 4-8 beat plan unless the user asks otherwise.';
  const targetResolutionLine = cliSet.targetResolution && Number.isFinite(options.targetResolution)
    ? `Video target short-side resolution: ${options.targetResolution}p.`
    : '';
  const system = [
    'You write production-ready video storyboard storylines for a GPT Image 2 storyboard sheet that will be rendered into a Seedance 2.0 video.',
    'Return only the storyline/script. Do not call tools, do not ask follow-up questions, and do not include markdown fences.',
    'Use this exact plain-text structure so downstream compilers can parse it: Project Title, Total Duration, then one SCENE NN - Title block per beat.',
    'Each scene block must put each field on its own line: TIME, PURPOSE, VISUAL, ACTION, CAMERA, LIGHTING/STYLE, TRANSITION, DIALOGUE/VO, AUDIO/SFX, MUSIC, VISIBLE TEXT.',
    'When there is no spoken dialogue or voiceover, write DIALOGUE/VO: [no dialogue]. Do not write None, N/A, or leave it blank.',
    'If the user requires exact visible text, repeat that exact text only in the relevant VISIBLE TEXT field and preserve spelling exactly.',
    'Keep it concise enough for one GPT Image 2 storyboard image and one Seedance video prompt, while preserving cause-and-effect story progression.',
  ].join(' ');
  const user = [
    'Original user request:',
    options.prompt,
    '',
    durationLine,
    frameLine,
    targetResolutionLine,
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

async function generateStoryboardWorkflowStoryline(apiKey) {
  const messages = sanitizeMessagesForLlm(buildStoryboardStorylineMessages());
  const chatTemplateKwargs = apiChatTemplateKwargs();
  const body = {
    model: options.llmModel || DEFAULT_LLM_MODEL,
    messages,
    temperature: 0.45,
    max_tokens: options.apiMaxTokens || 1800,
    token_type: options.tokenType || 'spark',
    app_source: SOGNI_APP_SOURCE,
    ...(options.apiTaskProfile ? { task_profile: options.apiTaskProfile } : {}),
    ...(chatTemplateKwargs ? { chat_template_kwargs: chatTemplateKwargs } : {}),
    sogni_tools: false,
    sogni_tool_execution: false
  };
  const payload =
    (await dispatchChatHostedViaSdk(apiKey, body))
    ?? (await fetchApiJson('/v1/chat/completions', {
      apiKey,
      method: 'POST',
      body
    }));
  const message = extractChatMessage(payload);
  const storyline = typeof message.content === 'string' ? message.content.trim() : '';
  if (!storyline) {
    const err = new Error('Storyboard-video planning did not return a storyline.');
    err.code = 'EMPTY_STORYBOARD_STORYLINE';
    err.details = { payload };
    throw err;
  }
  return { storyline, raw: payload };
}

async function buildStoryboardVideoWorkflowInput(apiKey) {
  const parsed = parseWorkflowInput(options.apiWorkflowInput);
  const parsedPlan = storyboardWorkflowInputFromParsedValue(parsed);
  if (parsedPlan) {
    return parsedPlan.input ? { plan: parsedPlan, planningRaw: null } : { plan: { input: parsedPlan }, planningRaw: null };
  }

  const { storyline, raw } = await generateStoryboardWorkflowStoryline(apiKey);
  const explicitCliVideoModel = options.videoModel
    || (cliSet.model && isSeedanceModelSelection(options.model) ? options.model : undefined);
  const explicitCliImageModel = cliSet.model && !isSeedanceModelSelection(options.model) ? options.model : undefined;
  const plan = buildStoryboardVideoHostedToolSequenceInput({
    storyline,
    userIntentText: options.prompt,
    title: options.apiWorkflowTitle,
    frameCount: options.storyboardFrames ?? undefined,
    videoDurationSec: cliSet.duration && Number.isFinite(options.duration) ? options.duration : undefined,
    videoTargetResolution: cliSet.targetResolution && Number.isFinite(options.targetResolution) ? options.targetResolution : undefined,
    imageModel: explicitCliImageModel,
    imageQuality: storyboardWorkflowImageQualityFromCli(),
    imageOutputFormat: cliSet.outputFormat ? options.outputFormat : undefined,
    videoModel: explicitCliVideoModel,
    generateAudio: options.apiGenerateAudio ?? undefined,
  });
  return { plan, planningRaw: raw };
}

function workflowFromPayload(payload) {
  const data = extractApiEnvelopeData(payload);
  return data?.workflow || payload?.workflow || payload;
}

function workflowsFromPayload(payload) {
  const data = extractApiEnvelopeData(payload);
  return data?.workflows || payload?.workflows || [];
}

function eventsFromPayload(payload) {
  const data = extractApiEnvelopeData(payload);
  return data?.events || payload?.events || [];
}

function modelsFromPayload(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  const data = extractApiEnvelopeData(payload);
  const models = Array.isArray(data) ? data : data?.models;
  return Array.isArray(models) ? models : [];
}

async function runApiModels() {
  const creds = loadCredentials();
  const type = 'api-models';
  const action = options.apiModelAction || 'list';
  const apiKey = requireApiKeyCredentials(creds, action === 'get' ? '--get-api-model' : '--list-api-models');
  const payload = action === 'get'
    ? await fetchApiJson(`/v1/models/${encodeURIComponent(options.apiModelId)}`, { apiKey })
    : await fetchApiJson('/v1/models', { apiKey });

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      type,
      action,
      ...(action === 'get' ? { model: payload } : { models: modelsFromPayload(payload) }),
      raw: payload
    }));
    return;
  }

  if (action === 'get') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const models = modelsFromPayload(payload);
  for (const model of models) {
    console.log(`${model.id || model.modelId || model.name || '(unknown)'}\t${model.owned_by || model.displayName || ''}`);
  }
}

function recordsFromReplayPayload(payload) {
  const data = extractApiEnvelopeData(payload);
  return Array.isArray(data?.records) ? data.records : Array.isArray(payload?.records) ? payload.records : [];
}

function replayRecordFromPayload(payload) {
  const data = extractApiEnvelopeData(payload);
  return data?.record || payload?.record || payload;
}

// Defense-in-depth: every RunRecord that leaves this CLI passes through
// the shared `redactRunRecord` so signed URLs, bearer tokens, JWTs, etc.
// can't leak via stdout. Records that don't yet match the canonical
// RunRecord shape fall back to `redactPayload`, which scrubs the same
// secret patterns at the value layer.
function safeRedactRunRecord(record) {
  if (!record || typeof record !== 'object') return record;
  if (options.skipRedact) return record;
  if (Array.isArray(record.rounds) && typeof record.run_id === 'string') {
    try {
      return redactRunRecord(record);
    } catch {
      // fall through to payload-level redaction
    }
  }
  return redactPayload(record);
}

function safeRedactRunRecords(records) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => safeRedactRunRecord(record));
}

async function runApiReplay() {
  const creds = loadCredentials();
  const type = 'api-replay';
  const action = options.apiReplayAction || 'list';
  const replayModeLabel = action === 'get'
    ? '--get-replay'
    : action === 'ingest'
      ? '--ingest-replay'
      : '--list-replays';
  const apiKey = requireApiKeyCredentials(creds, replayModeLabel);
  let payload;

  if (action === 'list') {
    payload = await fetchApiJson(`/v1/replay/records?limit=${encodeURIComponent(options.apiReplayLimit || 50)}`, { apiKey });
    const records = safeRedactRunRecords(recordsFromReplayPayload(payload));
    if (options.json) {
      console.log(JSON.stringify({ success: true, type, action, records, redacted: !options.skipRedact }));
    } else {
      for (const record of records) {
        console.log(`${record.runId || record.run_id || '(unknown)'}\t${record.modelId || record.model_id || '-'}\t${record.rounds ?? '-'}\t${record.userRequest || record.user_request || ''}`);
      }
    }
    return;
  }

  if (action === 'get') {
    payload = await fetchApiJson(`/v1/replay/records/${encodeURIComponent(options.apiReplayId)}`, { apiKey });
    const record = safeRedactRunRecord(replayRecordFromPayload(payload));
    if (options.json) {
      console.log(JSON.stringify({ success: true, type, action, runId: options.apiReplayId, record, redacted: !options.skipRedact }));
    } else {
      console.log(JSON.stringify(record, null, 2));
    }
    return;
  }

  const recordInput = parseJsonArgument(options.apiReplayInput, '--ingest-replay', 'INVALID_REPLAY_INPUT');
  payload = await fetchApiJson('/v1/replay/records', {
    apiKey,
    method: 'POST',
    body: recordInput
  });
  const result = extractApiEnvelopeData(payload);
  if (options.json) {
    console.log(JSON.stringify({ success: true, type, action, result }));
  } else {
    console.log(`Replay record ingested: ${result.runId || result.run_id || recordInput?.run_id || '(unknown)'}`);
  }
}

// ---------------------------------------------------------------------------
// Public contract-runtime debug surface — mirrors the chat/api Structured
// Contracts v1 pipeline (classifyTurn → compileTools → dispatchToolCall)
// so consumers can verify per-turn routing matches the live surfaces.
// ---------------------------------------------------------------------------
function buildContractSessionState() {
  const hasUploadedImage = Boolean(options.refImage || (Array.isArray(options.contextImages) && options.contextImages.length > 0));
  const hasUploadedVideo = Boolean(options.refVideo);
  const hasUploadedAudio = Boolean(options.refAudio || options.referenceAudioIdentity);
  return {
    hasUploadedImage,
    hasUploadedVideo,
    hasUploadedAudio,
    hasActivePersona: Boolean(options.voicePersonaName || options._resolvedPersona),
  };
}

function buildContractRuntimeForCli() {
  return createPublicSkillDefaultContractRuntime();
}

function buildContractTools() {
  return PUBLIC_SKILL_DEFAULT_TOOL_DEFINITIONS;
}

function buildContractTurnInput() {
  const runtime = buildContractRuntimeForCli();
  const sessionState = buildContractSessionState();
  const tools = buildContractTools();
  const availableTools = tools.map((tool) => tool.function?.name).filter(Boolean);
  return { runtime, sessionState, tools, availableTools };
}

function runContractDebugAction() {
  const { runtime, sessionState, tools, availableTools } = buildContractTurnInput();
  if (options.contractAction === 'classify') {
    const turnPolicy = classifyPublicSkillTurn({
      availableTools,
      sessionState,
      runtime,
    });
    console.log(JSON.stringify({
      success: true,
      type: 'contract-classify',
      sessionState,
      availableTools,
      turnPolicy,
    }, null, options.json ? 0 : 2));
    return;
  }
  if (options.contractAction === 'compile') {
    const compiled = compilePublicSkillToolSurface({
      tools,
      sessionState,
      runtime,
    });
    const turnPolicy = compiled.turnPolicy ?? classifyPublicSkillTurn({
      availableTools,
      sessionState,
      runtime,
    });
    console.log(JSON.stringify({
      success: true,
      type: 'contract-compile',
      sessionState,
      turnPolicy,
      tools: compiled.tools.map((tool) => ({
        name: tool.function?.name,
        description: tool.function?.description,
      })),
    }, null, options.json ? 0 : 2));
    return;
  }
  if (options.contractAction === 'dispatch') {
    let parsedArgs = {};
    if (options.contractToolArgs) {
      try {
        parsedArgs = JSON5.parse(options.contractToolArgs);
      } catch (err) {
        fatalCliError(`--tool-args must be valid JSON: ${err.message}`, { code: 'INVALID_JSON_INPUT' });
      }
    }
    const turnPolicy = classifyPublicSkillTurn({
      availableTools,
      sessionState,
      runtime,
    });
    const verdict = dispatchPublicSkillToolCall({
      toolName: options.contractToolName,
      arguments: parsedArgs,
      turnPolicy,
      runtime,
    });
    console.log(JSON.stringify({
      success: true,
      type: 'contract-dispatch',
      toolName: options.contractToolName,
      arguments: parsedArgs,
      turnPolicy,
      verdict,
    }, null, options.json ? 0 : 2));
    return;
  }
  fatalCliError(`Unknown contract action: ${options.contractAction}`, { code: 'INVALID_ARGUMENT' });
}

// ---------------------------------------------------------------------------
// Local storyboard plan — exposes the same buildStoryboardProject /
// compileForModel adapters used by the hosted storyboard pipeline so the
// CLI can inspect (and downstream agents can consume) the compiled plan
// without round-tripping to the hosted API.
// ---------------------------------------------------------------------------
function runStoryboardPlanAction() {
  const frameCount = options.storyboardPlanFrames
    ?? (options.storyboardFrames || null)
    ?? null;
  const project = buildStoryboardProject({
    prompt: options.prompt,
    userIntentText: options.prompt,
    frameCount: frameCount ?? undefined,
    promptAuthorship: 'user',
  });
  // --storyboard-plan is a model-agnostic preview surface that hands off to
  // a per-model adapter (seedance / gpt-image-2 / ltx23 / wan). When the
  // user doesn't pick one, prefer the seedance adapter because it owns the
  // canonical storyboard-reference prompt; the user's currently-set image
  // model (e.g., z_image_turbo_bf16) is not a registered storyboard adapter.
  const adapterId = options.storyboardPlanModel
    ?? (options.video ? resolveVideoModelAlias(options.model, options.videoWorkflow || 't2v') : null)
    ?? 'seedance';
  const stage = options.storyboardPlanStage || 'storyboard_image';
  let compiled = null;
  try {
    const firstScene = Array.isArray(project.scenes) ? project.scenes[0] : null;
    compiled = compileForModel(adapterId, project, { stage, scene: firstScene });
  } catch (err) {
    compiled = { error: err?.message || String(err) };
  }
  const payload = {
    success: true,
    type: 'storyboard-plan',
    adapterId,
    stage,
    frameCount: project.frameCount ?? frameCount ?? null,
    aspectRatio: project.layout?.aspectRatio ?? null,
    layout: project.layout ?? null,
    scenes: project.scenes ?? [],
    references: project.references ?? [],
    durationSec: project.durationSec ?? null,
    compiled,
    adapterGuidance: composeAdapterPromptGuidance(),
  };
  if (options.json || JSON_ERROR_MODE) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

function printWorkflowSummary(workflow) {
  console.log(`Workflow: ${workflow.workflowId || workflow.id || '(unknown)'}`);
  if (workflow.status) console.log(`Status:   ${workflow.status}`);
  if (workflow.title) console.log(`Title:    ${workflow.title}`);
  const artifacts = Array.isArray(workflow.artifacts) ? workflow.artifacts : [];
  if (artifacts.length > 0) {
    console.log('\nArtifacts:');
    for (const artifact of artifacts) {
      console.log(`  - ${artifact.type || artifact.mediaType || 'artifact'}: ${artifact.url || artifact.id || JSON.stringify(artifact)}`);
    }
  }
}

function printWorkflowSseFrames(raw) {
  const frames = typeof parseCreativeWorkflowSseChunk === 'function'
    ? parseCreativeWorkflowSseChunk(raw)
    : parseWorkflowSseChunk(raw);
  for (const frame of frames) {
    const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
    const suffix = data.status ? ` ${data.status}` : data.message ? ` ${data.message}` : '';
    const line = `[${frame.id || '-'}] ${frame.event}${suffix}`;
    // In JSON mode stdout must stay a single machine-parseable object, so
    // human-readable progress frames go to stderr instead.
    if (options.json || JSON_ERROR_MODE) {
      process.stderr.write(line + '\n');
    } else {
      console.log(line);
    }
  }
}

function parseWorkflowSseChunk(raw) {
  const frames = [];
  const chunks = String(raw || '').split(/\r?\n\r?\n/).filter(chunk => chunk.trim());
  for (const chunk of chunks) {
    const frame = { id: null, event: 'message', data: null };
    const dataLines = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator >= 0 ? line.slice(0, separator) : line;
      const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : '';
      if (field === 'id') frame.id = value;
      else if (field === 'event') frame.event = value || 'message';
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length > 0) {
      const dataText = dataLines.join('\n');
      try {
        frame.data = JSON.parse(dataText);
      } catch {
        frame.data = { message: dataText };
      }
    }
    frames.push(frame);
  }
  return frames;
}

async function streamApiWorkflowEvents(apiKey, workflowId) {
  const url = await buildSafeApiUrl(`/v1/creative-agent/workflows/${encodeURIComponent(workflowId)}/events/stream`);

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: apiRequestHeaders(apiKey, { Accept: 'text/event-stream' })
  });
  if (!response.ok) {
    const err = new Error(`Workflow stream failed (${response.status} ${response.statusText})`);
    err.code = 'API_STREAM_FAILED';
    throw err;
  }
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(boundary + (match?.[0].length || 2));
        printWorkflowSseFrames(chunk);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      printWorkflowSseFrames(buffer);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function runApiWorkflow() {
  const creds = loadCredentials();
  const apiKey = requireApiKeyCredentials(creds, '--api-workflow');
  const tokenType = options.tokenType || 'spark';
  let payload;
  let type = 'api-workflow';

  if (options.apiWorkflowAction === 'list') {
    payload =
      (await dispatchWorkflowActionViaSdk('list', apiKey, { limit: 20 }))
      ?? (await fetchApiJson('/v1/creative-agent/workflows?limit=20', { apiKey }));
    const workflows = workflowsFromPayload(payload);
    if (options.json) {
      console.log(JSON.stringify({ success: true, type, action: 'list', workflows, raw: payload }));
    } else {
      for (const workflow of workflows) {
        console.log(`${workflow.workflowId || workflow.id}\t${workflow.status || '-'}\t${workflow.title || ''}`);
      }
    }
    return;
  }

  if (
    options.apiWorkflowAction === 'get'
    || options.apiWorkflowAction === 'events'
    || options.apiWorkflowAction === 'stream'
    || options.apiWorkflowAction === 'cancel'
    || options.apiWorkflowAction === 'resume'
  ) {
    const id = options.apiWorkflowId;
    if (!id) {
      const err = new Error('Workflow id is required.');
      err.code = 'MISSING_WORKFLOW_ID';
      throw err;
    }
    if (options.apiWorkflowAction === 'stream') {
      if (options.json) {
        console.log(JSON.stringify({ success: true, type, action: 'stream', workflowId: id, note: 'SSE progress frames stream to stderr in JSON mode.' }));
      }
      await streamApiWorkflowEvents(apiKey, id);
      return;
    }
    // Prefer SDK transport when opted-in. `resume` has no SDK
    // equivalent yet (it lives on the API; the SDK exposes
    // cancel/get/events/streamEvents). For resume we fall through to
    // the legacy fetch path.
    let sdkPayload = null;
    if (
      options.apiWorkflowAction === 'get'
      || options.apiWorkflowAction === 'events'
      || options.apiWorkflowAction === 'cancel'
    ) {
      sdkPayload = await dispatchWorkflowActionViaSdk(options.apiWorkflowAction, apiKey, {
        workflowId: id,
      });
    }
    const path = options.apiWorkflowAction === 'events'
      ? `/v1/creative-agent/workflows/${encodeURIComponent(id)}/events`
      : options.apiWorkflowAction === 'cancel'
        ? `/v1/creative-agent/workflows/${encodeURIComponent(id)}/cancel`
        : options.apiWorkflowAction === 'resume'
          ? `/v1/creative-agent/workflows/${encodeURIComponent(id)}/resume`
          : `/v1/creative-agent/workflows/${encodeURIComponent(id)}`;
    payload = sdkPayload ?? (await fetchApiJson(path, {
      apiKey,
      method: options.apiWorkflowAction === 'cancel' || options.apiWorkflowAction === 'resume' ? 'POST' : 'GET'
    }));
    if (options.apiWorkflowAction === 'events') {
      const events = eventsFromPayload(payload);
      if (options.json) console.log(JSON.stringify({ success: true, type, action: 'events', workflowId: id, events, raw: payload }));
      else console.log(JSON.stringify(events, null, 2));
      return;
    }
    const workflow = workflowFromPayload(payload);
    if (options.json) console.log(JSON.stringify({ success: true, type, action: options.apiWorkflowAction, workflow, raw: payload }));
    else printWorkflowSummary(workflow);
    return;
  }

  const apiMediaReferences = await buildApiMediaReferencesPayload(undefined, {
    apiKey,
    requireUploadedMedia: true,
  });
  const requestedTemplate = options.apiWorkflowTemplate || 'generated_keyframe_video';
  let input;
  let storyboardPlan = null;
  let storyboardPlanningRaw = null;

  if (requestedTemplate === 'storyboard_video') {
    const built = await buildStoryboardVideoWorkflowInput(apiKey);
    storyboardPlan = built.plan;
    storyboardPlanningRaw = built.planningRaw;
    input = storyboardPlan.input;
  } else {
    input = buildGeneratedKeyframeVideoWorkflowInput();
  }

  payload =
    (await dispatchWorkflowActionViaSdk('start', apiKey, {
      input,
      tokenType,
      mediaReferences: apiMediaReferences.length > 0 ? apiMediaReferences : undefined,
      maxEstimatedCapacityUnits: options.apiWorkflowMaxCost ?? undefined,
      confirmCost: options.apiWorkflowConfirmCost ?? undefined,
      idempotencyKey: options.apiWorkflowIdempotencyKey ?? undefined,
    }))
    ?? (await fetchApiJson('/v1/creative-agent/workflows', {
      apiKey,
      method: 'POST',
      headers: options.apiWorkflowIdempotencyKey
        ? { 'Idempotency-Key': options.apiWorkflowIdempotencyKey }
        : {},
      body: {
        input,
        ...(apiMediaReferences.length > 0 ? { media_references: apiMediaReferences } : {}),
        ...(options.apiWorkflowMaxCost !== null ? {
          max_estimated_capacity_units: options.apiWorkflowMaxCost,
        } : {}),
        ...(options.apiWorkflowConfirmCost !== null ? { confirm_cost: options.apiWorkflowConfirmCost } : {}),
        token_type: tokenType,
        app_source: SOGNI_APP_SOURCE
      }
    }));
  const workflow = workflowFromPayload(payload);
  const workflowId = workflow?.workflowId || workflow?.id;
  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      type,
      action: 'start',
      ...(storyboardPlan ? {
        storyline: storyboardPlan.storyline,
        storyboardPlan: {
          title: storyboardPlan.title,
          frameCount: storyboardPlan.frameCount,
          image: storyboardPlan.image,
          video: storyboardPlan.video,
          warnings: storyboardPlan.warnings,
        },
      } : {}),
      workflow,
      raw: payload,
      ...(storyboardPlanningRaw ? { planningRaw: storyboardPlanningRaw } : {}),
    }));
  } else {
    if (storyboardPlan?.storyline) {
      console.log('Generated storyline:\n');
      console.log(storyboardPlan.storyline);
      console.log('');
    }
    printWorkflowSummary(workflow);
  }
  if (options.apiWorkflowWatch && workflowId) {
    await streamApiWorkflowEvents(apiKey, workflowId);
  }
}

// ---------------------------------------------------------------------------
// Memory system — persistent user preferences on disk
// ---------------------------------------------------------------------------
const MEMORIES_PATH = resolveConfiguredPath(
  getEnv('SOGNI_MEMORIES_PATH'),
  DEFAULT_MEMORIES_PATH,
  'SOGNI memories path'
);

function loadMemories() {
  try {
    if (existsSync(MEMORIES_PATH)) return JSON.parse(readFileSync(MEMORIES_PATH, 'utf8'));
  } catch {}
  return [];
}

function saveMemories(memories) {
  const dir = dirname(MEMORIES_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(MEMORIES_PATH, JSON.stringify(memories, null, 2));
}

function memorySet(key, value, category = 'preference', source = 'user') {
  const memories = loadMemories();
  const existing = memories.findIndex(m => m.key === key);
  const entry = { key, value, category, source, updatedAt: Date.now() };
  if (existing >= 0) { memories[existing] = { ...memories[existing], ...entry }; }
  else { memories.push({ id: randomBytes(8).toString('hex'), ...entry, createdAt: Date.now() }); }
  saveMemories(memories);
  return existing >= 0 ? 'updated' : 'created';
}

function memoryRemove(key) {
  const memories = loadMemories();
  const filtered = memories.filter(m => m.key !== key);
  if (filtered.length === memories.length) return false;
  saveMemories(filtered);
  return true;
}

// ---------------------------------------------------------------------------
// Personality system — custom instructions for agent behavior
// ---------------------------------------------------------------------------
const PERSONALITY_PATH = resolveConfiguredPath(
  getEnv('SOGNI_PERSONALITY_PATH'),
  DEFAULT_PERSONALITY_PATH,
  'SOGNI personality path'
);

function loadPersonality() {
  try {
    if (existsSync(PERSONALITY_PATH)) return readFileSync(PERSONALITY_PATH, 'utf8').trim();
  } catch {}
  return null;
}

function savePersonality(text) {
  const dir = dirname(PERSONALITY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PERSONALITY_PATH, text);
}

function clearPersonality() {
  try { if (existsSync(PERSONALITY_PATH)) unlinkSync(PERSONALITY_PATH); } catch {}
}

// ---------------------------------------------------------------------------
// Persona system — named people with reference photos and voice clips
// ---------------------------------------------------------------------------
const PERSONAS_DIR = resolveConfiguredPath(
  getEnv('SOGNI_PERSONAS_DIR'),
  DEFAULT_PERSONAS_DIR,
  'SOGNI personas directory'
);
const PERSONAS_INDEX_PATH = join(PERSONAS_DIR, 'index.json');

function loadPersonas() {
  try {
    if (existsSync(PERSONAS_INDEX_PATH)) return JSON.parse(readFileSync(PERSONAS_INDEX_PATH, 'utf8'));
  } catch {}
  return [];
}

function savePersonasIndex(personas) {
  if (!existsSync(PERSONAS_DIR)) mkdirSync(PERSONAS_DIR, { recursive: true });
  writeFileSync(PERSONAS_INDEX_PATH, JSON.stringify(personas, null, 2));
}

function personaSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function addPersona({ name, relationship, description, tags, voice, photoPath, voiceClipPath }) {
  const personas = loadPersonas();
  if (personas.find(p => p.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Persona "${name}" already exists. Remove it first or use a different name.`);
  }
  const slug = personaSlug(name);
  const personaDir = join(PERSONAS_DIR, slug);
  if (!existsSync(personaDir)) mkdirSync(personaDir, { recursive: true });

  // Copy photo
  let savedPhotoPath = null;
  if (photoPath) {
    const resolvedPhoto = expandHomePath(photoPath);
    if (!existsSync(resolvedPhoto)) throw new Error(`Photo not found: ${resolvedPhoto}`);
    const ext = extname(resolvedPhoto).toLowerCase() || '.jpg';
    savedPhotoPath = join(personaDir, `photo${ext}`);
    writeFileSync(savedPhotoPath, readFileSync(resolvedPhoto));
  }

  // Copy voice clip
  let savedVoicePath = null;
  if (voiceClipPath) {
    const resolvedVoice = expandHomePath(voiceClipPath);
    if (!existsSync(resolvedVoice)) throw new Error(`Voice clip not found: ${resolvedVoice}`);
    const ext = extname(resolvedVoice).toLowerCase() || '.webm';
    savedVoicePath = join(personaDir, `voice-clip${ext}`);
    writeFileSync(savedVoicePath, readFileSync(resolvedVoice));
  }

  const persona = {
    id: randomBytes(8).toString('hex'),
    name,
    slug,
    relationship: relationship || 'friend',
    description: description || '',
    tags: tags || [],
    voice: voice || null,
    photoPath: savedPhotoPath,
    voiceClipPath: savedVoicePath,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  personas.push(persona);
  savePersonasIndex(personas);
  return persona;
}

function removePersona(name) {
  const personas = loadPersonas();
  const idx = personas.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  if (idx < 0) return false;
  const persona = personas[idx];
  // Remove persona directory
  const personaDir = join(PERSONAS_DIR, persona.slug);
  try {
    if (existsSync(personaDir)) {
      const entries = readdirSync(personaDir);
      for (const entry of entries) {
        const fp = join(personaDir, entry);
        if (statSync(fp).isFile()) unlinkSync(fp);
      }
      rmdirSync(personaDir);
    }
  } catch {}
  personas.splice(idx, 1);
  savePersonasIndex(personas);
  return true;
}

function resolvePersonaByName(name) {
  const personas = loadPersonas();
  // Match by name (case-insensitive)
  let match = personas.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (match) return match;
  // Match by stable id
  match = personas.find(p => typeof p.id === 'string' && p.id.toLowerCase() === name.toLowerCase());
  if (match) return match;
  // Match by tag
  match = personas.find(p => p.tags?.some(t => t.toLowerCase() === name.toLowerCase()));
  return match || null;
}

function applyPersonaAndVoiceReferences() {
  if (options.voicePersonaName) {
    const voicePersona = resolvePersonaByName(options.voicePersonaName);
    if (!voicePersona) {
      fatalCliError(`Voice persona "${options.voicePersonaName}" not found. Use --persona-list to see available personas.`, {
        code: 'PERSONA_NOT_FOUND'
      });
    }
    if (!voicePersona.voiceClipPath || !existsSync(voicePersona.voiceClipPath)) {
      fatalCliError(`Voice persona "${voicePersona.name}" does not have a saved voice clip.`, {
        code: 'PERSONA_VOICE_NOT_FOUND'
      });
    }
    if (!options.referenceAudioIdentity) {
      options.referenceAudioIdentity = voicePersona.voiceClipPath;
      cliSet.referenceAudioIdentity = true;
    }
    options._voicePersonaResolvedName = voicePersona.name;
  }

  if (options.personaAction !== 'generate' || !options.personaName) return;

  const persona = resolvePersonaByName(options.personaName);
  if (!persona) {
    fatalCliError(`Persona "${options.personaName}" not found. Use --persona-list to see available personas.`, {
      code: 'PERSONA_NOT_FOUND'
    });
  }

  options._resolvedPersona = persona;

  if (persona.photoPath && existsSync(persona.photoPath)) {
    if (options.video) {
      if (!options.refImage) {
        options.refImage = persona.photoPath;
      }
    } else {
      options.contextImages.push(persona.photoPath);
    }
  }

  if (options.video && persona.voiceClipPath && existsSync(persona.voiceClipPath) && !options.referenceAudioIdentity) {
    options.referenceAudioIdentity = persona.voiceClipPath;
    options.voicePersonaName = options.voicePersonaName || persona.name;
    options._voicePersonaResolvedName = persona.name;
  }
}

// Fetch image as buffer
async function fetchMediaBuffer(pathOrUrl) {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    // fetchSafeUrl re-validates every redirect hop, so a vetted public URL
    // cannot bounce the download to a private/metadata address.
    const response = await fetchSafeUrl(pathOrUrl, {}, {
      fetchImpl: (resource, init) => fetchWithTimeout(resource, init)
    });
    if (!response.ok) {
      const err = new Error(`Failed to fetch media (${response.status} ${response.statusText})`);
      err.code = 'FETCH_FAILED';
      err.details = { url: pathOrUrl, status: response.status, statusText: response.statusText };
      throw err;
    }
    return Buffer.from(await response.arrayBuffer());
  }
  try {
    return readFileSync(pathOrUrl);
  } catch (e) {
    const err = new Error(`Failed to read media file: ${pathOrUrl}`);
    err.code = 'MISSING_FILE';
    err.hint = 'Check the path or use a URL.';
    err.details = { path: pathOrUrl, cause: e?.message || String(e) };
    throw err;
  }
}

async function fetchMediaBlob(pathOrUrl, fallbackMimeType = 'application/octet-stream') {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    // fetchSafeUrl re-validates every redirect hop, so a vetted public URL
    // cannot bounce the download to a private/metadata address.
    const response = await fetchSafeUrl(pathOrUrl, {}, {
      fetchImpl: (resource, init) => fetchWithTimeout(resource, init)
    });
    if (!response.ok) {
      const err = new Error(`Failed to fetch media (${response.status} ${response.statusText})`);
      err.code = 'FETCH_FAILED';
      err.details = { url: pathOrUrl, status: response.status, statusText: response.statusText };
      throw err;
    }
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
    const mimeType = contentType || mimeTypeForPath(pathOrUrl, fallbackMimeType);
    return new Blob([await response.arrayBuffer()], { type: mimeType });
  }

  const buffer = await fetchMediaBuffer(pathOrUrl);
  return new Blob([buffer], { type: mimeTypeForPath(pathOrUrl, fallbackMimeType) });
}

async function prepareReferenceAudioIdentityMedia(pathOrUrl) {
  const cleanExt = extname(String(pathOrUrl || '').split('?')[0]).toLowerCase();
  if (!pathOrUrl.startsWith('http://') && !pathOrUrl.startsWith('https://') && (cleanExt === '.wav' || cleanExt === '.wave')) {
    const sourcePath = sanitizePath(pathOrUrl, '--reference-audio-identity');
    const ffmpegPath = await ensureFfmpegAvailable();
    const tempDir = createTrackedTempDir('sogni-audio-id-');
    const outputPath = join(tempDir, 'voice-identity.m4a');
    try {
      const result = await runCommand(ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', sourcePath,
        '-vn',
        '-ac', '1',
        '-c:a', 'aac',
        '-b:a', '96k',
        outputPath
      ], { captureOutput: true });

      if (result.error || result.status !== 0 || !isNonEmptyFile(outputPath)) {
        const err = new Error('Failed to normalize WAV voice identity audio to M4A.');
        err.code = 'FFMPEG_AUDIO_ID_FAILED';
        err.hint = 'Provide an .m4a/.mp3/.webm voice clip, or install ffmpeg so WAV clips can be converted.';
        err.details = { sourcePath, stderr: result.stderr || '', stdout: result.stdout || '', status: result.status };
        throw err;
      }

      const buffer = readFileSync(outputPath);
      return new Blob([buffer], { type: 'audio/mp4' });
    } finally {
      try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch {}
      try { rmdirSync(tempDir); } catch {}
    }
  }

  return fetchMediaBlob(pathOrUrl, 'audio/mp4');
}

function mediaTempInputPath(tempDir, sourceLabel, fallbackExt) {
  const cleanExt = extname(String(sourceLabel || '').split('?')[0]).toLowerCase();
  const ext = /^[.][a-z0-9]{1,8}$/i.test(cleanExt) ? cleanExt : fallbackExt;
  return join(tempDir, `input${ext}`);
}

async function transcodeMp3ReferenceAudioBuffer(buffer, sourceLabel) {
  const ffmpegPath = await ensureFfmpegAvailable();
  const tempDir = createTrackedTempDir('sogni-ref-audio-');
  const inputPath = mediaTempInputPath(tempDir, sourceLabel, '.mp3');
  const outputPath = join(tempDir, 'reference-audio.m4a');
  try {
    writeFileSync(inputPath, buffer);
    const result = await runCommand(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-vn',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath
    ], { captureOutput: true });

    if (result.error || result.status !== 0 || !isNonEmptyFile(outputPath)) {
      const err = new Error('Failed to prepare MP3 reference audio for video generation.');
      err.code = 'FFMPEG_AUDIO_PREP_FAILED';
      err.hint = 'Install ffmpeg with AAC support, or provide M4A/WAV reference audio.';
      err.details = { sourceLabel, stderr: result.stderr || '', stdout: result.stdout || '', status: result.status };
      throw err;
    }

    return readFileSync(outputPath);
  } finally {
    try { if (existsSync(inputPath)) unlinkSync(inputPath); } catch {}
    try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch {}
    try { rmdirSync(tempDir); } catch {}
  }
}

async function prepareReferenceAudioForVideoBuffer(buffer, sourceLabel) {
  // normalizeReferenceAudioMimeType lets path-derived MIME types (audio/mpeg
  // for .mp3, audio/mp4 for .m4a, etc.) map to the canonical bucket the
  // hosted audio pipeline expects, matching how sogni-chat and sogni-api
  // canonicalize before passing to detectReferenceAudioFormat.
  const rawMimeType = mimeTypeForPath(sourceLabel, 'application/octet-stream');
  const mimeType = normalizeReferenceAudioMimeType(rawMimeType) || rawMimeType;
  const sourceFormat = detectReferenceAudioFormat(buffer, mimeType);
  if (sourceFormat !== 'mp3') return buffer;

  const prepared = await transcodeMp3ReferenceAudioBuffer(buffer, sourceLabel);
  if (!options.quiet) {
    console.error('Prepared MP3 reference audio as M4A for video provider compatibility.');
  }
  return prepared;
}

function mediaFilenameFromSource(sourceLabel, fallbackName) {
  const raw = String(sourceLabel || '');
  try {
    if (isHttpUrl(raw)) {
      const pathname = new URL(raw).pathname;
      const name = basename(decodeURIComponent(pathname));
      return name || fallbackName;
    }
  } catch {
    // Fall through to path handling.
  }
  const name = basename(raw.split('?')[0]);
  return name || fallbackName;
}

function withMediaExtension(filename, extension) {
  const cleanExtension = extension.startsWith('.') ? extension : `.${extension}`;
  const currentExt = extname(filename);
  const base = currentExt ? filename.slice(0, -currentExt.length) : filename;
  return `${base || 'reference'}${cleanExtension}`;
}

async function probeLocalMediaDurationSeconds(pathOrUrl) {
  if (isHttpUrl(pathOrUrl)) return undefined;
  const ffprobePath = getEnv('FFPROBE_PATH') || 'ffprobe';
  sanitizePath(ffprobePath, 'FFPROBE_PATH');
  const result = await runCommand(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    pathOrUrl,
  ], { captureOutput: true });
  if (result.error || result.status !== 0) return undefined;
  const parsed = Number(String(result.stdout || '').trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function transcodeSeedanceReferenceAudioToMp3(request) {
  const ffmpegPath = await ensureFfmpegAvailable();
  const tempDir = createTrackedTempDir('sogni-seedance-audio-');
  const inputPath = mediaTempInputPath(tempDir, request.filename, '.audio');
  const outputPath = join(tempDir, 'reference-audio.mp3');
  try {
    writeFileSync(inputPath, Buffer.from(request.data));
    const result = await runCommand(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-vn',
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      outputPath
    ], { captureOutput: true });

    if (result.error || result.status !== 0 || !isNonEmptyFile(outputPath)) {
      const err = new Error('Failed to convert Seedance reference audio to MP3.');
      err.code = 'FFMPEG_SEEDANCE_AUDIO_PREP_FAILED';
      err.hint = 'Seedance accepts MP3 audio references only. Install ffmpeg with MP3 support or provide an MP3 clip.';
      err.details = { sourceLabel: request.filename, stderr: result.stderr || '', stdout: result.stdout || '', status: result.status };
      throw err;
    }

    return { data: readFileSync(outputPath), mimeType: 'audio/mpeg' };
  } finally {
    try { if (existsSync(inputPath)) unlinkSync(inputPath); } catch {}
    try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch {}
    try { rmdirSync(tempDir); } catch {}
  }
}

async function trimSeedanceReferenceAudioToMp3(request) {
  const ffmpegPath = await ensureFfmpegAvailable();
  const tempDir = createTrackedTempDir('sogni-seedance-audio-');
  const inputPath = mediaTempInputPath(tempDir, request.filename, '.audio');
  const outputPath = join(tempDir, 'reference-audio.mp3');
  const start = Math.max(0, Number(request.start) || 0);
  const duration = Math.max(
    0.1,
    Math.min(15, Number(request.duration) || 15),
  );
  try {
    writeFileSync(inputPath, Buffer.from(request.data));
    const result = await runCommand(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', String(start),
      '-i', inputPath,
      '-t', String(duration),
      '-vn',
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      outputPath
    ], { captureOutput: true });

    if (result.error || result.status !== 0 || !isNonEmptyFile(outputPath)) {
      const err = new Error('Failed to trim Seedance reference audio to MP3.');
      err.code = 'FFMPEG_SEEDANCE_AUDIO_TRIM_FAILED';
      err.hint = 'Seedance accepts MP3 audio references only and short audio windows. Try a shorter MP3 clip.';
      err.details = { sourceLabel: request.filename, start, duration, stderr: result.stderr || '', stdout: result.stdout || '', status: result.status };
      throw err;
    }

    return { data: readFileSync(outputPath), mimeType: 'audio/mpeg' };
  } finally {
    try { if (existsSync(inputPath)) unlinkSync(inputPath); } catch {}
    try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch {}
    try { rmdirSync(tempDir); } catch {}
  }
}

async function trimSeedanceV2VSourceVideo(request) {
  return {
    data: await trimSeedanceV2VSourceVideoBuffer(
      Buffer.from(request.data),
      request.filename,
      request.start,
      request.duration,
    ),
    mimeType: 'video/mp4',
  };
}

function seedanceReferenceAudioWindow() {
  const requestedDuration = options.audioDuration ?? options.duration;
  const maxDurationSeconds = Math.min(
    Number.isFinite(Number(requestedDuration)) && Number(requestedDuration) > 0
      ? Number(requestedDuration)
      : SEEDANCE_R2V_REFERENCE_AUDIO_MAX_DURATION_SECONDS,
    15,
  );
  return {
    maxDurationSeconds,
    startOffsetSeconds: options.audioStart ?? 0,
  };
}

async function prepareSeedanceReferenceAudioUploadFile(pathOrUrl, buffer) {
  const filename = mediaFilenameFromSource(pathOrUrl, 'reference-audio');
  const rawMimeType = mimeTypeForPath(pathOrUrl, 'application/octet-stream');
  const mimeType = normalizeReferenceAudioMimeType(rawMimeType) || rawMimeType;
  const sourceFormat = detectReferenceAudioFormat(buffer, mimeType);
  const sourceDurationSeconds = await probeLocalMediaDurationSeconds(pathOrUrl);
  const window = seedanceReferenceAudioWindow();
  const shouldTrim =
    window.startOffsetSeconds > 0 ||
    (Number.isFinite(sourceDurationSeconds) && sourceDurationSeconds > window.maxDurationSeconds);
  let prepared = { data: buffer, mimeType: 'audio/mpeg' };
  let action = null;
  if (shouldTrim) {
    prepared = await trimSeedanceReferenceAudioToMp3({
      data: buffer,
      filename,
      inputMimeType: mimeType,
      sourceFormat,
      duration: window.maxDurationSeconds,
      start: window.startOffsetSeconds,
    });
    action = 'trimmed and converted';
  } else if (sourceFormat !== 'mp3') {
    prepared = await transcodeSeedanceReferenceAudioToMp3({
      data: buffer,
      filename,
      inputMimeType: mimeType,
      sourceFormat,
    });
    action = 'converted';
  }
  if (!options.quiet && action) {
    console.error(`Prepared Seedance reference audio as ${action} MP3 before upload.`);
  }
  const data = Buffer.from(prepared.data);
  return {
    buffer: data,
    filename: withMediaExtension(filename, 'mp3'),
    byteLength: data.length,
    mimeType: 'audio/mpeg',
  };
}

async function prepareSeedanceReferenceVideoUploadFile(pathOrUrl, buffer) {
  const filename = mediaFilenameFromSource(pathOrUrl, 'reference-video.mp4');
  const rawMimeType = mimeTypeForPath(pathOrUrl, 'video/mp4');
  const sourceDurationSeconds = await probeLocalMediaDurationSeconds(pathOrUrl);
  const requestedDuration = Number.isFinite(Number(options.duration))
    ? Number(options.duration)
    : SEEDANCE_V2V_REFERENCE_MAX_DURATION_SECONDS;
  const prepared = await prepareSharedSeedanceV2VSourceVideo(
    buffer,
    rawMimeType,
    filename,
    sourceDurationSeconds,
    requestedDuration,
    options.videoStart ?? 0,
    { trimVideo: trimSeedanceV2VSourceVideo },
  );
  if (!options.quiet && prepared.trimmed) {
    console.error('Prepared Seedance V2V reference video clip before upload.');
  }
  const data = Buffer.from(prepared.data);
  return {
    buffer: data,
    filename: withMediaExtension(filename, 'mp4'),
    byteLength: data.length,
    mimeType: prepared.mimeType || 'video/mp4',
  };
}

async function uploadSeedanceReferenceAudioUrl(pathOrUrl, apiKey, index = 0) {
  const ref = { flag: '--ref-audio', value: pathOrUrl, kind: 'audio' };
  const buffer = await fetchMediaBuffer(pathOrUrl);
  const file = await prepareSeedanceReferenceAudioUploadFile(pathOrUrl, buffer);
  const uploaded = await uploadPreparedApiMediaReferenceV2(ref, index, apiKey, file);
  return uploaded.url;
}

async function uploadSeedanceReferenceVideoUrl(pathOrUrl, apiKey, index = 0) {
  const ref = { flag: '--ref-video', value: pathOrUrl, kind: 'video' };
  const buffer = await fetchMediaBuffer(pathOrUrl);
  const file = await prepareSeedanceReferenceVideoUploadFile(pathOrUrl, buffer);
  const uploaded = await uploadPreparedApiMediaReferenceV2(ref, index, apiKey, file);
  return uploaded.url;
}

async function trimSeedanceV2VSourceVideoBuffer(buffer, sourceLabel, startOffset, requestedDuration) {
  const ffmpegPath = await ensureFfmpegAvailable();
  const tempDir = createTrackedTempDir('sogni-seedance-v2v-');
  const inputPath = mediaTempInputPath(tempDir, sourceLabel, '.mp4');
  const outputPath = join(tempDir, 'seedance-source.mp4');
  const start = Math.max(0, Number(startOffset) || 0);
  const duration = Math.max(
    0.1,
    Math.min(SEEDANCE_V2V_REFERENCE_MAX_DURATION_SECONDS, Number(requestedDuration) || SEEDANCE_V2V_REFERENCE_MAX_DURATION_SECONDS),
  );
  try {
    writeFileSync(inputPath, buffer);
    const result = await runCommand(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', String(start),
      '-i', inputPath,
      '-t', String(duration),
      '-map', '0:v:0',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath
    ], { captureOutput: true });

    if (result.error || result.status !== 0 || !isNonEmptyFile(outputPath)) {
      const err = new Error('Failed to prepare Seedance video-to-video reference clip.');
      err.code = 'FFMPEG_SEEDANCE_V2V_PREP_FAILED';
      err.hint = 'Install ffmpeg with libx264 support, or provide a reference clip that starts at the desired frame.';
      err.details = { sourceLabel, start, duration, stderr: result.stderr || '', stdout: result.stdout || '', status: result.status };
      throw err;
    }

    return readFileSync(outputPath);
  } finally {
    try { if (existsSync(inputPath)) unlinkSync(inputPath); } catch {}
    try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch {}
    try { rmdirSync(tempDir); } catch {}
  }
}

async function appendSafeSeedanceReferenceUrl(target, pathOrUrl, label) {
  if (!isHttpsUrl(pathOrUrl)) return false;
  try {
    await assertSafeUrl(pathOrUrl, { allowedProtocols: ['https:'] });
  } catch (error) {
    const err = new Error(`${label} URL is not safe to forward: ${error?.message || String(error)}`);
    err.code = 'INVALID_URL';
    err.details = { url: pathOrUrl, label };
    throw err;
  }
  target.push(pathOrUrl);
  return true;
}

// Effective Seedance reference counts for the current `options` snapshot.
// Mirrors the per-modality bookkeeping sogni-chat does in
// uploadedModalityReferenceIndices(...) (chatService.ts ~6149), translated to
// the skill's primary + extras CLI shape:
//   images = refImage + refImageEnd + contextImages (loose Seedance @ImageN refs)
//   audios = refAudio + refAudios (extras)
//   videos = refVideo + refVideos (extras)
function effectiveSeedanceReferenceCounts() {
  const images =
    (options.refImage ? 1 : 0)
    + (options.refImageEnd ? 1 : 0)
    + (Array.isArray(options.contextImages) ? options.contextImages.length : 0);
  const audios =
    (options.refAudio ? 1 : 0)
    + (Array.isArray(options.refAudios) ? options.refAudios.length : 0);
  const videos =
    (options.refVideo ? 1 : 0)
    + (Array.isArray(options.refVideos) ? options.refVideos.length : 0);
  return { images, audios, videos };
}

// Wraps the shared validateSeedanceReferenceCounts() so a thrown
// SeedanceReferenceLimitError is re-raised as a CLI fatal error with the same
// human message the hosted chat surfaces. Source of truth for the numeric caps
// (9 / 3 / 3 / 12) is @sogni-ai/sogni-protocol's seedance-reference-limits
// catalog, surfaced through @sogni-ai/sogni-intelligence-client/tools.
function enforceSeedanceReferenceCaps() {
  try {
    validateSeedanceReferenceCounts(effectiveSeedanceReferenceCounts());
  } catch (err) {
    if (err instanceof SeedanceReferenceLimitError) {
      fatalCliError(err.message, {
        code: err.code,
        details: {
          limitKind: err.limitKind,
          requestedCount: err.requestedCount,
          maxCount: err.maxCount,
          limits: SEEDANCE_REFERENCE_LIMITS,
        },
      });
    }
    throw err;
  }
}

function resolveMultiAngleOutputConfig(outputPath, outputFormat) {
  if (!outputPath) return null;
  const ext = extname(outputPath);
  const desiredExt = (outputFormat || 'jpg').replace('.', '');
  if (!ext) {
    return { dir: outputPath, prefix: '', ext: desiredExt };
  }
  const dir = dirname(outputPath);
  const prefix = basename(outputPath, ext);
  return { dir, prefix, ext: ext.replace('.', '') || desiredExt };
}

// Write a generated result to disk, mapping common filesystem errors into
// clear, coded messages. Losing a paid-for render to a raw "EACCES" is exactly
// the kind of cryptic failure a first-time user can't recover from.
function writeOutputFileSafe(filePath, buffer, label = 'output') {
  try {
    const dir = dirname(filePath);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, buffer);
  } catch (e) {
    const code = e?.code;
    const err = new Error(`Could not write ${label} to ${filePath}.`);
    err.code = 'OUTPUT_WRITE_FAILED';
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      err.hint = 'The output path is not writable. Choose a different --output location or fix the directory permissions.';
    } else if (code === 'ENOSPC') {
      err.hint = 'No space left on the device. Free up disk space or choose another --output location.';
    } else if (code === 'ENOENT') {
      err.hint = 'The output directory does not exist and could not be created. Check the --output path.';
    } else if (code === 'EISDIR') {
      err.hint = '--output points to a directory; pass a file path instead.';
    } else {
      err.hint = 'Check the --output path and permissions.';
    }
    err.details = { filePath, cause: code || String(e) };
    throw err;
  }
}

async function downloadUrlToFile(url, filePath) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeOutputFileSafe(filePath, buffer);
}

function removeClientListener(client, event, handler) {
  if (typeof client.off === 'function') {
    client.off(event, handler);
  } else {
    client.removeListener(event, handler);
  }
}

let execaPromise = null;
async function loadExeca() {
  if (!execaPromise) {
    execaPromise = import('execa');
  }
  return execaPromise;
}

async function ensureFfmpegAvailable(operation = 'this audio/video operation') {
  const ffmpegPath = getEnv('FFMPEG_PATH') || 'ffmpeg';
  sanitizePath(ffmpegPath, 'FFMPEG_PATH');
  const result = await runCommand(ffmpegPath, ['-version'], { captureOutput: true });
  if (result.error || result.status !== 0) {
    const err = new Error(`ffmpeg is required for ${operation}.`);
    err.code = 'MISSING_FFMPEG';
    err.hint = 'Install ffmpeg (e.g. `brew install ffmpeg` / `apt install ffmpeg`) or set FFMPEG_PATH to a working ffmpeg binary.';
    err.details = { ffmpegPath };
    throw err;
  }
  // Verify the binary actually is ffmpeg (not an arbitrary executable)
  const stdout = result.stdout || '';
  if (!stdout.toLowerCase().includes('ffmpeg')) {
    const err = new Error('FFMPEG_PATH does not point to an ffmpeg binary.');
    err.code = 'INVALID_FFMPEG';
    err.hint = 'Ensure FFMPEG_PATH points to a real ffmpeg installation.';
    err.details = { ffmpegPath };
    throw err;
  }
  return ffmpegPath;
}

// ffmpeg's concat demuxer resolves relative `file` entries against the list
// file's own directory, so always write absolute paths to avoid path doubling
// (e.g. ./dir/out.concat.txt referencing ./dir/clip.mp4 -> ./dir/./dir/clip.mp4).
function escapeConcatPath(p) {
  return resolve(p).replace(/'/g, "'\\''");
}

function writeConcatList(filePath, frames, frameDuration) {
  const lines = [];
  frames.forEach((frame) => {
    lines.push(`file '${escapeConcatPath(frame)}'`);
    lines.push(`duration ${frameDuration}`);
  });
  if (frames.length > 0) {
    const last = frames[frames.length - 1];
    lines.push(`file '${escapeConcatPath(last)}'`);
  }
  writeFileSync(filePath, lines.join('\n'));
}

function isNonEmptyFile(filePath) {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function runCommand(command, args, { captureOutput = false } = {}) {
  const options = { reject: false };
  if (captureOutput) {
    options.stdout = 'pipe';
    options.stderr = 'pipe';
  } else {
    options.stdout = 'inherit';
    options.stderr = 'inherit';
  }

  try {
    const { execa } = await loadExeca();
    const result = await execa(command, args, options);
    return {
      status: result.exitCode,
      error: null,
      stdout: result.stdout || '',
      stderr: result.stderr || ''
    };
  } catch (error) {
    return {
      status: Number.isInteger(error?.exitCode) ? error.exitCode : null,
      error,
      stdout: error?.stdout || '',
      stderr: error?.stderr || ''
    };
  }
}

async function buildAngles360Video(outputPath, frames, fps) {
  sanitizePath(outputPath, '--angles-360-video output path');
  frames.forEach((f, i) => sanitizePath(f, `frame[${i}]`));
  const ffmpegPath = await ensureFfmpegAvailable();
  const tempListPath = outputPath.replace(/\.mp4$/i, '') + '.concat.txt';
  const frameDuration = 1 / fps;
  writeConcatList(tempListPath, frames, frameDuration);

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', tempListPath,
    '-r', String(fps),
    '-pix_fmt', 'yuv420p',
    outputPath
  ];
  const result = await runCommand(ffmpegPath, args);
  if (result.error || result.status !== 0) {
    // ffmpeg sometimes exits non-zero even when the output file is usable.
    // Treat it as success if the output exists and is non-empty.
    if (isNonEmptyFile(outputPath)) {
      console.warn('Warning: ffmpeg exited non-zero, but output video exists and is non-empty. Continuing.');
      return;
    }
    const err = new Error('ffmpeg failed to build 360 video.');
    err.code = 'FFMPEG_FAILED';
    err.details = { outputPath };
    throw err;
  }
}

async function runFrameExtraction(args, { videoPath, outputImagePath, which }) {
  const ffmpegPath = await ensureFfmpegAvailable();
  const result = await runCommand(ffmpegPath, args, { captureOutput: true });

  if (result.error || result.status !== 0 || !isNonEmptyFile(outputImagePath)) {
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    console.error('FFmpeg extraction failed:');
    console.error('  Video path:', videoPath);
    console.error('  Output path:', outputImagePath);
    console.error('  Exit code:', result.status);
    console.error('  Error:', result.error?.message || 'none');
    if (stderr) console.error('  Stderr:', stderr);
    if (stdout) console.error('  Stdout:', stdout);
    console.error('  Output file exists:', existsSync(outputImagePath));
    if (existsSync(outputImagePath)) {
      console.error('  Output file size:', statSync(outputImagePath).size);
    }

    const err = new Error(`Failed to extract ${which} frame from video.`);
    err.code = 'FFMPEG_EXTRACT_FAILED';
    err.details = { videoPath, outputImagePath, stderr, stdout, status: result.status };
    throw err;
  }
}

async function extractLastFrameFromVideo(videoPath, outputImagePath) {
  sanitizePath(videoPath, 'video path');
  sanitizePath(outputImagePath, 'output image path');

  // Seek to ~1s before the end so we only decode the tail of the video
  // (vastly faster than decoding every frame), then keep updating the same
  // output so the final write is the genuine last frame.
  const args = [
    '-sseof', '-1',
    '-i', videoPath,
    '-update', '1',  // Keep overwriting -> output is the last decoded frame
    '-q:v', '1',  // Best quality
    '-y',
    outputImagePath
  ];

  await runFrameExtraction(args, { videoPath, outputImagePath, which: 'last' });
}

async function extractFirstFrameFromVideo(videoPath, outputImagePath) {
  sanitizePath(videoPath, 'video path');
  sanitizePath(outputImagePath, 'output image path');

  // First decoded frame only.
  const args = [
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '1',  // Best quality
    '-y',
    outputImagePath
  ];

  await runFrameExtraction(args, { videoPath, outputImagePath, which: 'first' });
}

function parseFrameRate(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  if (!raw.includes('/')) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const [num, den] = raw.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const v = num / den;
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Probe a media file's primary video stream + whether it has any audio.
// Returns { width, height, fps, duration, hasAudio }. Fields are null when the
// probe fails (e.g. ffprobe missing); callers fall back to safe defaults.
async function probeVideoStreamInfo(filePath) {
  const info = { width: null, height: null, fps: null, duration: null, hasAudio: false };
  const ffprobePath = getEnv('FFPROBE_PATH') || 'ffprobe';
  sanitizePath(ffprobePath, 'FFPROBE_PATH');
  const result = await runCommand(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,r_frame_rate',
    '-show_entries', 'format=duration',
    '-of', 'json',
    filePath,
  ], { captureOutput: true });
  if (result.error || result.status !== 0) return info;
  let parsed;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch { return info; }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((s) => s.codec_type === 'video');
  info.hasAudio = streams.some((s) => s.codec_type === 'audio');
  if (video) {
    info.width = Number(video.width) || null;
    info.height = Number(video.height) || null;
    info.fps = parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate) || null;
  }
  const dur = Number(parsed?.format?.duration);
  info.duration = Number.isFinite(dur) && dur > 0 ? dur : null;
  return info;
}

// Concatenate clips using the concat *filter* (not the concat demuxer). The
// demuxer corrupts timestamps when clips differ in fps/timebase and desyncs
// audio when a clip has no audio track. Here we probe each clip, normalize every
// video stream to a common fps/size/sar/pixel-format, and synthesize silent
// audio for clips that have none, so heterogeneous clips stitch cleanly.
async function buildConcatVideoFromClips(outputPath, clips, { audioPath = null, audioStart = null, targetFps = null } = {}) {
  sanitizePath(outputPath, '--output path');
  clips.forEach((c, i) => sanitizePath(c, `clip[${i}]`));
  if (audioPath) sanitizePath(audioPath, '--concat-audio');
  const ffmpegPath = await ensureFfmpegAvailable();

  const infos = [];
  for (const clip of clips) {
    infos.push(await probeVideoStreamInfo(clip));
  }
  const widths = infos.map((x) => x.width).filter(Boolean);
  const heights = infos.map((x) => x.height).filter(Boolean);
  const fpsList = infos.map((x) => x.fps).filter(Boolean);
  const targetW = widths.length ? widths[0] : 1280;
  const targetH = heights.length ? heights[0] : 720;
  let fps = Number.isFinite(targetFps) && targetFps > 0
    ? targetFps
    : (fpsList.length ? Math.max(...fpsList) : 24);
  fps = Math.max(1, Math.round(fps));
  const totalDuration = infos.reduce((sum, x) => sum + (x.duration || 0), 0);

  const filterParts = [];
  const concatInputs = [];
  infos.forEach((info, idx) => {
    filterParts.push(
      `[${idx}:v]fps=${fps},scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,` +
      `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${idx}]`
    );
    if (info.hasAudio) {
      filterParts.push(`[${idx}:a]aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[a${idx}]`);
    } else {
      const dur = info.duration && info.duration > 0 ? info.duration : (1 / fps);
      filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${dur.toFixed(6)},asetpts=PTS-STARTPTS[a${idx}]`);
    }
    concatInputs.push(`[v${idx}][a${idx}]`);
  });
  filterParts.push(`${concatInputs.join('')}concat=n=${infos.length}:v=1:a=1[cv][ca]`);

  const args = ['-y'];
  clips.forEach((clip) => { args.push('-i', clip); });

  let mapAudio = '[ca]';
  if (audioPath) {
    // External soundtrack replaces the stitched audio. Pad/trim it to the video
    // length so we never silently truncate the video (the old -shortest footgun).
    if (Number.isFinite(audioStart) && audioStart > 0) {
      args.push('-ss', String(audioStart));
    }
    args.push('-i', audioPath);
    const extIdx = clips.length;
    let extChain = `[${extIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,apad`;
    if (totalDuration > 0) {
      extChain += `,atrim=duration=${totalDuration.toFixed(6)},asetpts=PTS-STARTPTS`;
    }
    extChain += '[xa]';
    filterParts.push(extChain);
    mapAudio = '[xa]';
  }

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', '[cv]', '-map', mapAudio);
  args.push(
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath
  );

  const result = await runCommand(ffmpegPath, args);
  if (result.error || result.status !== 0) {
    if (isNonEmptyFile(outputPath)) {
      console.warn('Warning: ffmpeg exited non-zero, but output video exists and is non-empty. Continuing.');
      return;
    }
    const err = new Error('ffmpeg failed to concatenate video clips.');
    err.code = 'FFMPEG_FAILED';
    err.details = { outputPath, clips: clips?.length ?? null };
    throw err;
  }
}

// Rebuild a video's audio track without re-encoding the video stream. Supports
// an optional looping bed (the input's own audio by default, or --bed-audio),
// fade in/out, and overlaying one extra track at an offset/gain. The video is
// stream-copied, so this is cheap and lossless on the picture.
async function remixVideoAudio(inputVideo, outputVideo, opts = {}) {
  const {
    bedAudio = null, loop = false, fadeIn = null, fadeOut = null,
    mixAudio = null, mixAt = null, mixGain = null,
  } = opts;
  sanitizePath(inputVideo, '--remix-audio input');
  sanitizePath(outputVideo, '--remix-audio output');
  if (bedAudio) sanitizePath(bedAudio, '--bed-audio');
  if (mixAudio) sanitizePath(mixAudio, '--mix-audio');
  const ffmpegPath = await ensureFfmpegAvailable();

  const info = await probeVideoStreamInfo(inputVideo);
  const totalDuration = info.duration && info.duration > 0 ? info.duration : null;

  const args = ['-y', '-i', inputVideo];

  // Resolve the bed source. With --audio-loop we re-open the source as a
  // -stream_loop input (the only robust, duration-based loop in ffmpeg).
  let bedRef;
  let nextIndex = 1;
  const bedSourceFile = bedAudio || inputVideo;
  if (loop) {
    args.push('-stream_loop', '-1', '-i', bedSourceFile);
    bedRef = `[${nextIndex}:a]`;
    nextIndex += 1;
  } else if (bedAudio) {
    args.push('-i', bedAudio);
    bedRef = `[${nextIndex}:a]`;
    nextIndex += 1;
  } else {
    bedRef = '[0:a]';
  }

  let mixIndex = null;
  if (mixAudio) {
    mixIndex = nextIndex;
    args.push('-i', mixAudio);
    nextIndex += 1;
  }

  const filterParts = [];
  let bed = `${bedRef}aformat=sample_rates=44100:channel_layouts=stereo`;
  if (loop && totalDuration) {
    bed += `,atrim=duration=${totalDuration.toFixed(6)},asetpts=PTS-STARTPTS`;
  }
  if (Number.isFinite(fadeIn) && fadeIn > 0) {
    bed += `,afade=t=in:st=0:d=${fadeIn}`;
  }
  if (Number.isFinite(fadeOut) && fadeOut > 0 && totalDuration) {
    const st = Math.max(0, totalDuration - fadeOut);
    bed += `,afade=t=out:st=${st.toFixed(6)}:d=${fadeOut}`;
  }
  bed += '[bed]';
  filterParts.push(bed);

  let finalAudio = '[bed]';
  if (mixAudio) {
    let mix = `[${mixIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo`;
    if (Number.isFinite(mixGain) && mixGain !== 0) {
      mix += `,volume=${mixGain}dB`;
    }
    const delayMs = Number.isFinite(mixAt) && mixAt > 0 ? Math.round(mixAt * 1000) : 0;
    if (delayMs > 0) {
      mix += `,adelay=${delayMs}|${delayMs}`;
    }
    mix += '[mix]';
    filterParts.push(mix);
    // normalize=0 keeps both tracks at full level; alimiter guards against clipping.
    filterParts.push('[bed][mix]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[outa]');
    finalAudio = '[outa]';
  }

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', '0:v:0', '-map', finalAudio);
  args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
  if (totalDuration) args.push('-t', totalDuration.toFixed(6));
  args.push(outputVideo);

  const result = await runCommand(ffmpegPath, args);
  if (result.error || result.status !== 0) {
    if (isNonEmptyFile(outputVideo)) {
      console.warn('Warning: ffmpeg exited non-zero, but output video exists and is non-empty. Continuing.');
      return;
    }
    const err = new Error('ffmpeg failed to remix audio.');
    err.code = 'FFMPEG_FAILED';
    err.details = { inputVideo, outputVideo };
    throw err;
  }
}

async function runImageEditProjectWithEvents(client, editConfig, expectedCount, log, timeoutMs, label) {
  const results = [];
  let completed = 0;
  let projectId = null;

  let resolvePromise;
  let rejectPromise;
  const completionPromise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const onCompleted = (data) => {
    if (projectId && data.projectId !== projectId) return;
    if (!projectId) projectId = data.projectId;
    const jobData = data.job?.data || {};
    results.push({
      resultUrl: data.resultUrl || data.imageUrl,
      seed: jobData.seed,
      jobIndex: data.jobIndex,
      projectId: data.projectId
    });
    completed++;
    log(`Image ${completed}/${expectedCount}${label ? ` (${label})` : ''} completed`);
    if (completed >= expectedCount) {
      cleanup();
      resolvePromise({ results, projectId });
    }
  };

  const onFailed = (data) => {
    if (projectId && data.projectId !== projectId) return;
    if (!projectId) projectId = data.projectId;
    cleanup();
    rejectPromise(new Error(data.error || 'Job failed'));
  };

  const cleanup = () => {
    clearTimeout(timeout);
    removeClientListener(client, ClientEvent.JOB_COMPLETED, onCompleted);
    removeClientListener(client, ClientEvent.JOB_FAILED, onFailed);
  };

  const timeout = setTimeout(() => {
    cleanup();
    rejectPromise(new Error(`Timeout after ${timeoutMs / 1000}s`));
  }, timeoutMs);

  client.on(ClientEvent.JOB_COMPLETED, onCompleted);
  client.on(ClientEvent.JOB_FAILED, onFailed);

  try {
    const projectResult = await client.createImageEditProject(editConfig);
    projectId = projectResult?.project?.id || projectId;

    // Check for errors in the response (e.g., insufficient tokens)
    if (projectResult?.error || projectResult?.message) {
      cleanup();
      throw buildProjectResultError(projectResult);
    }
    if (!projectId) {
      cleanup();
      throw new Error('Failed to create project: no project ID returned');
    }
  } catch (error) {
    cleanup();
    throw error;
  }

  return completionPromise;
}

async function runMultiAngleFlow(client, log) {
  const contextBuffer = await fetchMediaBuffer(options.contextImages[0]);
  const azimuths = options.angles360
    ? MULTI_ANGLE_AZIMUTHS.map((a) => a.key)
    : [options.azimuth];
  const modelDefaults = getModelDefaults(options.model, openclawConfig);
  const steps = options.steps ?? modelDefaults?.steps ?? (options.model.includes('lightning') ? 4 : 20);
  const guidance = options.guidance ?? modelDefaults?.guidance ?? (options.model.includes('lightning') ? 1.0 : 4.0);

  let outputConfig = resolveMultiAngleOutputConfig(options.output, options.outputFormat);
  let tempOutputDir = null;
  if (options.output && !outputConfig && !options.quiet) {
    console.error('Warning: Could not resolve output path for multi-angle output.');
  }
  if (options.angles360Video && !outputConfig) {
    tempOutputDir = createTrackedTempDir('sogni-angles-');
    outputConfig = {
      dir: tempOutputDir,
      prefix: 'angles-360',
      ext: (options.outputFormat || 'jpg').replace('.', '')
    };
  }
  let videoOutputPath = null;
  if (options.angles360Video) {
    if (typeof options.angles360Video === 'string') {
      videoOutputPath = options.angles360Video;
    } else if (options.output && outputConfig && outputConfig.ext === 'mp4') {
      videoOutputPath = options.output;
    } else if (outputConfig) {
      const baseName = outputConfig.prefix ? outputConfig.prefix : 'angles-360';
      videoOutputPath = join(outputConfig.dir, `${baseName}.mp4`);
    } else {
      videoOutputPath = join(process.cwd(), 'angles-360.mp4');
    }
    if (!videoOutputPath.toLowerCase().endsWith('.mp4')) {
      videoOutputPath += '.mp4';
    }
  }
  if (outputConfig) {
    if (outputConfig.ext === 'mp4') {
      outputConfig.ext = (options.outputFormat || 'jpg').replace('.', '');
    }
    if (!existsSync(outputConfig.dir)) {
      mkdirSync(outputConfig.dir, { recursive: true });
    }
  }

  const angleResults = [];
  const videoFrames = [];
  for (const azimuth of azimuths) {
    const prompt = buildMultiAnglePrompt({
      azimuth,
      elevation: options.elevation,
      distance: options.distance,
      description: options.angleDescription
    });
    const editConfig = {
      modelId: options.model,
      positivePrompt: prompt,
      contextImages: [contextBuffer],
      numberOfMedia: options.count,
      width: options.width,
      height: options.height,
      steps,
      guidance,
      tokenType: options.tokenType || 'spark',
      waitForCompletion: false,
      disableNSFWFilter: options.noFilter === true
    };
    if (options.outputFormat) {
      editConfig.outputFormat = options.outputFormat;
    }
    if (options.sampler) {
      editConfig.sampler = options.sampler;
    }
    if (options.scheduler) {
      editConfig.scheduler = options.scheduler;
    }
    if (options.loras.length > 0) {
      editConfig.loras = options.loras;
    }
    if (options.loraStrengths.length > 0) {
      editConfig.loraStrengths = options.loraStrengths;
    }
    if (options.seed !== null && options.seed !== undefined) {
      editConfig.seed = options.seed;
    }

    const { results } = await runImageEditProjectWithEvents(
      client,
      editConfig,
      options.count,
      log,
      options.timeout,
      azimuth
    );
    const urls = results.map((r) => r.resultUrl).filter(Boolean);
    const seeds = results.map((r) => r.seed ?? options.seed);

    if (outputConfig) {
      const safeAzimuth = azimuth.replace(/[^a-z0-9-]/gi, '-');
      for (let i = 0; i < urls.length; i++) {
        const suffix = urls.length > 1 ? `-${i + 1}` : '';
        const prefix = outputConfig.prefix ? `${outputConfig.prefix}-` : '';
        const filename = `${prefix}${safeAzimuth}${suffix}.${outputConfig.ext}`;
        const filePath = join(outputConfig.dir, filename);
        await downloadUrlToFile(urls[i], filePath);
        if (options.angles360Video && i === 0) {
          videoFrames.push(filePath);
        }
      }
    }

    angleResults.push({
      azimuth,
      elevation: options.elevation,
      distance: options.distance,
      prompt,
      urls,
      seeds
    });
  }

  const renderInfo = {
    timestamp: new Date().toISOString(),
    type: options.angles360 ? 'multi-angle-360' : 'multi-angle',
    model: options.model,
    width: options.width,
    height: options.height,
    count: options.count,
    tokenType: options.tokenType || 'spark',
    seed: options.seed,
    seedStrategy: options.seedStrategy || null,
    outputFormat: options.outputFormat || null,
    sampler: options.sampler || null,
    scheduler: options.scheduler || null,
    loras: options.loras.length > 0 ? options.loras : null,
    loraStrengths: options.loraStrengths.length > 0 ? options.loraStrengths : null,
    angles: angleResults,
    localPath: options.output || null
  };

  let videoModelId = null;
  if (videoOutputPath) {
    if (videoFrames.length === 0) {
      const err = new Error('No local frames available to assemble 360 video.');
      err.code = 'MISSING_FRAMES';
      err.hint = 'Ensure the frames were downloaded locally (provide --output dir or check permissions).';
      throw err;
    }
    const clipDir = createTrackedTempDir('sogni-angles-clips-');
    videoModelId = resolveVideoModelAlias(options.videoModel || openclawConfig?.videoModels?.i2v || VIDEO_WORKFLOW_DEFAULT_MODELS.i2v, 'i2v');
    const videoDefaults = getModelDefaults(videoModelId, openclawConfig);
    const videoDimensionRules = videoDimensionRulesFromDefaults(videoDefaults, videoModelId);
    const videoSteps = options.steps ?? videoDefaults?.steps;
    const videoGuidance = options.guidance ?? videoDefaults?.guidance;
    const segmentCount = videoFrames.length;
    let segmentDuration = options.duration;
    let segmentFrames = null;
    if (options.frames) {
      segmentFrames = Math.max(17, Math.round(options.frames / segmentCount));
    } else {
      segmentDuration = Math.max(1, Math.round(options.duration / segmentCount));
    }
    const videoPrompt = options.angleDescription || options.prompt || 'smooth camera rotation';
    const clipPaths = [];

    for (let i = 0; i < videoFrames.length; i++) {
      const startPath = videoFrames[i];
      const endPath = videoFrames[(i + 1) % videoFrames.length];

      // Validate i2v reference resizing constraints for this clip
      let startBuffer = readFileSync(startPath);
      let endBuffer = readFileSync(endPath);
      const startDims = getImageDimensionsFromBuffer(startBuffer);
      let clipWidth = options.width;
      let clipHeight = options.height;
      let needsResize = false;

      if (startDims?.width && startDims?.height) {
        const predicted = predictSharpInsideResizeDims(startDims.width, startDims.height, clipWidth, clipHeight);
        if (predicted && (predicted.width % videoDimensionRules.dimensionMultiple !== 0 || predicted.height % videoDimensionRules.dimensionMultiple !== 0)) {
          // The resized reference will miss the model divisor, so adjust.
          const candidate = pickCompatibleI2vBoundingBox(startDims.width, startDims.height, clipWidth, clipHeight, { rules: videoDimensionRules });
          if (!candidate) {
            // No perfect match - will pre-resize the reference frames
            needsResize = true;
            if (i === 0 && !options.quiet) {
              console.error(
                `360 video reference frames will be pre-resized to model-compatible dimensions ` +
                `because no compatible bounding box exists.`
              );
            }
          } else {
            // Auto-adjust to compatible size
            if (!cliSet.width && !cliSet.height && !options.strictSize) {
              clipWidth = candidate.width;
              clipHeight = candidate.height;
              if (i === 0 && !options.quiet) {
                console.error(
                  `Auto-adjusted 360 video clip size from ${options.width}x${options.height} ` +
                  `to ${clipWidth}x${clipHeight} so resized reference is divisible by ${videoDimensionRules.dimensionMultiple} ` +
                  `(would have been ${predicted.width}x${predicted.height}).`
                );
              }
            } else if (options.strictSize) {
              fatalCliError(
                `Reference frame ${startDims.width}x${startDims.height} would resize to ${predicted.width}x${predicted.height}, ` +
                `but both dimensions must be divisible by ${videoDimensionRules.dimensionMultiple}.`,
                {
                  code: 'INVALID_VIDEO_SIZE',
                  details: {
                    clipIndex: i + 1,
                    reference: { width: startDims.width, height: startDims.height },
                    requested: { width: clipWidth, height: clipHeight },
                    resized: predicted
                  },
                  hint: `Try: --width ${candidate.width} --height ${candidate.height} (or omit --strict-size)`
                }
              );
            } else {
              // User specified explicit dimensions but not --strict-size, auto-adjust anyway
              clipWidth = candidate.width;
              clipHeight = candidate.height;
              if (i === 0 && !options.quiet) {
                console.error(
                  `Warning: Adjusted 360 video clip size from ${options.width}x${options.height} ` +
                  `to ${clipWidth}x${clipHeight} because resized reference would be ${predicted.width}x${predicted.height} ` +
                  `(not divisible by ${videoDimensionRules.dimensionMultiple}). Use --strict-size to fail instead.`
                );
              }
            }
          }
        }
      }

      // Pre-resize reference frames if needed
      if (needsResize && startDims?.width && startDims?.height) {
        startBuffer = await resizeImageBufferForVideo(startBuffer, startDims.width, startDims.height, videoDimensionRules);
        const endDims = getImageDimensionsFromBuffer(endBuffer);
        if (endDims?.width && endDims?.height) {
          endBuffer = await resizeImageBufferForVideo(endBuffer, endDims.width, endDims.height, videoDimensionRules);
        }
        const resizedDims = getImageDimensionsFromBuffer(startBuffer);
        if (i === 0 && !options.quiet) {
          console.error(
            `Pre-resized 360 video frames from ${startDims.width}x${startDims.height} to ${resizedDims.width}x${resizedDims.height} ` +
            `(divisible by ${videoDimensionRules.dimensionMultiple}) to ensure i2v compatibility.`
          );
        }
      }

      const clipConfig = {
        modelId: videoModelId,
        positivePrompt: videoPrompt,
        negativePrompt: '',
        stylePrompt: '',
        numberOfMedia: 1,
        referenceImage: startBuffer,
        referenceImageEnd: endBuffer,
        fps: options.fps,
        width: clipWidth,
        height: clipHeight,
        tokenType: options.tokenType || 'spark',
        waitForCompletion: true,
        disableNSFWFilter: options.noFilter === true
      };
      if (segmentFrames) {
        clipConfig.frames = segmentFrames;
      } else {
        clipConfig.duration = segmentDuration;
      }
      if (videoSteps) {
        clipConfig.steps = videoSteps;
      }
      if (videoGuidance !== null && videoGuidance !== undefined) {
        clipConfig.guidance = videoGuidance;
      }
      if (options.autoResizeVideoAssets !== null) {
        clipConfig.autoResizeVideoAssets = options.autoResizeVideoAssets;
      }
      const clipResult = await client.createVideoProject(clipConfig);

      // Check for errors in the response (e.g., insufficient tokens)
      if (clipResult?.error || clipResult?.message) {
        throw buildProjectResultError(clipResult);
      }

      const clipUrl = clipResult?.videoUrls?.[0];
      if (!clipUrl) {
        throw new Error('No video URL returned for 360 segment.');
      }
      const clipPath = join(clipDir, `segment-${i + 1}.mp4`);
      await downloadUrlToFile(clipUrl, clipPath);
      clipPaths.push(clipPath);
    }

    await buildConcatVideoFromClips(videoOutputPath, clipPaths);
    if (!options.quiet) {
      console.error(`Saved 360 video: ${videoOutputPath}`);
    }
  }
  if (videoOutputPath) {
    renderInfo.videoPath = videoOutputPath;
    renderInfo.videoModel = videoModelId;
  }
  saveLastRender(renderInfo);

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      type: renderInfo.type,
      model: renderInfo.model,
      width: renderInfo.width,
      height: renderInfo.height,
      count: renderInfo.count,
      tokenType: renderInfo.tokenType,
      seed: renderInfo.seed,
      seedStrategy: renderInfo.seedStrategy,
      outputFormat: renderInfo.outputFormat,
      sampler: renderInfo.sampler,
      scheduler: renderInfo.scheduler,
      loras: renderInfo.loras,
      loraStrengths: renderInfo.loraStrengths,
      videoPath: renderInfo.videoPath || null,
      videoModel: renderInfo.videoModel || null,
      angles: angleResults
    }));
  } else {
    if (videoOutputPath) {
      console.log(`video: ${videoOutputPath}`);
    }
    angleResults.forEach((angle) => {
      angle.urls.forEach((url, index) => {
        const suffix = angle.urls.length > 1 ? `#${index + 1}` : '';
        console.log(`${angle.azimuth}${suffix}: ${url}`);
      });
    });
  }
}

function buildVideoEstimateParams({ tokenType, steps }) {
  const isSeedanceVideo = isSeedanceModel(options.model);
  const params = {
    modelId: options.model,
    width: options.width,
    height: options.height,
    fps: options.fps,
    numberOfMedia: options.count,
    tokenType,
    ...(Number.isFinite(steps) && steps > 0 ? { steps } : {}),
    ...(options.frames ? { frames: options.frames } : { duration: options.duration })
  };

  if (isSeedanceVideo && options.refVideo) {
    params.hasVideoInput = true;
    if (isHttpsUrl(options.refVideo)) {
      params.referenceVideoUrls = [options.refVideo];
    } else {
      params.referenceVideo = true;
    }
  }

  return params;
}

async function ensureSufficientVideoBalance(client, log) {
  if (!options.video || options.estimateVideoCost) return;
  const tokenType = options.tokenType || 'spark';
  const tokenLabel = tokenType.toUpperCase();
  let balance;
  try {
    balance = await client.getBalance();
  } catch (err) {
    if (!options.quiet) {
      log(`Warning: Could not fetch balance (${err?.message || 'error'})`);
    }
    return;
  }
  const available = tokenType === 'sogni' ? balance.sogni : balance.spark;
  if (!Number.isFinite(available)) return;
  if (available <= 0) {
    throw buildBalanceError(
      `Insufficient ${tokenLabel} balance (have ${formatTokenValue(available)}).`,
      { tokenType, available }
    );
  }

  const modelDefaults = getModelDefaults(options.model, openclawConfig);
  const steps = resolveVideoSteps(options.model, modelDefaults, options.steps);
  const isSeedanceVideo = isSeedanceModel(options.model);
  if (!isSeedanceVideo && (!Number.isFinite(steps) || steps <= 0)) return;

  let estimate;
  try {
    estimate = await client.estimateVideoCost(buildVideoEstimateParams({ tokenType, steps }));
  } catch (err) {
    if (!options.quiet) {
      log(`Warning: Could not estimate video cost (${err?.message || 'error'})`);
    }
    return;
  }
  const required = parseCostEstimate(estimate, tokenType);
  if (Number.isFinite(required) && available < required) {
    throw buildBalanceError(
      `Insufficient ${tokenLabel} balance for video render (need ~${formatTokenValue(required)}, ` +
      `have ${formatTokenValue(available)}).`,
      { tokenType, available, required }
    );
  }
}

// ---------------------------------------------------------------------------
// Token auto-fallback: resolve 'auto' to 'spark', retry with 'sogni' on
// insufficient balance errors for native Sogni models. External API-backed
// models are Spark-only and must not silently fall back to SOGNI tokens.
// ---------------------------------------------------------------------------
const _requiresSparkOnlyToken = requiresSparkOnlyToken(options.model);
if (_requiresSparkOnlyToken && options.tokenType === 'sogni') {
  if (!options.quiet) {
    console.error(`${options.model} requires SPARK tokens; using --token-type spark.`);
  }
  options.tokenType = 'spark';
}
const _isAutoToken = options.tokenType === 'auto';
if (_isAutoToken) {
  options.tokenType = 'spark';
}
const _allowAutoTokenFallback = _isAutoToken && !_requiresSparkOnlyToken;

const DOCTOR_AUTH_TIMEOUT_MS = 15000;

// `sogni-agent doctor` / `--doctor`: one deterministic install health check.
// Agents are told to run this as the verification gate after installing.
async function runDoctor() {
  const checks = [];
  const add = (id, status, detail) => { checks.push({ id, status, detail }); };

  // The zero-dependency guard in node-version-check.mjs already hard-exits on
  // unsupported Node, so reaching this line means the floor is satisfied.
  add('node', 'pass', `v${process.versions.node} (>= 22.11.0 required)`);

  let creds = null;
  try {
    creds = loadCredentials();
    const fileHasKey = existsSync(CREDENTIALS_PATH) &&
      Boolean(parseCredentialsFile(readFileSync(CREDENTIALS_PATH, 'utf8')).SOGNI_API_KEY);
    add('credentials', 'pass', fileHasKey
      ? `SOGNI_API_KEY found in ${CREDENTIALS_PATH}`
      : 'SOGNI_API_KEY found in environment');
  } catch (err) {
    add('credentials', 'fail', `${err.message}${err.hint ? ` — ${err.hint}` : ''}`);
  }

  if (process.platform !== 'win32' && existsSync(CREDENTIALS_PATH)) {
    try {
      const mode = statSync(CREDENTIALS_PATH).mode & 0o777;
      if (mode & 0o077) {
        add('credentials-permissions', 'warn',
          `file mode ${mode.toString(8)} is group/world accessible — run: chmod 600 ${CREDENTIALS_PATH}`);
      } else {
        add('credentials-permissions', 'pass', 'credentials file is private (600)');
      }
    } catch { /* permissions probe is best-effort */ }
  }

  const configDir = join(homedir(), '.config', 'sogni');
  try {
    mkdirSync(configDir, { recursive: true });
    const probePath = join(configDir, `.doctor-probe-${process.pid}`);
    writeFileSync(probePath, 'ok');
    unlinkSync(probePath);
    add('config-dir', 'pass', `${configDir} is writable`);
  } catch (err) {
    add('config-dir', 'fail', `${configDir} is not writable (${err?.code || err}) — personas/memories/last-render need it`);
  }

  try {
    await ensureFfmpegAvailable('the doctor check');
    add('ffmpeg', 'pass', 'found (used by --concat-videos, --remix-audio, --angles-360-video)');
  } catch {
    add('ffmpeg', 'warn', 'not found — optional; install ffmpeg or set FFMPEG_PATH for local video/audio utilities');
  }

  add('media-inbound', existsSync(MEDIA_INBOUND_DIR) ? 'pass' : 'warn',
    existsSync(MEDIA_INBOUND_DIR)
      ? MEDIA_INBOUND_DIR
      : `${MEDIA_INBOUND_DIR} does not exist (only used by --list-media)`);

  if (creds?.SOGNI_API_KEY) {
    let doctorClient = null;
    try {
      doctorClient = new SogniClientWrapper({
        appSource: SOGNI_APP_SOURCE,
        network: openclawConfig?.defaultNetwork || 'fast',
        autoConnect: false,
        apiKey: creds.SOGNI_API_KEY,
        authType: 'apiKey'
      });
      const authFlow = (async () => {
        await connectSogniClient(doctorClient);
        return doctorClient.getBalance();
      })();
      const balance = await Promise.race([
        authFlow,
        new Promise((_, reject) => setTimeout(
          () => reject(Object.assign(new Error('timed out'), { code: 'DOCTOR_TIMEOUT' })),
          DOCTOR_AUTH_TIMEOUT_MS
        ))
      ]);
      const spark = Number.parseFloat(balance?.spark);
      const sogni = Number.parseFloat(balance?.sogni);
      add('auth', 'pass',
        `API key accepted (SPARK ${Number.isFinite(spark) ? spark : '?'}, SOGNI ${Number.isFinite(sogni) ? sogni : '?'})`);
    } catch (err) {
      if (isInvalidApiKeyError(err)) {
        add('auth', 'fail', 'API key rejected — get a fresh key at https://dashboard.sogni.ai (account menu)');
      } else {
        add('auth', 'warn', `could not verify the key (network?): ${err?.message || err}`);
      }
    } finally {
      try {
        if (doctorClient?.isConnected?.()) {
          await Promise.race([doctorClient.disconnect(), new Promise(resolve => setTimeout(resolve, 1000))]);
        }
      } catch { /* ignore */ }
    }
  } else {
    add('auth', 'skip', 'skipped — no API key to verify');
  }

  const updateState = readUpdateCheckState();
  if (updateState?.lastKnownLatest && compareSogniSemver(updateState.lastKnownLatest, PACKAGE_VERSION) > 0) {
    add('version', 'warn', `${PACKAGE_VERSION} installed; ${updateState.lastKnownLatest} available — run: sogni-agent self-update`);
  } else {
    add('version', 'pass', `${PACKAGE_VERSION}${updateState?.lastKnownLatest ? ` (latest known: ${updateState.lastKnownLatest})` : ''}`);
  }

  const healthy = checks.every((check) => check.status !== 'fail');
  if (options.json || JSON_ERROR_MODE) {
    console.log(JSON.stringify({
      success: healthy,
      type: 'doctor',
      healthy,
      checks,
      version: PACKAGE_VERSION,
      timestamp: new Date().toISOString()
    }));
  } else {
    const icons = { pass: '✓', warn: '!', fail: '✗', skip: '-' };
    console.log('sogni-agent doctor');
    for (const check of checks) {
      console.log(`  ${icons[check.status] || '?'} ${check.id.padEnd(25)} ${check.detail}`);
    }
    console.log(healthy ? 'Result: healthy' : 'Result: problems found (fix the ✗ items above)');
  }
  return healthy ? 0 : 1;
}

async function main() {
  let exitCode = 0;
  const log = options.quiet ? () => {} : console.error.bind(console);
  let client = null;

  try {
    if (options.showVersion) {
      if (options.json) {
        console.log(JSON.stringify({
          success: true,
          type: 'version',
          name: 'sogni-creative-agent-skill',
          version: PACKAGE_VERSION,
          timestamp: new Date().toISOString()
        }));
      } else {
        console.log(PACKAGE_VERSION);
      }
      return;
    }

    if (options.doctor) {
      // runDoctor manages (and disconnects) its own client; exit directly so
      // the success-path `process.exit(0)` in the main().then() tail cannot
      // mask a failing health check.
      process.exit(await runDoctor());
    }

    // --- Utility commands (no Sogni auth required) ---

    // Memory commands
    if (options.memoryAction) {
      const jsonOut = options.json || JSON_ERROR_MODE;
      if (options.memoryAction === 'list') {
        const memories = loadMemories();
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'memory-list', memories, timestamp: new Date().toISOString() }));
        } else {
          if (memories.length === 0) { console.log('No memories saved.'); }
          else { memories.forEach(m => console.log(`  ${m.key}: ${m.value} [${m.category || 'preference'}]`)); }
        }
      } else if (options.memoryAction === 'get') {
        const memories = loadMemories();
        const found = memories.find(m => m.key === options.memoryKey);
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'memory-get', key: options.memoryKey, found: !!found, memory: found || null, timestamp: new Date().toISOString() }));
        } else {
          console.log(found ? `${found.key}: ${found.value}` : `Memory "${options.memoryKey}" not found.`);
        }
      } else if (options.memoryAction === 'set') {
        const action = memorySet(options.memoryKey, options.memoryValue, options.memoryCategory || 'preference');
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'memory-set', action, key: options.memoryKey, value: options.memoryValue, timestamp: new Date().toISOString() }));
        } else {
          console.log(`Memory "${options.memoryKey}" ${action}.`);
        }
      } else if (options.memoryAction === 'remove') {
        const removed = memoryRemove(options.memoryKey);
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'memory-remove', removed, key: options.memoryKey, timestamp: new Date().toISOString() }));
        } else {
          console.log(removed ? `Memory "${options.memoryKey}" removed.` : `Memory "${options.memoryKey}" not found.`);
        }
      }
      return;
    }

    // Personality commands
    if (options.personalityAction) {
      const jsonOut = options.json || JSON_ERROR_MODE;
      if (options.personalityAction === 'get') {
        const text = loadPersonality();
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'personality-get', personality: text, timestamp: new Date().toISOString() }));
        } else {
          console.log(text || '(no personality set — using default)');
        }
      } else if (options.personalityAction === 'set') {
        savePersonality(options.personalityText);
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'personality-set', personality: options.personalityText, timestamp: new Date().toISOString() }));
        } else {
          console.log('Personality saved.');
        }
      } else if (options.personalityAction === 'clear') {
        clearPersonality();
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'personality-clear', timestamp: new Date().toISOString() }));
        } else {
          console.log('Personality cleared.');
        }
      }
      return;
    }

    // Persona commands (non-generate)
    if (options.personaAction && options.personaAction !== 'generate') {
      const jsonOut = options.json || JSON_ERROR_MODE;
      if (options.personaAction === 'list') {
        const personas = loadPersonas();
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'persona-list', personas, timestamp: new Date().toISOString() }));
        } else {
          if (personas.length === 0) { console.log('No personas saved.'); }
          else { personas.forEach(p => console.log(`  ${p.name} (${p.relationship}) — ${p.description || 'no description'}${p.voiceClipPath ? ' [has voice]' : ''}`)); }
        }
      } else if (options.personaAction === 'add') {
        const photoPath = options.personaPhoto || options.refImage;
        if (!photoPath) {
          fatalCliError('--persona-add requires a reference photo (--ref <path>).', { code: 'INVALID_ARGUMENT' });
        }
        const persona = addPersona({
          name: options.personaName,
          relationship: options.personaRelationship,
          description: options.personaDescription,
          tags: options.personaTags,
          voice: options.personaVoice,
          photoPath,
          voiceClipPath: options.personaVoiceClip
        });
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'persona-add', persona, timestamp: new Date().toISOString() }));
        } else {
          console.log(`Persona "${persona.name}" saved (${persona.relationship}).`);
          if (persona.photoPath) console.log(`  Photo: ${persona.photoPath}`);
          if (persona.voiceClipPath) console.log(`  Voice: ${persona.voiceClipPath}`);
        }
      } else if (options.personaAction === 'remove') {
        const removed = removePersona(options.personaName);
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'persona-remove', removed, name: options.personaName, timestamp: new Date().toISOString() }));
        } else {
          console.log(removed ? `Persona "${options.personaName}" removed.` : `Persona "${options.personaName}" not found.`);
        }
      } else if (options.personaAction === 'resolve') {
        const persona = resolvePersonaByName(options.personaName);
        if (jsonOut) {
          console.log(JSON.stringify({ success: true, type: 'persona-resolve', found: !!persona, persona: persona || null, timestamp: new Date().toISOString() }));
        } else {
          if (!persona) { console.log(`Persona "${options.personaName}" not found.`); }
          else {
            console.log(`  Name: ${persona.name}`);
            console.log(`  Relationship: ${persona.relationship}`);
            if (persona.description) console.log(`  Description: ${persona.description}`);
            if (persona.tags?.length) console.log(`  Tags: ${persona.tags.join(', ')}`);
            if (persona.voice) console.log(`  Voice: ${persona.voice}`);
            if (persona.photoPath) console.log(`  Photo: ${persona.photoPath}`);
            if (persona.voiceClipPath) console.log(`  Voice clip: ${persona.voiceClipPath}`);
          }
        }
      }
      return;
    }

    if (options._resolvedPersona) {
      const persona = options._resolvedPersona;
      if (persona.photoPath && existsSync(persona.photoPath)) {
        log(`Using persona "${persona.name}" (${persona.relationship}) ${options.video ? 'photo as reference frame' : 'photo as context'}`);
      }
      if (options.video && options.referenceAudioIdentity) {
        log(`Using persona "${options._voicePersonaResolvedName || persona.name}" voice identity`);
      }
    }

    if (options.apiModelAction) {
      await runApiModels();
      return;
    }

    if (options.apiReplayAction) {
      await runApiReplay();
      return;
    }

    if (contractUtilityAction) {
      runContractDebugAction();
      return;
    }

    if (storyboardPlanUtilityAction) {
      runStoryboardPlanAction();
      return;
    }

    if (options.apiChat) {
      await runApiChat(log);
      return;
    }

    if (options.apiWorkflowAction) {
      await runApiWorkflow(log);
      return;
    }

    if (options.extractLastFrame) {
      const videoPath = sanitizePath(options.extractLastFrame, '--extract-last-frame video');
      const outputPath = sanitizePath(options.extractLastFrameOutput, '--extract-last-frame output');
      if (!existsSync(videoPath)) {
        const err = new Error(`Video file not found: ${videoPath}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      await extractLastFrameFromVideo(videoPath, outputPath);
      if (options.json || JSON_ERROR_MODE) {
        console.log(JSON.stringify({
          success: true,
          type: 'extract-last-frame',
          outputPath,
          timestamp: new Date().toISOString()
        }));
      } else {
        console.log(`Extracted last frame to: ${outputPath}`);
      }
      return;
    }

    if (options.extractFirstFrame) {
      const videoPath = sanitizePath(options.extractFirstFrame, '--extract-first-frame video');
      const outputPath = sanitizePath(options.extractFirstFrameOutput, '--extract-first-frame output');
      if (!existsSync(videoPath)) {
        const err = new Error(`Video file not found: ${videoPath}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      await extractFirstFrameFromVideo(videoPath, outputPath);
      if (options.json || JSON_ERROR_MODE) {
        console.log(JSON.stringify({
          success: true,
          type: 'extract-first-frame',
          outputPath,
          timestamp: new Date().toISOString()
        }));
      } else {
        console.log(`Extracted first frame to: ${outputPath}`);
      }
      return;
    }

    if (options.concatVideos) {
      const outputPath = sanitizePath(options.concatVideos, '--concat-videos output');
      const clips = options.concatVideosClips.map((c, i) => sanitizePath(c, `clip[${i}]`));
      const concatAudio = options.concatAudio ? sanitizePath(options.concatAudio, '--concat-audio') : null;
      for (const clip of clips) {
        if (!existsSync(clip)) {
          const err = new Error(`Clip file not found: ${clip}`);
          err.code = 'FILE_NOT_FOUND';
          throw err;
        }
      }
      if (concatAudio && !existsSync(concatAudio)) {
        const err = new Error(`Audio file not found: ${concatAudio}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      await buildConcatVideoFromClips(outputPath, clips, {
        audioPath: concatAudio,
        audioStart: options.concatAudioStart,
        targetFps: options.concatFps
      });
      if (options.json || JSON_ERROR_MODE) {
        console.log(JSON.stringify({
          success: true,
          type: 'concat-videos',
          outputPath,
          clipCount: clips.length,
          audioPath: concatAudio || null,
          audioStart: options.concatAudioStart ?? null,
          targetFps: options.concatFps ?? null,
          timestamp: new Date().toISOString()
        }));
      } else {
        console.log(`Concatenated ${clips.length} clips to: ${outputPath}${concatAudio ? ` with audio ${concatAudio}` : ''}`);
      }
      return;
    }

    if (options.remixAudio) {
      const inputVideo = sanitizePath(options.remixAudio, '--remix-audio input');
      const outputVideo = sanitizePath(options.remixAudioOutput, '--remix-audio output');
      const bedAudio = options.bedAudio ? sanitizePath(options.bedAudio, '--bed-audio') : null;
      const mixAudio = options.mixAudio ? sanitizePath(options.mixAudio, '--mix-audio') : null;
      if (!existsSync(inputVideo)) {
        const err = new Error(`Video file not found: ${inputVideo}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      if (bedAudio && !existsSync(bedAudio)) {
        const err = new Error(`Bed audio file not found: ${bedAudio}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      if (mixAudio && !existsSync(mixAudio)) {
        const err = new Error(`Mix audio file not found: ${mixAudio}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      await remixVideoAudio(inputVideo, outputVideo, {
        bedAudio,
        loop: options.audioLoop,
        fadeIn: options.audioFadeIn,
        fadeOut: options.audioFadeOut,
        mixAudio,
        mixAt: options.mixAt,
        mixGain: options.mixGain
      });
      if (options.json || JSON_ERROR_MODE) {
        console.log(JSON.stringify({
          success: true,
          type: 'remix-audio',
          outputPath: outputVideo,
          bedAudio: bedAudio || null,
          loop: Boolean(options.audioLoop),
          fadeIn: options.audioFadeIn ?? null,
          fadeOut: options.audioFadeOut ?? null,
          mixAudio: mixAudio || null,
          mixAt: options.mixAt ?? null,
          mixGain: options.mixGain ?? null,
          timestamp: new Date().toISOString()
        }));
      } else {
        console.log(`Remixed audio to: ${outputVideo}`);
      }
      return;
    }

    if (options.listMedia) {
      const mediaType = options.listMedia;
      const baseDir = MEDIA_INBOUND_DIR;

      const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
      const AUDIO_EXTS = new Set(['.m4a', '.mp3', '.wav', '.ogg']);

      let allowedExts;
      if (mediaType === 'images') allowedExts = IMAGE_EXTS;
      else if (mediaType === 'audio') allowedExts = AUDIO_EXTS;
      else allowedExts = new Set([...IMAGE_EXTS, ...AUDIO_EXTS]);

      const files = [];
      if (existsSync(baseDir)) {
        // Validate the base directory itself isn't a symlink pointing outside its expected parent.
        const allowedRoot = realpathSync(dirname(baseDir));
        const resolvedBase = realpathSync(baseDir);
        if (!isPathWithinBase(allowedRoot, resolvedBase)) {
          const err = new Error('Media directory resolves outside of its expected root.');
          err.code = 'INVALID_PATH';
          throw err;
        }

        const entries = readdirSync(baseDir);
        for (const entry of entries) {
          const ext = extname(entry).toLowerCase();
          if (!allowedExts.has(ext)) continue;
          const fullPath = join(baseDir, entry);
          // Skip symlinks
          const lstats = lstatSync(fullPath);
          if (lstats.isSymbolicLink()) continue;
          if (!lstats.isFile()) continue;
          files.push({
            path: fullPath,
            name: entry,
            size: lstats.size,
            modified: lstats.mtime.toISOString()
          });
        }
        // Sort by mtime descending, return top 5
        files.sort((a, b) => b.modified.localeCompare(a.modified));
        files.splice(5);
      }

      if (options.json || JSON_ERROR_MODE) {
        console.log(JSON.stringify({
          success: true,
          type: 'list-media',
          mediaType,
          files,
          timestamp: new Date().toISOString()
        }));
      } else {
        if (files.length === 0) {
          console.log(`No ${mediaType} files found in ${baseDir}`);
        } else {
          console.log(`Recent ${mediaType} (${files.length}):`);
          for (const f of files) {
            console.log(`  ${f.name}  (${f.size} bytes, ${f.modified})`);
          }
        }
      }
      return;
    }

    const creds = loadCredentials();
    log('Connecting to Sogni...');
    client = new SogniClientWrapper({
      appSource: SOGNI_APP_SOURCE,
      network: openclawConfig?.defaultNetwork || 'fast',
      autoConnect: false,
      apiKey: creds.SOGNI_API_KEY,
      authType: 'apiKey'
    });

    await connectSogniClient(client);
    await disableLiveModelAvailabilityEvents(client);
    log('Connected.');

    if (options.showBalance) {
      const balance = await client.getBalance();
      const spark = Number.parseFloat(balance?.spark);
      const sogni = Number.parseFloat(balance?.sogni);
      if (options.json) {
        console.log(JSON.stringify({
          success: true,
          type: 'balance',
          spark: Number.isFinite(spark) ? spark : null,
          sogni: Number.isFinite(sogni) ? sogni : null,
          tokenType: options.tokenType || 'spark',
          timestamp: new Date().toISOString()
        }));
      } else {
        console.log(`SPARK: ${formatTokenValue(spark)}`);
        console.log(`SOGNI: ${formatTokenValue(sogni)}`);
      }
      return;
    }

    await ensureSufficientVideoBalance(client, log);

    if (options.estimateVideoCost) {
      const modelDefaults = getModelDefaults(options.model, openclawConfig);
      const steps = resolveVideoSteps(options.model, modelDefaults, options.steps);
      const isSeedanceVideo = isSeedanceModel(options.model);
      if (!isSeedanceVideo && (!Number.isFinite(steps) || steps <= 0)) {
        const err = new Error('--estimate-video-cost requires --steps (or modelDefaults for this model).');
        err.code = 'MISSING_STEPS';
        err.hint = 'Pass --steps explicitly (e.g. --steps 4 for lightx2v models).';
        throw err;
      }
      const estimateParams = buildVideoEstimateParams({
        tokenType: options.tokenType || 'spark',
        steps
      });
      const estimate = await client.estimateVideoCost(estimateParams);
      if (options.json) {
        const duration = options.frames ? Math.max(1, Math.round((options.frames - 1) / options.fps)) : options.duration;
        console.log(JSON.stringify({
          success: true,
          type: 'video-cost',
          model: options.model,
          width: options.width,
          height: options.height,
          fps: options.fps,
          frames: options.frames ?? null,
          duration,
          steps,
          tokenType: options.tokenType || 'spark',
          count: options.count,
          estimate
        }));
      } else {
        console.log(`Estimated cost: ${JSON.stringify(estimate)}`);
      }
      return;
    }

    if (options.multiAngle) {
      if (options.contextImages.length > 1 && !options.quiet) {
        console.error('Warning: --multi-angle uses the first context image only.');
      }
      await runMultiAngleFlow(client, log);
      return;
    }
    
    const results = [];
    let completedJobs = 0;
    let loopingStartImageBuffer;
    
    const completionPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout after ${options.timeout / 1000}s`));
      }, options.timeout);
      
      client.on(ClientEvent.JOB_COMPLETED, (data) => {
        const jobData = data.job?.data || {};
        results.push({
          resultUrl: data.resultUrl || (options.music ? data.audioUrl : options.video ? data.videoUrl : data.imageUrl),
          seed: jobData.seed,
          jobIndex: data.jobIndex,
          projectId: data.projectId
        });
        completedJobs++;
        log(`${options.music ? 'Music' : options.video ? 'Video' : 'Image'} ${completedJobs}/${options.count} completed`);
        
        if (completedJobs >= options.count) {
          clearTimeout(timeout);
          resolve();
        }
      });
      
      client.on(ClientEvent.JOB_FAILED, (data) => {
        clearTimeout(timeout);
        reject(new Error(data.error || 'Job failed'));
      });

      client.on(ClientEvent.PROJECT_FAILED, (data) => {
        clearTimeout(timeout);
        const message = data?.message || data?.error || 'Project failed';
        reject(new Error(message));
      });

      client.on(ClientEvent.PROJECT_EVENT, (event) => {
        if (event?.type !== 'error') return;
        clearTimeout(timeout);
        const message = event?.error?.message || event?.error?.error || 'Project failed';
        reject(new Error(message));
      });

      client.on(ClientEvent.JOB_EVENT, (event) => {
        if (event?.type !== 'error') return;
        clearTimeout(timeout);
        const message = event?.error?.message || event?.error?.error || 'Job failed';
        reject(new Error(message));
      });
      
      // Progress for longer-running media jobs.
      if (options.video || options.music) {
        client.on(ClientEvent.PROJECT_PROGRESS, (data) => {
          if (data.percentage && data.percentage > 0) {
            log(`Progress: ${Math.round(data.percentage)}%`);
          }
        });
      }
    });
    
    if (options.video) {
      // Video generation
      log(`Generating video (${options.videoWorkflow}) with ${options.model}...`);
      if (options.refImage) log(`Reference image: ${options.refImage}`);
      if (options.refImageEnd) log(`End frame: ${options.refImageEnd}`);
      if (options.refAudio) log(`Reference audio: ${options.refAudio}`);
      if (options.referenceAudioIdentity) log(`Voice identity: ${options._voicePersonaResolvedName || options.referenceAudioIdentity}`);
      if (options.refVideo) log(`Reference video: ${options.refVideo}`);

      const isSeedanceVideo = isSeedanceModel(options.model);
      if (isSeedanceVideo) {
        // Source of truth: @sogni-ai/sogni-protocol catalogs/seedance-reference-limits.json
        // surfaced through @sogni-ai/sogni-intelligence-client/tools.
        enforceSeedanceReferenceCaps();
      }
      const seedanceReferenceImageUrls = [];
      const seedanceReferenceVideoUrls = [];
      const seedanceReferenceAudioUrls = [];
      const useRefImageUrl = isSeedanceVideo && await appendSafeSeedanceReferenceUrl(seedanceReferenceImageUrls, options.refImage, 'Reference image');
      const useRefImageEndUrl = isSeedanceVideo && await appendSafeSeedanceReferenceUrl(seedanceReferenceImageUrls, options.refImageEnd, 'End reference image');
      const refAudioFormatByPath = options.refAudio
        ? detectReferenceAudioFormat(
            new Uint8Array(),
            normalizeReferenceAudioMimeType(mimeTypeForPath(options.refAudio, 'application/octet-stream'))
              || mimeTypeForPath(options.refAudio, 'application/octet-stream')
          )
        : 'unknown';
      let projectVideoStart = options.videoStart;
      let useRefAudioUrl = false;
      if (isSeedanceVideo && options.refAudio) {
        const shouldUploadAudio =
          !isHttpsUrl(options.refAudio) ||
          refAudioFormatByPath !== 'mp3' ||
          options.audioStart !== null ||
          options.audioDuration !== null;
        if (shouldUploadAudio) {
          const uploadedAudioUrl = await uploadSeedanceReferenceAudioUrl(
            options.refAudio,
            creds.SOGNI_API_KEY,
            0,
          );
          seedanceReferenceAudioUrls.push(uploadedAudioUrl);
          useRefAudioUrl = true;
        } else {
          useRefAudioUrl = await appendSafeSeedanceReferenceUrl(seedanceReferenceAudioUrls, options.refAudio, 'Reference audio');
        }
      }
      let useRefVideoUrl = false;
      if (isSeedanceVideo && options.refVideo) {
        if (isHttpsUrl(options.refVideo) && options.videoStart === null) {
          useRefVideoUrl = await appendSafeSeedanceReferenceUrl(seedanceReferenceVideoUrls, options.refVideo, 'Reference video');
        } else {
          const uploadedVideoUrl = await uploadSeedanceReferenceVideoUrl(
            options.refVideo,
            creds.SOGNI_API_KEY,
            0,
          );
          seedanceReferenceVideoUrls.push(uploadedVideoUrl);
          useRefVideoUrl = true;
          projectVideoStart = null;
        }
      }

      // Seedance loose-reference extras: -c/--context images beyond start/end,
      // plus repeated --ref-audio / --ref-video entries past the first. The
      // Sogni Client SDK accepts only URL arrays for these (createJobRequestMessage),
      // so extras MUST be HTTPS URLs. For multi-file local uploads, use --api-chat /
      // --durable-chat where the LLM upload pipeline handles per-file uploads.
      if (isSeedanceVideo) {
        for (const ctxImage of (Array.isArray(options.contextImages) ? options.contextImages : [])) {
          if (!ctxImage) continue;
          if (!isHttpsUrl(ctxImage)) {
            fatalCliError(
              `Seedance extra image reference "${ctxImage}" must be an HTTPS URL. ` +
              'Local file uploads beyond --ref / --ref-end are only supported in --api-chat / --durable-chat mode.',
              { code: 'INVALID_ARGUMENT', details: { flag: '-c/--context', value: ctxImage } },
            );
          }
          await appendSafeSeedanceReferenceUrl(seedanceReferenceImageUrls, ctxImage, 'Seedance image reference');
        }
        for (const [extraAudioIndex, extraAudio] of options.refAudios.entries()) {
          if (!isHttpsUrl(extraAudio)) {
            fatalCliError(
              `Additional --ref-audio "${extraAudio}" must be an HTTPS URL. ` +
              'Local file uploads beyond the primary --ref-audio are only supported in --api-chat / --durable-chat mode.',
              { code: 'INVALID_ARGUMENT', details: { flag: '--ref-audio', value: extraAudio } },
            );
          }
          const extraAudioFormat = detectReferenceAudioFormat(
            new Uint8Array(),
            normalizeReferenceAudioMimeType(mimeTypeForPath(extraAudio, 'application/octet-stream'))
              || mimeTypeForPath(extraAudio, 'application/octet-stream')
          );
          if (extraAudioFormat !== 'mp3') {
            const uploadedAudioUrl = await uploadSeedanceReferenceAudioUrl(
              extraAudio,
              creds.SOGNI_API_KEY,
              extraAudioIndex + 1,
            );
            seedanceReferenceAudioUrls.push(uploadedAudioUrl);
          } else {
            await appendSafeSeedanceReferenceUrl(seedanceReferenceAudioUrls, extraAudio, 'Seedance audio reference');
          }
        }
        for (const extraVideo of options.refVideos) {
          if (!isHttpsUrl(extraVideo)) {
            fatalCliError(
              `Additional --ref-video "${extraVideo}" must be an HTTPS URL. ` +
              'Local file uploads beyond the primary --ref-video are only supported in --api-chat / --durable-chat mode.',
              { code: 'INVALID_ARGUMENT', details: { flag: '--ref-video', value: extraVideo } },
            );
          }
          await appendSafeSeedanceReferenceUrl(seedanceReferenceVideoUrls, extraVideo, 'Seedance video reference');
        }
      }

      let imageBuffer = options.refImage && !useRefImageUrl ? await fetchMediaBuffer(options.refImage) : undefined;
      let endImageBuffer = options.refImageEnd && !useRefImageEndUrl ? await fetchMediaBuffer(options.refImageEnd) : undefined;
      let audioBuffer = options.refAudio && !useRefAudioUrl ? await fetchMediaBuffer(options.refAudio) : undefined;
      let videoBuffer = options.refVideo && !useRefVideoUrl ? await fetchMediaBuffer(options.refVideo) : undefined;
      if (audioBuffer) {
        audioBuffer = await prepareReferenceAudioForVideoBuffer(audioBuffer, options.refAudio);
      }
      if (
        videoBuffer
        && isSeedanceVideo
        && options.videoWorkflow === 'v2v'
        && shouldTrimSeedanceV2VSourceVideo({
          sourceDurationSeconds: null,
          requestedDurationSeconds: options.duration,
          startOffsetSeconds: options.videoStart ?? 0
        })
      ) {
        videoBuffer = await trimSeedanceV2VSourceVideoBuffer(
          videoBuffer,
          options.refVideo,
          options.videoStart ?? 0,
          options.duration,
        );
        projectVideoStart = null;
        if (!options.quiet) {
          console.error('Prepared Seedance V2V reference video clip before upload.');
        }
      }
      const audioIdentityMedia = options.referenceAudioIdentity
        ? await prepareReferenceAudioIdentityMedia(options.referenceAudioIdentity)
        : undefined;
      const modelDefaults = getModelDefaults(options.model, openclawConfig);
      const videoDimensionRules = videoDimensionRulesFromDefaults(modelDefaults, options.model);

      // Pre-resize reference images to model-compatible dimensions if needed for i2v workflow.
      if (options.videoWorkflow === 'i2v' && imageBuffer && options._needsRefResize) {
        const dims = getImageDimensionsFromBuffer(imageBuffer);
        if (dims?.width && dims?.height) {
          const resizedBuffer = await resizeImageBufferForVideo(imageBuffer, dims.width, dims.height, videoDimensionRules);
          const resizedDims = getImageDimensionsFromBuffer(resizedBuffer);
          if (!options.quiet) {
            console.error(
              `Pre-resized reference image from ${dims.width}x${dims.height} to ${resizedDims.width}x${resizedDims.height} ` +
              `(divisible by ${videoDimensionRules.dimensionMultiple}) to ensure i2v compatibility.`
            );
          }
          imageBuffer = resizedBuffer;
        }
      }
      if (options.videoWorkflow === 'i2v' && endImageBuffer && options._needsRefEndResize) {
        const dims = getImageDimensionsFromBuffer(endImageBuffer);
        if (dims?.width && dims?.height) {
          const resizedBuffer = await resizeImageBufferForVideo(endImageBuffer, dims.width, dims.height, videoDimensionRules);
          const resizedDims = getImageDimensionsFromBuffer(resizedBuffer);
          if (!options.quiet) {
            console.error(
              `Pre-resized end reference image from ${dims.width}x${dims.height} to ${resizedDims.width}x${resizedDims.height} ` +
              `(divisible by ${videoDimensionRules.dimensionMultiple}) to ensure i2v compatibility.`
            );
          }
          endImageBuffer = resizedBuffer;
        }
      }
      // Preserve the prepared start-frame buffer so looping (A->B->A) can reuse it later.
      loopingStartImageBuffer = imageBuffer;

      const steps = resolveVideoSteps(options.model, modelDefaults, options.steps);
      const guidance = options.guidance ?? modelDefaults?.guidance;
      
      const projectConfig = {
        modelId: options.model,
        positivePrompt: options.prompt,
        negativePrompt: '',
        stylePrompt: '',
        numberOfMedia: options.count,
        referenceImage: imageBuffer,
        fps: options.fps,
        width: options.width,
        height: options.height,
        tokenType: options.tokenType || 'spark',
        waitForCompletion: false,
        disableNSFWFilter: options.noFilter === true
      };

      if (options.outputFormat) {
        projectConfig.outputFormat = options.outputFormat;
      }
      if (options.autoResizeVideoAssets !== null) {
        projectConfig.autoResizeVideoAssets = options.autoResizeVideoAssets;
      }

      if (options.frames) {
        projectConfig.frames = options.frames;
      } else {
        projectConfig.duration = options.duration;
      }
      
      // Add end frame for interpolation if provided
      if (endImageBuffer) {
        projectConfig.referenceImageEnd = endImageBuffer;
      }
      if (audioBuffer) {
        projectConfig.referenceAudio = audioBuffer;
      }
      if (options.audioStart !== null && !useRefAudioUrl) {
        projectConfig.audioStart = options.audioStart;
      }
      if (options.audioDuration !== null && !useRefAudioUrl) {
        projectConfig.audioDuration = options.audioDuration;
      }
      if (audioIdentityMedia) {
        projectConfig.referenceAudioIdentity = audioIdentityMedia;
      }
      if (videoBuffer) {
        projectConfig.referenceVideo = videoBuffer;
      }
      if (seedanceReferenceImageUrls.length > 0) {
        projectConfig.referenceImageUrls = seedanceReferenceImageUrls;
      }
      if (seedanceReferenceVideoUrls.length > 0) {
        projectConfig.referenceVideoUrls = seedanceReferenceVideoUrls;
      }
      if (seedanceReferenceAudioUrls.length > 0) {
        projectConfig.referenceAudioUrls = seedanceReferenceAudioUrls;
      }
      if (projectVideoStart !== null) {
        projectConfig.videoStart = projectVideoStart;
      }
      if (options.seed !== null && options.seed !== undefined) {
        projectConfig.seed = options.seed;
      }
      if (Number.isFinite(steps)) {
        projectConfig.steps = steps;
      }
      if (guidance !== null && guidance !== undefined) {
        projectConfig.guidance = guidance;
      }
      if (modelDefaults?.sampler) {
        projectConfig.sampler = modelDefaults.sampler;
      }
      if (modelDefaults?.scheduler) {
        projectConfig.scheduler = modelDefaults.scheduler;
      }
      if (modelDefaults?.shift !== null && modelDefaults?.shift !== undefined) {
        projectConfig.shift = modelDefaults.shift;
      }
      if (options.videoControlNetName && !isSeedanceModel(options.model)) {
        const controlNetStrength = resolveVideoControlNetStrength(options.videoControlNetName, options.videoControlNetStrength);
        projectConfig.controlNet = {
          name: options.videoControlNetName,
          strength: controlNetStrength
        };
        if (options.videoControlNetName !== 'detailer') {
          projectConfig.detailerStrength = 0.6;
        }
      } else if (options.videoControlNetName && isSeedanceModel(options.model) && !options.quiet) {
        console.error('Warning: --controlnet-name ignored for Seedance V2V models.');
      }
      if (options.sam2Coordinates) {
        projectConfig.sam2Coordinates = options.sam2Coordinates;
      }
      if (options.trimEndFrame) {
        projectConfig.trimEndFrame = true;
      }
      if (options.firstFrameStrength != null) {
        projectConfig.firstFrameStrength = options.firstFrameStrength;
      }
      if (options.lastFrameStrength != null) {
        projectConfig.lastFrameStrength = options.lastFrameStrength;
      }

      const videoResult = await client.createVideoProject(projectConfig);

      // Check for errors in the response (e.g., insufficient tokens)
      if (videoResult?.error || videoResult?.message) {
        throw buildProjectResultError(videoResult);
      }
    } else if (options.music) {
      log(`Generating music with ${options.model}...`);
      if (options.seed !== null && options.seed !== undefined) log(`Using seed: ${options.seed}`);

      const projectConfig = {
        modelId: options.model,
        positivePrompt: options.prompt,
        numberOfMedia: options.count,
        duration: options.duration,
        steps: options.steps,
        tokenType: options.tokenType || 'spark',
        waitForCompletion: false,
        disableNSFWFilter: options.noFilter === true,
        outputFormat: options.outputFormat || 'mp3'
      };

      if (options.guidance !== null && options.guidance !== undefined) {
        projectConfig.guidance = options.guidance;
      }
      if (options.sampler) {
        projectConfig.sampler = options.sampler;
      }
      if (options.scheduler) {
        projectConfig.scheduler = options.scheduler;
      }
      if (options.musicShift !== null && options.musicShift !== undefined) {
        projectConfig.shift = options.musicShift;
      }
      if (options.musicBpm !== null && options.musicBpm !== undefined) {
        projectConfig.bpm = options.musicBpm;
      }
      if (options.musicTimesig) {
        projectConfig.timesignature = options.musicTimesig;
      }
      if (options.musicLanguage) {
        projectConfig.language = options.musicLanguage;
      }
      if (options.musicLyrics) {
        projectConfig.lyrics = options.musicLyrics;
      }
      if (options.musicKeyscale) {
        projectConfig.keyscale = options.musicKeyscale;
      }
      if (options.musicComposerMode !== null && options.musicComposerMode !== undefined) {
        projectConfig.composerMode = options.musicComposerMode;
      }
      if (options.musicPromptStrength !== null && options.musicPromptStrength !== undefined) {
        projectConfig.promptStrength = options.musicPromptStrength;
      }
      if (options.musicCreativity !== null && options.musicCreativity !== undefined) {
        projectConfig.creativity = options.musicCreativity;
      }
      if (options.seed !== null && options.seed !== undefined) {
        projectConfig.seed = options.seed;
      }

      const audioResult = await client.createAudioProject(projectConfig);

      if (audioResult?.error || audioResult?.message) {
        throw buildProjectResultError(audioResult);
      }
    } else if (options.contextImages.length > 0) {
      // Image editing with context images
      log(`Editing with ${options.model}...`);
      log(`Context images: ${options.contextImages.length}`);
      if (options.seed !== null && options.seed !== undefined) log(`Using seed: ${options.seed}`);
      
      // Load all context images as buffers
      const contextBuffers = await Promise.all(
        options.contextImages.map(img => fetchMediaBuffer(img))
      );
      const modelDefaults = getModelDefaults(options.model, openclawConfig);
      const steps = options.steps ?? modelDefaults?.steps ?? (options.model.includes('lightning') ? 4 : 20);
      const guidance = options.guidance ?? modelDefaults?.guidance ?? (options.model.includes('lightning') ? 3.5 : 7.5);
      const gptImageQuality = isGptImage2ModelSelection(options.model)
        ? options.quality === 'pro'
          ? 'high'
          : options.quality === 'fast'
            ? 'low'
            : 'medium'
        : null;
      
      const editConfig = {
        modelId: options.model,
        positivePrompt: options.prompt,
        contextImages: contextBuffers,
        numberOfMedia: options.count,
        width: options.width,
        height: options.height,
        steps,
        guidance,
        tokenType: options.tokenType || 'spark',
        disableNSFWFilter: options.noFilter === true
      };

      if (options.outputFormat) {
        editConfig.outputFormat = options.outputFormat;
      }
      if (gptImageQuality) {
        editConfig.gptImageQuality = gptImageQuality;
      }
      if (options.sampler) {
        editConfig.sampler = options.sampler;
      }
      if (options.scheduler) {
        editConfig.scheduler = options.scheduler;
      }
      if (options.loras.length > 0) {
        editConfig.loras = options.loras;
      }
      if (options.loraStrengths.length > 0) {
        editConfig.loraStrengths = options.loraStrengths;
      }
      
      if (options.seed !== null && options.seed !== undefined) {
        editConfig.seed = options.seed;
      }
      
      const editResult = isGptImage2ModelSelection(options.model)
        ? await client.createImageProject(editConfig)
        : await client.createImageEditProject(editConfig);
      if (editResult?.error || editResult?.message) {
        throw buildProjectResultError(editResult);
      }
    } else if (options.photobooth) {
      // Photobooth: face transfer with InstantID ControlNet
      log(`Photobooth with ${options.model}...`);
      if (options.seed !== null && options.seed !== undefined) log(`Using seed: ${options.seed}`);

      const faceBuffer = await fetchMediaBuffer(options.refImage);
      const modelDefaults = getModelDefaults(options.model, openclawConfig);
      const steps = options.steps ?? modelDefaults?.steps ?? 7;
      const guidance = options.guidance ?? modelDefaults?.guidance ?? 2;

      const projectConfig = {
        modelId: options.model,
        positivePrompt: options.prompt,
        negativePrompt: '',
        stylePrompt: '',
        numberOfMedia: options.count,
        tokenType: options.tokenType || 'spark',
        waitForCompletion: false,
        sizePreset: 'custom',
        width: options.width,
        height: options.height,
        steps,
        guidance,
        disableNSFWFilter: options.noFilter === true,
        sampler: options.sampler || 'dpmpp_sde',
        scheduler: options.scheduler || 'karras',
        controlNet: {
          name: 'instantid',
          image: faceBuffer,
          strength: options.cnStrength ?? 0.7,
          mode: 'balanced',
          guidanceStart: 0,
          guidanceEnd: options.cnGuidanceEnd ?? 0.6,
        }
      };

      if (options.outputFormat) projectConfig.outputFormat = options.outputFormat;
      if (options.seed !== null && options.seed !== undefined) projectConfig.seed = options.seed;
      if (options.loras.length > 0) projectConfig.loras = options.loras;
      if (options.loraStrengths.length > 0) projectConfig.loraStrengths = options.loraStrengths;

      const projectResult = await client.createImageProject(projectConfig);

      // Check for errors in the response (e.g., insufficient tokens)
      if (projectResult?.error || projectResult?.message) {
        throw buildProjectResultError(projectResult);
      }
    } else {
      // Standard image generation
      log(`Generating with ${options.model}...`);
      if (options.seed !== null && options.seed !== undefined) log(`Using seed: ${options.seed}`);
      const modelDefaults = getModelDefaults(options.model, openclawConfig);
      const guidance = options.guidance ?? modelDefaults?.guidance ?? 1.0;
      const steps = options.steps ?? modelDefaults?.steps;
      const gptImageQuality = isGptImage2ModelSelection(options.model)
        ? options.quality === 'pro'
          ? 'high'
          : options.quality === 'fast'
            ? 'low'
            : 'medium'
        : null;

      const useVariations = options.count > 1 && hasPromptVariations(options.prompt);
      const variationCount = useVariations ? options.count : 1;
      const imagesPerCall = useVariations ? 1 : options.count;

      for (let vi = 0; vi < variationCount; vi++) {
        let expandedPrompt = useVariations
          ? expandPromptVariation(options.prompt, vi)
          : options.prompt;
        // Sanitize batch prompts to prevent grid/collage artifacts
        if (imagesPerCall > 1) expandedPrompt = sanitizeBatchPrompt(expandedPrompt);
        if (useVariations) {
          log(`Variation ${vi + 1}/${variationCount}: "${expandedPrompt}"`);
        }

        const projectConfig = {
          modelId: options.model,
          positivePrompt: expandedPrompt,
          negativePrompt: '',
          stylePrompt: '',
          numberOfMedia: imagesPerCall,
          tokenType: options.tokenType || 'spark',
          waitForCompletion: false,
          sizePreset: 'custom',
          width: options.width,
          height: options.height,
          guidance,
          disableNSFWFilter: options.noFilter === true
        };
        if (options.outputFormat) {
          projectConfig.outputFormat = options.outputFormat;
        }
        if (gptImageQuality) {
          projectConfig.gptImageQuality = gptImageQuality;
        }
        if (options.sampler) {
          projectConfig.sampler = options.sampler;
        }
        if (options.scheduler) {
          projectConfig.scheduler = options.scheduler;
        }
        if (steps) {
          projectConfig.steps = steps;
        }

        if (options.seed !== null && options.seed !== undefined) {
          projectConfig.seed = options.seed;
        }

        const imageResult = await client.createImageProject(projectConfig);
        if (imageResult?.error || imageResult?.message) {
          throw buildProjectResultError(imageResult);
        }
      }
    }
    
    // Wait for completion via events
    await completionPromise;
    
    if (results.length > 0) {
      const urls = results.map(r => r.resultUrl).filter(Boolean);
      const firstResult = results[0];
      
      // Save last render info
      const seeds = results.map(r => r.seed ?? options.seed);
      const renderInfo = {
        timestamp: new Date().toISOString(),
        type: options.music ? 'music' : options.video ? 'video' : 'image',
        prompt: options.prompt,
        model: options.model,
        width: options.music ? null : options.width,
        height: options.music ? null : options.height,
        seed: firstResult.seed ?? options.seed,
        seedStrategy: options.seedStrategy || null,
        seeds,
        projectId: firstResult.projectId,
        urls: urls,
        localPath: options.output || null,
        tokenType: options.tokenType || 'spark',
        quality: options.quality || null
      };
      if (options.outputFormat) {
        renderInfo.outputFormat = options.outputFormat;
      }
      if (options.sampler) {
        renderInfo.sampler = options.sampler;
      }
      if (options.scheduler) {
        renderInfo.scheduler = options.scheduler;
      }
      if (options.loras.length > 0) {
        renderInfo.loras = options.loras;
      }
      if (options.loraStrengths.length > 0) {
        renderInfo.loraStrengths = options.loraStrengths;
      }
      if (options.music) {
        renderInfo.duration = options.duration;
        renderInfo.bpm = options.musicBpm ?? null;
        renderInfo.keyscale = options.musicKeyscale || null;
        renderInfo.timesignature = options.musicTimesig || null;
        renderInfo.language = options.musicLanguage || null;
        renderInfo.composerMode = options.musicComposerMode;
        if (options.musicPromptStrength !== null && options.musicPromptStrength !== undefined) {
          renderInfo.promptStrength = options.musicPromptStrength;
        }
        if (options.musicCreativity !== null && options.musicCreativity !== undefined) {
          renderInfo.creativity = options.musicCreativity;
        }
        if (options.musicShift !== null && options.musicShift !== undefined) {
          renderInfo.shift = options.musicShift;
        }
      }
      if (options.video) {
        renderInfo.workflow = options.videoWorkflow;
        renderInfo.fps = options.fps;
        renderInfo.duration = options.frames ? options.frames / options.fps : options.duration;
        if (options.frames) renderInfo.frames = options.frames;
        if (options.targetResolution) renderInfo.targetResolution = options.targetResolution;
        if (options.autoResizeVideoAssets !== null) {
          renderInfo.autoResizeVideoAssets = options.autoResizeVideoAssets;
        }
        renderInfo.refImage = options.refImage;
        renderInfo.refImageEnd = options.refImageEnd;
        if (options.refAudio) {
          renderInfo.refAudio = options.refAudio;
          if (options.audioStart !== null) renderInfo.audioStart = options.audioStart;
          if (options.audioDuration !== null) renderInfo.audioDuration = options.audioDuration;
        }
        if (options.referenceAudioIdentity) {
          renderInfo.referenceAudioIdentity = options.referenceAudioIdentity;
          if (options._voicePersonaResolvedName || options.voicePersonaName) {
            renderInfo.voicePersonaName = options._voicePersonaResolvedName || options.voicePersonaName;
          }
        }
        if (options.refVideo) {
          renderInfo.refVideo = options.refVideo;
          if (options.videoStart !== null) renderInfo.videoStart = options.videoStart;
        }
        if (options.videoControlNetName && !isSeedanceModel(options.model)) {
          renderInfo.controlNet = {
            name: options.videoControlNetName,
            strength: resolveVideoControlNetStrength(options.videoControlNetName, options.videoControlNetStrength)
          };
        }
        if (options.sam2Coordinates) renderInfo.sam2Coordinates = options.sam2Coordinates;
        if (options.trimEndFrame) renderInfo.trimEndFrame = true;
        if (options.firstFrameStrength != null) renderInfo.firstFrameStrength = options.firstFrameStrength;
        if (options.lastFrameStrength != null) renderInfo.lastFrameStrength = options.lastFrameStrength;
      }
      if (options.contextImages.length > 0) {
        renderInfo.contextImages = options.contextImages;
      }
      if (options.photobooth) {
        renderInfo.photobooth = true;
        renderInfo.refImage = options.refImage;
      }
      saveLastRender(renderInfo);
      
      // Save to file if requested
      if (options.output && urls[0]) {
        const response = await fetchWithTimeout(urls[0]);
        const buffer = Buffer.from(await response.arrayBuffer());

        const dir = dirname(options.output);
        if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });

        // Handle looping for i2v workflow
        if (options.looping && options.videoWorkflow === 'i2v' && options.refImage) {
          log('Creating looping video (A→B→A)...');

          // Save first clip temporarily
          const tempDir = createTrackedTempDir('sogni-loop-');
          const clip1Path = join(tempDir, 'clip1.mp4');
          const lastFramePath = join(tempDir, 'last-frame.png');
          const clip2Path = join(tempDir, 'clip2.mp4');

          writeFileSync(clip1Path, buffer);
          log('Extracting last frame...');
          await extractLastFrameFromVideo(clip1Path, lastFramePath);

          // Generate second clip (last frame → original image)
          log('Generating return clip (B→A)...');

          // Get model defaults for steps and guidance
          const modelDefaults2 = getModelDefaults(options.model, openclawConfig);
          const steps2 = resolveVideoSteps(options.model, modelDefaults2, options.steps);
          const guidance2 = options.guidance ?? modelDefaults2?.guidance;

          const projectConfig2 = {
            modelId: options.model,
            positivePrompt: options.prompt,
            negativePrompt: '',
            stylePrompt: '',
            numberOfMedia: 1,
            referenceImage: readFileSync(lastFramePath),
            referenceImageEnd: loopingStartImageBuffer,
            fps: options.fps,
            width: options.width,
            height: options.height,
            tokenType: options.tokenType || 'spark',
            waitForCompletion: false,
            disableNSFWFilter: options.noFilter === true
          };

          if (options.frames) projectConfig2.frames = options.frames;
          else if (options.duration) projectConfig2.duration = options.duration;
          if (Number.isFinite(steps2)) projectConfig2.steps = steps2;
          if (guidance2 !== null && guidance2 !== undefined) projectConfig2.guidance = guidance2;

          // Create a new client for second clip to avoid event conflicts
          const creds = loadCredentials();
          const client2 = new SogniClientWrapper({
            appSource: SOGNI_APP_SOURCE,
            network: openclawConfig?.defaultNetwork || 'fast',
            autoConnect: false,
            apiKey: creds.SOGNI_API_KEY,
            authType: 'apiKey'
          });
          await connectSogniClient(client2);
          await disableLiveModelAvailabilityEvents(client2);

          // Create second clip and wait for completion via events
          const clip2Promise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Second clip generation timed out'));
            }, options.timeout);

            client2.on(ClientEvent.JOB_COMPLETED, async (data) => {
              try {
                clearTimeout(timeout);
                const clip2Url = data.resultUrl || data.videoUrl;
                if (!clip2Url) {
                  reject(new Error('No video URL returned for second clip.'));
                  return;
                }

                // Download second clip
                const response2 = await fetchWithTimeout(clip2Url);
                const buffer2 = Buffer.from(await response2.arrayBuffer());
                writeFileSync(clip2Path, buffer2);

                await client2.disconnect();
                resolve();
              } catch (err) {
                clearTimeout(timeout);
                reject(err);
              }
            });

            client2.on(ClientEvent.JOB_FAILED, (data) => {
              clearTimeout(timeout);
              reject(new Error(data.error || 'Second clip generation failed'));
            });

            client2.on(ClientEvent.PROJECT_FAILED, (data) => {
              clearTimeout(timeout);
              reject(new Error(data?.message || 'Second clip project failed'));
            });

            // Show progress for second clip
            client2.on(ClientEvent.PROJECT_PROGRESS, (data) => {
              if (data.percentage && data.percentage > 0) {
                log(`Progress: ${Math.round(data.percentage)}%`);
              }
            });
          });

          const clip2Result = await client2.createVideoProject(projectConfig2);

          // Check for errors in the response (e.g., insufficient tokens)
          if (clip2Result?.error || clip2Result?.message) {
            throw buildProjectResultError(clip2Result);
          }

          await clip2Promise;

          log('Concatenating clips...');
          await buildConcatVideoFromClips(options.output, [clip1Path, clip2Path]);
          log(`Saved looping video to ${options.output}`);
        } else {
          writeOutputFileSafe(options.output, buffer, options.video ? 'video' : options.music ? 'audio' : 'image');
          log(`Saved to ${options.output}`);
        }
      }
      
      // Output result
      if (options.json) {
        const output = {
          success: true,
          type: options.music ? 'music' : options.video ? 'video' : 'image',
          prompt: options.prompt,
          model: options.model,
          width: options.music ? null : options.width,
          height: options.music ? null : options.height,
          seed: firstResult.seed ?? options.seed,
          seedStrategy: options.seedStrategy || null,
          seeds,
          urls: urls,
          localPath: options.output || null,
          tokenType: options.tokenType || 'spark'
        };
        if (options.outputFormat) {
          output.outputFormat = options.outputFormat;
        }
        if (options.sampler) {
          output.sampler = options.sampler;
        }
        if (options.scheduler) {
          output.scheduler = options.scheduler;
        }
        if (options.loras.length > 0) {
          output.loras = options.loras;
        }
        if (options.loraStrengths.length > 0) {
          output.loraStrengths = options.loraStrengths;
        }
        if (options.music) {
          output.duration = options.duration;
          output.bpm = options.musicBpm ?? null;
          output.keyscale = options.musicKeyscale || null;
          output.timesignature = options.musicTimesig || null;
          output.language = options.musicLanguage || null;
          output.composerMode = options.musicComposerMode;
          if (options.musicPromptStrength !== null && options.musicPromptStrength !== undefined) {
            output.promptStrength = options.musicPromptStrength;
          }
          if (options.musicCreativity !== null && options.musicCreativity !== undefined) {
            output.creativity = options.musicCreativity;
          }
          if (options.musicShift !== null && options.musicShift !== undefined) {
            output.shift = options.musicShift;
          }
        }
        if (options.video) {
          output.workflow = options.videoWorkflow;
          output.fps = options.fps;
          output.duration = options.frames ? options.frames / options.fps : options.duration;
          if (options.frames) output.frames = options.frames;
          if (options.targetResolution) output.targetResolution = options.targetResolution;
          output.strictSize = options.strictSize || false;
          if (options.autoResizeVideoAssets !== null) {
            output.autoResizeVideoAssets = options.autoResizeVideoAssets;
          }
          if (options.refImage) output.refImage = options.refImage;
          if (options.refImageEnd) output.refImageEnd = options.refImageEnd;
          if (options.refAudio) {
            output.refAudio = options.refAudio;
            if (options.audioStart !== null) output.audioStart = options.audioStart;
            if (options.audioDuration !== null) output.audioDuration = options.audioDuration;
          }
          if (options.referenceAudioIdentity) {
            output.referenceAudioIdentity = options.referenceAudioIdentity;
            if (options._voicePersonaResolvedName || options.voicePersonaName) {
              output.voicePersonaName = options._voicePersonaResolvedName || options.voicePersonaName;
            }
          }
          if (options.refVideo) {
            output.refVideo = options.refVideo;
            if (options.videoStart !== null) output.videoStart = options.videoStart;
          }
          if (options.videoControlNetName && !isSeedanceModel(options.model)) {
            output.controlNet = {
              name: options.videoControlNetName,
              strength: resolveVideoControlNetStrength(options.videoControlNetName, options.videoControlNetStrength)
            };
          }
          if (options.sam2Coordinates) output.sam2Coordinates = options.sam2Coordinates;
          if (options.trimEndFrame) output.trimEndFrame = true;
          if (options.firstFrameStrength != null) output.firstFrameStrength = options.firstFrameStrength;
          if (options.lastFrameStrength != null) output.lastFrameStrength = options.lastFrameStrength;
          if (options._effectiveVideoDims?.width && options._effectiveVideoDims?.height) {
            output.effectiveWidth = options._effectiveVideoDims.width;
            output.effectiveHeight = options._effectiveVideoDims.height;
            output.effectiveFromReference = {
              width: options._effectiveVideoDims.refWidth,
              height: options._effectiveVideoDims.refHeight
            };
          }
          if (options._adjustedVideoDims) {
            output.adjustedVideoDims = options._adjustedVideoDims;
          }
        }
        if (options.contextImages.length > 0) {
          output.contextImages = options.contextImages;
        }
        if (options.photobooth) {
          output.photobooth = true;
          output.refImage = options.refImage;
          output.controlNet = {
            name: 'instantid',
            strength: options.cnStrength ?? 0.7,
            guidanceEnd: options.cnGuidanceEnd ?? 0.6,
          };
        }
        console.log(JSON.stringify(output));
      } else {
        urls.forEach(url => console.log(url));
      }
    } else {
      throw new Error('No output generated - may have been filtered');
    }
    
  } catch (error) {
    // Token auto-fallback: if using auto mode and got insufficient balance, retry with the other token
    const isBalanceError = isStructuredInsufficientBalanceError(error);
    if (_allowAutoTokenFallback && isBalanceError && options.tokenType === 'spark') {
      log('Insufficient SPARK balance — retrying with SOGNI tokens...');
      options.tokenType = 'sogni';
      try {
        if (client?.isConnected?.()) {
          await Promise.race([client.disconnect(), new Promise(r => setTimeout(r, 1000))]);
        }
      } catch (_) {}
      return main();
    }

    if (isInvalidApiKeyError(error)) {
      if (!error.hint) error.hint = INVALID_API_KEY_HINT;
      if (!error.code) error.code = 'INVALID_API_KEY';
    }

    exitCode = 1;
    const shouldJson = options.json || IS_OPENCLAW_INVOCATION;
    if (shouldJson) {
      const payload = addCanonicalErrorFields({
        success: false,
        error: error.message,
        prompt: options.prompt ?? null
      }, error);
      if (error.code) payload.errorCode = error.code;
      if (error.details) payload.errorDetails = error.details;
      // Don't let a stale per-error hint overwrite the canonical
      // "Buy Spark Packs" hint that addCanonicalErrorFields already
      // stamped via the insufficient_credits enrichment branch.
      if (error.hint && !payload.purchaseAction) payload.hint = error.hint;
      payload.timestamp = new Date().toISOString();
      payload.node = process.versions.node;
      payload.cwd = process.cwd();
      payload.context = {
        video: options.video || false,
        workflow: options.video ? (options.videoWorkflow || null) : null,
        model: options.model || null,
        width: Number.isFinite(options.width) ? options.width : null,
        height: Number.isFinite(options.height) ? options.height : null,
        strictSize: options.video ? (options.strictSize || false) : null,
        count: Number.isFinite(options.count) ? options.count : null,
        tokenType: options.tokenType || 'spark',
        fps: options.video ? options.fps : null,
        duration: options.video ? (options.frames ? options.frames / options.fps : options.duration) : null,
        frames: options.video ? (options.frames ?? null) : null,
        autoResizeVideoAssets: options.video ? (options.autoResizeVideoAssets ?? null) : null,
        refImage: options.video ? (options.refImage ?? null) : null,
        refImageEnd: options.video ? (options.refImageEnd ?? null) : null,
        refAudio: options.video ? (options.refAudio ?? null) : null,
        referenceAudioIdentity: options.video ? (options.referenceAudioIdentity ?? null) : null,
        refVideo: options.video ? (options.refVideo ?? null) : null,
        effectiveWidth: options.video ? (options._effectiveVideoDims?.width ?? null) : null,
        effectiveHeight: options.video ? (options._effectiveVideoDims?.height ?? null) : null,
        adjustedVideoDims: options.video ? (options._adjustedVideoDims ?? null) : null
      };
      if (IS_OPENCLAW_INVOCATION) payload.openclaw = true;
      console.log(JSON.stringify(payload));
      if (!options.json) {
        printHumanError(error);
      }
    } else {
      printHumanError(error);
    }
  } finally {
    try {
      if (client?.isConnected?.()) {
        await Promise.race([
          client.disconnect(),
          new Promise(resolve => setTimeout(resolve, 1000))
        ]);
      }
    } catch (e) {}
  }
  process.exit(exitCode);
}

main().then(
  () => process.exit(0),
  (error) => reportFatalError(error)
);
