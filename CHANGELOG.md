# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.6.0] - 2026-06-12

### Added

- **Agents now surface update notices (gstack-style).** Update notices were previously suppressed exactly where
  agents live — non-TTY stderr, `--json` mode, and OpenClaw plugin invocations — so Claude Code / Codex / Hermes /
  OpenClaw users never learned a newer skill existed. Any command may now print a single advisory stderr line,
  `[sogni-agent] Update available: <current> -> <latest> ...`, throttled to at most once per 24 hours, telling
  the agent to finish the current task, relay the update to the user, and offer `sogni-agent self-update`
  (`--snooze-update` on decline). Interactive TTY users keep the existing banner. stdout is never touched, so
  `--json` output stays machine-parseable; SKILL.md instructs agents how to handle the line. Background version
  checks now also run in agent contexts (still skipped for CI, tests, `--no-update-check`,
  `SOGNI_NO_UPDATE_CHECK`, and dev checkouts).

## [3.5.1] - 2026-06-12

### Fixed

- **OpenClaw no longer marks the skill "missing".** The SKILL.md frontmatter listed every optional override
  variable (`SOGNI_CREDENTIALS_PATH`, `OPENCLAW_CONFIG_PATH`, `FFMPEG_PATH`, …) and optional config path
  (including `~/Downloads/sogni`) under `metadata.openclaw.requires`, so OpenClaw treated them all as hard
  requirements that could never be satisfied and flagged the skill `✗ missing` on every install. Requirements
  are now just `bins: node` + `anyBins: ffmpeg`; the API key still comes from the credentials file or
  `primaryEnv`, and the override variables remain documented in "Filesystem Paths and Overrides". Verified
  live: `openclaw skills check` flips from missing to `✓ ready`.

## [3.5.0] - 2026-06-11

### Added

- **`sogni-agent doctor` (also `--doctor`).** One deterministic install health check: Node floor, credentials
  presence and file permissions, config-dir writability, ffmpeg discovery, a live auth + balance probe with a
  timeout, and version freshness. `--json` emits a structured `checks` array; exit 1 when a required check fails.
  Every install path in the docs now ends with `sogni-agent doctor` as the verification gate.
- **Upgrade UX.** `--whats-new [since-version]` prints the bundled CHANGELOG entries (CHANGELOG.md now ships in
  the npm tarball and `self-update` points at it after upgrading), and `--snooze-update` pauses the update
  reminder with escalating backoff (1 day → 2 days → 1 week, reset by a newer release) instead of re-nagging
  every 24 hours.
- **SSRF-guarded downloads.** New `fetchSafeUrl` in `ssrf-guard.mjs` fetches with manual redirects and re-validates
  every hop, so a vetted public media URL can no longer redirect a download to a private/metadata address. Remote
  `--ref`/`--ref-audio`/`--ref-video` fetches use it.
- **CI.** GitHub Actions workflow running the unit suite on Node 22.11.0 and 24, verifying npm tarball contents,
  and validating the plugin manifests. `npm run sync:version` stamps the package.json version into every manifest
  (`version.mjs`, `SKILL.md`, `.claude-plugin/plugin.json`, `openclaw.plugin.json`), enforced by a new
  docs-consistency test suite that also fails on any documented flag missing from the CLI parser.

### Changed

- **SKILL.md restructured for progressive disclosure.** The always-loaded core shrank from 1,338 lines (~10k
  words) to ~300 lines (~2.6k words) — every routing rule (photobooth-vs-context-edit, LTX prompt rewrite,
  high-res routing, PWD output convention, insufficient-funds script, media/shell security rules) stays inline,
  while deep guides moved to `references/` (video-prompting, video-editing, hosted-api, models, personas-memory,
  openclaw-config) read on demand. `references/` and `skills/` now ship in the npm tarball, the Claude plugin,
  and the OpenClaw link surface. Verified with a 7-scenario agent battery against the new layout.
