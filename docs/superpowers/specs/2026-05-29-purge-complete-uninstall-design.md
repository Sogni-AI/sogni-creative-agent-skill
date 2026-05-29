# `--purge` — complete uninstall for the Sogni Creative Agent Skill

**Status:** Design (approved for planning)
**Date:** 2026-05-29
**Owner:** Mauvis Ledford (`mauvis@sogni.ai`)

## Problem

The `setup-sogni-agent-skill` installer (sibling package, published v0.2.0) already
supports `--uninstall` and `--remove-cli`. Together these remove the per-runtime
skill files (Claude Code, Codex CLI, Hermes) and, optionally, the global
`@sogni-ai/sogni-creative-agent-skill` CLI.

What neither flag removes is the user's **data directory**, `~/.config/sogni/`:

- `credentials` — the Sogni API key
- `personas/` + `personas/index.json` — named people with reference photos / voice clips
- `memories.json`
- `personality.txt`
- `last-render.json`

A user who wants a *complete* uninstall ("remove every trace of Sogni") is left with
this directory behind. This design adds an opt-in `--purge` flag that removes it,
with a backup safety net.

## Goals

- One opt-in flag (`--purge`) that removes `~/.config/sogni/` and nothing outside it.
- Safe by default: explicit `y/N` confirmation, and a tar backup written before deletion.
- Composable: works standalone *and* alongside `--uninstall` / `--remove-cli` for a full teardown.
- Never touch shared, non-Sogni-owned paths.
- Consistent with the existing package's style (small focused module, `node --test`).

## Non-goals (v1)

- Editing or removing keys from `~/.openclaw/openclaw.json` (shared OpenClaw config — the CLI only reads it).
- Touching `~/.clawdbot/` or `~/.clawdbot/media/inbound/` (shared media inbox, not Sogni-owned).
- Restoring from the backup tarball (manual `tar -xzf` is the documented recovery path).
- Honoring per-file env overrides (`SOGNI_CREDENTIALS_PATH`, `SOGNI_MEMORIES_PATH`, …) individually — v1 targets the default `~/.config/sogni/` directory only. If a user relocated their config via env vars, `--purge` reports the default dir as empty and exits cleanly.

## Placement decision

The uninstaller belongs in the **`setup-sogni-agent-skill`** package, not in `SKILL.md`
and not in the main `sogni-agent` CLI package.

| Candidate | Verdict |
|---|---|
| `SKILL.md` | No. Behavior guidance read by the agent at runtime — not executable cleanup logic; cannot reliably delete files across runtimes. |
| Main CLI package (`sogni-agent`) | No. A package un-installing itself globally (`npm uninstall -g` while running from that install) is fragile, and the CLI does not know where each runtime placed its skill files. |
| `setup-sogni-agent-skill` | **Yes.** It already owns the inverse operation (install) and the existing `--uninstall` / `--remove-cli` flows, including per-runtime adapters and marker files. |

## Approach

Add a `--purge` flag and a `src/purge.mjs` module to the existing installer. The
purge step removes `~/.config/sogni/` after writing a timestamped tar backup beside it.

### CLI contract (additions)

```
npx setup-sogni-agent-skill --purge
  # remove ~/.config/sogni/ only; skill files and CLI stay installed

npx setup-sogni-agent-skill --uninstall --purge
  # remove per-runtime skill files, then purge data

npx setup-sogni-agent-skill --uninstall --remove-cli --purge
  # full teardown: skill files → global CLI → data
```

`--purge` composes with `--yes` (skips the confirmation prompt).

### Order of operations when composed

When `--purge` runs alongside `--uninstall` / `--remove-cli`, data is removed **last**,
after the components that read it:

1. Per-runtime adapter `uninstall()` (existing `runUninstall`)
2. `--remove-cli` → `npm uninstall -g @sogni-ai/sogni-creative-agent-skill` (existing)
3. `--purge` → `runPurge`

When `--purge` runs standalone, only step 3 executes.

### `runPurge` behavior (`src/purge.mjs`)

1. Resolve the target dir: `join(homedir(), '.config', 'sogni')`.
2. If it does not exist → print `"Nothing to purge — ~/.config/sogni/ not found."`, return `{ status: 'skipped' }`, exit `0`.
3. Enumerate contents and build a human summary, e.g.
   ```
   Will remove ~/.config/sogni/:
     - 3 personas
     - memories.json
     - personality.txt
     - credentials (API key)
     - last-render.json
   ```
   Persona count = number of entries under `personas/` excluding `index.json`. Other
   files are listed if present; missing ones are omitted from the summary.
