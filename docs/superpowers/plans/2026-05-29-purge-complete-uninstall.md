# `--purge` Complete Uninstall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `--purge` flag to the `setup-sogni-agent-skill` installer that removes the Sogni-owned data directory `~/.config/sogni/` after writing a timestamped tar backup, composable with the existing `--uninstall` / `--remove-cli` teardown.

**Architecture:** A new `src/purge.mjs` module exports `runPurge()`, which summarizes `~/.config/sogni/`, confirms with the user (unless `--yes`), tar-backs-up the directory, then removes it. Backup failure aborts the delete so data is never lost. `src/run.mjs` dispatches to a standalone purge path when `--purge` is used alone, and calls `runPurge` last when composed with `--uninstall`. `src/flags.mjs`, `src/summary.mjs`, `bin/setup.mjs`, and `README.md` get small additions.

**Tech Stack:** Node.js ≥22 (ESM), `prompts` (interactive confirm + `prompts.inject()` test stubbing), `kleur` (color), `node --test`, system `tar`.

> **IMPORTANT — working directory:** All paths below are relative to the **sibling repo** `/Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill`, NOT the skill repo this plan lives in. `cd` there before running any command. The design spec is at `../sogni-creative-agent-skill/docs/superpowers/specs/2026-05-29-purge-complete-uninstall-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/flags.mjs` | CLI flag parsing | Modify — add `--purge` → `flags.purge` |
| `src/purge.mjs` | Purge logic: summarize, confirm, backup, delete | **Create** |
| `src/run.mjs` | Orchestration: dispatch standalone purge + compose with uninstall | Modify |
| `src/summary.mjs` | Final summary table | Modify — add `Data` row |
| `bin/setup.mjs` | `--help` text | Modify — add `--purge` line |
| `README.md` | User docs | Modify — document `--purge` + recovery |
| `test/flags.test.mjs` | Flag parse tests | Modify — add `--purge` cases |
| `test/purge.test.mjs` | `runPurge` behavior tests | **Create** |

---

## Task 1: Parse the `--purge` flag

**Files:**
- Modify: `src/flags.mjs`
- Test: `test/flags.test.mjs`

- [ ] **Step 1: Write the failing test**

Add these two tests to the end of `test/flags.test.mjs`:

```js
test('parses --purge', () => {
  assert.equal(parseFlags(['--purge']).purge, true);
});

test('--purge defaults to false', () => {
  assert.equal(parseFlags([]).purge, false);
});

test('parses --uninstall --remove-cli --purge together', () => {
  const f = parseFlags(['--uninstall', '--remove-cli', '--purge']);
  assert.equal(f.uninstall, true);
  assert.equal(f.removeCli, true);
  assert.equal(f.purge, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && node --test test/flags.test.mjs`
Expected: FAIL — `parses --purge` asserts `undefined === true`.

- [ ] **Step 3: Implement the flag**

In `src/flags.mjs`, add `'--purge'` to the `BOOL_FLAGS` set:

```js
const BOOL_FLAGS = new Set([
  '--yes', '-y',
  '--dry-run',
  '--uninstall',
  '--remove-cli',
  '--purge',
  '--symlink',
  '--no-credentials',
]);
```

Add `purge: false,` to the `out` object (next to `removeCli: false,`):

```js
    uninstall: false,
    removeCli: false,
    purge: false,
    symlink: false,
```

Add the parse branch in the `if (BOOL_FLAGS.has(arg))` block, after the `--remove-cli` branch:

```js
      else if (arg === '--remove-cli') out.removeCli = true;
      else if (arg === '--purge') out.purge = true;
      else if (arg === '--symlink') out.symlink = true;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && node --test test/flags.test.mjs`
Expected: PASS — all flag tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill
git add src/flags.mjs test/flags.test.mjs
git commit -m "feat(flags): parse --purge flag

Adds a boolean --purge flag to the installer so a later change can wire
up complete removal of the Sogni data directory. Defaults to false and
composes with the existing --uninstall and --remove-cli flags.

Validation: node --test test/flags.test.mjs"
```

---

## Task 2: Create `runPurge` — happy path (backup then delete)

**Files:**
- Create: `src/purge.mjs`
- Test: `test/purge.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/purge.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPurge } from '../src/purge.mjs';
import { withTempHome } from './helpers.mjs';

