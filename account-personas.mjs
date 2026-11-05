import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mpeg': '.mp3',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
  'video/mp4': '.mp4', 'video/webm': '.webm',
};

/** Explicit snapshot import: originals come from the authenticated content
 * route, never expiring preview URLs. Existing local personas are untouched. */
export async function importAccountPersona({ id, requestJson, requestBytes, directory, existingPersonas = [] }) {
  const envelope = await requestJson(`/v1/personas/${encodeURIComponent(id)}`);
  const character = envelope.data;
  if (!character?.id || typeof character.name !== 'string' || !character.name.trim()) throw new Error('Sogni returned an incomplete persona.');
  if (existingPersonas.some((persona) => persona.name.toLowerCase() === character.name.toLowerCase())) {
    throw new Error(`A local persona named "${character.name}" already exists. Import did not replace it.`);
  }
  const slug = `account-${randomUUID()}`;
  const folder = join(directory, slug);
  mkdirSync(folder, { recursive: true });
  try {
    const references = [];
    for (const reference of character.references ?? []) {
      const content = await requestBytes(`/v1/personas/${encodeURIComponent(character.id)}/references/${encodeURIComponent(reference.id)}/content`);
      // Neither a display name nor a remote asset id becomes a filesystem path.
      const path = join(folder, `reference-${references.length + 1}${EXTENSIONS[reference.contentType] ?? '.bin'}`);
      writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
      references.push({ id: reference.id, role: reference.role, name: reference.name, contentType: reference.contentType, path });
    }
    const images = references.filter((reference) => reference.contentType?.startsWith('image/') && reference.role !== 'thumbnail');
    const identity = images.find((reference) => reference.id === character.identityReferenceId) ?? images[0];
    const photoPaths = identity ? [identity, ...images.filter((reference) => reference !== identity)].map((reference) => reference.path) : [];
    const voice = references.find((reference) => reference.role === 'voice' && reference.contentType?.startsWith('audio/'));
    return {
      id: randomUUID(), name: character.name, slug, relationship: character.relationship || 'friend',
      description: [character.description, character.appearance, character.attire].filter(Boolean).join('\n'),
      tags: character.tags ?? [], voice: character.voiceDescription || null,
      photoPath: identity?.path ?? null, photoPaths, voiceClipPath: voice?.path ?? null,
      voiceTranscript: character.voiceTranscript || '', references,
      accountPersonaId: character.id, accountPersonaRevision: character.revision,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
  } catch (error) {
    if (existsSync(folder)) rmSync(folder, { recursive: true });
    throw error;
  }
}