- **Install docs are now accurate per platform.** Added the missing OpenAI Codex CLI section
  (`~/.codex/skills/`), a real Hermes Agent section (`~/.hermes/skills/media/` + `/reset`), the ChatGPT
  Custom-GPT path the installer prints, an explicit note that the npx installer does not configure OpenClaw, and
  "pick one registration" guidance for Claude Code (plugin or personal skill, not both). The OpenClaw install
  command is now `openclaw plugins install npm:@sogni-ai/sogni-creative-agent-skill` — the bare unscoped name
  never resolved the scoped npm package.
- **OpenClaw branding modernized.** Frontmatter metadata key `clawdbot:` → `openclaw:`; `--list-media` now
  defaults to `~/.openclaw/media/inbound` with automatic fallback to the legacy `~/.clawdbot/media/inbound`;
  the ClawHub install hook no longer overwrites `package.json` in a git checkout (guarded copy).
- **`--json` stdout is now strictly machine-parseable.** Durable-workflow SSE progress frames stream to stderr in
  JSON mode; `--last --json` wraps the record in a `{ "success": true, ... }` envelope and exits 1 with
  `errorCode: "NO_LAST_RENDER"` when nothing has been rendered (previously raw record / exit 0). Human-mode
  errors now print the same classified, friendly message JSON consumers get.
- **Paid-batch safety cap.** `-n/--count` is capped at 16 outputs per invocation (a typo like `-n 1000` no longer
  launches a thousand paid renders); raise deliberately with `SOGNI_MAX_COUNT`. OpenClaw `defaultCount` is
  clamped the same way.
- `npm test` now runs the offline unit suites only and works without the private `sogni-creative-agent` sibling
  (the runtime freshness check skips with a warning; publishing still hard-requires it via `prepack`).
  Integration tests are strictly opt-in: `SOGNI_INTEGRATION=1` / `npm run test:integration` — a `SOGNI_API_KEY`
  in the environment no longer causes plain `npm test` to submit real paid GPU jobs.
- `engines.node` raised to `>=22.11.0` to match the runtime guard (Node 22.0–22.10 previously passed `npm
  install` and then hard-exited at first run).

### Fixed

- **Ctrl-C and temp-file hygiene.** The CLI now handles SIGINT/SIGTERM/SIGHUP (conventional exit codes) and
  removes every temporary directory it created on exit — interrupting a long video job no longer orphans
  directories under the OS temp dir, and the multi-angle / loop flows no longer leak a temp dir on every run.
- Credentials file values containing an inline ` #` comment now trigger a clear warning instead of silently
  corrupting the API key into a confusing 401; prompts that begin with `-` get a hint about the standalone `--`
  separator.

## [3.4.0] - 2026-05-30

### Added

- **Video finishing without raw ffmpeg.** `--concat-videos` now uses the concat *filter* (not the demuxer): it
  probes each clip and normalizes fps/size/SAR/pixel-format and synthesizes silent audio for clips with no audio
  track, fixing frozen video with continuing audio when clips differ in frame rate or stream layout. Adds
  `--concat-fps`, `--extract-first-frame` (mirror of `--extract-last-frame`), and `--remix-audio` for looping a
  bed (`--audio-loop`), fades (`--audio-fade-in/out`), and mixing one extra track (`--mix-audio/--mix-at/--mix-gain`)
  without re-encoding video. External `--concat-audio` is now padded/trimmed to the video length.

### Changed

- Bumped `@sogni-ai/sogni-intelligence-client` to `^3.0.13` (pins `sogni-client 5.0.0-alpha.17`), keeping the
  bundled creative-agent runtime in sync with the current shared prompt contracts and repair recipes.

### Fixed

