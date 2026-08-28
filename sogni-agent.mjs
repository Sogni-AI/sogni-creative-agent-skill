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
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, statSync, readdirSync, realpathSync, lstatSync, unlinkSync, rmdirSync, rmSync, renameSync } from 'fs';
import { join, dirname, basename, extname, sep, resolve } from 'path';
import { homedir, tmpdir } from 'os';
import sharp from 'sharp';
import { getEnv, hasEnv } from './env.mjs';
import { getOrCreateSogniAppId } from './sogni-app-id.mjs';
import { PACKAGE_VERSION } from './version.mjs';
import {
  SOGNI_APP_SOURCE,
  attributionHeaders,
  clientAttribution,
  createInvocationLineage,
  resolveAgentAttribution,
  semanticWorkloadAttribution,
} from './attribution.mjs';
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
  getModelDefaults as getSharedModelDefaults,
  getVideoPromptGuardrailPlan,
  inferVideoWorkflowFromAssets,
  inferVideoWorkflowFromModel,
  isHappyHorseModel,
  isHappyHorseModelSelection,
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
  buildImageEditExecutionControls,
  isKreaIdentityEditModel,
  SEEDANCE_R2V_REFERENCE_AUDIO_MAX_DURATION_SECONDS,
  prepareSeedanceV2VSourceVideo as prepareSharedSeedanceV2VSourceVideo
} from '@sogni-ai/sogni-intelligence-client/media';
import {
  HAPPYHORSE_REFERENCE_LIMITS,
  HappyHorseReferenceLimitError,
  SeedanceReferenceLimitError,
  getHappyHorseReferenceLimits,
  getSeedanceReferenceLimits,
  happyhorseTerminalGenerationFailurePayloadFromError,
  happyhorseTerminalPolicyPayloadFromError,
  seedanceTerminalGenerationFailurePayloadFromError,
  seedanceTerminalPolicyPayloadFromError,
  validateHappyHorseReferenceCounts,
  validateSeedanceReferenceCounts
} from '@sogni-ai/sogni-intelligence-client/tools';

const SPARK_PACKS_PURCHASE_URL = 'https://docs.sogni.ai/pricing/#spark-packs';
const SPARK_PACKS_PURCHASE_HINT = `Buy Spark Packs to continue: ${SPARK_PACKS_PURCHASE_URL}`;

const UNLIMITED_PLAN_URL = 'https://docs.sogni.ai/pricing/unlimited-plan-details';
const SOGNI_MODEL_CATALOG_MAX_BYTES = 5 * 1024 * 1024;
const SOGNI_MODEL_CATALOG_TIMEOUT_MS = 10000;
const KNOWN_MODEL_CATALOG_TAGS = new Set([
  'spicy',
  'uncensored',
  'community',
  'new',
  'popular',
  'fast',
  'free-tier',
  'standard',
  'premium'
]);

// Skill-local fallback guidance for Sogni Unlimited subscription billing errors,
// keyed on the canonical socket error code (a structured fact, not an English
// message). Mirrors the `insufficient_credits` enrichment below: it adds an
// actionable hint/category so an agent responds correctly instead of looping a
// covered job that cannot bill. Codes are the source of truth in
// sogni-socket/constants/errorCodes.js (4078-4081).
const SUBSCRIPTION_BILLING_ERROR_CODES = new Set(['4078', '4079', '4080', '4081']);
const APP_ID_LIMIT_ERROR_CODE = '4061';
const APP_ID_LIMIT_HINT =
  'This CLI persists and reuses one installation app ID. Keep ~/.config/sogni/app-id between sessions; for ephemeral/container homes, set one stable SOGNI_APP_ID or persist SOGNI_APP_ID_PATH. If the address is already blocked, preserve the stable ID and wait before retrying.';

function subscriptionBillingFallback(code) {
  if (code === undefined || code === null) return null;
  const key = String(code);
  if (!SUBSCRIPTION_BILLING_ERROR_CODES.has(key)) return null;
  switch (key) {
    case '4078':
      // Vendor model the subscription never covers, or no verified entitlement.
      return {
        retryable: false,
        hint: 'This generation is not covered by Sogni Unlimited. Vendor models (GPT Image 2, Seedance, HappyHorse) always require Premium Spark; otherwise reconnect and try again. ' + SPARK_PACKS_PURCHASE_HINT,
        purchaseLabel: 'Get Premium Spark',
        purchaseUrl: SPARK_PACKS_PURCHASE_URL,
      };
    case '4079':
      // Per-plan queued-job ceiling reached.
      return {
        retryable: true,
        hint: 'Unlimited plan: maximum queued jobs reached. Wait for queued jobs to finish before submitting more.',
      };
    case '4080':
      // Renewal payment retry — Unlimited access paused. Do NOT auto-retry the
      // covered job; it will keep failing until billing recovers.
      return {
        retryable: false,
        hint: 'Unlimited renewal payment is being retried and access is paused. Render now with Spark or SOGNI (--token-type spark|sogni); Unlimited resumes automatically once the renewal succeeds. Do not auto-retry the covered job.',
      };
    case '4081':
      // Feature requires a higher subscription tier.
      return {
        retryable: false,
        hint: `This feature requires a higher subscription plan. Upgrade to Unlimited Pro: ${UNLIMITED_PLAN_URL}`,
        purchaseLabel: 'Upgrade to Unlimited Pro',
        purchaseUrl: UNLIMITED_PLAN_URL,
      };
    default:
      return null;
  }
}

// Apply subscription-billing fallback enrichment to an error payload. Returns
// true when the code matched (so callers skip the generic insufficient_credits
// branch — subscription denials get subscription-specific guidance, never a bare
// "Buy Spark Packs"). Extracts the code from the canonical shapes the SDK and
// socket surface it in.
function applySubscriptionBillingEnrichment(payload, code) {
  const fallback = subscriptionBillingFallback(code);
  if (!fallback) return false;
  payload.errorCode = String(code);
  payload.errorCategory = 'subscription_billing';
  payload.retryable = fallback.retryable;
  if (!payload.hint) payload.hint = fallback.hint;
  if (fallback.purchaseUrl) {
    payload.purchaseAction = true;
    payload.purchaseLabel = fallback.purchaseLabel;
    payload.purchaseUrl = fallback.purchaseUrl;
    payload.purchaseReason = fallback.hint;
  }
  return true;
}

function subscriptionBillingCodeFromError(error) {
  if (!error || typeof error !== 'object') return undefined;
  const record = error;
  return record.code
    ?? record.errorCode
    ?? record.error_code
    ?? record.payload?.errorCode
    ?? record.payload?.error_code;
}

function isAppIdLimitError(error) {
  if (!error) return false;
  const code = error.code
    ?? error.errorCode
    ?? error.error_code
    ?? error.payload?.errorCode
    ?? error.payload?.error_code;
  if (String(code) === APP_ID_LIMIT_ERROR_CODE) return true;
  const message = `${error.message || ''} ${error.reason || ''} ${error.payload?.message || ''}`.toLowerCase();
  return message.includes('too many app-ids') || message.includes('too many app ids');
}

function enrichAppIdLimitError(error) {
  if (!isAppIdLimitError(error)) return;
  error.code = APP_ID_LIMIT_ERROR_CODE;
  if (!error.hint) error.hint = APP_ID_LIMIT_HINT;
}

const require = createRequire(import.meta.url);
const rootClientModule = process.env.SOGNI_AGENT_TEST_STATE_PATH
  ? await import('@sogni-ai/sogni-intelligence-client')
  : require('@sogni-ai/sogni-intelligence-client');
const {
  SogniClientWrapper,
  ClientEvent,
  // Re-exported from @sogni-ai/sogni-client. Used for public REST catalog reads
  // (`projects.availableLoras`) that need neither a socket nor credentials.
  SogniClient,
  getMaxContextImages: getWrapperMaxContextImages,
  parseCreativeWorkflowSseChunk,
  // Model-aware wrapper dimension rules (intelligence-client > 3.15.1). On
  // older pinned clients this is undefined and the CLI falls back to the
  // historical mirror constants below.
  getVideoDimensionRules: getWrapperVideoDimensionRules
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
const DEFAULT_MODEL_CATALOG_CACHE_PATH = join(homedir(), '.config', 'sogni', 'model-catalog-cache.json');
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
const OPENCLAW_CONFIG_PATH = getEnv('OPENCLAW_CONFIG_PATH') || DEFAULT_OPENCLAW_CONFIG_PATH;
const IS_OPENCLAW_INVOCATION = Boolean(getEnv('OPENCLAW_PLUGIN_CONFIG'));
const AGENT_ATTRIBUTION = resolveAgentAttribution({ surfaceVersion: PACKAGE_VERSION });
const INVOCATION_LINEAGE = createInvocationLineage();
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
  turbo: 'ace_step_1.5_xl_turbo',
  speed: 'ace_step_1.5_xl_turbo',
  fast: 'ace_step_1.5_xl_turbo',
  sft: 'ace_step_1.5_xl_sft',
  lyrics: 'ace_step_1.5_xl_sft',
  lyric: 'ace_step_1.5_xl_sft'
};
const MUSIC_MODEL_DEFAULTS = {
  'ace_step_1.5_xl_turbo': {
    steps: { min: 4, max: 16, default: 8 },
    shift: { min: 1, max: 6, default: 3 },
    sampler: { allowed: ['euler', 'euler_ancestral'], default: 'euler' },
    scheduler: { allowed: ['simple'], default: 'simple' }
  },
  'ace_step_1.5_xl_sft': {
    steps: { min: 10, max: 100, default: 50 },
    guidance: { min: 1, max: 15, default: 5 },
    shift: { min: 1, max: 6, default: 3 },
    sampler: { allowed: ['euler', 'euler_ancestral', 'er_sde'], default: 'er_sde' },
    scheduler: { allowed: ['simple', 'linear_quadratic'], default: 'linear_quadratic' }
  },
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
const DEFAULT_MODEL_CATALOG_URL = 'https://api.sogni.ai/v1/model-catalog';
const MODEL_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let liveModelDefaults = null;

function getModelDefaults(modelId, config) {
  const sharedDefaults = getSharedModelDefaults(modelId, config);
  const catalogDefaults = liveModelDefaults?.[modelId];
  const configuredDefaults = config?.modelDefaults?.[modelId];
  const fixedDefaults = modelId === LTX23_10EROS_MODEL_ID
    ? LTX23_10EROS_FIXED_SETTINGS
    : null;
  if (!catalogDefaults && !configuredDefaults && !fixedDefaults) return sharedDefaults;
  // The live catalog supersedes bundled registry data. Explicit user config
  // remains the final override except where a workflow has immutable settings.
  return {
    ...(sharedDefaults || {}),
    ...(catalogDefaults || {}),
    ...(configuredDefaults || {}),
    ...(fixedDefaults || {})
  };
}

function defaultsFromModelTier(card) {
  const defaults = {};
  if (Number.isFinite(card?.steps?.default)) defaults.steps = card.steps.default;
  if (Number.isFinite(card?.guidance?.default)) defaults.guidance = card.guidance.default;
  if (card?.comfySampler?.default) defaults.sampler = card.comfySampler.default;
  if (card?.comfyScheduler?.default) defaults.scheduler = card.comfyScheduler.default;
  if (Number.isFinite(card?.width?.default)) defaults.defaultWidth = card.width.default;
  if (Number.isFinite(card?.height?.default)) defaults.defaultHeight = card.height.default;
  if (Number.isFinite(card?.width?.min)) defaults.minDimension = card.width.min;
  if (Number.isFinite(card?.width?.max)) defaults.maxDimension = card.width.max;
  if (Number.isFinite(card?.width?.step)) defaults.dimensionMultiple = card.width.step;
  const defaultSize = String(card?.defaultSize || '').match(/^(\d+)x(\d+)$/i);
  if (defaultSize) {
    defaults.defaultWidth = Number(defaultSize[1]);
    defaults.defaultHeight = Number(defaultSize[2]);
  }
  return defaults;
}

function validateModelTierSelections(modelId, card) {
  const validateRange = (source, value, range) => {
    if (value === null || value === undefined || !range) return;
    if (
      (Number.isFinite(range.min) && value < range.min) ||
      (Number.isFinite(range.max) && value > range.max)
    ) {
      const error = new Error(
        `${source} ${value} is outside the live catalog range for "${modelId}" ` +
        `(${range.min}–${range.max}).`
      );
      error.code = 'INVALID_MODEL_PARAMETER';
      error.hint = `Use a value between ${range.min} and ${range.max}. Catalog: ${MODEL_CATALOG_URL}`;
      throw error;
    }
  };
  validateRange('--steps', options.steps, card.steps);
  validateRange('--guidance', options.guidance, card.guidance);
  const configuredDefaults = openclawConfig?.modelDefaults?.[modelId];
  validateRange('Configured steps', configuredDefaults?.steps, card.steps);
  validateRange('Configured guidance', configuredDefaults?.guidance, card.guidance);
}

function persistModelCatalogCache(catalog, cachePath = MODEL_CATALOG_CACHE_PATH) {
  const tempPath = `${cachePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(tempPath, JSON.stringify(catalog), { mode: 0o600 });
    renameSync(tempPath, cachePath);
  } catch (error) {
    if (!options.quiet) {
      console.error(`Warning: could not persist model catalog cache (${error?.message || error}).`);
    }
  } finally {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Cache cleanup is best-effort and must never block generation.
    }
  }
}

async function loadLiveModelDefaults(modelId) {
  // Existing CLI tests mock the SDK rather than the public catalog API.
  // A supplied JSON fixture opts a test into exercising this lookup.
  const testFixture = getEnv('SOGNI_AGENT_TEST_MODEL_TIERS_JSON');
  let cachedCatalog = null;
  try {
    if (existsSync(MODEL_CATALOG_CACHE_PATH)) {
      const cached = JSON.parse(readFileSync(MODEL_CATALOG_CACHE_PATH, 'utf8'));
      const cacheAge = Date.now() - cached?.fetchedAt;
      if (
        Number.isFinite(cached?.fetchedAt) &&
        cacheAge >= 0 &&
        cached?.modelId === modelId &&
        cached?.descriptor?.parameters &&
        typeof cached.descriptor.parameters === 'object'
      ) {
        cachedCatalog = cached;
        if (cacheAge < MODEL_CATALOG_CACHE_TTL_MS) {
          const card = cached.descriptor.parameters;
          validateModelTierSelections(modelId, card);
          liveModelDefaults = { [modelId]: defaultsFromModelTier(card) };
          return;
        }
      }
    }
  } catch {
    // A corrupt cache is treated as a miss and replaced by the live response.
  }

  if (
    !testFixture &&
    getEnv('SOGNI_AGENT_TEST_STATE_PATH') &&
    !getEnv('SOGNI_MODEL_CATALOG_URL')
  ) return;

  let catalog;
  try {
    if (testFixture) {
      const fixture = JSON.parse(testFixture);
      const descriptor = fixture?.data?.model || fixture?.model || (() => {
        const model = fixture?.models?.find?.((entry) => entry?.id === modelId);
        const tierId = model?.tier || modelId;
        const parameters = fixture?.tiers?.[tierId] || (!fixture?.tiers ? fixture?.[tierId] : null);
        return parameters ? { id: modelId, parameters } : null;
      })();
      catalog = { fetchedAt: Date.now(), modelId, etag: null, descriptor };
    } else {
      const url = `${MODEL_CATALOG_URL}/${encodeURIComponent(modelId)}`;
      const headers = { accept: 'application/json' };
      if (cachedCatalog?.etag) headers['if-none-match'] = cachedCatalog.etag;
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000)
      });
      if (response.status === 304 && cachedCatalog) {
        catalog = { ...cachedCatalog, fetchedAt: Date.now() };
      } else {
        if (response.status === 404) {
          const error = new Error(`Model "${modelId}" is not present in the live Sogni model catalog.`);
          error.code = 'MODEL_NOT_FOUND';
          error.hint = `Choose a model currently listed by ${MODEL_CATALOG_URL}`;
          throw error;
        }
        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
        const payload = await response.json();
        catalog = {
          fetchedAt: Date.now(),
          modelId,
          etag: response.headers.get('etag'),
          descriptor: payload?.data?.model
        };
      }
    }
    persistModelCatalogCache(catalog);
  } catch (cause) {
    if (cause?.code === 'MODEL_NOT_FOUND') throw cause;
    const error = new Error(`Could not load the live Sogni model catalog (${cause?.message || cause}).`);
    error.code = 'MODEL_CATALOG_UNAVAILABLE';
    error.hint = `Check Sogni platform status and retry. Catalog: ${MODEL_CATALOG_URL}`;
    throw error;
  }

  const card = catalog?.descriptor?.parameters;
  if (!card || typeof card !== 'object') {
    const error = new Error(`Model "${modelId}" is not present in the live Sogni model catalog.`);
    error.code = 'MODEL_NOT_FOUND';
    error.hint = `Choose a model currently listed by ${MODEL_CATALOG_URL}`;
    throw error;
  }
  validateModelTierSelections(modelId, card);
  liveModelDefaults = { [modelId]: defaultsFromModelTier(card) };
}

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
  if (applySubscriptionBillingEnrichment(payload, code)) {
    // Subscription-billing code (4078-4081) — handled with subscription-specific
    // guidance; skip the generic "Buy Spark Packs" credits branch.
  } else if (classified.category === 'insufficient_credits') {
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

function unwrapGenericProjectError(error) {
  let current = error;
  const seen = new Set();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const message = typeof current.message === 'string' ? current.message.trim() : '';
    if (message !== 'Project creation failed') break;
    const next = current.originalError || current.cause;
    if (!next) break;
    current = next;
  }
  return current;
}

function cliErrorMessage(error) {
  error = unwrapGenericProjectError(error);
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

// Classify a HappyHorse terminal policy / generation-failure error into the
// canonical CLI error shape, or null when neither HappyHorse matcher applies.
// Factored out so it can run either AFTER the Seedance matchers (default order)
// or BEFORE them when the failing model is known to be HappyHorse (see
// classifyCliError).
function classifyHappyHorseCliError(error, rawMessage) {
  const happyhorsePolicyPayload = happyhorseTerminalPolicyPayloadFromError(error);
  if (happyhorsePolicyPayload) {
    return {
      error_type: 'SAFETY_REJECTED',
      category: 'content_refused',
      message: happyhorsePolicyPayload.message,
      retryable: false,
      metadata: happyhorsePolicyPayload,
      technicalError: rawMessage
    };
  }

  const happyhorseGenerationPayload = happyhorseTerminalGenerationFailurePayloadFromError(error);
  if (happyhorseGenerationPayload) {
    const vendorCode = happyhorseGenerationPayload.vendorErrorCode;
    const isInvalidParameter = vendorCode === 'InvalidParameter' ||
      happyhorseGenerationPayload.error === 'happyhorse_input_download_failed';
    return {
      error_type: isInvalidParameter ? 'PARAMETER_INVALID' : 'GPU_WORKER_FAILED',
      category: isInvalidParameter ? 'schema_validation' : 'transient_failure',
      message: happyhorseGenerationPayload.message || 'HappyHorse could not complete this video.',
      retryable: !isInvalidParameter,
      metadata: happyhorseGenerationPayload,
      technicalError: rawMessage
    };
  }

  return null;
}

function classifyCliError(error, context = {}) {
  error = unwrapGenericProjectError(error);
  const rawMessage = cliErrorMessage(error);

  // Client-side CLI rejections are the plain `{ message, code }` shape built by
  // buildCliErrorPayload (never an Error instance and never a vendor poll body).
  // They are argument-validation failures, so skip the HappyHorse terminal
  // matchers — the HappyHorse generation matcher keys off a bare "happyhorse"
  // mention and would otherwise re-wrap a validation message (e.g. "HappyHorse
  // models do not support ControlNet") as a retryable vendor generation failure.
  const isClientSideCliPayload = error
    && typeof error === 'object'
    && !(error instanceof Error)
    && typeof error.message === 'string'
    && !('output' in error)
    && !('vendorError' in error)
    && !('vendorErrorCode' in error);

  // When the failing model is HappyHorse, run the HappyHorse matchers BEFORE the
  // generic Seedance generation matcher. That matcher keys off vendor-agnostic
  // socket failure text ("All N video generation jobs failed", "Vendor task ...
  // status=failed", "Vendor job failed"), which a HappyHorse failure also
  // produces, so without this model-aware reordering a HappyHorse vendor failure
  // would be misattributed to Seedance. The client-side-payload guard still
  // applies so a CLI validation message that merely names HappyHorse is not
  // re-wrapped as a retryable vendor failure.
  const modelHint = context?.modelId;
  const preferHappyHorse = isHappyHorseModel(modelHint) || isHappyHorseModelSelectionLocal(modelHint);
  if (preferHappyHorse && !isClientSideCliPayload) {
    const happyhorseClassified = classifyHappyHorseCliError(error, rawMessage);
    if (happyhorseClassified) return happyhorseClassified;
  }

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

  // Default order: when the model is not known to be HappyHorse, run the
  // HappyHorse matchers after the Seedance matchers (preferHappyHorse already
  // ran them above when the model hint matched).
  if (!preferHappyHorse && !isClientSideCliPayload) {
    const happyhorseClassified = classifyHappyHorseCliError(error, rawMessage);
    if (happyhorseClassified) return happyhorseClassified;
  }

  return classifySkillError(error);
}

function addCanonicalErrorFields(payload, error, context = {}) {
  const classified = classifyCliError(error, context);
  payload.error = classified.message;
  payload.errorType = classified.error_type;
  payload.errorCategory = classified.category;
  payload.retryable = classified.retryable;
  if (classified.metadata) payload.metadata = classified.metadata;
  if (classified.technicalError && classified.technicalError !== classified.message) {
    payload.technicalError = classified.technicalError;
  }
  const subscriptionCode = subscriptionBillingCodeFromError(error);
  if (applySubscriptionBillingEnrichment(payload, subscriptionCode)) {
    // Subscription-billing code (4078-4081) — handled with subscription-specific
    // guidance; skip the generic "Buy Spark Packs" credits branch.
  } else if (classified.category === 'insufficient_credits') {
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
function printHumanError(error, context = {}) {
  let classified = null;
  try { classified = classifyCliError(error, context); } catch { /* fall back to raw */ }
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
  enrichAppIdLimitError(error);
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
    enrichAppIdLimitError(error);
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
  if (options.apiExpandPrompt === false) {
    options._literalPrompt = true;
    return;
  }

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
const RTX_VSR_MODEL_ID = 'rtx_vsr_pro';
const RTX_VSR_MIN_DIMENSION = 512;
const RTX_VSR_MAX_DIMENSION = 15360;
const RTX_VSR_DIMENSION_STEP = 8;
const RTX_VSR_JPG_THRESHOLD_EDGE = 7680;

function alignRtxVsrDimension(value) {
  return Math.floor(value / RTX_VSR_DIMENSION_STEP) * RTX_VSR_DIMENSION_STEP;
}

function resolveRtxVsrDimensions(sourceWidth, sourceHeight, { scale = 2, targetLongestEdge = null } = {}) {
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    fatalCliError('Could not determine the source image dimensions for RTX VSR upscaling.', {
      code: 'INVALID_UPSCALE_SOURCE'
    });
  }

  const sourceLongestEdge = Math.max(sourceWidth, sourceHeight);
  if (sourceLongestEdge >= RTX_VSR_MAX_DIMENSION) {
    fatalCliError(`RTX VSR cannot enlarge an image whose longest edge is already ${RTX_VSR_MAX_DIMENSION}px or larger.`, {
      code: 'INVALID_UPSCALE_SIZE',
      details: { sourceWidth, sourceHeight, maxDimension: RTX_VSR_MAX_DIMENSION }
    });
  }

  const requestedLongestEdge = targetLongestEdge ?? sourceLongestEdge * scale;
  if (requestedLongestEdge <= sourceLongestEdge) {
    fatalCliError('RTX VSR output must be larger than the source image.', {
      code: 'INVALID_UPSCALE_SIZE',
      details: { sourceWidth, sourceHeight, requestedLongestEdge }
    });
  }
  const factor = Math.min(requestedLongestEdge / sourceLongestEdge, RTX_VSR_MAX_DIMENSION / sourceLongestEdge);
  const width = alignRtxVsrDimension(sourceWidth * factor);
  const height = alignRtxVsrDimension(sourceHeight * factor);
  if (width < RTX_VSR_MIN_DIMENSION || height < RTX_VSR_MIN_DIMENSION) {
    const sourceShortestEdge = Math.min(sourceWidth, sourceHeight);
    const minimumLongestEdge = Math.ceil(
      (sourceLongestEdge * RTX_VSR_MIN_DIMENSION / sourceShortestEdge) / RTX_VSR_DIMENSION_STEP
    ) * RTX_VSR_DIMENSION_STEP;
    const message = minimumLongestEdge <= RTX_VSR_MAX_DIMENSION
      ? `The requested RTX VSR output would be ${width}×${height}px. To preserve aspect ratio, choose --target-longest-edge ${minimumLongestEdge} or larger so every output edge is at least ${RTX_VSR_MIN_DIMENSION}px.`
      : `The ${sourceWidth}×${sourceHeight}px source aspect ratio cannot fit RTX VSR's supported ${RTX_VSR_MIN_DIMENSION}–${RTX_VSR_MAX_DIMENSION}px output bounds without stretching.`;
    fatalCliError(message, {
      code: 'INVALID_UPSCALE_SIZE',
      details: {
        sourceWidth,
        sourceHeight,
        requestedLongestEdge,
        minimumLongestEdge,
        minDimension: RTX_VSR_MIN_DIMENSION,
        maxDimension: RTX_VSR_MAX_DIMENSION
      }
    });
  }
  return {
    width,
    height
  };
}

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

async function getVideoImageDimensionsFromBuffer(buffer) {
  const parsed = getImageDimensionsFromBuffer(buffer);
  if (parsed) return parsed;
  try {
    const metadata = await sharp(buffer).metadata();
    if (metadata.width && metadata.height) {
      return { width: metadata.width, height: metadata.height, type: metadata.format || 'image' };
    }
  } catch {
    // The caller will preserve the wrapper's normal media-validation path.
  }
  return null;
}

const DEFAULT_VIDEO_DIMENSION_RULES = {
  minDimension: 480,
  maxDimension: 1536,
  dimensionMultiple: 16
};
const WRAPPER_MAX_VIDEO_DIMENSION = 2048;
const WRAPPER_MAX_WAN_VIDEO_DIMENSION = 1536;

// Historical mirror of SogniClientWrapper.normalizeVideoDimensions in
// @sogni-ai/sogni-intelligence-client, which used to clamp every model to
// MAX_VIDEO_DIMENSION = 1536 before resizing a reference image and overwriting
// the project dimensions with the resized reference's — silently downscaling
// LTX-2.5 1920x1088 requests to 1536x864. Newer clients export
// getVideoDimensionRules() with per-family envelopes (LTX-2.x up to 3840) and
// these constants only apply as a fallback when the pinned client predates it
// (see wrapperMaxVideoDimension / wrapperRefVideoDimensionCeiling).
const WRAPPER_MAX_REF_VIDEO_DIMENSION = 1536;
const VIDEO_DIMENSION_MULTIPLE = DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple;

// i2v reference sizing: when an exact-aspect bounding box would cost more than this share of
// the pixel budget, pre-resize the reference to the model cap instead. The aspect ceiling keeps
// the swap invisible — a 25:14 source becoming 16:9 drifts 0.44%, far under the limit.
const VIDEO_REF_PRERESIZE_MIN_AREA_GAIN = 1.1;
const VIDEO_REF_PRERESIZE_MAX_ASPECT_DRIFT = 0.02;
const MINIMAX_H3_MAX_VIDEO_PIXELS = 1_032_192;

function isWanVideoModelId(modelId) {
  return getSharedModelDefaults(modelId)?.family === 'wan22';
}

function isWanAnimateVideoModelId(modelId) {
  if (!isWanVideoModelId(modelId)) return false;
  const workflow = inferVideoWorkflowFromModel(modelId);
  return workflow === 'animate-move' || workflow === 'animate-replace';
}

function isGptImage2ModelSelection(modelId) {
  const normalized = String(modelId || '').trim().toLowerCase();
  return ['gpt-image-2', 'gptimage2', 'gpt-image', 'gpt_image_2'].includes(normalized);
}

const SEEDANCE_TASK_TYPES = new Set(['reference', 'edit', 'extend']);
const QWEN_IMAGE_EDIT_2511_MODEL_IDS = new Set([
  'qwen_image_edit_2511_fp8',
  'qwen_image_edit_2511_fp8_lightning',
]);
const LIGHTNING_IMAGE_MODEL_IDS = new Set([
  'qwen_image_edit_2511_fp8_lightning',
  'qwen_image_2512_fp8_lightning',
]);

function isQwenImageEdit2511ModelSelection(modelId) {
  return QWEN_IMAGE_EDIT_2511_MODEL_IDS.has(String(modelId || '').trim().toLowerCase());
}

function isLightningImageModelSelection(modelId) {
  return LIGHTNING_IMAGE_MODEL_IDS.has(String(modelId || '').trim().toLowerCase());
}

const SEEDANCE_25_MODEL_SELECTIONS = new Set([
  'seedance-2-5',
  'seedance2-5',
  'seedance2-5-t2v',
  'seedance2-5-ia2v',
  'seedance2-5-v2v',
]);

const WAN3_MODEL_ID = 'wan3.0-video';
const WAN3_MODEL_SELECTIONS = new Set([
  WAN3_MODEL_ID,
  'wan3',
  'wan3.0',
  'wan3-video',
  'wan-3',
  'wan-3.0',
]);
const WAN3_REFERENCE_LIMITS = Object.freeze({
  images: 10,
  videos: 5,
  audios: 5,
  files: 1,
  links: 1,
});
const WAN3_SUPPORTED_WORKFLOWS = new Set(['t2v', 'i2v', 'r2v', 'a2v', 'ia2v']);
const WAN3_SUPPORTED_RESOLUTIONS = new Set([480, 720, 1080]);
const WAN3_SUPPORTED_RATIOS = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']);
const WAN3_MAX_SEED = 0x7fffffff;

function isWan3ModelSelectionLocal(modelId) {
  return WAN3_MODEL_SELECTIONS.has(String(modelId || '').trim().toLowerCase().replace(/_/g, '-'));
}

function isWan3ModelLocal(modelId) {
  return String(modelId || '').trim().toLowerCase() === WAN3_MODEL_ID;
}

function isSeedance25ModelSelectionLocal(modelId) {
  const normalized = String(modelId || '').trim().toLowerCase().replace(/_/g, '-');
  return SEEDANCE_25_MODEL_SELECTIONS.has(normalized);
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
  return isGptImage2ModelSelection(modelId)
    || isSeedanceModel(modelId)
    || isHappyHorseModel(modelId)
    || isWan3ModelSelectionLocal(modelId);
}

// Attach the user's explicit --billing-mode to a project config. Omitted by
// default so the server keeps deciding coverage (Unlimited members get 'auto'
// coverage server-side; token payers are unaffected).
function nextSemanticWorkloadAttribution(options = {}) {
  return semanticWorkloadAttribution(AGENT_ATTRIBUTION, INVOCATION_LINEAGE.next(options));
}

function withBillingMode(config, attributionOptions = {}) {
  return {
    ...config,
    ...(options.billingMode ? { billingMode: options.billingMode } : {}),
    attribution: nextSemanticWorkloadAttribution(attributionOptions),
  };
}

