<p align="center">
  <img src="https://raw.githubusercontent.com/Sogni-AI/sogni-creative-agent-skill/main/docs/screenshot.jpg" alt="Sogni Creative Agent Skill rendering an image from a Telegram-style chat" width="320" />
</p>

<h1 align="center">Sogni Creative Agent Skill</h1>

<p align="center">Image, video, and music generation for AI agents — powered by <a href="https://sogni.ai">Sogni AI</a>'s decentralized GPU network.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sogni-ai/sogni-creative-agent-skill"><img alt="npm" src="https://img.shields.io/npm/v/@sogni-ai/sogni-creative-agent-skill.svg" /></a>
  <a href="https://www.npmjs.com/package/@sogni-ai/sogni-creative-agent-skill"><img alt="downloads" src="https://img.shields.io/npm/dm/@sogni-ai/sogni-creative-agent-skill.svg" /></a>
  <img alt="node" src="https://img.shields.io/node/v/@sogni-ai/sogni-creative-agent-skill.svg" />
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@sogni-ai/sogni-creative-agent-skill.svg" /></a>
</p>

---

**Sogni Creative Agent Skill** plugs into the agent runtime you already use — Claude Code, [OpenClaw](https://github.com/OpenClaw/OpenClaw), [Hermes Agent](https://hermes-agent.nousresearch.com/), [Manus AI](https://manus.im), and others — and gives it production-quality image, video, and music generation through a single CLI: `sogni-agent`.

It ships three ways:

- a standalone Node.js CLI (`sogni-agent`)
- a skill source that any [`SKILL.md`](./SKILL.md)-aware agent can load
- a published [OpenClaw](https://github.com/OpenClaw/OpenClaw) plugin

With this skill, an agent can:

- generate images from prompts and edit/restyle existing images
- create videos from text, images, first/last frames, audio, or source video (LTX-2.5), with LTX-2.3 retained for voice ID, transition, and 10Eros workflows
- turn an image folder into a visually deduplicated, music-backed seamless loop with one plugin skill invocation
- generate instrumental music or full songs with lyrics
- run hosted creative workflows including storyboard-driven video
- save personas, preferences, and last-render state across sessions
- check balances, list models, and refine previous results

> **Fastest install:** paste this repo's GitHub URL into your agent and ask it to "install this skill".

---

## Table of Contents

- [Quick Start](#quick-start)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Node CLI (default)](#node-cli-default)
  - [Claude Code plugin](#claude-code-plugin)
  - [OpenAI Codex CLI](#openai-codex-cli)
  - [Hermes Agent](#hermes-agent)
  - [OpenClaw plugin](#openclaw-plugin)
  - [ChatGPT (Custom GPT)](#chatgpt-custom-gpt)
  - [Manus / other SKILL.md frameworks](#manus--other-skillmd-frameworks)
  - [Manual install from source](#manual-install-from-source)
  - [Host launchers](#host-launchers)
  - [Verify your install](#verify-your-install)
  - [Upgrading safely from inside an agent](#upgrading-safely-from-inside-an-agent)
- [Claude Desktop](#claude-desktop)
  - [Also works in OpenAI Codex](#also-works-in-openai-codex)
- [Setup (Sogni API key)](#setup-sogni-api-key)
- [Usage](#usage)
- [CLI Reference](#cli-reference)
  - [Common options](#common-options)
  - [Quality presets](#quality-presets)
  - [Recommended models](#recommended-models)
- [Video Sizing & Aspect Ratios](#video-sizing--aspect-ratios)
- [LTX-2.x Prompting Guide](#ltx-2x-prompting-guide)
- [Photobooth (Face Transfer)](#photobooth-face-transfer)
- [Personas, Memory, and Personality](#personas-memory-and-personality)
- [Hosted API Modes](#hosted-api-modes)
- [Dynamic Prompt Variations](#dynamic-prompt-variations)
- [Token Auto-Fallback](#token-auto-fallback)
- [Sogni Unlimited Subscription](#sogni-unlimited-subscription)
- [Error Reporting & Output](#error-reporting--output)
- [For AI Agents](#for-ai-agents)
- [Development](#development)
- [License](#license)

---

## Quick Start

1. Get a Sogni API key from [dashboard.sogni.ai](https://dashboard.sogni.ai) (open the account menu) and save it — see [Setup](#setup-sogni-api-key).
2. Install (one command):

   ```bash
   npx setup-sogni-agent-skill
   ```

   This auto-detects Claude Code, OpenAI Codex CLI, and Hermes Agent; installs the
   CLI globally; registers the skill into each detected runtime; prompts for your
   API key; and tells you how to request ChatGPT Custom-GPT setup instructions.
   (It does **not** configure OpenClaw — see the [OpenClaw plugin](#openclaw-plugin)
   section.)

   Prefer to do it manually? Install the CLI directly:

   ```bash
   npm install -g @sogni-ai/sogni-creative-agent-skill@latest
   sogni-agent --version
   ```

   Then point your agent runtime at this repository's [`SKILL.md`](./SKILL.md).

3. Verify the install:

   ```bash
   sogni-agent doctor
   ```

Then ask your agent to do something:

- "Generate an image of a sunset over mountains"
- "Edit this image to add a rainbow"
- "Use Sogni Loop Maker on my image folder"
- "Make a video of a cat playing piano"
- "Generate a 30 second synthwave product-launch theme"
- "Turn my selfie into James Bond using photobooth"
- "Refine the last image at higher quality"

---

## Requirements

- **Node.js ≥ 22.11.0**
- **Sogni API key** ([dashboard.sogni.ai](https://dashboard.sogni.ai))
- **`ffmpeg` + `ffprobe`** *(optional)* — required for local utilities such as `--angles-360-video`, `--concat-videos`, timestamped frame extraction, and `--verify-video`. Set `FFMPEG_PATH` / `FFPROBE_PATH` to override discovery.
- macOS, Linux, or Windows

---

## Installation

### Node CLI (default)

For most agents and human users:

```bash
npm install -g @sogni-ai/sogni-creative-agent-skill@latest
sogni-agent --version
```

Then point your agent/runtime at this repository's [`SKILL.md`](./SKILL.md). When an install request is ambiguous, install the CLI and skill source together — that's the supported default.

### Claude Code plugin

The Claude Code plugin shells out to the `sogni-agent` CLI installed above, so both steps are required. From inside Claude Code, register the marketplace and install the plugin:

```text
/plugin marketplace add Sogni-AI/sogni-creative-agent-skill
/plugin install sogni-creative-agent@sogni
```

The first command registers a `sogni` marketplace with one plugin entry (`sogni-creative-agent`) backed by a lean Claude-Code-focused [`plugin-skills/sogni-creative-agent/SKILL.md`](./plugin-skills/sogni-creative-agent/SKILL.md); the second installs the plugin into Claude Code. The full skill spec still lives at the repository root [`SKILL.md`](./SKILL.md).

> **Pick one registration per machine.** Install either this plugin **or** the personal skill that `npx setup-sogni-agent-skill` writes to `~/.claude/skills/` — not both. With both installed, Claude Code lists two near-identical skills, which wastes context and makes skill selection ambiguous.

### OpenAI Codex CLI

For the namespaced Sogni skills, register the marketplace and install the plugin:

```bash
codex plugin marketplace add Sogni-AI/sogni-creative-agent-skill
codex plugin add sogni-creative-agent@sogni
```

Start a new Codex session, then invoke Loop Maker directly:

```text
$sogni-creative-agent:loop-maker ./images
```

In the Codex app, type `@`, choose **Sogni Loop Maker**, and select its starter prompt.

For local development, replace the GitHub shorthand in `codex plugin marketplace add` with the absolute path to this repository.

Alternatively, the `npx` installer writes the full monolithic skill to `~/.codex/skills/sogni-creative-agent-skill/`, which Codex discovers automatically:

```bash
npx setup-sogni-agent-skill --only=codex
```

Start Codex once before running the installer so `~/.codex/` exists. If the selected local runtime is not detected, setup exits before installing anything.

Restart Codex (or start a new session) and ask it to "generate an image of a sunset" — the skill shells out to the globally installed `sogni-agent`. To remove this personal-skill install later: `npx setup-sogni-agent-skill --uninstall --only=codex`.

### Hermes Agent

[Hermes Agent](https://hermes-agent.nousresearch.com/) can install the dedicated,
security-scannable bundle directly from its Skills Hub (via skills.sh):

```bash
hermes skills install skills-sh/sogni-ai/sogni-creative-agent-skill/sogni-creative-agent-skill
npm install -g @sogni-ai/sogni-creative-agent-skill@latest
sogni-agent-hermes doctor
```

Then `/reset` the Hermes session so it picks up the new skill. The Hub bundle
lives at
[`.agents/skills/sogni-creative-agent-skill/`](./.agents/skills/sogni-creative-agent-skill/)
and contains only the agent instructions and the references they load, keeping
the CLI runtime and development files outside Hermes' skill security scan.

For a combined CLI + personal-skill setup, the `npx` installer still places the
skill at `~/.hermes/skills/media/sogni-creative-agent-skill/`:

```bash
npx setup-sogni-agent-skill --only=hermes
```

Start Hermes once before running the installer so `~/.hermes/` exists. If the
selected local runtime is not detected, setup exits before installing anything.

### OpenClaw plugin

The skill is published on ClawHub, so the simplest install is:

```bash
openclaw skills install sogni-creative-agent-skill
```

To install as a code plugin instead, use OpenClaw's `npm:` source prefix (the npm package is scoped, so a bare `openclaw plugins install sogni-creative-agent-skill` will not resolve it):

```bash
openclaw plugins install npm:@sogni-ai/sogni-creative-agent-skill
```

The installed plugin loads its behavior from [`SKILL.md`](./SKILL.md) via [`openclaw.plugin.json`](./openclaw.plugin.json). The `npx setup-sogni-agent-skill` installer does **not** configure OpenClaw — use the command above (or the local-link flow below) instead.

> **API key under OpenClaw:** the plugin config holds non-secret defaults only (models, timeouts, paths) — it does **not** carry your API key. Provide `SOGNI_API_KEY` via the environment the OpenClaw gateway passes to the CLI, or save it to `~/.config/sogni/credentials` (`SOGNI_API_KEY=<your-key>`). This keeps your key out of plugin config files.

For a local checkout that you want to update continuously, link the minimal OpenClaw surface (`.openclaw-link/`) — not the repository root, which contains development tests that OpenClaw correctly blocks during plugin safety scanning:

```bash
cd /path/to/sogni-creative-agent-skill
npm install
npm link
npm run openclaw:sync
openclaw plugins install -l "$PWD/.openclaw-link"
openclaw gateway restart
```

To update the linked install later:

```bash
cd /path/to/sogni-creative-agent-skill
git pull --ff-only
npm install
npm link
npm run openclaw:sync
openclaw gateway restart
```

The generated `.openclaw-link/` directory is only for OpenClaw; Hermes, Manus, and other skill-based agents should continue using the root [`SKILL.md`](./SKILL.md).

#### OpenClaw configuration

When loaded through OpenClaw, this skill reads plugin defaults from OpenClaw config; CLI flags always override them. The supported config schema is defined in [`openclaw.plugin.json`](./openclaw.plugin.json) and includes default models, video workflow models, hosted API defaults (`apiBaseUrl`, `defaultLlmModel`, `defaultTaskProfile`, `defaultApiMaxTokens`, `defaultApiThinking`, `defaultApiToolMode`, workflow cost defaults), token type, seed strategy, timeouts, and media paths. If your OpenClaw config lives elsewhere, set `OPENCLAW_CONFIG_PATH`.

### ChatGPT (Custom GPT)

Run `npx setup-sogni-agent-skill --only=chatgpt` to print step-by-step instructions for creating a ChatGPT Custom GPT whose Instructions embed this skill. Note that ChatGPT cannot run the local CLI; the Custom GPT path covers prompt-side behavior only.

### Manus / other SKILL.md frameworks

Point the agent at this repository's [`SKILL.md`](./SKILL.md) for behavior guidance and [`llm.txt`](https://raw.githubusercontent.com/Sogni-AI/sogni-creative-agent-skill/main/llm.txt) for install/setup help. The agent should invoke the globally installed `sogni-agent` CLI by default.

### Manual install from source

```bash
gh repo clone Sogni-AI/sogni-creative-agent-skill
cd sogni-creative-agent-skill
npm install
```

### Host launchers

The package installs one launcher shim per host alongside `sogni-agent`. Each shim is the same CLI with the same flags and output — it only tags the request with the agent framework that ran it, so Sogni can tell a Codex render from a Claude Code render:

| Host | Command | Reported framework |
| --- | --- | --- |
| Hermes | `sogni-agent-hermes` | `hermes-agent` |
| OpenAI Codex CLI | `sogni-agent-codex` | `codex` |
| Claude Code | `sogni-agent-claude-code` | `claude-code` |
| OpenClaw | `sogni-agent` | `openclaw` (detected from `OPENCLAW_PLUGIN_CONFIG`) |
| Anything else | `sogni-agent` | `unknown` |

The Claude Code and Codex plugin surfaces already pin their launcher, and OpenClaw is detected automatically, so this mostly matters for Hermes and other plain [`SKILL.md`](./SKILL.md) installs: use `sogni-agent-hermes` wherever the docs say `sogni-agent`. Everything works normally through bare `sogni-agent` — the render is just attributed to `unknown`. Falling back to `sogni-agent` is always safe if a shim is not on `PATH`.

### Verify your install

Every install path above ends the same way — run the built-in health check:

```bash
sogni-agent doctor
```

It verifies the Node version, API credentials (and their file permissions), config-dir writability, `ffmpeg` availability, live authentication, and whether a newer version is available. `sogni-agent doctor --json` emits the same checks for agents. If anything is marked `✗`, the detail line says exactly how to fix it.

### Upgrading safely from inside an agent

When upgrading from inside an agent runtime, prefer direct package-manager or existing-checkout commands. Avoid asking the agent to build a clone-or-pull shell bootstrap script with `set -e`, `bash -c`, `sh -c`, or an inline repository URL — some sandboxes correctly route those through approval and the install will stall.

For a global CLI:

```bash
npm install -g @sogni-ai/sogni-creative-agent-skill@latest
sogni-agent --version
```

For an existing local checkout:

```bash
DEST="$HOME/Documents/git/sogni/sogni-creative-agent-skill"
git -C "$DEST" pull --ff-only
npm --prefix "$DEST" install
```

If the checkout is missing, use the npm install path above or explicitly approve a clone.

---

## Claude Desktop

Claude Desktop can't run skills against your local files, so Sogni ships as a local MCP server instead. Two ways to install:

**Recommended — one command (also installs the CLI, saves your API key, and offers to install ffmpeg):**

    npx setup-sogni-agent-skill

This registers the Sogni tools in `claude_desktop_config.json`. Fully quit and reopen Claude Desktop afterwards. Generated images display inline in the chat automatically.

**Manual — drag-and-drop bundle:** download `sogni-creative-agent.mcpb` from the GitHub Releases page and drop it onto Claude Desktop's Settings → Extensions page. You'll be prompted for your Sogni API key (stored in the OS keychain) unless you've already run the installer.

Don't use both — you'd get duplicate Sogni tools. The extension wraps the same globally installed `sogni-agent` CLI used by Claude Code, so personas, memories, and credentials are shared.

Video/audio editing features need ffmpeg on your machine; the `npx` installer offers to install it for you.

### Also works in OpenAI Codex

The same local MCP server runs in OpenAI Codex — the Codex CLI and IDE extension read MCP servers from `~/.codex/config.toml`. With the CLI installed globally (`npm i -g @sogni-ai/sogni-creative-agent-skill`), register it and start a new Codex session:

```bash
codex mcp add sogni-creative-agent -- node "$(npm root -g)/@sogni-ai/sogni-creative-agent-skill/desktop-extension/server/index.mjs"
```

Or write the `~/.codex/config.toml` entry yourself (use the absolute path from `npm root -g`):

```toml
[mcp_servers.sogni-creative-agent]
command = "node"
args = ["/opt/homebrew/lib/node_modules/@sogni-ai/sogni-creative-agent-skill/desktop-extension/server/index.mjs"]
```

Codex also runs the Skill natively (see [OpenAI Codex CLI](#openai-codex-cli)) — pick one integration per machine; running both gives Codex duplicate Sogni tools. The server finds your globally installed `sogni-agent`, ffmpeg, and saved credentials on its own, so no `env` block is needed.

---

## Setup (Sogni API key)

1. Get your API key from [dashboard.sogni.ai](https://dashboard.sogni.ai) (open the account menu).
2. Save it to a credentials file:

   ```bash
   mkdir -p ~/.config/sogni
   cat > ~/.config/sogni/credentials << 'EOF'
   SOGNI_API_KEY=your_api_key
   EOF
   chmod 600 ~/.config/sogni/credentials
   ```

You can also skip the file and export `SOGNI_API_KEY` in your environment.

### Filesystem path overrides

Defaults live under `~/.config/sogni/` for credentials, last-render metadata, personas, memories, and personality.

**Running several agents at once** (Claude Code, Codex, OpenCode, hermes, ...) works out of the box: each process leases its own stable app ID from a persistent slot pool in `~/.config/sogni/app-ids/`, so concurrent runs never fight over one socket identity (SWITCH_CONNECTION 4015) and routine runs do not create unnecessary IDs (error 4061). Leases are released on exit and reclaimed automatically if a process dies. Long-lived daemons should pin their own `SOGNI_APP_ID` to stay out of the shared pool, and each harness can set its own `SOGNI_LAST_RENDER_PATH` so `--last` stays per-tool. Override individual paths with:

| Variable | Purpose |
|----------|---------|
| `SOGNI_CREDENTIALS_PATH` | Custom credentials file |
| `SOGNI_APP_ID` | Pinned app ID (ephemeral/container homes and long-lived daemons; skips the pool) |
| `SOGNI_APP_ID_PATH` | Legacy single app-ID file mode for callers that manage their own concurrency |
| `SOGNI_APP_ID_POOL_DIR` | Persistent app-ID slot pool for concurrent agents (default: `~/.config/sogni/app-ids/`) |
| `SOGNI_APP_ID_POOL_MAX` | Maximum concurrent app-ID slots (default: 32) |
| `SOGNI_LAST_RENDER_PATH` | Where last-render state is persisted; give each agent harness its own file so `--last` never reads another tool's render |
| `SOGNI_MODEL_CATALOG_URL` | Model catalog API base URL (default: `https://api.sogni.ai/v1/model-catalog`) |
| `SOGNI_MODEL_CATALOG_CACHE_PATH` | Base path for the five-minute model catalog caches and ETags |
| `SOGNI_MEDIA_INBOUND_DIR` | Directory used by `--list-media` |
| `OPENCLAW_CONFIG_PATH` | OpenClaw config file location |
| `FFMPEG_PATH` | Custom `ffmpeg` binary |

---

## Usage

Claude Code plugin users can launch the complete folder-to-loop workflow with one skill invocation:

```text
/sogni-creative-agent:loop-maker ./images
/sogni-creative-agent:loop-maker ./images start=cover.jpg music="subtle tropical cyberpunk electronica" output=launch-loop.mp4
```

Codex CLI and IDE users can invoke the same bundled skill with `$`:

```text
$sogni-creative-agent:loop-maker ./images
$sogni-creative-agent:loop-maker ./images start=cover.jpg music="subtle tropical cyberpunk electronica" output=launch-loop.mp4
```

The skill visually removes repeated concepts from the active sequence, renders one direct LTX first-frame/last-frame clip per image pair, closes the loop, generates a soundtrack longer than the picture, and verifies anchors, interior motion, streams, and full-file decoding before delivery. Original source images are preserved. The default stack is Sogni plus the bundled FFmpeg wrappers; HyperFrames and Remotion are optional only for explicitly requested text, overlays, or compositor effects. True 360 novel-view synthesis is deliberately excluded from this workflow because a direct single-image LTX prompt does not reliably create camera orbit geometry.

```bash
# Image generation
sogni-agent -Q hq -o dragon.png "a dragon eating tacos"

# Edit an image
sogni-agent -c subject.jpg "add a neon cyberpunk glow"

# Photobooth face transfer
sogni-agent --photobooth --ref face.jpg "80s fashion portrait"

# Text-to-video (t2v) with native dialogue
sogni-agent --video 'A narrator says "welcome to the story" as ocean waves crash'

# Short-side resolution targeting (preserves the inherited aspect ratio)
sogni-agent --video --target-resolution 768 \
  "A calm cinematic shot of lanterns drifting across a night lake"

# Seedance 2.0 4K (4-15s vendor video path with native audio)
sogni-agent --video -m seedance2 --target-resolution 2160 --duration 8 \
  "A polished product reveal with native ambient sound"

# Seedance multimodal context with public HTTPS references
sogni-agent --video -m seedance2 --workflow t2v \
  --ref https://cdn.example.com/product.png \
  --ref-video https://cdn.example.com/motion.mp4 \
  --ref-audio https://cdn.example.com/music.m4a \
  "Use @Image1 for product identity, @Video1 for camera movement, and @Audio1 for music rhythm"

# Alibaba Wan 3 unified video (2-30s, fixed 30fps, native audio, 480P/720P/1080P)
sogni-agent --video -m wan3 --target-resolution 1080 --duration 8 \
  'A presenter walks through a detailed studio and says "Welcome."'
sogni-agent --video -m wan3 --ref first.png --ref-end last.png \
  "Move smoothly between the supplied endpoint frames"
sogni-agent --video -m wan3 --workflow ia2v --ref presenter.png --ref-audio dialogue.mp3 \
  "Use Image 1 for the presenter and Audio 1 for the performance"
sogni-agent --video -m wan3 --workflow v2v --ref-video source.mp4 \
  "Edit Video 1 into a rainy night scene while preserving its action"

# MiniMax H3 standard and 4-step Turbo video (native 32 kHz stereo audio)
sogni-agent --video -m minimax-h3 --duration 10 "<three-field H3 prompt>"
sogni-agent --video -m minimax-h3-i2v --ref first.png --duration 8 "<I2V preamble plus three-field H3 prompt>"
sogni-agent --video -m minimax-h3-r2v --ref identity.png -c wardrobe.png \
  --ref-video motion.mp4 --ref-audio voice.m4a \
  "<six-field Ref2VA prompt>"
sogni-agent --video -m minimax-h3-turbo --duration 8 "<three-field H3 prompt>"
sogni-agent --video -m minimax-h3-turbo --sampler sa_solver --duration 8 "<A/B variant of the same H3 prompt>"
sogni-agent --video -m minimax-h3-flf2v-turbo --ref first.png --ref-end last.png --duration 8 "<FLF2V preamble plus three-field H3 prompt>"

# Image-to-video (i2v; defaults to wan_v2.2-14b-fp8_i2v_lightx2v)
sogni-agent --video --ref cat.jpg "gentle camera pan"

# Animate two images together (first frame → last frame; defaults to
# ltx25-22b-int8_i2v_distilled using the standard first/last-frame template)
sogni-agent --video --ref first.png --ref-end last.png \
  "the opening frame flows smoothly into the final frame"

# Image+audio-to-video (auto-routes to LTX-2.5 ia2v)
sogni-agent --video --ref cover.jpg --ref-audio song.mp3 \
  "music video with synchronized motion"

# Direct music generation
sogni-agent --music --duration 30 \
  "uplifting cinematic synthwave theme for a product launch"

# Song with lyrics and musical controls
sogni-agent --music --lyrics "Rise with the morning light" --bpm 128 \
  --keyscale "C major" --output-format mp3 "bright indie pop chorus"

# LTX-2.3 voice identity / persona
sogni-agent --video --reference-audio-identity voice.webm \
  'NARRATOR: "This is my voice."'

# Hosted chat with Sogni creative-agent tools (/v1/chat/completions)
sogni-agent --api-chat \
  "Create a 4-shot product video concept for a red sneaker"

# Hosted chat with image vision plus media-reference metadata
sogni-agent --api-chat --ref product.jpg \
  "Turn this into a launch poster and describe the edit plan"

# Hosted chat controls and model discovery
sogni-agent --api-chat --task-profile reasoning --no-thinking \
  "Plan a concise multi-step product launch workflow"
sogni-agent --list-api-models

# Live Supernet media model discovery
sogni-agent --list-models
sogni-agent --search-models spicy
sogni-agent --list-models --model-media image --model-tag uncensored

# Live LoRA catalog discovery (IDs, strength ranges, bipolar directions)
sogni-agent --list-loras --lora-catalog-model krea2_turbo_fp8_scaled
sogni-agent --search-loras lighting
sogni-agent --json --list-loras --lora-category character

# Durable hosted chat run with SSE progress events
SOGNI_SKILL_USE_SDK_TRANSPORT=1 sogni-agent --durable-chat \
  "Create a product launch storyboard and render the first hero image"

# Durable hosted workflow (/v1/creative-agent/workflows)
sogni-agent --api-workflow \
  --video-prompt "The camera slowly pushes in as the sketch comes alive" \
  "A graphite robot sketch on a drafting table"

# Durable workflow with a media reference and a cost ceiling
sogni-agent --api-workflow --ref https://cdn.example.com/sketch.png \
  --workflow-max-cost 25 --confirm-cost \
  --video-prompt "The camera slowly pushes in as the sketch comes alive" \
  "Animate the referenced sketch"

# Exact durable workflow input
sogni-agent --api-workflow --workflow-input @workflow.json

# Storyline -> GPT Image 2 storyboard sheet -> Seedance video sequence
sogni-agent --api-workflow storyboard-video --storyboard-frames 6 --duration 12 -Q hq \
  "Create a 9:16 bakery launch video with a neon street-window reveal"

# Sogni Intelligence replay records
sogni-agent --list-replays 20
sogni-agent --get-replay run_abc123 --json

# Opt in to SDK transport for hosted operations (durable workflows + chat).
# Validates restEndpoint/socketEndpoint via the skill's SSRF guard, then
# calls the SDK workflow/chat methods directly.
# Falls back to the legacy SSRF-validated fetch path when the env is unset.
export SOGNI_SKILL_USE_SDK_TRANSPORT=1
sogni-agent --api-workflow storyboard-video "10s neon city flyover"

# Local segment + concat with external soundtrack
sogni-agent --video --workflow v2v --ref-video dance.mp4 \
  --video-start 10 --duration 8 --controlnet-name pose -o ./clip-2.mp4 \
  "robot dancing"
sogni-agent --concat-videos ./final.mp4 ./clip-1.mp4 ./clip-2.mp4 \
  --concat-audio song.mp3 --concat-audio-start 0

# Balances and help
sogni-agent --balance
sogni-agent --help
```

> Prefer `.webm`, `.m4a`, or `.mp3` voice clips. Local `.wav` clips are normalized to `.m4a` before upload when `ffmpeg` is available.
>
> For local multi-clip workflows, use the built-in FFmpeg wrappers (`--video-start`, `--audio-start`, `--audio-duration`, `--concat-videos`, `--concat-audio`) over raw shell commands — they produce safer, more reproducible results.

---

## CLI Reference

Run `sogni-agent --help` for the full CLI. Below are the options and tables most agents and users reach for first.

### Common options

| Option | Use |
|--------|-----|
| `-Q fast\|hq\|pro` | Pick image quality without memorizing model IDs |
| `-o <path>` | Save output locally |
| `-c <path>` | Provide image context for edits |
| `--video` | Generate video instead of image |
| `--music` | Generate music/audio instead of image |
| `--lyrics`, `--bpm`, `--keyscale`, `--timesig` | Music generation controls |
| `--ref`, `-c`, `--ref-audio`, `--ref-video` | Frame/loose image/audio/video references; audio/video repeat for H3 r2v and Seedance loose refs |
| `--target-resolution <px>` | Target the short side, preserving aspect ratio |
| `--workflow <type>` | Force `t2v`, `i2v`, `r2v`, `s2v`, `ia2v`, `a2v`, `v2v`, or animate workflows |
| `--generate-audio`, `--no-generate-audio` | Keep or strip MiniMax H3's generated audio track; also controls generated-keyframe workflows |
| `--sampler <name>` | Image/music sampler; FL2VA H3 Turbo accepts `euler`, `er_sde`, or `sa_solver` and defaults to `er_sde` on Socket. Ref2VA Turbo accepts Euler only. The CLI omits this field unless explicitly set. |
| `--api-chat` | Use `/v1/chat/completions` with Sogni creative-agent tools |
| `--api-workflow` | Start a `/v1/creative-agent/workflows` durable workflow with explicit `input.steps`; optional `storyboard-video` preset |
| `--workflow-input <json\|@path>` | Explicit durable workflow input JSON. Use `@path` to load JSON from a file. |
| `--workflow-max-cost <n>`, `--confirm-cost`, `--no-confirm-cost` | Set durable workflow capacity ceiling and explicit cost confirmation |
| `--storyboard-frames <n>` | Beat count for `--api-workflow storyboard-video` |
| `--video-prompt`, `--negative-prompt`, `--generate-audio`, `--expand-prompt` | Generated-keyframe durable workflow step controls |
| `--watch-workflow`, `--list-workflows`, `--get-workflow <id>`, `--workflow-events <id>`, `--stream-workflow <id>`, `--cancel-workflow <id>`, `--resume-workflow <id>` | Manage durable workflows |
| `--api-tools <mode>`, `--no-api-tool-execution`, `--llm-model <id>`, `--task-profile <profile>`, `--max-tokens <n>`, `--thinking` / `--no-thinking`, `--api-base-url <url>` | Tune hosted API requests |
| `--list-api-models`, `--get-api-model <id>` | Inspect Sogni Intelligence LLM models |
| `--list-models [query]`, `--search-models <query>` | List or search currently available Supernet image, video, and audio models |
| `--model-media <type>`, `--model-network <network>` | Filter live model discovery by media or Fast/Relaxed network |
| `--model-tag <tag>` | Filter by an official catalog tag such as `spicy` or `uncensored`; repeat for AND matching |
| `--list-loras [query]`, `--search-loras <query>` | List or search the live LoRA catalog with each LoRA's hard range, recommended range, default, and slider direction |
| `--lora-catalog-model <id>`, `--lora-category <category>` | Filter LoRA discovery to one model's compatible LoRAs or one catalog category |
| `--list-replays [n]`, `--get-replay <id>`, `--ingest-replay <json\|@path>` | Manage Sogni Intelligence replay records (use `@path` to load JSON from a file) |
| `--persona <name>` | Use a saved persona |
| `--concat-videos <out> <clips...>` | Stitch clips locally with FFmpeg |
| `--extract-first-frame`, `--extract-frame-at`, `--extract-last-frame` | Extract visual-QA frames through safe FFmpeg wrappers |
| `--verify-video <path>` | Probe streams and fully decode a final video before delivery |
| `--last`, `--last-image` | Inspect last render / reuse last image as context or video reference |
| `--strict-size` | Fail instead of auto-adjusting video size |
| `--json` | Emit structured output for agents |
| `-n <count>` | Multiple outputs per call (safety-capped at 16; raise deliberately with `SOGNI_MAX_COUNT`) |
| `doctor` / `--doctor` | Install health check: Node, credentials, ffmpeg, auth, version (`--json` for agents) |
| `self-update` | Upgrade the CLI via the detected package manager |
| `--whats-new [version]` | Show bundled CHANGELOG entries (everything after `<version>` if given) |
| `--snooze-update` | Snooze the pending-update reminder (1 day → 2 days → 1 week) |
| `--no-update-check` | Disable the background update check for this run (`SOGNI_NO_UPDATE_CHECK=1` to disable always) |
| `--video-model <id>` | Override the i2v model used by `--angles-360-video` |
| `--memory-category <c>` | Category for `--memory-set`: `preference` (default), `fact`, or `context` |

### Quality presets

Skip remembering model IDs — `--quality` / `-Q` selects the right model, steps, and dimensions for image generation:

| Preset | Model | Steps | Size | Speed |
|--------|-------|-------|------|-------|
| `fast` | `z_image_turbo_bf16` | 8 | 512×512 | ~5–10s |
| `hq` | `z_image_turbo_bf16` | default | 768×768 | ~10–15s |
| `pro` | `qwen_image_2512_fp8` | 20 | 1024×1024 | ~30 sec |

Explicit `--model` overrides the preset's model. Explicit `-w`/`-h` overrides dimensions.

### Recommended models

Prefer `-Q fast|hq|pro` for images and automatic workflow routing for video. Pass `-m` only when you need a specific model family.

| Need | Recommended selector |
|------|----------------------|
| Default images | `z_image_turbo_bf16` |
| OpenAI GPT Image generation, editing, or strong text rendering | `gpt-image-2` |
| Highest-quality images | `qwen_image_2512_fp8` (or `-Q pro`) |
| Image editing | `qwen_image_edit_2511_fp8_lightning` |
| Deterministic image upscaling through 16K | `rtx_vsr_pro` via `--upscale` |
| Dark Beast Krea 2 images | `dark_beast_krea2_fp8` |
| Identity-preserving Krea image edits | `krea2_identity_edit_v1_2` |
| Uncensored identity-preserving Krea edits | `dark_beast_krea2_identity_edit_v1_2` |
| Photobooth face transfer | `coreml-sogniXLturbo_alpha1_ad` |
| Direct music generation | `ace_step_1.5_xl_turbo` (or `--music-model turbo`) |
| Music with stronger lyric handling | `ace_step_1.5_xl_sft` (or `--music-model sft`) |
| MiniMax H3 text-to-video with native stereo audio | `minimax-h3` or `minimax-h3-t2v` |
| MiniMax H3 image-to-video | `minimax-h3-i2v` |
| MiniMax H3 first-frame → last-frame video | `minimax-h3-flf2v` with `--ref A --ref-end B` |
| MiniMax H3 reference-to-video | `minimax-h3-r2v` with up to 9 images, 3 videos, 3 audios / 12 files total |
| MiniMax H3 Turbo text-to-video | `minimax-h3-turbo` or `minimax-h3-t2v-turbo` |
| MiniMax H3 Turbo image-to-video | `minimax-h3-i2v-turbo` with `--ref` |
| MiniMax H3 Turbo first-frame → last-frame video | `minimax-h3-flf2v-turbo` with `--ref A --ref-end B` |
| MiniMax H3 Turbo reference-to-video | `minimax-h3-r2v-turbo` with up to 9 images, 3 videos, 3 audios / 12 files total |
| Text-to-video with native dialogue/audio | `ltx25` (Distilled) or `ltx25-22b-int8_t2v_dev` (Dev/HQ) |
| Explicit uncensored image-to-video on 30GB+ GPUs | `ltx23-eros` with `--no-filter` |
| Image or first/last frames to video | `ltx25-i2v` (FLF shares the I2V model ID) |
| Image+audio-to-video | `ltx25-ia2v` |
| Audio-to-video | `ltx25-a2v` |
| Video-to-video with ControlNet/edit templates | `ltx25-v2v` |
| Seedance text-to-video | `seedance2` for up to native 4K; `seedance2-mini` for the lower-cost 720p path; `seedance2-fast` for the legacy 720p fast path |
| Seedance video-to-video without ControlNet | `seedance2-v2v` |
| Seedance 2.5 single clip up to 30s (480p/720p only) | `seedance2-5` (`seedance2-5-ia2v` / `seedance2-5-v2v` for image+audio and v2v/editing) |
| Wan 3 unified text, frame, reference, audio, or video generation | `wan3` / `wan3.0-video` |
| Face lip-sync with uploaded audio | `wan_v2.2-14b-fp8_s2v_lightx2v` |

`gpt-image-2` supports flexible OpenAI image sizes up to 3840 px on either edge, max 3:1 aspect ratio, and total pixels from 655,360 to 8,294,400; the API snaps dimensions to valid multiples of 16. For image editing with `gpt-image-2`, you can pass up to 16 context images. For likeness-preserving edits of a referenced person or character, agents default to Krea 2 Identity Edit (`krea2_identity_edit_v1_2`) unless you explicitly choose another model. It and Dark Beast Krea 2 Identity Edit (`dark_beast_krea2_identity_edit_v1_2`) use `-c/--context`, accept 1-2 references at 512-2048 px, and leave execution defaults to the current model tier.

Music generation uses `--music` and outputs `mp3` by default. `--audio` remains the video-reference alias for `--ref-audio`; use `--music` or `--generate-music` for direct audio-only generation.

Seedance 2.5 loose-reference operations use an explicit task contract. `reference` accepts any loose image/video/audio set (including audio-only); `edit` and `extend` require `@Video1` through `--ref-video` and reject first/last-frame anchors. Edit inherits the source aspect ratio and requires its source duration, while extend inherits the ratio and uses the requested continuation duration:

```bash
sogni-agent --video -m seedance2-5 --seedance-task-type reference --ref-audio voice.m4a "Use @Audio1 to guide a new performance"
sogni-agent --video -m seedance2-5-v2v --seedance-task-type edit --ref-video source.mp4 --duration 8 --target-resolution 720 "Edit @Video1 while preserving its subject and timing"
sogni-agent --video -m seedance2-5-v2v --seedance-task-type extend --ref-video source.mp4 --duration 8 --target-resolution 720 "Extend @Video1 after its ending"
```

---

## Video Sizing & Aspect Ratios

- **WAN 2.2 models** use dimensions divisible by 16, min 480 px, max 1536 px.
- **Wan 3** (`wan3.0-video`) is a Premium Spark Alibaba model with fixed 30 fps, 2–30 s output, native audio, 480P/720P/1080P tiers, and `16:9`, `4:3`, `1:1`, `3:4`, or `9:16` output. It accepts one first frame plus an optional last frame, or a mutually exclusive loose-reference set of up to 10 images, 5 videos, 5 audio clips, and 20 files total. Each video/audio reference is 1–15 s; aggregate input video is at most 15 s and input-video duration plus output duration is at most 30 s. Send no negative prompt, steps, guidance, sampler, scheduler, ControlNet, or mask.
- **MiniMax H3 and H3 Turbo** use a 32 px grid, fixed 24 fps, native 32 kHz stereo audio, 124–362 frames (`124 + n×17`, i.e. 5.17–15.08 s), and a 1,032,192-pixel render cap. Standard and FL2VA Turbo normally default to 1344×768 or 768×1344; Ref2VA Turbo defaults to 960×544 but supports other valid shapes. `--duration` snaps to the frame grid, so H3 delivers the nearest grid point rather than the exact requested seconds. Standard H3 uses 20 steps; Turbo uses 4 steps. FL2VA H3 Turbo defaults to `er_sde` on Socket, and the CLI omits the sampler unless `--sampler` is passed; FL2VA A/B tests may select `euler`, `er_sde`, or `sa_solver`. Ref2VA Turbo follows its exact upstream Euler/simple recipe and accepts only `--sampler euler`. Guidance 1 is fixed and there is no negative-prompt input. Base and Turbo t2v/i2v/flf2v prompts use the exact ordered three fields; standard and Turbo Ref2VA use exactly `subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape`, and `non_diegetic_music`. Both Ref2VA selectors accept up to 9 images, 3 videos, and 3 audios, capped at 12 files; at least one visual reference is required, audio-only input is invalid, and r2v is never inferred. `--no-generate-audio` strips the jointly generated track from the result. This is the 768p-class open-weights release, not MiniMax's hosted 2K stage. FL2VA/Turbo and image-only R2V require 32 GB-class workers; video-conditioned R2V requires above 40 GB. See `references/video-prompting.md` § MiniMax H3 Prompting for the exact contracts.
- **LTX family** (`ltx2-*`, `ltx23-*`, `ltx25-*`) uses dimensions divisible by 64. The current wrapper caps non-WAN video dimensions at 2048 px on the long side.
- **Seedance** runs at fixed 24 fps. The 2.0 family (`seedance2`, `seedance2-mini`, `seedance2-fast`) supports 4–15 s durations; full `seedance2` supports native 4K via `--target-resolution 2160` while `seedance2-mini` and `seedance2-fast` remain capped to the 720p lower-resolution path. `seedance2-5` renders 4–30 s single clips but caps at 480p/720p (no 1080p or 4K). Other default/WAN paths support up to 10 s; LTX and WAN animate workflows support up to 20 s.
- For spoken dialogue, budget roughly 3 words per second plus about 1 second for each meaningful acting beat or pause. Keep quoted speech under the model's hard per-clip word budget.
- The script auto-normalizes video sizes to satisfy these constraints.
- Use `--target-resolution <px>` for bare resolution requests like "720p" — it targets the short side and preserves the inherited aspect ratio.
- Natural-language aspect requests like "portrait", "square", "16:9", or "9:16" are inferred when width/height aren't explicitly set. Combined requests like "720p 9:16" keep the requested short side while applying the requested shape.
- For i2v (and any workflow using `--ref` / `--ref-end`), the client wrapper resizes the reference image with strict aspect-fit (`fit: inside`) and uses the *resized* dimensions as the final video size. Because that resize uses rounding, a "valid" requested size can still produce an invalid final size (example: `1024×1536` requested, but ref becomes `1024×1535`). `sogni-agent` detects this for local refs and auto-adjusts to a nearby safe size.
- **LTX-2.5 first/last-frame default:** `--ref` + `--ref-end` with no `-m` uses `ltx25-22b-int8_i2v_distilled` and the dedicated FLF workflow template. It shares the I2V public model ID and does not attach the LTX-2.3 transition LoRA. Pin `ltx23-22b-fp8_i2v_distilled` explicitly only when the legacy transition-LoRA behavior is required.
- **Private mature-theme creativity:** optional uncensored LTX-2.3 video models are available for adults who explicitly want them. They remain opt-in and are not part of ordinary model recommendations; the agent loads their specialized guidance only for a relevant request.
- Pass `--strict-size` to fail instead — the script will print a suggested size.

V2V defaults mirror Sogni Chat workflow tuning: `canny`, `pose`, and `depth` use ControlNet strength `0.85` with detailer assist; `detailer` uses strength `1.0`. LTX 2.5 `pose` requires both `--ref-video` for the motion/pose sequence and `--ref` for the subject appearance; explicit LTX 2.3 rollback keeps its existing optional-image behavior. Use `-m seedance2-v2v` for Seedance V2V without ControlNet. Seedance accepts public HTTPS image, video, and audio references that pass CLI URL safety checks; localhost and private-network URLs are rejected before forwarding. The 2.0 family requires audio references to be paired with an image or video; Seedance 2.5 reference mode permits audio-only input.

The LTX-2.5 v2v selector `ltx25-v2v` supports two extra control modes: **`outpaint`** extends/expands the video canvas (e.g. make a vertical clip widescreen, or add space in a direction) — it is positional and mask-free, anchored with a position (`center|top|bottom|left|right`) and an optional target aspect ratio (`16:9|9:16|1:1|4:3|3:4|21:9`), and the canvas only grows, never crops; **`inpaint`** regenerates a masked region of the source video and **requires a mask image** (white pixels = region to regenerate) in direct CLI/SDK mode. The hosted `video_to_video` tool selects these with `controlMode` `outpaint`/`inpaint` and can derive an inpaint mask when the user did not upload one. The direct CLI and sogni-client SDK example expose them via `--control-type` / `control-type` (`canny|pose|depth|detailer|outpaint|inpaint`), with `--outpaint-position` for outpaint and `--mask` for inpaint. Pin `ltx23-v2v` only for rollback. See `references/video-editing.md` for details.

---

## LTX-2.x Prompting Guide

When you use LTX-2.5 or an LTX-2.3 rollback model, do **not** feed it short tag prompts like `"cinematic drone shot over tropical cliffs"`. LTX renders more reliably from a dense natural-language scene description.

- Write one unbroken paragraph — no line breaks, bullets, headers, or tag blocks.
- Use 4–8 flowing present-tense sentences describing one continuous shot, not a montage.
- Start with shot scale and scene identity, then cover environment, time of day, textures, and named light sources.
- Keep characters and objects concrete and stable; describe one main action thread from start to finish.
- For dialogue, include the exact spoken words in double quotes with the speaker and delivery identified inline.
- Express mood through visible behavior, motion, and sound cues — not vague adjectives.
- Use positive phrasing. Avoid script formatting, negative prompts, on-screen text/logo requests, and filler words like "beautiful" or "nice".
- Match scene density to clip length. For short clips, describe one main beat, not several actions.

**Example rewrite:**

```text
User ask: "make a 4k video of a woman in a neon alley"

LTX prompt: "A medium cinematic shot frames a woman in her 30s standing in a rain-soaked neon alley at night, violet and amber signs reflecting across the wet pavement while warm steam drifts from street vents. She wears a dark trench coat with damp strands of black hair clinging near her cheek as light glances across the fabric texture and the brick walls behind her. She turns toward the camera and steps forward with measured focus, one hand tightening around the strap of her bag while rain taps softly on the metal fire escape and a distant train hum rolls through the block. The camera performs a slow push-in as her jaw sets and her breathing steadies, maintaining smooth stabilized motion and a tense urban-thriller mood."
```

---

## Photobooth (Face Transfer)

Generate new stylized portraits from a face photo using InstantID ControlNet:

```bash
sogni-agent --photobooth --ref face.jpg "80s fashion portrait"
sogni-agent --photobooth --ref face.jpg -n 4 "LinkedIn professional headshot"
```

Uses SDXL Turbo (`coreml-sogniXLturbo_alpha1_ad`) at 1024×1024 by default. The face image is passed via `--ref` and styled by the prompt. Cannot be combined with `--video` or `-c` / `--context`.

`--photobooth` is face-reference generation, not full-image editing. If the request is "same image, different style" — for example an anime version that must keep the same face, pose, clothing, background, framing, and composition — use Qwen image editing with `-c/--context` instead.

Multi-angle mode (`--multi-angle` / `--angles-360`) auto-builds the `<sks>` prompt and applies the `multiple_angles` LoRA. `--angles-360-video` generates i2v clips between consecutive angles (including last → first) and concatenates them with `ffmpeg` into a seamless loop.

`--balance` / `--balances` does not require a prompt and prints the account username, subscription plan (`Plan: Sogni Unlimited (active)` / `Plan: none`), and current `SPARK` and `SOGNI` balances before exiting. In `--json` mode the payload carries `username` and `subscription` fields (`null` when unavailable). `--doctor` likewise reports the authenticated user and an explicit `plan` check, so a wrong-account API key or a missing subscription is visible at a glance.

---

## Personas, Memory, and Personality

### Personas

Named people with saved reference photos and optional voice clips for identity-preserving generation:

```bash
# Add a persona
sogni-agent --persona-add "Mark" --ref face.jpg --relationship self --description "30s male, brown hair"

# Add with voice clip for video voice cloning
sogni-agent --persona-add "Sarah" --ref sarah.jpg --relationship partner --voice-clip voice.webm

# Generate using a persona (auto-injects photo as context)
sogni-agent --persona "Mark" -o hero.png "superhero in dramatic lighting"

# Video using a persona photo + saved voice identity
sogni-agent --video --persona "Sarah" 'SARAH: "This is my voice."'

# List / remove
sogni-agent --persona-list
sogni-agent --persona-remove "Mark"
```

Stored at `~/.config/sogni/personas/`. Personas resolve by explicit saved name, id, or tag/alias; relationship phrases are not treated as persona identifiers.

### Memory (persistent preferences)

Save preferences that agents respect across sessions:

```bash
sogni-agent --memory-set preferred_style "watercolor and soft lighting"
sogni-agent --memory-set aspect_ratio "16:9"
sogni-agent --memory-list
sogni-agent --memory-remove preferred_style
```

Stored at `~/.config/sogni/memories.json`.

### Personality (custom agent instructions)

Tell the agent how it should behave:

```bash
sogni-agent --personality-set "Be concise, always use cinematic lighting"
sogni-agent --personality-get
sogni-agent --personality-clear
```

Stored at `~/.config/sogni/personality.txt`.

---

## Hosted API Modes

Hosted API modes require `SOGNI_API_KEY`.

**Choosing a mode.** Whatever is driving this CLI is usually a more capable planner than Sogni's hosted model, so prefer to plan yourself and let the server execute: direct-to-SDK flags for one-shot work, and `--api-workflow` with an explicit `--workflow-input` step graph for multi-step/durable work (you author the plan; the server runs it durably with replay — no hosted re-planning). Use `--api-chat` / `--durable-chat` when you deliberately want the hosted model to own a long server-side loop, or when several local files must be uploaded for one turn.

- **`--api-chat`** targets `/v1/chat/completions` with Sogni creative-agent tools and **delegates planning/tool-selection to the hosted model** — reach for it when the caller is a thin client, when you want the hosted model to drive a long server-side tool loop, or when several local files must be uploaded for one turn. The CLI sanitizes prompt-injection markers before forwarding messages and can use the current server-side creative-agent media tools, including video extension, segment replacement, overlays, subtitles, stitch/orbit/dance composition, and generated artifact indexing. Tune with `--api-tools creative-agent|creative-tools|none`, `--no-api-tool-execution`, `--llm-model`, and `--system`.
- **Sogni Intelligence controls** include `--task-profile general|coding|reasoning`, `--max-tokens`, and `--thinking` / `--no-thinking`, which forward to `/v1/chat/completions` as `task_profile`, `max_tokens`, and `chat_template_kwargs.enable_thinking`. Use `--list-api-models` or `--get-api-model <id>` to inspect `/v1/models`.
- **`--durable-chat`** starts a hosted `/v1/chat/runs` record through the SDK transport. Set `SOGNI_SKILL_USE_SDK_TRANSPORT=1` before using it. The CLI streams assistant deltas and de-duplicated per-job progress / ETA / result lines from hosted run events.
- **`--api-workflow`** targets `/v1/creative-agent/workflows` for durable, async workflow records with event streaming and cancellation. Requests carry `input.steps` plus snake_case controls such as `token_type`, `media_references`, `max_estimated_capacity_units`, and `confirm_cost`.
- **`--workflow-input`** forwards exact durable workflow JSON (`{ title?, steps: [...] }`). Use this when you need exact multi-step behavior such as repeated `replace_video_segment` steps with `replacementStartSeconds` / `replacementEndSeconds` for interleaved video slices.
- **`--api-workflow storyboard-video`** generates a storyline, creates a single GPT Image 2 storyboard sheet, then passes that artifact into Seedance as the video reference. The `-Q fast|hq|pro` preset maps to GPT Image 2 low/medium/high quality for that storyboard sheet.
- **Media references** from `-c`, `--ref`, `--ref-end`, `--ref-audio`, `--reference-audio-identity`, and `--ref-video` are forwarded as `media_references` metadata in hosted API requests. API chat also attaches image refs as vision inputs. Local file references are uploaded to Sogni media storage first, then forwarded as retrievable URLs so durable executors do not depend on `data:` URI support. Durable workflow JSON can bind those references into step arguments with `sourceStepId: "$input_media"`. Use direct CLI mode for private media that must not leave the local machine.
- **Cost controls** use `--workflow-max-cost <n>` to reject workflow starts above a capacity-unit ceiling, and `--confirm-cost` / `--no-confirm-cost` to forward explicit billing confirmation.
- Manage runs with `--watch-workflow`, `--workflow-events`, `--stream-workflow`, `--list-workflows`, `--get-workflow`, `--cancel-workflow`, and `--resume-workflow`. Use `--workflow-input` to provide exact durable workflow JSON.
- **Replay records** use `/v1/replay/records`: `--list-replays [limit]`, `--get-replay <runId>`, and `--ingest-replay <json|@path>` expose redacted RunRecord storage for Sogni Intelligence replay/debug viewers.

Override the API origin with `--api-base-url`, `SOGNI_API_BASE_URL`, or `SOGNI_REST_ENDPOINT`.
Hosted API credentials are only sent to `https://api.sogni.ai` by default. Add trusted custom
hosts with `SOGNI_API_ALLOWED_HOSTS`; loopback or non-HTTPS local testing requires
`SOGNI_ALLOW_UNSAFE_API_BASE_URL=1`.

---

## Dynamic Prompt Variations

Generate diverse images in a single call with `{option1|option2|option3}` syntax:

```bash
# 3 images: "a red car", "a blue car", "a green car"
sogni-agent -n 3 "a {red|blue|green} car"

# Multiple groups cycle independently
sogni-agent -n 4 "a {cat|dog} in a {garden|kitchen}"
# -> "a cat in a garden", "a dog in a kitchen", "a cat in a garden", "a dog in a kitchen"
```

Options cycle sequentially per image. Without `{...}` syntax, `-n` produces multiple images with the same prompt.

For video, use the same pattern when every output shares the same source/end assets and settings and only the prompt text varies:

```bash
sogni-agent --video --ref hero.png -n 3 --duration 5 \
  "{the subject smiles and waves|the subject turns toward the window|the subject raises a hand in greeting}"
```

If each clip needs different source images, end frames, durations, audio slices, or other per-output settings, keep those as separate per-clip workflow arguments instead of collapsing them into a Dynamic Prompt branch.

---

## Token Auto-Fallback

Use `--token-type auto` to retry native Sogni models with SOGNI tokens when SPARK is insufficient:

```bash
sogni-agent --token-type auto "a dragon eating tacos"
```

Tries SPARK first, then falls back to SOGNI if the balance is too low. Vendor models such as GPT Image 2, Seedance, HappyHorse, and Wan 3 require Premium Spark eligibility and never use SOGNI fallback. If usable balance is still insufficient, buy Spark Packs at https://docs.sogni.ai/pricing/#spark-packs.

On a **Sogni Unlimited** subscription, Sogni-hosted generation is covered by the plan instead of spending tokens — see the next section.

---

## Sogni Unlimited Subscription

[Sogni Unlimited](https://docs.sogni.ai/pricing/unlimited-plan-details) is a flat-rate subscription that covers Sogni-hosted (Supernet) image, video, and music generation under a fair-use policy, instead of spending Spark or SOGNI per render. Manage subscriptions where they were purchased — the Stripe billing portal for web checkouts, or the App Store / Google Play account settings for mobile.

### Plans

| Plan | Monthly | Annual |
| --- | --- | --- |
| **Unlimited** | $20 / mo | $199 / yr |
| **Unlimited Pro** | $50 / mo | $498 / yr |

App Store and Google Play prices may differ from web pricing due to platform fees. A 3-day free trial is available once per account (a payment method is required and the subscription converts to paid when the trial ends unless cancelled first).

Plan pricing, included features and models, usage allowances, fair-use controls, and other limits are subject to change at Sogni AI's discretion, subject to applicable law. Sogni will provide advance notice of material changes affecting an active paid subscription when required. Treat the live plan catalog and checkout as authoritative.

### What the subscription covers

- **Covered:** Sogni-hosted models on the Supernet — image, video, and music generation, including worker-hosted premium models. Covered renders bill to the subscription and do not spend Spark or SOGNI.
- **Not covered (Premium Spark only):** external-vendor models — **GPT Image 2** (`gpt-image-2`), **Seedance 2.0 / Seedance 2.0 Mini / Seedance 2.0 Fast / Seedance 2.5** (`seedance-2-0`, `seedance-2-0-mini`, `seedance-2-0-fast`, `seedance-2-5`), **HappyHorse 1.1** (`happyhorse-1.1-t2v`, `happyhorse-1.1-i2v`, `happyhorse-1.1-r2v`), and **Wan 3** (`wan3.0-video`). These always require Premium Spark eligibility even with an active subscription; they never bill to the subscription and never fall back to SOGNI.
- **Token choice stays yours:** selecting SOGNI (`--token-type sogni`) opts a job out of subscription coverage and spends SOGNI instead. Coverage applies when the active token is Spark.

By default the CLI sends no `billingMode`/coverage hint; the server decides coverage from the account's verified entitlement and the resolved model, and a subscription claim is never honored without a server-verified entitlement. `--billing-mode` makes the choice explicit when you need it: `subscription` requires Unlimited coverage (the job fails instead of spending tokens), `tokens` opts out of coverage and bills Spark/SOGNI, and `auto` states the default server behavior explicitly.

Do not use `tokenType: "spark"` by itself to determine that Spark paid for a render. `tokenType` is also the quote/accounting denomination for covered jobs. The server's separate `paymentModel` is authoritative: `subscription` means it skipped the artist Spark/SOGNI debit, while `paid_spark`, `free_spark`, and `sogni` identify token-funded paths. Some client result summaries do not expose `paymentModel`; in that case the payment source is unknown from that result alone. A request that completes successfully with `--billing-mode subscription` was covered—if coverage is unavailable, the server returns `4078` or `4080` instead of silently spending Spark.

With an active subscription, the CLI also skips its client-side "insufficient SPARK" pre-flight for covered video renders — a low token balance no longer blocks jobs the plan pays for. Vendor models and `--billing-mode tokens` keep the pre-flight, and the server remains authoritative either way.

### Free-trial access

Trials include evaluation limits on generation volume, media size, and API access. Full plan limits apply once the trial converts to paid. Cancelling during the trial ends Unlimited access immediately and prevents the first charge.

### Fair-use scheduling

Unlimited is fair-use, not unmetered. Published plan limits are:

- **Unlimited:** up to 4 concurrent image jobs and 1 concurrent video job, or 2 video jobs with fast/turbo models; queue up to 64 media, including up to 8 videos.
- **Unlimited Pro:** up to 16 concurrent image jobs and 4 concurrent video jobs, with standard MiniMax H3 limited to 2; queue up to 192 media, including up to 24 videos.

Actual throughput varies with demand, available Supernet capacity, and fair-use controls. Sustained high-volume or automated use may be delayed or rate-limited. Unlimited Pro receives higher subscription queue priority than Unlimited, and Premium Spark remains available for fastest paid priority. Subscription jobs cannot target specific workers.

### Billing states & cancellation

- **Active / trialing:** covered renders run normally.
- **Cancellation (paid):** Unlimited access continues until the end of the period already paid for; it simply does not renew.
- **Cancellation (during trial):** access ends immediately and no charge is made.
- **Grace / payment retry:** if a renewal payment fails, the provider retries it and **Unlimited access is paused** during the retry window — covered renders are declined with a renewal-retry error, and access resumes automatically once payment succeeds. You can keep rendering with Spark or SOGNI in the meantime.
- **Refunds:** mid-term refunds are not offered by default; App Store / Google Play purchases follow the store's refund process, and Stripe (web) refunds are handled by Sogni support.

### Subscription billing errors

When a generation cannot bill to the subscription, the CLI surfaces a structured error (`--json` includes `errorCode`, `errorCategory`, and a `hint`):

| Code | Meaning | What to do |
| --- | --- | --- |
| `4078` | Unlimited billing is not available for this generation (a vendor model that the subscription never covers, or no verified entitlement). | Use Premium Spark for vendor models (GPT Image 2 / Seedance / HappyHorse / Wan 3), or reconnect and retry for a transient entitlement read. |
| `4079` | Maximum queued jobs reached for the plan. | Wait for queued jobs to finish, then submit more. |
| `4080` | Renewal payment is being retried; Unlimited access is paused. | Pay for this render with Spark or SOGNI (`--token-type spark` / `sogni`) for now. **Do not auto-retry the covered job** — access resumes on its own once renewal succeeds. |
| `4081` | The feature requires a higher subscription plan. | Upgrade to Unlimited Pro. |

### Worker revenue share

Sogni workers that power subscription-covered jobs earn from a separate monthly pool — 51% of net subscription revenue — settled per UTC month and claimable in USDC on Base. Subscription jobs are excluded from the regular Spark/SOGNI token-economy leaderboard (they do not spend tokens) and accrue to this pool instead.

---

## Error Reporting & Output

- **Exit codes:** failures use a non-zero exit code with human-readable stderr.
- **Structured output:** add `--json` when an agent needs machine-parseable success/error data, or `--last` to inspect the last render. JSON failures include canonical `errorType`, `errorCategory`, and `retryable` fields where the shared runtime can classify the error.
- **Subscription billing errors:** subscription-billing failures carry `errorCode` `4078` / `4079` / `4080` / `4081`, `errorCategory: "subscription_billing"`, and an actionable `hint`. See [Subscription billing errors](#subscription-billing-errors) for what each means; in particular, do not auto-retry a `4080` (grace / renewal-retry) covered job — pay with Spark or SOGNI instead.
- **stdout stays parseable in `--json` mode:** progress lines, SSE workflow frames, and warnings go to stderr; stdout carries exactly one JSON object. `--last --json` wraps the record in a `{ "success": true, ... }` envelope and exits 1 with `errorCode: "NO_LAST_RENDER"` when nothing has been rendered yet.
- **Output files:** use `-o <path>` to save locally; otherwise the CLI prints a result URL.
- **Quiet mode:** `-q` / `--quiet` suppresses progress output without changing exit semantics.
- **Interrupts:** Ctrl-C exits with the conventional signal code and cleans up the CLI's temporary files.

---

## For AI Agents

This skill is designed to be loaded into agent runtimes as a first-class capability.

1. **Behavior contract — [`SKILL.md`](./SKILL.md)**
   The canonical instructions for how the agent should call `sogni-agent`. Load this as the skill source.
2. **Install/setup hints — [`llm.txt`](./llm.txt)**
   A condensed install/setup reference for agents that fetch `llm.txt` over HTTPS:
   `https://raw.githubusercontent.com/Sogni-AI/sogni-creative-agent-skill/main/llm.txt`
3. **OpenClaw manifest — [`openclaw.plugin.json`](./openclaw.plugin.json)**
   Plugin metadata, config schema, and defaults for OpenClaw-aware runtimes.
4. **Structured output — `--json`**
   Use `--json` for machine-readable success/error payloads. Use `--last` to read the previous render's metadata.
5. **Agent-safe install/upgrade**
   Prefer the `npm install -g` and `git -C "$DEST" pull --ff-only` paths above. Avoid generating clone-or-pull bootstrap scripts with `set -e`, `bash -c`, `sh -c`, or inline repository URLs — agent sandboxes correctly route those through approval and the install will stall.
6. **Verify with `doctor`**
   After any install or upgrade, run `sogni-agent doctor --json` and confirm `"success": true` before reporting the install as working.
7. **Update notices for agents**
   When a newer version exists, any command may print one advisory stderr line — `[sogni-agent] Update available: <current> -> <latest> ...` — at most once per day (stdout JSON is never touched). Agents should relay it to the user and offer `sogni-agent self-update`, or run `sogni-agent --snooze-update` if the user declines. Interactive TTY users get a banner instead. Each failed check carries a `detail` string with the fix.
8. **SSRF / URL safety**
   The CLI validates every HTTP(S) media reference with an SSRF guard ([`ssrf-guard.mjs`](./ssrf-guard.mjs)) and re-validates each redirect hop on download. Localhost and private-network URLs are rejected; only public HTTPS references are forwarded as Seedance multimodal context.

---

## Development

Run the unit test suite (works without any Sogni credentials or private repos):

```bash
npm test
```

Paid integration tests are opt-in: `npm run test:integration` (requires a Sogni API key and submits real GPU jobs).

Architecture notes, the private-runtime sync workflow, code-placement policy, and the release process live in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Issues and feature requests: [github.com/Sogni-AI/sogni-creative-agent-skill/issues](https://github.com/Sogni-AI/sogni-creative-agent-skill/issues).

---

## License

[MIT](./LICENSE) © Sogni AI