- **Idiotproof first run.** Added a zero-dependency Node.js version guard that prints a clear "requires Node >= 22"
  message before native modules load, `fetchWithTimeout` on every REST/download call (a black-holing proxy now
  fails with `NETWORK_TIMEOUT` instead of hanging; override via `SOGNI_HTTP_TIMEOUT_MS`), `OUTPUT_WRITE_FAILED`
  mapping for filesystem errors so a paid render isn't lost to a raw `EACCES`/`ENOSPC`, a friendly
  `MEDIA_REFERENCE_NOT_FOUND` for missing `--ref`/`-c` files, and leading `~` expansion in file arguments.
- **Invalid/rejected API key no longer crashes.** A bad or expired `SOGNI_API_KEY` previously threw from a
  detached promise during connect and dumped a raw stack trace. Added invalid-key detection plus global
  `uncaughtException`/`unhandledRejection` handlers that route fatals through the clean `Error:`/`Hint:` path
  (JSON-aware, exit 1) with a dashboard.sogni.ai hint.
- Routed source-preserving image edits away from photobooth and preserved structured project-result errors so
  insufficient-funds responses consistently surface the Spark Packs guidance.

## [3.3.5] - 2026-05-29

### Changed

- Added an explicit **Output Path Convention** section to `SKILL.md` instructing agents to save generated images,
  videos, and music to the user's current working directory (PWD) rather than `/tmp`. The directive includes a
  short ✓/✗ example block so agents prefer `./cat.png` or a bare filename over an absolute `/tmp/…` path. Final
  user-visible renders belong in the user's working directory; `/tmp` is reserved for transient intermediate
  files (audio re-encodes, frame extraction, concat staging) the CLI cleans up itself.
- Updated all 26 inline `-o /tmp/…` examples in `SKILL.md` and 2 in `README.md` to use relative paths so
  agent transcripts model the recommended behavior.

## [3.3.4] - 2026-05-26

### Added

- Added a Sogni-aware default hosted-chat system prompt for `--api-chat` and `--durable-chat`, so hosted
  chat describes and uses Sogni's real image, video, music, GPT Image 2, Seedance, workflow, and media-reference
  capabilities instead of behaving like a generic text-only assistant.
- Added public guidance for batching prompt-only video variations with Dynamic Prompt syntax and `-n` when each
  output shares the same source/end assets, duration, dimensions, and references.
- Added LTX-2.3 dialogue-duration guidance that budgets roughly three spoken words per second plus acting beats,
  helping agents choose workable clip durations before submitting paid video jobs.

### Changed

- Bumped `@sogni-ai/sogni-intelligence-client` to `^3.0.8` so the skill consumes the current published Sogni Intelligence client stack, including `@sogni-ai/sogni-client@5.0.0-alpha.15` and `@sogni-ai/sogni-protocol@1.0.0-alpha.6`.
- Synced the bundled creative-agent runtime with the current shared prompt contracts and storyboard helpers, including
  provider-neutral storyboard reference wording, field-tag sanitizer compatibility, and updated video Dynamic Prompt
  instructions from the shared runtime.
- Tightened persona resolution to explicit saved persona names, ids, and tags/aliases. Relationship phrases such as
  "my wife" or "my son" are no longer treated as persona identifiers by themselves.
- Refreshed README, root skill, Claude Code plugin skill, `llm.txt`, and per-skill docs to reflect the current image, video, music, hosted chat, durable workflow, replay, and Seedance/LTX/WAN feature surface.

### Fixed

- `--durable-chat` now recognizes v2 chat-run SSE event names such as `assistant_message_delta`, `run_completed`, `run_failed`, and `run_waiting_for_user` while preserving the legacy aliases.
- Vendor models such as Seedance and GPT Image 2 no longer fall back to SOGNI tokens under `--token-type auto`; they
  require Premium Spark eligibility and fail clearly when that billing path is unavailable.
- Hosted API chat now keeps saved persona, memory, and personality injection while using the richer Sogni-specific
  prompt, avoiding regressions where media requests could be framed as plain text-only chat.
- Replaced stale agent-facing quick examples that referenced removed `--image`, `--context-image`, and `--i2v --image` flags with current `sogni-agent`, `-c`, and `--video --ref` usage.