// Best-effort Sogni Unlimited entitlement lookup. Returns null (never throws)
// when the wrapper predates getSubscriptionStatus() or the request fails, so
// callers degrade to balance-only behavior.
async function fetchSubscriptionSnapshot(client, log) {
  if (typeof client?.getSubscriptionStatus !== 'function') return null;
  try {
    return await client.getSubscriptionStatus();
  } catch (err) {
    if (!options.quiet && typeof log === 'function') {
      log(`Warning: could not fetch subscription status (${err?.message || 'error'})`);
    }
    return null;
  }
}

const SUBSCRIPTION_TIER_LABELS = {
  unlimited: 'Sogni Unlimited',
  unlimited_pro: 'Sogni Unlimited Pro',
};

function describeSubscription(subscription) {
  if (!subscription || subscription.active !== true) return 'none';
  const tierKey = String(subscription.tier || '').toLowerCase();
  const label = SUBSCRIPTION_TIER_LABELS[tierKey] || subscription.tier || 'subscription';
  return `${label} (${subscription.status || 'active'})`;
}

// HappyHorse 1.1 ships three discrete vendor models (no mini/fast). The shared
// intel client only resolves the fully-qualified ids; accept the bare
// `happyhorse` / `happyhorse-1.1` selector here so `-m happyhorse` works the way
// `-m seedance2` does, and pin the concrete per-mode model id.
const HAPPYHORSE_VIDEO_MODES = new Set(['t2v', 'i2v', 'r2v']);

function isHappyHorseModelSelectionLocal(modelId) {
  if (isHappyHorseModelSelection(modelId)) return true;
  const key = String(modelId || '').trim().toLowerCase();
  return key === 'happyhorse' || key === 'happyhorse-1.1';
}

function resolveHappyHorseModelId(modelId, workflow) {
  if (!isHappyHorseModelSelectionLocal(modelId)) return modelId;
  const key = String(modelId || '').trim().toLowerCase();
  if (key === 'happyhorse' || key === 'happyhorse-1.1') {
    const mode = HAPPYHORSE_VIDEO_MODES.has(workflow) ? workflow : 't2v';
    return `happyhorse-1.1-${mode}`;
  }
  return modelId;
}

// The per-mode workflow pinned by a concrete `happyhorse-1.1-<mode>` model id, or
// null for the bare `happyhorse` / `happyhorse-1.1` alias (mode inferred from refs).
function happyHorseModeFromModelId(modelId) {
  const match = String(modelId || '').trim().toLowerCase().match(/^happyhorse-1\.1-(t2v|i2v|r2v)$/);
  return match ? match[1] : null;
}

function getMaxContextImages(modelId) {
  if (isGptImage2ModelSelection(modelId)) return 16;
  return getWrapperMaxContextImages(modelId);
}

function videoDurationLimitsLikeWrapper(modelId) {
  if (isMiniMaxH3Model(modelId)) return { ...MINIMAX_H3_DURATION_LIMITS };
  if (isWan3ModelSelectionLocal(modelId)) return { min: 2, max: 30 };
  if (isSeedance25ModelSelectionLocal(modelId)) return { min: 4, max: 30 };
  if (isSeedanceModel(modelId)) return { min: 4, max: 15 };
  if (isHappyHorseModel(modelId)) return { min: 3, max: 15 };
  if (isLtxFamilyModel(modelId) || isWanAnimateVideoModelId(modelId)) return { min: 1, max: 20 };
  return { min: 1, max: 10 };
}

// Default video dimensions (and dimension rules) for models the shared intel
// video-model registry does not carry, so `getModelDefaults` returns null and
// the CLI would otherwise fall back to the 512x512 square.
// Parallels `videoDurationLimitsLikeWrapper`.
//
// HappyHorse 1.1 spec default is 1080P (1920x1080, 16:9). The intelligence
// client registers dimensionDivisor=1 and maxDimension=1920 for HappyHorse, so
// we mirror those here via `maxDimension` and `dimensionMultiple` so that
// `videoDimensionRulesFromDefaults` applies the correct clamp for the model
// instead of the generic 480-1536 / multiple-of-16 rules (which would reduce
// 1920x1080 to 1536x864 and round 1080 to 1072). These are defaults only —
// explicit -w/-h/--target-resolution, config, and prompt-derived dimensions
// still win (see the video preflight defaults block).
function videoModelDimensionDefaultsLikeWrapper(modelId) {
  if (String(modelId || '').trim().toLowerCase() === MINIMAX_H3_R2V_TURBO_MODEL_ID) {
    return {
      defaultWidth: 960,
      defaultHeight: 544,
      minDimension: 32,
      maxDimension: 1344,
      dimensionMultiple: 32,
      maxPixels: MINIMAX_H3_MAX_VIDEO_PIXELS
    };
  }
  if (isMiniMaxH3Model(modelId)) {
    return {
      defaultWidth: 1344,
      defaultHeight: 768,
      minDimension: 32,
      maxDimension: 1344,
      dimensionMultiple: 32,
      maxPixels: MINIMAX_H3_MAX_VIDEO_PIXELS
    };
  }
  if (isHappyHorseModel(modelId) || isHappyHorseModelSelectionLocal(modelId)) {
    return { defaultWidth: 1920, defaultHeight: 1080, maxDimension: 1920, dimensionMultiple: 1 };
  }
  if (isWan3ModelSelectionLocal(modelId)) {
    return {
      defaultWidth: 1920,
      defaultHeight: 1080,
      minDimension: 480,
      maxDimension: 1920,
      dimensionMultiple: 1,
    };
  }
  return null;
}

function wrapperMaxVideoDimension(modelId) {
  // Prefer the wrapper's own model-aware envelope so the CLI ceiling can never
  // drift from what the pinned client will actually accept (LTX-2.x: 3840).
  if (typeof getWrapperVideoDimensionRules === 'function') {
    const rules = getWrapperVideoDimensionRules(modelId);
    if (Number.isFinite(rules?.maxDimension) && rules.maxDimension > 0) {
      return rules.maxDimension;
    }
  }
  return isWanVideoModelId(modelId) ? WRAPPER_MAX_WAN_VIDEO_DIMENSION : WRAPPER_MAX_VIDEO_DIMENSION;
}

// Ceiling for reference-bearing workflows: the wrapper resizes the reference
// and adopts its dimensions, so the CLI must pick sizes the wrapper will not
// re-clamp. Model-aware on newer clients; the blanket 1536 applies only to
// legacy pinned clients that still clamp every model.
function wrapperRefVideoDimensionCeiling(modelId) {
  if (typeof getWrapperVideoDimensionRules === 'function') {
    return wrapperMaxVideoDimension(modelId);
  }
  return WRAPPER_MAX_REF_VIDEO_DIMENSION;
}

function videoDimensionRulesFromDefaults(modelDefaults, modelId) {
  const wrapperMax = wrapperMaxVideoDimension(modelId);
  const wrapperRules = typeof getWrapperVideoDimensionRules === 'function'
    ? getWrapperVideoDimensionRules(modelId)
    : null;
  // Fall back to skill-local dimension rules for models the intel registry does
  // not carry (e.g. HappyHorse), so their model-specific maxDimension and
  // dimensionMultiple are applied instead of the generic 1536 / 16 defaults.
  const localFallback = videoModelDimensionDefaultsLikeWrapper(modelId);
  const configuredMax = modelDefaults?.maxDimension || localFallback?.maxDimension || DEFAULT_VIDEO_DIMENSION_RULES.maxDimension;
  return {
    minDimension: modelDefaults?.minDimension || localFallback?.minDimension || wrapperRules?.minDimension || DEFAULT_VIDEO_DIMENSION_RULES.minDimension,
    maxDimension: Math.min(configuredMax, wrapperMax),
    dimensionMultiple: modelDefaults?.dimensionMultiple || localFallback?.dimensionMultiple || DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple,
    maxPixels: modelDefaults?.maxPixels || localFallback?.maxPixels || wrapperRules?.maxPixels || null
  };
}

/**
 * Predicts the dimensions `resizeImageBufferForVideo` will produce for a reference image.
 *
 * Scales the reference up to the model's max dimension (preserving aspect via fit:inside),
 * then rounds each side to the nearest model divisor. Unlike an exact-aspect bounding box,
 * this always reaches the model cap — at the cost of a sub-pixel-percent aspect adjustment.
 *
 * `resizeImageBufferForVideo` delegates to this so the prediction can never drift from the
 * actual resize.
 */
function predictVideoRefPreResizeDims(refWidth, refHeight, rules = DEFAULT_VIDEO_DIMENSION_RULES) {
  const rw = Number(refWidth);
  const rh = Number(refHeight);
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) return null;

  const multiple = rules.dimensionMultiple || VIDEO_DIMENSION_MULTIPLE;
  const minDimension = rules.minDimension || DEFAULT_VIDEO_DIMENSION_RULES.minDimension;
  const maxDimension = rules.maxDimension || DEFAULT_VIDEO_DIMENSION_RULES.maxDimension;
  const roundToMultiple = (n) => Math.max(multiple, Math.round(n / multiple) * multiple);
  // Never round past the model's hard limits.
  const floorMultiple = Math.floor(maxDimension / multiple) * multiple;
  const ceilMultiple = Math.ceil(minDimension / multiple) * multiple;
  const clamp = (n) => Math.min(floorMultiple, Math.max(ceilMultiple, roundToMultiple(n)));

  const boxWidth = Math.max(minDimension, Math.min(maxDimension, roundToMultiple(rw)));
  const boxHeight = Math.max(minDimension, Math.min(maxDimension, roundToMultiple(rh)));
  const fitted = predictSharpInsideResizeDims(rw, rh, boxWidth, boxHeight);
  if (!fitted) return null;

  let width = clamp(fitted.width);
  let height = clamp(fitted.height);
  if (Number.isFinite(rules.maxPixels) && rules.maxPixels > 0 && width * height > rules.maxPixels) {
    const pixelScale = Math.sqrt(rules.maxPixels / (width * height));
    width = Math.max(ceilMultiple, Math.floor((width * pixelScale) / multiple) * multiple);
    height = Math.max(ceilMultiple, Math.floor((height * pixelScale) / multiple) * multiple);
  }

  return { width, height };
}

/**
 * Resizes an image buffer to model-compatible dimensions while maintaining aspect ratio.
 * Uses sharp's fit:inside to preserve aspect, then rounds to the model divisor.
 */
async function resizeImageBufferForVideo(buffer, originalWidth, originalHeight, rules = DEFAULT_VIDEO_DIMENSION_RULES) {
  const target = predictVideoRefPreResizeDims(originalWidth, originalHeight, rules);
  if (!target) return buffer;

  return await sharp(buffer)
    .resize(target.width, target.height, { fit: 'cover', withoutEnlargement: false })
    .toBuffer();
}

function normalizeVideoDimensionsLikeWrapper(width, height, rules = DEFAULT_VIDEO_DIMENSION_RULES) {
  let targetWidth = Number(width);
  let targetHeight = Number(height);
  let adjusted = false;

  const effectiveMin = rules.minDimension || DEFAULT_VIDEO_DIMENSION_RULES.minDimension;
  const effectiveMax = rules.maxDimension || DEFAULT_VIDEO_DIMENSION_RULES.maxDimension;
  const effectiveMultiple = rules.dimensionMultiple || DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple;
  const effectiveMaxPixels = Number.isFinite(rules.maxPixels) && rules.maxPixels > 0
    ? rules.maxPixels
    : null;

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

  if (effectiveMaxPixels && targetWidth * targetHeight > effectiveMaxPixels) {
    const scaleFactor = Math.sqrt(effectiveMaxPixels / (targetWidth * targetHeight));
    targetWidth = Math.floor(targetWidth * scaleFactor);
    targetHeight = Math.floor(targetHeight * scaleFactor);
    adjusted = true;
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

function videoDimensionsAreIncompatible(dimensions, rules = DEFAULT_VIDEO_DIMENSION_RULES) {
  if (!dimensions || !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)) return false;
  const multiple = rules.dimensionMultiple || DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple;
  const minDimension = rules.minDimension || DEFAULT_VIDEO_DIMENSION_RULES.minDimension;
  const maxDimension = rules.maxDimension || DEFAULT_VIDEO_DIMENSION_RULES.maxDimension;
  return dimensions.width % multiple !== 0 ||
    dimensions.height % multiple !== 0 ||
    dimensions.width < minDimension ||
    dimensions.height < minDimension ||
    dimensions.width > maxDimension ||
    dimensions.height > maxDimension ||
    (Number.isFinite(rules.maxPixels) && rules.maxPixels > 0 && dimensions.width * dimensions.height > rules.maxPixels);
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

const VIDEO_CONTROLNET_NAMES = ['canny', 'pose', 'depth', 'detailer', 'outpaint', 'inpaint'];
const VIDEO_CONTROLNET_NAME_SET = new Set(VIDEO_CONTROLNET_NAMES);
const OUTPAINT_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];
const OUTPAINT_POSITION_SET = new Set(OUTPAINT_POSITIONS);
const LTX_TRANSITION_LORA_ID = 'transition';
const LTX_TRANSITION_TRIGGER = 'zhuanchang';
const LTX_TRANSITION_DEFAULT_STRENGTH = 1.0;
const LTX23_10EROS_MODEL_ID = 'ltx23-22b-10eros-v1.4-fp8mixed_i2v';
const LTX25_DISTILLED_WORKFLOW_MODELS = Object.freeze({
  t2v: 'ltx25-22b-int8_t2v_distilled',
  i2v: 'ltx25-22b-int8_i2v_distilled',
  a2v: 'ltx25-22b-int8_a2v_distilled',
  ia2v: 'ltx25-22b-int8_ia2v_distilled',
  v2v: 'ltx25-22b-int8_v2v_distilled'
});
const MINIMAX_H3_MODEL_MODES = new Map([
  ['minimax-h3-fl2va-fp8_t2v', 't2v'],
  ['minimax-h3-fl2va-fp8_i2v', 'i2v'],
  ['minimax-h3-fl2va-fp8_flf2v', 'flf2v'],
  ['minimax-h3-ref2va-fp8_r2v', 'r2v'],
  ['minimax-h3-fl2va-fp8_t2v_turbo', 't2v'],
  ['minimax-h3-fl2va-fp8_i2v_turbo', 'i2v'],
  ['minimax-h3-fl2va-fp8_flf2v_turbo', 'flf2v'],
  ['minimax-h3-ref2va-fp8_r2v_turbo', 'r2v'],
  ['minimax-h3-fl2va-fp8_t2v_balanced', 't2v'],
  ['minimax-h3-fl2va-fp8_i2v_balanced', 'i2v'],
  ['minimax-h3-fl2va-fp8_flf2v_balanced', 'flf2v'],
  ['minimax-h3-ref2va-fp8_r2v_balanced', 'r2v']
]);
const MINIMAX_H3_MODEL_IDS = new Set(MINIMAX_H3_MODEL_MODES.keys());
const MINIMAX_H3_TURBO_MODEL_IDS = new Set([
  'minimax-h3-fl2va-fp8_t2v_turbo',
  'minimax-h3-fl2va-fp8_i2v_turbo',
  'minimax-h3-fl2va-fp8_flf2v_turbo',
  'minimax-h3-ref2va-fp8_r2v_turbo'
]);
const MINIMAX_H3_TURBO_SAMPLERS = Object.freeze(['euler', 'er_sde', 'sa_solver']);
const MINIMAX_H3_TURBO_SAMPLER_SET = new Set(MINIMAX_H3_TURBO_SAMPLERS);
const MINIMAX_H3_R2V_MODEL_ID = 'minimax-h3-ref2va-fp8_r2v';
const MINIMAX_H3_R2V_TURBO_MODEL_ID = 'minimax-h3-ref2va-fp8_r2v_turbo';
const MINIMAX_H3_R2V_BALANCED_MODEL_ID = 'minimax-h3-ref2va-fp8_r2v_balanced';
const MINIMAX_H3_REFERENCE_LIMITS = Object.freeze({
  images: 9,
  videos: 3,
  audios: 3,
  assets: 12
});
// H3 renders on a fixed 24fps frame grid: frames are 124 + n×17, from 124
// through 362. Every duration the user asks for is snapped to that grid, so the
// deliverable range is 5.17-15.08s — not the round 5-15s it rounds to.
const MINIMAX_H3_FRAME_GRID = Object.freeze({
  fps: 24,
  min: 124,
  max: 362,
  step: 17
});
const MINIMAX_H3_DURATION_LIMITS = Object.freeze({
  min: MINIMAX_H3_FRAME_GRID.min / MINIMAX_H3_FRAME_GRID.fps,
  max: MINIMAX_H3_FRAME_GRID.max / MINIMAX_H3_FRAME_GRID.fps
});

// Grid-snapped durations are rarely whole seconds; keep the printed form short
// without implying more precision than the frame count carries.
function formatDurationSeconds(seconds) {
  return String(Number(Number(seconds).toFixed(2)));
}

// Snap a duration in seconds onto the H3 frame grid.
function miniMaxH3FramesForDuration(durationSeconds) {
  const { fps, min, max, step } = MINIMAX_H3_FRAME_GRID;
  const desiredFrames = durationSeconds * fps;
  return Math.max(min, Math.min(max, min + Math.round((desiredFrames - min) / step) * step));
}

const LTX23_10EROS_FIXED_SETTINGS = Object.freeze({
  steps: 9,
  guidance: 1,
  sampler: 'euler_ancestral',
  scheduler: 'manual_sigmas',
  requiresDisabledSafetyFilter: true
});
const DR34ML4Y_LORA_ID = 'dr34ml4y-v3';
const DR34ML4Y_DEFAULT_STRENGTH = 1.0;
const DR34ML4Y_SUPPORTED_MODEL_IDS = new Set([
  'ltx23-22b-fp8_i2v',
  'ltx23-22b-fp8_i2v_dev',
  LTX23_10EROS_MODEL_ID
]);

function resolveSkillVideoModelAlias(
  modelId,
  workflow = null,
  hasStartFrame = false,
  hasEndFrame = false,
) {
  const normalized = String(modelId || '').trim().toLowerCase();
  if (isWan3ModelSelectionLocal(normalized)) return WAN3_MODEL_ID;
  if (normalized === 'ltx25' || normalized === 'ltx25-t2v') {
    const mode = ['i2v', 'a2v', 'ia2v', 'v2v'].includes(workflow) ? workflow : 't2v';
    return LTX25_DISTILLED_WORKFLOW_MODELS[mode];
  }
  if (normalized === 'ltx25-i2v') return LTX25_DISTILLED_WORKFLOW_MODELS.i2v;
  if (normalized === 'ltx25-a2v') return LTX25_DISTILLED_WORKFLOW_MODELS.a2v;
  if (normalized === 'ltx25-ia2v') return LTX25_DISTILLED_WORKFLOW_MODELS.ia2v;
  if (normalized === 'ltx25-v2v') return LTX25_DISTILLED_WORKFLOW_MODELS.v2v;
  if (normalized === 'minimax-h3' && workflow) {
    if (workflow === 'r2v') return MINIMAX_H3_R2V_MODEL_ID;
    if (workflow === 'i2v') {
      return hasStartFrame && hasEndFrame
        ? 'minimax-h3-fl2va-fp8_flf2v'
        : 'minimax-h3-fl2va-fp8_i2v';
    }
    return 'minimax-h3-fl2va-fp8_t2v';
  }
  if (normalized === 'minimax-h3-t2v') {
    return 'minimax-h3-fl2va-fp8_t2v';
  }
  if (normalized === 'minimax-h3-i2v') return 'minimax-h3-fl2va-fp8_i2v';
  if (normalized === 'minimax-h3-flf2v') return 'minimax-h3-fl2va-fp8_flf2v';
  if (normalized === 'minimax-h3-r2v') return MINIMAX_H3_R2V_MODEL_ID;
  if (normalized === 'minimax-h3-r2v-turbo') return MINIMAX_H3_R2V_TURBO_MODEL_ID;
  if (normalized === 'minimax-h3-turbo' && workflow) {
    if (workflow === 'r2v') {
      return MINIMAX_H3_R2V_TURBO_MODEL_ID;
    }
    if (workflow === 'i2v') {
      return hasStartFrame && hasEndFrame
        ? 'minimax-h3-fl2va-fp8_flf2v_turbo'
        : 'minimax-h3-fl2va-fp8_i2v_turbo';
    }
    return 'minimax-h3-fl2va-fp8_t2v_turbo';
  }
  if (normalized === 'minimax-h3-t2v-turbo') {
    return 'minimax-h3-fl2va-fp8_t2v_turbo';
  }
  if (normalized === 'minimax-h3-i2v-turbo') {
    return 'minimax-h3-fl2va-fp8_i2v_turbo';
  }
  if (normalized === 'minimax-h3-flf2v-turbo') {
    return 'minimax-h3-fl2va-fp8_flf2v_turbo';
  }
  if (normalized === 'minimax-h3-balanced' && workflow) {
    if (workflow === 'r2v') {
      return MINIMAX_H3_R2V_BALANCED_MODEL_ID;
    }
    if (workflow === 'i2v') {
      return hasStartFrame && hasEndFrame
        ? 'minimax-h3-fl2va-fp8_flf2v_balanced'
        : 'minimax-h3-fl2va-fp8_i2v_balanced';
    }
    return 'minimax-h3-fl2va-fp8_t2v_balanced';
  }
  if (normalized === 'minimax-h3-t2v-balanced') {
    return 'minimax-h3-fl2va-fp8_t2v_balanced';
  }
  if (normalized === 'minimax-h3-i2v-balanced') {
    return 'minimax-h3-fl2va-fp8_i2v_balanced';
  }
  if (normalized === 'minimax-h3-flf2v-balanced') {
    return 'minimax-h3-fl2va-fp8_flf2v_balanced';
  }
  if (normalized === 'minimax-h3-r2v-balanced') {
    return MINIMAX_H3_R2V_BALANCED_MODEL_ID;
  }
  return normalized === '10eros' || normalized === 'ltx23-eros'
    ? LTX23_10EROS_MODEL_ID
    : modelId;
}

function isMiniMaxH3Model(modelId) {
  return MINIMAX_H3_MODEL_IDS.has(String(modelId || '').trim().toLowerCase());
}

function isMiniMaxH3TurboModel(modelId) {
  return MINIMAX_H3_TURBO_MODEL_IDS.has(String(modelId || '').trim().toLowerCase());
}

function isMiniMaxH3R2vModel(modelId) {
  const normalized = String(modelId || '').trim().toLowerCase();
  return normalized === MINIMAX_H3_R2V_MODEL_ID
    || normalized === MINIMAX_H3_R2V_TURBO_MODEL_ID
    || normalized === MINIMAX_H3_R2V_BALANCED_MODEL_ID;
}

function isMiniMaxH3R2vTurboSelectionLocal(modelId, workflow = null) {
  const normalized = String(modelId || '').trim().toLowerCase();
  return normalized === 'minimax-h3-r2v-turbo'
    || normalized === MINIMAX_H3_R2V_TURBO_MODEL_ID
    || (normalized === 'minimax-h3-turbo' && workflow === 'r2v');
}

function isMiniMaxH3ModelSelectionLocal(modelId) {
  const normalized = String(modelId || '').trim().toLowerCase();
  return normalized === 'minimax-h3'
    || normalized === 'minimax-h3-t2v'
    || normalized === 'minimax-h3-i2v'
    || normalized === 'minimax-h3-flf2v'
    || normalized === 'minimax-h3-r2v'
    || normalized === 'minimax-h3-turbo'
    || normalized === 'minimax-h3-t2v-turbo'
    || normalized === 'minimax-h3-i2v-turbo'
    || normalized === 'minimax-h3-flf2v-turbo'
    || normalized === 'minimax-h3-r2v-turbo'
    || normalized === 'minimax-h3-balanced'
    || normalized === 'minimax-h3-t2v-balanced'
    || normalized === 'minimax-h3-i2v-balanced'
    || normalized === 'minimax-h3-flf2v-balanced'
    || normalized === 'minimax-h3-r2v-balanced'
    || isMiniMaxH3Model(normalized);
}

function isMiniMaxH3TurboModelSelectionLocal(modelId) {
  const normalized = String(modelId || '').trim().toLowerCase();
  return normalized === 'minimax-h3-turbo'
    || normalized === 'minimax-h3-t2v-turbo'
    || normalized === 'minimax-h3-i2v-turbo'
    || normalized === 'minimax-h3-flf2v-turbo'
    || normalized === 'minimax-h3-r2v-turbo'
    || isMiniMaxH3TurboModel(normalized);
}

function miniMaxH3ModeFromModelId(modelId) {
  const normalized = String(modelId || '').trim().toLowerCase();
  if (normalized === 'minimax-h3-t2v') return 't2v';
  if (normalized === 'minimax-h3-i2v') return 'i2v';
  if (normalized === 'minimax-h3-flf2v') return 'flf2v';
  if (normalized === 'minimax-h3-r2v') return 'r2v';
  if (normalized === 'minimax-h3-t2v-turbo') return 't2v';
  if (normalized === 'minimax-h3-i2v-turbo') return 'i2v';
  if (normalized === 'minimax-h3-flf2v-turbo') return 'flf2v';
  if (normalized === 'minimax-h3-r2v-turbo') return 'r2v';
  if (normalized === 'minimax-h3-t2v-balanced') return 't2v';
  if (normalized === 'minimax-h3-i2v-balanced') return 'i2v';
  if (normalized === 'minimax-h3-flf2v-balanced') return 'flf2v';
  if (normalized === 'minimax-h3-r2v-balanced') return 'r2v';
  return MINIMAX_H3_MODEL_MODES.get(normalized) || null;
}

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

function normalizeVideoControlNetName(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/_/g, '-');
  return normalized || null;
}

function normalizeOutpaintPositionValue(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/_/g, '-');
  return OUTPAINT_POSITION_SET.has(normalized) ? normalized : null;
}

