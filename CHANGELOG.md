## [3.17.1](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.17.0...v3.17.1) (2026-07-26)


### Bug Fixes

* **scripts:** refuse runtime sync on intelligence-client version mismatch ([247da8c](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/247da8c9cb7b6f0575a25543847ca00f44929c0a))
* **video:** stop discarding i2v resolution on sparse aspect ratios ([23125f7](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/23125f780d394ec988012aabd4db7a9e49c63341))

## [3.17.0] - 2026-07-26

### Added

* **video:** add LTX-2.3 10Eros image-to-video support for private mature-theme creativity, including
  DR34ML4Y v3 video LoRA support through `--lora dr34ml4y-v3`.
* **models:** move live model discovery to the public Sogni model catalog API, including API-supplied
  catalog tags, network and media filtering, and five-minute ETag-revalidated caching without requiring
  an API key.

## [3.16.1] - 2026-07-25

### Fixed

* **release:** stamp and verify the Codex plugin manifest alongside every other package and plugin manifest.

## [3.16.0] - 2026-07-25

### Added

* **cli:** add live Supernet media model discovery through `sogni-client`, including separator-insensitive
  ID/name search, image/video/audio and Fast/Relaxed filters, JSON output, and official catalog tag search
  with repeatable `--model-tag` filters for labels such as `spicy` and `uncensored`.

### Changed

* **image edits:** consume `@sogni-ai/sogni-intelligence-client` `3.8.0` with Sogni Client `5.1.0-alpha.22`,
  removing the duplicate Krea identity-edit CLI fallback while preserving the two-reference limit and 10-step
  guidance defaults.

# [3.15.0](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.14.1...v3.15.0) (2026-07-21)

### Bug Fixes

* **packaging:** include the hosted SDK client module required by durable chat

### Features

* support Krea identity-edit models
* add the verified loop-maker workflow

# [3.14.1](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.14.0...v3.14.1) (2026-07-13)


### Bug Fixes

* **release:** prevent mixed-version npm tarballs after semantic-release bumps package.json

# [3.14.0](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.13.0...v3.14.0) (2026-07-05)


### Features

* **desktop:** add import_media tool bridging chat attachments to local files ([a259bcf](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/a259bcf36d4a747bb2cbe9d71ff8ec9da9e6c1c9))

# [3.13.0](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.12.0...v3.13.0) (2026-07-05)


### Features

* **cli:** port SourceReel folder-to-video reels from recovered branch ([0e61830](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/0e6183090a0e1af698bce5de112246bcd44d5eac))

# [3.12.0](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.11.1...v3.12.0) (2026-07-05)


### Features

* **unlimited:** surface plan entitlement and billing mode across the CLI ([373490f](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/373490fc30da1edea84d7928691ab419b44f5bcf))

## [3.11.1](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.11.0...v3.11.1) (2026-07-05)


### Bug Fixes

* **desktop:** fit inline image previews under the 1MB host result cap ([4666922](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/46669226a8c6fb9a70ff808ef58c387ae62a4778))

# [3.11.0](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.10.0...v3.11.0) (2026-07-05)


### Bug Fixes

* **desktop:** bound inline image fetches with a 20s abort timeout ([f20f42b](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/f20f42ba6138eeb1f1c07ed8f02a5feb79c9f1fd))


### Features

* **desktop:** add inline-image collection module for MCP results ([422043f](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/422043f0cdef1bcd36f168fb95ab3e3bf6450962))
* **desktop:** attach inline image blocks to successful tool results ([617bd5b](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/617bd5b63f3f0437cd81df3f6b59da8a587dcf16))

# [3.10.0](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.9.0...v3.10.0) (2026-07-04)


### Bug Fixes

* **cli:** recognize semantic-release h1 changelog entries in whats-new ([067bb65](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/067bb651e1ab924fb32d1b15585c80deeeb79d84))
* **desktop:** keep head of large success output, tail of errors ([394e1e1](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/394e1e131f5f75c4f01205a37286609ed7a59c99))


### Features

* **desktop:** add MCP tool registry mapping tools to sogni-agent argv ([cb951a7](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/cb951a79fcc5ef859ef3135f46b8aab81945305d))
* **desktop:** add MCPB manifest, npm packaging, and build script ([d464627](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/d4646273bcb4c2c8cfd7d08e7b6928e218f15e6f))
* **desktop:** add path resolution for the Claude Desktop MCP wrapper ([8cd5832](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/8cd58323982d63a756e75264441d0dd33feb1acc))
* **desktop:** implement dependency-free MCP stdio server for Claude Desktop ([de26cda](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/de26cda9f433a8da62dcc24c7b2b49e6c13e892a))

