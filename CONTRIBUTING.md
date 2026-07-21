# Contributing to sogni-creative-agent-skill

## Repo layout

| Path | What it is |
|------|------------|
| `sogni-agent.mjs` | The CLI (package `bin`). Single-file by design today; see "Execution boundaries" below for what may live here. |
| `SKILL.md` | The agent behavior contract every skill host loads. Keep it lean — deep guides belong in `references/`. |
| `references/*.md` | On-demand deep-dive guides SKILL.md points at. Shipped to npm, the Claude plugin, and the OpenClaw link surface. |
| `skills/*.md` | Per-skill view of the **hosted** tool surface (mirrors `@sogni/creative-agent` manifests). |
| `plugin-skills/` | Shared lean plugin workflows used by Claude Code and the Codex adapters. |
| `.claude-plugin/`, `.codex-plugin/` | Host-specific plugin manifests; Codex adapters live under `skills/*/SKILL.md`. |
| `generated/creative-agent-runtime.mjs` | Generated from the private `sogni-creative-agent` repo and **committed** so public installs and tests never need private access. |
| `.openclaw-link/` | Generated OpenClaw link target (`npm run openclaw:sync`). Never edit by hand; never commit. |
| `env.mjs`, `ssrf-guard.mjs`, `update-check.mjs`, `node-version-check.mjs`, `version.mjs` | Small focused modules the CLI composes. |

## Development setup

```bash
gh repo clone Sogni-AI/sogni-creative-agent-skill
cd sogni-creative-agent-skill
npm install
npm test
```

`npm test` runs the unit suites only and works **without** any Sogni
credentials and **without** the private repo. Test tiers:

- `npm test` — offline unit tests (the CLI is spawned against a stubbed SDK via `test/loader.mjs`).
- `npm run test:integration` — **submits real paid GPU jobs**; requires `SOGNI_API_KEY` (or `~/.config/sogni/credentials`) and sets `SOGNI_INTEGRATION=1` for you. Never runs implicitly.
- `npm run test:all` — both.
- `npm run test:coverage` — unit coverage gates for `sogni-agent.mjs`.

## The private runtime sync (maintainers only)

Sogni model routing, video workflow defaults, quality tiers, and prompt
guardrails are generated from the private `sogni-creative-agent` repo checked
out as a sibling directory:

- `npm run sync:creative-agent-runtime` regenerates `generated/creative-agent-runtime.mjs` (plus public-skill overrides such as the Spark Packs repair message).
- `npm run check:creative-agent-runtime` verifies the committed bundle is fresh. When the sibling repo is absent it **skips with a warning** so external contributors can still run `npm test`; `prepack` re-enables the hard gate via `SOGNI_REQUIRE_RUNTIME_SYNC=1`, so publishing without the sibling is impossible.

### Code-placement policy

- Reusable workflow rules (storyboard planning, tool argument validation, prompt linting, media-routing decisions, chat-run progress extraction, repair/control behavior) belong in the shared Sogni runtime first, then sync into this repo. Prefer typed helpers exported by `@sogni-ai/sogni-intelligence-client` or the generated runtime over new skill-local regex guards.
- Public-skill regex stays limited to CLI argument/fact extraction (file paths, URLs, extensions, dimensions, durations, explicit positions). Hosted-style decisions (latest-video continuation, uploaded-video modification, image-selection waits, stitch-after-batch state, repair/control routing) belong upstream in typed planner/runtime fields.

### Execution boundaries: local CLI vs. hosted surfaces

`sogni-agent.mjs` is a **local command-line tool** — the only place that may
assume a local filesystem and a local `ffmpeg`/`ffprobe` binary. Flags like
`--concat-videos`, `--remix-audio`, `--extract-first-frame`,
`--extract-frame-at`, `--extract-last-frame`, `--verify-video`, and
`--angles-360-video` shell out to ffmpeg/ffprobe behind
`ensureFfmpegAvailable()` and run only when those flags are passed.

