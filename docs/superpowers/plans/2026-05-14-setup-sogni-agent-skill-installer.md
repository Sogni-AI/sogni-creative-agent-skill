# `setup-sogni-agent-skill` Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a new npm package `setup-sogni-agent-skill` that auto-installs the Sogni Creative Agent Skill into Claude Code, OpenAI Codex CLI, Hermes Agent, and prints Custom-GPT instructions for ChatGPT (web), via one command: `npx setup-sogni-agent-skill`.

**Architecture:** Thin standalone npm package. On run: detect runtimes → confirm with user → `npm install -g @sogni-ai/sogni-creative-agent-skill@latest` → resolve global install path → dispatch to per-runtime adapters → prompt for API key → print summary. Per-runtime adapters share a common interface (`detect`, `install`, `uninstall`) and use marker files (`.sogni-installed.json`) for idempotency / upgrade detection.

**Tech Stack:** Node.js ≥22, ESM, `node --test`, dependencies: `prompts` (interactive prompts), `kleur` (colored output). All process execution via built-in `node:child_process`. No build step.

**Reference spec:** `docs/superpowers/specs/2026-05-14-setup-sogni-agent-skill-installer-design.md`

**Repo location:** All work happens in a NEW repo at `~/Documents/git/sogni/setup-sogni-agent-skill/`. The plan document and spec live in the main `sogni-creative-agent-skill` repo for record-keeping, but code lives separately.

---

## File Structure

```
~/Documents/git/sogni/setup-sogni-agent-skill/
├── package.json
├── README.md
├── LICENSE
├── .gitignore
├── .npmignore
├── .nvmrc                            # 22
├── bin/
│   └── setup.mjs                     # CLI entry: parse flags → call run()
├── src/
│   ├── run.mjs                       # main orchestrator
│   ├── flags.mjs                     # argv parser
│   ├── detect.mjs                    # runtime detection (all 4)
│   ├── install-cli.mjs               # `npm install -g @sogni-ai/...`
│   ├── resolve-skill.mjs             # find global install dir via `npm root -g`
│   ├── credentials.mjs               # prompt + write ~/.config/sogni/credentials
│   ├── summary.mjs                   # print final table
│   └── adapters/
│       ├── shared.mjs                # marker file read/write
│       ├── claude-code.mjs
│       ├── codex-cli.mjs
│       ├── hermes.mjs
│       └── chatgpt-web.mjs
├── test/
│   ├── fixtures/
│   │   └── skill-src/                # minimal copy of the skill package layout
│   │       ├── SKILL.md
│   │       ├── llm.txt
│   │       ├── version.mjs
│   │       ├── skill-package.json
│   │       ├── env.mjs
│   │       ├── ssrf-guard.mjs
│   │       ├── sogni-agent.mjs       # stub
│   │       ├── openclaw-plugin.mjs
│   │       ├── openclaw.plugin.json
│   │       ├── scripts/check-creative-agent-runtime.mjs
│   │       └── generated/creative-agent-runtime.mjs
│   ├── helpers.mjs                   # tmp HOME helper
│   ├── flags.test.mjs
│   ├── detect.test.mjs
│   ├── resolve-skill.test.mjs
│   ├── credentials.test.mjs
│   ├── adapters.shared.test.mjs
│   ├── adapters.claude-code.test.mjs
│   ├── adapters.codex-cli.test.mjs
│   ├── adapters.hermes.test.mjs
│   ├── adapters.chatgpt-web.test.mjs
│   └── setup.integration.mjs
└── .github/workflows/ci.yml
```

**File responsibilities:**

- `bin/setup.mjs` — entry only; parses argv, calls `run()`.
- `src/run.mjs` — high-level flow; never reads/writes files directly, delegates to other modules.
- `src/flags.mjs` — pure argv → options object. No I/O.
- `src/detect.mjs` — pure fs probing. Returns records, no writes.
- `src/install-cli.mjs` — wraps `npm install -g`. Honors `INSTALL_CLI=skip` env for tests.
- `src/resolve-skill.mjs` — locates the on-disk skill source after CLI install.
- `src/credentials.mjs` — handles API key flow only.
- `src/summary.mjs` — formatting only.
- `src/adapters/*.mjs` — one file per runtime; all implement the same interface.
- `src/adapters/shared.mjs` — marker file utilities used by all adapters.

---

## Task 0: Bootstrap the new repo

**Files:**
- Create: `~/Documents/git/sogni/setup-sogni-agent-skill/package.json`
- Create: `~/Documents/git/sogni/setup-sogni-agent-skill/.gitignore`
- Create: `~/Documents/git/sogni/setup-sogni-agent-skill/.nvmrc`
- Create: `~/Documents/git/sogni/setup-sogni-agent-skill/.npmignore`
- Create: `~/Documents/git/sogni/setup-sogni-agent-skill/LICENSE` (MIT, same author as main package)

- [ ] **Step 1: Create the directory and init git**

```bash
mkdir -p ~/Documents/git/sogni/setup-sogni-agent-skill
cd ~/Documents/git/sogni/setup-sogni-agent-skill
git init -b main
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "setup-sogni-agent-skill",
  "version": "0.1.0",
  "description": "One-command installer that registers the Sogni Creative Agent Skill into Claude Code, OpenAI Codex CLI, Hermes Agent, and prints ChatGPT Custom-GPT instructions.",
  "type": "module",
  "bin": {
    "setup-sogni-agent-skill": "./bin/setup.mjs"
  },
  "scripts": {
    "test": "node --test test/*.test.mjs test/setup.integration.mjs"
  },
  "keywords": [
    "sogni",
    "ai",
    "agent",
    "skill",
    "installer",
    "claude-code",
    "codex",
    "hermes",
    "image-generation"
  ],
  "author": "Mauvis Ledford",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Sogni-AI/setup-sogni-agent-skill.git"
  },
  "homepage": "https://github.com/Sogni-AI/setup-sogni-agent-skill#readme",
  "engines": {
    "node": ">=22"
  },
  "files": [
    "bin/",
    "src/",
    "README.md",
    "LICENSE"
  ],
  "dependencies": {
    "kleur": "^4.1.5",
    "prompts": "^2.4.2"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
*.log
.DS_Store
.tmp-test-home/
```

- [ ] **Step 4: Write `.nvmrc`**

```
22
```

- [ ] **Step 5: Write `.npmignore`**

```
test/
.github/
.nvmrc
.gitignore
.tmp-test-home/
```

- [ ] **Step 6: Write `LICENSE`** (copy MIT license text from main `sogni-creative-agent-skill` repo's LICENSE file, same author/year)

```bash
cp ~/Documents/git/sogni/sogni-creative-agent-skill/LICENSE ~/Documents/git/sogni/setup-sogni-agent-skill/LICENSE
```

- [ ] **Step 7: Install deps**

```bash
cd ~/Documents/git/sogni/setup-sogni-agent-skill
npm install
```

Expected: `package-lock.json` created, `node_modules/` populated.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore .nvmrc .npmignore LICENSE
git commit -m "chore: bootstrap setup-sogni-agent-skill package"
```

---

## Task 1: Test fixtures and helpers

**Files:**
- Create: `test/helpers.mjs`
- Create: `test/fixtures/skill-src/SKILL.md`
- Create: `test/fixtures/skill-src/llm.txt`
- Create: `test/fixtures/skill-src/version.mjs`
- Create: `test/fixtures/skill-src/skill-package.json`
- Create: `test/fixtures/skill-src/env.mjs`
- Create: `test/fixtures/skill-src/ssrf-guard.mjs`
- Create: `test/fixtures/skill-src/sogni-agent.mjs`
- Create: `test/fixtures/skill-src/openclaw-plugin.mjs`
- Create: `test/fixtures/skill-src/openclaw.plugin.json`
- Create: `test/fixtures/skill-src/scripts/check-creative-agent-runtime.mjs`
- Create: `test/fixtures/skill-src/generated/creative-agent-runtime.mjs`

- [ ] **Step 1: Write `test/helpers.mjs`**

```js
// test/helpers.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function withTempHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'sogni-setup-test-'));
  const prevHome = process.env.HOME;
  const prevUserprofile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    process.env.HOME = prevHome;
    process.env.USERPROFILE = prevUserprofile;
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

export const FIXTURE_SKILL_SRC = new URL('./fixtures/skill-src/', import.meta.url).pathname;
```

- [ ] **Step 2: Write minimal fixture files**

```bash
mkdir -p test/fixtures/skill-src/scripts test/fixtures/skill-src/generated
```

`test/fixtures/skill-src/SKILL.md`:
```markdown
# Sogni Creative Agent Skill (test fixture)
This is a fixture SKILL.md used by setup-sogni-agent-skill tests.
```

`test/fixtures/skill-src/llm.txt`:
```
Test fixture llm.txt
```

`test/fixtures/skill-src/version.mjs`:
```js
export const VERSION = '2.3.0';
```

`test/fixtures/skill-src/skill-package.json`:
```json
{ "name": "sogni-creative-agent-skill", "version": "2.3.0" }
```

`test/fixtures/skill-src/env.mjs`:
```js
export const ENV = 'fixture';
```

`test/fixtures/skill-src/ssrf-guard.mjs`:
```js
export function guard() { return true; }
```

`test/fixtures/skill-src/sogni-agent.mjs`:
```js
#!/usr/bin/env node
console.log('fixture cli');
```

`test/fixtures/skill-src/openclaw-plugin.mjs`:
```js
export default {};
```

`test/fixtures/skill-src/openclaw.plugin.json`:
```json
{ "name": "sogni-creative-agent-skill" }
```

`test/fixtures/skill-src/scripts/check-creative-agent-runtime.mjs`:
```js
// fixture script
```

`test/fixtures/skill-src/generated/creative-agent-runtime.mjs`:
```js
export const RUNTIME = 'fixture';
```

- [ ] **Step 3: Commit**

```bash
git add test/
git commit -m "test: add fixtures and helpers for installer tests"
```

---

## Task 2: Flag parser (`src/flags.mjs`)

**Files:**
- Create: `src/flags.mjs`
- Create: `test/flags.test.mjs`

- [ ] **Step 1: Write the failing tests**

`test/flags.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags } from '../src/flags.mjs';

