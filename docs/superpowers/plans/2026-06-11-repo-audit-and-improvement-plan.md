# Repo Audit & Improvement Plan — sogni-creative-agent-skill

> **For agentic workers:** This is a Phase-1 audit + phased action plan. Per superpowers:writing-plans scope rules, each Phase-2 workstream below is an independent subsystem and MUST be expanded into its own bite-sized implementation plan (TDD, exact code, frequent commits) before execution. Do not implement directly from this document.

**Goal:** Make the skill install correctly on Claude Code, Codex CLI, Hermes Agent, and OpenClaw; fix real CLI bugs that break agent outcomes; and restructure docs so agents reliably succeed with less context.

**Audited at:** v3.4.0, commit `d32c887`, 2026-06-11.
**Evidence sources:** full read of README.md / SKILL.md / llm.txt / manifests; code review of `sogni-agent.mjs` (8,705 lines) + support modules; offline CLI behavior checks; `npm pack --dry-run`; tarball inspection of `setup-sogni-agent-skill@0.3.0`; live install-state inspection of `~/.claude`, `~/.codex` (v0.136.0), `~/.hermes`, `~/.openclaw` (v2026.3.13); current platform docs (code.claude.com, developers.openai.com, hermes-agent.nousresearch.com, docs.openclaw.ai); gbrain/gstack repos + local gstack install.

---

## Part 1 — Findings

### 1.1 Install-path verdicts (the four target platforms)

| Platform | Documented path | Verdict | Evidence |
|---|---|---|---|
| **Claude Code** | `/plugin marketplace add Sogni-AI/sogni-creative-agent-skill` → `/plugin install sogni-creative-agent@sogni` | **WORKS** | Manifest shapes valid per current plugin docs; `source: "./"` copies whole repo so root `SKILL.md` is present in the plugin cache. Caveats: (1) installing the plugin **and** the npx personal skill yields two overlapping registrations (confirmed live on this machine — `sogni-creative-agent-skill` + `sogni-creative-agent:sogni-creative-agent`); docs never say "pick one". (2) `plugin-skills/sogni-creative-agent/SKILL.md:39` references "SKILL.md at the root of this plugin directory" as prose — `${CLAUDE_PLUGIN_ROOT}/SKILL.md` is the robust form. (3) Plugin `skills` key is additive with the default `skills/` dir — verify the flat `skills/*.md` files can't surface as a second skill set. |
| **Codex CLI** | **None.** README only mentions Codex in the npx installer line | **DOC GAP** | Codex CLI v0.136.0 verifiably loads `~/.codex/skills/` (live on this machine, incl. an existing sogni install + Codex `.system` skills). The installer writes there correctly. README needs a Codex section. |
| **Hermes Agent** | "Point the agent at this repository's SKILL.md" (README:175-177) | **PARTIAL / undersells** | Hermes has a real mechanism: `~/.hermes/skills/<category>/<name>/SKILL.md` + `hermes skills install` (live: `~/.hermes/skills/media/` populated). Installer writes there. Docs should state the actual mechanism + session `/reset`. |
| **OpenClaw** | `openclaw plugins install sogni-creative-agent-skill` (README:140) | **BROKEN as written** | npm package is scoped `@sogni-ai/sogni-creative-agent-skill`; OpenClaw resolves bare names via ClawHub → official catalog → npm **as-is**, so the unscoped name won't resolve npm (and no evidence of a ClawHub artifact under that id). Correct form: `openclaw plugins install npm:@sogni-ai/sogni-creative-agent-skill`, or actually publish to ClawHub. Also: artifact is fundamentally a SKILL.md → `openclaw skills install` may be the more correct verb; decide. Local-link flow (`.openclaw-link/`) is plausibly valid (not executed end-to-end). |
| **npx installer** (`setup-sogni-agent-skill@0.3.0`, separate repo) | "auto-detects Claude Code, Codex CLI, and Hermes" | **WORKS, under/over-documented** | Tarball inspected: adapters for Claude (`~/.claude/skills/`), Codex (`~/.codex/skills/`), Hermes (`~/.hermes/skills/<cat>/`), **plus a ChatGPT Custom-GPT instructions printer the README never mentions**. **No OpenClaw adapter** — README should say so explicitly. `--uninstall --remove-cli --purge` matches the SKILL.md uninstall policy exactly (backup-first, abort-on-backup-failure). Installer-repo issues to fix there: `engines` pinned to exactly `22.22.0`; Codex adapter `rmSync`s the whole dir on upgrade (nuking `node_modules`) and never runs `npm i`; ChatGPT instructions print on every flagless run. |

