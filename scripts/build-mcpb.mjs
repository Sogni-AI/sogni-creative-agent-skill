#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Preserve the source layout so the MCP server's shared relative imports stay
// inside the standalone extension, without including the full CLI or SDK.
export function stageMcpb(destination) {
  mkdirSync(destination, { recursive: true });
  cpSync(join(ROOT, 'desktop-extension'), join(destination, 'desktop-extension'), {
    recursive: true,
    filter: (source) => !['node_modules', 'package-lock.json', '.DS_Store'].includes(source.split(/[\\/]/).at(-1)),
  });
  for (const file of ['attribution.mjs', 'version.mjs', 'LICENSE']) {
    cpSync(join(ROOT, file), join(destination, file));
  }
  const manifest = JSON.parse(readFileSync(join(ROOT, 'desktop-extension', 'manifest.json'), 'utf8'));
  manifest.server.entry_point = 'desktop-extension/server/index.mjs';
  manifest.server.mcp_config.args = ['${__dirname}/desktop-extension/server/index.mjs'];
  writeFileSync(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const staging = mkdtempSync(join(tmpdir(), 'sogni-mcpb-'));
  try {
    stageMcpb(staging);
    const output = join(ROOT, 'dist', 'sogni-creative-agent.mcpb');
    mkdirSync(dirname(output), { recursive: true });
    const result = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['-y', '@anthropic-ai/mcpb', 'pack', staging, output],
      { stdio: 'inherit', shell: process.platform === 'win32' },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
