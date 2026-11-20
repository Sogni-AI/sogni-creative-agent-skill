import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { claimSogniAppIdSlot, getOrCreateSogniAppId } from '../sogni-app-id.mjs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

/** Run fn with fs.linkSync refusing as a filesystem without hard links does. */
function withoutHardLinks(code, fn) {
  const original = fs.linkSync;
  fs.linkSync = () => { const error = new Error(`${code}: operation not supported, link`); error.code = code; throw error; };
  syncBuiltinESMExports();
  try { return fn(); } finally { fs.linkSync = original; syncBuiltinESMExports(); }
}

test('creates one private app ID and reuses it across calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-'));
  const appIdPath = join(dir, 'nested', 'app-id');
  let generated = 0;
  const generateUuid = () => `install-id-${++generated}`;

  const first = getOrCreateSogniAppId({ appIdPath, generateUuid });
  const second = getOrCreateSogniAppId({ appIdPath, generateUuid });

  assert.equal(first, 'sogni-agent-install-id-1');
  assert.equal(second, first);
  assert.equal(generated, 1);
  assert.equal(readFileSync(appIdPath, 'utf8'), `${first}\n`);
  if (process.platform !== 'win32') {
    assert.equal(statSync(appIdPath).mode & 0o777, 0o600);
  }
});

test('SOGNI_APP_ID-style value override wins without touching the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-override-'));
  const appIdPath = join(dir, 'app-id');

  const result = getOrCreateSogniAppId({
    appId: '  fixed-deployment-id  ',
    appIdPath,
    generateUuid: () => {
      throw new Error('should not generate');
    },
  });

  assert.equal(result, 'fixed-deployment-id');
  assert.throws(() => readFileSync(appIdPath, 'utf8'), { code: 'ENOENT' });
});

