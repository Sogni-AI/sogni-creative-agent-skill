/**
 * Copy the canonical deep-dive references into the self-contained Hermes Hub
 * skill bundle. SKILL.md stays Hermes-specific and is maintained separately.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(
  repoRoot,
  '.agents',
  'skills',
  'sogni-creative-agent-skill',
  'references',
);

const referenceFiles = [
  'hosted-api.md',
  'image-prompting.md',
  'krea2-loras.md',
  'loop-maker.md',
  'models.md',
  'personas-memory.md',
  'private-mature-video.md',
  'seamless-tiling.md',
  'video-editing.md',
  'video-prompting.md',
];

mkdirSync(destination, { recursive: true });
for (const filename of referenceFiles) {
  copyFileSync(join(repoRoot, 'references', filename), join(destination, filename));
}

console.log(`Synced ${referenceFiles.length} Hermes skill references.`);
