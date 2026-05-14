# `setup-sogni-agent-skill` — one-command installer for the Sogni Creative Agent Skill

**Status:** Design (approved for planning)
**Date:** 2026-05-14
**Owner:** Mauvis Ledford (`mauvis@sogni.ai`)

## Problem

Today, installing the Sogni Creative Agent Skill into an agent runtime is a two-step manual flow per runtime:

1. `npm install -g @sogni-ai/sogni-creative-agent-skill@latest` (gives you the `sogni-agent` CLI).
2. Point the runtime at `SKILL.md` by hand — paths differ for Claude Code, OpenAI Codex CLI, Hermes Agent, ChatGPT (web), and more.

We want a single command — `npx setup-sogni-agent-skill` — that detects which runtimes the user has, installs the skill into each, installs the CLI globally, and prompts for the Sogni API key if it isn't already configured.

## Goals

- One command, zero flags, full setup for the common case.
- Auto-detect installed runtimes; never write into runtimes the user didn't ask for.
- Idempotent: safe to re-run, used as the upgrade path too.
- Cross-platform: macOS, Linux, Windows.
- Decoupled release cadence from the main skill package.

## Non-goals (v1)

- Validating the Sogni API key against the live API on save (deferred to `--validate-key` flag in v1.1).
- Managing OpenClaw plugin installs — OpenClaw already has its own plugin manager (`openclaw plugins install sogni-creative-agent-skill`); this installer doesn't duplicate that.
- Local install for ChatGPT (web) — not technically possible; installer prints copy-pasteable Custom GPT instructions instead.
- Migrating users who installed the skill manually before this tool existed (best effort: detection picks them up; otherwise re-running is fine).

## Approach

A new standalone npm package named **`setup-sogni-agent-skill`** owns 100% of the installer logic. When run, it:

1. Detects which agent runtimes are installed on the host.
2. Confirms with the user what it's about to do.
3. Runs `npm install -g @sogni-ai/sogni-creative-agent-skill@latest` (or `@<pinned-version>`).
4. Resolves the global install path via `npm root -g`, reads `SKILL.md` from there.
5. Dispatches to per-runtime adapters that write the right files in the right place.
6. If no Sogni API key is set anywhere, prompts and saves to `~/.config/sogni/credentials`.
7. Prints a summary table and next-step hints.

The installer and the main skill package have separate release cadences. The installer pins runtime conventions; the skill pins agent behavior. They share no code.

### Why a separate package, not a bin on the existing one

- `npx setup-sogni-agent-skill` only works if there is a published npm package with that exact name; npx resolves the input as a package name, not a bin lookup across the registry.
- Putting the installer logic on the main package would couple installer releases to skill releases. Detection-rule fixes (e.g., a new Codex skills path) should not bump the skill version.
- The installer needs to be cheap to `npx`-cache: tiny dependency set, no heavy production deps.

## Package layout

```
setup-sogni-agent-skill/
├── package.json          # name: "setup-sogni-agent-skill"
│                         # bin: { "setup-sogni-agent-skill": "./bin/setup.mjs" }
│                         # type: "module", engines.node: ">=22"
│                         # dependencies: prompts, kleur, execa (only)
├── bin/
│   └── setup.mjs         # flag parsing → dispatch to src/run.mjs
├── src/
│   ├── run.mjs           # main orchestrator
│   ├── detect.mjs        # find ~/.claude, ~/.codex, ~/.hermes
│   ├── install-cli.mjs   # `npm install -g @sogni-ai/sogni-creative-agent-skill@<ver>`
│   ├── resolve-skill.mjs # locate SKILL.md + package files inside the global install
│   ├── credentials.mjs   # prompt + write ~/.config/sogni/credentials
│   ├── summary.mjs       # final table + next-step hints
│   └── adapters/
│       ├── claude-code.mjs
│       ├── codex-cli.mjs
│       ├── hermes.mjs
│       └── chatgpt-web.mjs
├── test/                 # node --test, fs + execa mocks, fixtures
├── README.md
└── LICENSE
```