### 1.2 Documentation accuracy

Good news first: **no phantom flags.** Every flag mentioned in docs exists in the parser — including the suspicious ones (`--looping` → `sogni-agent.mjs:1830`, `--voice` → `:2217`, `--output-format mp3` is valid for music since `--output-format`/`--audio-format` share `options.outputFormat`, validated against `{mp3,flac,wav}` in music mode at `:2851`).

Real inaccuracies and drift:

| # | Issue | Location |
|---|---|---|
| D1 | `--list-media` described as "List recent renders" — it lists **inbound** media from `~/.clawdbot/media/inbound` (code: `sogni-agent.mjs:7533-7574`) | `plugin-skills/sogni-creative-agent/SKILL.md:25` |
| D2 | "OpenClaw Config Defaults" sample shows `defaultWidth/Height: 768`; schema default and CLI default are **512** | `SKILL.md:577-578` vs `openclaw.plugin.json:127,133` |
| D3 | Undocumented user-facing surface: `--video-model`, `--memory-category`, `--no-update-check`, `self-update` subcommand | `--help` vs SKILL.md/README |
| D4 | npm tarball ships neither `skills/` nor `plugin-skills/`, but `SKILL.md:39` points npm consumers at `skills/README.md` (broken pointer in npm installs) | `package.json files[]` |
| D5 | Stale brand: `metadata.clawdbot:` frontmatter key (parses as alias, but stale), `~/.clawdbot/skills` install prose (`SKILL.md:109-110`), `~/.clawdbot/media/inbound` default for current OpenClaw (3.x uses `~/.openclaw/`) | `SKILL.md:7,25,109-110,136,588`, `openclaw.plugin.json:186`, code `sogni-agent.mjs:137` |
| D6 | Internal dev-policy prose embedded in user-facing docs (private-repo sync rules, regex policy, "consumes generated storyboard adapters from `../sogni-creative-agent`", changelog-speak "now works/now exposes") | `README.md:555,628-655`, `SKILL.md:383-389`, `llm.txt:91-95` |
| D7 | Skill `name` mismatch: root/`.openclaw-link` = `sogni-creative-agent-skill`; plugin = `sogni-creative-agent`. Frontmatter description 561 chars (long for loaders that truncate ~500) | `SKILL.md:2-3` vs `plugin-skills/.../SKILL.md:2-3` |
| D8 | Node floor stated three ways: README "≥ 22.11.0", `engines: ">=22"`, `.nvmrc: 22.22.0`, runtime guard `>=22.11.0` — `npm install` succeeds on 22.0-22.10 then the CLI hard-exits | `package.json:49`, `node-version-check.mjs:12`, `.nvmrc` |

`.openclaw-link/` copies are byte-identical to root (in sync). README↔SKILL.md quality-preset/model tables currently agree.

### 1.3 CLI code issues (`sogni-agent.mjs` unless noted)