function seedDataDir(home) {
  const dir = join(home, '.config', 'sogni');
  mkdirSync(join(dir, 'personas'), { recursive: true });
  writeFileSync(join(dir, 'personas', 'index.json'), '{}');
  writeFileSync(join(dir, 'personas', 'alice.json'), '{}');
  writeFileSync(join(dir, 'personas', 'bob.json'), '{}');
  writeFileSync(join(dir, 'memories.json'), '[]');
  writeFileSync(join(dir, 'personality.txt'), 'friendly');
  writeFileSync(join(dir, 'credentials'), 'SOGNI_API_KEY=sk-x\n');
  writeFileSync(join(dir, 'last-render.json'), '{}');
  return dir;
}

const FIXED = new Date(2026, 4, 29, 13, 5, 9); // 2026-05-29 13:05:09 local

test('backs up then deletes the data dir', async (t) => {
  const home = withTempHome(t);
  const dir = seedDataDir(home);
  const result = await runPurge({ yes: true, now: FIXED });
  assert.equal(result.status, 'purged');
  assert.equal(result.removed, dir);
  assert.equal(existsSync(dir), false);
  // backup tarball sits beside the removed dir, under ~/.config
  const backups = readdirSync(join(home, '.config')).filter(n => n.startsWith('sogni.backup-'));
  assert.equal(backups.length, 1);
  assert.equal(backups[0], 'sogni.backup-20260529-130509.tar.gz');
  assert.equal(result.backup, join(home, '.config', backups[0]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && node --test test/purge.test.mjs`
Expected: FAIL — `Cannot find module '../src/purge.mjs'`.

- [ ] **Step 3: Create the module**

Create `src/purge.mjs`:

```js
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import prompts from 'prompts';
import kleur from 'kleur';

export function sogniDataDir() {
  return join(homedir(), '.config', 'sogni');
}

function timestamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

export function summarizeDataDir(dir) {
  const lines = [];
  const personasDir = join(dir, 'personas');
  if (existsSync(personasDir)) {
    const count = readdirSync(personasDir).filter((n) => n !== 'index.json').length;
    lines.push(`${count} persona${count === 1 ? '' : 's'}`);
  }
  for (const f of ['memories.json', 'personality.txt', 'credentials', 'last-render.json']) {
    if (existsSync(join(dir, f))) {
      lines.push(f === 'credentials' ? 'credentials (API key)' : f);
    }
  }
  if (lines.length === 0) lines.push('(empty)');
  return lines;
}

// Default backup implementation. Injectable via runPurge({ backupFn }) for tests.
function tarBackup(dir, dest) {
  const res = spawnSync('tar', ['-czf', dest, '-C', dirname(dir), basename(dir)], {
    stdio: 'ignore',
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`tar exited with status ${res.status}`);
}

export async function runPurge({
  yes = false,
  dryRun = false,
  now = new Date(),
  backupFn = tarBackup,
} = {}) {
  const dir = sogniDataDir();
  const backup = join(dirname(dir), `sogni.backup-${timestamp(now)}.tar.gz`);

  if (!existsSync(dir)) {
    console.log('Nothing to purge — ~/.config/sogni/ not found.');
    return { status: 'skipped', removed: null, backup: null };
  }

  console.log(kleur.bold('Will remove ~/.config/sogni/:'));
  for (const it of summarizeDataDir(dir)) console.log(`  - ${it}`);

  if (dryRun) {
    console.log(kleur.cyan(`Dry run — would back up to ${backup} and remove the directory.`));
    return { status: 'would-purge', removed: dir, backup };
  }

  if (!yes) {
    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: 'Permanently remove your Sogni data? A backup tarball will be written first.',
      initial: false,
    });
    if (ok !== true) {
      console.log('Purge cancelled — data left untouched.');
      return { status: 'cancelled', removed: null, backup: null };
    }
  }

  try {
    backupFn(dir, backup);
  } catch (err) {
    console.error(
      kleur.red(`Backup failed (${err.message}); aborting purge. Your data was NOT removed.`),
    );
    console.error('Back up ~/.config/sogni/ manually before retrying.');
    return { status: 'failed', removed: null, backup: null, error: err.message };
  }

  rmSync(dir, { recursive: true, force: true });
  console.log(`Backed up to ${backup}`);
  console.log(`Removed ${dir}`);
  return { status: 'purged', removed: dir, backup };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && node --test test/purge.test.mjs`
Expected: PASS — `backs up then deletes the data dir` green.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill
git add src/purge.mjs test/purge.test.mjs
git commit -m "feat(purge): add runPurge backup-then-delete core

New src/purge.mjs removes ~/.config/sogni/ after writing a timestamped
tar backup beside it. Backup is created via system tar with an injectable
backupFn seam for testing. Covers the happy path; edge cases follow.

Validation: node --test test/purge.test.mjs"
```

---

## Task 3: `runPurge` edge cases — skip, dry-run, cancel, backup-failure

**Files:**
- Test: `test/purge.test.mjs` (already created in Task 2)
- Modify: `src/purge.mjs` only if a test reveals a gap (the Task 2 implementation already covers these; these tests lock the behavior in)

- [ ] **Step 1: Write the failing tests**

Append to `test/purge.test.mjs`:

```js
test('no-op when data dir does not exist', async (t) => {
  withTempHome(t);
  const result = await runPurge({ yes: true, now: FIXED });
  assert.equal(result.status, 'skipped');
  assert.equal(result.removed, null);
});

test('dry-run writes nothing and reports would-purge', async (t) => {
  const home = withTempHome(t);
  const dir = seedDataDir(home);
  const result = await runPurge({ dryRun: true, yes: true, now: FIXED });
  assert.equal(result.status, 'would-purge');
  assert.equal(existsSync(dir), true); // still there
  const backups = readdirSync(join(home, '.config')).filter(n => n.startsWith('sogni.backup-'));
  assert.equal(backups.length, 0); // no tarball written
});

test('declined confirmation leaves data untouched', async (t) => {
  const home = withTempHome(t);
  const dir = seedDataDir(home);
  prompts.inject([false]);
  const result = await runPurge({ now: FIXED }); // yes defaults false → prompts
  assert.equal(result.status, 'cancelled');
  assert.equal(existsSync(dir), true);
});

test('--yes skips the prompt and deletes', async (t) => {
  const home = withTempHome(t);
  const dir = seedDataDir(home);
  // No prompts.inject — if runPurge tried to prompt, the test would hang/throw.
  const result = await runPurge({ yes: true, now: FIXED });
  assert.equal(result.status, 'purged');
  assert.equal(existsSync(dir), false);
});

test('backup failure aborts the delete', async (t) => {
  const home = withTempHome(t);
  const dir = seedDataDir(home);
  const failing = () => { throw new Error('tar boom'); };
  const result = await runPurge({ yes: true, now: FIXED, backupFn: failing });
  assert.equal(result.status, 'failed');
  assert.equal(existsSync(dir), true); // data preserved
});

test('shared paths outside ~/.config/sogni are never touched', async (t) => {
  const home = withTempHome(t);
  seedDataDir(home);
  // Seed shared, non-Sogni-owned paths.
  mkdirSync(join(home, '.openclaw'), { recursive: true });
  writeFileSync(join(home, '.openclaw', 'openclaw.json'), '{"x":1}');
  mkdirSync(join(home, '.clawdbot', 'media', 'inbound'), { recursive: true });
  writeFileSync(join(home, '.clawdbot', 'media', 'inbound', 'pic.png'), 'data');
  await runPurge({ yes: true, now: FIXED });
  assert.equal(existsSync(join(home, '.openclaw', 'openclaw.json')), true);
  assert.equal(existsSync(join(home, '.clawdbot', 'media', 'inbound', 'pic.png')), true);
});
```

- [ ] **Step 2: Run tests to verify they pass (behavior already implemented)**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && node --test test/purge.test.mjs`
Expected: PASS — all six new tests green against the Task 2 implementation. If any fail, fix `src/purge.mjs` to match the asserted behavior before continuing.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill
git add test/purge.test.mjs src/purge.mjs
git commit -m "test(purge): cover skip, dry-run, cancel, backup-failure, shared paths

Locks in that a missing dir is a no-op, dry-run writes nothing, a declined
confirm and a failed backup both preserve data, --yes skips the prompt, and
shared paths (~/.openclaw, ~/.clawdbot) are never touched.

Validation: node --test test/purge.test.mjs"
```

---

## Task 4: Render the `Data` row in the summary table

**Files:**
- Modify: `src/summary.mjs`

- [ ] **Step 1: Add the `purge` parameter and Data row**

In `src/summary.mjs`, change the function signature:

```js
export function printSummary({ adapterResults, cli, credentials, purge = null }) {
```

Then, immediately after the `if (credentials) { ... }` block and before the closing `console.log('');` / `Next steps:` block, add:

```js
  if (purge) {
    const map = {
      purged: kleur.yellow(`backed up to ${purge.backup}, removed`),
      'would-purge': kleur.cyan(`would back up to ${purge.backup} and remove (dry-run)`),
      cancelled: kleur.gray('cancelled — data kept'),
      skipped: kleur.gray('not found — nothing to remove'),
      failed: kleur.red('backup failed — data NOT removed'),
    };
    const target = purge.removed ?? '~/.config/sogni/';
    console.log(`  ${'Data'.padEnd(16)} ${target.padEnd(60)} ${map[purge.status] ?? purge.status}`);
  }
```

- [ ] **Step 2: Verify the existing suite still passes**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && node --test`
Expected: PASS — no regressions. (`printSummary` has no dedicated unit test in this package; it is exercised via `run`/integration. The default `purge = null` keeps existing callers unchanged.)

- [ ] **Step 3: Commit**

```bash
cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill
git add src/summary.mjs
git commit -m "feat(summary): render Data row for purge results

printSummary now accepts an optional purge result and prints a Data row
reflecting purged / would-purge / cancelled / skipped / failed states.
Defaults to null so existing install and uninstall callers are unaffected.

Validation: node --test"
```

---

## Task 5: Wire `runPurge` into `run.mjs` (standalone + composed)

**Files:**
- Modify: `src/run.mjs`

- [ ] **Step 1: Import `runPurge`**

In `src/run.mjs`, add to the import block (after the `ensureCredentials` import):

```js
import { ensureCredentials } from './credentials.mjs';
import { runPurge } from './purge.mjs';
```

- [ ] **Step 2: Add the standalone dispatch**

In `run(flags)`, the function currently begins:

```js
export async function run(flags) {
  if (flags.uninstall) {
    return runUninstall(flags);
  }
```

Add a standalone purge branch right after the uninstall branch:

```js
export async function run(flags) {
  if (flags.uninstall) {
    return runUninstall(flags);
  }
  if (flags.purge) {
    return runPurgeOnly(flags);
  }
```

- [ ] **Step 3: Add `runPurgeOnly` and compose purge into `runUninstall`**

Add this new function (e.g. directly above `runUninstall`):

```js
async function runPurgeOnly(flags) {
  const purge = await runPurge({ yes: flags.yes, dryRun: flags.dryRun });
  printSummary({ adapterResults: [], cli: null, credentials: null, purge });
  return { exitCode: purge.status === 'failed' ? 1 : 0 };
}
```

Then update `runUninstall`. It currently ends:

```js
  if (flags.removeCli) {
    console.log('Removing global CLI...');
    const { spawnSync } = await import('node:child_process');
    spawnSync('npm', ['uninstall', '-g', '@sogni-ai/sogni-creative-agent-skill'], { stdio: 'inherit' });
  }
  printSummary({ adapterResults: results, cli: null, credentials: null });
  return { exitCode: 0 };
}
```

Replace those last three lines (the `printSummary` and `return`) with purge composition so data is removed **last**:

```js
  if (flags.removeCli) {
    console.log('Removing global CLI...');
    const { spawnSync } = await import('node:child_process');
    spawnSync('npm', ['uninstall', '-g', '@sogni-ai/sogni-creative-agent-skill'], { stdio: 'inherit' });
  }
  let purge = null;
  if (flags.purge) {
    purge = await runPurge({ yes: flags.yes, dryRun: flags.dryRun });
  }
  printSummary({ adapterResults: results, cli: null, credentials: null, purge });
  return { exitCode: purge?.status === 'failed' ? 1 : 0 };
}
```

- [ ] **Step 4: Manually verify the three invocation shapes**

Run each against a throwaway HOME so nothing real is touched:

```bash
cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill
# Seed a fake data dir under a temp HOME
TMPHOME="$(mktemp -d)"; mkdir -p "$TMPHOME/.config/sogni/personas"
echo '{}' > "$TMPHOME/.config/sogni/personas/index.json"
echo '{}' > "$TMPHOME/.config/sogni/personas/alice.json"
echo 'SOGNI_API_KEY=sk-x' > "$TMPHOME/.config/sogni/credentials"

# 1. standalone dry-run — prints plan, removes nothing
HOME="$TMPHOME" node bin/setup.mjs --purge --dry-run
ls "$TMPHOME/.config/sogni"   # still present

# 2. standalone purge — backs up then removes
HOME="$TMPHOME" node bin/setup.mjs --purge --yes
ls "$TMPHOME/.config"         # sogni/ gone, sogni.backup-*.tar.gz present

rm -rf "$TMPHOME"
```

Expected:
- Run 1 prints `Will remove ~/.config/sogni/:` + a `Dry run — would back up to …` line; `ls` still shows the `sogni` dir.
- Run 2 prints `Backed up to …` and `Removed …`; `ls "$TMPHOME/.config"` shows only `sogni.backup-*.tar.gz`, no `sogni/`. The summary shows a `Data` row.

- [ ] **Step 5: Run the full test suite**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && node --test`
Expected: PASS — entire suite green (flags, purge, adapters, detect, credentials, install-cli, resolve-skill).

- [ ] **Step 6: Commit**

```bash
cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill
git add src/run.mjs
git commit -m "feat(run): wire --purge standalone and composed with --uninstall

Standalone --purge runs a purge-only path (data removed, skill files kept).
When composed with --uninstall, purge runs last — after adapter removal and
--remove-cli — so the data dir is gone only after everything that reads it.
Exit code is 1 when a backup failure aborts the purge.

Validation: node --test; manual --purge --dry-run and --purge --yes against a temp HOME"
```

---

## Task 6: Document `--purge` in help text and README

**Files:**
- Modify: `bin/setup.mjs`
- Modify: `README.md`

- [ ] **Step 1: Add the `--purge` line to `--help`**

In `bin/setup.mjs`, in the `HELP` template literal, add a line after `--remove-cli`:

```
  --uninstall                     Remove previously installed skill files
  --remove-cli                    With --uninstall, also npm uninstall -g
  --purge                         Remove ~/.config/sogni/ (data) after a tar backup
  --help, -h                      Show this help
```

- [ ] **Step 2: Verify help renders**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && node bin/setup.mjs --help`
Expected: output now lists the `--purge` line.

- [ ] **Step 3: Document `--purge` in the README**

Locate the uninstall documentation in `README.md`:

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && grep -n -i "uninstall" README.md`

Under the existing uninstall section (after the `--uninstall` / `--remove-cli` description), add:

```markdown
### Complete uninstall (remove your data too)

`--uninstall` and `--remove-cli` remove the skill files and the global CLI but
leave your Sogni data in `~/.config/sogni/` (API key, personas, memories,
personality, last render). To remove that too, add `--purge`:

```bash
# Remove data only (skill files and CLI stay installed)
npx setup-sogni-agent-skill --purge

# Full teardown: skill files, then global CLI, then data
npx setup-sogni-agent-skill --uninstall --remove-cli --purge
```

`--purge` asks for confirmation (skip with `--yes`) and **always writes a backup
tarball first**: `~/.config/sogni.backup-<timestamp>.tar.gz`. If the backup
cannot be written, the purge aborts and your data is left untouched. Shared
paths used by other tools (`~/.openclaw/openclaw.json`, `~/.clawdbot/`) are never
touched.

To recover from a backup:

```bash
tar -xzf ~/.config/sogni.backup-<timestamp>.tar.gz -C ~/.config
```
```

- [ ] **Step 4: Commit**

```bash
cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill
git add bin/setup.mjs README.md
git commit -m "docs(purge): document --purge in help text and README

Adds the --purge line to setup --help and a Complete uninstall section to
the README covering standalone vs full teardown, the confirm + backup
safety net, the recovery command, and the shared paths left untouched.

Validation: node bin/setup.mjs --help"
```

---

## Final verification

- [ ] **Run the full suite one more time**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && node --test`
Expected: PASS — all tests green, including the new `test/purge.test.mjs` and the extended `test/flags.test.mjs`.

- [ ] **Confirm the git log reads cleanly**

Run: `cd /Users/krunkosaurus/Documents/git/sogni/setup-sogni-agent-skill && git log --oneline -6`
Expected: six focused commits (flags, purge core, purge edge tests, summary, run wiring, docs).

---

## Notes for the implementer

- **Why `backupFn` injection?** The design requires that a backup failure aborts the delete so data is never lost. Injecting the backup function is the cleanest way to deterministically exercise that path in a test without breaking `tar`. Production code uses the real `tarBackup`; only the test passes a throwing stub.
- **Timestamp determinism.** `runPurge` accepts a `now` argument (default `new Date()`) so tests assert an exact backup filename. This is a normal Node CLI — `new Date()` is fine here (the constraint against it applies only to Workflow scripts).
- **`prompts.inject([...])`** is the package's existing stdin-stubbing pattern (see `test/credentials.test.mjs`). For a `type: 'confirm'` prompt, inject a boolean: `prompts.inject([true])` to accept, `[false]` to decline. The `--yes` tests deliberately omit `inject` — if the code ever tried to prompt under `--yes`, the test would surface it.
- **Out of scope (per spec, v1.1+ candidates):** `--restore`, honoring individual `SOGNI_*_PATH` env overrides, a `--purge-shared` for `~/.openclaw`, and pruning old backup tarballs. Do not implement these.
