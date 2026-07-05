# SourceReel Port — Design

**Date:** 2026-07-05
**Status:** Proceeding under user's standing instruction ("lets integrate and merge that in, as long as it works well and doesn't bloat the skill too much"); user AFK at design-review time — conditions honored as binding requirements.

## Problem

A complete, never-shipped SourceReel implementation (565 lines: `--source-reel <folder>` animates a folder of images into a stitched, loopable video with per-image motion prompts and transition clips) was recovered from a pre-session stash onto branch `wip/source-reel-unshipped` (commit 8873663). Its base is the 3.6.4-era `sogni-agent.mjs`; main has since moved through 3.9.0–3.11.1 (~1,250 changed lines in that file). Port it onto main and ship it.

## Approach

**Surgical re-application** of the 8 hunks from `git diff wip/source-reel-unshipped^..wip/source-reel-unshipped -- sogni-agent.mjs`, adapting to current internal APIs — NOT a git merge/rebase of the branch (too much drift), NOT a rewrite (the implementation is done and sound).

Hunk map (anchors in 3.6.4 coordinates; find current equivalents by content):
1. `options` object defaults (+13) — `sourceReelDir` … `sourceReelConcurrency`
2. Arg-parse loop (+50) — `--source-reel`/`--image-reel`, `--reel-*` flags
3. Help text (+15) — SourceReel section
4. Examples (+2)
5. Seed-usage guard (+1)
6. One modified guard line (workflow/storyboard condition) — port the semantic change, adapted to the line's current form
7. Body (+484, pure addition after `remixVideoAudio`) — planner, per-image i2v renders, transition clips, ffmpeg stitch, `--reel-plan-only` short-circuit
8. `main()` dispatch (+5)

Porting rules:
- The wip branch is read-only reference. Work happens on a fresh `feature/source-reel` branch from main.
- Where the body calls internal helpers whose signatures drifted since 3.6.4, adapt the call sites to the current API — never revert an upstream helper to its old shape.
- Preserve the original's error handling (hint-rich errors, `ensureFfmpegAvailable`, resumable `sogni-source-reel-*` workdir).

## Bloat budget (binding)

- `sogni-agent.mjs`: ≤ ~600 added lines; zero new dependencies; reuse existing render path + safe ffmpeg wrappers.
- `SKILL.md`: one short SourceReel entry (house style: trigger phrases + command shape, ≤ 10 lines) — placed with the other video workflows.
- `references/video-editing.md`: one short recipe section.
- **No MCP desktop-extension tool in v1** (tool count stays 10). Future follow-up if wanted.
- No changes to installer, manifest tool surface, or hosted runtime.

## Verification ladder ("works well" is binding)

1. **Hermetic tests** (`test/sogni-agent.test.mjs` or the suite's existing CLI-spawn pattern — follow house conventions): flag parsing (`--source-reel`, `--reel-plan-only`, reel option defaults/overrides) and plan-only output against a temp folder of 2–3 tiny PNGs — asserts planned clips/transitions/ordering with zero network. Invalid input coverage: missing folder, folder with <2 images (whatever the original's validation demands).
2. **Full suite green** including docs-consistency after SKILL.md edits.
3. **Real E2E (controller-run, spends Sparks — user approved by default judgment):** 2 small images → `sogni-agent --source-reel <dir> --reel-image-seconds 3 --reel-transition-seconds 3 -m wan_v2.2-14b-fp8_i2v_lightx2v` at low resolution; assert exit 0, stitched mp4 exists, ffprobe duration ≈ plan total ±2s, plus `--reel-plan-only` printed plan matches clip count.
4. Ship as **3.12.0**: PR → CI → merge → `npx semantic-release --no-ci` → post-release lockfile + sync:version stamp commits (release-process runbook; npm install before any runtime sync if the gate fires).

## Out of scope

MCP tool exposure, hosted-chat/runtime parity, installer changes, video model additions.