4. **Confirm** (skip if `--yes`):
   ```
   Permanently remove your Sogni data? A backup tarball will be written first. [y/N]
   ```
   Default is **No**. On decline → print `"Purge cancelled — data left untouched."`, return `{ status: 'cancelled' }`, exit `0`.
5. **Backup:** write `~/.config/sogni.backup-<YYYYMMDD-HHMMSS>.tar.gz` containing the
   directory. Use Node's `child_process` to invoke `tar -czf <backup> -C ~/.config sogni`.
   - The timestamp is generated at runtime (`new Date()` in normal Node — fine here, this is the installer CLI, not a workflow script).
   - If `tar` is unavailable or the backup write fails → **abort the purge** (do not delete), print the error and a hint to back up manually, return `{ status: 'failed' }`, exit `1`. Backup failure must never lead to data loss.
6. **Delete:** `fs.rmSync(dir, { recursive: true, force: true })`.
7. Print both paths and return `{ status: 'purged', backup, removed: dir }`.

### What is never touched

- `~/.openclaw/openclaw.json` — shared OpenClaw config (read-only from the CLI's view).
- `~/.clawdbot/` and `~/.clawdbot/media/inbound/` — shared media inbox.

These are explicitly excluded; `--purge` only ever resolves and removes `~/.config/sogni/`.

## Files this design touches (in `setup-sogni-agent-skill`)

- `src/flags.mjs` — parse `--purge` into `flags.purge` (default `false`).
- `src/purge.mjs` — **new.** Exports `runPurge({ yes })` implementing the behavior above.
- `src/run.mjs` — in `run()`: if `flags.purge && !flags.uninstall`, dispatch to a standalone purge path; in `runUninstall()`: after `--remove-cli`, if `flags.purge`, call `runPurge`.
- `src/summary.mjs` — add a `Data` row to the summary table:
  `Data   ~/.config/sogni/   → backed up to …/sogni.backup-….tar.gz, removed`
  (or `→ cancelled` / `→ not found` depending on status).
- `bin/setup.mjs` — `--help` text gains the `--purge` line.
- `README.md` — uninstall section documents `--purge` and the backup/recovery path (`tar -xzf`).

## Testing

`node --test`, mirroring the existing adapter/credentials tests. New `test/purge.test.mjs`:

- **Backup-then-delete:** point `$HOME` at a temp dir, seed `~/.config/sogni/` with
  personas + memories + credentials, run `runPurge({ yes: true })`. Assert the tarball
  exists, the dir is gone, and the tarball contains the seeded files.
- **Missing dir no-op:** no `~/.config/sogni/` → status `skipped`, exit 0, no tarball.
- **Confirm declined:** stub stdin to "n" (or default Enter) → data still present, status `cancelled`.
- **`--yes` skips prompt:** assert no stdin read; deletion proceeds.
- **Shared paths untouched:** seed `~/.openclaw/openclaw.json` and `~/.clawdbot/` in the
  temp `$HOME`; after purge assert both still exist.
- **Backup failure aborts delete:** simulate `tar` failure (e.g. stub spawn to non-zero) →
  data still present, status `failed`, exit 1.

Plus `test/flags.test.mjs`: assert `--purge` parses to `flags.purge === true` and defaults `false`, and that `--uninstall --remove-cli --purge` sets all three.

## Edge cases

- **`--purge --dry-run`** — print the would-remove summary and the backup path that *would* be written; perform no writes/deletes.
- **Directory exists but empty** — backup an empty dir (still valid tarball) and remove it, or treat as `skipped`; v1 treats a dir with zero meaningful files the same as present (backup + remove) for simplicity. The summary lists "(empty)".
- **Permission error on delete** — `rmSync` throws; report `failed` for the Data row with the error, exit non-zero. Backup already succeeded, so no data is lost.
- **Backup tarball name collision** — timestamp has second resolution; on the rare same-second re-run, `tar -czf` overwrites the existing tarball. Acceptable (same-content backup).

## Out of scope (v1.1+ candidates)

- `--restore` to unpack the most recent backup tarball.
- Honoring individual `SOGNI_*_PATH` env overrides when locating data to purge.
- A `--purge-shared` opt-in that scrubs the Sogni section from `~/.openclaw/openclaw.json`.
- Retention/pruning of old backup tarballs.