test('parses empty argv', () => {
  const flags = parseFlags([]);
  assert.equal(flags.yes, false);
  assert.equal(flags.dryRun, false);
  assert.equal(flags.uninstall, false);
  assert.equal(flags.removeCli, false);
  assert.equal(flags.symlink, false);
  assert.equal(flags.noCredentials, false);
  assert.equal(flags.version, 'latest');
  assert.equal(flags.hermesCategory, 'media');
  assert.deepEqual(flags.only, null);
  assert.deepEqual(flags.exclude, null);
  assert.equal(flags.outputChatgptBundle, null);
});

test('parses --yes and -y', () => {
  assert.equal(parseFlags(['--yes']).yes, true);
  assert.equal(parseFlags(['-y']).yes, true);
});

test('parses --only as comma list', () => {
  assert.deepEqual(parseFlags(['--only=claude,codex']).only, ['claude', 'codex']);
});

test('parses --exclude as comma list', () => {
  assert.deepEqual(parseFlags(['--exclude=chatgpt']).exclude, ['chatgpt']);
});

test('parses --version=X.Y.Z', () => {
  assert.equal(parseFlags(['--version=2.3.0']).version, '2.3.0');
});

test('parses --hermes-category=', () => {
  assert.equal(parseFlags(['--hermes-category=creative']).hermesCategory, 'creative');
});

test('parses --output-chatgpt-bundle=path', () => {
  assert.equal(parseFlags(['--output-chatgpt-bundle=/tmp/x.md']).outputChatgptBundle, '/tmp/x.md');
});

test('parses --dry-run, --uninstall, --remove-cli, --symlink, --no-credentials', () => {
  const f = parseFlags(['--dry-run', '--uninstall', '--remove-cli', '--symlink', '--no-credentials']);
  assert.equal(f.dryRun, true);
  assert.equal(f.uninstall, true);
  assert.equal(f.removeCli, true);
  assert.equal(f.symlink, true);
  assert.equal(f.noCredentials, true);
});

