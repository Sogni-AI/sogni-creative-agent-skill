# Sogni Creative Agent — Claude Desktop extension

A dependency-free MCP stdio server that wraps the globally installed
`sogni-agent` CLI. `manifest.json` follows the MCPB spec (v0.3).

## Layout

- `server/index.mjs` — JSON-RPC 2.0 stdio loop (initialize, tools/list, tools/call)
- `server/tools.mjs` — tool schemas + pure argv builders
- `server/resolve.mjs` — absolute-path resolution (agent, ffmpeg, child env);
  Claude Desktop's GUI environment has a minimal PATH, so nothing here relies on PATH lookup

## Build the .mcpb bundle

    npm run build:mcpb   # → dist/sogni-creative-agent.mcpb

## Install paths

1. `npx setup-sogni-agent-skill` writes a `claude_desktop_config.json` entry
   pointing at this server inside the global npm package (preferred).
2. The packed `.mcpb` is the manual drag-and-drop alternative
   (Claude Desktop → Settings → Extensions).

The server needs the CLI installed globally (`npm i -g @sogni-ai/sogni-creative-agent-skill`);
when missing, every tool returns a hint to run `npx setup-sogni-agent-skill`.

## Testing

    node --test test/desktop-extension.test.mjs