# [3.9.0](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.8.0...v3.9.0) (2026-06-30)


### Features

* wire ltx23 lora video controls ([968aa9a](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/968aa9aca2bf5cfc30d7f73b513f4ff0afb9cf94))

# [3.7.0](https://github.com/Sogni-AI/sogni-creative-agent-skill/compare/v3.6.4...v3.7.0) (2026-06-25)


### Features

* **video:** document Seedance 4K skill support ([0f3c150](https://github.com/Sogni-AI/sogni-creative-agent-skill/commit/0f3c1509801fcdb15741e6adb94514f38fead0e5))

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **LTX-2.3 LoRA controls are now wired through the public CLI.** Direct `sogni-agent` video generation now
  supports `--control-type outpaint` with `--outpaint-position` / `--outpaint-aspect-ratio`,
  `--control-type inpaint --mask <image>`, and automatic `transition` LoRA attachment for LTX-2.3 i2v jobs
  that provide both `--ref` and `--ref-end`.

### Changed

- **Creative upscale routing is clearer in the bundled intelligence client.** Updated
  `@sogni-ai/sogni-intelligence-client` to `3.7.0` so uploaded-video Seedance upscale, enhance, remaster,
  restyle, and transform requests route through `video_to_video` with `seedance-v2v`, while quality-only upscale
  and sharpening requests continue to use the LTX-2.3 detailer path without restyling.

## [3.8.0] - 2026-06-30

### Changed

- **Music generation now defaults to ACE-Step 1.5 XL in the CLI.** The `turbo` and `sft` music aliases resolve to
  the XL model IDs, while the legacy ACE-Step 1.5 model IDs remain available for explicit selection.
- **Model guidance now reflects the current Premium Spark vendor catalog.** README, LLM-facing docs, skill
  routing notes, and CLI billing guidance now list HappyHorse 1.1 alongside GPT Image 2 and Seedance as
  Premium-Spark-only vendor paths.
- **Krea 2 Turbo discovery is clearer.** CLI help and model references now list the direct worker model ID
  `krea2_turbo_fp8_scaled` and note the hosted/chat selector `krea-2-turbo`.
- **Updated the bundled Sogni intelligence client to `3.5.1`.** The skill now consumes the current Sogni Client
  stack and model metadata used by the refreshed video, image, and music catalog.

## [3.7.0] - 2026-06-25

### Changed

- **Seedance 2.0 Mini is now available through the bundled runtime.** Mini is the default lower-cost
  720p Seedance path, while `seedance2-fast` remains available as an explicit legacy selection.
- Bumped `@sogni-ai/sogni-intelligence-client` to `3.3.0` so the skill consumes the published
  Seedance Mini runtime, tool metadata, and Sogni Client `5.1.0-alpha.14` dependency stack.

### Changed

- **Seedance 2.0 4K routing is now documented and available through the current Sogni dependency stack.**
  The full `seedance2` model can be selected for native 4K/2160p output with `--target-resolution 2160`;
  `seedance2-fast` remains the lower-resolution fast path. The bundled runtime and
  `@sogni-ai/sogni-intelligence-client` dependency now consume the published Seedance 4K tool metadata.
- **ACE-Step 1.5 XL is now the default music model.** `generate_music` / `--music` now default to
  ACE-Step 1.5 XL Turbo (`ace_step_1.5_xl_turbo`), with ACE-Step 1.5 XL SFT (`ace_step_1.5_xl_sft`) as the
  quality variant. The `--music-model` keys are unchanged — `turbo` (default) and `sft` — but they now map to the
  XL ids; the legacy `ace_step_1.5_turbo` / `ace_step_1.5_sft` ids are no longer the default. The 8-step / `euler`
  / `simple` turbo defaults are unchanged. Updated `references/models.md`, `README.md`,
  `references/openclaw-config.md`, and the `defaultMusicModel` default in `openclaw.plugin.json`.

### Added

- **LTX-2.3 video-to-video outpaint and inpaint control modes** documented for `ltx23-22b-fp8_v2v_distilled`.
  Outpaint extends/expands the video canvas (e.g. vertical → widescreen) and is positional and mask-free —
  anchored with a position (`center|top|bottom|left|right`) and an optional target aspect ratio
  (`16:9|9:16|1:1|4:3|3:4|21:9`), growing the canvas without cropping. Inpaint regenerates a masked region and
  requires a mask image (white pixels = region to regenerate). Added a V2V outpaint/inpaint subsection to
  `references/video-editing.md` and capability prose to `references/models.md` and `README.md`.
- **LTX-2.3 two-keyframe transition / morph LoRA** documented for image-to-video. When the LTX-2.3 i2v model
  `ltx23-22b-fp8_i2v_distilled` receives both a start frame (`--ref`) and an end frame (`--ref-end`), it
  auto-applies the ValiantCat transition/morph LoRA (lora id `transition`, trigger word `zhuanchang`,
  strength ~1.0) and morphs the first image into the last in a single render — distinct from the manual
  bridge-clip "transition between two videos" recipe. Added notes to `references/video-editing.md`, `SKILL.md`,
  and `README.md`.

## [3.6.4] - 2026-06-22

### Fixed

- **Agents no longer run `sogni-agent doctor` as a routine preflight before every generation.** `SKILL.md` now
  scopes `doctor` explicitly to install/upgrade verification and failure troubleshooting, and tells agents to go
  straight to the generate command (which validates credentials, ffmpeg, and balance itself and returns a fix hint
  on failure). The previous wording — featuring `doctor` prominently in Setup, Install Policy, and Troubleshooting
  without a "not a preflight" caveat — led agents to run it before each render. Inside sandboxed runtimes like Codex
  this was especially costly: `doctor` makes a live network/auth call, which the sandbox blocks on the first
  attempt, forcing a network-approval prompt and a second `doctor` run before any work happened. The
  memory/personality preflight bullet also now notes it is memory + personality only — no `doctor` call.

## [3.6.3] - 2026-06-22

### Added

- **Sogni Unlimited subscription guidance.** README, SKILL.md, and `llm.txt` now document the Unlimited plan,
  and the CLI includes friendlier billing-error fallbacks for subscription-related failures.

### Fixed

- **`sogni-agent self-update` now gives clearer recovery guidance after failed global package updates.** When the
  package manager exits nonzero, the CLI reports the failing exit code and prints platform-specific permission
  guidance (for example, `sudo sogni-agent self-update` on macOS/Linux or an Administrator terminal on Windows)
  instead of leaving users with only raw npm output.
- **Codex and Hermes setup docs now mention the target app must be started once before targeted installer runs.**
  `README.md` and `llm.txt` now match the setup installer preflight: `--only=codex` and `--only=hermes` exit
  before installing anything if `~/.codex/` or `~/.hermes/` has not been created yet.
- **Claude plugin setup guidance no longer tells agents to create a duplicate personal Claude skill.** The
  plugin-bundled skill now installs only the global CLI, tells agents not to run the default setup installer from
  inside the plugin, and clarifies that setup cleanup does not uninstall the Claude Code plugin itself.

## [3.6.1] - 2026-06-15

### Changed

- **Hosted-API guidance now recommends client-side planning over hosted re-planning.** The skill is driven by a
  frontier LLM that out-plans Sogni's hosted planning model, so steering it to delegate planning through
  `--api-chat` was a downgrade. `SKILL.md`, `references/hosted-api.md`, and `README.md` now tell the calling agent
  to plan and select tools itself, use `--api-workflow` with an explicit `--workflow-input` step graph for durable
  multi-step work (the server executes the authored plan without re-planning), and reserve `--api-chat` /
  `--durable-chat` for deliberately offloading a long server-side loop or uploading several local files in one
  turn. `--api-chat` and all hosted modes remain fully supported — only the recommended default changed.

### Fixed

- **Local Seedance reference images via `-c`/`--context` now auto-upload in direct CLI mode.** Local
  loose-reference images were rejected with an HTTPS-only error that pushed users onto the unreliable
  `--api-chat` / `--durable-chat` path; local `--ref-audio` and `--ref-video` already auto-uploaded through the
  `/v2` presigned-POST flow, so images were the only modality missing it and one broken branch cascaded into
  downstream failures (vision 1024px cap, HTTP timeout, no-content, missing durable SDK package). Local
  `-c`/`--context` images now upload through the same `/v2/image` presigned flow and forward as Sogni-hosted URLs.
  MIME type is resolved by magic-byte sniffing (falling back to extension), and the accepted set
  (PNG/JPEG/WebP/GIF) mirrors the backend's `allowedContentTypes`. Adds local-PNG-upload and mislabeled-WebP
  byte-sniff regression tests; verified end-to-end with a real Seedance 2.0 render from a local `-c` PNG.

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
