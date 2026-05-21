# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
