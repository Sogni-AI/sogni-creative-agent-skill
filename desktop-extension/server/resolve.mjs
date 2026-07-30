// desktop-extension/server/resolve.mjs
// Claude Desktop launches MCP servers with a minimal GUI environment: no
// /opt/homebrew/bin, no npm global bin dir. Everything here resolves to
// absolute paths so the wrapper never depends on PATH lookup.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const PKG_REL = join('@sogni-ai', 'sogni-creative-agent-skill');

// System-wide npm global roots. Injectable (`roots`) so tests on machines that
// really have the skill installed globally can sandbox resolution.
const DEFAULT_GLOBAL_ROOTS = [
  '/opt/homebrew/lib/node_modules',
  '/usr/local/lib/node_modules',
  '/usr/lib/node_modules',
];

function nvmCandidates(home) {
  const base = join(home, '.nvm', 'versions', 'node');
  let versions;
  try {
    versions = readdirSync(base);
  } catch {
    return [];
  }
  return versions
    .sort()
    .reverse()
    .map((v) => join(base, v, 'lib', 'node_modules', PKG_REL, 'sogni-agent.mjs'));
}

export function resolveAgentPath({ env = process.env, home = homedir(), roots = DEFAULT_GLOBAL_ROOTS } = {}) {
  if (env.SOGNI_AGENT_PATH) {
    return existsSync(env.SOGNI_AGENT_PATH) ? env.SOGNI_AGENT_PATH : null;
  }
  const candidates = [
    ...roots.map((root) => join(root, PKG_REL, 'sogni-agent.mjs')),
    join(home, '.npm-global', 'lib', 'node_modules', PKG_REL, 'sogni-agent.mjs'),
    ...(env.APPDATA ? [join(env.APPDATA, 'npm', 'node_modules', PKG_REL, 'sogni-agent.mjs')] : []),
    ...nvmCandidates(home),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function resolveFfmpegPath({ env = process.env } = {}) {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function buildChildEnv({
  env = process.env,
  agentPath,
  ffmpegPath = null,
  attributionEnv = {},
} = {}) {
  const extraBins = ['/opt/homebrew/bin', '/usr/local/bin'];
  if (agentPath) extraBins.push(dirname(agentPath));
  const child = {
    ...env,
    PATH: [...extraBins, env.PATH ?? ''].filter(Boolean).join(delimiter),
  };
  if (ffmpegPath) child.FFMPEG_PATH = ffmpegPath;
  for (const [name, value] of Object.entries(attributionEnv)) {
    if (typeof value === 'string' && value.length > 0) {
      child[name] = value;
    } else {
      delete child[name];
    }
  }
  // The .mcpb user_config template injects "" when the API-key field is left
  // blank; an empty env var would shadow ~/.config/sogni/credentials.
  if (child.SOGNI_API_KEY === '') delete child.SOGNI_API_KEY;
  return child;
}
