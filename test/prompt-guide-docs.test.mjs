import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MODEL_PROMPT_GUIDES,
  renderModelPromptGuide,
} from '@sogni-ai/sogni-intelligence-client/prompt-guides';
import {
  IMAGE_DOC,
  IMAGE_FAMILIES,
  VIDEO_DOC,
  VIDEO_FAMILIES,
  applySections,
  buildPromptGuideSections,
} from '../scripts/sync-prompt-guides.mjs';
import { checkPromptGuides } from '../scripts/check-prompt-guides.mjs';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');
const PINNED_IC = JSON.parse(read('package.json')).dependencies['@sogni-ai/sogni-intelligence-client'];

// One generation (it runs every printed command through the CLI) for all tests.
const sections = await buildPromptGuideSections();

test('generated prompt guide sections match the pinned intelligence-client', async () => {
  assert.deepEqual(await checkPromptGuides({ sections }), []);
  // Spot-check the content: the Seedance 2.5 section quotes the CLI's agent rendering verbatim.
  const seedance = renderModelPromptGuide(MODEL_PROMPT_GUIDES['seedance-2.5'].t2v, { audience: 'agent' });
  assert.ok(read(VIDEO_DOC).includes(`\`\`\`text\n${seedance}\n\`\`\``));
  assert.match(read(VIDEO_DOC), /`sogni-agent prompt-guide wan22-i2v --mode s2v`/);
  for (const family of IMAGE_FAMILIES) {
    assert.match(read(IMAGE_DOC), new RegExp(`\\| \`${family}\` \\|`), family);
  }
  assert.deepEqual(new Set(VIDEO_FAMILIES), new Set(['seedance-2.0', 'seedance-2.5', 'ltx-2.5', 'ltx-2.3', 'wan-2.2', 'wan-3', 'happyhorse-1.1', 'minimax-h3']));
});

test('the check fails when a generated section is edited by hand', async () => {
  const rule = 'TIME-CODED BEATS: For clips longer than 5 seconds';
  assert.ok(read(VIDEO_DOC).includes(rule));
  const readDoc = (file) => (file === VIDEO_DOC ? read(file).replace(rule, 'TIME-CODED BEATS: For clips longer than 9 seconds') : read(file));
  assert.deepEqual(await checkPromptGuides({ sections, readDoc }), [
    `${VIDEO_DOC}: generated prompt guide sections differ from @sogni-ai/sogni-intelligence-client ${PINNED_IC}; run npm run sync:prompt-guides.`,
  ]);
});

test('the check fails on a missing or unknown section and keeps hand-written text', async () => {
  const withoutH3 = (file) => (file === VIDEO_DOC
    ? read(file).replace(/<!-- BEGIN GENERATED PROMPT GUIDE: minimax-h3 -->[\s\S]*?<!-- END GENERATED PROMPT GUIDE: minimax-h3 -->/, '')
    : read(file));
  assert.deepEqual(await checkPromptGuides({ sections, readDoc: withoutH3 }), [
    `${VIDEO_DOC}: missing or unclosed generated section "minimax-h3"`,
  ]);

  const body = new Map([['known', 'generated body']]);
  const { text, problems } = applySections(
    'hand-written above\n<!-- BEGIN GENERATED PROMPT GUIDE: known -->\nstale\n<!-- END GENERATED PROMPT GUIDE: known -->\n'
      + 'hand-written below\n<!-- BEGIN GENERATED PROMPT GUIDE: retired -->\n<!-- END GENERATED PROMPT GUIDE: retired -->\n',
    body,
  );
  assert.deepEqual(problems, ['unknown generated section "retired"']);
  assert.ok(text.startsWith('hand-written above\n<!-- BEGIN GENERATED PROMPT GUIDE: known -->\ngenerated body\n\n<!-- END GENERATED PROMPT GUIDE: known -->\nhand-written below\n'));
});