test('rejects unknown flags', () => {
  assert.throws(() => parseFlags(['--bogus']), /Unknown flag/);
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd ~/Documents/git/sogni/setup-sogni-agent-skill
node --test test/flags.test.mjs
```

Expected: FAIL with "Cannot find module ../src/flags.mjs".

- [ ] **Step 3: Write implementation**

`src/flags.mjs`:
```js
const BOOL_FLAGS = new Set([
  '--yes', '-y',
  '--dry-run',
  '--uninstall',
  '--remove-cli',
  '--symlink',
  '--no-credentials',
]);

const VALUE_FLAGS = new Set([
  '--only',
  '--exclude',
  '--version',
  '--hermes-category',
  '--output-chatgpt-bundle',
]);

export function parseFlags(argv) {
  const out = {
    yes: false,
    dryRun: false,
    uninstall: false,
    removeCli: false,
    symlink: false,
    noCredentials: false,
    version: 'latest',
    hermesCategory: 'media',
    only: null,
    exclude: null,
    outputChatgptBundle: null,
  };
  for (const arg of argv) {
    if (BOOL_FLAGS.has(arg)) {
      if (arg === '--yes' || arg === '-y') out.yes = true;
      else if (arg === '--dry-run') out.dryRun = true;
      else if (arg === '--uninstall') out.uninstall = true;
      else if (arg === '--remove-cli') out.removeCli = true;
      else if (arg === '--symlink') out.symlink = true;
      else if (arg === '--no-credentials') out.noCredentials = true;
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) {
      const key = arg.slice(0, eq);
      const value = arg.slice(eq + 1);
      if (!VALUE_FLAGS.has(key)) throw new Error(`Unknown flag: ${arg}`);
      if (key === '--only') out.only = value.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === '--exclude') out.exclude = value.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === '--version') out.version = value;
      else if (key === '--hermes-category') out.hermesCategory = value;
      else if (key === '--output-chatgpt-bundle') out.outputChatgptBundle = value;
      continue;
    }
    throw new Error(`Unknown flag: ${arg}`);
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
node --test test/flags.test.mjs
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/flags.mjs test/flags.test.mjs
git commit -m "feat: argv flag parser"
```

---

## Task 3: Runtime detection (`src/detect.mjs`)

**Files:**
- Create: `src/detect.mjs`
- Create: `test/detect.test.mjs`

- [ ] **Step 1: Write the failing tests**

`test/detect.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectAll } from '../src/detect.mjs';
import { withTempHome } from './helpers.mjs';

test('detects Claude Code via ~/.claude/', (t) => {
  const home = withTempHome(t);
  mkdirSync(join(home, '.claude'));
  const result = detectAll();
  const claude = result.find(r => r.runtime === 'claude-code');
  assert.equal(claude.status, 'available');
  assert.equal(claude.path, join(home, '.claude'));
  assert.equal(claude.installedVersion, null);
});

test('detects Codex CLI via ~/.codex/', (t) => {
  const home = withTempHome(t);
  mkdirSync(join(home, '.codex'));
  const result = detectAll();
  const codex = result.find(r => r.runtime === 'codex-cli');
  assert.equal(codex.status, 'available');
  assert.equal(codex.installedVersion, null);
});

test('detects existing Codex skill install with marker', (t) => {
  const home = withTempHome(t);
  mkdirSync(join(home, '.codex/skills/sogni-creative-agent-skill'), { recursive: true });
  writeFileSync(
    join(home, '.codex/skills/sogni-creative-agent-skill/.sogni-installed.json'),
    JSON.stringify({ version: '2.1.0', installedAt: '2026-01-01', adapter: 'codex-cli' })
  );
  const result = detectAll();
  const codex = result.find(r => r.runtime === 'codex-cli');
  assert.equal(codex.installedVersion, '2.1.0');
});

test('detects Hermes Agent across categories', (t) => {
  const home = withTempHome(t);
  mkdirSync(join(home, '.hermes/skills/media/sogni-creative-agent-skill'), { recursive: true });
  writeFileSync(
    join(home, '.hermes/skills/media/sogni-creative-agent-skill/.sogni-installed.json'),
    JSON.stringify({ version: '2.2.0', adapter: 'hermes' })
  );
  const result = detectAll();
  const hermes = result.find(r => r.runtime === 'hermes');
  assert.equal(hermes.status, 'available');
  assert.equal(hermes.installedVersion, '2.2.0');
  assert.equal(hermes.installedCategory, 'media');
});

test('not-found when runtime dir missing', (t) => {
  withTempHome(t);
  const result = detectAll();
  for (const r of result.filter(r => r.runtime !== 'chatgpt-web')) {
    assert.equal(r.status, 'not-found');
  }
});

test('chatgpt-web always available', (t) => {
  withTempHome(t);
  const chatgpt = detectAll().find(r => r.runtime === 'chatgpt-web');
  assert.equal(chatgpt.status, 'available');
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
node --test test/detect.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Write implementation**

`src/detect.mjs`:
```js
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SKILL_DIR_NAME = 'sogni-creative-agent-skill';
const MARKER = '.sogni-installed.json';

function readMarker(dir) {
  const p = join(dir, MARKER);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function detectClaudeCode() {
  const home = homedir();
  const path = join(home, '.claude');
  if (!existsSync(path)) {
    return { runtime: 'claude-code', status: 'not-found', path: null, installedVersion: null };
  }
  const skillDir = join(path, 'skills', SKILL_DIR_NAME);
  const marker = readMarker(skillDir);
  return {
    runtime: 'claude-code',
    status: 'available',
    path,
    skillDir,
    installedVersion: marker?.version ?? null,
  };
}

function detectCodexCli() {
  const home = homedir();
  const path = join(home, '.codex');
  if (!existsSync(path)) {
    return { runtime: 'codex-cli', status: 'not-found', path: null, installedVersion: null };
  }
  const skillDir = join(path, 'skills', SKILL_DIR_NAME);
  const marker = readMarker(skillDir);
  return {
    runtime: 'codex-cli',
    status: 'available',
    path,
    skillDir,
    installedVersion: marker?.version ?? null,
  };
}

function detectHermes() {
  const home = homedir();
  const path = join(home, '.hermes');
  if (!existsSync(path)) {
    return { runtime: 'hermes', status: 'not-found', path: null, installedVersion: null };
  }
  const skillsRoot = join(path, 'skills');
  let installedCategory = null;
  let installedVersion = null;
  let skillDir = null;
  if (existsSync(skillsRoot)) {
    for (const entry of readdirSync(skillsRoot)) {
      const candidate = join(skillsRoot, entry, SKILL_DIR_NAME);
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        installedCategory = entry;
        skillDir = candidate;
        const marker = readMarker(candidate);
        installedVersion = marker?.version ?? null;
        break;
      }
    }
  }
  return {
    runtime: 'hermes',
    status: 'available',
    path,
    skillDir,
    installedCategory,
    installedVersion,
  };
}

function detectChatgptWeb() {
  return {
    runtime: 'chatgpt-web',
    status: 'available',
    path: null,
    skillDir: null,
    installedVersion: null,
  };
}

export function detectAll() {
  return [detectClaudeCode(), detectCodexCli(), detectHermes(), detectChatgptWeb()];
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
node --test test/detect.test.mjs
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/detect.mjs test/detect.test.mjs
git commit -m "feat: runtime detection for claude-code, codex-cli, hermes, chatgpt-web"
```

---

## Task 4: Marker file utilities (`src/adapters/shared.mjs`)

**Files:**
- Create: `src/adapters/shared.mjs`
- Create: `test/adapters.shared.test.mjs`

- [ ] **Step 1: Write the failing tests**

`test/adapters.shared.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeMarker, readMarker, MARKER_NAME } from '../src/adapters/shared.mjs';
import { withTempHome } from './helpers.mjs';

test('writes and reads marker file', (t) => {
  const home = withTempHome(t);
  const dir = join(home, 'skill');
  mkdirSync(dir);
  writeMarker(dir, { version: '2.3.0', adapter: 'claude-code' });
  const m = readMarker(dir);
  assert.equal(m.version, '2.3.0');
  assert.equal(m.adapter, 'claude-code');
  assert.ok(m.installedAt);
});

test('readMarker returns null when missing', (t) => {
  const home = withTempHome(t);
  assert.equal(readMarker(home), null);
});

test('readMarker returns null on invalid JSON', (t) => {
  const home = withTempHome(t);
  const dir = join(home, 'skill');
  mkdirSync(dir);
  require('node:fs').writeFileSync(join(dir, MARKER_NAME), 'not json');
  assert.equal(readMarker(dir), null);
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/adapters.shared.test.mjs
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`src/adapters/shared.mjs`:
```js
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MARKER_NAME = '.sogni-installed.json';

export function writeMarker(skillDir, { version, adapter, srcDir = null }) {
  const payload = {
    version,
    adapter,
    srcDir,
    installedAt: new Date().toISOString(),
  };
  writeFileSync(join(skillDir, MARKER_NAME), JSON.stringify(payload, null, 2), { mode: 0o644 });
}

export function readMarker(skillDir) {
  const p = join(skillDir, MARKER_NAME);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
```

Note: replace `require('node:fs')` in the test with `import { writeFileSync as wfs }` at top of test file:

Update `test/adapters.shared.test.mjs` import block:
```js
import { mkdirSync, readFileSync, existsSync, writeFileSync as rawWrite } from 'node:fs';
```
And replace `require('node:fs').writeFileSync` with `rawWrite`.

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/adapters.shared.test.mjs
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/shared.mjs test/adapters.shared.test.mjs
git commit -m "feat: shared marker file utilities"
```

---

## Task 5: Skill source resolver (`src/resolve-skill.mjs`)

**Files:**
- Create: `src/resolve-skill.mjs`
- Create: `test/resolve-skill.test.mjs`

- [ ] **Step 1: Write the failing tests**

`test/resolve-skill.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveSkillSource } from '../src/resolve-skill.mjs';

test('resolves skill source from a given npm-root path', () => {
  const fakeRoot = join(tmpdir(), `sogni-resolve-${Date.now()}`);
  const pkgDir = join(fakeRoot, '@sogni-ai/sogni-creative-agent-skill');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'SKILL.md'), '# fixture');
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: '2.3.0' }));
  const result = resolveSkillSource({ npmRoot: fakeRoot });
  assert.equal(result.srcDir, pkgDir);
  assert.equal(result.version, '2.3.0');
});

test('throws if SKILL.md missing in resolved path', () => {
  const fakeRoot = join(tmpdir(), `sogni-resolve-missing-${Date.now()}`);
  const pkgDir = join(fakeRoot, '@sogni-ai/sogni-creative-agent-skill');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: '2.3.0' }));
  assert.throws(() => resolveSkillSource({ npmRoot: fakeRoot }), /SKILL\.md not found/);
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/resolve-skill.test.mjs
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`src/resolve-skill.mjs`:
```js
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG = '@sogni-ai/sogni-creative-agent-skill';

export function resolveSkillSource({ npmRoot } = {}) {
  const root = npmRoot ?? execSync('npm root -g', { encoding: 'utf8' }).trim();
  const srcDir = join(root, PKG);
  const skillMd = join(srcDir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    throw new Error(`SKILL.md not found at ${skillMd} — is ${PKG} installed globally?`);
  }
  const pkgJson = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8'));
  return { srcDir, version: pkgJson.version };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/resolve-skill.test.mjs
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/resolve-skill.mjs test/resolve-skill.test.mjs
git commit -m "feat: resolve global skill source path"
```

---

## Task 6: Claude Code adapter (`src/adapters/claude-code.mjs`)

**Files:**
- Create: `src/adapters/claude-code.mjs`
- Create: `test/adapters.claude-code.test.mjs`

- [ ] **Step 1: Write the failing tests**

`test/adapters.claude-code.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import adapter from '../src/adapters/claude-code.mjs';
import { withTempHome, FIXTURE_SKILL_SRC } from './helpers.mjs';

test('install copies skill files into ~/.claude/skills/', (t) => {
  const home = withTempHome(t);
  const result = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  const skillDir = join(home, '.claude/skills/sogni-creative-agent-skill');
  assert.ok(existsSync(join(skillDir, 'SKILL.md')));
  assert.ok(existsSync(join(skillDir, 'llm.txt')));
  assert.ok(existsSync(join(skillDir, 'version.mjs')));
  assert.ok(existsSync(join(skillDir, '.sogni-installed.json')));
  const marker = JSON.parse(readFileSync(join(skillDir, '.sogni-installed.json'), 'utf8'));
  assert.equal(marker.version, '2.3.0');
  assert.equal(marker.adapter, 'claude-code');
  assert.deepEqual(result.written.length > 0, true);
});

test('install is idempotent at same version', (t) => {
  withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  const second = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  assert.equal(second.status, 'up-to-date');
});

test('install upgrades on version bump', (t) => {
  withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.2.0' });
  const second = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  assert.equal(second.status, 'upgraded');
  assert.equal(second.previousVersion, '2.2.0');
});

test('uninstall removes skill dir and marker', (t) => {
  const home = withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  const result = adapter.uninstall();
  assert.equal(existsSync(join(home, '.claude/skills/sogni-creative-agent-skill')), false);
  assert.equal(result.removed.length > 0, true);
});

test('uninstall is a no-op when not installed', (t) => {
  withTempHome(t);
  const result = adapter.uninstall();
  assert.deepEqual(result.removed, []);
});

test('dryRun: no writes', (t) => {
  const home = withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0', dryRun: true });
  assert.equal(existsSync(join(home, '.claude/skills/sogni-creative-agent-skill')), false);
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/adapters.claude-code.test.mjs
```

- [ ] **Step 3: Write implementation**

`src/adapters/claude-code.mjs`:
```js
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeMarker, readMarker } from './shared.mjs';

const SKILL_NAME = 'sogni-creative-agent-skill';
const FILES_TO_COPY = ['SKILL.md', 'llm.txt', 'version.mjs', 'skill-package.json'];

function skillDir() {
  return join(homedir(), '.claude', 'skills', SKILL_NAME);
}

export default {
  name: 'claude-code',

  detect() {
    const claudePath = join(homedir(), '.claude');
    if (!existsSync(claudePath)) return { found: false, path: null, installedVersion: null };
    const marker = readMarker(skillDir());
    return { found: true, path: claudePath, installedVersion: marker?.version ?? null };
  },

  install({ srcDir, version, dryRun = false }) {
    const dir = skillDir();
    const written = [];
    const existing = readMarker(dir);
    if (existing?.version === version) {
      return { status: 'up-to-date', written: [], notes: [`Already at ${version}`] };
    }
    if (dryRun) return { status: 'would-install', written: [], notes: [`Would write to ${dir}`] };
    mkdirSync(dir, { recursive: true });
    for (const file of FILES_TO_COPY) {
      const from = join(srcDir, file);
      if (!existsSync(from)) continue;
      const to = join(dir, file);
      copyFileSync(from, to);
      written.push(to);
    }
    writeMarker(dir, { version, adapter: 'claude-code', srcDir });
    written.push(join(dir, '.sogni-installed.json'));
    return {
      status: existing ? 'upgraded' : 'installed',
      previousVersion: existing?.version ?? null,
      written,
      notes: [],
    };
  },

  uninstall() {
    const dir = skillDir();
    if (!existsSync(dir)) return { removed: [] };
    rmSync(dir, { recursive: true, force: true });
    return { removed: [dir] };
  },
};
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/adapters.claude-code.test.mjs
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/claude-code.mjs test/adapters.claude-code.test.mjs
git commit -m "feat: Claude Code adapter (install/upgrade/uninstall)"
```

---

## Task 7: Codex CLI adapter (`src/adapters/codex-cli.mjs`)

**Files:**
- Create: `src/adapters/codex-cli.mjs`
- Create: `test/adapters.codex-cli.test.mjs`

Codex CLI requires the **full package contents** (everything from the main package's `files` whitelist), not just SKILL.md.

- [ ] **Step 1: Write the failing tests**

`test/adapters.codex-cli.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import adapter from '../src/adapters/codex-cli.mjs';
import { withTempHome, FIXTURE_SKILL_SRC } from './helpers.mjs';

test('install copies full package layout into ~/.codex/skills/', (t) => {
  const home = withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  const skillDir = join(home, '.codex/skills/sogni-creative-agent-skill');
  for (const file of ['SKILL.md', 'llm.txt', 'version.mjs', 'skill-package.json', 'env.mjs', 'ssrf-guard.mjs', 'sogni-agent.mjs', 'openclaw-plugin.mjs', 'openclaw.plugin.json']) {
    assert.ok(existsSync(join(skillDir, file)), `expected ${file} to exist`);
  }
  assert.ok(existsSync(join(skillDir, 'scripts/check-creative-agent-runtime.mjs')));
  assert.ok(existsSync(join(skillDir, 'generated/creative-agent-runtime.mjs')));
  const marker = JSON.parse(readFileSync(join(skillDir, '.sogni-installed.json'), 'utf8'));
  assert.equal(marker.version, '2.3.0');
  assert.equal(marker.adapter, 'codex-cli');
});

test('install does not copy node_modules even if present in srcDir', (t) => {
  const home = withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  const skillDir = join(home, '.codex/skills/sogni-creative-agent-skill');
  assert.equal(existsSync(join(skillDir, 'node_modules')), false);
});

test('idempotent at same version', (t) => {
  withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  const second = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  assert.equal(second.status, 'up-to-date');
});

test('upgrade replaces files and bumps marker', (t) => {
  withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.2.0' });
  const second = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  assert.equal(second.status, 'upgraded');
});

test('uninstall removes skill dir', (t) => {
  const home = withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  adapter.uninstall();
  assert.equal(existsSync(join(home, '.codex/skills/sogni-creative-agent-skill')), false);
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/adapters.codex-cli.test.mjs
```

- [ ] **Step 3: Write implementation**

`src/adapters/codex-cli.mjs`:
```js
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeMarker, readMarker } from './shared.mjs';

const SKILL_NAME = 'sogni-creative-agent-skill';

// Mirrors the main package.json `files` whitelist (minus README/LICENSE which Codex doesn't need).
const ENTRIES_TO_COPY = [
  'SKILL.md',
  'llm.txt',
  'version.mjs',
  'skill-package.json',
  'env.mjs',
  'ssrf-guard.mjs',
  'sogni-agent.mjs',
  'openclaw-plugin.mjs',
  'openclaw.plugin.json',
  'scripts',
  'generated',
];

function skillDir() {
  return join(homedir(), '.codex', 'skills', SKILL_NAME);
}

export default {
  name: 'codex-cli',

  detect() {
    const codexPath = join(homedir(), '.codex');
    if (!existsSync(codexPath)) return { found: false, path: null, installedVersion: null };
    const marker = readMarker(skillDir());
    return { found: true, path: codexPath, installedVersion: marker?.version ?? null };
  },

  install({ srcDir, version, dryRun = false }) {
    const dir = skillDir();
    const existing = readMarker(dir);
    if (existing?.version === version) {
      return { status: 'up-to-date', written: [], notes: [`Already at ${version}`] };
    }
    if (dryRun) return { status: 'would-install', written: [], notes: [`Would write to ${dir}`] };

    // Wipe & recreate to ensure removed files don't linger from old versions.
    if (existing) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const written = [];
    for (const entry of ENTRIES_TO_COPY) {
      const from = join(srcDir, entry);
      if (!existsSync(from)) continue;
      const to = join(dir, entry);
      cpSync(from, to, { recursive: true });
      written.push(to);
    }
    writeMarker(dir, { version, adapter: 'codex-cli', srcDir });
    written.push(join(dir, '.sogni-installed.json'));
    return {
      status: existing ? 'upgraded' : 'installed',
      previousVersion: existing?.version ?? null,
      written,
      notes: [],
    };
  },

  uninstall() {
    const dir = skillDir();
    if (!existsSync(dir)) return { removed: [] };
    rmSync(dir, { recursive: true, force: true });
    return { removed: [dir] };
  },
};
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/adapters.codex-cli.test.mjs
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex-cli.mjs test/adapters.codex-cli.test.mjs
git commit -m "feat: Codex CLI adapter (full package install, idempotent)"
```

---

## Task 8: Hermes adapter (`src/adapters/hermes.mjs`)

**Files:**
- Create: `src/adapters/hermes.mjs`
- Create: `test/adapters.hermes.test.mjs`

Hermes installs only SKILL.md, backs up the previous version with timestamped suffix, uses `0o600` perms, and lives under a category subdir (default: `media`).

- [ ] **Step 1: Write the failing tests**

`test/adapters.hermes.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import adapter from '../src/adapters/hermes.mjs';
import { withTempHome, FIXTURE_SKILL_SRC } from './helpers.mjs';

test('install writes SKILL.md only with 0o600 perms', (t) => {
  const home = withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0', category: 'media' });
  const skillDir = join(home, '.hermes/skills/media/sogni-creative-agent-skill');
  assert.ok(existsSync(join(skillDir, 'SKILL.md')));
  assert.equal(existsSync(join(skillDir, 'llm.txt')), false);
  const mode = statSync(join(skillDir, 'SKILL.md')).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('backs up existing SKILL.md before overwriting', (t) => {
  const home = withTempHome(t);
  // Pre-existing v2.2.0 install
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.2.0', category: 'media' });
  const skillDir = join(home, '.hermes/skills/media/sogni-creative-agent-skill');
  writeFileSync(join(skillDir, 'SKILL.md'), '# v2.2.0 content', { mode: 0o600 });
  // Upgrade to v2.3.0
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0', category: 'media' });
  const files = readdirSync(skillDir);
  const backup = files.find(f => f.startsWith('SKILL.md.bak-before-2.3.0-'));
  assert.ok(backup, `expected backup file, got: ${files.join(', ')}`);
  assert.equal(readFileSync(join(skillDir, backup), 'utf8'), '# v2.2.0 content');
});

test('reuses existing category instead of creating duplicate', (t) => {
  const home = withTempHome(t);
  // Existing install in "creative" category
  mkdirSync(join(home, '.hermes/skills/creative/sogni-creative-agent-skill'), { recursive: true });
  writeFileSync(join(home, '.hermes/skills/creative/sogni-creative-agent-skill/SKILL.md'), '# old');
  // Install with default category "media" — should detect & reuse "creative"
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0', category: 'media' });
  assert.ok(existsSync(join(home, '.hermes/skills/creative/sogni-creative-agent-skill/SKILL.md')));
  assert.equal(existsSync(join(home, '.hermes/skills/media/sogni-creative-agent-skill/SKILL.md')), false);
});

test('idempotent at same version', (t) => {
  withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0', category: 'media' });
  const second = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0', category: 'media' });
  assert.equal(second.status, 'up-to-date');
});

test('uninstall removes skill dir from whichever category it was installed in', (t) => {
  const home = withTempHome(t);
  adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0', category: 'creative' });
  adapter.uninstall();
  assert.equal(existsSync(join(home, '.hermes/skills/creative/sogni-creative-agent-skill')), false);
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/adapters.hermes.test.mjs
```

- [ ] **Step 3: Write implementation**

`src/adapters/hermes.mjs`:
```js
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeMarker, readMarker } from './shared.mjs';

const SKILL_NAME = 'sogni-creative-agent-skill';

function hermesSkillsRoot() {
  return join(homedir(), '.hermes', 'skills');
}

function findExistingSkillDir() {
  const root = hermesSkillsRoot();
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry, SKILL_NAME);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return { dir: candidate, category: entry };
    }
  }
  return null;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export default {
  name: 'hermes',

  detect() {
    const hermesPath = join(homedir(), '.hermes');
    if (!existsSync(hermesPath)) return { found: false, path: null, installedVersion: null };
    const existing = findExistingSkillDir();
    const marker = existing ? readMarker(existing.dir) : null;
    return {
      found: true,
      path: hermesPath,
      installedVersion: marker?.version ?? null,
      installedCategory: existing?.category ?? null,
    };
  },

  install({ srcDir, version, category = 'media', dryRun = false }) {
    const existing = findExistingSkillDir();
    const targetCategory = existing?.category ?? category;
    const dir = join(hermesSkillsRoot(), targetCategory, SKILL_NAME);
    const existingMarker = readMarker(dir);

    if (existingMarker?.version === version) {
      return { status: 'up-to-date', written: [], notes: [`Already at ${version} in category "${targetCategory}"`] };
    }
    if (dryRun) return { status: 'would-install', written: [], notes: [`Would write to ${dir}`] };

    mkdirSync(dir, { recursive: true });
    const skillMdPath = join(dir, 'SKILL.md');

    // Backup existing SKILL.md before overwrite
    if (existsSync(skillMdPath)) {
      const backupName = `SKILL.md.bak-before-${version}-${timestamp()}`;
      renameSync(skillMdPath, join(dir, backupName));
    }

    const content = readFileSync(join(srcDir, 'SKILL.md'));
    writeFileSync(skillMdPath, content, { mode: 0o600 });

    writeMarker(dir, { version, adapter: 'hermes', srcDir });

    return {
      status: existingMarker ? 'upgraded' : 'installed',
      previousVersion: existingMarker?.version ?? null,
      written: [skillMdPath, join(dir, '.sogni-installed.json')],
      notes: [`Category: ${targetCategory}`],
    };
  },

  uninstall() {
    const existing = findExistingSkillDir();
    if (!existing) return { removed: [] };
    rmSync(existing.dir, { recursive: true, force: true });
    return { removed: [existing.dir] };
  },
};
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/adapters.hermes.test.mjs
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/hermes.mjs test/adapters.hermes.test.mjs
git commit -m "feat: Hermes adapter with category awareness and backup-before-overwrite"
```

---

## Task 9: ChatGPT web adapter (`src/adapters/chatgpt-web.mjs`)

**Files:**
- Create: `src/adapters/chatgpt-web.mjs`
- Create: `test/adapters.chatgpt-web.test.mjs`

This adapter never writes to runtime directories. It produces a copy-pasteable Custom GPT bundle and optionally writes it to a file.

- [ ] **Step 1: Write the failing tests**

`test/adapters.chatgpt-web.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import adapter from '../src/adapters/chatgpt-web.mjs';
import { FIXTURE_SKILL_SRC } from './helpers.mjs';

test('install returns instructions text without writing anything', () => {
  const result = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0' });
  assert.equal(result.status, 'instructions');
  assert.ok(result.instructions.includes('Custom GPT'));
  assert.ok(result.instructions.includes('sogni-creative-agent-skill'));
  assert.deepEqual(result.written, []);
});

test('install writes bundle file when outputBundle path is given', () => {
  const file = join(tmpdir(), `sogni-bundle-${Date.now()}.md`);
  const result = adapter.install({ srcDir: FIXTURE_SKILL_SRC, version: '2.3.0', outputBundle: file });
  assert.ok(existsSync(file));
  assert.ok(readFileSync(file, 'utf8').includes('Custom GPT'));
  assert.deepEqual(result.written, [file]);
});

test('uninstall is a no-op', () => {
  assert.deepEqual(adapter.uninstall().removed, []);
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/adapters.chatgpt-web.test.mjs
```

- [ ] **Step 3: Write implementation**

`src/adapters/chatgpt-web.mjs`:
```js
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function buildInstructions({ srcDir, version }) {
  const skillContent = readFileSync(join(srcDir, 'SKILL.md'), 'utf8');
  return `# Sogni Creative Agent — ChatGPT Custom GPT setup (v${version})

ChatGPT (web) has no local install path. To use the Sogni Creative Agent
with a Custom GPT, follow these steps:

1. Open the Custom GPT editor: https://chatgpt.com/gpts/editor
2. Click "Create" then "Configure".
3. Use these values:

   Name: Sogni Creative Agent
   Description: Image, video, and music generation via Sogni AI.
   Instructions:
${skillContent.split('\n').map(l => '   ' + l).join('\n')}

4. Under "Actions", add the Sogni API (see https://dashboard.sogni.ai for an API key
   and the latest OpenAPI schema). The sogni-agent CLI is not available in the web
   sandbox, so the GPT must call the API directly.

5. Save & publish.

(For local agents — Claude Code, Codex CLI, Hermes — \`npx setup-sogni-agent-skill\`
installs the skill automatically.)
`;
}

export default {
  name: 'chatgpt-web',

  detect() {
    return { found: true, path: null, installedVersion: null };
  },

  install({ srcDir, version, outputBundle = null, dryRun = false }) {
    const instructions = buildInstructions({ srcDir, version });
    if (dryRun) return { status: 'would-print', written: [], instructions, notes: [] };
    const written = [];
    if (outputBundle) {
      writeFileSync(outputBundle, instructions);
      written.push(outputBundle);
    }
    return { status: 'instructions', written, instructions, notes: [] };
  },

  uninstall() {
    return { removed: [] };
  },
};
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/adapters.chatgpt-web.test.mjs
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/chatgpt-web.mjs test/adapters.chatgpt-web.test.mjs
git commit -m "feat: ChatGPT web adapter (Custom GPT instructions)"
```

---

## Task 10: Credentials prompt (`src/credentials.mjs`)

**Files:**
- Create: `src/credentials.mjs`
- Create: `test/credentials.test.mjs`

- [ ] **Step 1: Write the failing tests**

`test/credentials.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prompts from 'prompts';
import { ensureCredentials } from '../src/credentials.mjs';
import { withTempHome } from './helpers.mjs';

test('skips when SOGNI_API_KEY env is set', async (t) => {
  withTempHome(t);
  const prev = process.env.SOGNI_API_KEY;
  process.env.SOGNI_API_KEY = 'sk-env';
  t.after(() => { process.env.SOGNI_API_KEY = prev; });
  const result = await ensureCredentials();
  assert.equal(result.action, 'skipped-env');
});

test('skips when credentials file already has SOGNI_API_KEY', async (t) => {
  const home = withTempHome(t);
  const prev = process.env.SOGNI_API_KEY;
  delete process.env.SOGNI_API_KEY;
  t.after(() => { if (prev !== undefined) process.env.SOGNI_API_KEY = prev; });
  mkdirSync(join(home, '.config/sogni'), { recursive: true });
  writeFileSync(join(home, '.config/sogni/credentials'), 'SOGNI_API_KEY=sk-existing\n');
  const result = await ensureCredentials();
  assert.equal(result.action, 'skipped-file');
});

test('prompts and writes file with 0o600 when nothing set', async (t) => {
  const home = withTempHome(t);
  const prev = process.env.SOGNI_API_KEY;
  delete process.env.SOGNI_API_KEY;
  t.after(() => { if (prev !== undefined) process.env.SOGNI_API_KEY = prev; });
  prompts.inject(['sk-new-key']);
  const result = await ensureCredentials();
  const path = join(home, '.config/sogni/credentials');
  assert.ok(existsSync(path));
  assert.equal(readFileSync(path, 'utf8'), 'SOGNI_API_KEY=sk-new-key\n');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(result.action, 'written');
  assert.equal(result.path, path);
});

test('skip on empty input', async (t) => {
  withTempHome(t);
  const prev = process.env.SOGNI_API_KEY;
  delete process.env.SOGNI_API_KEY;
  t.after(() => { if (prev !== undefined) process.env.SOGNI_API_KEY = prev; });
  prompts.inject(['']);
  const result = await ensureCredentials();
  assert.equal(result.action, 'skipped-user');
});

test('honors skipPrompt option', async (t) => {
  withTempHome(t);
  const prev = process.env.SOGNI_API_KEY;
  delete process.env.SOGNI_API_KEY;
  t.after(() => { if (prev !== undefined) process.env.SOGNI_API_KEY = prev; });
  const result = await ensureCredentials({ skipPrompt: true });
  assert.equal(result.action, 'skipped-flag');
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/credentials.test.mjs
```

- [ ] **Step 3: Write implementation**

`src/credentials.mjs`:
```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import prompts from 'prompts';

function credentialsPath() {
  return join(homedir(), '.config', 'sogni', 'credentials');
}

function existingKeyInFile() {
  const p = credentialsPath();
  if (!existsSync(p)) return false;
  return /^SOGNI_API_KEY=/m.test(readFileSync(p, 'utf8'));
}

export async function ensureCredentials({ skipPrompt = false } = {}) {
  if (skipPrompt) return { action: 'skipped-flag' };
  if (process.env.SOGNI_API_KEY) return { action: 'skipped-env' };
  if (existingKeyInFile()) return { action: 'skipped-file', path: credentialsPath() };

  const { key } = await prompts({
    type: 'password',
    name: 'key',
    message: 'Sogni API key (get one at https://dashboard.sogni.ai). Leave blank to skip.',
  });

  if (!key) return { action: 'skipped-user' };

  const path = credentialsPath();
  mkdirSync(join(homedir(), '.config', 'sogni'), { recursive: true });
  writeFileSync(path, `SOGNI_API_KEY=${key}\n`, { mode: 0o600 });
  return { action: 'written', path };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/credentials.test.mjs
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/credentials.mjs test/credentials.test.mjs
git commit -m "feat: credentials prompt & ~/.config/sogni/credentials writer"
```

---

## Task 11: CLI installer (`src/install-cli.mjs`)

**Files:**
- Create: `src/install-cli.mjs`

This is a thin wrapper over `npm install -g`. Tests run only via integration test (Task 14) because hitting the real registry is slow; the `INSTALL_CLI=skip` env var bypasses it.

- [ ] **Step 1: Write the implementation directly (no unit test — covered by integration)**

`src/install-cli.mjs`:
```js
import { spawnSync } from 'node:child_process';

const PKG = '@sogni-ai/sogni-creative-agent-skill';

export function installCli({ version = 'latest' } = {}) {
  if (process.env.INSTALL_CLI === 'skip') {
    return { skipped: true, reason: 'INSTALL_CLI=skip' };
  }
  const spec = `${PKG}@${version}`;
  const r = spawnSync('npm', ['install', '-g', spec], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    if (r.error?.code === 'ENOENT') {
      throw new Error('npm not found on PATH. Install Node.js from https://nodejs.org and re-run.');
    }
    throw new Error(`npm install -g ${spec} failed with exit code ${r.status}. If this is EACCES, see https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally`);
  }
  return { skipped: false, spec };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/install-cli.mjs
git commit -m "feat: global CLI installer wrapper"
```

---

## Task 12: Summary printer (`src/summary.mjs`)

**Files:**
- Create: `src/summary.mjs`

Pure formatter. Inline coverage via integration test (Task 14) keeps the surface area honest; a unit test here would just test string concat.

- [ ] **Step 1: Write the implementation**

`src/summary.mjs`:
```js
import kleur from 'kleur';

const STATUS_ICONS = {
  installed: kleur.green('→ installed'),
  upgraded: kleur.green('→ upgraded'),
  'up-to-date': kleur.gray('→ up-to-date'),
  'would-install': kleur.cyan('→ would install (dry-run)'),
  'would-print': kleur.cyan('→ would print (dry-run)'),
  instructions: kleur.cyan('→ instructions printed'),
  skipped: kleur.gray('→ skipped'),
  failed: kleur.red('→ failed'),
  removed: kleur.yellow('→ removed'),
};

export function printSummary({ adapterResults, cli, credentials }) {
  console.log('');
  console.log(kleur.bold('Done.'));
  for (const r of adapterResults) {
    const status = STATUS_ICONS[r.status] ?? r.status;
    const ver = r.previousVersion
      ? `${r.previousVersion} → ${r.version}`
      : r.version
        ? ` ${r.version}`
        : '';
    const path = r.target ?? '';
    console.log(`  ${r.label.padEnd(16)} ${path.padEnd(60)} ${status}${ver ? ' ' + ver : ''}`);
  }
  if (cli) {
    const status = cli.skipped ? STATUS_ICONS.skipped : STATUS_ICONS.installed;
    console.log(`  ${'CLI'.padEnd(16)} ${(cli.spec ?? '(skipped)').padEnd(60)} ${status}`);
  }
  if (credentials) {
    const map = {
      written: kleur.green('saved to ' + credentials.path),
      'skipped-env': kleur.gray('using SOGNI_API_KEY env'),
      'skipped-file': kleur.gray('already configured'),
      'skipped-user': kleur.yellow('skipped — set later via ~/.config/sogni/credentials'),
      'skipped-flag': kleur.gray('skipped (--no-credentials)'),
    };
    console.log(`  ${'API key'.padEnd(16)} ${''.padEnd(60)} ${map[credentials.action] ?? credentials.action}`);
  }
  console.log('');
  console.log('Next steps:');
  console.log('  - Try it: sogni-agent --version');
  console.log('  - Ask your agent: "Generate an image of a sunset over mountains"');
  console.log('  - Docs: https://github.com/Sogni-AI/sogni-creative-agent-skill');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/summary.mjs
git commit -m "feat: summary printer"
```

---

## Task 13: Main orchestrator (`src/run.mjs`)

**Files:**
- Create: `src/run.mjs`

Wires everything together. Integration-tested in Task 14.

- [ ] **Step 1: Write the implementation**

`src/run.mjs`:
```js
import kleur from 'kleur';
import prompts from 'prompts';
import claudeCode from './adapters/claude-code.mjs';
import codexCli from './adapters/codex-cli.mjs';
import hermes from './adapters/hermes.mjs';
import chatgptWeb from './adapters/chatgpt-web.mjs';
import { detectAll } from './detect.mjs';
import { installCli } from './install-cli.mjs';
import { resolveSkillSource } from './resolve-skill.mjs';
import { ensureCredentials } from './credentials.mjs';
import { printSummary } from './summary.mjs';

const ADAPTERS = {
  'claude-code': { adapter: claudeCode, label: 'Claude Code', shortKey: 'claude' },
  'codex-cli': { adapter: codexCli, label: 'OpenAI Codex CLI', shortKey: 'codex' },
  'hermes': { adapter: hermes, label: 'Hermes Agent', shortKey: 'hermes' },
  'chatgpt-web': { adapter: chatgptWeb, label: 'ChatGPT (web)', shortKey: 'chatgpt' },
};

function filterByFlags(detections, { only, exclude }) {
  return detections.filter(d => {
    const key = ADAPTERS[d.runtime].shortKey;
    if (only && !only.includes(key)) return false;
    if (exclude && exclude.includes(key)) return false;
    return true;
  });
}

function printDetectionTable(filtered, version) {
  console.log('');
  console.log(kleur.bold('Detected runtimes:'));
  for (const d of filtered) {
    const meta = ADAPTERS[d.runtime];
    const path = d.path ?? 'manual setup';
    const state = d.runtime === 'chatgpt-web'
      ? 'instructions will be printed'
      : d.status === 'not-found'
        ? kleur.gray('not found')
        : d.installedVersion
          ? d.installedVersion === version
            ? kleur.gray(`v${d.installedVersion} — up-to-date, will re-verify`)
            : kleur.yellow(`v${d.installedVersion} → ${version}`)
          : kleur.green('(no skill installed)');
    const icon = d.runtime === 'chatgpt-web' ? 'ⓘ' : d.status === 'not-found' ? '✗' : '✓';
    console.log(`  ${icon} ${meta.label.padEnd(20)} ${path.padEnd(35)} ${state}`);
  }
  console.log('');
}

async function confirm(message, { defaultYes = true } = {}) {
  const { ok } = await prompts({
    type: 'confirm',
    name: 'ok',
    message,
    initial: defaultYes,
  });
  return ok === true;
}

export async function run(flags) {
  if (flags.uninstall) {
    return runUninstall(flags);
  }

  // 1. Install the global CLI (writes nothing else yet).
  console.log(kleur.bold(`Installing @sogni-ai/sogni-creative-agent-skill@${flags.version} globally...`));
  const cli = installCli({ version: flags.version });

  // 2. Resolve skill source on disk.
  const skill = resolveSkillSource();

  // 3. Detect runtimes and filter.
  const all = detectAll();
  const filtered = filterByFlags(all, flags);
  const installable = filtered.filter(d => d.status === 'available');

  printDetectionTable(filtered, skill.version);

  if (flags.dryRun) {
    console.log(kleur.cyan('Dry run — nothing will be written.'));
    return { cli, adapterResults: [], credentials: null, exitCode: 0 };
  }

  if (installable.length === 0) {
    console.log(kleur.yellow('No agent runtimes found. CLI still installed; ChatGPT instructions will print.'));
  } else if (!flags.yes) {
    const targets = installable.map(d => ADAPTERS[d.runtime].label).join(', ');
    if (!(await confirm(`Install / upgrade Sogni Creative Agent Skill into ${targets}?`))) {
      console.log('Aborted.');
      return { cli, adapterResults: [], credentials: null, exitCode: 1 };
    }
  }

  // 4. Run adapters.
  const adapterResults = [];
  let failures = 0;
  for (const d of filtered) {
    const meta = ADAPTERS[d.runtime];
    try {
      const opts = {
        srcDir: skill.srcDir,
        version: skill.version,
        dryRun: false,
      };
      if (d.runtime === 'hermes') opts.category = flags.hermesCategory;
      if (d.runtime === 'chatgpt-web') opts.outputBundle = flags.outputChatgptBundle;
      const r = meta.adapter.install(opts);
      if (d.runtime === 'chatgpt-web') {
        console.log('');
        console.log(r.instructions);
      }
      adapterResults.push({
        runtime: d.runtime,
        label: meta.label,
        status: r.status,
        version: skill.version,
        previousVersion: r.previousVersion ?? null,
        target: d.runtime === 'chatgpt-web' ? '' : (meta.adapter.detect().path ?? ''),
        notes: r.notes,
      });
    } catch (err) {
      failures += 1;
      adapterResults.push({
        runtime: d.runtime,
        label: meta.label,
        status: 'failed',
        target: '',
        notes: [err.message],
      });
    }
  }

  // 5. Credentials.
  const credentials = await ensureCredentials({ skipPrompt: flags.noCredentials });

  // 6. Summary.
  printSummary({ adapterResults, cli, credentials });

  return { cli, adapterResults, credentials, exitCode: failures > 0 ? failures : 0 };
}

async function runUninstall(flags) {
  const all = detectAll();
  const filtered = filterByFlags(all, flags);
  const results = [];
  for (const d of filtered) {
    const meta = ADAPTERS[d.runtime];
    const r = meta.adapter.uninstall();
    results.push({
      runtime: d.runtime,
      label: meta.label,
      status: r.removed.length > 0 ? 'removed' : 'skipped',
      target: r.removed[0] ?? '',
    });
  }
  if (flags.removeCli) {
    console.log('Removing global CLI...');
    const { spawnSync } = await import('node:child_process');
    spawnSync('npm', ['uninstall', '-g', '@sogni-ai/sogni-creative-agent-skill'], { stdio: 'inherit' });
  }
  printSummary({ adapterResults: results, cli: null, credentials: null });
  return { exitCode: 0 };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/run.mjs
git commit -m "feat: main orchestrator wiring detect → cli → adapters → credentials → summary"
```

---

## Task 14: bin entry (`bin/setup.mjs`)

**Files:**
- Create: `bin/setup.mjs`

- [ ] **Step 1: Write the implementation**

`bin/setup.mjs`:
```js
#!/usr/bin/env node
import { parseFlags } from '../src/flags.mjs';
import { run } from '../src/run.mjs';

const HELP = `setup-sogni-agent-skill — install Sogni Creative Agent Skill into your agent runtimes

Usage:
  npx setup-sogni-agent-skill [options]

Options:
  --yes, -y                       Skip confirmation prompts
  --dry-run                       Detect + print plan, do not write
  --only=claude,codex,hermes,chatgpt
                                  Restrict to listed runtimes
  --exclude=chatgpt               Exclude listed runtimes
  --version=X.Y.Z                 Pin the skill package version (default: latest)
  --hermes-category=NAME          Hermes category directory (default: media)
  --symlink                       (Unix) Symlink rather than copy where supported
  --no-credentials                Skip the API key prompt
  --output-chatgpt-bundle=PATH    Also write Custom-GPT instructions to a file
  --uninstall                     Remove previously installed skill files
  --remove-cli                    With --uninstall, also npm uninstall -g
  --help, -h                      Show this help

Docs: https://github.com/Sogni-AI/sogni-creative-agent-skill
`;

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

let flags;
try {
  flags = parseFlags(argv);
} catch (err) {
  console.error(err.message);
  console.error('Run with --help for usage.');
  process.exit(2);
}

try {
  const { exitCode } = await run(flags);
  process.exit(exitCode);
} catch (err) {
  console.error('setup-sogni-agent-skill failed:', err.message);
  process.exit(1);
}
```

- [ ] **Step 2: Make executable**

```bash
chmod +x bin/setup.mjs
```

- [ ] **Step 3: Smoke-test the help output**

```bash
node bin/setup.mjs --help
```

Expected: prints the HELP block, exits 0.

- [ ] **Step 4: Smoke-test bad flag handling**

```bash
node bin/setup.mjs --bogus
echo "exit: $?"
```

Expected: prints "Unknown flag: --bogus" and "Run with --help for usage.", exit code 2.

- [ ] **Step 5: Commit**

```bash
git add bin/setup.mjs
git commit -m "feat: bin/setup.mjs CLI entry"
```

---

## Task 15: Integration test (`test/setup.integration.mjs`)

**Files:**
- Create: `test/setup.integration.mjs`

End-to-end: spawns `bin/setup.mjs` with `--dry-run --yes` against a fake `$HOME` and asserts the detection table prints and nothing gets written.

- [ ] **Step 1: Write the test**

`test/setup.integration.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeFakeNpmRoot() {
  const root = mkdtempSync(join(tmpdir(), 'sogni-int-npm-'));
  const pkgDir = join(root, '@sogni-ai/sogni-creative-agent-skill');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'SKILL.md'), '# integration fixture\n');
  writeFileSync(join(pkgDir, 'llm.txt'), 'integration fixture\n');
  writeFileSync(join(pkgDir, 'version.mjs'), `export const VERSION = '2.3.0';\n`);
  writeFileSync(join(pkgDir, 'skill-package.json'), '{}\n');
  writeFileSync(join(pkgDir, 'env.mjs'), '\n');
  writeFileSync(join(pkgDir, 'ssrf-guard.mjs'), '\n');
  writeFileSync(join(pkgDir, 'sogni-agent.mjs'), '\n');
  writeFileSync(join(pkgDir, 'openclaw-plugin.mjs'), '\n');
  writeFileSync(join(pkgDir, 'openclaw.plugin.json'), '{}\n');
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: '2.3.0' }));
  mkdirSync(join(pkgDir, 'scripts'), { recursive: true });
  mkdirSync(join(pkgDir, 'generated'), { recursive: true });
  writeFileSync(join(pkgDir, 'scripts/check-creative-agent-runtime.mjs'), '\n');
  writeFileSync(join(pkgDir, 'generated/creative-agent-runtime.mjs'), '\n');
  return root;
}

test('--dry-run prints detection table and writes nothing', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'sogni-int-home-'));
  mkdirSync(join(home, '.claude'));
  mkdirSync(join(home, '.codex'));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const npmRoot = makeFakeNpmRoot();
  t.after(() => rmSync(npmRoot, { recursive: true, force: true }));

  const r = spawnSync(process.execPath, ['bin/setup.mjs', '--dry-run', '--yes', '--no-credentials'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      INSTALL_CLI: 'skip',
      NPM_CONFIG_PREFIX: npmRoot.replace(/\/lib\/?$/, ''),
      SOGNI_TEST_NPM_ROOT: npmRoot, // hint for resolve-skill; see Step 2
    },
    encoding: 'utf8',
  });

  if (r.status !== 0) {
    throw new Error(`exit ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  }

  assert.match(r.stdout, /Detected runtimes:/);
  assert.match(r.stdout, /Claude Code/);
  assert.match(r.stdout, /OpenAI Codex CLI/);
  assert.match(r.stdout, /Dry run/);
  // Nothing written
  assert.equal(existsSync(join(home, '.claude/skills/sogni-creative-agent-skill')), false);
  assert.equal(existsSync(join(home, '.codex/skills/sogni-creative-agent-skill')), false);
});
```

- [ ] **Step 2: Update `src/resolve-skill.mjs` to honor the test hint**

Edit `src/resolve-skill.mjs` `resolveSkillSource` body — replace the first line:
```js
const root = npmRoot ?? execSync('npm root -g', { encoding: 'utf8' }).trim();
```
with:
```js
const root = npmRoot ?? process.env.SOGNI_TEST_NPM_ROOT ?? execSync('npm root -g', { encoding: 'utf8' }).trim();
```

This keeps production behavior unchanged but lets the integration test point to a fake npm root.

- [ ] **Step 3: Run the integration test**

```bash
node --test test/setup.integration.mjs
```

Expected: 1 test passes.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all unit tests and the integration test pass.

- [ ] **Step 5: Commit**

```bash
git add test/setup.integration.mjs src/resolve-skill.mjs
git commit -m "test: end-to-end integration test with --dry-run"
```

---

## Task 16: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# setup-sogni-agent-skill

One-command installer for the [Sogni Creative Agent Skill](https://github.com/Sogni-AI/sogni-creative-agent-skill).

```bash
npx setup-sogni-agent-skill
```

Detects which agent runtimes you have installed, installs the `sogni-agent`
CLI globally, registers `SKILL.md` into each detected runtime, and prompts
for your Sogni API key.

## Supports

- **Claude Code** — installs into `~/.claude/skills/sogni-creative-agent-skill/`
- **OpenAI Codex CLI** — installs into `~/.codex/skills/sogni-creative-agent-skill/`
- **Hermes Agent** — installs into `~/.hermes/skills/<category>/sogni-creative-agent-skill/`
- **ChatGPT (web)** — prints Custom GPT instructions for copy-paste

## Usage

```bash
# Interactive (default)
npx setup-sogni-agent-skill

# Non-interactive (CI)
npx setup-sogni-agent-skill --yes --no-credentials

# Restrict to specific runtimes
npx setup-sogni-agent-skill --only=claude,codex

# Dry run
npx setup-sogni-agent-skill --dry-run

# Pin a specific skill version
npx setup-sogni-agent-skill --version=2.3.0

# Uninstall
npx setup-sogni-agent-skill --uninstall
npx setup-sogni-agent-skill --uninstall --remove-cli   # also remove the global CLI
```

Run `npx setup-sogni-agent-skill --help` for the full flag list.

## Requirements

- Node.js ≥ 22
- `npm` on `$PATH`
- A [Sogni API key](https://dashboard.sogni.ai)

## How it works

1. Runs `npm install -g @sogni-ai/sogni-creative-agent-skill@latest`.
2. Resolves the global install path via `npm root -g`.
3. Detects `~/.claude/`, `~/.codex/`, `~/.hermes/`; treats ChatGPT (web) as always available (manual setup).
4. For each runtime, dispatches to a per-runtime adapter that knows that runtime's directory convention.
5. Writes a marker file (`.sogni-installed.json`) so re-runs upgrade in place.
6. Prompts for your Sogni API key (unless `SOGNI_API_KEY` is set or `~/.config/sogni/credentials` already exists).

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README"
```

---

## Task 17: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    env:
      INSTALL_CLI: skip
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: GitHub Actions matrix (ubuntu/macos/windows, node 22)"
```

---

## Task 18: Publish prep & manual smoke checklist

This task does not produce more code — it's the release-readiness verification you run once before `npm publish`.

- [ ] **Step 1: Run the full test suite one more time**

```bash
cd ~/Documents/git/sogni/setup-sogni-agent-skill
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Verify the package builds clean for publish**

```bash
npm pack --dry-run
```

Expected: tarball lists only `bin/`, `src/`, `README.md`, `LICENSE`, `package.json` (no `test/`, no `.github/`, no `node_modules/`).

- [ ] **Step 3: Verify `npx` invocation works from the local pack**

```bash
npm pack
npx ./setup-sogni-agent-skill-0.1.0.tgz --help
```

Expected: prints the HELP output.

- [ ] **Step 4: Manual smoke against the real machine (no destructive flags)**

```bash
npx ./setup-sogni-agent-skill-0.1.0.tgz --dry-run
```

Expected: detection table shows your real `~/.claude/`, `~/.codex/`, `~/.hermes/`. Nothing is written.

- [ ] **Step 5: Manual smoke: real install on a throwaway HOME**

```bash
mkdir -p /tmp/sogni-smoke-home/.claude /tmp/sogni-smoke-home/.codex /tmp/sogni-smoke-home/.hermes
HOME=/tmp/sogni-smoke-home INSTALL_CLI=skip SOGNI_TEST_NPM_ROOT=$(npm root -g) \
  npx ./setup-sogni-agent-skill-0.1.0.tgz --yes --no-credentials
ls -la /tmp/sogni-smoke-home/.claude/skills/sogni-creative-agent-skill/
ls -la /tmp/sogni-smoke-home/.codex/skills/sogni-creative-agent-skill/
ls -la /tmp/sogni-smoke-home/.hermes/skills/media/sogni-creative-agent-skill/
```

Expected: SKILL.md present in each location, marker file `.sogni-installed.json` present, Hermes SKILL.md has `0o600` perms.

- [ ] **Step 6: Verify uninstall flow on the same throwaway HOME**

```bash
HOME=/tmp/sogni-smoke-home INSTALL_CLI=skip \
  npx ./setup-sogni-agent-skill-0.1.0.tgz --uninstall --yes
ls /tmp/sogni-smoke-home/.claude/skills/ 2>&1 || echo "removed"
```

Expected: skill directories are gone; global CLI untouched (no `--remove-cli`).

- [ ] **Step 7: Cleanup smoke artifacts**

```bash
rm -rf /tmp/sogni-smoke-home setup-sogni-agent-skill-0.1.0.tgz
```

- [ ] **Step 8: Create the GitHub repo & push**

> **Confirm with user before running this step.** Pushing creates a public repo.

```bash
gh repo create Sogni-AI/setup-sogni-agent-skill --public --source=. --remote=origin --description "One-command installer for the Sogni Creative Agent Skill"
git push -u origin main
```

- [ ] **Step 9: Publish to npm**

> **Confirm with user before running this step.** Publishing is irreversible (within the version).

```bash
npm publish --access=public
```

Expected: package available at https://www.npmjs.com/package/setup-sogni-agent-skill.

- [ ] **Step 10: Verify the public command works**

```bash
npx setup-sogni-agent-skill@latest --help
```

Expected: prints HELP. (Network test — `npx` fetches the just-published package.)

- [ ] **Step 11: Update the main skill repo's README to advertise the installer**

Edit `~/Documents/git/sogni/sogni-creative-agent-skill/README.md`. Add this block near the top of the **Quick Start** section, replacing or augmenting step 2:

```markdown
2. Install (one command):

   ```bash
   npx setup-sogni-agent-skill
   ```

   This auto-detects Claude Code, Codex CLI, and Hermes; installs the CLI globally;
   registers the skill into each runtime; and prompts for your API key.
```

- [ ] **Step 12: Commit & PR the README update on the main skill repo**

```bash
cd ~/Documents/git/sogni/sogni-creative-agent-skill
git checkout -b docs/advertise-installer
git add README.md
git commit -m "docs: advertise npx setup-sogni-agent-skill installer"
git push -u origin docs/advertise-installer
gh pr create --title "docs: advertise npx setup-sogni-agent-skill installer" --body "Adds a one-command install path to the README, pointing at the new \`setup-sogni-agent-skill\` package."
```

---

## Self-review

**Spec coverage check** — every spec section maps to tasks:

| Spec section | Implemented by |
|---|---|
| Package layout | Task 0 |
| CLI contract (all flags) | Tasks 2, 14 |
| Runtime detection | Task 3 |
| Adapter interface | Tasks 4–9 |
| Claude Code adapter | Task 6 |
| Codex CLI adapter | Task 7 |
| Hermes adapter (categories, backup, 0o600) | Task 8 |
| ChatGPT web adapter | Task 9 |
| API key flow | Task 10 |
| CLI install (`npm install -g`) | Task 11 |
| Error handling & EACCES | Task 11 |
| Summary table | Task 12 |
| Idempotency / upgrade flow | Tasks 6, 7, 8 (tests) |
| Uninstall | Tasks 6, 7, 8, 13 |
| Marker file convention | Task 4 |
| Cross-platform testing | Task 17 |
| Manual smoke checklist | Task 18 |
| README update on main repo | Task 18 |

**Placeholder scan** — none. All steps contain runnable code or commands.

**Type consistency** — adapter `install({ srcDir, version, dryRun, category?, outputBundle? })` and return shape `{ status, written, notes, previousVersion? }` used identically across Tasks 6–9 and consumed identically in Task 13. Marker file shape `{ version, adapter, srcDir, installedAt }` set in Task 4 and read in Task 3 detection.

**Out-of-scope, deferred to v1.1** (matches spec § "Out of scope"):
- `--validate-key` (live API ping)
- Project-level Claude Code install
- `--list` flag
- Telemetry
- Auto-upgrade cron

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-setup-sogni-agent-skill-installer.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
