# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