### CLI contract

```
npx setup-sogni-agent-skill
  [--yes | -y]                # skip all confirmation prompts
  [--only=claude,codex,hermes,chatgpt]   # restrict to listed runtimes
  [--exclude=chatgpt]         # opposite of --only
  [--dry-run]                 # detect + print plan, no writes
  [--uninstall]               # remove skill files written by a previous run
  [--remove-cli]              # paired with --uninstall, also `npm uninstall -g`
  [--version=X.Y.Z]           # pin the skill version (default: latest)
  [--symlink]                 # symlink instead of copy where supported (Unix only)
  [--hermes-category=media]   # override Hermes category dir (default: media)
  [--no-credentials]          # skip API key prompt entirely
  [--output-chatgpt-bundle=path.md]  # also write ChatGPT instructions to file
```

## Runtime detection

`detect.mjs` returns a list of records:

```js
{ runtime, status, path, installedVersion }
// status: 'available' | 'up-to-date' | 'outdated' | 'not-found'
```

Detection rules (verified against current on-host evidence on the spec author's machine):

| Runtime | Detected by | Install target |
|---|---|---|
| Claude Code | `~/.claude/` exists OR `claude` on `$PATH` | `~/.claude/skills/sogni-creative-agent-skill/` |
| OpenAI Codex CLI | `~/.codex/` exists OR `codex` on `$PATH` | `~/.codex/skills/sogni-creative-agent-skill/` |
| Hermes Agent | `~/.hermes/` exists OR `hermes` on `$PATH` | `~/.hermes/skills/<category>/sogni-creative-agent-skill/` (category default: `media`) |
| ChatGPT (web) | Always "available" — no detection | No filesystem writes |

Skill-installed-version is read from a marker file `.sogni-installed.json` (or `SKILL.md` frontmatter / `version.mjs` if a marker isn't found, for migrating existing manual installs). On-disk evidence today:

- Codex already populates `~/.codex/skills/sogni-creative-agent-skill/` with the full npm package contents (`SKILL.md`, `sogni-agent.mjs`, `scripts/`, `generated/`, etc.).
- Hermes already populates `~/.hermes/skills/media/sogni-creative-agent-skill/SKILL.md` (single file), `0o600` perms, with a backup convention `SKILL.md.bak-before-<version>-<YYYYMMDD>-<HHMMSS>`.

The installer respects those existing conventions rather than introducing new ones.

After detection, the user sees:

```
Detected runtimes:
  ✓ Claude Code        ~/.claude/                         (no skill installed)
  ✓ OpenAI Codex CLI   ~/.codex/                          (sogni-creative-agent-skill v2.1.0 → 2.3.0)
  ✓ Hermes Agent       ~/.hermes/                         (v2.2.0 — up-to-date, will re-verify)
  ⓘ ChatGPT (web)      manual setup (instructions will be printed at the end)

Install / upgrade Sogni Creative Agent Skill into Claude Code, Codex CLI, Hermes? [Y/n]
```

## Per-runtime adapters

All adapters implement the same interface, so `run.mjs` stays simple:

```js
export default {
  name: 'claude-code',
  detect(),                       // → { found, path, installedVersion }
  install({ srcDir, dryRun }),    // → { written: [paths], skipped: [paths], notes: [] }
  uninstall(),                    // → { removed: [paths] }
}
```

`srcDir` is the absolute path to the globally-installed `@sogni-ai/sogni-creative-agent-skill` package (resolved via `npm root -g` + scoped-package path).

### `claude-code.mjs`

- Target: `~/.claude/skills/sogni-creative-agent-skill/`
- Copies (or symlinks, with `--symlink`): `SKILL.md`, `llm.txt`, `version.mjs`, `skill-package.json`.
- Writes a marker file `.sogni-installed.json` (`{ version, installedAt, srcDir, adapter: "claude-code" }`).
- Idempotency: if marker version matches current, skip with a note; otherwise overwrite.

### `codex-cli.mjs`

- Target: `~/.codex/skills/sogni-creative-agent-skill/`
- Codex's on-disk convention is the **full package**: copies everything in `package.json`'s `files` list (`SKILL.md`, `llm.txt`, `sogni-agent.mjs`, `env.mjs`, `ssrf-guard.mjs`, `version.mjs`, `skill-package.json`, `scripts/`, `generated/`, `openclaw-plugin.mjs`, `openclaw.plugin.json`).
- Writes a marker file `.sogni-installed.json` at the skill root.
- Does NOT copy `node_modules/` — Codex resolves the skill via the global CLI's `sogni-agent` binary; bundled deps would bloat disk.
- If `~/.codex/skills/` does not exist, create it.

### `hermes.mjs`

- Target: `~/.hermes/skills/<category>/sogni-creative-agent-skill/` (category default: `media`, override via `--hermes-category=...`).
- Copies only `SKILL.md`, perms `0o600`, owner unchanged.
- Before overwriting an existing `SKILL.md`, rename it to `SKILL.md.bak-before-<new-version>-<YYYYMMDD>-<HHMMSS>` (matches the existing convention found on disk).
- Writes a marker file `.sogni-installed.json` alongside `SKILL.md`.
- Detect existing installs across all categories (scan `~/.hermes/skills/*/sogni-creative-agent-skill/`) so re-running doesn't create duplicates in different categories.

### `chatgpt-web.mjs`

- No filesystem writes by default.
- Prints to stdout: Custom GPT name, description, system instructions (the SKILL.md content with web-only tweaks — e.g., note that `sogni-agent` CLI is not available and the skill should call the Sogni API directly via Actions), and a link to `https://chatgpt.com/gpts/editor`.
- With `--output-chatgpt-bundle=<path>`, also writes the same content to a file.

## API key flow (`credentials.mjs`)

Runs after adapter installs succeed (skip with `--no-credentials`):

1. If `SOGNI_API_KEY` env var is set → note in summary, skip.
2. If `~/.config/sogni/credentials` exists and contains a `SOGNI_API_KEY=` line → skip.
3. Otherwise prompt:
   ```
   Sogni API key required. Get one at https://dashboard.sogni.ai (account menu).
   Paste key (or press Enter to skip): _
   ```
4. On non-empty input: `mkdir -p ~/.config/sogni && fs.writeFile(..., { mode: 0o600 })`. Print the path written.
5. On empty input: print the manual setup snippet from the README and continue. Installer still exits `0`.

No live API validation in v1.

## CLI install (`install-cli.mjs`)

- Runs `npm install -g @sogni-ai/sogni-creative-agent-skill@<version>` (default `@latest`, overridable via `--version`).
- If `npm install -g` fails with EACCES, print: "Global install needs sudo, an npm prefix change, or a node version manager. Run `npx setup-sogni-agent-skill` again after fixing." Exit `1`.
- If the CLI is already installed at the target version and `--version` matches, skip and note in summary.
- The installer assumes `npm` is on `$PATH`. If not, print a hint pointing to nodejs.org and exit `1`.

## Error handling & edge cases

- **No runtimes detected** — Print the detection table, ask: "No agent runtimes found. Install just the CLI + show ChatGPT instructions? [Y/n]" Skill files install nowhere, CLI still installs.
- **Existing skill older than target** — Adapter overwrites copied files, bumps marker file. Summary shows `2.1.0 → 2.3.0`.
- **Existing skill at same version** — Adapter skips writes. Summary shows `up-to-date`.
- **Adapter throws mid-run** — Caught per adapter; that runtime is marked failed in the summary; other adapters continue. Process exit code = number of failed adapters.
- **Windows** — All paths via `path.join` + `os.homedir()`. Copies, not symlinks (overrideable via `--symlink` only on Unix, where it's a no-op flag on Windows with a warning).
- **`--uninstall`** — For each runtime with a marker file, remove the skill directory the marker points to. Does NOT `npm uninstall -g` unless paired with `--remove-cli`.
- **Interrupted mid-install (Ctrl-C)** — Idempotent re-run cleans up. Marker file is written last in each adapter so partial state is detectable.
- **Migrating un-marked manual installs** — If the skill dir exists but `.sogni-installed.json` doesn't, read `version.mjs` (or `SKILL.md` frontmatter) to figure out the installed version, then proceed with the normal upgrade flow.

## Final summary

After all adapters run, stdout mirrors the detection table:

```
Done.
  Claude Code     ~/.claude/skills/sogni-creative-agent-skill/        → installed 2.3.0
  Codex CLI       ~/.codex/skills/sogni-creative-agent-skill/         → upgraded 2.1.0 → 2.3.0
  Hermes Agent    ~/.hermes/skills/media/sogni-creative-agent-skill/  → up-to-date
  ChatGPT (web)   instructions printed above
  CLI             /usr/local/lib/node_modules/@sogni-ai/...            → installed 2.3.0
  API key         saved to ~/.config/sogni/credentials

Next steps:
  - Try it: `sogni-agent --version`
  - Ask your agent: "Generate an image of a sunset over mountains"
  - Docs: https://github.com/Sogni-AI/sogni-creative-agent-skill
```

## Testing

`node --test` (consistent with the main package). Three layers:

**Unit tests (`test/*.test.mjs`)**
- `detect.mjs`: stub `fs.existsSync` and `which`; assert correct status per runtime fixture.
- Each adapter: point `srcDir` at a fixture skill dir under `test/fixtures/skill-src/`, point `$HOME` at a `tmp` dir, run `install()`, assert files written + marker contents. Run `install()` again, assert idempotency. Run `uninstall()`, assert clean removal.
- `credentials.mjs`: stub stdin; assert file written with `0o600` and correct content; assert env-var case skips.

**Integration test (`test/setup.integration.mjs`)**
- Spawns `bin/setup.mjs` with `--dry-run` against a constructed `$HOME` containing fake `~/.claude/` and `~/.codex/` dirs. Asserts the detection table is printed and no writes occur.

**Cross-platform CI**
- GitHub Actions matrix: `ubuntu-latest`, `macos-latest`, `windows-latest`. Node 22. `INSTALL_CLI=skip` env stubs out `npm install -g` in CI.

**Manual smoke before each release**
- Fresh VM (or container) per runtime: install runtime → `npx setup-sogni-agent-skill@next` → confirm skill loads → `sogni-agent --version` → uninstall.

Coverage target: 70% lines for `src/`. No target for `bin/`.

## Open questions for implementation

These are points the implementation plan needs to verify against current upstream docs before shipping:

1. **Codex CLI skill loading.** On-disk evidence shows full-package install, but the official Codex CLI docs may specify a leaner format. Verify before publishing v1.
2. **Hermes Agent category convention.** `media` is what the current install uses on the spec author's machine, but Hermes may auto-categorize or expect a specific format. Verify.
3. **Claude Code skill discovery.** Confirm `~/.claude/skills/<slug>/SKILL.md` is the user-level path the running Claude Code reads from (vs. project `.claude/skills/`).

## Out of scope (v1.1+ candidates)

- `--validate-key`: hit the Sogni API to confirm the key works.
- Project-level Claude Code install (`./.claude/skills/...`) — currently user-level only.
- A `--list` flag that shows what's installed without writing anything.
- Telemetry / install-success reporting.
- Migrating to a newer skill version automatically (cron-style upgrade).

## Files this design touches

- New repo / package: `setup-sogni-agent-skill` (publish target on npm).
- Main repo: README gets a new "Quick install" section pointing at `npx setup-sogni-agent-skill`.
