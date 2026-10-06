#!/usr/bin/env node
// Publish a released version to ClawHub as a skill-only bundle.
//
// ClawHub is a release surface like npm: every version published to npm goes
// to ClawHub too (CONTRIBUTING.md, release step 8). This script stages the
// files of the release tag (never the working tree), checks that every
// relative import in the staged runtime resolves inside the stage, and runs
// `clawhub publish`. It refuses a version that npm or the tag does not have
// or that is older than ClawHub's latest, and does nothing when ClawHub
// already lists the version.
//
//   npm run publish:clawhub                     # the version in package.json
//   npm run publish:clawhub -- --version 3.54.2 --changelog "..."
//   npm run publish:clawhub -- --dry-run        # stage and preview only
//   npm run check:clawhub                       # exit 1 when ClawHub lags npm

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NPM_PACKAGE = '@sogni-ai/sogni-creative-agent-skill';
// The sogni-ai org publisher; its members can publish. Mark's ClawHub account
// (fishmongr) owns it. Through 3.54.2 the listing was @fishmongr, which
// ClawHub no longer resolves.
const CLAWHUB_OWNER = 'sogni-ai';
const CLAWHUB_SLUG = 'sogni-creative-agent-skill';
const CLAWHUB_NAME = 'Sogni Creative Agent Skill';
// The ClawHub CLI is an exact devDependency (see package.json); run that copy,
// never `npx clawhub@latest`, which runs whatever was last published.
const CLAWHUB_BIN = join(repoRoot, 'node_modules', '.bin', 'clawhub');
const CLAWHUB_REF = `@${CLAWHUB_OWNER}/${CLAWHUB_SLUG}`;

// Skill documents and directories copied as they are.
const BUNDLE_PATHS = [
  'SKILL.md',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'llm.txt',
  'skill-package.json',
  'references',
  'skills',
  'generated',
  'host-launchers',
];
// The CLI entry point; its relative imports are followed and staged too.
const RUNTIME_ENTRY = 'sogni-agent.mjs';
// Any of these makes ClawHub classify the upload as a code plugin, which needs
// a scoped name and extra openclaw.compat/openclaw.build manifest fields.
const FORBIDDEN = ['package.json', 'openclaw.plugin.json', 'openclaw-plugin.mjs'];

function fail(message) {
  console.error(`publish-clawhub: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dryRun: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--version' || arg === '--changelog') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) fail(`${arg} needs a value`);
      opts[arg.slice(2)] = value;
      i += 1;
    } else fail(`unknown argument ${arg}`);
  }
  return opts;
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function clawhub(args, options = {}) {
  return run(CLAWHUB_BIN, args, options);
}

function clawhubState() {
  let out;
  try {
    out = clawhub(['inspect', CLAWHUB_REF, '--versions', '--limit', '200', '--json']);
  } catch (error) {
    fail(`clawhub inspect ${CLAWHUB_REF} failed: ${String(error.stderr ?? error.message).trim()}`);
  }
  const data = JSON.parse(out.slice(out.indexOf('{')));
  const versions = (data.versions?.items ?? data.versions ?? []).map((entry) => entry.version);
  return { latest: data.skill?.tags?.latest ?? null, versions, moderation: data.moderation ?? null };
}

function npmLatest() {
  return run('npm', ['view', NPM_PACKAGE, 'dist-tags.latest']).trim();
}

function checkDrift() {
  const npm = npmLatest();
  const { latest } = clawhubState();
  if (npm === latest) {
    console.log(`ClawHub ${CLAWHUB_REF} matches npm: ${npm}`);
    return;
  }
  fail(
    `ClawHub ${CLAWHUB_REF} is at ${latest}, npm latest is ${npm}. If ${npm} was uploaded in the last hour, `
      + `it is still in ClawHub's security scans; otherwise run npm run publish:clawhub -- --version ${npm}`,
  );
}