## [3.3.3] - 2026-05-22

### Changed

- Aligned skill, OpenClaw, and Claude Code plugin version metadata with the npm package version for the release.

## [3.3.2] - 2026-05-21

### Changed

- Synced the bundled creative-agent runtime with the same source SHA now deployed by `sogni-chat`, picking up the latest prompt contracts for exact Seedance prompts, Seedance V2V remaster routing, relative video segment windows, persona video gating, and non-empty text-only `finalize_response` answers.
- Bumped `@sogni-ai/sogni-intelligence-client` to `^2.4.1` so npm installs use the current shared Sogni runtime dependency set.
- Aligned skill, OpenClaw, and Claude Code plugin version metadata with the npm package version for the release.

### Fixed

- Active persona state now gates only explicit persona-video requests that lack a persona image, instead of broad video-generation requests.
- Text-only / no-action `finalize_response` guidance now requires a substantive final answer instead of an empty or placeholder summary.

## [3.3.1] - 2026-05-21

### Added

- **Seedance direct-gen media upload support.** Local Seedance `--ref-audio` and `--ref-video` references now upload through the Sogni Intelligence `/v2/media/*Url` presigned POST flow and are forwarded as Sogni-hosted URL references, matching the documented backend media-reference contract.
- Regression coverage for Seedance direct-gen local MP3 audio uploads, local V2V source uploads, and vendor policy-failure JSON shaping.

### Changed

- Seedance audio references are now treated as MP3-only. Local audio is trimmed to the requested Seedance clip window and converted to `audio/mpeg` before upload; HTTPS non-MP3 audio references are re-uploaded as prepared MP3 media instead of being forwarded directly.
- Seedance V2V local source clips are trimmed to the requested clip duration before upload so long local source videos are not submitted raw to the vendor.

### Fixed

- Seedance vendor content-policy cancellations now surface friendly, structured CLI errors (`SAFETY_REJECTED` / `content_refused`) without leaking raw vendor task IDs or terminal status payloads.
- Seedance invalid audio-format failures now classify as non-retryable parameter errors with actionable MP3 guidance instead of opaque vendor failures.

## [3.3.0] - 2026-05-20

### Added

- **Background npm update check.** `sogni-agent` now checks the npm registry at most once every 24 hours and surfaces a trailing "update available" notice when a newer version is published. The check times out at 1.5s, never blocks the foreground command, detects the package manager that installed the CLI (npm, pnpm, or yarn) so the suggested install command matches the user's environment, and persists throttle state at `~/.config/sogni/update-check.json`.
- **`--no-update-check`** flag to opt out of the update check for a single run.
- **Claude Code plugin install instructions** in README and `llm.txt`. Both now show the `npm install -g` prerequisite, the marketplace registration command, and the new `/plugin install sogni-creative-agent@sogni` step, with a brief explanation of what each command does.

## [3.2.0] - 2026-05-20

### Added