test('overlapping first launches never expose an incomplete saved identity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-overlap-'));
  const appIdPath = join(dir, 'app-id');
  const blocked = join(dir, 'blocked');
  const release = join(dir, 'release');
  const moduleUrl = new URL('../sogni-app-id.mjs', import.meta.url).href;
  const childCode = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const [file, blocked, release, moduleUrl] = process.argv.slice(1);
    const write = fs.writeFileSync, open = fs.openSync;
    let held = false;
    function hold(path) {
      if (held || typeof path !== 'string' || !(path === file || path.startsWith(file + '.'))) return;
      held = true;
      write(blocked, 'ready');
      const deadline = Date.now() + 10000;
      while (!fs.existsSync(release)) {
        if (Date.now() > deadline) throw Error('Parent did not release the writer');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    fs.openSync = (path, ...args) => { const fd = open(path, ...args); hold(path); return fd; };
    fs.writeFileSync = (path, ...args) => { hold(path); return write(path, ...args); };
    syncBuiltinESMExports();
    const { getOrCreateSogniAppId } = await import(moduleUrl);
    console.log(getOrCreateSogniAppId({ appIdPath: file, generateUuid: () => 'first' }));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode, appIdPath, blocked, release, moduleUrl]);
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(blocked)) {
      assert.ok(Date.now() < deadline, 'first writer must reach the controlled overlap');
      await delay(5);
    }
    const second = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { getOrCreateSogniAppId } from ${JSON.stringify(moduleUrl)}; console.log(getOrCreateSogniAppId({appIdPath: process.argv[1], generateUuid: () => 'second'}));`,
      appIdPath], { encoding: 'utf8', timeout: 5000 });
    assert.equal(second.status, 0, second.stderr);
    writeFileSync(release, 'go');
    assert.equal(await ended, 0, stderr);
    assert.equal(stdout.trim(), second.stdout.trim());
    assert.equal(readFileSync(appIdPath, 'utf8').trim(), second.stdout.trim());
  } finally {
    writeFileSync(release, 'go');
    if (child.exitCode === null) child.kill();
    await ended;
  }
});

test('rejects a corrupt persisted app ID instead of silently rotating it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-corrupt-'));
  const appIdPath = join(dir, 'app-id');
  writeFileSync(appIdPath, '   \n');

  assert.throws(
    () => getOrCreateSogniAppId({ appIdPath }),
    (error) => error?.code === 'INVALID_APP_ID' && /empty/i.test(error.message),
  );
});

test('reports a stable-override remedy when the app ID cannot be persisted', () => {
  if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) return;
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-readonly-'));
  chmodSync(dir, 0o500);
  try {
    assert.throws(
      () => getOrCreateSogniAppId({ appIdPath: join(dir, 'app-id') }),
      (error) => error?.code === 'APP_ID_PERSISTENCE_FAILED' && /SOGNI_APP_ID/.test(error.hint),
    );
  } finally {
    chmodSync(dir, 0o700);
  }
});

// --- Pool mode (default when neither SOGNI_APP_ID nor SOGNI_APP_ID_PATH) ---

import { existsSync, mkdirSync } from 'node:fs';
import { getOrCreateSogniAppId as acquire, releaseSogniAppId, describeSogniAppIdPool } from '../sogni-app-id.mjs';

function poolOptions(dir, overrides = {}) {
  return {
    appId: '',
    appIdPath: '',
    poolDir: dir,
    legacyAppIdPath: join(dir, 'no-legacy'),
    generateUuid: overrides.generateUuid || (() => `pool-${Math.random().toString(16).slice(2)}`),
    ...overrides,
  };
}

test('pool: leases slot-0, reuses it within the process, releases on demand', () => {
  releaseSogniAppId();
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-pool-'));
  let generated = 0;
  const opts = poolOptions(dir, { generateUuid: () => `stable-${++generated}` });
  try {
    const first = acquire(opts);
    const second = acquire(opts);
    assert.equal(first, 'sogni-agent-stable-1');
    assert.equal(second, first);
    assert.equal(generated, 1);
    assert.equal(readFileSync(join(dir, 'slot-0'), 'utf8'), `${first}\n`);
    const lease = JSON.parse(readFileSync(join(dir, 'slot-0.lease'), 'utf8'));
    assert.equal(lease.pid, process.pid);
  } finally {
    releaseSogniAppId();
  }
  assert.equal(existsSync(join(dir, 'slot-0.lease')), false);
});

test('pool: a live foreign lease pushes the process to the next slot', () => {
  releaseSogniAppId();
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-pool-live-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slot-0'), 'sogni-agent-other-tool\n');
  writeFileSync(join(dir, 'slot-0.lease'), `${JSON.stringify({ pid: 99999, tool: 'hermes' })}\n`);
  try {
    const appId = acquire(poolOptions(dir, { isPidAlive: () => true, ownPid: 1234 }));
    assert.notEqual(appId, 'sogni-agent-other-tool');
    assert.equal(readFileSync(join(dir, 'slot-1'), 'utf8'), `${appId}\n`);
  } finally {
    releaseSogniAppId();
  }
});

test('pool: a dead-pid lease is reclaimed instead of minting a new ID', () => {
  releaseSogniAppId();
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-pool-stale-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slot-0'), 'sogni-agent-crashed-owner\n');
  writeFileSync(join(dir, 'slot-0.lease'), `${JSON.stringify({ pid: 99999 })}\n`);
  try {
    const appId = acquire(poolOptions(dir, {
      isPidAlive: () => false,
      generateUuid: () => { throw new Error('should reuse the reclaimed slot ID'); },
    }));
    assert.equal(appId, 'sogni-agent-crashed-owner');
    assert.equal(JSON.parse(readFileSync(join(dir, 'slot-0.lease'), 'utf8')).pid, process.pid);
  } finally {
    releaseSogniAppId();
  }
});

test('pool: a leftover lease naming our own pid is treated as stale', () => {
  releaseSogniAppId();
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-pool-ownpid-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slot-0'), 'sogni-agent-recycled\n');
  writeFileSync(join(dir, 'slot-0.lease'), `${JSON.stringify({ pid: process.pid })}\n`);
  try {
    const appId = acquire(poolOptions(dir, { isPidAlive: () => true }));
    assert.equal(appId, 'sogni-agent-recycled');
  } finally {
    releaseSogniAppId();
  }
});

test('pool: migrates the legacy single app-id file into slot-0 exactly once', () => {
  releaseSogniAppId();
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-pool-migrate-'));
  const legacyPath = join(dir, 'legacy-app-id');
  const poolDir = join(dir, 'app-ids');
  writeFileSync(legacyPath, 'sogni-agent-pre-pool-identity\n');
  try {
    const appId = acquire(poolOptions(poolDir, {
      legacyAppIdPath: legacyPath,
      generateUuid: () => { throw new Error('should migrate, not mint'); },
    }));
    assert.equal(appId, 'sogni-agent-pre-pool-identity');
    assert.equal(existsSync(legacyPath), false);
  } finally {
    releaseSogniAppId();
  }
});

test('pool: exhaustion fails with a raise-the-cap remedy', () => {
  releaseSogniAppId();
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-pool-full-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slot-0'), 'sogni-agent-busy\n');
  writeFileSync(join(dir, 'slot-0.lease'), `${JSON.stringify({ pid: 99999 })}\n`);
  assert.throws(
    () => acquire(poolOptions(dir, { poolMax: 1, isPidAlive: () => true, ownPid: 4321 })),
    (error) => error?.code === 'APP_ID_POOL_EXHAUSTED' && /SOGNI_APP_ID_POOL_MAX/.test(error.hint),
  );
});

test('pool: describeSogniAppIdPool reports slots and lease liveness', () => {
  releaseSogniAppId();
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-pool-describe-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slot-0'), 'sogni-agent-a\n');
  writeFileSync(join(dir, 'slot-1'), 'sogni-agent-b\n');
  writeFileSync(join(dir, 'slot-1.lease'), `${JSON.stringify({ pid: 99999, tool: 'codex' })}\n`);
  const view = describeSogniAppIdPool({ poolDir: dir, isPidAlive: () => true });
  assert.equal(view.slots.length, 2);
  assert.equal(view.slots[0].lease, null);
  assert.equal(view.slots[1].lease.tool, 'codex');
  assert.equal(view.slots[1].lease.live, true);
});

test('claimSogniAppIdSlot leases a free slot so a run can sign in as it, and releases it', () => {
  const poolDir = mkdtempSync(join(tmpdir(), 'sogni-app-id-claim-'));
  writeFileSync(join(poolDir, 'slot-3'), 'sogni-agent-earlier\n');

  const claim = claimSogniAppIdSlot('sogni-agent-earlier', { poolDir, ownPid: 4242, isPidAlive: () => true });
  assert.equal(claim.appId, 'sogni-agent-earlier');
  assert.equal(JSON.parse(readFileSync(join(poolDir, 'slot-3.lease'), 'utf8')).pid, 4242);
  // A second claimer sees it held by the live pid and must not connect as it.
  assert.deepEqual(claimSogniAppIdSlot('sogni-agent-earlier', { poolDir, ownPid: 5151, isPidAlive: () => true }), { heldByPid: 4242 });
  claim.release();
  assert.throws(() => readFileSync(join(poolDir, 'slot-3.lease'), 'utf8'), { code: 'ENOENT' });
});

test('claimSogniAppIdSlot reclaims a dead lease and ignores app IDs outside the pool', () => {
  const poolDir = mkdtempSync(join(tmpdir(), 'sogni-app-id-claim-stale-'));
  writeFileSync(join(poolDir, 'slot-0'), 'sogni-agent-earlier\n');
  writeFileSync(join(poolDir, 'slot-0.lease'), `${JSON.stringify({ pid: 999999 })}\n`);

  const claim = claimSogniAppIdSlot('sogni-agent-earlier', { poolDir, ownPid: 4242, isPidAlive: (pid) => pid !== 999999 });
  assert.equal(claim.appId, 'sogni-agent-earlier');
  claim.release();
  assert.equal(claimSogniAppIdSlot('sogni-web-tab', { poolDir }), null);
});

// Six CLI processes started on the same millisecond, as `xargs -P` or several agents
// do. Before leases were published by hard link, an empty, half-created lease read as
// stale and was taken again: three pairs shared an app ID in 30 of 30 such rounds
// (2026-11-19), and the socket kicked one of each pair mid-render (SWITCH_CONNECTION).
test('pool: processes that start together never share an app ID, with or without a dead lease', async () => {
  const moduleUrl = new URL('../sogni-app-id.mjs', import.meta.url).href;
  for (const deadLeaseOnSlot0 of [false, true]) {
    for (let round = 0; round < 3; round += 1) {
      const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-race-'));
      for (let slot = 0; slot < 8; slot += 1) writeFileSync(join(dir, `slot-${slot}`), `race-app-${slot}\n`, { mode: 0o600 });
      if (deadLeaseOnSlot0) writeFileSync(join(dir, 'slot-0.lease'), `${JSON.stringify({ pid: 99999999 })}\n`, { mode: 0o600 });
      const startAt = Date.now() + 600;
      const code = `const { getOrCreateSogniAppId } = await import(${JSON.stringify(moduleUrl)});
        while (Date.now() < ${startAt}) {}
        console.log(getOrCreateSogniAppId({ appId: '', appIdPath: '', poolDir: process.argv[1] }));
        setTimeout(() => {}, 700);`;
      const ids = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', code, dir]);
        let out = '', err = '';
        child.stdout.on('data', (chunk) => { out += chunk; });
        child.stderr.on('data', (chunk) => { err += chunk; });
        child.once('error', reject);
        child.once('exit', (status) => (status === 0 ? resolve(out.trim()) : reject(new Error(err))));
      })));
      assert.equal(new Set(ids).size, ids.length, `shared app IDs (dead lease: ${deadLeaseOnSlot0}): ${ids.join(', ')}`);
    }
  }
});


test('filesystems without hard links fall back to exclusive create + write for slots, leases and migration', () => {
  for (const code of ['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV']) {
    const poolDir = mkdtempSync(join(tmpdir(), `sogni-app-id-nolink-${code}-`));
    let generated = 0;
    const generateUuid = () => `nolink-${code}-${++generated}`;
    releaseSogniAppId();
    const first = withoutHardLinks(code, () => getOrCreateSogniAppId({ poolDir, generateUuid, ownPid: 4101, isPidAlive: () => true }));
    assert.equal(first, `sogni-agent-nolink-${code}-1`, code);
    assert.equal(readFileSync(join(poolDir, 'slot-0'), 'utf8'), `${first}\n`, `${code}: slot written`);
    assert.equal(JSON.parse(readFileSync(join(poolDir, 'slot-0.lease'), 'utf8')).pid, 4101, `${code}: lease written`);
    releaseSogniAppId();
    // A second live process takes the next slot rather than failing or sharing slot-0.
    writeFileSync(join(poolDir, 'slot-0.lease'), `${JSON.stringify({ pid: 4101 })}\n`);
    const second = withoutHardLinks(code, () => getOrCreateSogniAppId({ poolDir, generateUuid, ownPid: 4102, isPidAlive: () => true }));
    assert.equal(second, `sogni-agent-nolink-${code}-2`, code);
    releaseSogniAppId();
    assert.equal(readdirSync(poolDir).filter(name => name.endsWith('.tmp')).length, 0, `${code}: no temporary files left`);

    // Legacy single-file identity migrates into slot-0 the same way.
    const legacyDir = mkdtempSync(join(tmpdir(), `sogni-app-id-nolink-legacy-${code}-`));
    const legacyAppIdPath = join(legacyDir, 'app-id');
    writeFileSync(legacyAppIdPath, 'sogni-agent-legacy-identity\n');
    const migratedPool = join(legacyDir, 'pool');
    fs.mkdirSync(migratedPool);
    const migrated = withoutHardLinks(code, () => getOrCreateSogniAppId({ poolDir: migratedPool, legacyAppIdPath, generateUuid, ownPid: 4103, isPidAlive: () => true }));
    assert.equal(migrated, 'sogni-agent-legacy-identity', `${code}: legacy identity kept`);
    releaseSogniAppId();
  }
});

test('an empty or partial lease is being written while fresh and stale only after the grace period', () => {
  const poolDir = mkdtempSync(join(tmpdir(), 'sogni-app-id-grace-'));
  writeFileSync(join(poolDir, 'slot-0'), 'sogni-agent-grace-0\n');
  writeFileSync(join(poolDir, 'slot-0.lease'), ''); // another process between create and write
  let generated = 0;
  const generateUuid = () => `grace-${++generated}`;
  releaseSogniAppId();
  const fresh = getOrCreateSogniAppId({ poolDir, generateUuid, ownPid: 4201, isPidAlive: () => true });
  assert.equal(fresh, 'sogni-agent-grace-1', 'a fresh empty lease is left alone');
  assert.equal(readFileSync(join(poolDir, 'slot-0.lease'), 'utf8'), '');
  releaseSogniAppId();
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(join(poolDir, 'slot-0.lease'), old, old);
  const reclaimed = getOrCreateSogniAppId({ poolDir, generateUuid, ownPid: 4202, isPidAlive: () => true });
  assert.equal(reclaimed, 'sogni-agent-grace-0', 'an old empty lease is reclaimed');
  assert.equal(JSON.parse(readFileSync(join(poolDir, 'slot-0.lease'), 'utf8')).pid, 4202);
  releaseSogniAppId();
});


test('a future-dated or never-written empty identity file fails fast instead of waiting forever', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sogni-app-id-skew-'));
  const appIdPath = join(dir, 'app-id');
  writeFileSync(appIdPath, '');
  const future = new Date('2030-01-01T00:00:00Z');
  fs.utimesSync(appIdPath, future, future); // clock skew on a network home
  let started = Date.now();
  assert.throws(() => getOrCreateSogniAppId({ appIdPath, generateUuid: () => 'never' }), { code: 'INVALID_APP_ID' });
  assert.ok(Date.now() - started < 2_000, `future mtime is not "being written" (took ${Date.now() - started} ms)`);

  // A fresh empty file nobody finishes writing: the wait ends at the deadline.
  writeFileSync(appIdPath, '');
  fs.utimesSync(appIdPath, new Date(), new Date()); // rewriting an empty file need not touch its mtime
  started = Date.now();
  assert.throws(() => getOrCreateSogniAppId({ appIdPath, generateUuid: () => 'never' }), { code: 'INVALID_APP_ID' });
  const waited = Date.now() - started;
  assert.ok(waited >= 4_000 && waited < 9_000, `bounded wait (took ${waited} ms)`);
});

test('a future-dated empty lease is reclaimable, not held forever', () => {
  const poolDir = mkdtempSync(join(tmpdir(), 'sogni-app-id-skew-lease-'));
  writeFileSync(join(poolDir, 'slot-0'), 'sogni-agent-skew-0\n');
  writeFileSync(join(poolDir, 'slot-0.lease'), '');
  const future = new Date('2030-01-01T00:00:00Z');
  fs.utimesSync(join(poolDir, 'slot-0.lease'), future, future);
  releaseSogniAppId();
  const appId = getOrCreateSogniAppId({ poolDir, generateUuid: () => 'skew-new', ownPid: 4301, isPidAlive: () => true });
  assert.equal(appId, 'sogni-agent-skew-0');
  assert.equal(JSON.parse(readFileSync(join(poolDir, 'slot-0.lease'), 'utf8')).pid, 4301);
  releaseSogniAppId();
});
