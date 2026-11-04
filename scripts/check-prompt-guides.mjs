// Fails when the generated prompt-guide sections of the reference docs differ
// from what the pinned @sogni-ai/sogni-intelligence-client would generate.
// Runs in `npm test` and `prepack`. Fix: npm run sync:prompt-guides.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLED_IC_VERSION, buildPromptGuideDocs } from './sync-prompt-guides.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const IC_PACKAGE = '@sogni-ai/sogni-intelligence-client';

// `sections` and `readDoc` let tests reuse one generation and check edited copies.
export async function checkPromptGuides({ sections, readDoc } = {}) {
  const problems = [];
  const pinned = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).dependencies[IC_PACKAGE];
  if (pinned !== INSTALLED_IC_VERSION) {
    problems.push(`${IC_PACKAGE} ${INSTALLED_IC_VERSION} is installed but package.json pins ${pinned}; run npm install.`);
    return problems;
  }
  for (const { file, current, generated, problems: fileProblems } of await buildPromptGuideDocs({ sections, readDoc })) {
    problems.push(...fileProblems.map((problem) => `${file}: ${problem}`));
    if (fileProblems.length === 0 && generated !== current) {
      problems.push(`${file}: generated prompt guide sections differ from ${IC_PACKAGE} ${pinned}; run npm run sync:prompt-guides.`);
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = await checkPromptGuides();
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`Generated prompt guide sections match ${IC_PACKAGE} ${INSTALLED_IC_VERSION}.`);
}
