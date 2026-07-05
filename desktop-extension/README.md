# Sogni Creative Agent — Claude Desktop extension

A dependency-free MCP stdio server that wraps the globally installed
`sogni-agent` CLI. `manifest.json` follows the MCPB spec (v0.3).

## Layout

- `server/index.mjs` — JSON-RPC 2.0 stdio loop (initialize, tools/list, tools/call)
- `server/tools.mjs` — tool schemas + pure argv builders
- `server/resolve.mjs` — absolute-path resolution (agent, ffmpeg, child env);
  Claude Desktop's GUI environment has a minimal PATH, so nothing here relies on PATH lookup

## Inline images

Successful `generate_image`, `photobooth`, and frame-extraction calls attach
the rendered image(s) to the tool result as MCP image content blocks, which
Claude Desktop displays inline (up to 4 per call). Previews auto-fit the
host's 1MB tool-result limit: they share a ~700KB cumulative raw-byte budget,
and any image over the remaining budget is downscaled via a `sharp` ladder
(1024px/q80 → 768px/q70 → 512px/q60), or skipped with a note if none fits.
The text block always keeps the full-resolution URL / saved path. Set
`SOGNI_MCP_NO_INLINE_IMAGES=1` in the server env to disable.

## Build the .mcpb bundle

    npm run build:mcpb   # → dist/sogni-creative-agent.mcpb

## Install paths

1. `npx setup-sogni-agent-skill` writes a `claude_desktop_config.json` entry
   pointing at this server inside the global npm package (preferred).
2. The packed `.mcpb` is the manual drag-and-drop alternative
   (Claude Desktop → Settings → Extensions).
3. OpenAI Codex uses the same server:
   `codex mcp add sogni-creative-agent -- node <abs path to server/index.mjs>`
   (the Codex CLI and IDE extension read `~/.codex/config.toml`).

The server needs the CLI installed globally (`npm i -g @sogni-ai/sogni-creative-agent-skill`);
when missing, every tool returns a hint to run `npx setup-sogni-agent-skill`.

## Testing

    node --test test/desktop-extension.test.mjs
