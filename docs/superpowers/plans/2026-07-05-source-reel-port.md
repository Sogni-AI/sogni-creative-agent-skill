# SourceReel Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the recovered 565-line SourceReel feature (`--source-reel <folder>` → animated, stitched, loopable video) from `wip/source-reel-unshipped` (3.6.4-era base) onto current main and ship it as 3.12.0.

**Architecture:** Surgical re-application of the 8 hunks from the wip branch onto `sogni-agent.mjs` at their current anchor locations, adapting the 484-line body to any internal-API drift since 3.6.4. The wip branch is read-only reference; behavior is pinned by hermetic plan-only tests written from the recovered code before porting, then proven by a real network render.

**Tech Stack:** Existing CLI internals only (i2v render path, safe ffmpeg wrappers, `node --test` suite). Zero new dependencies.

## Global Constraints

- Repo `/Users/krunkosaurus/Documents/git/sogni/sogni-creative-agent-skill`, branch `feature/source-reel` (already cut from main).
- Spec authority: `docs/superpowers/specs/2026-07-05-source-reel-port-design.md`. Its bloat budget is binding: ≤ ~600 added lines in `sogni-agent.mjs`, zero new deps, SKILL.md entry ≤ 10 lines, no MCP desktop tool, no installer/runtime changes.
- The recovered code is the single source of behavioral truth. Extract it with:
  `git diff wip/source-reel-unshipped^..wip/source-reel-unshipped -- sogni-agent.mjs > /tmp/source-reel.patch`
  (8 hunks; regenerate any time — the branch is read-only reference. Do NOT `git merge`/`git rebase`/`git checkout` that branch's file wholesale.)
- Porting rule: where the body calls internal helpers whose signatures drifted since 3.6.4, adapt the CALL SITES to the current API — never change an upstream helper to fit the old code.
- Commitlint: commit body REQUIRED (blank line after subject, ≥72 chars total, lines <120, subject ≥16).
- `npm test` = runtime-sync gate + all `test/*.test.mjs` (351 currently green). If the runtime gate reports stale: `npm install` FIRST, then `npm run sync:creative-agent-runtime`, commit separately as `chore(runtime): ...`.
- Never touch `generated/` by hand, `sogni-hosted-client.mjs`, the desktop-extension tool registry, or the installer repo.

---

### Task 1: Port the code (all 8 hunks) with hermetic plan-only tests

**Files:**
- Modify: `sogni-agent.mjs` (8 insertion/edit points, ~570 lines)
- Test: `test/source-reel.test.mjs` (new file — keeps the giant `sogni-agent.test.mjs` from growing)

**Interfaces:**
- Consumes: the patch file (extraction command in Global Constraints); current internal helpers as found in main's `sogni-agent.mjs`.
- Produces: working `--source-reel` / `--image-reel` / `--reel-*` flags, `--reel-plan-only` mode, and the render/stitch body — used by Task 2 (docs must match actual flags/help) and Task 3 (E2E).

- [ ] **Step 1: Extract and study the recovered code**

```bash
git diff wip/source-reel-unshipped^..wip/source-reel-unshipped -- sogni-agent.mjs > /tmp/source-reel.patch
grep -c "^+" /tmp/source-reel.patch   # ≈570
```

Read the patch fully. Map each hunk to its CURRENT anchor in main's `sogni-agent.mjs` by searching for the context lines (line numbers have shifted ~80–500 lines; content anchors are stable):
1. `options` object defaults (search `const options = {`) — add the `sourceReel*` defaults block.
2. Arg-parse loop (search the `--remix-audio` or adjacent flag parsing) — add the `--source-reel`/`--image-reel`/`--reel-*` cases.
3. Help text — insert the `SourceReel (folder of images → loopable video):` section where the wip help placed it (after the Seedance reference-modes block).
4. Examples block — the two `--source-reel` example lines.
5. Seed-usage guard (search `commandUsesGenerationSeed`) — add the `!options.sourceReelDir` (or as the patch shows) term.
6. The single MODIFIED line (workflow/storyboard guard near `apiWorkflowStartAction && apiWorkflowTemplate`) — port the semantic change onto the line's CURRENT form; if the line changed upstream, merge both conditions and note it in your report.
7. The 484-line body — pure addition; place it after `remixVideoAudio` (search `async function remixVideoAudio`), same relative position as the patch.
8. `main()` dispatch (+5) — the `if (options.sourceReelDir) { … }` branch; mirror the patch's position relative to the other dispatch branches.

While reading the body, list every internal helper it calls (e.g. render/generation entrypoints, `runCommand`, `ensureFfmpegAvailable`, path/sanitize utilities) and check each against current main — record drifted signatures in your report before adapting.

- [ ] **Step 2: Write the failing tests FIRST** (behavior derived from the patch, not invented)

Create `test/source-reel.test.mjs`. Follow the spawn pattern used by `test/sogni-agent.test.mjs` (read its first ~80 lines for the harness: how it spawns the CLI hermetically — env, `--no-update-check`, stubbed client via `test/sogni-client-stub.mjs` / `test/loader.mjs` if that's the mechanism; REUSE that pattern exactly rather than inventing one). Tests:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// + whatever harness helpers test/sogni-agent.test.mjs uses to spawn the CLI

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAABAAAAAQCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='.replace('BAAAAAQ', 'AEAAAAB'),
  'base64',
); // NOTE: use the exact TINY_PNG constant from test/desktop-extension.test.mjs — copy it verbatim, this inline sketch is illustrative only

function reelDir(count = 2) {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-reel-'));
  for (let i = 0; i < count; i++) writeFileSync(join(dir, `img-${i}.png`), TINY_PNG);
  return dir;
}

test('--source-reel --reel-plan-only prints a plan naming every image, without rendering', async () => {
  const dir = reelDir(3);
  const r = await runCli(['--source-reel', dir, '--reel-plan-only', '--no-update-check']); // runCli = the house harness
  assert.equal(r.exitCode, 0);
  for (const f of ['img-0.png', 'img-1.png', 'img-2.png']) assert.ok(r.stdout.includes(f), `plan must name ${f}`);
  assert.match(r.stdout, /transition/i);
});

test('plan-only respects --no-reel-loop (no final last→first transition)', async () => {
  const dir = reelDir(2);
  const looped = await runCli(['--source-reel', dir, '--reel-plan-only', '--no-update-check']);
  const unlooped = await runCli(['--source-reel', dir, '--reel-plan-only', '--no-reel-loop', '--no-update-check']);
  assert.equal(unlooped.exitCode, 0);
  const count = (s) => (s.match(/transition/gi) ?? []).length;
  assert.ok(count(looped.stdout) > count(unlooped.stdout), 'loop plan has one more transition');
});

test('--source-reel with a missing folder fails with a helpful error', async () => {
  const r = await runCli(['--source-reel', '/nonexistent/reel-folder', '--reel-plan-only', '--no-update-check']);
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr + r.stdout, /folder|directory|not found|no such/i);
});

