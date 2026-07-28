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
