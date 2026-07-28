import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();

test('OpenClaw link surface stays in sync with root plugin files', async () => {
  // Generate into a temp dir so running the tests never mutates the
  // working-tree .openclaw-link/ output.
  const linkDir = mkdtempSync(join(tmpdir(), 'sogni-openclaw-link-'));
  process.env.SOGNI_OPENCLAW_LINK_DIR = linkDir;
  try {
    await import('../scripts/sync-openclaw-plugin.mjs');

    for (const filename of ['SKILL.md', 'openclaw.plugin.json', 'openclaw-plugin.mjs']) {
      const rootFile = readFileSync(join(repoRoot, filename), 'utf8');
      const linkFile = readFileSync(join(linkDir, filename), 'utf8');
      assert.equal(linkFile, rootFile, `${filename} is out of sync; run npm run openclaw:sync`);
    }

    for (const filename of readdirSync(join(repoRoot, 'references')).filter((name) => name.endsWith('.md'))) {
      const rootFile = readFileSync(join(repoRoot, 'references', filename), 'utf8');
      const linkFile = readFileSync(join(linkDir, 'references', filename), 'utf8');
      assert.equal(linkFile, rootFile, `references/${filename} is out of sync; run npm run openclaw:sync`);
    }

    const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const linkPackage = JSON.parse(readFileSync(join(linkDir, 'package.json'), 'utf8'));
    assert.equal(linkPackage.version, rootPackage.version);
    assert.deepEqual(linkPackage.openclaw?.extensions, ['./openclaw-plugin.mjs']);
  } finally {
    delete process.env.SOGNI_OPENCLAW_LINK_DIR;
  }
});

test('non-OpenClaw skill distribution keeps a single root skill source', () => {
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const skillPackage = JSON.parse(readFileSync(join(repoRoot, 'skill-package.json'), 'utf8'));
  const clawhubIgnore = readFileSync(join(repoRoot, '.clawhubignore'), 'utf8');
  const npmIgnore = readFileSync(join(repoRoot, '.npmignore'), 'utf8');

  assert.ok(rootPackage.files.includes('SKILL.md'), 'root SKILL.md must be published');
  assert.ok(rootPackage.files.includes('skill-package.json'), 'skill-package.json must be published');
  assert.ok(rootPackage.files.includes('sogni-agent.mjs'), 'CLI must be published for skill runtimes');
  assert.ok(rootPackage.files.includes('sogni-app-id.mjs'), 'persistent app ID helper must be published with the CLI');
  assert.ok(rootPackage.files.includes('generated/creative-agent-runtime.mjs'), 'generated runtime policy must be published');
  assert.ok(!rootPackage.files.includes('.openclaw-link'), 'generated OpenClaw link surface must not be published');
  assert.ok(!rootPackage.files.includes('openclaw'), 'OpenClaw mirror must not create a second packaged SKILL.md');
  assert.ok(clawhubIgnore.includes('.openclaw-link/'), 'ClawHub skill packaging must ignore generated link surface');
  assert.ok(npmIgnore.includes('.openclaw-link/'), 'npm packaging must ignore generated link surface');

  assert.equal(rootPackage.dependencies['@sogni-ai/sogni-client-wrapper'], undefined);
  assert.equal(skillPackage.dependencies['@sogni-ai/sogni-client-wrapper'], undefined);
  assert.equal(
    skillPackage.dependencies['@sogni-ai/sogni-intelligence-client'],
    rootPackage.dependencies['@sogni-ai/sogni-intelligence-client'],
    'skill-package.json must install the same SDK package as the published npm package',
  );
});

test('skill instructions invoke the installed CLI instead of local script paths', () => {
  const skillMd = readFileSync(join(repoRoot, 'SKILL.md'), 'utf8');
  assert.equal(
    /(?:^|\s)node\s+(?:\{\{skillDir\}\}\/)?sogni-agent\.mjs\b/.test(skillMd),
    false,
    'SKILL.md command examples must use `sogni-agent`; Claude and Hermes installs do not include sogni-agent.mjs',
  );
});