| Sev | Issue | Evidence |
|---|---|---|
| HIGH | No SIGINT/SIGTERM handlers: Ctrl-C during long video jobs skips `main()`'s `finally` (`:8689`) — SDK socket left connected, temp dirs orphaned | no `SIGINT` anywhere in file |
| HIGH | Multi-angle / loop flows never clean their `mkdtempSync` dirs — leak on every run, success or failure | `:6800`, `:6935`, `:8390` |
| HIGH | `--api-workflow --watch --json` writes human SSE lines to stdout after the JSON envelope — breaks machine parsing | `:5314-5322`, `:5546` |
| MED | `-n/--count` unbounded (`-n 100000000` accepted) — paid-batch cost footgun; dimensions are capped but the cost multiplier isn't | `:1560` vs `MAX_IMAGE_DIMENSION` `:794` |
| MED | SSRF guard gaps: fetches follow redirects (no `redirect: 'manual'`, `:3882`) and `fetch` re-resolves DNS after the guard's lookup (TOCTOU) — a validated public URL can redirect to `169.254.169.254`; module docstring overclaims rebinding protection | `ssrf-guard.mjs:93` + `:3882` |
| MED | Human-mode errors print raw `error.message` while `--json` gets the classified friendly message — inconsistent | `:8682` vs `:8643` |
| MED | `--last --json` bypasses the `{success,...}` envelope and echoes the stored presigned S3 URL | `:2242` |
| LOW | `-h` = height (no short help); inline `#` comment in credentials file silently corrupts the key (`:3584`); prompts starting with `-` rejected without suggesting `--` (`:2534`); eager top-level `sharp`/SDK import slows `--version`/memory ops (`:17,90-91`); recursive `main()` re-entry for token fallback (`:8632`); generated runtime triple-exports the same star export |

First-run with no credentials is **good**: actionable error + `MISSING_CREDENTIALS` JSON, clean stdout (verified). `update-check.mjs` is well-built (detached background spawn, offline-safe, dev-checkout self-skip).

### 1.4 Tests, release, infrastructure

| # | Issue | Evidence |
|---|---|---|
| I1 | **`npm test` is impossible without the private sibling repo.** `check:creative-agent-runtime` hard-gates the suite and exits 1 when `../sogni-creative-agent` is absent — even though the generated bundle is committed and all unit tests pass against it. External contributors cannot run tests. No skip flag. | `package.json:15`, `scripts/sync-creative-agent-runtime.mjs:70-74` |
| I2 | **Integration tests run real paid GPU jobs by default** when `SOGNI_API_KEY` is present: `shouldRun` defaults true unless `SOGNI_INTEGRATION=0`, and `test/*.integration.mjs` is globbed into `npm test` | `test/sogni-agent.integration.mjs:33-40,497-505` |
| I3 | `npm test` mutates the working tree (`openclaw-surface.test.mjs:8-21` regenerates `.openclaw-link/`; integration appends `logs/*.jsonl` forever) | test files |
| I4 | **No CI at all** (no `.github/`). semantic-release fully configured but dead — every release was hand-cut (`chore(release): prepare skill X` commits don't match the configured template) | `.releaserc.json`, git log |
| I5 | **Version duplicated in ~6 places with no sync script**: `package.json`, `version.mjs`, `SKILL.md` frontmatter, `.claude-plugin/plugin.json`, `openclaw.plugin.json` (+ derived copies). `.releaserc` git plugin would only commit 2 of them. CHANGELOG 3.3.3 shows this drift already happened once | manifests |
| I6 | ClawHub install hook `cd {{skillDir}} && cp skill-package.json package.json && npm i` **clobbers the real `package.json`** if run in a git checkout — unguarded | `SKILL.md:31` |
| I7 | Hygiene: 5 stale merged branches (2 with deleted remotes), a stale 1.9 MB worktree under `.claude/worktrees/` pinning branch `fix-idiotproof-first-run`, accumulating `logs/*.jsonl`, 421 KB screenshot in git history, `.clawhubignore` missing `logs/`/`.claude/` | `git branch -vv`, `git worktree list` |
| I8 | Dead-weight scripts ship to npm (`sync/check-creative-agent-*` require the private sibling; exit 1 for any consumer) | `package.json files[]` |

### 1.5 Skill quality (the "successful outcomes" lever)

- **Root `SKILL.md` is 1,337 lines / ~73 KB** — a monolith loaded whole into context by every host. Anthropic guidance and the agentskills spec push progressive disclosure: lean core (< ~500 lines) + reference files read on demand. The repo already proves the lean pattern works — the Claude plugin variant is 39 lines and defers to the full spec. A leaner core with `references/` files (video prompting, hosted API, personas, stitching, model tables) would cut per-session token cost ~70% while *improving* rule-following (long skills bury the load-bearing routing rules: photobooth-vs-edit, LTX rewrite rule, output-path convention).
- **Five duplication surfaces** (README ↔ SKILL.md ↔ llm.txt ↔ plugin-skills ↔ .openclaw-link) with no drift guard — D1/D2 above are existing drift.
- Per superpowers:writing-skills, any SKILL.md restructure must be validated RED→GREEN: run representative scenario prompts against subagents with the old vs new skill (e.g. "make me anime-style — same pose" must route to `-c` Qwen edit, not photobooth; "4k video of X" must trigger the LTX rewrite; outputs must land in PWD) and confirm no behavior regressions.

### 1.6 gbrain / gstack verdict (the user's question: worth learning from?)

**Yes, but narrowly.** Sogni's distribution backbone (npm + semver + background update-check + committed generated runtime) is already stronger than both repos' git-clone model — do **not** copy their clone-into-skills-dir install, per-skill preamble update checks, team-mode reconciliation, 4-part versioning, or gbrain's MCP-server architecture / RESOLVER.md (Claude's native skill matching already routes for us).