Hosted surfaces — including the chat.sogni.ai web app — do **not** run
`sogni-agent.mjs`; they consume `@sogni-ai/sogni-intelligence-client` and the
hosted `/v1/chat/completions` and `/v1/creative-agent/workflows` APIs, where
there is no local ffmpeg and no local filesystem. Therefore:

- Keep ffmpeg- and filesystem-dependent helpers local to `sogni-agent.mjs`. Never make hosted code paths depend on a local binary.
- Server-side equivalents (`stitch_video`, `overlay_video`, `extend_video`, …) live in the hosted creative-agent tool surface and belong upstream, not in the CLI.

## Editing SKILL.md and references/

- SKILL.md is loaded whole into agent context on every session — keep it lean. Routing rules that change agent behavior stay inline; elaboration goes to `references/` with a "read when" pointer in the Reference Index.
- After any change run `npm test`: the docs-consistency suite verifies every `--flag` mentioned in docs exists in the CLI parser, version metadata is in sync, and quality-tier tables match the generated runtime; the openclaw-surface suite verifies the link surface stays regenerable.
- Behavioral changes to SKILL.md should be scenario-tested: give a fresh agent the new file and confirm the key routings still hold (photobooth-vs-context-edit, LTX prompt rewrite, PWD output convention, insufficient-funds reply, `--list-media` instead of `ls`).

## Commits and versioning

- Conventional commits are enforced by commitlint (husky `commit-msg` hook).
- The package version fans out from `package.json` into five stamp files: `version.mjs`, `SKILL.md` frontmatter, `.claude-plugin/plugin.json`, `openclaw.plugin.json`, and `desktop-extension/manifest.json`. **Never hand-edit the stamp files** — run:

```bash
npm run sync:version
```

The docs-consistency test, `npm run check:version-sync`, and the npm `prepack` gate fail when they drift. `npm version` also runs the stamp step automatically, which keeps semantic-release's npm prepare step from publishing mixed-version tarballs.

## Release process (manual, maintainers only)

`semantic-release` config exists in `.releaserc.json` but is **not wired to
CI**; releases are cut by hand. (If you ever run it, note its git plugin only
commits `package.json` + `CHANGELOG.md` — you must still run `sync:version` —
and it will version from conventional-commit history, so coordinate first.)

1. Ensure the private sibling repo is checked out and current; run `npm run test:all`.
2. Update `CHANGELOG.md` with a new `## [x.y.z] - YYYY-MM-DD` section.
3. Bump the version: edit `package.json`, then `npm run sync:version`, then `npm install --package-lock-only`.
4. Commit: `chore(release): prepare skill x.y.z update`, tag `vx.y.z`, push with tags.
5. Publish: `npm publish` (prepack enforces the strict private-source + runtime-freshness gates).
6. Verify: `npx -y @sogni-ai/sogni-creative-agent-skill@latest --version` and `sogni-agent doctor` on a clean machine.
7. ClawHub (slug `sogni-creative-agent-skill`, makes `openclaw skills install sogni-creative-agent-skill` resolve): stage a skill-only folder — SKILL.md, references/, skills/, llm.txt, README, LICENSE, CHANGELOG.md, skill-package.json, the CLI runtime files (`sogni-agent.mjs`, `env.mjs`, `ssrf-guard.mjs`, `update-check.mjs`, `node-version-check.mjs`, `version.mjs`, `generated/`) and **no** `openclaw.plugin.json` / `openclaw-plugin.mjs` / `package.json` (their presence makes ClawHub classify the artifact as a code plugin, which requires scoped names and extra `openclaw.compat`/`openclaw.build` manifest fields) — then `npx -y clawhub@latest publish <staged-dir> --slug sogni-creative-agent-skill --version x.y.z --changelog "..."`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on pushes and PRs: unit
tests on the supported Node floor and current LTS, `npm pack --dry-run`
artifact checks, and JSON manifest validation. CI does not publish.
