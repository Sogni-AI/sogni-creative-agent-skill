# Inline Images in the Claude Desktop MCP Server — Design

**Date:** 2026-07-04
**Status:** Approved (user: full-resolution bytes by default)

## Problem

Sogni generations reach Claude Desktop as text containing a signed URL. Users must click out of the chat to see results; the model sometimes works around this by downloading files itself. MCP tool results support native `{type:"image"}` content blocks that Claude Desktop renders inline — the server should use them by default.

## Behavior

After a successful CLI run, image-producing tools return content in this order:

1. One MCP image block per rendered image: `{ type: "image", data: <base64>, mimeType }`
2. The existing text block, unchanged (URL, saved path, seed, model details)

### Scope

| Tool | Inline? |
|---|---|
| `generate_image` | yes |
| `photobooth` | yes |
| `edit_video` — `extract_first_frame`, `extract_last_frame` | yes (the extracted frame at `output`) |
| `generate_video`, `generate_music`, everything else | no — text + link unchanged (MCP hosts don't render video/audio files inline) |

Multi-image runs (`count > 1`): inline at most **4** images; the text block already lists all URLs.

### Sourcing bytes

Parse the CLI's `--json` stdout for the result descriptor:

- `localPath` set → read the file.
- else `urls[]` → `fetch()` each needed URL (global fetch, Node ≥ 20). URLs come from trusted CLI output (Sogni S3 presigned).
- Frame extractions: read the `output` path passed to the tool (the CLI wrappers do not emit `--json` descriptors).

MIME from file extension / response Content-Type: `image/png` (default), `image/jpeg`, `image/webp`.

### Full-res with a safety valve

Attach original bytes as-is. If one image exceeds **3.5 MB raw** (≈ 5 MB base64, the practical content ceiling), downscale that image only — `sharp` (already a package dependency; the server runs from inside the installed package) via **dynamic import**, resize to fit within 2048px, JPEG quality 85. If sharp is unavailable or fails: skip inline for that image and append one line to the text noting the image was too large to inline.

### Failure posture — never worse than today

Any failure in the inline pipeline (unparseable stdout, fetch error, read error, unknown mime, sharp failure) silently degrades to the current text-only result for the affected image(s). The inline step runs only when the CLI exited 0.

### Opt-out

`SOGNI_MCP_NO_INLINE_IMAGES=1` in the server env disables all inline attachment (for constrained hosts). No per-call tool parameter (YAGNI).

## Implementation shape

- `desktop-extension/server/inline-images.mjs` — new module: `collectInlineImages({ toolName, input, stdout }) → Promise<Array<ImageBlock>>` plus internals (descriptor parse, byte sourcing, size guard). Pure of protocol concerns.
- `desktop-extension/server/index.mjs` — after a `code === 0` close for a scoped tool, `content = [...imageBlocks, textBlock]`. Wrapped in try/catch → text-only on any throw.
- `desktop-extension/server/tools.mjs` — tool descriptions gain one sentence: results render inline.
- No new package dependencies (`sharp` is existing; dynamic import with fallback).

## Testing

Extend `test/fixtures/fake-sogni-agent.mjs` with `FAKE_AGENT_JSON_FILE` (emit a descriptor JSON naming a real temp file as `localPath`). Tests in `test/desktop-extension.test.mjs`:

1. `generate_image` with a fixture PNG at `localPath` → result has image block (base64 round-trips to the source bytes, mimeType `image/png`) followed by the text block.
2. `urls[]` route via a local `node:http` server serving bytes → image block present.
3. Corrupt/non-JSON stdout → text-only result, `isError` false.
4. `SOGNI_MCP_NO_INLINE_IMAGES=1` → text-only.
5. Oversize (>3.5 MB fixture) → either downscaled (sharp present, smaller than source) or skipped with the too-large note.
6. `generate_video` → no image block (scope guard).

## Ship

`feat(desktop)` commits → PR → merge → `GITHUB_TOKEN=$(gh auth token) npx semantic-release --no-ci` → 3.11.0 → post-release lockfile-sync and `sync:version` stamp commits (per release-process runbook).
