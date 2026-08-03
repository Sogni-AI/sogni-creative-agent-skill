#!/usr/bin/env node
// desktop-extension/server/index.mjs
// Dependency-free MCP stdio server for Claude Desktop. Translates tool calls
// into sogni-agent CLI invocations. Protocol: JSON-RPC 2.0, one message per
// line over stdio. IMPORTANT: stdout is protocol-only — log to stderr.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, getTool } from './tools.mjs';
import { buildChildEnv, resolveAgentPath, resolveFfmpegPath } from './resolve.mjs';
import { collectInlineImages } from './inline-images.mjs';
import { runImportMedia } from './import-media.mjs';
import {
  attributionEnvironment,
  normalizeMcpClientInfo,
  resolveAgentAttribution,
} from '../../attribution.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_FALLBACK = '2025-06-18';
const MIN_HARD_KILL_MS = 15 * 60 * 1000;
const HARD_KILL_GRACE_MS = 60 * 1000;
const DEFAULT_TOOL_TIMEOUT_SECONDS = {
  generate_video: 1800,
  generate_music: 600,
};
const PROGRESS_INTERVAL_MS = 10_000;
const MAX_RESULT_CHARS = 20_000;

let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(readFileSync(join(HERE, '..', 'manifest.json'), 'utf8')).version;
} catch {
  // Running outside a packaged layout (e.g. unit tests before Task 4); harmless.
}
let mcpAttributionEnv = attributionEnvironment(normalizeMcpClientInfo(undefined, {
  fallback: resolveAgentAttribution({ surfaceVersion: VERSION }),
  surfaceVersion: VERSION,
}));

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

function hardKillTimeoutMs(toolName, input) {
  const explicitTimeoutSeconds = Number(input?.timeout_seconds);
  const timeoutSeconds = Number.isFinite(explicitTimeoutSeconds) && explicitTimeoutSeconds > 0
    ? explicitTimeoutSeconds
    : DEFAULT_TOOL_TIMEOUT_SECONDS[toolName];
  if (!timeoutSeconds) return MIN_HARD_KILL_MS;
  // Let the CLI's own timeout run first so it can await the normal Sogni
  // project cancellation protocol before this process-level safety valve.
  return Math.max(MIN_HARD_KILL_MS, (timeoutSeconds * 1000) + HARD_KILL_GRACE_MS);
}

// Tools marked local in the registry run inside this process and must work
// even when the sogni-agent CLI is not installed yet.
const LOCAL_HANDLERS = { import_media: runImportMedia };

async function callTool(name, input, progressToken) {
  const tool = getTool(name);
  if (!tool) return textResult(`Unknown tool: ${name}`, true);

  if (tool.local) {
    try {
      return textResult(await LOCAL_HANDLERS[name](input ?? {}));
    } catch (err) {
      return textResult(err.message, true);
    }
  }

  const agentPath = resolveAgentPath();
  if (!agentPath) {
    return textResult(
      'The sogni-agent CLI is not installed. Open a terminal, run `npx setup-sogni-agent-skill`, then retry.',
      true,
    );
  }

  let args;
  try {
    args = tool.buildArgs(input ?? {});
  } catch (err) {
    return textResult(err.message, true);
  }

  const env = buildChildEnv({
    agentPath,
    ffmpegPath: resolveFfmpegPath(),
    attributionEnv: mcpAttributionEnv,
  });

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [agentPath, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const started = Date.now();
    const ticker = progressToken == null
      ? null
      : setInterval(() => {
          send({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: Math.round((Date.now() - started) / 1000),
              message: `sogni-agent ${name} running…`,
            },
          });
        }, PROGRESS_INTERVAL_MS);
    const killer = setTimeout(
      () => child.kill('SIGKILL'),
      hardKillTimeoutMs(name, input),
    );

    const finish = (result) => {
      if (ticker) clearInterval(ticker);
      clearTimeout(killer);
      resolve(result);
    };

    child.on('error', (err) => finish(textResult(`Failed to launch sogni-agent: ${err.message}`, true)));
    child.on('close', async (code) => {
      const text = [stdout.trim(), code === 0 ? '' : stderr.trim()].filter(Boolean).join('\n')
        || `sogni-agent exited with code ${code}`;
      // Success output is front-loaded (e.g. result JSON) so keep the head; on
      // failure the actionable error is at the tail, so keep the tail instead.
      const clipped = code === 0 ? text.slice(0, MAX_RESULT_CHARS) : text.slice(-MAX_RESULT_CHARS);
      if (code !== 0) {
        finish(textResult(clipped, true));
        return;
      }
      // Inline images: best-effort. Any failure here must not degrade the
      // text result, so the whole step is fenced.
      let inline = { blocks: [], notes: [] };
      try {
        inline = await collectInlineImages({ toolName: name, input: input ?? {}, stdout });
      } catch {
        inline = { blocks: [], notes: [] };
      }
      const finalText = [clipped, ...inline.notes].join('\n');
      finish({ content: [...inline.blocks, { type: 'text', text: finalText }], isError: false });
    });
  });
}

async function dispatch(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  if (method === 'initialize') {
    mcpAttributionEnv = attributionEnvironment(normalizeMcpClientInfo(params?.clientInfo, {
      fallback: resolveAgentAttribution({ surfaceVersion: VERSION }),
      surfaceVersion: VERSION,
    }));
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_FALLBACK,
        capabilities: { tools: {} },
        serverInfo: { name: 'sogni-creative-agent', version: VERSION },
      },
    });
    return;
  }
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      },
    });
    return;
  }
  if (method === 'tools/call') {
    const result = await callTool(params?.name, params?.arguments, params?._meta?.progressToken);
    send({ jsonrpc: '2.0', id, result });
    return;
  }
  if (!isRequest || method?.startsWith('notifications/')) {
    return; // notifications need no response
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  dispatch(msg).catch((err) => {
    if (msg.id !== undefined && msg.id !== null) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err.message } });
    } else {
      process.stderr.write(`sogni desktop server error: ${err.stack}\n`);
    }
  });
});
rl.on('close', () => process.exit(0));