test('--source-reel with fewer than 2 images fails with a helpful error', async () => {
  const dir = reelDir(1);
  const r = await runCli(['--source-reel', dir, '--reel-plan-only', '--no-update-check']);
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr + r.stdout, /at least|two|2/i);
});
```

Adjust assertion regexes to the RECOVERED CODE's actual messages/plan format (read the patch body — the code defines the contract; the tests pin it). If the recovered validation permits 1 image, pin that actual behavior instead and note it.

- [ ] **Step 3: Verify RED**

Run: `node --test test/source-reel.test.mjs`
Expected: FAIL — `Unknown flag: --source-reel` (or the CLI's actual unknown-arg error).

- [ ] **Step 4: Port hunks 1–6 and 8** (options, parsing, help, examples, guards, dispatch) per the Step 1 anchor map. Then `node --check sogni-agent.mjs`.

- [ ] **Step 5: Port hunk 7 (the body)** after `remixVideoAudio`, adapting drifted helper calls per the Global porting rule. `node --check sogni-agent.mjs` again.

- [ ] **Step 6: Verify GREEN**

Run: `node --test test/source-reel.test.mjs` — Expected: PASS.
Also: `node sogni-agent.mjs --help | grep -A 3 "SourceReel"` — section present.

- [ ] **Step 7: Full suite, bloat check, commit**

Run: `npm test` — Expected: all green (355+).
Run: `git diff --stat main -- sogni-agent.mjs` — Expected: ≤ ~600 insertions (bloat budget).

```bash
git add sogni-agent.mjs test/source-reel.test.mjs
git commit -m "feat(cli): port SourceReel folder-to-video reels from recovered branch" -m "Re-applies the eight hunks from wip/source-reel-unshipped onto current main:
--source-reel animates a folder of images into per-image i2v clips plus
transition clips and stitches them into a loopable mp4 via the existing safe
ffmpeg wrappers, with --reel-plan-only for a render-free plan. Body call
sites adapted to internal-API drift since the 3.6.4 base; behavior pinned by
hermetic plan-only tests derived from the recovered implementation."
```

---

### Task 2: Docs (SKILL.md + video-editing reference)

**Files:**
- Modify: `SKILL.md` (one entry, ≤ 10 lines, in the video workflows area near the `--angles-360`/trigger-patterns block at ~line 217)
- Modify: `references/video-editing.md` (one short recipe section)

**Interfaces:**
- Consumes: the ACTUAL flags/behavior as ported in Task 1 (verify against `node sogni-agent.mjs --help`).

- [ ] **Step 1: SKILL.md** — add to the video trigger-patterns paragraph (match surrounding style, e.g.): `"make a reel/slideshow from these images" or "animate this folder of images" → --source-reel <dir> (plan first with --reel-plan-only; options: --reel-image-seconds, --reel-transition-seconds, --reel-loop/--no-reel-loop, --reel-image-prompt, --reel-transition-prompt).` Keep ≤ 10 lines total including any command example.

- [ ] **Step 2: `references/video-editing.md`** — add a `## SourceReel: folder of images → loopable video` section: 3–6 lines describing the flow (plan → render → stitch; workdir `sogni-source-reel-*` keeps intermediates; requires ffmpeg) + one command example. Match the file's existing tone/format (read it first).

