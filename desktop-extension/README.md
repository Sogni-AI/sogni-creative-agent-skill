# Sogni Creative Agent — Claude Desktop extension

A dependency-free MCP stdio server that wraps the globally installed
`sogni-agent` CLI. `manifest.json` follows the MCPB spec (v0.3).

## Layout

- `server/index.mjs` — JSON-RPC 2.0 stdio loop (initialize, tools/list, tools/call)
- `server/tools.mjs` — tool schemas + pure argv builders
- `server/resolve.mjs` — absolute-path resolution (agent, ffmpeg, child env);
  Claude Desktop's GUI environment has a minimal PATH, so nothing here relies on PATH lookup
- `server/import-media.mjs` — local handler for `import_media` (see below); the
  only tool that runs inside the server instead of spawning the CLI

## Chat attachments and import_media

Files attached to a chat never reach this server: Claude Desktop keeps
attachments in its remote sandbox, and MCP has no client→server file
transfer. Every media input (`ref`, `context_images`, …) therefore only
accepts paths on this machine or URLs — the tool descriptions say so, and
point the model at the bridge:

`import_media` accepts base64-encoded bytes and writes them into the Sogni
media inbox (`SOGNI_MEDIA_INBOUND_DIR`, default `~/.openclaw/media/inbound/`
— the same directory `list_media` reads), returning the absolute path to feed
into the generation tools. Large files arrive in chunks: first call passes
`filename`, later calls pass `append_to_path` from the previous result.
Guardrails: media-only extensions, filenames reduced to their basename,
existing files never overwritten (suffixed instead), appends confined to the
inbox, 2MB per chunk / 25MB per file. In practice the model reads the
attachment in its code-execution sandbox, downscales images to ~1024px JPEG,
and relays the base64 — token-expensive, so previews beat full-res originals.

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