function parseOutpaintAspectRatio(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

function isLtxV2VModelId(modelId) {
  return isLtxFamilyModel(modelId) && inferVideoWorkflowFromModel(modelId) === 'v2v';
}

function isLtx23ModelId(modelId) {
  return getSharedModelDefaults(modelId)?.family === 'ltx23';
}

function isLtx25ModelId(modelId) {
  return getSharedModelDefaults(modelId)?.family === 'ltx25';
}

function isLtxFamilyModel(modelId) {
  return isLtx2Model(modelId);
}

function ltx25WorkflowFromModelSelection(modelId) {
  const normalized = String(modelId || '').trim().toLowerCase();
  const exact = normalized.match(/^ltx25-22b-int8_(t2v|i2v|a2v|ia2v|v2v)_(?:distilled|dev)$/);
  if (exact) return exact[1];
  const alias = normalized.match(/^ltx25-(t2v|i2v|a2v|ia2v|v2v)$/);
  return alias ? alias[1] : null;
}

function upgradeBuiltInLtx23Default(modelId, workflow) {
  const normalized = String(modelId || '').trim().toLowerCase();
  const match = normalized.match(/^ltx23-22b-fp8_(t2v|i2v|a2v|ia2v|v2v)_(distilled|dev)$/);
  if (!match) return modelId;
  const mode = ['t2v', 'i2v', 'a2v', 'ia2v', 'v2v'].includes(workflow) ? workflow : match[1];
  return `ltx25-22b-int8_${mode}_${match[2]}`;
}

function isLtxI2vTransitionModelId(modelId) {
  return (
    !!modelId &&
    modelId !== LTX23_10EROS_MODEL_ID &&
    isLtx23ModelId(modelId) &&
    /_i2v(_|$)/.test(modelId)
  );
}

function applyLtxTransitionLora(projectConfig, modelId, hasStartFrame, hasEndFrame) {
  if (!hasStartFrame || !hasEndFrame || !isLtxI2vTransitionModelId(modelId)) {
    return;
  }
  const loras = Array.isArray(projectConfig.loras) ? [...projectConfig.loras] : [];
  const loraStrengths = Array.isArray(projectConfig.loraStrengths) ? [...projectConfig.loraStrengths] : [];
  if (!loras.includes(LTX_TRANSITION_LORA_ID)) {
    loras.push(LTX_TRANSITION_LORA_ID);
    loraStrengths.push(LTX_TRANSITION_DEFAULT_STRENGTH);
  }
  projectConfig.loras = loras;
  projectConfig.loraStrengths = loraStrengths;
  const prompt = String(projectConfig.positivePrompt || '');
  if (!new RegExp(`\\b${LTX_TRANSITION_TRIGGER}\\b`, 'i').test(prompt)) {
    projectConfig.positivePrompt = prompt ? `${prompt}, ${LTX_TRANSITION_TRIGGER}` : LTX_TRANSITION_TRIGGER;
  }
}

function computeOutpaintCanvas(sourceWidth, sourceHeight, aspectRatioArg, position, rules = DEFAULT_VIDEO_DIMENSION_RULES) {
  const step = rules.dimensionMultiple || DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple;
  const minD = rules.minDimension || DEFAULT_VIDEO_DIMENSION_RULES.minDimension;
  const maxD = rules.maxDimension || DEFAULT_VIDEO_DIMENSION_RULES.maxDimension;
  let srcW = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1920;
  let srcH = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 1088;
  if (srcW > maxD || srcH > maxD) {
    const scale = Math.min(maxD / srcW, maxD / srcH);
    srcW *= scale;
    srcH *= scale;
  }

  let targetW = srcW;
  let targetH = srcH;
  const parsedAspect = parseOutpaintAspectRatio(aspectRatioArg);
  if (parsedAspect) {
    const srcAspect = srcW / srcH;
    if (parsedAspect > srcAspect) targetW = srcH * parsedAspect;
    else if (parsedAspect < srcAspect) targetH = srcW / parsedAspect;
  } else {
    const factor = 1.5;
    if (position === 'left' || position === 'right') targetW = srcW * factor;
    else if (position === 'top' || position === 'bottom') targetH = srcH * factor;
    else {
      targetW = srcW * factor;
      targetH = srcH * factor;
    }
  }

  const snapUp = (value) => Math.ceil(value / step) * step;
  let width = Math.min(maxD, Math.max(minD, snapUp(targetW)));
  let height = Math.min(maxD, Math.max(minD, snapUp(targetH)));
  width = Math.max(width, Math.min(maxD, snapUp(srcW)));
  height = Math.max(height, Math.min(maxD, snapUp(srcH)));
  return { width, height };
}

function computeSourceAspectCanvas(sourceWidth, sourceHeight, rules = DEFAULT_VIDEO_DIMENSION_RULES, targetResolution = null) {
  const step = rules.dimensionMultiple || DEFAULT_VIDEO_DIMENSION_RULES.dimensionMultiple;
  const minD = rules.minDimension || DEFAULT_VIDEO_DIMENSION_RULES.minDimension;
  const maxD = rules.maxDimension || DEFAULT_VIDEO_DIMENSION_RULES.maxDimension;
  let width = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1920;
  let height = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 1088;
  if (Number.isFinite(targetResolution) && targetResolution > 0) {
    const roundedTarget = Math.max(minD, Math.round(targetResolution / step) * step);
    if (width <= height) {
      height = Math.round((height * roundedTarget) / width / step) * step;
      width = roundedTarget;
    } else {
      width = Math.round((width * roundedTarget) / height / step) * step;
      height = roundedTarget;
    }
  }
  if (width > maxD || height > maxD) {
    const scale = Math.min(maxD / width, maxD / height);
    width *= scale;
    height *= scale;
  }
  if (width < minD || height < minD) {
    const scale = Math.max(minD / width, minD / height);
    width *= scale;
    height *= scale;
  }
  return {
    width: Math.max(minD, Math.min(maxD, Math.round(width / step) * step)),
    height: Math.max(minD, Math.min(maxD, Math.round(height / step) * step))
  };
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
const MODEL_CATALOG_CACHE_PATH = resolveConfiguredPath(
  getEnv('SOGNI_MODEL_CATALOG_CACHE_PATH'),
  DEFAULT_MODEL_CATALOG_CACHE_PATH,
  'Sogni model catalog cache path'
);
const MODEL_CATALOG_LIST_CACHE_PATH = `${MODEL_CATALOG_CACHE_PATH}.models`;
const MODEL_CATALOG_URL = (getEnv('SOGNI_MODEL_CATALOG_URL') || DEFAULT_MODEL_CATALOG_URL).replace(/\/+$/, '');
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
  billingMode: null, // auto|subscription|tokens — omitted by default so the server decides coverage
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
  seedanceTaskType: null,
  legacyWan3TaskType: null,
  wan3Ratio: 'adaptive',
  wan3SmartDuration: false,
  wan3ReferenceFileUrl: null,
  wan3ReferenceLinkUrl: null,
  wan3Watermark: false,
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
  refMask: null, // Inpaint mask image for LTX v2v inpaint
  outpaintPosition: null, // LTX v2v outpaint canvas anchor
  outpaintAspectRatio: null, // Optional target aspect ratio for outpaint canvas growth
  contextImages: [], // Context images for image editing
  upscaleImage: null, // Source image for promptless RTX VSR upscaling
  upscaleScale: 2,
  upscaleTargetLongestEdge: null,
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
  extractFrameAt: null, // --extract-frame-at <video> <seconds> <image>
  extractFrameAtSeconds: null,
  extractFrameAtOutput: null,
  trimVideo: null, // --trim-video <video> <start> <duration> <output>
  trimVideoStart: null,
  trimVideoDuration: null,
  trimVideoOutput: null,
  verifyVideo: null, // --verify-video <video>: probe streams and decode the full file
  sourceReelDir: null, // --source-reel <image-folder>: animate folder images into a stitched video
  sourceReelImageSeconds: 3,
  sourceReelTransitionSeconds: 3,
  sourceReelLoop: true,
  sourceReelWorkdir: null,
  sourceReelOutput: null,
  sourceReelImagePrompt: null,
  sourceReelTransitionPrompt: null,
  sourceReelTransitionPrompts: null,
  sourceReelPlanOnly: false,
  sourceReelConcurrency: 2,
  sourceReelModel: null,
  sourceReelTargetResolution: 768,
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
  liveModelAction: null, // list|search
  liveModelQuery: null,
  liveModelMedia: 'all', // image|video|audio|all
  liveModelNetwork: null, // fast|relaxed; defaults to configured network
  liveModelTags: [], // repeatable --model-tag filters (AND semantics)
  loraCatalogAction: null, // list|search
  loraCatalogQuery: null,
  loraCatalogModel: null, // restrict to LoRAs compatible with this model id
  loraCatalogCategory: null, // restrict to one catalog category
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
  storyboardPlanModel: null, // seedance|seedance2|gpt-image-2|ltx25|ltx23|wan
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
  seedanceTaskType: false,
  wan3Ratio: false,
  wan3SmartDuration: false,
  wan3ReferenceFileUrl: false,
  wan3ReferenceLinkUrl: false,
  wan3Watermark: false,
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
  refMask: false,
  outpaintPosition: false,
  outpaintAspectRatio: false,
  context: false,
  upscaleImage: false,
  upscaleScale: false,
  upscaleTargetLongestEdge: false,
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
  } else if (arg === '--billing-mode') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.billingMode = raw;
    cliSet.billingMode = true;
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
  } else if (arg === '--seedance-task-type') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.seedanceTaskType = raw.trim().toLowerCase();
    cliSet.seedanceTaskType = true;
  } else if (arg === '--wan3-task-type') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.legacyWan3TaskType = raw.trim().toLowerCase();
  } else if (arg === '--wan3-ratio' || arg === '--video-ratio') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.wan3Ratio = raw.trim().toLowerCase();
    cliSet.wan3Ratio = true;
  } else if (arg === '--smart-duration') {
    options.wan3SmartDuration = true;
    cliSet.wan3SmartDuration = true;
  } else if (arg === '--no-smart-duration') {
    options.wan3SmartDuration = false;
    cliSet.wan3SmartDuration = true;
  } else if (arg === '--reference-file-url' || arg === '--ref-file-url') {
    options.wan3ReferenceFileUrl = requireFlagValue(args, i, arg).trim();
    i++;
    cliSet.wan3ReferenceFileUrl = true;
  } else if (arg === '--reference-link-url' || arg === '--ref-link-url') {
    options.wan3ReferenceLinkUrl = requireFlagValue(args, i, arg).trim();
    i++;
    cliSet.wan3ReferenceLinkUrl = true;
  } else if (arg === '--watermark') {
    options.wan3Watermark = true;
    cliSet.wan3Watermark = true;
  } else if (arg === '--no-watermark') {
    options.wan3Watermark = false;
    cliSet.wan3Watermark = true;
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
  } else if (arg === '--upscale') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    options.upscaleImage = raw;
    cliSet.upscaleImage = true;
  } else if (arg === '--upscale-scale') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.upscaleScale = parsePositiveIntegerValue(raw, arg, 2, 4);
    cliSet.upscaleScale = true;
  } else if (arg === '--target-longest-edge') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.upscaleTargetLongestEdge = parsePositiveIntegerValue(
      raw,
      arg,
      RTX_VSR_MIN_DIMENSION,
      RTX_VSR_MAX_DIMENSION
    );
    cliSet.upscaleTargetLongestEdge = true;
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
  } else if (arg === '--controlnet-name' || arg === '--control-type') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.videoControlNetName = normalizeVideoControlNetName(raw);
    cliSet.videoControlNetName = true;
  } else if (arg === '--controlnet-strength') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.videoControlNetStrength = parseNumberValue(raw, arg);
    cliSet.videoControlNetStrength = true;
  } else if (arg === '--mask' || arg === '--ref-mask' || arg === '--reference-mask') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    options.refMask = raw;
    cliSet.refMask = true;
  } else if (arg === '--outpaint-position') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.outpaintPosition = raw;
    cliSet.outpaintPosition = true;
  } else if (arg === '--outpaint-aspect-ratio' || arg === '--outpaint-ratio') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.outpaintAspectRatio = raw;
    cliSet.outpaintAspectRatio = true;
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
  } else if (arg === '--extract-frame-at') {
    const videoArg = requireFlagValue(args, i, arg);
    i++;
    const secondsRaw = requireFlagValue(args, i, arg + ' (seconds)');
    i++;
    const imageArg = requireFlagValue(args, i, arg + ' (output image)');
    i++;
    options.extractFrameAt = videoArg;
    options.extractFrameAtSeconds = parseNonNegativeNumberValue(secondsRaw, arg + ' (seconds)');
    options.extractFrameAtOutput = imageArg;
  } else if (arg === '--trim-video') {
    const videoArg = requireFlagValue(args, i, arg);
    i++;
    const startRaw = requireFlagValue(args, i, arg + ' (start seconds)');
    i++;
    const durationRaw = requireFlagValue(args, i, arg + ' (duration seconds)');
    i++;
    const outputArg = requireFlagValue(args, i, arg + ' (output video)');
    i++;
    options.trimVideo = videoArg;
    options.trimVideoStart = parseNonNegativeNumberValue(startRaw, arg + ' (start seconds)');
    options.trimVideoDuration = parseNumberValue(durationRaw, arg + ' (duration seconds)');
    if (options.trimVideoDuration <= 0) {
      fatalCliError('--trim-video duration must be greater than zero.', {
        code: 'INVALID_ARGUMENT',
        details: { flag: '--trim-video', duration: options.trimVideoDuration }
      });
    }
    options.trimVideoOutput = outputArg;
  } else if (arg === '--verify-video') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.verifyVideo = raw;
  } else if (arg === '--source-reel' || arg === '--image-reel') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    options.sourceReelDir = raw;
  } else if (arg === '--reel-image-seconds' || arg === '--reel-clip-seconds') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.sourceReelImageSeconds = parsePositiveIntegerValue(raw, arg);
  } else if (arg === '--reel-transition-seconds') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.sourceReelTransitionSeconds = parsePositiveIntegerValue(raw, arg);
  } else if (arg === '--reel-loop') {
    options.sourceReelLoop = true;
  } else if (arg === '--no-reel-loop') {
    options.sourceReelLoop = false;
  } else if (arg === '--reel-workdir') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    options.sourceReelWorkdir = raw;
  } else if (arg === '--reel-output') {
    const raw = expandHomePath(requireFlagValue(args, i, arg));
    i++;
    options.sourceReelOutput = raw;
  } else if (arg === '--reel-image-prompt') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.sourceReelImagePrompt = raw;
  } else if (arg === '--reel-transition-prompt') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.sourceReelTransitionPrompt = raw;
  } else if (arg === '--reel-transition-prompts') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.sourceReelTransitionPrompts = raw;
  } else if (arg === '--reel-plan-only' || arg === '--reel-dry-run') {
    options.sourceReelPlanOnly = true;
  } else if (arg === '--reel-concurrency') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.sourceReelConcurrency = parsePositiveIntegerValue(raw, arg, 1, 8);
  } else if (arg === '--reel-model') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.sourceReelModel = raw;
  } else if (arg === '--reel-target-resolution') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.sourceReelTargetResolution = parsePositiveIntegerValue(raw, arg, 480, 1536);
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
  } else if (arg === '--list-models' || arg === '--live-models') {
    options.liveModelAction = 'list';
    const next = args[i + 1];
    if (next && !next.startsWith('-')) {
      i++;
      options.liveModelQuery = next;
    }
  } else if (arg === '--search-models' || arg === '--find-models') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.liveModelAction = 'search';
    options.liveModelQuery = raw;
  } else if (arg === '--model-media') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    if (!['image', 'video', 'audio', 'all'].includes(raw)) {
      fatalCliError('--model-media must be one of image, video, audio, or all.', {
        code: 'INVALID_ARGUMENT',
        details: { value: raw }
      });
    }
    options.liveModelMedia = raw;
  } else if (arg === '--model-network') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    if (!['fast', 'relaxed'].includes(raw)) {
      fatalCliError('--model-network must be fast or relaxed.', {
        code: 'INVALID_ARGUMENT',
        details: { value: raw }
      });
    }
    options.liveModelNetwork = raw;
  } else if (arg === '--model-tag') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.liveModelTags.push(raw);
  } else if (arg === '--list-loras' || arg === '--loras-catalog') {
    options.loraCatalogAction = 'list';
    const next = args[i + 1];
    if (next && !next.startsWith('-')) {
      i++;
      options.loraCatalogQuery = next;
    }
  } else if (arg === '--search-loras' || arg === '--find-loras') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.loraCatalogAction = 'search';
    options.loraCatalogQuery = raw;
  } else if (arg === '--lora-catalog-model') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.loraCatalogModel = raw;
  } else if (arg === '--lora-category') {
    const raw = requireFlagValue(args, i, arg);
    i++;
    options.loraCatalogCategory = raw;
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
  --sampler <name>      Sampler (images/music; H3 Turbo video: euler|er_sde|sa_solver)
  --scheduler <name>    Scheduler (model-dependent)
  --lora <id>           Image LoRA id (repeatable; order is significant)
  --loras <ids>         Comma-separated LoRA ids
  --lora-strength <n>   LoRA strength (repeatable)
  --lora-strengths <n>  Comma-separated LoRA strengths
  -c, --context <path>  Context image for editing (can use multiple)
  --last-image          Use last generated image as context
  --upscale <path|url>  Promptless NVIDIA RTX VSR upscale, up to 16K (one source image)
  --upscale-scale <n>   Enlarge longest edge by 2, 3, or 4 (default: 2)
  --target-longest-edge <px>  Explicit output longest edge, up to 15360 (overrides scale)

Photobooth (Face Transfer):
  --photobooth            Face transfer mode (InstantID + SDXL Turbo)
  --ref <path|url>        Face image (required with --photobooth)
  --cn-strength <n>       ControlNet strength (default: 0.8)
  --cn-guidance-end <n>   ControlNet guidance end point (default: 0.3)

Music Options:
  --music               Generate music/audio instead of image
  --music-model <id>    Music model: turbo|sft|ace_step_1.5_xl_turbo|ace_step_1.5_xl_sft
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
  --workflow <type>     Video workflow: t2v|i2v|r2v|s2v|ia2v|a2v|v2v|animate-move|animate-replace
  --seedance-task-type <type> Seedance 2.5 loose-reference operation: reference|edit|extend
  --wan3-ratio <ratio>  Wan 3 ratio: adaptive|16:9|4:3|1:1|3:4|9:16
  --smart-duration, --no-smart-duration  Let Wan 3 choose 2-30s, or use --duration
  --reference-file-url <url> Wan 3 public HTTPS document context (one, up to 100 MB; supported paged formats up to 50 pages)
  --reference-link-url <url> Wan 3 public HTTPS webpage context (one; mutually exclusive with file)
  --watermark, --no-watermark  Toggle Wan 3's provider watermark (default: off)
  --fps <num>           Frames per second (model default unless set)
  --duration <sec>      Duration in seconds (default: 5); Seedance 2.5 edit requires @Video1's source duration
  --frames <num>        Override total frames (optional)
  --target-resolution <px> Short-side target that preserves aspect ratio (Seedance 2.5: 480 or 720)
  --auto-resize-assets  Auto-resize video reference assets (default)
  --no-auto-resize-assets  Disable auto-resize for video assets
  --estimate-video-cost Estimate video cost and exit
  --ref <path|url>      Reference image for video (start frame; Picture 1 on H3 r2v)
  --ref-end <path|url>  End frame for interpolation/morphing; with --ref it
                         defaults to the LTX-2.5 i2v first/last-frame workflow
                         (last frame on Seedance; L2VA endpoint on MiniMax H3 i2v)
  --ref-audio <path|url> Audio reference. Repeatable on Seedance and H3 r2v (up to 3 total);
                         first entry is the primary, extras must be HTTPS URLs in CLI
                         direct-gen for Seedance; H3 r2v uploads local/remote files.
                         On LTX/WAN: single primary only (for ia2v/a2v/s2v lip-sync).
  --audio-start <sec>   Start offset into --ref-audio for audio-driven clips
  --audio-duration <sec> Duration slice from --ref-audio
  --reference-audio-identity <path>  Voice identity clip for LTX native audio
  --voice-persona <name>  Use saved persona voice clip as LTX voice identity
  --ref-video <path|url> Video reference. Repeatable on Seedance and H3 r2v (up to 3 total);
                         first entry is the primary, extras must be HTTPS URLs in CLI
                         direct-gen for Seedance. On LTX/WAN: single primary for animate/v2v.
  --generate-audio, --no-generate-audio  Keep/strip H3 audio; enable/disable Wan 3 native audio

Seedance Reference Modes (mutually exclusive on seedance2 / seedance2-mini / seedance2-fast / seedance2-5):
  - DEDICATED FRAME MODE: --ref (first frame) and/or --ref-end (last frame).
    Best when you want canonical first/last frame anchoring; do not attach loose
    image, video, or audio references to the same request.
  - LOOSE REFERENCE MODE: -c/--context image refs plus optional --ref-audio /
    --ref-video extras. Anchor frame intent in the prompt with @Image1, @Image2,
    @Video1, @Audio1 etc. (e.g. "Use @Image1 as the opening shot reference").
    Up to 9 image / 3 video / 3 audio / 12 total references per video request
    on the 2.0 family; seedance2-5 raises the caps to 30 image / 10 video /
    10 audio / 50 total.
  - Typed IA2V exception: with --workflow ia2v, --ref is a loose @Image
    reference beside --ref-audio, not a first_frame anchor. --ref-end is invalid.
  Combining native frame anchors with any loose reference is rejected client-side.
  All three modalities pull caps from the canonical
  @sogni-ai/sogni-protocol seedance-reference-limits catalog.
  --video-start <sec>   Start offset into --ref-video for segmented V2V/animate
  --controlnet-name <n> ControlNet type for v2v: canny|pose|depth|detailer|outpaint|inpaint
  --control-type <n>    Alias for --controlnet-name
  --controlnet-strength <n>  ControlNet strength for v2v (0.0-1.0, default: 0.8)
  --mask <path|url>     Inpaint mask image for LTX v2v inpaint (white = regenerate)
  --outpaint-position <p> LTX outpaint anchor: center|top|bottom|left|right
  --outpaint-aspect-ratio <r> LTX outpaint target ratio, e.g. 16:9 or 9:16
  --sam2-coordinates <coords>  SAM2 click coords for animate-replace (x,y or x1,y1;x2,y2)
  --trim-end-frame      Trim last frame for seamless video stitching
  --first-frame-strength <n>  Keyframe strength for start frame (0.0-1.0)
  --last-frame-strength <n>   Keyframe strength for end frame (0.0-1.0)
  --looping, --loop     Create seamless loop (i2v only): A→B→A
  --last-image          Use last generated image as reference

SourceReel (folder of images → loopable video):
  --source-reel <dir>   Build a video reel from images in a folder (alias: --image-reel)
  --reel-plan-only      Print the planned clips/transitions without rendering
  --reel-image-seconds <sec>      Seconds per animated image clip (default: 3)
  --reel-transition-seconds <sec> Seconds per bridge transition (default: 3)
  --reel-loop / --no-reel-loop    Include final last→first transition (default: loop)
  --reel-image-prompt <text>      Motion prompt for each source image
  --reel-transition-prompt <text> Default transition style between images
  --reel-transition-prompts <json|@file>  Per-transition prompt array/object
  --reel-workdir <dir>  Use/create one working folder (default: <source>/sogni-source-reel-*)
  --reel-output <path>  Final merged mp4 path (default: inside working folder)
  --reel-model <id>     Video model for clips/transitions (default: WAN i2v lightx2v)
  --reel-concurrency <n> Parallel render jobs, 1-8 (default: 2)
  --reel-target-resolution <px> Inferred short side when -w/-h omitted (default: 768)

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
  --expand-prompt, --no-expand-prompt    Toggle local video prompt rewriting; --no-expand-prompt preserves literal wording
  --watch-workflow      Stream workflow events after starting
  --list-workflows      List recent durable creative workflows
  --get-workflow <id>   Fetch a workflow snapshot
  --workflow-events <id> Fetch workflow event history
  --stream-workflow <id> Stream workflow events over SSE
  --cancel-workflow <id> Cancel a running workflow
  --resume-workflow <id> Resume a failed, partial, waiting, or running durable workflow
  --api-base-url <url>  Sogni API base URL (default: ${DEFAULT_API_BASE_URL})

General:
  -t, --timeout <sec>   Timeout in seconds (default: 30, video: 1800, music: 600)
  --steps <num>         Override steps (model-dependent)
  --guidance <num>      Override guidance (model-dependent)
  --token-type <type>   Token type: spark|sogni|auto (default: spark, auto retries with alternate)
  --billing-mode <mode> Billing: auto|subscription|tokens (default: server decides; "subscription"
                        requires Sogni Unlimited coverage, "tokens" opts out of it)
  --balance, --balances Show account, plan, and SPARK/SOGNI balances and exit
  --list-models [query] List live Supernet media models; optionally filter by query
  --search-models <q>   Search live models by ID or name (separator-insensitive)
  --model-media <type>  Filter model discovery: image|video|audio|all (default: all)
  --model-network <n>   Model discovery network: fast|relaxed (default: configured network)
  --model-tag <tag>     Filter by catalog tag, e.g. spicy or uncensored (repeatable, AND)
  --list-loras [query]  List the live LoRA catalog with each LoRA's strength contract
  --search-loras <q>    Search LoRAs by ID, name, category, or description
  --lora-catalog-model <id>  Only LoRAs compatible with that model id
  --lora-category <c>   Filter by catalog category, e.g. character or lighting
  --doctor              Health check: Node, credentials, ffmpeg, auth, plan, config, version
  --snooze-update       Snooze the pending update reminder (1 day → 2 days → 1 week)
  --whats-new [version] Show bundled CHANGELOG entries (everything after <version> if given)
  --version, -V         Show sogni-agent version and exit
  --no-update-check     Skip the once-daily npm update check for this run
  self-update           Upgrade sogni-agent in place (npm/pnpm/yarn/bun auto-detected)
  --extract-last-frame <video> <image>  Extract last frame from a video (safe ffmpeg wrapper)
  --extract-first-frame <video> <image> Extract first frame from a video (safe ffmpeg wrapper)
  --extract-frame-at <video> <sec> <image> Extract a timestamped frame (safe ffmpeg wrapper)
  --trim-video <video> <start> <duration> <output> Create a frame-accurate H.264/AAC clip
  --verify-video <video> Verify streams and fully decode a video (safe ffmpeg/ffprobe wrapper)
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
  krea2_turbo_fp8_scaled          Krea 2 Turbo text-to-image
  dark_beast_krea2_fp8            Dark Beast Krea 2 text-to-image
  krea2_identity_edit_v1_2        Krea 2 Identity Edit LoRA (up to 2 context images)
  dark_beast_krea2_identity_edit_v1_2  Dark Beast Krea 2 Identity Edit (up to 2 context images)
  flux1-schnell-fp8               Very fast
  qwen_image_2512_fp8             High quality
  qwen_image_edit_2511_fp8        Image editing with context (up to 3 images)
  qwen_image_edit_2511_fp8_lightning  Fast image editing
  rtx_vsr_pro                     Promptless deterministic RTX VSR upscale (--upscale)

Recommended LTX 2.5 Video Models:
  ltx25 / ltx25-t2v               Distilled text-to-video with native dialogue/audio
  ltx25-i2v                        Distilled image-to-video and first/last-frame workflow
  ltx25-a2v                        Distilled audio-to-video
  ltx25-ia2v                       Distilled image+audio-to-video
  ltx25-v2v                        Distilled video-to-video control, inpaint, and outpaint
  ltx25-22b-int8_<mode>_dev        Dev/HQ two-stage workflow for t2v/i2v/a2v/ia2v/v2v

LTX 2.3 rollback-only capabilities:
  ltx23-22b-fp8_t2v_distilled     Text-to-video with native dialogue/audio
  ltx23-22b-fp8_i2v_distilled     Image-to-video; transition LoRA only when both frames are supplied
  ltx23-eros                       Explicit uncensored I2V (30GB+ worker; requires --no-filter)
  ltx23-22b-fp8_ia2v_distilled    Image+audio-to-video
  ltx23-22b-fp8_a2v_distilled     Audio-to-video
  ltx23-22b-fp8_v2v_distilled     Video-to-video rollback
  ltx23-22b-10eros-v1.4-fp8mixed_i2v  Private mature-theme I2V; first and/or last frame; requires --no-filter

Music Models:
  ace_step_1.5_xl_turbo           Default direct music generation
  ace_step_1.5_xl_sft             Quality variant with stronger lyric handling
  ace_step_1.5_turbo              Legacy direct music generation
  ace_step_1.5_sft                Legacy lyric-focused music generation

Seedance Video Model Selectors:
  seedance2                         Seedance 2.0 text-to-video, 4-15s, native audio, HTTPS multimodal refs
  seedance2-mini                    Lower-cost 720p-capped text-to-video
  seedance2-fast                    Legacy fast 720p-capped text-to-video
  seedance2-ia2v                    Image+audio-to-video
  seedance2-v2v                     Video-to-video without ControlNet
  seedance2-5                       Seedance 2.5 text-to-video (alias seedance2-5-t2v): 4-30s single clips,
                                     480p/720p only (no 1080p/4K), native audio, first/last frame via
                                     --ref/--ref-end, up to 30 image / 10 video / 10 audio refs (30 total)
  seedance2-5-ia2v                  Seedance 2.5 image+audio-to-video
  seedance2-5-v2v                   Seedance 2.5 video-to-video, editing, and extension, no ControlNet

HappyHorse 1.1 Video Model Selectors (3-15s, fixed 24fps, native audio, 720P/1080P):
  happyhorse-1.1-t2v                Text-to-video (also accepts the bare "happyhorse" alias)
  happyhorse-1.1-i2v                Image-to-video from a single first-frame image (--ref)
  happyhorse-1.1-r2v                Reference-to-video from 1-9 reference images (-c/--context)

MiniMax H3 Video Model Selectors (fixed 24fps, native 32kHz stereo audio + dialogue,
frames 124+n*17 = 5.17-15.08s, sizes /32 up to 1,032,192px. FL2VA/Balanced/Turbo and
image-only R2V need 32GB-class workers; video-conditioned R2V needs above 40GB.
Prompts use MiniMax's exact ordered-field contracts and [Shot N] notation; see
references/video-prompting.md "MiniMax H3 Prompting". No negative prompt field:
state negatives in the structured prompt.):
  minimax-h3                        Text-to-video; --ref selects I2VA, --ref-end L2VA, and both FL2VA
  minimax-h3-i2v                    I2VA from --ref, or L2VA from a closing frame supplied as --ref-end
  minimax-h3-flf2v                  First-frame -> last-frame transition (--ref plus --ref-end)
  minimax-h3-r2v                    Multi-reference video: --ref/-c images, repeatable --ref-video/--ref-audio
                                     (9 images / 3 videos / 3 audios / 12 files total; requires an image or video)
  minimax-h3-balanced               Fixed 8-step Euler/simple PDD tier; infers T2VA/I2VA/L2VA/FL2VA
  minimax-h3-t2v-balanced           Balanced text-to-video
  minimax-h3-i2v-balanced           Balanced I2VA (--ref) or L2VA (--ref-end)
  minimax-h3-flf2v-balanced         Balanced first-frame -> last-frame (--ref plus --ref-end)
  minimax-h3-r2v-balanced           Balanced Ref2VA with loose image/video/audio references
  minimax-h3-turbo                  4-step Turbo; --ref selects I2VA, --ref-end L2VA, and both FL2VA
  minimax-h3-t2v-turbo              4-step Turbo text-to-video
  minimax-h3-i2v-turbo              4-step Turbo I2VA (--ref) or L2VA (--ref-end)
  minimax-h3-flf2v-turbo            4-step Turbo first-frame -> last-frame (--ref plus --ref-end)
  minimax-h3-r2v-turbo              4-step Ref2VA Turbo with loose image/video/audio references
                                     (upstream default: 960x544, Euler/simple)
  H3 FL2VA Turbo sampler override   --sampler euler|er_sde|sa_solver
                                     (Socket default: er_sde; CLI omits unless set)
                                     (scheduler remains fixed to simple)
  H3 Ref2VA Turbo sampler           Euler only; CLI omits unless --sampler euler is passed

WAN 2.2 Video Models:
  wan_v2.2-14b-fp8_t2v_lightx2v   Text-to-video (fast)
  wan_v2.2-14b-fp8_i2v_lightx2v   Default single-image image-to-video (fast)
  wan_v2.2-14b-fp8_i2v            Higher quality
  wan_v2.2-14b-fp8_s2v_lightx2v   Face lip-sync with uploaded audio (fast)
  wan_v2.2-14b-fp8_s2v            Sound-to-video (quality)
  wan_v2.2-14b-fp8_animate-move_lightx2v     Animate-move (fast)
  wan_v2.2-14b-fp8_animate-replace_lightx2v  Animate-replace (fast)

LTX-2.5 standard models (Distilled fast path; replace _distilled with _dev for Dev/HQ):
  ltx25-22b-int8_t2v_distilled    Text-to-video with native audio
  ltx25-22b-int8_i2v_distilled    Image-to-video; also first/last-frame conditioning
  ltx25-22b-int8_a2v_distilled    Audio-to-video
  ltx25-22b-int8_ia2v_distilled   Image+audio-to-video
  ltx25-22b-int8_v2v_distilled    Video-to-video controls, inpaint, and outpaint

LTX-2 / LTX-2.3 rollback models:
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
  sogni-agent --source-reel ./images --reel-plan-only
  sogni-agent --source-reel ./images --reel-image-seconds 3 --reel-transition-seconds 3 --reel-image-prompt "friendly camera-ready motion"
  sogni-agent --music --duration 30 "uplifting cinematic synthwave theme for a product launch"
  sogni-agent --music --lyrics "Rise with the morning light" --bpm 128 --keyscale "C major" --output-format mp3 "bright indie pop chorus"
  sogni-agent --video --reference-audio-identity voice.webm 'NARRATOR: "This is my voice."'
  sogni-agent --api-chat "Create a 4-shot product video concept for a red sneaker"
  sogni-agent --api-workflow --video-prompt "slow push-in as it comes alive" "a graphite robot sketch"
  sogni-agent --api-workflow --workflow-input @workflow.json
  sogni-agent --api-workflow storyboard-video --storyboard-frames 6 "Create a 12s 9:16 bakery launch video with GPT Image 2 and Seedance"
  sogni-agent --video -m ltx25 --duration 20 "A wide cinematic aerial shot opens over steep tropical cliffs at golden hour, warm sunlight grazing the rock faces while sea mist drifts above the water below. Palm trees bend gently along the ridge as waves roll against the shoreline, leaving bright bands of foam across the dark stone. The camera glides forward in one continuous pass, revealing more of the coastline as sunlight flickers across wet surfaces and distant birds wheel through the haze. The scene holds a calm, upscale travel-film mood with smooth stabilized motion and crisp environmental detail."
  sogni-agent --video --ref subject.jpg --ref-video motion.mp4 --workflow animate-move "transfer motion"
  sogni-agent --video --last-image "gentle camera pan"
  sogni-agent -c photo.jpg "make the background a beach" -m qwen_image_edit_2511_fp8
  sogni-agent -c person.jpg -m krea2_identity_edit_v1_2 "editorial portrait, same identity, new wardrobe"
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

if (options.billingMode) {
  const mode = String(options.billingMode).toLowerCase();
  if (mode !== 'auto' && mode !== 'subscription' && mode !== 'tokens') {
    fatalCliError('--billing-mode must be "auto", "subscription", or "tokens".', {
      code: 'INVALID_ARGUMENT',
      details: { flag: '--billing-mode', value: options.billingMode }
    });
  }
  options.billingMode = mode;
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

  if (options.model && !isQwenImageEdit2511ModelSelection(options.model)) {
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
    options.guidance = isLightningImageModelSelection(options.model) ? 1.0 : 4.0;
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

if (options.video) {
  options.model = resolveSkillVideoModelAlias(options.model);
  if (options.model === LTX23_10EROS_MODEL_ID && !options.noFilter) {
    fatalCliError(
      `LTX-2.3 10Eros is an opt-in mature-theme model and requires --no-filter.`,
      { code: 'INVALID_ARGUMENT' }
    );
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

if (!options.video && options.loras.length > 8) {
  fatalCliError('Image generation supports at most 8 LoRAs per render.', {
    code: 'INVALID_ARGUMENT',
    details: { loras: options.loras.length, maximum: 8 }
  });
}

if (options.music && options.loras.length > 0) {
  fatalCliError('--lora options are not supported for music.', { code: 'INVALID_ARGUMENT' });
}

if (options.video && options.loras.length > 0) {
  if (options.loras.length > 8) {
    fatalCliError('Video generation supports at most 8 LoRAs per render.', {
      code: 'INVALID_ARGUMENT',
      details: { loras: options.loras.length, maximum: 8 }
    });
  }

  if (options.loras.includes(DR34ML4Y_LORA_ID)) {
    // dr34ml4y is worker-internal: it ships no public catalog row, so it cannot
    // be checked against the catalog and keeps the hardcoded gate it has always
    // had. Mixing it with a catalogued adapter is a model conflict either way.
    const foreignLoras = options.loras.filter(loraId => loraId !== DR34ML4Y_LORA_ID);
    if (foreignLoras.length > 0) {
      fatalCliError(
        `"${DR34ML4Y_LORA_ID}" cannot be stacked with "${foreignLoras[0]}"; ` +
        'they belong to different model families.',
        { code: 'INVALID_ARGUMENT' }
      );
    }
    if (!DR34ML4Y_SUPPORTED_MODEL_IDS.has(options.model)) {
      fatalCliError(
        `"${DR34ML4Y_LORA_ID}" requires a supported LTX-2.3 I2V model: ` +
        'ltx23-22b-fp8_i2v, ltx23-22b-fp8_i2v_dev, or 10eros. ' +
        'The separately trained WAN DR34ML4Y artifact is not installed on Sogni.',
        { code: 'INVALID_ARGUMENT' }
      );
    }
    if (!options.noFilter) {
      fatalCliError(
        `"${DR34ML4Y_LORA_ID}" is an opt-in mature-theme LoRA and requires --no-filter.`,
        { code: 'INVALID_ARGUMENT' }
      );
    }
    if (options.loraStrengths.length === 0) {
      options.loraStrengths = options.loras.map(() => DR34ML4Y_DEFAULT_STRENGTH);
    }
  } else {
    // Every publicly catalogued video LoRA — the MiniMax H3 adapters today — is
    // checked against the live catalog for the RESOLVED model id. Keying on the
    // catalog rather than a hardcoded list means an adapter published later
    // works without a CLI release, and a wrong id fails here instead of being
    // dropped server-side and rendering as if no LoRA had been asked for.
    let videoLoraCatalog;
    try {
      videoLoraCatalog = await fetchLoraCatalog(options.model);
    } catch (cause) {
      fatalCliError(
        `Could not read the LoRA catalog for "${options.model}": ${cause?.message || cause}`,
        { code: cause?.code || 'LORA_CATALOG_UNAVAILABLE' }
      );
    }
    const videoLoraEntries = new Map(
      (videoLoraCatalog?.loras || [])
        .map(loraCatalogEntryFromPayload)
        .filter(entry => entry.loraId)
        .map(entry => [entry.loraId, entry])
    );
    const unknownVideoLoras = options.loras.filter(loraId => !videoLoraEntries.has(loraId));
    if (unknownVideoLoras.length > 0) {
      const availableIds = [...videoLoraEntries.keys()];
      const isUnresolvedH3Alias = /^minimax-h3(-turbo)?$/.test(String(options.model || ''));
      fatalCliError(
        `Video LoRA "${unknownVideoLoras[0]}" is not published for model "${options.model}". ` +
        (availableIds.length > 0
          ? `Available for this model: ${availableIds.join(', ')}.`
          : isUnresolvedH3Alias
            ? 'Name an explicit H3 mode (for example -m minimax-h3-i2v); LoRA availability differs per mode.'
            : 'That model loads no LoRAs.') +
        ' Run --list-loras --lora-model <id> for the live catalog.',
        { code: 'INVALID_ARGUMENT' }
      );
    }
    const matureVideoLoras = options.loras.filter(loraId => {
      const entry = videoLoraEntries.get(loraId);
      return Boolean(entry?.nsfw || entry?.sexual);
    });
    if (matureVideoLoras.length > 0 && !options.noFilter) {
      fatalCliError(
        `"${matureVideoLoras[0]}" is an opt-in mature-theme LoRA and requires --no-filter.`,
        { code: 'INVALID_ARGUMENT' }
      );
    }
    if (options.loraStrengths.length === 0) {
      // The catalog default, not 1.0: the worker falls back to 1.0 for any LoRA
      // sent without a strength, which for h3-realism-people is already the top
      // of its usable band.
      options.loraStrengths = options.loras.map(loraId => {
        const entry = videoLoraEntries.get(loraId);
        return Number.isFinite(entry?.default) ? entry.default : 1;
      });
    }
  }
}

if (options.video && options.scheduler) {
  fatalCliError('--scheduler is an image-only option.', { code: 'INVALID_ARGUMENT' });
}

if (options.video && options.sampler) {
  if (!isMiniMaxH3TurboModelSelectionLocal(options.model)) {
    fatalCliError('--sampler is supported for video only with MiniMax H3 Turbo.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model }
    });
  }
  if (!MINIMAX_H3_TURBO_SAMPLER_SET.has(options.sampler)) {
    fatalCliError(`MiniMax H3 Turbo --sampler must be one of: ${MINIMAX_H3_TURBO_SAMPLERS.join(', ')}.`, {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, sampler: options.sampler, allowed: MINIMAX_H3_TURBO_SAMPLERS }
    });
  }
  if (isMiniMaxH3R2vTurboSelectionLocal(options.model, options.videoWorkflow) && options.sampler !== 'euler') {
    fatalCliError('MiniMax H3 Ref2VA Turbo --sampler must be euler.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, sampler: options.sampler, allowed: ['euler'] }
    });
  }
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
    if (normalized) {
      options.videoWorkflow = normalized;
    } else if (
      options.videoWorkflow === 'r2v'
      && (
        isHappyHorseModelSelectionLocal(options.model)
        || isMiniMaxH3ModelSelectionLocal(options.model)
        || isWan3ModelSelectionLocal(options.model)
      )
    ) {
      // These unified/reference models accept loose reference-to-video input
      // even when the pinned shared SkillVideoWorkflow enum predates r2v.
      options.videoWorkflow = 'r2v';
    } else {
      fatalCliError(`Unknown workflow "${options.videoWorkflow}". Use t2v|i2v|s2v|ia2v|a2v|v2v|animate-move|animate-replace (r2v on HappyHorse, MiniMax H3, or Wan 3).`, {
        code: 'INVALID_ARGUMENT',
        details: { workflow: options.videoWorkflow }
      });
    }
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
    } else if (options.refAudio && options.refImage) {
      options.videoWorkflow = 'ia2v';
    } else {
      options.videoWorkflow = 't2v';
    }
  }

  // Wan 3 is one unified Alibaba model. The selected media shape chooses the
  // operation; unlike HappyHorse, no workflow suffix is appended to the model.
  // In audio/video workflows --ref is a loose reference image. In i2v it is a
  // dedicated first-frame anchor and may be paired with --ref-end.
  if (isWan3ModelSelectionLocal(options.model)) {
    if (!options.videoWorkflow) {
      const hasLooseImages = Array.isArray(options.contextImages) && options.contextImages.length > 0;
      const hasAudio = Boolean(options.refAudio || options.refAudios.length > 0);
      const hasVideo = Boolean(options.refVideo || options.refVideos.length > 0);
      if (hasVideo) {
        options.videoWorkflow = 'r2v';
      } else if (hasAudio && (options.refImage || hasLooseImages)) {
        options.videoWorkflow = 'ia2v';
      } else if (hasAudio) {
        options.videoWorkflow = 'a2v';
      } else if (hasLooseImages) {
        options.videoWorkflow = 'r2v';
      } else if (options.refImage || options.refImageEnd) {
        options.videoWorkflow = 'i2v';
      } else {
        options.videoWorkflow = 't2v';
      }
    }
    options.model = WAN3_MODEL_ID;
  }

  // Each MiniMax H3 tier has four concrete worker selectors and five prompt
  // shapes. The FL2VA checkpoint covers t2v, first-frame i2v, last-frame-only
  // l2v, and first/last-frame (represented by the CLI's i2v workflow); Ref2VA
  // is a separate r2v checkpoint and is never inferred from loose references.
  // Selecting the tier's minimax-h3-r2v* alias or explicitly passing
  // --workflow r2v with its bare tier selector is required.
  if (isMiniMaxH3ModelSelectionLocal(options.model)) {
    const pinnedMode = miniMaxH3ModeFromModelId(options.model);
    const pinnedWorkflow = pinnedMode === 'flf2v' ? 'i2v' : pinnedMode;
    if (pinnedWorkflow) {
      if (options.videoWorkflow && options.videoWorkflow !== pinnedWorkflow) {
        fatalCliError(`Workflow "${options.videoWorkflow}" does not match model "${options.model}".`, {
          code: 'INVALID_ARGUMENT',
          details: { workflow: options.videoWorkflow, model: options.model }
        });
      }
      options.videoWorkflow = pinnedWorkflow;
    } else if (!options.videoWorkflow) {
      options.videoWorkflow = (options.refImage || options.refImageEnd) ? 'i2v' : 't2v';
    }
    options.model = resolveSkillVideoModelAlias(
      options.model,
      options.videoWorkflow,
      Boolean(options.refImage),
      Boolean(options.refImageEnd)
    );
  }

  // HappyHorse 1.1 has no v2v/ia2v. A concrete `happyhorse-1.1-<mode>` id pins
  // the workflow; the bare `happyhorse` / `happyhorse-1.1` alias infers t2v by
  // default, i2v from a single first-frame image (--ref), and r2v from loose
  // -c/--context reference images (1-9). Pin the concrete per-mode model id.
  if (isHappyHorseModelSelectionLocal(options.model)) {
    const pinnedMode = happyHorseModeFromModelId(options.model);
    if (pinnedMode) {
      if (options.videoWorkflow && options.videoWorkflow !== pinnedMode) {
        fatalCliError(`Workflow "${options.videoWorkflow}" does not match model "${options.model}".`, {
          code: 'INVALID_ARGUMENT',
          details: { workflow: options.videoWorkflow, model: options.model }
        });
      }
      options.videoWorkflow = pinnedMode;
    } else if (!options.videoWorkflow) {
      if (Array.isArray(options.contextImages) && options.contextImages.length > 0) {
        options.videoWorkflow = 'r2v';
      } else if (options.refImage) {
        options.videoWorkflow = 'i2v';
      } else {
        options.videoWorkflow = 't2v';
      }
    }
    options.model = resolveHappyHorseModelId(options.model, options.videoWorkflow);
  }

  const workflowFromModel =
    ltx25WorkflowFromModelSelection(options.model) ||
    inferVideoWorkflowFromModel(resolveVideoModelAlias(options.model, options.videoWorkflow));
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
    options.model = resolveVideoModelAlias(
      resolveSkillVideoModelAlias(
        options.model,
        options.videoWorkflow,
        Boolean(options.refImage),
        Boolean(options.refImageEnd),
      ),
      options.videoWorkflow
    );
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
    fatalCliError(`Unknown music model "${configuredMusicModel}". Use turbo, sft, ace_step_1.5_xl_turbo, or ace_step_1.5_xl_sft.`, {
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
  if (!options.model) {
    let defaultVideoModel = selectDefaultVideoModel(options.videoWorkflow, options, openclawConfig);
    const configuredWorkflowModel = openclawConfig?.videoModels?.[options.videoWorkflow];
    if (!configuredWorkflowModel) {
      defaultVideoModel = upgradeBuiltInLtx23Default(defaultVideoModel, options.videoWorkflow);
    }
    // Two-image first/last-frame animation defaults to the current LTX-2.5
    // i2v/FLF workflow. A configured videoModels.i2v or an LTX pick from
    // audio/quality routing still wins.
    if (
      options.videoWorkflow === 'i2v'
      && options.refImage && options.refImageEnd
      && !openclawConfig?.videoModels?.i2v
      && !isLtxFamilyModel(defaultVideoModel)
    ) {
      defaultVideoModel = LTX25_DISTILLED_WORKFLOW_MODELS.i2v;
    }
    options.model = defaultVideoModel || 'wan_v2.2-14b-fp8_i2v_lightx2v';
  }
  // Voice identity is a legacy LTX 2.3-only capability. Route an implicit
  // request (including an OpenClaw default) to the matching 2.3 workflow, but
  // preserve an explicit -m choice so the validation below can reject an
  // incompatible LTX 2.5 selection clearly.
  if (
    (options.referenceAudioIdentity || options.voicePersonaName)
    && !cliSet.model
    && (options.videoWorkflow === 't2v' || options.videoWorkflow === 'i2v')
  ) {
    options.model = LTX23_WORKFLOW_MODELS[options.videoWorkflow];
  }
  options.model = resolveVideoModelAlias(options.model, options.videoWorkflow);
  try {
    await loadLiveModelDefaults(options.model);
  } catch (error) {
    fatalCliError(error?.message || 'Could not load the live Sogni model catalog.', {
      code: error?.code || 'MODEL_CATALOG_UNAVAILABLE',
      hint: error?.hint
    });
  }
  const videoModelDefaults = getModelDefaults(options.model, openclawConfig);
  if (videoModelDefaults?.requiresDisabledSafetyFilter) {
    if (!options.noFilter) {
      fatalCliError('LTX-2.3 10Eros requires explicit --no-filter acknowledgement.', {
        code: 'INVALID_ARGUMENT',
        details: { model: options.model, requiredFlag: '--no-filter' },
        hint: 'Retry with --video --workflow i2v --ref <image> -m ltx23-eros --no-filter'
      });
    }
    const fixedSettings = {
      steps: videoModelDefaults.steps,
      guidance: videoModelDefaults.guidance,
      sampler: videoModelDefaults.sampler,
      scheduler: videoModelDefaults.scheduler
    };
    for (const [setting, expected] of Object.entries(fixedSettings)) {
      if (expected === undefined) continue;
      if (cliSet[setting] && options[setting] !== expected) {
        fatalCliError(`LTX-2.3 10Eros requires --${setting} ${expected}.`, {
          code: 'INVALID_ARGUMENT',
          details: { model: options.model, setting, expected, received: options[setting] }
        });
      }
      options[setting] = expected;
    }
  }
  // Fall back to skill-local defaults for models the intel registry does not
  // carry (e.g. HappyHorse), so they get a sensible 16:9 default instead of the
  // 512x512 square. Registry defaults still take precedence when present.
  const videoModelDimensionFallback = videoModelDimensionDefaultsLikeWrapper(options.model);
  const defaultVideoWidth = Number.isFinite(videoModelDefaults?.defaultWidth)
    ? videoModelDefaults.defaultWidth
    : videoModelDimensionFallback?.defaultWidth;
  const defaultVideoHeight = Number.isFinite(videoModelDefaults?.defaultHeight)
    ? videoModelDefaults.defaultHeight
    : videoModelDimensionFallback?.defaultHeight;
  const isSeedanceVideo = isSeedanceModel(options.model);
  if (!cliSet.width && !widthFromConfig && !widthFromPrompt && Number.isFinite(defaultVideoWidth)) {
    options.width = defaultVideoWidth;
  }
  if (!cliSet.height && !heightFromConfig && !heightFromPrompt && Number.isFinite(defaultVideoHeight)) {
    options.height = defaultVideoHeight;
  }
  if (!cliSet.fps && !fpsFromConfig && Number.isFinite(videoModelDefaults?.fps)) {
    options.fps = videoModelDefaults.fps;
  }
  const videoQuality = options.quality ? QUALITY_TIERS[options.quality]?.video : null;
  if (videoQuality) {
    if (
      !isSeedanceVideo
      && options.model !== LTX23_10EROS_MODEL_ID
      && !cliSet.steps
      && Number.isFinite(videoQuality.steps)
    ) {
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
    options.timeout = 1800000; // 30 min for queued and long-running video jobs
  }
} else if (options.upscaleImage) {
  if (options.model && options.model !== RTX_VSR_MODEL_ID) {
    fatalCliError(`--upscale requires model ${RTX_VSR_MODEL_ID}.`, {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, requiredModel: RTX_VSR_MODEL_ID }
    });
  }
  options.model = RTX_VSR_MODEL_ID;
  if (!cliSet.timeout && !timeoutFromConfig && options.timeout === 30000) {
    options.timeout = 120000;
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
  // Use the default edit model when context images are provided unless -m overrides it.
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
const liveModelUtilityAction = Boolean(options.liveModelAction);
const loraCatalogUtilityAction = Boolean(options.loraCatalogAction);
const apiReplayUtilityAction = Boolean(options.apiReplayAction);
const personaUtilityAction = Boolean(options.personaAction && options.personaAction !== 'generate');
const contractUtilityAction = Boolean(options.contractAction);
const storyboardPlanUtilityAction = Boolean(options.storyboardPlanAction);
const commandUsesGenerationSeed = !options.apiChat &&
  !apiWorkflowUtilityAction &&
  !apiModelUtilityAction &&
  !liveModelUtilityAction &&
  !loraCatalogUtilityAction &&
  !apiReplayUtilityAction &&
  !contractUtilityAction &&
  !storyboardPlanUtilityAction &&
  !options.estimateVideoCost &&
  !options.showBalance &&
  !options.showVersion &&
  !options.doctor &&
  !options.extractLastFrame &&
  !options.extractFirstFrame &&
  !options.extractFrameAt &&
  !options.verifyVideo &&
  !options.concatVideos &&
  !options.trimVideo &&
  !options.sourceReelDir &&
  !options.remixAudio &&
  !options.upscaleImage &&
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
if (!liveModelUtilityAction && (options.liveModelMedia !== 'all' || options.liveModelNetwork || options.liveModelTags.length > 0)) {
  fatalCliError('--model-media, --model-network, and --model-tag require --list-models or --search-models.', {
    code: 'INVALID_ARGUMENT'
  });
}
if (!loraCatalogUtilityAction && (options.loraCatalogModel || options.loraCatalogCategory)) {
  fatalCliError('--lora-catalog-model and --lora-category require --list-loras or --search-loras.', {
    code: 'INVALID_ARGUMENT'
  });
}
// Normalize a whitespace-only prompt to empty so the guard below treats it as
// "no prompt" rather than silently sending blank text to the server.
if (typeof options.prompt === 'string' && options.prompt.trim() === '') {
  options.prompt = '';
}
const wan3ReferenceMediaCache = new Map();
const wan3ReferencePreparationPlan = new Map();
const wan3HasMediaInput = isWan3ModelLocal(options.model) && Boolean(
  options.refImage
  || options.refImageEnd
  || options.refAudio
  || options.refVideo
  || options.contextImages.length > 0
  || options.refAudios.length > 0
  || options.refVideos.length > 0
  || options.wan3ReferenceFileUrl
  || options.wan3ReferenceLinkUrl
);
if (!options.prompt && !wan3HasMediaInput && !options.upscaleImage && !options.apiChat && !apiWorkflowUtilityAction && !apiWorkflowStartAction && !apiModelUtilityAction && !liveModelUtilityAction && !loraCatalogUtilityAction && !apiReplayUtilityAction && !contractUtilityAction && !storyboardPlanUtilityAction && !options.estimateVideoCost && !options.multiAngle && !options.showBalance && !options.showVersion && !options.doctor && !options.extractLastFrame && !options.extractFirstFrame && !options.extractFrameAt && !options.trimVideo && !options.verifyVideo && !options.concatVideos && !options.sourceReelDir && !options.remixAudio && !options.listMedia && !options.memoryAction && !options.personalityAction && !personaUtilityAction) {
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

if (options.upscaleImage) {
  if (options.prompt) {
    fatalCliError('--upscale is promptless and does not accept a prompt.', { code: 'INVALID_ARGUMENT' });
  }
  if (options.video || options.music || options.photobooth || options.contextImages.length > 0 || options.refImage || options.refImageEnd) {
    fatalCliError('--upscale cannot be combined with video, music, photobooth, --ref, --ref-end, or -c/--context.', {
      code: 'INVALID_ARGUMENT'
    });
  }
  if (options.count !== 1) {
    fatalCliError('--upscale produces exactly one output; omit -n/--count or set it to 1.', {
      code: 'INVALID_ARGUMENT',
      details: { count: options.count }
    });
  }
  if (cliSet.width || cliSet.height) {
    fatalCliError('--upscale derives dimensions from the source; use --upscale-scale or --target-longest-edge.', {
      code: 'INVALID_ARGUMENT'
    });
  }
}

if (!options.upscaleImage && (cliSet.upscaleScale || cliSet.upscaleTargetLongestEdge)) {
  fatalCliError('--upscale-scale and --target-longest-edge require --upscale <path|url>.', {
    code: 'INVALID_ARGUMENT'
  });
}

if (options.legacyWan3TaskType !== null) {
  fatalCliError(
    '--wan3-task-type has been removed because Wan 3 has no provider edit/extend task mode. Use --workflow r2v with --ref-video for loose conditioning, or select a video-to-video model for editing.',
    {
      code: 'INVALID_ARGUMENT',
      details: { wan3TaskType: options.legacyWan3TaskType }
    }
  );
}

if (!options.video && !options.apiChat && !options.apiWorkflowAction && (options.refAudio || options.refVideo || options.refMask || options.referenceAudioIdentity || options.voicePersonaName || options.videoWorkflow || options.seedanceTaskType || options.wan3SmartDuration || options.wan3ReferenceFileUrl || options.wan3ReferenceLinkUrl || options.wan3Watermark || cliSet.wan3Ratio || options.frames || options.targetResolution || options.audioStart !== null || options.audioDuration !== null || options.videoStart !== null || options.outpaintPosition || options.outpaintAspectRatio)) {
  fatalCliError('Video-only options (--workflow/--seedance-task-type/--wan3-ratio/--smart-duration/--reference-file-url/--reference-link-url/--watermark/--frames/--target-resolution/--ref-audio/--ref-video/--mask/--outpaint-position/--reference-audio-identity/--voice-persona) require --video.', {
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
  const isSeedance25Video = isSeedance25ModelSelectionLocal(options.model);
  const isHappyHorseVideo = isHappyHorseModel(options.model);
  const isWan3Video = isWan3ModelLocal(options.model);
  const isMiniMaxH3Video = isMiniMaxH3Model(options.model);
  const isMiniMaxH3R2v = isMiniMaxH3R2vModel(options.model);
  if (options.seedanceTaskType && !SEEDANCE_TASK_TYPES.has(options.seedanceTaskType)) {
    fatalCliError('--seedance-task-type must be one of: reference, edit, extend.', {
      code: 'INVALID_ARGUMENT',
      details: { seedanceTaskType: options.seedanceTaskType }
    });
  }
  if (options.seedanceTaskType && !isSeedance25Video) {
    fatalCliError('--seedance-task-type is supported only by Seedance 2.5.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, seedanceTaskType: options.seedanceTaskType }
    });
  }
  if ((cliSet.wan3Ratio || options.wan3SmartDuration || options.wan3ReferenceFileUrl || options.wan3ReferenceLinkUrl || options.wan3Watermark) && !isWan3Video) {
    fatalCliError('Wan 3 controls are supported only by wan3 / wan3.0-video.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model }
    });
  }
  if (isWan3Video && !WAN3_SUPPORTED_RATIOS.has(options.wan3Ratio)) {
    fatalCliError('--wan3-ratio must be one of: adaptive, 16:9, 4:3, 1:1, 3:4, 9:16.', {
      code: 'INVALID_ARGUMENT',
      details: { ratio: options.wan3Ratio }
    });
  }
  if (isWan3Video && options.wan3SmartDuration && (cliSet.duration || cliSet.frames)) {
    fatalCliError('--smart-duration cannot be combined with --duration or --frames.', {
      code: 'INVALID_ARGUMENT'
    });
  }
  if (isSeedance25Video && !options.seedanceTaskType) {
    if (options.videoWorkflow === 'v2v') {
      options.seedanceTaskType = 'edit';
    } else if (
      options.videoWorkflow === 'ia2v' ||
      options.contextImages.length > 0 ||
      options.refAudio ||
      options.refAudios.length > 0 ||
      options.refVideo ||
      options.refVideos.length > 0
    ) {
      options.seedanceTaskType = 'reference';
    }
  }
  const seedance25TypedIa2vImage =
    options.videoWorkflow === 'ia2v' && options.refImage && !options.refImageEnd;
  if (
    options.seedanceTaskType &&
    (options.refImageEnd || (options.refImage && !seedance25TypedIa2vImage))
  ) {
    fatalCliError(
      'Seedance 2.5 reference/edit/extend uses loose media only. Use -c/--context for images; omit --ref/--ref-end frame anchors.',
      {
        code: 'INVALID_ARGUMENT',
        details: { seedanceTaskType: options.seedanceTaskType }
      }
    );
  }
  if (
    (options.seedanceTaskType === 'edit' || options.seedanceTaskType === 'extend') &&
    !options.refVideo && options.refVideos.length === 0
  ) {
    fatalCliError(`Seedance 2.5 ${options.seedanceTaskType} requires --ref-video.`, {
      code: 'INVALID_ARGUMENT',
      details: { seedanceTaskType: options.seedanceTaskType }
    });
  }
  if (
    options.seedanceTaskType === 'reference' &&
    options.contextImages.length === 0 &&
    !options.refAudio && options.refAudios.length === 0 &&
    !options.refVideo && options.refVideos.length === 0
  ) {
    fatalCliError(`Seedance 2.5 ${options.seedanceTaskType} requires at least one loose reference.`, {
      code: 'INVALID_ARGUMENT',
      details: { seedanceTaskType: options.seedanceTaskType }
    });
  }
  if (options.seedanceTaskType === 'edit' && !cliSet.duration) {
    fatalCliError(
      'Seedance 2.5 edit requires --duration set to @Video1\'s source duration.',
      {
        code: 'INVALID_ARGUMENT',
        details: { seedanceTaskType: options.seedanceTaskType }
      }
    );
  }
  if (
    (options.seedanceTaskType === 'edit' || options.seedanceTaskType === 'extend') &&
    (cliSet.width || cliSet.height)
  ) {
    fatalCliError(
      `Seedance 2.5 ${options.seedanceTaskType} inherits @Video1's aspect ratio; use --target-resolution 480 or 720 instead of --width/--height.`,
      {
        code: 'INVALID_ARGUMENT',
        details: { seedanceTaskType: options.seedanceTaskType }
      }
    );
  }
  if (
    isSeedance25Video &&
    cliSet.targetResolution &&
    ![480, 720].includes(options.targetResolution)
  ) {
    fatalCliError('Seedance 2.5 --target-resolution must be 480 or 720.', {
      code: 'INVALID_ARGUMENT',
      details: { targetResolution: options.targetResolution }
    });
  }
  if (isWan3Video && cliSet.targetResolution && !WAN3_SUPPORTED_RESOLUTIONS.has(options.targetResolution)) {
    fatalCliError('Wan 3 --target-resolution must be 480, 720, or 1080.', {
      code: 'INVALID_ARGUMENT',
      details: { targetResolution: options.targetResolution }
    });
  }
  const seedanceWorkflows = isSeedance25Video
    ? ['t2v', 'ia2v', 'a2v', 'v2v']
    : ['t2v', 'ia2v', 'v2v'];
  if (isSeedanceVideo && !seedanceWorkflows.includes(options.videoWorkflow)) {
    fatalCliError(isSeedance25Video
      ? 'Seedance 2.5 supports only t2v, ia2v, a2v, or v2v workflows.'
      : 'Seedance 2.0 models support only t2v, ia2v, or v2v workflows.', {
      code: 'INVALID_ARGUMENT',
      details: { workflow: options.videoWorkflow, model: options.model }
    });
  }
  if (isHappyHorseVideo && !['t2v', 'i2v', 'r2v'].includes(options.videoWorkflow)) {
    fatalCliError('HappyHorse models support only t2v, i2v, or r2v workflows.', {
      code: 'INVALID_ARGUMENT',
      details: { workflow: options.videoWorkflow, model: options.model }
    });
  }
  if (isWan3Video && !WAN3_SUPPORTED_WORKFLOWS.has(options.videoWorkflow)) {
    fatalCliError('Wan 3 supports t2v, i2v/flf, r2v, a2v, and ia2v workflows. Video inputs are loose r2v references, not source-video edit or extend tasks.', {
      code: 'INVALID_ARGUMENT',
      details: { workflow: options.videoWorkflow, model: options.model }
    });
  }
  if (isMiniMaxH3Video && !['t2v', 'i2v', 'r2v'].includes(options.videoWorkflow)) {
    fatalCliError('MiniMax H3 models support only t2v, i2v/flf2v, or r2v workflows.', {
      code: 'INVALID_ARGUMENT',
      details: { workflow: options.videoWorkflow, model: options.model }
    });
  }
  if (isHappyHorseVideo && options.videoControlNetName) {
    fatalCliError('HappyHorse video models do not support ControlNet.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, controlNetName: options.videoControlNetName }
    });
  }
  if (isWan3Video && (options.videoControlNetName || options.refMask || options.referenceAudioIdentity)) {
    fatalCliError('Wan 3 does not support ControlNet, masks, or LTX voice-identity references.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model }
    });
  }
  if (isMiniMaxH3Video && (options.videoControlNetName || options.refMask || options.referenceAudioIdentity)) {
    fatalCliError('MiniMax H3 does not support ControlNet, masks, or LTX voice-identity references.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model }
    });
  }
  if (isMiniMaxH3Video && (cliSet.steps || cliSet.guidance)) {
    fatalCliError('MiniMax H3 uses fixed sampling settings; omit --steps and --guidance.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, steps: options.steps, guidance: options.guidance }
    });
  }
  if (isWan3Video && (cliSet.steps || cliSet.guidance)) {
    fatalCliError('Wan 3 uses vendor-managed sampling settings; omit --steps and --guidance.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, steps: options.steps, guidance: options.guidance }
    });
  }
  if (isWan3Video && typeof options.prompt === 'string' && options.prompt.length > 20000) {
    fatalCliError('Wan 3 prompts must be 20,000 characters or fewer.', {
      code: 'INVALID_ARGUMENT',
      details: { promptLength: options.prompt.length, maximum: 20000 }
    });
  }
  if (isWan3Video && cliSet.seed && (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > WAN3_MAX_SEED)) {
    fatalCliError(`Wan 3 --seed must be an integer from 0 through ${WAN3_MAX_SEED}.`, {
      code: 'INVALID_ARGUMENT',
      details: { seed: options.seed }
    });
  }
  if (isHappyHorseVideo && options.apiGenerateAudio !== null) {
    fatalCliError('HappyHorse native audio is always on; omit --generate-audio/--no-generate-audio.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model }
    });
  }

  if (isWan3Video) {
    const looseImages = (options.refImage && options.videoWorkflow !== 'i2v' ? 1 : 0)
      + options.contextImages.length;
    const looseVideos = (options.refVideo ? 1 : 0) + options.refVideos.length;
    const looseAudios = (options.refAudio ? 1 : 0) + options.refAudios.length;
    const looseTotal = looseImages + looseVideos + looseAudios;
    const hasFrameInputs = options.videoWorkflow === 'i2v' && Boolean(options.refImage || options.refImageEnd);
    const hasReferenceFile = Boolean(options.wan3ReferenceFileUrl);
    const hasReferenceLink = Boolean(options.wan3ReferenceLinkUrl);

    if (hasReferenceFile && hasReferenceLink) {
      fatalCliError('Wan 3 accepts either --reference-file-url or --reference-link-url, not both.', {
        code: 'INVALID_ARGUMENT'
      });
    }
    if (
      (hasReferenceFile && !isHttpsUrl(options.wan3ReferenceFileUrl)) ||
      (hasReferenceLink && !isHttpsUrl(options.wan3ReferenceLinkUrl))
    ) {
      fatalCliError('Wan 3 document and webpage context must use public HTTPS URLs.', {
        code: 'INVALID_URL'
      });
    }
    if ((hasReferenceFile || hasReferenceLink) && hasFrameInputs) {
      fatalCliError('Wan 3 document/webpage context cannot be combined with first/last-frame anchors.', {
        code: 'INVALID_ARGUMENT'
      });
    }
    if (options.refImageEnd && !options.refImage) {
      fatalCliError('Wan 3 last-frame generation requires --ref as the first-frame image.', { code: 'INVALID_ARGUMENT' });
    }
    if (options.videoWorkflow === 't2v' && (hasFrameInputs || looseTotal > 0 || options.refImageEnd)) {
      fatalCliError('Wan 3 t2v does not accept reference media; choose i2v, r2v, a2v, or ia2v.', { code: 'INVALID_ARGUMENT' });
    }
    if (options.videoWorkflow === 'i2v') {
      if (!options.refImage) {
        fatalCliError('Wan 3 i2v requires --ref as its first-frame image.', { code: 'INVALID_ARGUMENT' });
      }
      if (options.contextImages.length > 0 || looseVideos > 0 || looseAudios > 0) {
        fatalCliError('Wan 3 first/last-frame anchors cannot be combined with loose image, video, or audio references.', { code: 'INVALID_ARGUMENT' });
      }
    }
    if (options.videoWorkflow === 'r2v') {
      if (options.refImageEnd) {
        fatalCliError('Wan 3 r2v uses loose references and does not accept --ref-end.', { code: 'INVALID_ARGUMENT' });
      }
      if (looseTotal === 0 && !hasReferenceFile && !hasReferenceLink) {
        fatalCliError('Wan 3 r2v requires image/video/audio media, a reference document, or a webpage.', { code: 'INVALID_ARGUMENT' });
      }
    }
    if (options.videoWorkflow === 'ia2v') {
      if (options.refImageEnd) {
        fatalCliError('Wan 3 ia2v maps --ref to a loose image and does not accept --ref-end.', { code: 'INVALID_ARGUMENT' });
      }
      if (looseAudios === 0 || looseImages + looseVideos === 0) {
        fatalCliError('Wan 3 ia2v requires audio plus at least one image or video reference.', { code: 'INVALID_ARGUMENT' });
      }
    }
    if (options.videoWorkflow === 'a2v') {
      if (looseAudios === 0) {
        fatalCliError('Wan 3 a2v requires --ref-audio.', { code: 'INVALID_ARGUMENT' });
      }
      if (looseImages > 0 || looseVideos > 0 || options.refImageEnd) {
        fatalCliError('Wan 3 a2v accepts audio references only; use ia2v or r2v for multimodal input.', { code: 'INVALID_ARGUMENT' });
      }
    }
    enforceWan3ReferenceCaps({ images: looseImages, videos: looseVideos, audios: looseAudios });
  } else if (options.videoWorkflow === 't2v') {
    if (!isSeedanceVideo && (
      options.refImage || options.refImageEnd || options.refAudio || options.refVideo
      || options.contextImages.length > 0 || options.refAudios.length > 0 || options.refVideos.length > 0
    )) {
      fatalCliError('t2v does not accept reference image/audio/video.', {
        code: 'INVALID_ARGUMENT'
      });
    }
  } else if (options.videoWorkflow === 'i2v') {
    if (isHappyHorseVideo) {
      if (!options.refImage) {
        fatalCliError('HappyHorse i2v requires --ref (a single first-frame image).', { code: 'INVALID_ARGUMENT' });
      }
      if (options.refImageEnd) {
        fatalCliError('HappyHorse i2v accepts only a single first-frame image (--ref); it has no end-frame input.', { code: 'INVALID_ARGUMENT' });
      }
      if (options.refAudio || options.refVideo) {
        fatalCliError('HappyHorse i2v does not accept reference audio/video.', { code: 'INVALID_ARGUMENT' });
      }
    } else if (isMiniMaxH3Video) {
      const h3Mode = miniMaxH3ModeFromModelId(options.model);
      if (h3Mode === 'flf2v') {
        if (!options.refImage || !options.refImageEnd) {
          fatalCliError('MiniMax H3 flf2v requires both --ref and --ref-end.', { code: 'INVALID_ARGUMENT' });
        }
      } else {
        if (!options.refImage && !options.refImageEnd) {
          fatalCliError('MiniMax H3 i2v requires exactly one endpoint: --ref for I2VA or --ref-end for L2VA.', { code: 'INVALID_ARGUMENT' });
        }
        if (options.refImage && options.refImageEnd) {
          fatalCliError('MiniMax H3 i2v accepts one endpoint; use -m minimax-h3-flf2v for --ref plus --ref-end.', { code: 'INVALID_ARGUMENT' });
        }
      }
      if (options.contextImages.length > 0 || options.refAudio || options.refVideo || options.refAudios.length > 0 || options.refVideos.length > 0) {
        fatalCliError('MiniMax H3 i2v/flf2v accepts only --ref and optional --ref-end image anchors; use minimax-h3-r2v for loose image/video/audio references.', { code: 'INVALID_ARGUMENT' });
      }
    } else {
      if (!options.refImage && !options.refImageEnd) {
        fatalCliError('i2v requires --ref and/or --ref-end.', { code: 'INVALID_ARGUMENT' });
      }
      if (options.refAudio || options.refVideo) {
        fatalCliError('i2v does not accept reference audio/video.', { code: 'INVALID_ARGUMENT' });
      }
    }
  } else if (options.videoWorkflow === 'r2v') {
    if (isMiniMaxH3R2v) {
      const imageCount = (options.refImage ? 1 : 0) + options.contextImages.length;
      const videoCount = (options.refVideo ? 1 : 0) + options.refVideos.length;
      if (imageCount === 0 && videoCount === 0) {
        fatalCliError('MiniMax H3 r2v needs at least one visual reference via --ref, -c/--context, or --ref-video; audio-only input is invalid.', { code: 'INVALID_ARGUMENT' });
      }
      if (options.refImageEnd) {
        fatalCliError('MiniMax H3 r2v has no end-frame anchor; use -c/--context for another loose image or minimax-h3-flf2v for first/last frames.', { code: 'INVALID_ARGUMENT' });
      }
      const localVideoReferences = [options.refVideo, ...options.refVideos]
        .filter((reference) => reference && !isHttpUrl(reference) && existsSync(reference));
      for (const reference of localVideoReferences) {
        const frameRate = probeLocalVideoFrameRate(reference);
        if (!frameRate) {
          fatalCliError(
            `MiniMax H3 r2v could not verify the reference-video frame rate for "${reference}". ` +
            'Install ffprobe or provide a readable 24fps file before generation.',
            { code: 'INVALID_ARGUMENT', details: { reference, fps: null } },
          );
        }
        if (Math.abs(frameRate - 24) > 0.001) {
          fatalCliError(
            `MiniMax H3 r2v reference video must be exactly 24fps; "${reference}" is ${frameRate.toFixed(3)}fps. ` +
            'Normalize it to 24fps without changing duration before generation, or choreography and soundtrack timing will drift.',
            { code: 'INVALID_ARGUMENT', details: { reference, fps: frameRate } },
          );
        }
      }
    } else {
      // HappyHorse reference-to-video: 1-9 loose image references via -c/--context.
      if (!Array.isArray(options.contextImages) || options.contextImages.length === 0) {
        fatalCliError('HappyHorse r2v requires 1-9 reference images via -c/--context.', { code: 'INVALID_ARGUMENT' });
      }
      if (options.refImage || options.refImageEnd) {
        fatalCliError('HappyHorse r2v takes reference images via -c/--context, not --ref/--ref-end.', { code: 'INVALID_ARGUMENT' });
      }
      if (options.refAudio || options.refVideo || options.refAudios.length > 0 || options.refVideos.length > 0) {
        fatalCliError('HappyHorse r2v does not accept reference audio/video.', { code: 'INVALID_ARGUMENT' });
      }
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
      if (!options.refAudio || (!options.refImage && !options.refVideo)) {
        fatalCliError('Seedance ia2v requires --ref-audio plus --ref or --ref-video.', { code: 'INVALID_ARGUMENT' });
      }
      if (options.refImageEnd) {
        fatalCliError('Seedance ia2v treats --ref as a loose @Image reference and does not accept --ref-end. Use dedicated frame mode without audio for a native last-frame anchor.', { code: 'INVALID_ARGUMENT' });
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
      fatalCliError(`v2v requires --controlnet-name/--control-type (${VIDEO_CONTROLNET_NAMES.join('|')}).`, { code: 'INVALID_ARGUMENT' });
    }
    if (
      options.videoControlNetName === 'pose'
      && isLtx25ModelId(options.model)
      && !options.refImage
    ) {
      fatalCliError('LTX 2.5 pose control requires both --ref-video and --ref (a still image that defines the subject appearance).', {
        code: 'INVALID_ARGUMENT',
        details: { model: options.model, controlType: 'pose', requiredFlag: '--ref' }
      });
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
  if (isSeedanceVideo && !isSeedance25Video && options.refAudio && !options.refImage && !options.refImageEnd && !options.refVideo
      && (!Array.isArray(options.contextImages) || options.contextImages.length === 0)) {
    fatalCliError('Seedance 2.0 audio references require --ref, --ref-video, or -c/--context image refs.', { code: 'INVALID_ARGUMENT' });
  }

  // Seedance provider roles form two mutually exclusive request shapes:
  //   - DEDICATED FRAME MODE: --ref (first frame) and/or --ref-end (last frame)
  //     outside the typed ia2v workflow. The platform pins them as
  //     parameter-mode firstFrame/lastFrame.
  //   - LOOSE REFERENCE MODE: -c/--context (repeatable image refs), --ref-audio extras,
  //     --ref-video extras. Seedance 2.0 permits 9 images / 3 videos / 3 audios /
  //     12 total; Seedance 2.5 permits 30 / 10 / 10 / 50 and audio-only input.
  //     Anchor frame intent in the prompt with @Image1 / @Video1 / @Audio1 etc.
  // In typed ia2v, --ref is intentionally a loose reference_image beside the
  // audio, not a first_frame role. Every other frame-plus-loose combination is
  // rejected by sogni-socket, so catch it before uploading or charging.
  const seedanceFrameInputs = options.videoWorkflow === 'ia2v'
    ? [options.refImageEnd].filter(Boolean)
    : [options.refImage, options.refImageEnd].filter(Boolean);
  const seedanceLooseInputs = [
    ...(Array.isArray(options.contextImages) ? options.contextImages : []),
    options.refAudio,
    ...(Array.isArray(options.refAudios) ? options.refAudios : []),
    options.refVideo,
    ...(Array.isArray(options.refVideos) ? options.refVideos : []),
  ].filter(Boolean);
  if (isSeedanceVideo && seedanceFrameInputs.length > 0 && seedanceLooseInputs.length > 0) {
    fatalCliError(
      'Seedance reference modes are mutually exclusive: native --ref/--ref-end frame anchors cannot be combined with loose image, video, or audio references. '
      + 'Pick one: use --ref/--ref-end alone for first-class frame anchoring, or use -c/--context with optional --ref-video/--ref-audio and @ImageN/@VideoN/@AudioN prompt language. '
      + 'For image-plus-audio generation, select --workflow ia2v; there --ref is mapped to a loose @Image reference instead of first_frame.',
      { code: 'INVALID_ARGUMENT', details: {
          dedicatedFrames: seedanceFrameInputs,
          looseReferences: seedanceLooseInputs,
        } },
    );
  }
  // Non-Seedance video models do not understand multi-ref audio/video extras —
  // they only support a single primary --ref-audio / --ref-video each.
  if (!isSeedanceVideo && !isMiniMaxH3R2v && !isWan3Video) {
    if (Array.isArray(options.refAudios) && options.refAudios.length > 0) {
      fatalCliError('Multiple --ref-audio entries are supported only for Seedance loose references and MiniMax H3 r2v.', {
        code: 'INVALID_ARGUMENT',
        details: { model: options.model, extras: options.refAudios },
      });
    }
    if (Array.isArray(options.refVideos) && options.refVideos.length > 0) {
      fatalCliError('Multiple --ref-video entries are supported only for Seedance loose references and MiniMax H3 r2v.', {
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
  if (options.referenceAudioIdentity && !isLtx23ModelId(options.model)) {
    fatalCliError('--reference-audio-identity/--voice-persona requires an LTX-2.3 video model.', {
      code: 'INVALID_ARGUMENT',
      details: { model: options.model, unsupportedOnLtx25: isLtx25ModelId(options.model) },
      hint: `Use -m ${LTX23_WORKFLOW_MODELS[options.videoWorkflow] || LTX23_WORKFLOW_MODELS.t2v}`
    });
  }

  // Validate controlnet-name values
  if (options.videoControlNetName) {
    if (!VIDEO_CONTROLNET_NAME_SET.has(options.videoControlNetName)) {
      fatalCliError(`Unknown --controlnet-name "${options.videoControlNetName}". Use: ${VIDEO_CONTROLNET_NAMES.join('|')}`, {
        code: 'INVALID_ARGUMENT',
        details: { flag: '--controlnet-name', value: options.videoControlNetName, allowed: VIDEO_CONTROLNET_NAMES }
      });
    }
    if ((options.videoControlNetName === 'outpaint' || options.videoControlNetName === 'inpaint') && !isLtxV2VModelId(options.model)) {
      fatalCliError(`${options.videoControlNetName} control requires an LTX v2v model.`, {
        code: 'INVALID_ARGUMENT',
        details: { controlNetName: options.videoControlNetName, model: options.model },
        hint: 'Use --workflow v2v -m ltx25-v2v --control-type ' + options.videoControlNetName
      });
    }
    if (options.videoControlNetName === 'inpaint' && !options.refMask) {
      fatalCliError('LTX v2v inpaint requires --mask <image> (white pixels = region to regenerate).', {
        code: 'INVALID_ARGUMENT'
      });
    }
    if (options.videoControlNetName === 'outpaint' && !options.outpaintPosition) {
      options.outpaintPosition = 'center';
    }
  }

  if (options.refMask && options.videoControlNetName !== 'inpaint') {
    fatalCliError('--mask is only supported with --control-type inpaint.', {
      code: 'INVALID_ARGUMENT'
    });
  }

  if (options.outpaintPosition) {
    const normalizedOutpaintPosition = normalizeOutpaintPositionValue(options.outpaintPosition);
    if (!normalizedOutpaintPosition) {
      fatalCliError(`Invalid --outpaint-position "${options.outpaintPosition}". Use: ${OUTPAINT_POSITIONS.join('|')}`, {
        code: 'INVALID_ARGUMENT',
        details: { flag: '--outpaint-position', value: options.outpaintPosition, allowed: OUTPAINT_POSITIONS }
      });
    }
    if (options.videoControlNetName !== 'outpaint') {
      fatalCliError('--outpaint-position is only supported with --control-type outpaint.', {
        code: 'INVALID_ARGUMENT'
      });
    }
    options.outpaintPosition = normalizedOutpaintPosition;
  }

  if (options.outpaintAspectRatio) {
    if (!parseOutpaintAspectRatio(options.outpaintAspectRatio)) {
      fatalCliError(`Invalid --outpaint-aspect-ratio "${options.outpaintAspectRatio}". Use a ratio like 16:9 or 9:16.`, {
        code: 'INVALID_ARGUMENT',
        details: { flag: '--outpaint-aspect-ratio', value: options.outpaintAspectRatio }
      });
    }
    if (options.videoControlNetName !== 'outpaint') {
      fatalCliError('--outpaint-aspect-ratio is only supported with --control-type outpaint.', {
        code: 'INVALID_ARGUMENT'
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

if (options.video && isWan3ModelLocal(options.model) && options.fps !== 30) {
  if (cliSet.fps) {
    fatalCliError('Wan 3 output is fixed at 30 fps; omit --fps or pass --fps 30.', {
      code: 'INVALID_ARGUMENT',
      details: { fps: options.fps }
    });
  }
  const originalFps = options.fps;
  options.fps = 30;
  if (!options.quiet) {
    console.error(`Adjusted Wan 3 fps from ${originalFps} to 30 (Wan 3 uses fixed 30fps video generation).`);
  }
} else if (options.video && (isSeedanceModel(options.model) || isHappyHorseModel(options.model)) && options.fps !== 24) {
  const originalFps = options.fps;
  const vendorLabel = isHappyHorseModel(options.model) ? 'HappyHorse' : 'Seedance';
  options.fps = 24;
  if (!options.quiet) {
    console.error(`Adjusted ${vendorLabel} fps from ${originalFps} to 24 (${vendorLabel} uses fixed 24fps video generation).`);
  }
}

if (options.video && isWan3ModelLocal(options.model) && options.wan3SmartDuration) {
  // Reserve the maximum output for preflight pricing; transport sends
  // smartDuration instead of a fixed duration.
  options.duration = 30;
}

if (options.video && !options.frames) {
  const durationLimits = videoDurationLimitsLikeWrapper(options.model);
  const requestedDuration = options.duration;
  if (
    isWan3ModelLocal(options.model) &&
    (!Number.isInteger(options.duration) || options.duration < 2 || options.duration > 30)
  ) {
    fatalCliError('Wan 3 duration must be a whole number from 2 through 30 seconds.', {
      code: 'INVALID_ARGUMENT',
      details: { duration: options.duration }
    });
  }
  let clampedDuration = Math.max(durationLimits.min, Math.min(durationLimits.max, options.duration));
  if (isWan3ModelLocal(options.model)) {
    clampedDuration = Math.round(clampedDuration);
  }
  if (clampedDuration !== options.duration) {
    // H3 reports its own adjustment below, after the frame grid decides the
    // duration actually delivered; announcing the clamp here would name a
    // duration H3 cannot render.
    if (!options.quiet && !isMiniMaxH3Model(options.model)) {
      console.error(
        `Adjusted video duration from ${options.duration}s to ${clampedDuration}s ` +
        `(supported range for ${options.model}: ${durationLimits.min}-${durationLimits.max}s).`
      );
    }
    options.duration = clampedDuration;
  }
  if (isMiniMaxH3Model(options.model)) {
    options.frames = miniMaxH3FramesForDuration(options.duration);
    options.fps = MINIMAX_H3_FRAME_GRID.fps;
    const deliveredDuration = options.frames / MINIMAX_H3_FRAME_GRID.fps;
    if (!options.quiet && Math.abs(deliveredDuration - requestedDuration) > 1e-6) {
      console.error(
        `Adjusted video duration from ${formatDurationSeconds(requestedDuration)}s to ` +
        `${formatDurationSeconds(deliveredDuration)}s (${options.frames} frames). ` +
        `MiniMax H3 renders ${MINIMAX_H3_FRAME_GRID.min} + n×${MINIMAX_H3_FRAME_GRID.step} frames at ` +
        `${MINIMAX_H3_FRAME_GRID.fps}fps, so ${options.model} delivers ` +
        `${formatDurationSeconds(durationLimits.min)}-${formatDurationSeconds(durationLimits.max)}s.`
      );
    }
  }
} else if (options.video && isWan3ModelLocal(options.model)) {
  const maximumFrames = 901;
  if (
    !Number.isInteger(options.frames)
    || options.frames < 61
    || options.frames > maximumFrames
    || (options.frames - 1) % 30 !== 0
  ) {
    fatalCliError(`Wan 3 frames must be 61 + n×30 through ${maximumFrames} at fixed 30fps.`, {
      code: 'INVALID_ARGUMENT',
      details: { frames: options.frames, minimum: 61, maximum: maximumFrames, step: 30 }
    });
  }
  options.fps = 30;
} else if (options.video && isMiniMaxH3Model(options.model)) {
  const { min: minFrames, max: maxFrames, step: frameStep, fps: h3Fps } = MINIMAX_H3_FRAME_GRID;
  if (options.frames < minFrames || options.frames > maxFrames || (options.frames - minFrames) % frameStep !== 0) {
    fatalCliError(`MiniMax H3 frames must be ${minFrames} + n×${frameStep}, from ${minFrames} through ${maxFrames}.`, {
      code: 'INVALID_ARGUMENT',
      details: { frames: options.frames, minimum: minFrames, maximum: maxFrames, step: frameStep }
    });
  }
  options.fps = h3Fps;
}

// Video dimensions:
// - Sogni video pipelines have model-specific min/max dimensions and divisors.
// - When using i2v (or any ref-based workflow), the Sogni client wrapper will *resize the reference image*
//   with sharp `fit: inside` and then override the project width/height with the resized reference dims.
//   That means a "valid" requested size can still fail if the resized ref lands off the model divisor.
if (options.video) {
  const baseVideoDimensionRules = videoDimensionRulesFromDefaults(getModelDefaults(options.model, openclawConfig), options.model);
  // A reference image routes through the wrapper's resize, and the wrapper then adopts the
  // resized reference's dimensions as the project's. Honour the wrapper's ceiling up front so
  // the CLI picks a divisor-valid size instead of letting the wrapper clamp blindly (on modern
  // clients that ceiling is model-aware — e.g. 3840 for LTX-2.x — on legacy clients it is a
  // blanket 1536).
  const hasVideoReference = Boolean(options.refImage || options.refImageEnd);
  const videoDimensionRules = hasVideoReference
    ? {
      ...baseVideoDimensionRules,
      maxDimension: Math.min(baseVideoDimensionRules.maxDimension, wrapperRefVideoDimensionCeiling(options.model))
    }
    : baseVideoDimensionRules;

  // An implicit LTX i2v canvas follows an already-compatible local reference
  // directly. Resolve this before normalizing the model's landscape default so
  // the CLI does not print an intermediate adjustment that will immediately be
  // discarded in favor of the reference aspect.
  const hasRequestedVideoCanvas =
    cliSet.width ||
    cliSet.height ||
    cliSet.targetResolution ||
    widthFromConfig ||
    heightFromConfig ||
    widthFromPrompt ||
    heightFromPrompt ||
    targetResolutionFromPrompt;
  if (
    isLtxFamilyModel(options.model) &&
    options.videoWorkflow === 'i2v' &&
    !hasRequestedVideoCanvas
  ) {
    const implicitRefPath = options.refImage || options.refImageEnd;
    if (implicitRefPath && !isHttpUrl(implicitRefPath) && existsSync(implicitRefPath)) {
      const implicitRefBuffer = readFileSync(implicitRefPath);
      const implicitRefDims = getImageDimensionsFromBuffer(implicitRefBuffer);
      if (implicitRefDims?.width && implicitRefDims?.height) {
        const sourceCanvas = computeSourceAspectCanvas(
          implicitRefDims.width,
          implicitRefDims.height,
          videoDimensionRules
        );
        options.width = sourceCanvas.width;
        options.height = sourceCanvas.height;
        options._ltxReferencePassthrough =
          sourceCanvas.width === implicitRefDims.width &&
          sourceCanvas.height === implicitRefDims.height;
      }
    }
  }

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
  if (isMiniMaxH3Model(options.model) && options.width * options.height > 1344 * 768) {
    const scale = Math.sqrt((1344 * 768) / (options.width * options.height));
    options.width = Math.max(32, Math.floor((options.width * scale) / 32) * 32);
    options.height = Math.max(32, Math.floor((options.height * scale) / 32) * 32);
    normalizedVideoDims.adjusted = true;
  }
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

    const isIncompatible = (predicted) => videoDimensionsAreIncompatible(predicted, videoDimensionRules);

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

      // An exact-aspect bounding box can only land on sizes where BOTH sides are divisor-valid.
      // For aspect ratios with sparse valid sizes (e.g. 25:14 on a /16 model, which tops out at
      // 1200x672 under a 1536 cap) that forfeits a large share of the model's pixel budget.
      // Pre-resizing the reference reaches the cap instead, trading a tiny aspect adjustment for
      // the resolution — so prefer it when it wins materially on pixels and barely moves the aspect.
      const preResize = predictVideoRefPreResizeDims(dims.width, dims.height, videoDimensionRules);
      const candidateArea = candidate.output ? candidate.output.width * candidate.output.height : 0;
      const preResizeArea = preResize ? preResize.width * preResize.height : 0;
      const refAspect = dims.width / dims.height;
      const aspectDrift = preResize
        ? Math.abs((preResize.width / preResize.height) - refAspect) / refAspect
        : Infinity;

      if (preResizeArea > candidateArea * VIDEO_REF_PRERESIZE_MIN_AREA_GAIN
        && aspectDrift <= VIDEO_REF_PRERESIZE_MAX_ASPECT_DRIFT) {
        options.width = preResize.width;
        options.height = preResize.height;
        options[ref.resizeFlag] = true;
        options._adjustedVideoDims = {
          reason: 'i2v-ref-pre-resize',
          referenceType: ref.key,
          requested: { width: beforeW, height: beforeH },
          adjusted: { width: options.width, height: options.height },
          resizedFrom: predicted,
          resizedTo: { width: preResize.width, height: preResize.height },
          insteadOf: candidate.output
            ? { width: candidate.output.width, height: candidate.output.height }
            : null
        };
        if (!options.quiet) {
          console.error(
            `Pre-resizing ${ref.label.toLowerCase()} to ${preResize.width}x${preResize.height} ` +
            `instead of shrinking the video to ${candidate.output.width}x${candidate.output.height} ` +
            `(keeps ${Math.round((preResizeArea / candidateArea - 1) * 100)}% more pixels).`
          );
        }
        continue;
      }

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
      const effectiveResizeFlag = localRefDims.has('refImage') ? '_needsRefResize' : '_needsRefEndResize';
      // A pre-resized reference reaches the wrapper already divisor-valid, so the video lands on
      // the pre-resize dims rather than the fit:inside prediction of the original.
      const predicted = options[effectiveResizeFlag]
        ? predictVideoRefPreResizeDims(effectiveDimsSource.width, effectiveDimsSource.height, videoDimensionRules)
        : predictSharpInsideResizeDims(
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
      hint: 'Try: qwen_image_edit_2511_fp8, qwen_image_edit_2511_fp8_lightning, krea2_identity_edit_v1_2, or dark_beast_krea2_identity_edit_v1_2'
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
if (commandUsesGenerationSeed && isWan3ModelLocal(options.model) && options.seed > WAN3_MAX_SEED) {
  options.seed %= WAN3_MAX_SEED + 1;
  if (!options.quiet) console.error(`Adjusted Wan 3 seed into its 0-${WAN3_MAX_SEED} range: ${options.seed}`);
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

function apiRequestHeaders(apiKey, extra = {}, workloadAttribution = undefined) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'api-key': apiKey,
    ...extra,
    ...attributionHeaders(AGENT_ATTRIBUTION, workloadAttribution),
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
      appId: getOrCreateSogniAppId(),
      attribution: clientAttribution(AGENT_ATTRIBUTION),
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
            ...(params.attribution ? { attribution: params.attribution } : {}),
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
async function dispatchChatHostedViaSdk(apiKey, body, workloadAttribution) {
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
      appId: getOrCreateSogniAppId(),
      attribution: clientAttribution(AGENT_ATTRIBUTION),
    },
    async (client) => helpers.sdkChatHostedCreate(client, {
      ...body,
      ...(workloadAttribution ? { attribution: workloadAttribution } : {}),
    }),
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
      appId: getOrCreateSogniAppId(),
      attribution: clientAttribution(AGENT_ATTRIBUTION),
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

async function fetchApiJson(path, {
  apiKey,
  method = 'GET',
  body = undefined,
  headers = {},
  workloadAttribution = undefined,
} = {}) {
  const url = await buildSafeApiUrl(path);
  const init = {
    method,
    headers: apiRequestHeaders(apiKey, headers, workloadAttribution),
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
  if (options.refMask) refs.push({ flag: '--mask', value: options.refMask, kind: 'image' });
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
  if (ref.flag === '--mask') return `contextImage${Math.min(index + 1, 16)}`;
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
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
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
  const workloadAttribution = nextSemanticWorkloadAttribution();
  if (options.durableChat) {
    return runApiChatDurable(log, { apiKey, body, workloadAttribution });
  }
  const payload =
    (await dispatchChatHostedViaSdk(apiKey, body, workloadAttribution))
    ?? (await fetchApiJson('/v1/chat/completions', {
      apiKey,
      method: 'POST',
      body,
      workloadAttribution,
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
async function runApiChatDurable(log, { apiKey, body, workloadAttribution }) {
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
    ...(workloadAttribution ? { attribution: workloadAttribution } : {}),
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
      appId: getOrCreateSogniAppId(),
      attribution: clientAttribution(AGENT_ATTRIBUTION),
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
  // Planning is internal compute for the workflow intent. Reserve the
  // invocation root for the workflow start so headline counts stay at one.
  const workloadAttribution = nextSemanticWorkloadAttribution({
    scope: 'child',
    parentOperationId: INVOCATION_LINEAGE.rootOperationId,
  });
  const payload =
    (await dispatchChatHostedViaSdk(apiKey, body, workloadAttribution))
    ?? (await fetchApiJson('/v1/chat/completions', {
      apiKey,
      method: 'POST',
      body,
      workloadAttribution,
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

function normalizeLiveModelSearch(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeLiveModelTag(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-');
}

async function fetchLiveModelCatalog(network, media) {
  const fixtureJson = getEnv('SOGNI_AGENT_TEST_MODEL_CATALOG_JSON');
  let cachedCatalog = null;
  try {
    if (existsSync(MODEL_CATALOG_LIST_CACHE_PATH)) {
      const cached = JSON.parse(readFileSync(MODEL_CATALOG_LIST_CACHE_PATH, 'utf8'));
      const cacheAge = Date.now() - cached?.fetchedAt;
      if (
        Number.isFinite(cached?.fetchedAt) &&
        cacheAge >= 0 &&
        cached?.network === network &&
        cached?.media === media &&
        Array.isArray(cached?.models)
      ) {
        cachedCatalog = cached;
        if (cacheAge < MODEL_CATALOG_CACHE_TTL_MS) return cached;
      }
    }
  } catch {
    // A corrupt cache is treated as a miss and replaced by the live response.
  }

  try {
    let catalog;
    if (fixtureJson) {
      const payload = JSON.parse(fixtureJson);
      const data = payload?.data || payload;
      catalog = {
        fetchedAt: Date.now(),
        network,
        media,
        etag: null,
        catalogVersion: data?.catalogVersion || null,
        models: data?.models
      };
    } else {
      const url = new URL(MODEL_CATALOG_URL);
      url.searchParams.set('network', network);
      if (media !== 'all') url.searchParams.set('mediaType', media);
      const headers = { accept: 'application/json' };
      if (cachedCatalog?.etag) headers['if-none-match'] = cachedCatalog.etag;
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(SOGNI_MODEL_CATALOG_TIMEOUT_MS)
      });
      if (response.status === 304 && cachedCatalog) {
        catalog = { ...cachedCatalog, fetchedAt: Date.now() };
      } else {
        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > SOGNI_MODEL_CATALOG_MAX_BYTES) {
          const error = new Error('Sogni model catalog response is unexpectedly large.');
          error.code = 'MODEL_CATALOG_INVALID';
          throw error;
        }
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > SOGNI_MODEL_CATALOG_MAX_BYTES) {
          const error = new Error('Sogni model catalog response is unexpectedly large.');
          error.code = 'MODEL_CATALOG_INVALID';
          throw error;
        }
        const payload = JSON.parse(text);
        catalog = {
          fetchedAt: Date.now(),
          network,
          media,
          etag: response.headers.get('etag'),
          catalogVersion: payload?.data?.catalogVersion || null,
          models: payload?.data?.models
        };
      }
    }
    if (!Array.isArray(catalog?.models)) {
      const error = new Error('Sogni model catalog response contained no model list.');
      error.code = 'MODEL_CATALOG_INVALID';
      throw error;
    }
    persistModelCatalogCache(catalog, MODEL_CATALOG_LIST_CACHE_PATH);
    return catalog;
  } catch (cause) {
    const error = new Error(`Could not load the live Sogni model catalog (${cause?.message || cause}).`);
    error.code = cause?.code || 'MODEL_CATALOG_UNAVAILABLE';
    error.hint = `Check Sogni platform status and retry. Catalog: ${MODEL_CATALOG_URL}`;
    throw error;
  }
}

async function runLiveModels() {
  const network = options.liveModelNetwork || openclawConfig?.defaultNetwork || 'fast';
  const media = options.liveModelMedia || 'all';
  const query = options.liveModelQuery?.trim() || null;
  const normalizedQuery = normalizeLiveModelSearch(query);
  const tagFilters = [...new Set(options.liveModelTags.map(normalizeLiveModelTag).filter(Boolean))];
  if (query && !normalizedQuery) {
    const err = new Error('Model search query must contain at least one letter or number.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const catalog = await fetchLiveModelCatalog(network, media);
  let models = catalog.models.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    workerCount: Number(model.workerCounts?.[network] || 0),
    media: model.mediaType,
    networks: Array.isArray(model.availableNetworks) ? model.availableNetworks : [],
    workerCounts: model.workerCounts || {},
    tierId: model.tierId || null,
    tags: Array.isArray(model.tags)
      ? [...new Set(model.tags.map(normalizeLiveModelTag).filter(Boolean))].sort()
      : []
  })).filter(model =>
    ['image', 'video', 'audio'].includes(model.media) &&
    model.networks.includes(network) &&
    (media === 'all' || model.media === media)
  );
  const catalogTagsAvailable = catalog.models.every(model => Array.isArray(model.tags));
  const queryAsTag = normalizeLiveModelTag(query);
  if ((tagFilters.length > 0 || KNOWN_MODEL_CATALOG_TAGS.has(queryAsTag)) && !catalogTagsAvailable) {
    const error = new Error('Sogni model catalog response does not include catalog tags.');
    error.code = 'MODEL_CATALOG_INVALID';
    error.hint = `Tag filtering requires catalog tags from ${MODEL_CATALOG_URL}`;
    throw error;
  }
  models.sort((left, right) =>
    right.workerCount - left.workerCount ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
  if (tagFilters.length > 0) {
    models = models.filter((model) => tagFilters.every((tag) => model.tags.includes(tag)));
  }
  if (normalizedQuery) {
    models = models.filter((model) =>
      normalizeLiveModelSearch(`${model.id} ${model.name} ${model.tags.join(' ')}`).includes(normalizedQuery)
    );
  }

  const result = {
    success: true,
    type: 'live-models',
    network,
    media,
    query,
    tagFilters,
    catalogTagsAvailable,
    catalogVersion: catalog.catalogVersion,
    count: models.length,
    models,
    timestamp: new Date().toISOString()
  };
  if (options.json || JSON_ERROR_MODE) {
    console.log(JSON.stringify(result));
    return;
  }

  const scope = [
    media === 'all' ? 'all media' : media,
    `network=${network}`,
    query ? `query=${JSON.stringify(query)}` : null,
    tagFilters.length ? `tags=${tagFilters.join('+')}` : null
  ].filter(Boolean).join(', ');
  console.log(`Live Sogni models (${models.length}; ${scope})`);
  if (models.length === 0) {
    console.log('No matching models found.');
    return;
  }
  console.log('MEDIA\tWORKERS\tMODEL ID\tTAGS\tNAME');
  for (const model of models) {
    console.log(`${model.media}\t${model.workerCount}\t${model.id}\t${model.tags.join(',') || '-'}\t${model.name}`);
  }
}

// LoRA discovery goes through the SDK's catalog surface
// (`projects.availableLoras`), which reads the public artist-facing catalog and
// applies the `modelId` filter server-side. That is the single source of truth
// for which LoRAs a model accepts and for the strength contract of each one, so
// the CLI (and any agent reading its output) stays correct when Sogni
// publishes, retunes, or retires a LoRA without a skill release.
//
// This path is deliberately socket-free and credential-free: the catalog is
// public, so `--list-loras` answers without connecting a worker session.
async function fetchLoraCatalog(modelId) {
  const fixtureJson = getEnv('SOGNI_AGENT_TEST_LORA_CATALOG_JSON');
  if (fixtureJson) {
    const payload = JSON.parse(fixtureJson);
    const data = payload?.data || payload;
    const loras = Array.isArray(data) ? data : data?.loras;
    if (!Array.isArray(loras)) {
      const error = new Error('Sogni LoRA catalog response contained no LoRA list.');
      error.code = 'LORA_CATALOG_INVALID';
      throw error;
    }
    return {
      lastUpdated: data?.lastUpdated,
      loras: modelId
        ? loras.filter(lora => Array.isArray(lora?.modelIds) && lora.modelIds.includes(modelId))
        : loras,
      models: Array.isArray(data?.models) ? data.models : [],
      constraints: data?.constraints || null
    };
  }

  // Run the same host/protocol guard every other REST path in this CLI goes
  // through before handing the base URL to the SDK. The SDK owns the route.
  await buildSafeApiUrl('/');

  let sdkClient;
  try {
    sdkClient = await SogniClient.createInstance({
      appId: getOrCreateSogniAppId(),
      appSource: SOGNI_APP_SOURCE,
      restEndpoint: getApiBaseUrl(),
      // The catalog is a plain REST read. Opening a socket would cost a worker
      // session and would make a public listing require credentials.
      disableSocket: true,
      logLevel: 'error'
    });
    if (typeof sdkClient.projects.availableLoras !== 'function') {
      const error = new Error('The installed Sogni SDK does not expose the LoRA catalog.');
      error.code = 'LORA_CATALOG_UNSUPPORTED';
      error.hint = 'Update @sogni-ai/sogni-intelligence-client to a release built on sogni-client >= 5.17.0.';
      throw error;
    }
    const catalog = await sdkClient.projects.availableLoras(modelId ? { modelId } : {});
    if (!Array.isArray(catalog?.loras)) {
      const error = new Error('Sogni LoRA catalog response contained no LoRA list.');
      error.code = 'LORA_CATALOG_INVALID';
      throw error;
    }
    return catalog;
  } catch (cause) {
    if (cause?.code === 'LORA_CATALOG_INVALID' || cause?.code === 'LORA_CATALOG_UNSUPPORTED') throw cause;
    const error = new Error(`Could not load the live Sogni LoRA catalog (${cause?.message || cause}).`);
    error.code = cause?.code || 'LORA_CATALOG_UNAVAILABLE';
    error.hint = 'Check Sogni platform status and retry.';
    throw error;
  } finally {
    try {
      sdkClient?.dispose?.();
    } catch {
      // Disposal is best-effort; a listing must not fail on teardown.
    }
  }
}

function loraCatalogEntryFromPayload(entry) {
  const ui = entry?.ui || {};
  return {
    loraId: entry?.loraId || entry?.slug || '',
    name: entry?.name || entry?.loraId || '',
    description: typeof entry?.description === 'string' ? entry.description : '',
    modelIds: Array.isArray(entry?.modelIds) ? entry.modelIds : [],
    category: ui.category || null,
    section: ui.section?.label || null,
    min: Number.isFinite(ui.min) ? ui.min : null,
    max: Number.isFinite(ui.max) ? ui.max : null,
    default: Number.isFinite(ui.default) ? ui.default : null,
    step: Number.isFinite(ui.step) ? ui.step : null,
    recommendedMin: Number.isFinite(ui.recommendedMin) ? ui.recommendedMin : null,
    recommendedMax: Number.isFinite(ui.recommendedMax) ? ui.recommendedMax : null,
    rangeLabels: ui.rangeLabels || null,
    bipolar: Number.isFinite(ui.min) && ui.min < 0,
    nsfw: Boolean(ui.nsfw),
    sexual: Boolean(ui.sexual),
    creator: ui.creator || null,
    sourceUrl: ui.sourceUrl || null,
    license: ui.license || null
  };
}

function formatLoraRange(entry) {
  if (entry.min === null || entry.max === null) return '-';
  const hard = `${entry.min}..${entry.max}`;
  if (entry.recommendedMin === null || entry.recommendedMax === null) return hard;
  return `${hard} (rec ${entry.recommendedMin}..${entry.recommendedMax})`;
}

async function runLoraCatalog() {
  const query = options.loraCatalogQuery?.trim() || null;
  const normalizedQuery = normalizeLiveModelSearch(query);
  if (query && !normalizedQuery) {
    const err = new Error('LoRA search query must contain at least one letter or number.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  const modelFilter = options.loraCatalogModel?.trim() || null;
  const categoryFilter = normalizeLiveModelTag(options.loraCatalogCategory) || null;

  // The model filter is applied server-side by the catalog endpoint; category
  // and free-text search are presentation-layer narrowing over what it returns.
  const catalog = await fetchLoraCatalog(modelFilter || undefined);
  let loras = catalog.loras.map(loraCatalogEntryFromPayload).filter(entry => entry.loraId);
  if (categoryFilter) loras = loras.filter(entry => normalizeLiveModelTag(entry.category) === categoryFilter);
  if (normalizedQuery) {
    loras = loras.filter(entry =>
      normalizeLiveModelSearch(`${entry.loraId} ${entry.name} ${entry.category || ''} ${entry.description}`)
        .includes(normalizedQuery)
    );
  }

  const result = {
    success: true,
    type: 'lora-catalog',
    query,
    model: modelFilter,
    category: options.loraCatalogCategory || null,
    count: loras.length,
    // Catalog-level facts, unaffected by the filters above: which models take
    // LoRAs at all, and how many may be stacked on one render.
    loraCapableModels: Array.isArray(catalog.models) ? catalog.models : [],
    constraints: catalog.constraints || null,
    loras,
    timestamp: new Date().toISOString()
  };
  if (options.json || JSON_ERROR_MODE) {
    console.log(JSON.stringify(result));
    return;
  }

  const scope = [
    modelFilter ? `model=${modelFilter}` : 'all models',
    options.loraCatalogCategory ? `category=${options.loraCatalogCategory}` : null,
    query ? `query=${JSON.stringify(query)}` : null
  ].filter(Boolean).join(', ');
  const maxPerRequest = catalog.constraints?.maxPerRequest;
  const stacking = Number.isFinite(maxPerRequest) ? `; stack up to ${maxPerRequest} per render` : '';
  console.log(`Sogni LoRA catalog (${loras.length}; ${scope}${stacking})`);
  if (loras.length === 0) {
    if (modelFilter && !result.loraCapableModels.includes(modelFilter)) {
      console.log(`${modelFilter} does not accept LoRAs. Models that do: ${result.loraCapableModels.join(', ') || '(none reported)'}`);
      return;
    }
    console.log('No matching LoRAs found.');
    return;
  }
  console.log('LORA ID\tRANGE\tDEFAULT\tCATEGORY\tMATURE\tNAME');
  for (const entry of loras) {
    const mature = [entry.nsfw ? 'nsfw' : null, entry.sexual ? 'sexual' : null].filter(Boolean).join('+') || '-';
    console.log([
      entry.loraId,
      formatLoraRange(entry),
      entry.default ?? '-',
      entry.category || '-',
      mature,
      entry.name
    ].join('\t'));
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
  // a per-model adapter (seedance / gpt-image-2 / ltx25 / ltx23 / wan). When the
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
    // Prefer SDK transport when opted-in. `resume` exists in the SDK
    // (sogni-client CreativeWorkflows.resume) since 5.1.0-alpha.16 but
    // is not wired here yet, so resume still falls through to the
    // legacy fetch path. Wiring it (plus reseed, which the SDK also
    // ships) is tracked in the workflows MASTER plan, Phase 4.4.
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

  const workloadAttribution = nextSemanticWorkloadAttribution({ scope: 'top_level' });
  payload =
    (await dispatchWorkflowActionViaSdk('start', apiKey, {
      input,
      tokenType,
      mediaReferences: apiMediaReferences.length > 0 ? apiMediaReferences : undefined,
      maxEstimatedCapacityUnits: options.apiWorkflowMaxCost ?? undefined,
      confirmCost: options.apiWorkflowConfirmCost ?? undefined,
      idempotencyKey: options.apiWorkflowIdempotencyKey ?? undefined,
      attribution: workloadAttribution,
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
      },
      workloadAttribution,
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

async function trimPreparedReferenceAudioWindowBuffer(buffer, {
  startSeconds = 0,
  durationSeconds = null,
} = {}) {
  const ffmpegPath = await ensureFfmpegAvailable();
  const tempDir = createTrackedTempDir('sogni-h3-audio-window-');
  const inputPath = join(tempDir, 'reference-audio-input.m4a');
  const outputPath = join(tempDir, 'reference-audio-window.m4a');
  try {
    writeFileSync(inputPath, buffer);
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    if (Number.isFinite(startSeconds) && startSeconds > 0) {
      args.push('-ss', String(startSeconds));
    }
    args.push('-i', inputPath);
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      args.push('-t', String(durationSeconds));
    }
    args.push('-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath);
    const result = await runCommand(ffmpegPath, args, { captureOutput: true });
    if (result.error || result.status !== 0 || !isNonEmptyFile(outputPath)) {
      const err = new Error('Failed to prepare the MiniMax H3 reference-audio window.');
      err.code = 'FFMPEG_H3_AUDIO_WINDOW_FAILED';
      err.details = { stderr: result.stderr || '', stdout: result.stdout || '', status: result.status };
      throw err;
    }
    if (!options.quiet) {
      console.error(`Prepared MiniMax H3 reference-audio window (${startSeconds}s start, ${durationSeconds ?? 'remaining'}s duration).`);
    }
    return readFileSync(outputPath);
  } finally {
    try { if (existsSync(inputPath)) unlinkSync(inputPath); } catch {}
    try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch {}
    try { rmdirSync(tempDir); } catch {}
  }
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

async function probeMediaBufferDurationSeconds(buffer, filename) {
  const ffprobePath = getEnv('FFPROBE_PATH') || 'ffprobe';
  sanitizePath(ffprobePath, 'FFPROBE_PATH');
  const tempDir = createTrackedTempDir('sogni-wan3-probe-');
  const inputPath = mediaTempInputPath(tempDir, filename, '.media');
  try {
    writeFileSync(inputPath, Buffer.from(buffer));
    const result = await runCommand(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ], { captureOutput: true });
    if (result.error || result.status !== 0) return undefined;
    const parsed = Number(String(result.stdout || '').trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  } finally {
    try { if (existsSync(inputPath)) unlinkSync(inputPath); } catch {}
    try { rmdirSync(tempDir); } catch {}
  }
}

function wan3ReferenceMediaKey(kind, source) {
  return `${kind}:${source}`;
}

async function inspectWan3ReferenceMedia(source, kind) {
  const key = wan3ReferenceMediaKey(kind, source);
  const cached = wan3ReferenceMediaCache.get(key);
  if (cached) return cached;
  const buffer = await fetchMediaBuffer(source);
  const filename = mediaFilenameFromSource(source, `wan3-reference-${kind}`);
  const duration = await probeLocalMediaDurationSeconds(source)
    ?? await probeMediaBufferDurationSeconds(buffer, filename);
  if (!Number.isFinite(duration)) {
    const error = new Error(`Unable to read the duration of Wan 3 ${kind} reference "${source}".`);
    error.code = 'WAN3_REFERENCE_DURATION_UNAVAILABLE';
    error.hint = 'Install ffprobe and provide a playable local file or reachable URL; Wan 3 reference duration limits cannot be enforced safely without probing.';
    throw error;
  }
  const inspected = { buffer, filename, duration };
  wan3ReferenceMediaCache.set(key, inspected);
  return inspected;
}

async function prepareWan3ReferenceMediaPlan() {
  const audioSources = [options.refAudio, ...options.refAudios].filter(Boolean);
  const videoSources = [options.refVideo, ...options.refVideos].filter(Boolean);
  const audioMedia = await Promise.all(audioSources.map(source => inspectWan3ReferenceMedia(source, 'audio')));
  const videoMedia = await Promise.all(videoSources.map(source => inspectWan3ReferenceMedia(source, 'video')));
  const audioDurations = audioMedia.map(media => media.duration);
  const videoDurations = videoMedia.map(media => media.duration);
  const fixedOutputDuration = options.frames ? (options.frames - 1) / 30 : options.duration;

  if (audioMedia.length > 0 && (options.audioStart !== null || options.audioDuration !== null)) {
    const start = options.audioStart ?? 0;
    const available = audioMedia[0].duration - start;
    const duration = options.audioDuration ?? Math.min(15, available);
    if (start < 0 || available < 1 || duration < 1 || duration > 15 || duration > available + 0.05) {
      fatalCliError('Wan 3 selected audio window must be 1-15 seconds and fit inside the first reference clip.', {
        code: 'INVALID_ARGUMENT',
        details: { start, duration, sourceDuration: audioMedia[0].duration }
      });
    }
    audioDurations[0] = duration;
    wan3ReferencePreparationPlan.set(wan3ReferenceMediaKey('audio', audioSources[0]), { start, duration });
  }

  const otherVideoDuration = videoDurations.slice(1).reduce((sum, duration) => sum + duration, 0);
  if (videoMedia.length > 0 && options.videoStart !== null) {
    const start = options.videoStart;
    const available = videoMedia[0].duration - start;
    const outputBudget = options.wan3SmartDuration ? 15 : 30 - fixedOutputDuration;
    const duration = Math.min(available, 15 - otherVideoDuration, outputBudget - otherVideoDuration);
    if (start < 0 || available < 1 || duration < 1) {
      fatalCliError('Wan 3 could not form a valid 1-15 second source window at --video-start within the reference and output-duration limits.', {
        code: 'INVALID_ARGUMENT',
        details: { start, sourceDuration: videoMedia[0].duration, outputDuration: options.wan3SmartDuration ? 'smart' : fixedOutputDuration }
      });
    }
    videoDurations[0] = duration;
    wan3ReferencePreparationPlan.set(wan3ReferenceMediaKey('video', videoSources[0]), { start, duration });
  }

  const invalidAudio = audioDurations.find(duration => duration < 1 || duration > 15.05);
  const invalidVideo = videoDurations.find(duration => duration < 1 || duration > 15.05);
  const totalAudioDuration = audioDurations.reduce((sum, duration) => sum + duration, 0);
  const totalVideoDuration = videoDurations.reduce((sum, duration) => sum + duration, 0);
  if (invalidAudio !== undefined || totalAudioDuration > 15.05) {
    fatalCliError('Wan 3 audio references must each be 1-15 seconds and total no more than 15 seconds. No audio was trimmed automatically.', {
      code: 'INVALID_ARGUMENT',
      details: { durations: audioDurations, totalDuration: totalAudioDuration }
    });
  }
  if (invalidVideo !== undefined || totalVideoDuration > 15.05) {
    fatalCliError('Wan 3 video references must each be 1-15 seconds and total no more than 15 seconds. Use --video-start to select an explicit source window; no video was trimmed automatically.', {
      code: 'INVALID_ARGUMENT',
      details: { durations: videoDurations, totalDuration: totalVideoDuration }
    });
  }
  if (!options.wan3SmartDuration && totalVideoDuration + fixedOutputDuration > 30.05) {
    fatalCliError('Wan 3 reference-video duration plus output duration must not exceed 30 seconds. Use --video-start to select a source window or request a shorter output.', {
      code: 'INVALID_ARGUMENT',
      details: { referenceVideoDuration: totalVideoDuration, outputDuration: fixedOutputDuration }
    });
  }
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

async function uploadWan3ReferenceAudioUrl(pathOrUrl, apiKey, index) {
  const ref = { flag: '--ref-audio', value: pathOrUrl, kind: 'audio' };
  const inspected = await inspectWan3ReferenceMedia(pathOrUrl, 'audio');
  const rawMimeType = mimeTypeForPath(pathOrUrl, 'application/octet-stream');
  const mimeType = normalizeReferenceAudioMimeType(rawMimeType) || rawMimeType;
  const sourceFormat = detectReferenceAudioFormat(inspected.buffer, mimeType);
  const plan = wan3ReferencePreparationPlan.get(wan3ReferenceMediaKey('audio', pathOrUrl));
  const prepared = plan
    ? await trimSeedanceReferenceAudioToMp3({
        data: inspected.buffer,
        filename: inspected.filename,
        inputMimeType: mimeType,
        sourceFormat,
        start: plan.start,
        duration: plan.duration,
      })
    : sourceFormat === 'mp3'
      ? { data: inspected.buffer, mimeType: 'audio/mpeg' }
      : await transcodeSeedanceReferenceAudioToMp3({
          data: inspected.buffer,
          filename: inspected.filename,
          inputMimeType: mimeType,
          sourceFormat,
        });
  const data = Buffer.from(prepared.data);
  const uploaded = await uploadPreparedApiMediaReferenceV2(ref, index, apiKey, {
    buffer: data,
    filename: withMediaExtension(inspected.filename, 'mp3'),
    byteLength: data.length,
    mimeType: 'audio/mpeg',
  });
  return uploaded.url;
}

async function uploadWan3ReferenceVideoUrl(pathOrUrl, apiKey, index) {
  const ref = { flag: '--ref-video', value: pathOrUrl, kind: 'video' };
  const inspected = await inspectWan3ReferenceMedia(pathOrUrl, 'video');
  const plan = wan3ReferencePreparationPlan.get(wan3ReferenceMediaKey('video', pathOrUrl));
  const prepared = plan
    ? await trimSeedanceV2VSourceVideo({
        data: inspected.buffer,
        filename: inspected.filename,
        start: plan.start,
        duration: plan.duration,
      })
    : { data: inspected.buffer, mimeType: mimeTypeForPath(pathOrUrl, 'video/mp4') };
  const data = Buffer.from(prepared.data);
  const outputMimeType = prepared.mimeType || 'video/mp4';
  const uploaded = await uploadPreparedApiMediaReferenceV2(ref, index, apiKey, {
    buffer: data,
    filename: withMediaExtension(
      inspected.filename,
      plan ? 'mp4' : extensionForApiMediaReference(outputMimeType, 'video'),
    ),
    byteLength: data.length,
    mimeType: outputMimeType,
  });
  return uploaded.url;
}

// Content types the Sogni media pipeline accepts for image references, mirroring
// the `allowedContentTypes` the /v2/image/uploadUrl presigned-POST endpoint
// returns. Kept as a constant so the skill validates exactly what the backend
// will store rather than imposing a narrower client-side policy.
const SEEDANCE_REFERENCE_IMAGE_MIME_TYPES = Object.freeze([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]);

// Identify an image's MIME type from its leading bytes (magic numbers). Reliable
// because we already hold the buffer, so it works regardless of file extension.
function sniffSeedanceReferenceImageMimeType(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 12
    && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  return null;
}

// Resolve a Seedance loose-reference image's MIME type from its bytes first,
// falling back to the file extension. Unsupported files fail fast with an
// actionable message instead of uploading bytes the render backend will reject.
function seedanceReferenceImageMimeType(pathOrUrl, buffer) {
  const sniffed = sniffSeedanceReferenceImageMimeType(buffer);
  if (sniffed) return sniffed;
  const byPath = mimeTypeForPath(pathOrUrl, '');
  const normalizedByPath = byPath === 'image/jpg' ? 'image/jpeg' : byPath;
  if (SEEDANCE_REFERENCE_IMAGE_MIME_TYPES.includes(normalizedByPath)) return normalizedByPath;
  const err = new Error(
    `Seedance reference image "${pathOrUrl}" must be a PNG, JPEG, WebP, or GIF file (or an HTTPS URL to one).`,
  );
  err.code = 'UNSUPPORTED_MEDIA_TYPE';
  err.hint = 'Convert the image to PNG, JPEG, or WebP, or pass an HTTPS URL.';
  err.details = { source: pathOrUrl };
  throw err;
}

async function prepareSeedanceReferenceImageUploadFile(pathOrUrl, buffer) {
  const data = Buffer.from(buffer);
  const mimeType = seedanceReferenceImageMimeType(pathOrUrl, data);
  const filename = withMediaExtension(
    mediaFilenameFromSource(pathOrUrl, 'reference-image'),
    extensionForApiMediaReference(mimeType, 'image'),
  );
  const maxBytes = apiMediaReferenceMaxBytes();
  if (data.length > maxBytes) {
    const err = new Error(
      `Seedance reference image "${pathOrUrl}" is ${data.length} bytes, above the ${maxBytes} byte upload limit.`,
    );
    err.code = 'MEDIA_REFERENCE_TOO_LARGE';
    err.details = { source: pathOrUrl, byteLength: data.length, maxBytes };
    throw err;
  }
  return {
    buffer: data,
    filename,
    byteLength: data.length,
    mimeType,
  };
}

// Upload a local (non-HTTPS) Seedance loose-reference image and return its
// hosted HTTPS download URL. The Client SDK's loose-reference arrays accept only
// URL strings, so this is what lets `-c <local image>` work in direct generation
// without forcing the user onto the --api-chat / --durable-chat path. Mirrors
// uploadSeedanceReferenceAudioUrl / uploadSeedanceReferenceVideoUrl.
async function uploadSeedanceReferenceImageUrl(pathOrUrl, apiKey, index = 0) {
  const ref = { flag: '-c/--context', value: pathOrUrl, kind: 'image' };
  const buffer = await fetchMediaBuffer(pathOrUrl);
  const file = await prepareSeedanceReferenceImageUploadFile(pathOrUrl, buffer);
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

function enforceWan3ReferenceCaps({ images, videos, audios }) {
  const checks = [
    ['images', images, WAN3_REFERENCE_LIMITS.images],
    ['videos', videos, WAN3_REFERENCE_LIMITS.videos],
    ['audios', audios, WAN3_REFERENCE_LIMITS.audios],
  ];
  for (const [kind, count, maximum] of checks) {
    if (count <= maximum) continue;
    const label = `reference ${kind}`;
    fatalCliError(`Wan 3 supports at most ${maximum} ${label} (got ${count}).`, {
      code: 'WAN3_REFERENCE_LIMIT_EXCEEDED',
      details: { kind, count, maximum, limits: WAN3_REFERENCE_LIMITS },
    });
  }
}

// Wraps the shared validateSeedanceReferenceCounts() so a thrown
// SeedanceReferenceLimitError is re-raised as a CLI fatal error with the same
// human message the hosted chat surfaces. Source of truth for the per-model
// numeric caps (2.0: 9 / 3 / 3 / 12; 2.5: 30 / 10 / 10 / 50) is
// @sogni-ai/sogni-protocol's seedance-reference-limits catalog, surfaced
// through @sogni-ai/sogni-intelligence-client/tools.
function enforceSeedanceReferenceCaps() {
  try {
    validateSeedanceReferenceCounts(effectiveSeedanceReferenceCounts(), options.model);
  } catch (err) {
    if (err instanceof SeedanceReferenceLimitError) {
      fatalCliError(err.message, {
        code: err.code,
        details: {
          limitKind: err.limitKind,
          requestedCount: err.requestedCount,
          maxCount: err.maxCount,
          limits: getSeedanceReferenceLimits(options.model),
        },
      });
    }
    throw err;
  }
}

// Wraps the shared validateHappyHorseReferenceCounts() so a thrown
// HappyHorseReferenceLimitError is re-raised as a CLI fatal error with the same
// human message the hosted chat surfaces. HappyHorse caps are PER MODEL (mode):
// t2v 0 images, i2v 1 first-frame image, r2v up to 9 reference images; it takes
// no reference videos or audios (audio is rendered natively). Source of truth:
// @sogni-ai/sogni-intelligence-client/tools HAPPYHORSE_REFERENCE_LIMITS.
function enforceHappyHorseReferenceCaps() {
  try {
    validateHappyHorseReferenceCounts(options.model, effectiveSeedanceReferenceCounts());
  } catch (err) {
    if (err instanceof HappyHorseReferenceLimitError) {
      fatalCliError(err.message, {
        code: err.code,
        details: {
          modelId: err.modelId,
          limitKind: err.limitKind,
          requestedCount: err.requestedCount,
          maxCount: err.maxCount,
          limits: getHappyHorseReferenceLimits(options.model) || HAPPYHORSE_REFERENCE_LIMITS,
        },
      });
    }
    throw err;
  }
}

function enforceMiniMaxH3ReferenceCaps() {
  const { images, videos, audios } = effectiveSeedanceReferenceCounts();
  const total = images + videos + audios;
  const checks = [
    ['images', images, MINIMAX_H3_REFERENCE_LIMITS.images],
    ['videos', videos, MINIMAX_H3_REFERENCE_LIMITS.videos],
    ['audios', audios, MINIMAX_H3_REFERENCE_LIMITS.audios]
  ];
  for (const [kind, count, maximum] of checks) {
    if (count > maximum) {
      fatalCliError(`MiniMax H3 r2v supports at most ${maximum} reference ${kind} (got ${count}).`, {
        code: 'MINIMAX_H3_REFERENCE_LIMIT_EXCEEDED',
        details: { kind, count, maximum, limits: MINIMAX_H3_REFERENCE_LIMITS }
      });
    }
  }
  if (total > MINIMAX_H3_REFERENCE_LIMITS.assets) {
    fatalCliError(
      `MiniMax H3 r2v supports at most ${MINIMAX_H3_REFERENCE_LIMITS.assets} reference files in total `
      + `(got ${total}: ${images} image, ${videos} video, ${audios} audio).`,
      {
        code: 'MINIMAX_H3_REFERENCE_LIMIT_EXCEEDED',
        details: { images, videos, audios, total, limits: MINIMAX_H3_REFERENCE_LIMITS }
      }
    );
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

async function runCommand(command, args, { captureOutput = false, env = undefined } = {}) {
  const options = {
    reject: false,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  };
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

async function extractFrameAtTimeFromVideo(videoPath, seconds, outputImagePath) {
  sanitizePath(videoPath, 'video path');
  sanitizePath(outputImagePath, 'output image path');
  const timestamp = Number(seconds);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    const err = new Error('Frame extraction timestamp must be a non-negative number.');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }

  // Seek after opening the input for frame-accurate visual QA. Loop Maker
  // clips are short, so accuracy is more useful here than keyframe-only speed.
  const args = [
    '-i', videoPath,
    '-ss', String(timestamp),
    '-frames:v', '1',
    '-q:v', '1',
    '-y',
    outputImagePath
  ];

  await runFrameExtraction(args, {
    videoPath,
    outputImagePath,
    which: `frame at ${timestamp}s`
  });
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

function probeLocalVideoFrameRate(filePath) {
  const ffprobePath = getEnv('FFPROBE_PATH') || 'ffprobe';
  sanitizePath(ffprobePath, 'FFPROBE_PATH');
  try {
    const stdout = execFileSync(
      ffprobePath,
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=avg_frame_rate,r_frame_rate',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    for (const candidate of String(stdout || '').trim().split(/\s+/)) {
      const frameRate = parseFrameRate(candidate);
      if (frameRate) return frameRate;
    }
  } catch {}
  return null;
}

// Probe a media file's primary video stream + whether it has any audio.
// Fields are null when the probe fails (e.g. ffprobe missing); callers fall
// back to safe defaults unless they explicitly require verification.
async function probeVideoStreamInfo(filePath) {
  const info = {
    width: null,
    height: null,
    fps: null,
    duration: null,
    hasAudio: false,
    videoCodec: null,
    audioCodec: null
  };
  const ffprobePath = getEnv('FFPROBE_PATH') || 'ffprobe';
  sanitizePath(ffprobePath, 'FFPROBE_PATH');
  const result = await runCommand(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate',
    '-show_entries', 'format=duration',
    '-of', 'json',
    filePath,
  ], { captureOutput: true });
  if (result.error || result.status !== 0) return info;
  let parsed;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch { return info; }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  info.hasAudio = Boolean(audio);
  if (video) {
    info.width = Number(video.width) || null;
    info.height = Number(video.height) || null;
    info.fps = parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate) || null;
    info.videoCodec = video.codec_name || null;
  }
  info.audioCodec = audio?.codec_name || null;
  const dur = Number(parsed?.format?.duration);
  info.duration = Number.isFinite(dur) && dur > 0 ? dur : null;
  return info;
}

async function verifyVideoFile(videoPath) {
  sanitizePath(videoPath, 'video path');
  const info = await probeVideoStreamInfo(videoPath);
  if (!info.videoCodec || !info.width || !info.height || !info.fps || !info.duration) {
    const err = new Error('Failed to read a valid video stream with ffprobe.');
    err.code = 'FFPROBE_VERIFY_FAILED';
    err.hint = 'Install ffprobe, confirm the file is a playable video, and retry.';
    err.details = { videoPath, ...info };
    throw err;
  }

  const ffmpegPath = await ensureFfmpegAvailable();
  const result = await runCommand(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', videoPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-f', 'null',
    '-'
  ], { captureOutput: true });
  if (result.error || result.status !== 0) {
    const err = new Error('Video stream verification failed during full decode.');
    err.code = 'FFMPEG_VERIFY_FAILED';
    err.hint = 'Keep the prior verified output and rebuild this file before delivery.';
    err.details = {
      videoPath,
      status: result.status,
      stderr: result.stderr || '',
      stdout: result.stdout || ''
    };
    throw err;
  }

  return { ...info, decodable: true };
}

async function trimVideoClip(inputPath, startSeconds, durationSeconds, outputPath) {
  sanitizePath(inputPath, 'trim input video');
  sanitizePath(outputPath, 'trim output video');
  const ffmpegPath = await ensureFfmpegAvailable();
  const result = await runCommand(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', inputPath,
    '-ss', String(startSeconds),
    '-t', String(durationSeconds),
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath
  ], { captureOutput: true });
  if (result.error || result.status !== 0 || !isNonEmptyFile(outputPath)) {
    const err = new Error('Failed to trim video clip.');
    err.code = 'FFMPEG_TRIM_VIDEO_FAILED';
    err.details = {
      inputPath,
      outputPath,
      startSeconds,
      durationSeconds,
      stderr: result.stderr || '',
      stdout: result.stdout || '',
      status: result.status
    };
    throw err;
  }
  return verifyVideoFile(outputPath);
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
  if (audioPath && !(totalDuration > 0)) {
    const err = new Error('Cannot replace concatenated audio without readable clip durations.');
    err.code = 'FFPROBE_VERIFY_FAILED';
    err.hint = 'Install ffprobe, confirm every clip is playable, and retry.';
    err.details = { clips, audioPath };
    throw err;
  }

  const filterParts = [];
  const concatInputs = [];
  infos.forEach((info, idx) => {
    filterParts.push(
      `[${idx}:v]fps=${fps},scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,` +
      `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${idx}]`
    );
    if (!audioPath) {
      if (info.hasAudio) {
        filterParts.push(`[${idx}:a]aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[a${idx}]`);
      } else {
        const dur = info.duration && info.duration > 0 ? info.duration : (1 / fps);
        filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${dur.toFixed(6)},asetpts=PTS-STARTPTS[a${idx}]`);
      }
    }
    concatInputs.push(audioPath ? `[v${idx}]` : `[v${idx}][a${idx}]`);
  });
  filterParts.push(
    audioPath
      ? `${concatInputs.join('')}concat=n=${infos.length}:v=1:a=0[cv]`
      : `${concatInputs.join('')}concat=n=${infos.length}:v=1:a=1[cv][ca]`
  );

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

const SOURCE_REEL_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SOURCE_REEL_DEFAULT_MODEL = 'wan_v2.2-14b-fp8_i2v_lightx2v';
const SOURCE_REEL_DEFAULT_IMAGE_PROMPT =
  'A polished camera-ready photo moment: the subject or scene comes gently to life with restrained natural motion, soft breathing or environmental movement, subtle parallax, stable lighting, and a smooth steady camera. Preserve the source image identity, composition, style, and important details.';
const SOURCE_REEL_DEFAULT_TRANSITION_PROMPT =
  'Create a seamless, well-designed transition between the two shots with continuous camera motion, natural subject movement where appropriate, consistent lighting, and a clean landing into the next frame. Avoid a simple fade; make the bridge feel intentional and cinematic.';

function sourceReelTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function sourceReelSlug(value, fallback = 'item') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

function roundToMultiple(value, multiple) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function inferSourceReelDimensions(metadata, targetShortSide) {
  const rawWidth = Number(metadata?.width) || targetShortSide;
  const rawHeight = Number(metadata?.height) || targetShortSide;
  const aspect = rawWidth > 0 && rawHeight > 0 ? rawWidth / rawHeight : 1;
  let width;
  let height;
  if (aspect >= 1) {
    height = targetShortSide;
    width = targetShortSide * aspect;
  } else {
    width = targetShortSide;
    height = targetShortSide / aspect;
  }

  const maxSide = Math.max(width, height);
  if (maxSide > 1536) {
    const scale = 1536 / maxSide;
    width *= scale;
    height *= scale;
  }
  const minSide = Math.min(width, height);
  if (minSide < 480) {
    const scale = 480 / minSide;
    width *= scale;
    height *= scale;
  }

  return {
    width: roundToMultiple(width, 16),
    height: roundToMultiple(height, 16)
  };
}

function uniqueSourceReelWorkdir(sourceDir) {
  const base = join(sourceDir, `sogni-source-reel-${sourceReelTimestamp()}`);
  if (!existsSync(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!existsSync(candidate)) return candidate;
  }
  return mkdtempSync(`${base}-`);
}

function loadSourceReelImages(sourceDir) {
  const dir = sanitizePath(sourceDir, '--source-reel');
  if (!existsSync(dir)) {
    const err = new Error(`SourceReel image folder not found: ${dir}`);
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }
  const lstats = lstatSync(dir);
  if (!lstats.isDirectory() || lstats.isSymbolicLink()) {
    const err = new Error(`SourceReel path must be a real directory: ${dir}`);
    err.code = 'INVALID_PATH';
    throw err;
  }

  const entries = readdirSync(dir);
  const images = [];
  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (!SOURCE_REEL_IMAGE_EXTS.has(ext)) continue;
    const fullPath = join(dir, entry);
    const fileStats = lstatSync(fullPath);
    if (fileStats.isSymbolicLink() || !fileStats.isFile()) continue;
    images.push({
      path: fullPath,
      name: entry,
      base: basename(entry, ext),
      slug: sourceReelSlug(entry, `image-${images.length + 1}`)
    });
  }
  images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  images.forEach((image, idx) => {
    image.index = idx + 1;
    image.id = String(idx + 1).padStart(2, '0');
  });
  return images;
}

function loadSourceReelTransitionPromptOverrides(raw) {
  if (!raw) return null;
  const parsed = parseJsonArgument(raw, '--reel-transition-prompts', 'INVALID_REEL_PROMPTS');
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return parsed;
  fatalCliError('--reel-transition-prompts must be a JSON array or object, or @path to one.', {
    code: 'INVALID_REEL_PROMPTS'
  });
}

function sourceReelTransitionOverride(overrides, index, from, to) {
  if (!overrides) return null;
  if (Array.isArray(overrides)) {
    return typeof overrides[index] === 'string' ? overrides[index] : null;
  }
  const keys = [
    `${from.id}-to-${to.id}`,
    `${from.index}-to-${to.index}`,
    `${from.slug}-to-${to.slug}`,
    `${from.base}-to-${to.base}`,
  ];
  for (const key of keys) {
    if (typeof overrides[key] === 'string') return overrides[key];
  }
  return typeof overrides.default === 'string' ? overrides.default : null;
}

function buildSourceReelPlan() {
  const sourceDir = resolve(sanitizePath(options.sourceReelDir, '--source-reel'));
  const images = loadSourceReelImages(sourceDir);
  if (images.length === 0) {
    fatalCliError(`No source images found in ${sourceDir}. Supported: jpg, jpeg, png, webp.`, {
      code: 'NO_SOURCE_IMAGES',
      details: { sourceDir }
    });
  }

  let dimensions = null;
  if (cliSet.width || cliSet.height) {
    if (!cliSet.width || !cliSet.height) {
      fatalCliError('SourceReel requires both -w and -h when overriding dimensions.', {
        code: 'INVALID_ARGUMENT'
      });
    }
    dimensions = {
      width: roundToMultiple(options.width, 16),
      height: roundToMultiple(options.height, 16)
    };
  }

  const workdir = resolve(options.sourceReelWorkdir
    ? sanitizePath(options.sourceReelWorkdir, '--reel-workdir')
    : uniqueSourceReelWorkdir(sourceDir));
  const outputPath = resolve(options.sourceReelOutput
    ? sanitizePath(options.sourceReelOutput, '--reel-output')
    : join(workdir, options.sourceReelLoop ? 'source-reel-loop.mp4' : 'source-reel.mp4'));

  const imagePrompt = options.sourceReelImagePrompt || options.prompt || SOURCE_REEL_DEFAULT_IMAGE_PROMPT;
  const transitionBasePrompt = options.sourceReelTransitionPrompt || SOURCE_REEL_DEFAULT_TRANSITION_PROMPT;
  const promptOverrides = loadSourceReelTransitionPromptOverrides(options.sourceReelTransitionPrompts);
  const model = options.sourceReelModel || (cliSet.model ? options.model : null) || SOURCE_REEL_DEFAULT_MODEL;
  const fps = cliSet.fps ? options.fps : 32;
  const concurrency = options.sourceReelConcurrency || 2;

  const clips = images.map((image) => ({
    ...image,
    refPath: join(workdir, 'refs', `${image.id}-${image.slug}.jpg`),
    clipPath: join(workdir, 'clips', `${image.id}-${image.slug}.mp4`),
    logPath: join(workdir, 'logs', 'clips', `${image.id}-${image.slug}.log`),
    prompt: imagePrompt
  }));

  const transitionCount = images.length > 1
    ? (options.sourceReelLoop ? images.length : images.length - 1)
    : 0;
  const transitions = [];
  for (let i = 0; i < transitionCount; i++) {
    const from = clips[i];
    const to = clips[(i + 1) % clips.length];
    const key = `${from.id}-to-${to.id}`;
    const override = sourceReelTransitionOverride(promptOverrides, i, from, to);
    const body = override || transitionBasePrompt;
    const prompt =
      `Start exactly on the first reference frame and end exactly on the second reference frame. ` +
      `${body}`;
    transitions.push({
      key,
      from: from.id,
      to: to.id,
      lastFramePath: join(workdir, 'frames', `${from.id}-${from.slug}-last.png`),
      firstFramePath: join(workdir, 'frames', `${to.id}-${to.slug}-first.png`),
      clipPath: join(workdir, 'transitions', `${key}.mp4`),
      logPath: join(workdir, 'logs', 'transitions', `${key}.log`),
      prompt
    });
  }

  return {
    type: 'source-reel',
    sourceDir,
    workdir,
    outputPath,
    model,
    fps,
    dimensions,
    targetResolution: options.sourceReelTargetResolution,
    imageSeconds: options.sourceReelImageSeconds,
    transitionSeconds: options.sourceReelTransitionSeconds,
    loop: Boolean(options.sourceReelLoop),
    concurrency,
    imagePrompt,
    transitionBasePrompt,
    clips,
    transitions
  };
}

function printSourceReelPlan(plan) {
  console.log('SourceReel plan');
  console.log(`  Source folder: ${plan.sourceDir}`);
  console.log(`  Working folder: ${plan.workdir}`);
  console.log(`  Final output: ${plan.outputPath}`);
  console.log(`  Images: ${plan.clips.length}`);
  console.log(`  Clip seconds: ${plan.imageSeconds}`);
  console.log(`  Transition seconds: ${plan.transitionSeconds}`);
  console.log(`  Loop last→first: ${plan.loop ? 'yes' : 'no'}`);
  console.log(`  Model: ${plan.model}`);
  console.log(`  FPS: ${plan.fps}`);
  if (plan.dimensions) {
    console.log(`  Size: ${plan.dimensions.width}x${plan.dimensions.height}`);
  } else {
    console.log(`  Size: infer from first image, short side ${plan.targetResolution}px`);
  }
  console.log('');
  console.log('Clip prompt:');
  console.log(`  ${plan.imagePrompt}`);
  console.log('');
  console.log('Default transition prompt:');
  console.log(`  ${plan.transitionBasePrompt}`);
  console.log('');
  console.log('Images:');
  for (const clip of plan.clips) {
    console.log(`  ${clip.id}. ${clip.name}`);
  }
  if (plan.transitions.length > 0) {
    console.log('');
    console.log('Transitions:');
    for (const transition of plan.transitions) {
      console.log(`  ${transition.key}: ${transition.prompt}`);
    }
  }
  console.log('');
  console.log('Run the same command without --reel-plan-only to render.');
}

async function prepareSourceReelReferenceImages(plan, log) {
  const refsDir = join(plan.workdir, 'refs');
  mkdirSync(refsDir, { recursive: true });

  let dimensions = plan.dimensions;
  if (!dimensions) {
    const metadata = await sharp(plan.clips[0].path).rotate().metadata();
    dimensions = inferSourceReelDimensions(metadata, plan.targetResolution);
    plan.dimensions = dimensions;
  }

  for (const clip of plan.clips) {
    if (isNonEmptyFile(clip.refPath)) {
      log(`SKIP ref ${clip.refPath}`);
      continue;
    }
    const background = await sharp(clip.path)
      .rotate()
      .resize(dimensions.width, dimensions.height, { fit: 'cover' })
      .blur(28)
      .modulate({ brightness: 0.72, saturation: 0.9 })
      .jpeg({ quality: 90 })
      .toBuffer();
    const foreground = await sharp(clip.path)
      .rotate()
      .resize(dimensions.width, dimensions.height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();
    await sharp(background)
      .composite([{ input: foreground, gravity: 'center' }])
      .jpeg({ quality: 95 })
      .toFile(clip.refPath);
    log(`REF   ${clip.name} -> ${clip.refPath}`);
  }
}

async function runSourceReelPool(items, concurrency, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function sourceReelChildArgs(baseArgs, outputPath, prompt, plan, duration) {
  const args = [
    fileURLToPath(import.meta.url),
    '--no-update-check',
    '-q',
    '--json',
    '--video',
    '-m', plan.model,
    '--duration', String(duration),
    '--fps', String(plan.fps),
    '-w', String(plan.dimensions.width),
    '-h', String(plan.dimensions.height),
    '-o', outputPath,
    ...baseArgs
  ];
  if (options.tokenType) args.push('--token-type', options.tokenType);
  if (options.steps !== null && options.steps !== undefined) args.push('--steps', String(options.steps));
  if (options.guidance !== null && options.guidance !== undefined) args.push('--guidance', String(options.guidance));
  if (options.noFilter) args.push('--no-filter');
  if (options.strictSize) args.push('--strict-size');
  if (cliSet.timeout) args.push('-t', String(Math.ceil(options.timeout / 1000)));
  args.push(prompt);
  return args;
}

function parseSourceReelChildJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const lastLine = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop();
    if (!lastLine) return null;
    try { return JSON.parse(lastLine); } catch { return null; }
  }
}

function sourceReelLineageEnvironment(workloadAttribution) {
  return {
    SOGNI_AGENT_OPERATION_SCOPE: workloadAttribution.operationScope,
    SOGNI_AGENT_OPERATION_ID: workloadAttribution.operationId,
    SOGNI_AGENT_ROOT_OPERATION_ID: workloadAttribution.rootOperationId,
    ...(workloadAttribution.parentOperationId
      ? { SOGNI_AGENT_PARENT_OPERATION_ID: workloadAttribution.parentOperationId }
      : {}),
  };
}

async function runSourceReelChild(label, args, logPath, outputPath, workloadAttribution) {
  const result = await runCommand(process.execPath, args, {
    captureOutput: true,
    env: sourceReelLineageEnvironment(workloadAttribution),
  });
  const parsed = parseSourceReelChildJson(result.stdout);
  const logBody = [
    `label=${label}`,
    `command=${process.execPath} ${args.map((x) => JSON.stringify(x)).join(' ')}`,
    '',
    'stdout:',
    result.stdout || '',
    '',
    'stderr:',
    result.stderr || ''
  ].join('\n');
  writeOutputFileSafe(logPath, Buffer.from(logBody), 'SourceReel render log');
  if (result.error || result.status !== 0 || !parsed?.success || !isNonEmptyFile(outputPath)) {
    const err = new Error(`SourceReel render failed: ${label}`);
    err.code = parsed?.errorCode || parsed?.code || 'SOURCE_REEL_RENDER_FAILED';
    err.hint = parsed?.hint || `See log: ${logPath}`;
    err.details = { label, outputPath, logPath, status: result.status, child: parsed || null };
    throw err;
  }
  return parsed;
}

async function runSourceReel(log) {
  const plan = buildSourceReelPlan();
  if (options.sourceReelPlanOnly) {
    if (options.json || JSON_ERROR_MODE) {
      console.log(JSON.stringify({ success: true, ...plan, timestamp: new Date().toISOString() }));
    } else {
      printSourceReelPlan(plan);
    }
    return;
  }

  mkdirSync(plan.workdir, { recursive: true });
  mkdirSync(join(plan.workdir, 'clips'), { recursive: true });
  mkdirSync(join(plan.workdir, 'transitions'), { recursive: true });
  mkdirSync(join(plan.workdir, 'frames'), { recursive: true });
  mkdirSync(join(plan.workdir, 'logs', 'clips'), { recursive: true });
  mkdirSync(join(plan.workdir, 'logs', 'transitions'), { recursive: true });

  await prepareSourceReelReferenceImages(plan, log);
  writeOutputFileSafe(join(plan.workdir, 'plan.json'), Buffer.from(JSON.stringify(plan, null, 2)), 'SourceReel plan');

  log(`SourceReel rendering ${plan.clips.length} clips (${plan.imageSeconds}s each)...`);
  await runSourceReelPool(plan.clips, plan.concurrency, async (clip) => {
    if (isNonEmptyFile(clip.clipPath)) {
      log(`SKIP clip ${clip.clipPath}`);
      return;
    }
    log(`START clip ${clip.id} ${clip.name}`);
    const args = sourceReelChildArgs(['--ref', clip.refPath], clip.clipPath, clip.prompt, plan, plan.imageSeconds);
    const workloadAttribution = nextSemanticWorkloadAttribution();
    await runSourceReelChild(
      `clip ${clip.id}`,
      args,
      clip.logPath,
      clip.clipPath,
      workloadAttribution,
    );
    log(`DONE  clip ${clip.id} -> ${clip.clipPath}`);
  });

  for (const transition of plan.transitions) {
    const fromClip = plan.clips.find((clip) => clip.id === transition.from);
    const toClip = plan.clips.find((clip) => clip.id === transition.to);
    if (!isNonEmptyFile(transition.lastFramePath)) {
      log(`FRAME last ${fromClip.clipPath} -> ${transition.lastFramePath}`);
      await extractLastFrameFromVideo(fromClip.clipPath, transition.lastFramePath);
    }
    if (!isNonEmptyFile(transition.firstFramePath)) {
      log(`FRAME first ${toClip.clipPath} -> ${transition.firstFramePath}`);
      await extractFirstFrameFromVideo(toClip.clipPath, transition.firstFramePath);
    }
  }

  if (plan.transitions.length > 0) {
    log(`SourceReel rendering ${plan.transitions.length} transitions (${plan.transitionSeconds}s each)...`);
    await runSourceReelPool(plan.transitions, plan.concurrency, async (transition) => {
      if (isNonEmptyFile(transition.clipPath)) {
        log(`SKIP transition ${transition.clipPath}`);
        return;
      }
      log(`START transition ${transition.key}`);
      const args = sourceReelChildArgs(
        ['--ref', transition.lastFramePath, '--ref-end', transition.firstFramePath],
        transition.clipPath,
        transition.prompt,
        plan,
        plan.transitionSeconds
      );
      const workloadAttribution = nextSemanticWorkloadAttribution();
      await runSourceReelChild(
        `transition ${transition.key}`,
        args,
        transition.logPath,
        transition.clipPath,
        workloadAttribution,
      );
      log(`DONE  transition ${transition.key} -> ${transition.clipPath}`);
    });
  }

  const concatParts = [];
  for (const clip of plan.clips) {
    concatParts.push(clip.clipPath);
    const transition = plan.transitions.find((item) => item.from === clip.id);
    if (transition) concatParts.push(transition.clipPath);
  }

  if (concatParts.length === 1) {
    // Single-image reels have no bridge clips. Normalize through concat anyway
    // would require two inputs, so preserve the generated clip as the final.
    const buffer = readFileSync(concatParts[0]);
    writeOutputFileSafe(plan.outputPath, buffer, 'SourceReel final video');
  } else {
    log(`SourceReel stitching ${concatParts.length} clips -> ${plan.outputPath}`);
    await buildConcatVideoFromClips(plan.outputPath, concatParts, { targetFps: plan.fps });
  }

  if (options.json || JSON_ERROR_MODE) {
    console.log(JSON.stringify({
      success: true,
      type: 'source-reel',
      sourceDir: plan.sourceDir,
      workdir: plan.workdir,
      outputPath: plan.outputPath,
      imageCount: plan.clips.length,
      transitionCount: plan.transitions.length,
      imageSeconds: plan.imageSeconds,
      transitionSeconds: plan.transitionSeconds,
      loop: plan.loop,
      model: plan.model,
      fps: plan.fps,
      width: plan.dimensions.width,
      height: plan.dimensions.height,
      timestamp: new Date().toISOString()
    }));
  } else {
    console.log(`SourceReel complete: ${plan.outputPath}`);
    console.log(`Working folder: ${plan.workdir}`);
  }
}

async function buildProjectTimeoutError(projects, timeoutMs, label = 'Project') {
  const timeoutSeconds = timeoutMs / 1000;
  const cancellableProjects = [...new Set((projects || []).filter(Boolean))]
    .filter((project) => typeof project.cancel === 'function');
  const projectIds = cancellableProjects
    .map((project) => project.id)
    .filter(Boolean);

  if (cancellableProjects.length === 0) {
    const error = new Error(
      `Timeout after ${timeoutSeconds}s; no cancellable Sogni project handle was available. ` +
      'The project may still be running.'
    );
    error.code = 'PROJECT_TIMEOUT_CANCEL_UNAVAILABLE';
    error.details = { timeoutSeconds, projectIds: [], canceled: false };
    return error;
  }

  const failures = [];
  for (const project of cancellableProjects) {
    try {
      await project.cancel();
    } catch (cancelError) {
      failures.push({
        projectId: project.id || null,
        message: cancelError?.message || String(cancelError)
      });
    }
  }

  if (failures.length > 0) {
    const failedIds = failures.map((failure) => failure.projectId).filter(Boolean);
    const error = new Error(
      `Timeout after ${timeoutSeconds}s; failed to cancel Sogni ${label.toLowerCase()} ` +
      `${failedIds.join(', ') || '(unknown id)'}. The project may still be running.`
    );
    error.code = 'PROJECT_TIMEOUT_CANCEL_FAILED';
    error.details = { timeoutSeconds, projectIds, canceled: false, failures };
    return error;
  }

  const error = new Error(
    `Timeout after ${timeoutSeconds}s; canceled Sogni ${label.toLowerCase()} ` +
    `${projectIds.join(', ') || '(unknown id)'}.`
  );
  error.code = 'PROJECT_TIMEOUT';
  error.details = { timeoutSeconds, projectIds, canceled: true };
  return error;
}

async function runImageEditProjectWithEvents(client, editConfig, expectedCount, log, timeoutMs, label) {
  const results = [];
  let completed = 0;
  let projectId = null;
  let activeProject = null;

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
    void buildProjectTimeoutError([activeProject], timeoutMs, 'image edit project')
      .then(rejectPromise);
  }, timeoutMs);

  client.on(ClientEvent.JOB_COMPLETED, onCompleted);
  client.on(ClientEvent.JOB_FAILED, onFailed);

  try {
    const projectResult = await client.createImageEditProject(withBillingMode(editConfig));
    activeProject = projectResult?.project || null;
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
  const steps = options.steps ?? modelDefaults?.steps ?? (isLightningImageModelSelection(options.model) ? 4 : 20);
  const guidance = options.guidance ?? modelDefaults?.guidance ?? (isLightningImageModelSelection(options.model) ? 1.0 : 4.0);

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
      tokenType: options.tokenType || 'spark',
      waitForCompletion: false,
      disableNSFWFilter: options.noFilter === true,
      ...buildImageEditExecutionControls(options.model, {
        steps,
        guidance,
        sampler: options.sampler,
        scheduler: options.scheduler
      }, {
        steps: cliSet.steps ? options.steps : undefined,
        guidance: cliSet.guidance ? options.guidance : undefined,
        sampler: cliSet.sampler ? options.sampler : undefined,
        scheduler: cliSet.scheduler ? options.scheduler : undefined
      })
    };
    if (options.outputFormat) {
      editConfig.outputFormat = options.outputFormat;
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
      const clipResult = await client.createVideoProject(withBillingMode(clipConfig));

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

function miniMaxH3R2vReferenceImageCount() {
  if (!isMiniMaxH3R2vModel(options.model)) return undefined;
  return (options.refImage ? 1 : 0)
    + (Array.isArray(options.contextImages) ? options.contextImages.length : 0);
}

function buildVideoEstimateParams({ tokenType, steps }) {
  const isSeedanceVideo = isSeedanceModel(options.model);
  const isWan3Video = isWan3ModelLocal(options.model);
  const referenceImageCount = miniMaxH3R2vReferenceImageCount();
  const params = {
    modelId: options.model,
    width: options.width,
    height: options.height,
    fps: options.fps,
    numberOfMedia: options.count,
    tokenType,
    ...(Number.isFinite(steps) && steps > 0 ? { steps } : {}),
    ...(options.frames ? { frames: options.frames } : { duration: options.duration }),
    ...(referenceImageCount !== undefined ? { referenceImageCount } : {})
  };

  if ((isSeedanceVideo || isWan3Video) && options.refVideo) {
    params.hasVideoInput = true;
    if (isHttpsUrl(options.refVideo)) {
      params.referenceVideoUrls = [options.refVideo];
    } else {
      params.referenceVideo = true;
    }
  }

  return params;
}

function isMiniMaxH3ExtendedDurationEstimateError(err) {
  const actualDuration = options.frames
    ? options.frames / options.fps
    : options.duration;
  return isMiniMaxH3Model(options.model)
    && actualDuration > 10
    && /duration must be between 1 and 10 seconds/i.test(String(err?.message || err || ''));
}

function buildMiniMaxH3EstimateUnavailableError(cause) {
  const err = new Error(
    'MiniMax H3 generation supports clips through 15.08 seconds, but this client cannot pre-estimate clips over 10 seconds.'
  );
  err.code = 'VIDEO_COST_ESTIMATE_UNAVAILABLE';
  err.retryable = false;
  err.hint = 'Submit without --estimate-video-cost so the server can validate balance when the render starts, or estimate a clip of 10 seconds or less.';
  err.cause = cause;
  return err;
}

async function ensureSufficientVideoBalance(client, log) {
  if (!options.video || options.estimateVideoCost) return;
  // Sogni Unlimited bills covered video jobs to the subscription, so a low
  // token balance must not block them client-side. Vendor models
  // (Seedance/HappyHorse) always bill Premium Spark and keep the check, as
  // does an explicit --billing-mode tokens opt-out. The server stays
  // authoritative: an uncovered job still fails there with enriched guidance.
  if (options.billingMode !== 'tokens' && !requiresSparkOnlyToken(options.model)) {
    const subscription = await fetchSubscriptionSnapshot(client, log);
    if (subscription?.active === true) return;
  }
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
  const isStepFreeVendorVideo = isSeedanceVideo
    || isHappyHorseModel(options.model)
    || isWan3ModelLocal(options.model);
  if (!isStepFreeVendorVideo && (!Number.isFinite(steps) || steps <= 0)) return;

  let estimate;
  try {
    estimate = await client.estimateVideoCost(buildVideoEstimateParams({ tokenType, steps }));
  } catch (err) {
    if (!options.quiet) {
      if (isMiniMaxH3ExtendedDurationEstimateError(err)) {
        const estimateError = buildMiniMaxH3EstimateUnavailableError(err);
        log(`Note: ${estimateError.message} ${estimateError.hint}`);
      } else {
        log(`Warning: Could not estimate video cost (${err?.message || 'error'})`);
      }
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
        appId: getOrCreateSogniAppId(),
        attribution: clientAttribution(AGENT_ATTRIBUTION),
        network: openclawConfig?.defaultNetwork || 'fast',
        autoConnect: false,
        apiKey: creds.SOGNI_API_KEY,
        authType: 'apiKey'
      });
      const authFlow = (async () => {
        await connectSogniClient(doctorClient);
        const balance = await doctorClient.getBalance();
        // Identity + entitlement are best-effort: an old wrapper or a flaky
        // subscription endpoint must not fail the auth check itself.
        let accountInfo = null;
        if (typeof doctorClient.getAccountInfo === 'function') {
          try {
            accountInfo = await doctorClient.getAccountInfo();
          } catch { /* ignore */ }
        }
        const subscription = await fetchSubscriptionSnapshot(doctorClient, null);
        return { balance, accountInfo, subscription };
      })();
      const { balance, accountInfo, subscription } = await Promise.race([
        authFlow,
        new Promise((_, reject) => setTimeout(
          () => reject(Object.assign(new Error('timed out'), { code: 'DOCTOR_TIMEOUT' })),
          DOCTOR_AUTH_TIMEOUT_MS
        ))
      ]);
      const spark = Number.parseFloat(balance?.spark);
      const sogni = Number.parseFloat(balance?.sogni);
      const identity = accountInfo?.username ? `user ${accountInfo.username}, ` : '';
      add('auth', 'pass',
        `API key accepted (${identity}SPARK ${Number.isFinite(spark) ? spark : '?'}, SOGNI ${Number.isFinite(sogni) ? sogni : '?'})`);
      if (subscription) {
        if (subscription.active === true) {
          add('plan', 'pass', describeSubscription(subscription));
        } else if (Number.isFinite(spark) && spark <= 0 && Number.isFinite(sogni) && sogni <= 0) {
          add('plan', 'warn', 'no subscription and no token balance — renders will fail until you buy Spark Packs or subscribe');
        } else {
          add('plan', 'pass', 'none — renders bill Spark/SOGNI from this account\'s balance');
        }
      }
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
    if (options.video && isWan3ModelLocal(options.model)) {
      await prepareWan3ReferenceMediaPlan();
    }

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

    if (options.liveModelAction) {
      await runLiveModels();
      return;
    }

    if (options.loraCatalogAction) {
      await runLoraCatalog();
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

    if (options.extractFrameAt) {
      const videoPath = sanitizePath(options.extractFrameAt, '--extract-frame-at video');
      const outputPath = sanitizePath(options.extractFrameAtOutput, '--extract-frame-at output');
      if (!existsSync(videoPath)) {
        const err = new Error(`Video file not found: ${videoPath}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      await extractFrameAtTimeFromVideo(videoPath, options.extractFrameAtSeconds, outputPath);
      if (options.json || JSON_ERROR_MODE) {
        console.log(JSON.stringify({
          success: true,
          type: 'extract-frame-at',
          seconds: options.extractFrameAtSeconds,
          outputPath,
          timestamp: new Date().toISOString()
        }));
      } else {
        console.log(`Extracted frame at ${options.extractFrameAtSeconds}s to: ${outputPath}`);
      }
      return;
    }

    if (options.trimVideo) {
      const inputPath = sanitizePath(options.trimVideo, '--trim-video input');
      const outputPath = sanitizePath(options.trimVideoOutput, '--trim-video output');
      if (!existsSync(inputPath)) {
        const err = new Error(`Video file not found: ${inputPath}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      const verification = await trimVideoClip(
        inputPath,
        options.trimVideoStart,
        options.trimVideoDuration,
        outputPath
      );
      if (options.json || JSON_ERROR_MODE) {
        console.log(JSON.stringify({
          success: true,
          type: 'trim-video',
          inputPath,
          outputPath,
          start: options.trimVideoStart,
          duration: options.trimVideoDuration,
          ...verification,
          timestamp: new Date().toISOString()
        }));
      } else {
        console.log(
          `Trimmed ${options.trimVideoDuration}s from ${options.trimVideoStart}s to: ${outputPath}`
        );
      }
      return;
    }

    if (options.verifyVideo) {
      const videoPath = sanitizePath(options.verifyVideo, '--verify-video input');
      if (!existsSync(videoPath)) {
        const err = new Error(`Video file not found: ${videoPath}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      const verification = await verifyVideoFile(videoPath);
      if (options.json || JSON_ERROR_MODE) {
        console.log(JSON.stringify({
          success: true,
          type: 'verify-video',
          videoPath,
          ...verification,
          timestamp: new Date().toISOString()
        }));
      } else {
        const audio = verification.hasAudio
          ? `audio=${verification.audioCodec || 'present'}`
          : 'audio=none';
        console.log(
          `Verified video: ${videoPath} ` +
          `(${verification.width}x${verification.height}, ${verification.fps} fps, ` +
          `${verification.duration.toFixed(3)}s, video=${verification.videoCodec}, ${audio})`
        );
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

    if (options.sourceReelDir) {
      await runSourceReel(log);
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
      appId: getOrCreateSogniAppId(),
      attribution: clientAttribution(AGENT_ATTRIBUTION),
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
      // Identity + plan make wrong-account and no-subscription states visible
      // (a low Spark balance is fine when Unlimited covers the renders).
      const subscription = await fetchSubscriptionSnapshot(client, log);
      let accountInfo = null;
      if (typeof client.getAccountInfo === 'function') {
        try {
          accountInfo = await client.getAccountInfo();
        } catch { /* identity display is best-effort */ }
      }
      if (options.json) {
        console.log(JSON.stringify({
          success: true,
          type: 'balance',
          spark: Number.isFinite(spark) ? spark : null,
          sogni: Number.isFinite(sogni) ? sogni : null,
          tokenType: options.tokenType || 'spark',
          username: accountInfo?.username ?? null,
          subscription: subscription
            ? {
                active: subscription.active === true,
                status: subscription.status ?? null,
                tier: subscription.tier ?? null
              }
            : null,
          timestamp: new Date().toISOString()
        }));
      } else {
        if (accountInfo?.username) {
          console.log(`Account: ${accountInfo.username}`);
        }
        if (subscription) {
          console.log(`Plan: ${describeSubscription(subscription)}`);
        }
        console.log(`SPARK: ${formatTokenValue(spark)}`);
        console.log(`SOGNI: ${formatTokenValue(sogni)}`);
      }
      return;
    }

    // Video catalog data is loaded before model-aware dimension planning.
    // Other media types retain the connected-stage lookup used previously.
    if (!options.video) {
      await loadLiveModelDefaults(options.model);
    }
    await ensureSufficientVideoBalance(client, log);

    if (options.estimateVideoCost) {
      const modelDefaults = getModelDefaults(options.model, openclawConfig);
      const steps = resolveVideoSteps(options.model, modelDefaults, options.steps);
      const isSeedanceVideo = isSeedanceModel(options.model);
      const isStepFreeVendorVideo = isSeedanceVideo
        || isHappyHorseModel(options.model)
        || isWan3ModelLocal(options.model);
      if (!isStepFreeVendorVideo && (!Number.isFinite(steps) || steps <= 0)) {
        const err = new Error('--estimate-video-cost requires --steps (or modelDefaults for this model).');
        err.code = 'MISSING_STEPS';
        err.hint = 'Pass --steps explicitly (e.g. --steps 4 for lightx2v models).';
        throw err;
      }
      const estimateParams = buildVideoEstimateParams({
        tokenType: options.tokenType || 'spark',
        steps
      });
      let estimate;
      try {
        estimate = await client.estimateVideoCost(estimateParams);
      } catch (err) {
        if (isMiniMaxH3ExtendedDurationEstimateError(err)) {
          throw buildMiniMaxH3EstimateUnavailableError(err);
        }
        throw err;
      }
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
    const activeProjects = new Set();
    const trackProjectResult = (projectResult) => {
      if (projectResult?.project) activeProjects.add(projectResult.project);
      return projectResult;
    };
    
    const completionPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        void buildProjectTimeoutError([...activeProjects], options.timeout)
          .then(reject);
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
      for (const referenceAudio of options.refAudios) log(`Additional reference audio: ${referenceAudio}`);
      if (options.referenceAudioIdentity) log(`Voice identity: ${options._voicePersonaResolvedName || options.referenceAudioIdentity}`);
      if (options.refVideo) log(`Reference video: ${options.refVideo}`);
      for (const referenceVideo of options.refVideos) log(`Additional reference video: ${referenceVideo}`);
      if (options.videoWorkflow === 'r2v') {
        for (const contextImage of options.contextImages) log(`Loose reference image: ${contextImage}`);
      }

      const isSeedanceVideo = isSeedanceModel(options.model);
      const isHappyHorseVideo = isHappyHorseModel(options.model);
      const isWan3Video = isWan3ModelLocal(options.model);
      const isMiniMaxH3R2v = isMiniMaxH3R2vModel(options.model);
      // Vendor video models forward image references as HTTPS URL arrays (or
      // Sogni-hosted uploads) instead of inline buffers; HappyHorse takes
      // image-only references (i2v first_frame, r2v reference_image).
      const isVendorReferenceVideo = isSeedanceVideo || isHappyHorseVideo || isWan3Video;
      if (isSeedanceVideo) {
        // Source of truth: @sogni-ai/sogni-protocol catalogs/seedance-reference-limits.json
        // surfaced through @sogni-ai/sogni-intelligence-client/tools.
        enforceSeedanceReferenceCaps();
      }
      if (isHappyHorseVideo) {
        // Source of truth: @sogni-ai/sogni-intelligence-client/tools
        // HAPPYHORSE_REFERENCE_LIMITS (per-mode image-only caps).
        enforceHappyHorseReferenceCaps();
      }
      if (isWan3Video) {
        const looseImageCount = (options.refImage && options.videoWorkflow !== 'i2v' ? 1 : 0)
          + options.contextImages.length;
        enforceWan3ReferenceCaps({
          images: looseImageCount,
          videos: (options.refVideo ? 1 : 0) + options.refVideos.length,
          audios: (options.refAudio ? 1 : 0) + options.refAudios.length,
        });
      }
      if (isMiniMaxH3R2v) {
        enforceMiniMaxH3ReferenceCaps();
      }
      const seedanceReferenceImageUrls = [];
      const seedanceReferenceVideoUrls = [];
      const seedanceReferenceAudioUrls = [];
      // Argument roles, never file location, determine provider semantics.
      // --ref/--ref-end are dedicated frame anchors even when they are HTTPS;
      // -c/--context is loose reference media. IA2V is the one typed exception:
      // its image travels beside audio as a loose @Image reference. HappyHorse
      // has no binary frame upload field and keeps URL forwarding.
      let useRefImageUrl = false;
      let useRefImageEndUrl = false;
      if (isHappyHorseVideo) {
        useRefImageUrl = await appendSafeSeedanceReferenceUrl(
          seedanceReferenceImageUrls,
          options.refImage,
          'Reference image',
        );
        useRefImageEndUrl = await appendSafeSeedanceReferenceUrl(
          seedanceReferenceImageUrls,
          options.refImageEnd,
          'End reference image',
        );
      } else if (
        (isSeedanceVideo && options.videoWorkflow === 'ia2v' && options.refImage)
        || (isWan3Video && options.videoWorkflow !== 'i2v' && options.refImage)
      ) {
        if (isHttpsUrl(options.refImage)) {
          useRefImageUrl = await appendSafeSeedanceReferenceUrl(
            seedanceReferenceImageUrls,
            options.refImage,
            'Reference image',
          );
        } else {
          seedanceReferenceImageUrls.push(await uploadSeedanceReferenceImageUrl(
            options.refImage,
            creds.SOGNI_API_KEY,
            0,
          ));
          useRefImageUrl = true;
        }
      }
      const refAudioFormatByPath = options.refAudio
        ? detectReferenceAudioFormat(
            new Uint8Array(),
            normalizeReferenceAudioMimeType(mimeTypeForPath(options.refAudio, 'application/octet-stream'))
              || mimeTypeForPath(options.refAudio, 'application/octet-stream')
          )
        : 'unknown';
      let projectVideoStart = options.videoStart;
      let useRefAudioUrl = false;
      if (isWan3Video && options.refAudio) {
        seedanceReferenceAudioUrls.push(await uploadWan3ReferenceAudioUrl(
          options.refAudio,
          creds.SOGNI_API_KEY,
          0,
        ));
        useRefAudioUrl = true;
      } else if (isSeedanceVideo && options.refAudio) {
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
      if (isWan3Video && options.refVideo) {
        seedanceReferenceVideoUrls.push(await uploadWan3ReferenceVideoUrl(
          options.refVideo,
          creds.SOGNI_API_KEY,
          0,
        ));
        useRefVideoUrl = true;
        projectVideoStart = null;
      } else if (isSeedanceVideo && options.refVideo) {
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

      // Vendor loose image references: -c/--context images beyond start/end.
      // The Sogni Client SDK accepts only URL arrays for these
      // (createJobRequestMessage), so each entry must resolve to an HTTPS URL.
      // HTTPS inputs are forwarded as-is (SSRF-validated); local files are
      // uploaded to a Sogni-hosted URL first. This lets `-c <local image>` work
      // in direct generation without a detour through --api-chat / --durable-chat.
      // Seedance treats these as @ImageN loose refs; HappyHorse r2v treats them
      // as reference_image inputs (up to 9).
      if (isVendorReferenceVideo) {
        for (const [ctxIndex, ctxImage] of (Array.isArray(options.contextImages) ? options.contextImages : []).entries()) {
          if (!ctxImage) continue;
          if (isHttpsUrl(ctxImage)) {
            await appendSafeSeedanceReferenceUrl(seedanceReferenceImageUrls, ctxImage, 'Image reference');
          } else {
            const uploadedImageUrl = await uploadSeedanceReferenceImageUrl(
              ctxImage,
              creds.SOGNI_API_KEY,
              ctxIndex,
            );
            seedanceReferenceImageUrls.push(uploadedImageUrl);
          }
        }
      }
      // Loose extras: Seedance forwards compatible HTTPS assets; Wan 3 uploads
      // the already-probed assets without silently dividing or trimming them.
      // HappyHorse takes no reference audio or video.
      if (isSeedanceVideo || isWan3Video) {
        for (const [extraAudioIndex, extraAudio] of options.refAudios.entries()) {
          if (isWan3Video) {
            seedanceReferenceAudioUrls.push(await uploadWan3ReferenceAudioUrl(
              extraAudio,
              creds.SOGNI_API_KEY,
              extraAudioIndex + (options.refAudio ? 1 : 0),
            ));
            continue;
          }
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
        for (const [extraVideoIndex, extraVideo] of options.refVideos.entries()) {
          if (isWan3Video) {
            seedanceReferenceVideoUrls.push(await uploadWan3ReferenceVideoUrl(
              extraVideo,
              creds.SOGNI_API_KEY,
              extraVideoIndex + (options.refVideo ? 1 : 0),
            ));
            continue;
          }
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
      let maskBuffer = options.refMask ? await fetchMediaBuffer(options.refMask) : undefined;
      const contextImageBuffers = isMiniMaxH3R2v
        ? await Promise.all(options.contextImages.map((reference) => fetchMediaBuffer(reference)))
        : [];
      let additionalAudioBuffers = isMiniMaxH3R2v
        ? await Promise.all(options.refAudios.map((reference) => fetchMediaBuffer(reference)))
        : [];
      const additionalVideoBuffers = isMiniMaxH3R2v
        ? await Promise.all(options.refVideos.map((reference) => fetchMediaBuffer(reference)))
        : [];
      const miniMaxH3ReferenceVideoDurations = isMiniMaxH3R2v
        ? await Promise.all(
            [
              ...(videoBuffer ? [{ buffer: videoBuffer, source: options.refVideo }] : []),
              ...additionalVideoBuffers.map((buffer, index) => ({
                buffer,
                source: options.refVideos[index]
              }))
            ].map(async ({ buffer, source }, index) => {
              const duration = await probeLocalMediaDurationSeconds(source)
                ?? await probeMediaBufferDurationSeconds(
                  buffer,
                  mediaFilenameFromSource(source, `h3-reference-video-${index + 1}.mp4`)
                );
              if (!Number.isFinite(duration) || duration < 2 || duration > 15) {
                fatalCliError(
                  `MiniMax H3 reference video ${index + 1} must be between 2 and 15 seconds.`,
                  {
                    code: 'INVALID_ARGUMENT',
                    details: { source, duration: duration ?? null }
                  }
                );
              }
              return duration;
            })
          )
        : [];
      let pretrimmedMiniMaxH3ReferenceAudio = false;
      if (audioBuffer) {
        audioBuffer = await prepareReferenceAudioForVideoBuffer(audioBuffer, options.refAudio);
        if (
          isMiniMaxH3R2v
          && (
            (Number.isFinite(options.audioStart) && options.audioStart > 0)
            || (Number.isFinite(options.audioDuration) && options.audioDuration > 0)
          )
        ) {
          audioBuffer = await trimPreparedReferenceAudioWindowBuffer(audioBuffer, {
            startSeconds: options.audioStart ?? 0,
            durationSeconds: options.audioDuration,
          });
          pretrimmedMiniMaxH3ReferenceAudio = true;
        }
      }
      if (additionalAudioBuffers.length > 0) {
        additionalAudioBuffers = await Promise.all(
          additionalAudioBuffers.map((buffer, index) =>
            prepareReferenceAudioForVideoBuffer(buffer, options.refAudios[index])
          )
        );
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

      if (
        options.videoWorkflow === 'v2v' &&
        (options.videoControlNetName === 'outpaint' || options.videoControlNetName === 'inpaint')
      ) {
        let sourceVideoDimensions = null;
        if (options.refVideo && !isHttpUrl(options.refVideo) && existsSync(options.refVideo)) {
          const probed = await probeVideoStreamInfo(options.refVideo);
          if (probed.width && probed.height) {
            sourceVideoDimensions = { width: probed.width, height: probed.height };
          }
        }

        if (options.videoControlNetName === 'outpaint') {
          const outpaintDimensions = computeOutpaintCanvas(
            sourceVideoDimensions?.width ?? options.width,
            sourceVideoDimensions?.height ?? options.height,
            options.outpaintAspectRatio,
            options.outpaintPosition || 'center',
            videoDimensionRules
          );
          if (outpaintDimensions.width !== options.width || outpaintDimensions.height !== options.height) {
            if (!options.quiet) {
              const ratioLabel = options.outpaintAspectRatio ? ` for ${options.outpaintAspectRatio}` : '';
              console.error(
                `Adjusted outpaint canvas from ${options.width}x${options.height} ` +
                `to ${outpaintDimensions.width}x${outpaintDimensions.height}${ratioLabel}.`
              );
            }
            options.width = outpaintDimensions.width;
            options.height = outpaintDimensions.height;
          }
        } else if (options.videoControlNetName === 'inpaint' && sourceVideoDimensions) {
          const hasExplicitVideoDimensions =
            (cliSet.width || widthFromConfig || widthFromPrompt) &&
            (cliSet.height || heightFromConfig || heightFromPrompt);
          if (!hasExplicitVideoDimensions) {
            const inpaintDimensions = computeSourceAspectCanvas(
              sourceVideoDimensions.width,
              sourceVideoDimensions.height,
              videoDimensionRules,
              options.targetResolution
            );
            if (inpaintDimensions.width !== options.width || inpaintDimensions.height !== options.height) {
              if (!options.quiet) {
                console.error(
                  `Adjusted inpaint canvas from ${options.width}x${options.height} ` +
                  `to ${inpaintDimensions.width}x${inpaintDimensions.height} to match the source video aspect.`
                );
              }
              options.width = inpaintDimensions.width;
              options.height = inpaintDimensions.height;
            }
          }
        }
      }

      // Pre-resize reference images to model-compatible dimensions if needed for i2v workflow.
      // The earlier preflight can inspect local files, but HTTPS references are downloaded only
      // here. Re-check the actual buffer so remote and local inputs follow the same grid rules.
      if (options.videoWorkflow === 'i2v' && imageBuffer) {
        const dims = await getVideoImageDimensionsFromBuffer(imageBuffer);
        if (dims?.width && dims?.height) {
          const predicted = predictSharpInsideResizeDims(dims.width, dims.height, options.width, options.height);
          if (options._needsRefResize || videoDimensionsAreIncompatible(predicted, videoDimensionRules)) {
            const requested = { width: options.width, height: options.height };
            const resizedBuffer = await resizeImageBufferForVideo(imageBuffer, dims.width, dims.height, videoDimensionRules);
            const resizedDims = await getVideoImageDimensionsFromBuffer(resizedBuffer);
            if (resizedDims?.width && resizedDims?.height) {
              options.width = resizedDims.width;
              options.height = resizedDims.height;
              options._needsRefResize = true;
              options._effectiveVideoDims = {
                width: resizedDims.width,
                height: resizedDims.height,
                refWidth: dims.width,
                refHeight: dims.height,
                requestedWidth: requested.width,
                requestedHeight: requested.height
              };
              if (!options._adjustedVideoDims) {
                options._adjustedVideoDims = {
                  reason: 'i2v-ref-pre-resize',
                  referenceType: 'refImage',
                  requested,
                  resizedFrom: predicted,
                  resizedTo: { width: resizedDims.width, height: resizedDims.height }
                };
              }
            }
            if (!options.quiet && resizedDims?.width && resizedDims?.height) {
              console.error(
                `Pre-resized reference image from ${dims.width}x${dims.height} to ${resizedDims.width}x${resizedDims.height} ` +
                `(divisible by ${videoDimensionRules.dimensionMultiple}) to ensure i2v compatibility.`
              );
            }
            imageBuffer = resizedBuffer;
          }
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

      if (isWan3Video && options.wan3ReferenceFileUrl) {
        await assertSafeUrl(options.wan3ReferenceFileUrl, { allowedProtocols: ['https:'] });
      }
      if (isWan3Video && options.wan3ReferenceLinkUrl) {
        await assertSafeUrl(options.wan3ReferenceLinkUrl, { allowedProtocols: ['https:'] });
      }
      
      const projectConfig = {
        modelId: options.model,
        positivePrompt: options.prompt,
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
      if (!isWan3Video && !isHappyHorseVideo && !isSeedanceVideo) {
        projectConfig.negativePrompt = '';
      }
      if (options.seedanceTaskType) {
        projectConfig.seedanceTaskType = options.seedanceTaskType;
      }
      if (isWan3Video) {
        projectConfig.ratio = options.wan3Ratio;
        projectConfig.generateAudio = options.apiGenerateAudio ?? true;
        projectConfig.promptExtend = options.apiExpandPrompt ?? true;
        projectConfig.watermark = options.wan3Watermark;
        if (options.wan3SmartDuration) projectConfig.smartDuration = true;
        if (options.wan3ReferenceFileUrl) projectConfig.referenceFileUrl = options.wan3ReferenceFileUrl;
        if (options.wan3ReferenceLinkUrl) projectConfig.referenceLinkUrl = options.wan3ReferenceLinkUrl;
      }

      if (options.outputFormat) {
        projectConfig.outputFormat = options.outputFormat;
      }
      // Loose R2V references describe identity, style, motion, or other context;
      // they are never frame anchors and must not redefine the output canvas.
      // Older wrapper releases only misclassify the binary referenceImage path;
      // URL-array references are already ignored and must retain normal dimension
      // validation, so keep this compatibility guard as narrow as possible.
      const hasLooseBinaryReference = Boolean(projectConfig.referenceImage)
        && (options.videoWorkflow === 'r2v' || options.seedanceTaskType === 'reference');
      if (hasLooseBinaryReference) {
        projectConfig.autoResizeVideoAssets = false;
      } else if (options.autoResizeVideoAssets !== null) {
        projectConfig.autoResizeVideoAssets = options.autoResizeVideoAssets;
      } else if (options._ltxReferencePassthrough) {
        projectConfig.autoResizeVideoAssets = false;
      }

      if (options.frames) {
        projectConfig.frames = options.frames;
      } else if (!options.wan3SmartDuration) {
        projectConfig.duration = options.duration;
      }
      
      // Add end frame for interpolation if provided
      if (endImageBuffer) {
        projectConfig.referenceImageEnd = endImageBuffer;
      }
      if (contextImageBuffers.length > 0) {
        projectConfig.contextImages = contextImageBuffers;
      }
      applyLtxTransitionLora(
        projectConfig,
        options.model,
        Boolean(projectConfig.referenceImage),
        Boolean(projectConfig.referenceImageEnd)
      );
      if (audioBuffer) {
        projectConfig.referenceAudio = audioBuffer;
      }
      if (additionalAudioBuffers.length > 0) {
        projectConfig.referenceAudios = additionalAudioBuffers;
      }
      if (options.audioStart !== null && !useRefAudioUrl && !pretrimmedMiniMaxH3ReferenceAudio) {
        projectConfig.audioStart = options.audioStart;
      }
      if (options.audioDuration !== null && !useRefAudioUrl && !pretrimmedMiniMaxH3ReferenceAudio) {
        projectConfig.audioDuration = options.audioDuration;
      }
      if (audioIdentityMedia) {
        projectConfig.referenceAudioIdentity = audioIdentityMedia;
      }
      if (videoBuffer) {
        projectConfig.referenceVideo = videoBuffer;
      }
      if (additionalVideoBuffers.length > 0) {
        projectConfig.referenceVideos = additionalVideoBuffers;
      }
      if (miniMaxH3ReferenceVideoDurations.length > 0) {
        projectConfig.referenceVideoDurations = miniMaxH3ReferenceVideoDurations;
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
      if (options.apiGenerateAudio !== null && (isMiniMaxH3Model(options.model) || isWan3Video)) {
        projectConfig.generateAudio = options.apiGenerateAudio;
      }
      if (Number.isFinite(steps) && !isHappyHorseVideo && !isMiniMaxH3Model(options.model) && !isWan3Video) {
        // HappyHorse routes through the vendor-job path and ignores `steps`,
        // mirroring Seedance (whose model defaults already omit them). H3 has
        // fixed sampling parameters and should receive no overrides.
        projectConfig.steps = steps;
      }
      if (guidance !== null && guidance !== undefined && !isMiniMaxH3Model(options.model) && !isWan3Video) {
        projectConfig.guidance = guidance;
      }
      if (cliSet.sampler && isMiniMaxH3TurboModel(options.model)) {
        projectConfig.sampler = options.sampler;
      } else if (modelDefaults?.sampler && !isMiniMaxH3Model(options.model) && !isWan3Video) {
        projectConfig.sampler = modelDefaults.sampler;
      }
      if (modelDefaults?.scheduler && !isMiniMaxH3Model(options.model) && !isWan3Video) {
        projectConfig.scheduler = modelDefaults.scheduler;
      }
      if (modelDefaults?.shift !== null && modelDefaults?.shift !== undefined && !isMiniMaxH3Model(options.model) && !isWan3Video) {
        projectConfig.shift = modelDefaults.shift;
      }
      if (options.videoControlNetName && !isSeedanceModel(options.model)) {
        const isInOutpaintControl = options.videoControlNetName === 'outpaint' || options.videoControlNetName === 'inpaint';
        projectConfig.controlNet = {
          name: options.videoControlNetName,
          strength: isInOutpaintControl ? 1.0 : resolveVideoControlNetStrength(options.videoControlNetName, options.videoControlNetStrength)
        };
        if (!isInOutpaintControl && options.videoControlNetName !== 'detailer') {
          projectConfig.detailerStrength = 0.6;
        }
        if (options.videoControlNetName === 'inpaint' && maskBuffer) {
          projectConfig.referenceMask = maskBuffer;
        }
        if (options.videoControlNetName === 'outpaint') {
          projectConfig.outpaintPosition = options.outpaintPosition || 'center';
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
      if (options.loras.length > 0) {
        projectConfig.loras = options.loras;
        projectConfig.loraStrengths = options.loraStrengths;
      }

      const videoResult = trackProjectResult(
        await client.createVideoProject(withBillingMode(projectConfig))
      );

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

      const audioResult = trackProjectResult(
        await client.createAudioProject(withBillingMode(projectConfig))
      );

      if (audioResult?.error || audioResult?.message) {
        throw buildProjectResultError(audioResult);
      }
    } else if (options.upscaleImage) {
      log(`Upscaling with ${RTX_VSR_MODEL_ID}...`);
      const sourceBuffer = await fetchMediaBuffer(options.upscaleImage);
      const sourceDimensions = getImageDimensionsFromBuffer(sourceBuffer);
      const targetDimensions = resolveRtxVsrDimensions(
        sourceDimensions?.width,
        sourceDimensions?.height,
        {
          scale: options.upscaleScale,
          targetLongestEdge: options.upscaleTargetLongestEdge
        }
      );
      options.width = targetDimensions.width;
      options.height = targetDimensions.height;
      const upscaleOutputFormat = Math.max(options.width, options.height) > RTX_VSR_JPG_THRESHOLD_EDGE
        ? 'jpg'
        : 'png';
      options.outputFormat = upscaleOutputFormat;
      log(
        `Source ${sourceDimensions.width}x${sourceDimensions.height}; ` +
        `target box ${options.width}x${options.height} (aspect ratio preserved).`
      );

      const upscaleConfig = {
        modelId: RTX_VSR_MODEL_ID,
        positivePrompt: '',
        negativePrompt: '',
        stylePrompt: '',
        numberOfMedia: 1,
        tokenType: options.tokenType || 'spark',
        waitForCompletion: false,
        sizePreset: 'custom',
        width: options.width,
        height: options.height,
        steps: 1,
        numberOfPreviews: 0,
        outputFormat: upscaleOutputFormat,
        disableNSFWFilter: true,
        startingImage: sourceBuffer,
        startingImageStrength: 1,
        sourceType: 'upscale-rtx-vsr'
      };

      const upscaleResult = trackProjectResult(
        await client.createImageProject(withBillingMode(upscaleConfig))
      );
      if (upscaleResult?.error || upscaleResult?.message) {
        throw buildProjectResultError(upscaleResult);
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
      const steps = options.steps ?? modelDefaults?.steps ?? (isLightningImageModelSelection(options.model) ? 4 : 20);
      const guidance = options.guidance ?? modelDefaults?.guidance ?? (isLightningImageModelSelection(options.model) ? 3.5 : 7.5);
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
        tokenType: options.tokenType || 'spark',
        disableNSFWFilter: options.noFilter === true,
        ...buildImageEditExecutionControls(options.model, {
          steps,
          guidance,
          sampler: options.sampler || modelDefaults?.sampler,
          scheduler: options.scheduler || modelDefaults?.scheduler
        }, {
          steps: cliSet.steps ? options.steps : undefined,
          guidance: cliSet.guidance ? options.guidance : undefined,
          sampler: cliSet.sampler ? options.sampler : undefined,
          scheduler: cliSet.scheduler ? options.scheduler : undefined
        })
      };

      if (options.outputFormat) {
        editConfig.outputFormat = options.outputFormat;
      }
      if (gptImageQuality) {
        editConfig.gptImageQuality = gptImageQuality;
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
      
      const editResult = trackProjectResult(isGptImage2ModelSelection(options.model)
        ? await client.createImageProject(withBillingMode(editConfig))
        : await client.createImageEditProject(withBillingMode(editConfig)));
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

      const projectResult = trackProjectResult(
        await client.createImageProject(withBillingMode(projectConfig))
      );

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
        if (options.loras.length > 0) {
          projectConfig.loras = options.loras;
        }
        if (options.loraStrengths.length > 0) {
          projectConfig.loraStrengths = options.loraStrengths;
        }

        if (options.seed !== null && options.seed !== undefined) {
          projectConfig.seed = options.seed;
        }

        const imageResult = trackProjectResult(
          await client.createImageProject(withBillingMode(projectConfig))
        );
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
        if (options.refAudios.length > 0) renderInfo.refAudios = options.refAudios;
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
        if (options.refVideos.length > 0) renderInfo.refVideos = options.refVideos;
        if (options.apiGenerateAudio !== null && (isMiniMaxH3Model(options.model) || isWan3ModelLocal(options.model))) {
          renderInfo.generateAudio = options.apiGenerateAudio;
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
            appId: getOrCreateSogniAppId(),
            attribution: clientAttribution(AGENT_ATTRIBUTION),
            network: openclawConfig?.defaultNetwork || 'fast',
            autoConnect: false,
            apiKey: creds.SOGNI_API_KEY,
            authType: 'apiKey'
          });
          await connectSogniClient(client2);
          await disableLiveModelAvailabilityEvents(client2);

          // Create second clip and wait for completion via events
          let activeClip2Project = null;
          const clip2Promise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              void buildProjectTimeoutError([activeClip2Project], options.timeout, 'second clip project')
                .then(reject);
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

          const clip2Result = await client2.createVideoProject(withBillingMode(projectConfig2));
          activeClip2Project = clip2Result?.project || null;

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
          if (options.refAudios.length > 0) output.refAudios = options.refAudios;
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
          if (options.refVideos.length > 0) output.refVideos = options.refVideos;
          if (options.apiGenerateAudio !== null && (isMiniMaxH3Model(options.model) || isWan3ModelLocal(options.model))) {
            output.generateAudio = options.apiGenerateAudio;
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
    enrichAppIdLimitError(error);

    exitCode = 1;
    const shouldJson = options.json || IS_OPENCLAW_INVOCATION;
    if (shouldJson) {
      const payload = addCanonicalErrorFields({
        success: false,
        error: error.message,
        prompt: options.prompt ?? null
      }, error, { modelId: options.model });
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
        printHumanError(error, { modelId: options.model });
      }
    } else {
      printHumanError(error, { modelId: options.model });
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