- [ ] **Step 3: Full suite (docs-consistency), commit**

Run: `npm test` — Expected: green.

```bash
git add SKILL.md references/video-editing.md
git commit -m "docs(skill): document SourceReel triggers and recipe" -m "Adds the SourceReel trigger phrases and command shape to SKILL.md within the
bloat budget and a short plan/render/stitch recipe to references/video-editing.md
so agents discover the recovered feature."
```

---

### Task 3: Real E2E render + PR (controller-run or subagent with network)

**Files:** none committed (verification + PR). Spends Sparks (approved).

- [ ] **Step 1: Plan-only against real photos**

```bash
DIR=$(mktemp -d)/reel && mkdir -p "$DIR"
node sogni-agent.mjs "a serene mountain lake at golden hour" -o "$DIR/a.png" -w 512 -h 512 --no-update-check
node sogni-agent.mjs "the same mountain lake under a starry night sky" -o "$DIR/b.png" -w 512 -h 512 --no-update-check
node sogni-agent.mjs --source-reel "$DIR" --reel-plan-only --no-update-check
```

Expected: two images generated; plan lists a.png, b.png, 2 transitions (loop default).

- [ ] **Step 2: Real reel render (cheap settings)**

```bash
node sogni-agent.mjs --source-reel "$DIR" --reel-image-seconds 3 --reel-transition-seconds 3 \
  --reel-model wan_v2.2-14b-fp8_i2v_lightx2v --reel-target-resolution 480 --no-update-check -t 900
```

Expected: exit 0; final mp4 path printed (inside the `sogni-source-reel-*` workdir or `--reel-output`).
Verify: `ffprobe -v error -show_entries format=duration -of csv=p=0 <output.mp4>` ≈ (2 images × 3s + 2 transitions × 3s) = ~12s ± 2s; file > 100KB. Record actual duration/size in the report.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feature/source-reel
gh pr create --repo Sogni-AI/sogni-creative-agent-skill --head feature/source-reel \
  --title "feat: SourceReel — animate a folder of images into a stitched loopable video" \
  --body "Ports the recovered SourceReel implementation (wip/source-reel-unshipped) onto main: --source-reel <dir> renders per-image i2v clips + transitions and stitches a loopable mp4 (--reel-plan-only for render-free planning). Behavior pinned by hermetic plan-only tests; verified end-to-end on the live network (evidence in PR comment). Spec: docs/superpowers/specs/2026-07-05-source-reel-port-design.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Then comment the E2E evidence (plan output, ffprobe duration, file size) on the PR.

---

### Task 4: Merge + release 3.12.0 (controller-level, per release-process runbook)

- [ ] CI green → `gh pr merge <n> --merge --delete-branch`; `git checkout main && git pull`
- [ ] `GITHUB_TOKEN=$(gh auth token) npx semantic-release --no-ci` → 3.12.0 (if the prepack gate fails on sibling dirtiness, inspect — do not delete private-repo files without preserving them)
- [ ] Post-release: lockfile-sync commit + `npm run sync:version` stamp commit + push; `npm test` green
- [ ] `npm i -g @sogni-ai/sogni-creative-agent-skill@3.12.0`; verify `sogni-agent --help | grep SourceReel` on the global install
- [ ] Update ledger + memory

---

## Self-Review Notes

- Spec coverage: port (T1), bloat budget (T1 step 7 check + T2 limits), docs (T2), works-well ladder (T1 tests → T3 real render), ship (T4). No MCP tool anywhere — matches out-of-scope.
- The plan intentionally does NOT inline the 565 ported lines: the patch file extracted in T1 Step 1 is the verbatim source (reproducible by command), and behavior is pinned by tests derived from it. Anchors are content-based since line numbers drifted.
- TINY_PNG note in T1 Step 2 explicitly says to copy the exact constant from test/desktop-extension.test.mjs — the inline sketch is marked illustrative.
