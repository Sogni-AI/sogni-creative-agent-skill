import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getOrCreateSogniAppId } from '../sogni-app-id.mjs';

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