- **Seedance multi-modal references.** `--ref-audio` and `--ref-video` are now repeatable on Seedance models, and `-c`/`--context` image refs flow through to Seedance `referenceImageUrls` as loose `@ImageN` refs — matching the "up to 9 image / 3 video / 3 audio / 12 total" caps published by `@sogni-ai/sogni-intelligence-client@2.4.0` (sourced from `@sogni-ai/sogni-protocol`'s `SEEDANCE_REFERENCE_LIMITS` catalog).
- **Dedicated first-frame / last-frame mode parity** with sogni-socket's two-mode contract. Dedicated frame mode (`--ref` / `--ref-end`) and loose reference mode (`-c`/`--context`) are mutually exclusive on Seedance; the skill rejects mixed mode client-side with a message pointing to the right mode.
- **Per-job progress and ETA logging during durable chat runs.** `--durable-chat` now emits de-duplicated per-job progress, ETA, and result lines from hosted run events.
- **Hosted-intelligence guidance refresh** in `SKILL.md`, covering the recommended routing through `/v1/chat/completions`, `/v1/creative-agent/workflows`, and `/v1/chat/runs`.

### Changed

- Bumped `@sogni-ai/sogni-intelligence-client` to `^2.4.0` for the `SEEDANCE_REFERENCE_LIMITS` export and refreshed the rest of the Sogni runtime dependency surface.
- New `enforceSeedanceReferenceCaps()` helper translates `SeedanceReferenceLimitError` into a fatal CLI error with the canonical message. Non-Seedance video models reject repeated `--ref-audio` / `--ref-video` flags with a clear error.

### Tests

- 10 new `node:test` cases covering multi-ref forwarding (HTTPS extras → URL arrays), per-modality cap errors, the combined 12-asset cap, dedicated-vs-loose mutex, local-file extra rejection in CLI direct-gen, `seedance2-fast` parity, and non-seedance multi-ref rejection.

## [3.1.1] - 2026-05-20

### Changed

- Bumped `@sogni-ai/sogni-intelligence-client` to `^2.2.8` and refreshed the intelligence-client runtime bundle.

### Fixed

- The skill now invokes the globally installed `sogni-agent` command directly instead of assuming a specific install path, so agents that resolve the binary via `PATH` work in both global-install and `npm link` setups.
- Republished alongside the renamed `@sogni-ai/sogni-client` package so consumers pulling the latest skill no longer hit the unscoped/legacy client name.

## [3.1.0] - 2026-05-20

### Added

- **Claude Code plugin marketplace manifest.** Scaffolds the `sogni` marketplace and `sogni-creative-agent` plugin entry that ships a lean Claude-Code-focused `SKILL.md` from `plugin-skills/` while keeping the full skill spec at the repository root.
- **`setup-sogni-agent-skill` installer.** Adds the design spec and implementation plan for the upcoming bootstrap installer; the runtime work lands in a later release.

### Changed

- Bumped `@sogni-ai/sogni-intelligence-client` through `^2.2.4` to `^2.2.6` as the client stabilized.

### Fixed

- Root SDK is now loaded through a compatible module path so installs on Node module resolvers that disallow deep imports continue to work.

## [3.1.0-alpha.1] - 2026-05-20

### Changed

- Bumped `@sogni-ai/sogni-intelligence-client` to `^2.2.1`.

### Fixed

- Synced `version.mjs` with `package.json` so the runtime `--version` output matches the published npm version.

## [3.1.0-alpha.0] - 2026-05-18

### Added

- **Managed Agent parity with sogni-chat.** `buildSkillDynamicSystemPrompt()` injects the same persona / memory / personality framing as `buildChatDynamicSystemPrompt` (`User's people` / `PERSONA RULES` / `User preferences` / `USER PERSONALITY PREFERENCE`) so saved `--persona-*`, `--memory-set`, and `--personality-*` stores travel into `/v1/chat/completions`. Empty when no stores are populated, so fresh installs are unaffected.
- **`--no-filter` now propagates to `safeContentFilter: false`** on the hosted chat body, in addition to the existing per-tool `disableNSFWFilter` plumbing.
- **`--durable-chat` CLI flag** for `/v1/chat/runs` with SSE assistant deltas — the foundation for the per-job progress / ETA / result events added in 3.2.0.
- **`composition_planning` per-skill manifest** groups `enhance_prompt`, `compose_lyrics`, `compose_instrumental`, `compose_script`, `compose_workflow`, and `compose_workflow_template` into a single capability surface, matching the canonical `@sogni/creative-agent` manifest layout. SKILL.md and `skills/README.md` are updated to list it in the per-skill index, and the cross-surface parity test asserts `ALL_BUILT_IN_SKILLS` exposes it.
- **Conventional commits tooling.** Adopted commitlint + husky for the strict commit-message rules used across the Sogni ecosystem.
- **Semantic-release configuration** added; publish remains manual-gated for now (the CI auto-publish workflow was added and then removed in the same release pending an automation token).