Worth borrowing (all evidenced in gstack's `gstack-upgrade` skill + gbrain's `doctor`):
1. **`sogni-agent doctor`** — one deterministic health check (key present/valid, ffmpeg, network reachability, Node floor, credentials perms, version freshness) — and make install docs tell the agent to run it as the **verification gate** after install (gbrain's pattern).
2. **Interactive upgrade flow** — surface the already-existing `self-update` (`update-check.mjs:281`) via SKILL.md instructions with a Yes / Always / Not now / Never choice instead of a passive stderr nag.
3. **Snooze with escalating backoff** keyed to target version in `~/.config/sogni/update-check.json` (today it re-nags every 24h forever).
4. **Post-upgrade "What's New"** — summarize CHANGELOG entries between old→new (CHANGELOG already ships in the tarball).
5. **Versioned migrations runner with done-markers** for future `~/.config/sogni/` schema changes (personas/memories) — gstack's done-marker + incomplete-retry discipline.
6. **Runtime-detection breadth** — gstack's `command -v` → per-host skills-dir table is the same shape as the npx installer; extend the installer rather than this repo.

---

## Part 2 — Phase 2 plan of action

Ordered by (impact on user success) ÷ effort. Each workstream = one PR (or small PR series) and gets its own detailed implementation plan before execution.

### WS1 — Install & docs accuracy pass (docs-only, do first)
**Files:** `README.md`, `SKILL.md`, `llm.txt`, `plugin-skills/sogni-creative-agent/SKILL.md`, `.claude-plugin/` (review only)
- Fix OpenClaw install command → `openclaw plugins install npm:@sogni-ai/sogni-creative-agent-skill` (and/or document ClawHub once WS2 decides); decide and document `skills install` vs `plugins install` verb.
- Add a **Codex CLI** install section (`npx setup-sogni-agent-skill` → `~/.codex/skills/sogni-creative-agent-skill/`; restart Codex; CLI on PATH required).
- Rewrite the **Hermes** section: npx installer path (`~/.hermes/skills/media/...`) or `hermes skills install`, then `/reset`.
- Document the installer fully: add **ChatGPT Custom-GPT** to the supported list; add an explicit "the npx installer does not configure OpenClaw — see the OpenClaw section" note.
- Add "**pick one** registration per runtime" guidance (plugin OR personal skill) for Claude Code; switch the plugin skill's root-spec pointer to `${CLAUDE_PLUGIN_ROOT}/SKILL.md`.
- Fix D1 (`--list-media` wording), D2 (768→512 or label the sample as overrides), D3 (document `--video-model`, `--memory-category`, `--no-update-check`, `self-update`), D4 (add `skills/` + `plugin-skills/` to `files[]` or reword the pointer).
- Align the Node floor everywhere to `>=22.11.0` (engines, README, .nvmrc policy) — pairs with WS3 item.
- Move D6 dev-policy prose into a new `CONTRIBUTING.md` / `docs/DEVELOPMENT.md`; READMEs speak to users, SKILL.md speaks to agents.
**Verification:** docs-vs-code audit re-run (subagent) reports zero mismatches; every install command syntax-checked against current platform docs.

### WS2 — OpenClaw modernization (small code + manifests + publish decision)
**Files:** `sogni-agent.mjs:137` (`DEFAULT_MEDIA_INBOUND_DIR`), `openclaw.plugin.json:186`, `SKILL.md` frontmatter
- Migrate default media-inbound dir to `~/.openclaw/media/inbound` with `~/.clawdbot/media/inbound` legacy fallback (read both, prefer new); update schema + docs.
- Rename frontmatter `metadata.clawdbot:` → `metadata.openclaw:` (alias keeps old hosts working).
- Guard the install hook (I6): `[ -f package.json ] || cp skill-package.json package.json` (or equivalent name check).
- **Decision needed:** publish to ClawHub under `sogni-creative-agent-skill` (makes the bare command work) vs npm-prefixed command only.
**Verification:** `--list-media` unit test covering both dirs; `.openclaw-link` regen + `openclaw plugins install -l` smoke test.

### WS3 — CLI correctness & safety fixes
**Files:** `sogni-agent.mjs`, `ssrf-guard.mjs`, `package.json`
- Add SIGINT/SIGTERM handling + a centralized temp-dir registry (`mkdtemp` wrapper) cleaned in `finally`/signal/exit paths; fix the multi-angle/loop leaks.
- Centralize a JSON-aware output sink; fix `--watch --json` stdout contamination and give `--last --json` the standard envelope; route human-mode errors through the same classifier as JSON.
- Cap `-n` (e.g. 16, `SOGNI_MAX_COUNT` env override) with a clear error.
- SSRF: `redirect: 'manual'` + re-validate each hop (or follow with per-hop guard); document residual DNS-rebinding limits honestly in the module docstring.
- Quick UX: suggest `--` when a prompt starts with `-`; warn on inline `#` in credentials; `engines` → `>=22.11.0`.
**Verification:** new unit tests per fix (the offline CLI-spawning harness in `test/sogni-agent.test.mjs` already supports all of these); manual Ctrl-C check on a stubbed long job.

### WS4 — Contributor experience: tests run everywhere
**Files:** `package.json`, `scripts/check-creative-agent-runtime.mjs`, `test/sogni-agent.integration.mjs`, `test/openclaw-surface.test.mjs`
- Make `check:creative-agent-runtime` **skip with a loud warning** when the private sibling is absent (committed bundle is ground truth for external runs); keep the hard gate in `prepack`.
- Flip integration tests to **opt-in** (`SOGNI_INTEGRATION=1` required) so `npm test` with a key in env can't spend money; split `test` (unit) vs `test:all`.
- Make the `.openclaw-link` parity test compare in a temp dir instead of regenerating in-tree.
**Verification:** `mv ../sogni-creative-agent /tmp && npm test` passes; `SOGNI_API_KEY=x npm test` makes zero network generation calls.

### WS5 — CI + single-source versioning + defined release path
**Files:** new `.github/workflows/ci.yml`, `.github/workflows/release.yml` (or delete `.releaserc.json`), new `scripts/sync-version.mjs`
- CI: unit tests on Node 22.11/24, `npm pack --dry-run` content assertion, docs-drift check (see WS6), plugin-manifest JSON validation.
- **Decision needed:** adopt semantic-release in CI (conventional commits are already enforced by commitlint) **or** delete `.releaserc.json` and document the manual flow. Either way: one `sync-version` script stamping `version.mjs`, `SKILL.md`, `.claude-plugin/plugin.json`, `openclaw.plugin.json` from `package.json`, enforced by a CI check.
**Verification:** green CI on a no-op PR; version-drift check fails when any manifest is hand-bumped.

### WS6 — SKILL.md progressive-disclosure restructure (biggest outcome lever; do after WS5 so CI guards it)
**Files:** `SKILL.md`, new `references/*.md` (video-prompting incl. LTX guide + orientation/camera maps; hosted-api; personas-memory-personality; video-editing-stitching; models-and-sizing), `scripts/sync-openclaw-plugin.mjs`, new drift-check test
- Slim root SKILL.md to < ~500 lines: triggers, setup, output-path convention, the ~12 core commands, the routing rules (photobooth-vs-edit, LTX rewrite, high-res routing, insufficient-funds reply), error/JSON contract — each deep topic becomes a `references/` file with an explicit "read when…" pointer.
- Keep `skills/` (hosted tool surface) as-is; reconcile its role in the doc map.
- Add an automated drift test: shared facts (quality presets, model tables, defaults) asserted identical across README/SKILL.md or generated from one fragment source.
- **Mandatory verification (superpowers:writing-skills RED→GREEN):** before merging, run the scenario battery against subagents with old vs new skill — anime-restyle routes to Qwen `-c` not photobooth; "4k video" triggers LTX rewrite + dimensions; outputs land in PWD; insufficient-funds reply verbatim; persona voice auto-attach. No regressions allowed.

### WS7 — Onboarding & upgrade UX (gstack/gbrain-inspired)
**Files:** `sogni-agent.mjs` (new `doctor` command), `update-check.mjs`, `SKILL.md`/README (one paragraph each)
- `sogni-agent doctor [--json]`: key present + auth ping, ffmpeg discovery, Node version, credentials perms 600, registry version freshness. Install docs (all four platforms + installer repo) end with "run `sogni-agent doctor` to verify".
- Snooze with escalating backoff in update-check state; agent-facing upgrade offer (surface `self-update` with Yes/Always/Not now/Never semantics); post-upgrade What's New from CHANGELOG.
- Migrations runner (done-marker + incomplete-retry) — only the scaffold now; first real migration when `~/.config/sogni` schema next changes.

### WS8 — Repo hygiene (15 minutes, anytime)
- Delete merged branches (`docs/advertise-installer`, `docs/uninstall-request-policy`, `feat/video-stitch-audio-remix`, `worktree-fix-invalid-key-handling`, `fix-idiotproof-first-run`) + `git worktree remove .claude/worktrees/fix-invalid-key-handling`; prune remotes.
- Add `logs/` + `.claude/` to `.clawhubignore`; cap/clean `logs/*.jsonl` accumulation in the integration harness.

### Cross-repo follow-ups (separate `setup-sogni-agent-skill` repo)
- Fix `engines` exact-pin `22.22.0` → `>=22.11.0`; make the Codex adapter run the dependency install after its `rmSync` upgrade wipe; gate ChatGPT instructions behind a flag or summary line; consider an OpenClaw adapter (or explicit "not supported" output).

### Decision points for the maintainer (blocking the relevant workstreams only)
1. **OpenClaw distribution:** publish to ClawHub vs document `npm:`-prefixed install only; `skills` vs `plugins` surface. (WS2)
2. **Release automation:** semantic-release in CI vs documented manual flow. (WS5)
3. **SKILL.md restructure appetite:** full progressive-disclosure split vs minimal trim. (WS6)
4. **Canonical skill name:** unify on `sogni-creative-agent` (plugin name) vs keep `-skill` suffix at root. (WS1/WS6)

### Suggested sequence
WS8 → WS1 → WS4 → WS5 → WS3 → WS2 → WS6 → WS7. Rationale: hygiene + docs accuracy are cheap and immediately user-facing; contributor/CI rails come before code changes so fixes land tested; the big SKILL.md restructure goes last behind CI + scenario verification.