// Relative specifiers from static imports, side-effect imports and dynamic
// import() calls with a string literal.
function relativeImports(source) {
  const found = new Set();
  const patterns = [
    /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// The first sentence of each top-level bullet in every CHANGELOG.md section
// from `version` back to (not including) `sinceVersion`, the version ClawHub
// already has, so a skipped npm release still reaches the ClawHub changelog.
function changelogSummary(changelog, version, sinceVersion) {
  const sections = changelog.split(/^(?=## \[)/m).filter((part) => part.startsWith('## ['));
  const first = sections.findIndex((part) => part.startsWith(`## [${version}]`));
  if (first === -1) fail(`CHANGELOG.md at v${version} has no "## [${version}]" section; pass --changelog`);
  const parts = [];
  for (const section of sections.slice(first)) {
    const sectionVersion = section.slice(4, section.indexOf(']'));
    if (sinceVersion && compareVersions(sectionVersion, sinceVersion) <= 0) break;
    const sentences = section
      .split('\n')
      .filter((line) => line.startsWith('* '))
      .map((line) => line.slice(2).replaceAll('**', '').trim())
      .map((text) => text.split(/(?<=[.!?])\s+(?=[A-Z0-9`(])/)[0]);
    if (sentences.length > 0) parts.push(`${sectionVersion}: ${sentences.join(' ')}`);
  }
  if (parts.length === 0) fail(`CHANGELOG.md section for ${version} has no bullets; pass --changelog`);
  return parts.join(' ');
}

function stageRelease(tag) {
  const workDir = mkdtempSync(join(tmpdir(), 'sogni-skill-clawhub-'));
  const treeDir = join(workDir, 'tree');
  const stageDir = join(workDir, CLAWHUB_SLUG);
  mkdirSync(treeDir);
  mkdirSync(stageDir);
  const archive = spawnSync('git', ['archive', '--format=tar', tag], { cwd: repoRoot, maxBuffer: 1 << 30 });
  if (archive.status !== 0) fail(`git archive ${tag} failed: ${archive.stderr}`);
  const untar = spawnSync('tar', ['-x', '-C', treeDir], { input: archive.stdout });
  if (untar.status !== 0) fail(`extracting ${tag} failed: ${untar.stderr}`);

  for (const path of BUNDLE_PATHS) {
    const from = join(treeDir, path);
    if (!existsSync(from)) fail(`${tag} has no ${path}`);
    cpSync(from, join(stageDir, path), { recursive: true });
  }

  // Follow relative imports from the entry point and every staged module.
  const pending = [RUNTIME_ENTRY, ...listFiles(stageDir).map((file) => relative(stageDir, file))]
    .filter((path) => path.endsWith('.mjs'));
  const seen = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const from = join(treeDir, path);
    if (!existsSync(from)) fail(`${tag} has no ${path}`);
    if (!existsSync(join(stageDir, path))) cpSync(from, join(stageDir, path));
    for (const specifier of relativeImports(readFileSync(from, 'utf8'))) {
      const target = relative(treeDir, resolve(dirname(from), specifier));
      if (target.startsWith('..')) fail(`${path} imports ${specifier}, which is outside the skill`);
      if (!existsSync(join(treeDir, target))) fail(`${path} imports ${specifier}, which ${tag} does not have`);
      pending.push(target);
    }
  }

  const staged = listFiles(stageDir).map((file) => relative(stageDir, file)).sort();
  const forbidden = staged.filter((path) => FORBIDDEN.includes(path));
  if (forbidden.length > 0) fail(`staged bundle contains ${forbidden.join(', ')}`);
  return { workDir, stageDir, treeDir, staged };
}

const opts = parseArgs(process.argv.slice(2));
if (opts.check) {
  checkDrift();
  process.exit(0);
}

const version = opts.version ?? JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
const tag = `v${version}`;
try {
  run('git', ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`]);
} catch {
  fail(`tag ${tag} does not exist here. Publish to npm and push the tag first (CONTRIBUTING.md steps 5-6), then git fetch --tags.`);
}
let npmVersion = '';
try {
  npmVersion = run('npm', ['view', `${NPM_PACKAGE}@${version}`, 'version']).trim();
} catch {
  // npm view exits non-zero for an unknown version.
}
if (npmVersion !== version) fail(`${NPM_PACKAGE}@${version} is not on npm. ClawHub gets only versions npm already has.`);

let login = '';
try {
  login = clawhub(['whoami']).trim().split('\n').pop();
} catch (error) {
  fail(`not logged in to ClawHub (${String(error.stderr ?? error.message).trim()}). Run npx --no-install clawhub login with a member of @${CLAWHUB_OWNER}.`);
}

const before = clawhubState();
if (before.versions.includes(version)) {
  console.log(`ClawHub ${CLAWHUB_REF} already has ${version} (latest ${before.latest}). Nothing to publish.`);
  process.exit(0);
}
if (before.latest && compareVersions(version, before.latest) < 0) {
  fail(`ClawHub's latest is ${before.latest}; publishing the older ${version} would move latest back to it.`);
}

const { workDir, stageDir, treeDir, staged } = stageRelease(tag);
const changelog = opts.changelog
  ?? changelogSummary(readFileSync(join(treeDir, 'CHANGELOG.md'), 'utf8'), version, before.latest);
console.log(`Staged ${staged.length} files from ${tag} in ${stageDir}`);
console.log(`Publishing ${CLAWHUB_REF}@${version} as ${login}, replacing latest ${before.latest}`);
console.log(`Changelog: ${changelog}`);

const publishArgs = [
  'publish', stageDir,
  '--owner', CLAWHUB_OWNER,
  '--slug', CLAWHUB_SLUG,
  '--name', CLAWHUB_NAME,
  '--version', version,
  '--changelog', changelog,
];
if (opts.dryRun) {
  const result = spawnSync(CLAWHUB_BIN, [...publishArgs, '--dry-run'], { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) fail(`clawhub publish --dry-run exited ${result.status}; the staged files are in ${stageDir}`);
  console.log(`Dry run only. The staged files are in ${stageDir}`);
  process.exit(0);
}
const result = spawnSync(CLAWHUB_BIN, [...publishArgs, '--json'], {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (result.status !== 0) {
  fail(`clawhub publish exited ${result.status}. Publishing needs a member of @${CLAWHUB_OWNER}. The staged files are in ${stageDir}`);
}
rmSync(workDir, { recursive: true, force: true });
const published = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));

// ClawHub hides a new version until its security scans pass (minutes, as of
// 2026-09); the inspect API does not show it before then.
if (published.publicationStatus === 'pending') {
  console.log(`ClawHub accepted ${version} and is running its security scans. It stays hidden until they pass.`);
  console.log(`Do not publish ${version} again. npm run check:clawhub confirms when ClawHub's latest is ${version}.`);
  process.exit(0);
}
const after = clawhubState();
if (!after.versions.includes(version)) {
  fail(`clawhub publish reported ${published.publicationStatus ?? 'no status'}, but ClawHub does not list ${version}.`);
}
console.log(`ClawHub ${CLAWHUB_REF} lists ${version}; latest ${after.latest}; scan verdict ${after.moderation?.verdict ?? 'unknown'}.`);
