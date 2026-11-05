import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAccountPersona } from '../account-personas.mjs';

const character = {
  id: 'persona-a', name: 'Alice', description: 'A curious explorer', appearance: 'curly hair', attire: 'a blue coat',
  identityReferenceId: 'photo', revision: 3, voiceDescription: 'warm alto', voiceTranscript: 'A test passage.',
  references: [
    { id: 'sheet', role: 'character-sheet', contentType: 'image/png', url: 'https://expired.test/sheet' },
    { id: 'photo', role: 'identity', contentType: 'image/jpeg', url: 'https://expired.test/photo' },
    { id: 'voice', role: 'voice', contentType: 'audio/webm', url: 'https://expired.test/voice' },
  ],
};

test('account persona import keeps original photos, sheet, voice, transcript and saved descriptions', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'sogni-account-personas-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const requests = [];
  const persona = await importAccountPersona({
    id: 'persona-a', directory,
    requestJson: async (path) => { assert.equal(path, '/v1/personas/persona-a'); return { data: character }; },
    requestBytes: async (path) => { requests.push(path); return Buffer.from(path); },
  });
  assert.equal(persona.accountPersonaId, 'persona-a');
  assert.equal(persona.accountPersonaRevision, 3);
  assert.equal(persona.photoPaths.length, 2);
  assert.equal(persona.photoPath, persona.photoPaths[0]);
  assert.match(readFileSync(persona.photoPath, 'utf8'), /\/photo\/content$/);
  assert.match(readFileSync(persona.voiceClipPath, 'utf8'), /\/voice\/content$/);
  assert.equal(persona.voiceTranscript, character.voiceTranscript);
  assert.equal(persona.description, 'A curious explorer\ncurly hair\na blue coat');
  assert.equal(requests.length, 3);
  assert.ok(requests.every((path) => path.startsWith('/v1/personas/persona-a/references/')));
});

test('import never overwrites a local persona with the same name', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'sogni-account-personas-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(importAccountPersona({
    id: 'persona-a', directory, existingPersonas: [{ name: 'ALICE' }],
    requestJson: async () => ({ data: character }), requestBytes: async () => { throw new Error('must not download'); },
  }), /already exists/);
  assert.deepEqual(readdirSync(directory), []);
});

test('failed reference downloads leave no partially imported persona', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'sogni-account-personas-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let requests = 0;
  await assert.rejects(importAccountPersona({
    id: 'persona-a', directory, requestJson: async () => ({ data: character }),
    requestBytes: async () => { if (++requests === 2) throw new Error('missing original'); return Buffer.from('original'); },
  }), /missing original/);
  assert.deepEqual(readdirSync(directory), []);
});
