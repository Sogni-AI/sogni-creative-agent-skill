---
name: sogni-creative-agent-skill
description: "Sogni Creative Agent Skill: agent skill and CLI for image, video, and music generation using Sogni AI's decentralized GPU network. Supports personas (named people with saved reference photos and voice clips), persistent memories (user preferences across sessions), custom personality, style transfer, angle synthesis, and multi-step creative workflows. Ask the agent to \"draw\", \"generate\", \"create an image\", \"make a video/animate\", \"make music\", \"apply a style\", or \"generate me as a superhero\"."
metadata:
  version: "2.3.0"
  homepage: https://sogni.ai
  clawdbot:
    emoji: "🎨"
    primaryEnv: "SOGNI_API_KEY"
    os: ["darwin", "linux", "win32"]
    requires:
      bins: ["node"]
      anyBins: ["ffmpeg"]
      env:
        - "SOGNI_API_KEY"
        - "SOGNI_CREDENTIALS_PATH"
        - "SOGNI_LAST_RENDER_PATH"
        - "SOGNI_MEDIA_INBOUND_DIR"
        - "OPENCLAW_CONFIG_PATH"
        - "OPENCLAW_PLUGIN_CONFIG"
        - "FFMPEG_PATH"
      config:
        - "~/.config/sogni/credentials"
        - "~/.openclaw/openclaw.json"
        - "~/.clawdbot/media/inbound"
        - "~/.config/sogni/last-render.json"
        - "~/Downloads/sogni"
    install:
      - id: npm
        kind: exec
        command: "cd {{skillDir}} && cp skill-package.json package.json && npm i"
        label: "Prepare runtime dependencies"
---

# Sogni Image, Video & Music Generation

Generate **images, videos, and music** using Sogni AI's decentralized GPU network.

> **Per-skill view**: hosts that want to load focused capabilities rather than this monolith can read [`skills/README.md`](./skills/README.md) for the per-skill index — one markdown file per skill (`image_generation`, `image_editing`, `video_generation`, `video_editing`, `music_generation`, `media_analysis`, `persona_management`, `app_settings`, plus the always-loaded `quality_audit`, `session_control`, `asset_reference_management`). Each file mirrors the canonical manifest in `@sogni/creative-agent`. The whole-monolith load below stays the default for OpenClaw / Claude Code / Hermes Agent / Manus AI integrations.

## Install Request Policy

When a user asks to install this plugin, skill, or Sogni Creative Agent Skill, install it as the command-line tool plus this skill.

Default install path:

```bash
npm install -g @sogni-ai/sogni-creative-agent-skill@latest
sogni-agent --version
```

Then configure the agent/runtime to use this `SKILL.md` and invoke the `sogni-agent` CLI.

For upgrades, prefer package-manager updates or direct operations on an existing checkout. Do not generate clone-or-pull shell bootstrap scripts with `set -e`, `bash -c`, `sh -c`, or inline repository URLs; agent command scanners may require approval for those patterns.

Agent-safe CLI upgrade:

```bash
npm install -g @sogni-ai/sogni-creative-agent-skill@latest
sogni-agent --version
```

Agent-safe update for an existing local checkout:

```bash
DEST="$HOME/Documents/git/sogni/sogni-creative-agent-skill"
git -C "$DEST" pull --ff-only
npm --prefix "$DEST" install
```

If that checkout does not exist, prefer the npm-based local skill install below, or ask before cloning.

## Setup

1. **Get your Sogni API key** by logging into https://dashboard.sogni.ai and opening the account menu.
2. **Create an API key credentials file:**
```bash
mkdir -p ~/.config/sogni
cat > ~/.config/sogni/credentials << 'EOF'
SOGNI_API_KEY=your_api_key
EOF
chmod 600 ~/.config/sogni/credentials
```

You can also export `SOGNI_API_KEY` instead of writing the file. The API key can always be found by logging into https://dashboard.sogni.ai and opening the account menu.

3. **Install the CLI and skill by default:**
```bash
npm install -g @sogni-ai/sogni-creative-agent-skill@latest
sogni-agent --version
```

Configure the agent/runtime to use this `SKILL.md`.

4. **Install dependencies if working from a clone:**
```bash
cd /path/to/sogni-creative-agent-skill
npm i
```

5. **Or install from npm into a local skill directory (no git clone):**
```bash
mkdir -p ~/.clawdbot/skills
cd ~/.clawdbot/skills
npm i @sogni-ai/sogni-creative-agent-skill
ln -sfn node_modules/@sogni-ai/sogni-creative-agent-skill sogni-creative-agent-skill
```

When this skill is distributed via ClawHub, it bootstraps its local runtime dependencies from `skill-package.json` during install. That avoids relying on a root `package.json` being present in the published skill artifact.

## Filesystem Paths and Overrides

Default file paths used by this skill:

- API key credentials file (read): `~/.config/sogni/credentials`
- Last render metadata (read/write): `~/.config/sogni/last-render.json`
- OpenClaw config (read): `~/.openclaw/openclaw.json`
- Media listing for `--list-media` (read): `~/.clawdbot/media/inbound`

Path override environment variables:

- `SOGNI_CREDENTIALS_PATH`
- `SOGNI_LAST_RENDER_PATH`
- `SOGNI_MEDIA_INBOUND_DIR`
- `OPENCLAW_CONFIG_PATH`

## Recommended path: route through the hosted Sogni Intelligence endpoints

For any natural-language creative request — anything that should be planned, multi-step, or that benefits from tool selection, repair, or durable workflows — prefer the hosted endpoints over the direct-to-SDK flags. The hosted endpoints are the canonical home for tool dispatch, Structured Contracts v1 (gating policies, repair recipes, prompt contracts), durable workflows, replay, and asset-manifest mapping. They stay aligned with `sogni-chat` and the rest of the `@sogni/creative-agent` consumers automatically.

```bash
# Natural-language creative request (LLM picks the tool, dispatches, repairs)
node sogni-agent.mjs --api-chat "Turn the attached product photo into a launch poster" --ref product.jpg

# Multi-step durable workflow (resumable, replay-friendly, server-orchestrated)
node sogni-agent.mjs --api-workflow \
  --video-prompt "The camera slowly pushes in" \
  "A graphite robot sketch on a drafting table"

# Storyboard → keyframe → Seedance, all server-side
node sogni-agent.mjs --api-workflow storyboard-video --storyboard-frames 6 -Q hq \
  "Create a 9:16 bakery launch video with a neon street-window reveal"
```

The direct-to-SDK flags below remain available for explicit one-shot generation when you already know the exact model, dimensions, and prompt and don't need LLM planning. Use them when latency or cost rules out the LLM round-trip.

## Usage (direct-to-SDK image, video & music)

```bash
# Generate and get URL
node sogni-agent.mjs "a cat wearing a hat"

# Quality presets (recommended for direct mode — auto-selects model, steps, and size)
node sogni-agent.mjs -Q fast "a cat wearing a hat"    # z_image_turbo, 8 steps, 512x512 (~5-10s)
node sogni-agent.mjs -Q hq "a cat wearing a hat"      # z_image_turbo, default steps, 768x768 (~10-15s)
node sogni-agent.mjs -Q pro "a cat wearing a hat"      # flux2_dev, 40 steps, 1024x1024 (~2min)

# Dynamic prompt variations — diverse images in one call
node sogni-agent.mjs -n 3 "a {red|blue|green} sports car"
# → generates "a red sports car", "a blue sports car", "a green sports car"

# Token auto-fallback (tries SPARK, falls back to SOGNI)
node sogni-agent.mjs --token-type auto "a cat wearing a hat"

# Save to file
node sogni-agent.mjs -o /tmp/cat.png "a cat wearing a hat"

# JSON output (for scripting)
node sogni-agent.mjs --json "a cat wearing a hat"

# Check token balances (no prompt required)
node sogni-agent.mjs --balance

# Check token balances in JSON
node sogni-agent.mjs --json --balance

# Quiet mode (suppress progress)
node sogni-agent.mjs -q -o /tmp/cat.png "a cat wearing a hat"

# Direct music/audio generation
node sogni-agent.mjs --music --duration 30 \
  "uplifting cinematic synthwave theme for a product launch"

# Song with lyrics and musical controls
node sogni-agent.mjs --music --lyrics "Rise with the morning light" --bpm 128 \
  --keyscale "C major" --output-format mp3 "bright indie pop chorus"

# Hosted API chat: natural-language creative-agent tool execution
node sogni-agent.mjs --api-chat "Create a 4-shot product video concept for a red sneaker"

# Hosted API chat with image vision and media-reference metadata
node sogni-agent.mjs --api-chat --ref product.jpg \
  "Turn this into a launch poster and describe the edit plan"

# Sogni Intelligence model/replay utilities
node sogni-agent.mjs --list-api-models
node sogni-agent.mjs --api-chat --task-profile reasoning --no-thinking \
  "Plan a concise multi-step product launch workflow"
node sogni-agent.mjs --list-replays 20
node sogni-agent.mjs --get-replay run_abc123 --json

# Durable API workflow: generated keyframe to video with resumable workflow record
node sogni-agent.mjs --api-workflow \
  --video-prompt "The camera slowly pushes in as the sketch comes alive" \
  "A graphite robot sketch on a drafting table"

# Durable API workflow with media reference and cost controls
node sogni-agent.mjs --api-workflow \
  --ref https://cdn.example.com/sketch.png \
  --workflow-max-cost 25 --confirm-cost \
  --video-prompt "The camera slowly pushes in as the sketch comes alive" \
  "Animate the referenced sketch"

# Exact durable workflow input with explicit steps
node sogni-agent.mjs --api-workflow --workflow-input @workflow.json

# Durable storyboard-video workflow: storyline -> GPT Image 2 storyboard -> Seedance
node sogni-agent.mjs --api-workflow storyboard-video --storyboard-frames 6 --duration 12 -Q hq \
  "Create a 9:16 bakery launch video with a neon street-window reveal"
```

Use `--api-chat` for text-first natural-language workflows that should go through
Sogni API's OpenAI-compatible `/v1/chat/completions` tool loop. This path
sanitizes prompt-injection markers before forwarding messages and uses the
current hosted creative-agent tool surface. Use `--api-workflow` when the caller
already knows it wants an async durable workflow record under
`/v1/creative-agent/workflows`. Use `--workflow-input @workflow.json` when the
caller already has exact durable workflow input with `steps`; the skill forwards
that body to the API as-is. This is the preferred hosted path for
exact multi-step plans, including repeated `replace_video_segment` operations
with `replacementStartSeconds` / `replacementEndSeconds` when interleaving
existing video slices. Use `--api-workflow storyboard-video`
when the caller wants the hosted sequence to generate a storyline, create one GPT
Image 2 storyboard sheet, and feed that image artifact into Seedance as the video
reference. The `-Q fast|hq|pro` preset maps to GPT Image 2 low|medium|high
quality for the storyboard sheet. Hosted API requests forward media references
from `-c`, `--ref`, `--ref-end`, `--ref-audio`,
`--reference-audio-identity`, and `--ref-video` as `media_references`
metadata; workflow JSON can bind them into step arguments with
`sourceStepId: "$input_media"`, and API chat also attaches image refs as vision
inputs. Local file references are uploaded to Sogni media storage first, then
forwarded as retrievable URLs for hosted chat and durable workflows. Use the
direct CLI path for private media that must not leave the local machine.
Use `--workflow-max-cost <n>` plus `--confirm-cost` / `--no-confirm-cost` to
forward explicit workflow cost policy.
Sogni Intelligence utilities are exposed through the same API key path:
`--list-api-models` / `--get-api-model <id>` read `/v1/models`,
`--task-profile`, `--max-tokens`, and `--thinking` / `--no-thinking` tune
`/v1/chat/completions`, and `--list-replays`, `--get-replay`, and
`--ingest-replay` manage `/v1/replay/records` RunRecords for replay/debug
viewers.
Hosted API modes require `SOGNI_API_KEY`; this skill's CLI uses API-key
authentication.

For durable hosted chat runs (long-running multi-tool turns that should
survive a client disconnect), the SDK now exposes
`sogni.chat.runs.{create, get, cancel, streamEvents}`.
Set `SOGNI_SKILL_USE_SDK_TRANSPORT=1` to route hosted workflow + chat
operations through the SDK transport instead of the legacy
SSRF-validated fetch path. The skill's `sogni-hosted-client.mjs`
factory still validates `restEndpoint` / `socketEndpoint` against the
SSRF guard before constructing the SDK client, so the safety contract
holds.

When changing hosted API chat/workflow behavior, keep reusable validation,
workflow compilation, repair-control, and guard telemetry logic in
`../sogni-creative-agent` first. The public skill should consume generated or
copied shared contracts instead of adding skill-local regex guards. Media-routing
decisions should come from typed planner/runtime contracts such as
`CreativeTurnPlannerFields`, `classifyMediaTurnIntent()`, `videoContinuation`,
`videoModification`, `outputGrouping`, `imageSelectionPolicy`, and
`pendingStitchAfterBatch`; regex is appropriate only for bounded CLI/fact
extraction such as paths, URLs, extensions, dimensions, durations, and explicit
positions.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-Q, --quality <tier>` | Quality preset: fast\|hq\|pro (auto-selects model/steps/size) | - |
| `-o, --output <path>` | Save to file | prints URL |
| `-m, --model <id>` | Model ID (overrides --quality) | z_image_turbo_bf16 |
| `-w, --width <px>` | Width | 512 |
| `-h, --height <px>` | Height | 512 |
| `-n, --count <num>` | Number of images (supports {a\|b\|c} prompt variations) | 1 |
| `-t, --timeout <sec>` | Timeout seconds | 30 (300 for video) |
| `-s, --seed <num>` | Specific seed | random |
| `--last-seed` | Reuse seed from last render | - |
| `--seed-strategy <s>` | Seed strategy: random\|prompt-hash | prompt-hash |
| `--multi-angle` | Multiple angles LoRA mode (Qwen Image Edit) | - |
| `--angles-360` | Generate 8 azimuths (front -> front-left) | - |
| `--angles-360-video` | Assemble looping 360 mp4 using i2v between angles (requires ffmpeg) | - |
| `--azimuth <key>` | front\|front-right\|right\|back-right\|back\|back-left\|left\|front-left | front |
| `--elevation <key>` | low-angle\|eye-level\|elevated\|high-angle | eye-level |
| `--distance <key>` | close-up\|medium\|wide | medium |
| `--angle-strength <n>` | LoRA strength for multiple_angles | 0.9 |
| `--angle-description <text>` | Optional subject description | - |
| `--steps <num>` | Override steps (model-dependent) | - |
| `--guidance <num>` | Override guidance (model-dependent) | - |
| `--output-format <f>` | Image output format: png\|jpg, or webp for gpt-image-2 | png |
| `--sampler <name>` | Sampler (model-dependent) | - |
| `--scheduler <name>` | Scheduler (model-dependent) | - |
| `--lora <id>` | LoRA id (repeatable, edit only) | - |
| `--loras <ids>` | Comma-separated LoRA ids | - |
| `--lora-strength <n>` | LoRA strength (repeatable) | - |
| `--lora-strengths <n>` | Comma-separated LoRA strengths | - |
| `--token-type <type>` | Token type: spark\|sogni\|auto (auto retries with alternate) | spark |
| `--balance, --balances` | Show SPARK/SOGNI balances and exit | - |
| `-c, --context <path>` | Context image for editing | - |
| `--last-image` | Use last generated image as context/ref | - |
| `--music` | Generate music/audio instead of image | - |
| `--music-model <id>` | Music model: turbo\|sft\|ace_step_1.5_turbo\|ace_step_1.5_sft | ace_step_1.5_turbo |
| `--lyrics <text>` | Optional lyrics for song generation | - |
| `--language <code>` | Lyrics language code | en |
| `--bpm <num>` | Music tempo, 30-300 BPM | server default |
| `--keyscale <text>` | Music key/scale, e.g. C major | - |
| `--timesig <n>` | Time signature: 2\|3\|4\|6 | server default |
| `--composer-mode`, `--no-composer-mode` | Toggle AI composer mode | server default |
| `--prompt-strength <n>` | Music prompt adherence, 0-10 | server default |
| `--creativity <n>` | Music variation/temperature, 0-2 | server default |
| `--music-shift <n>` | Audio model shift parameter, 1-6 | 3 |
| `--audio-format <f>` | Alias for music output format: mp3\|flac\|wav | mp3 |
| `--video, -v` | Generate video instead of image | - |
| `--workflow <type>` | Video workflow (t2v\|i2v\|s2v\|ia2v\|a2v\|v2v\|animate-move\|animate-replace) | inferred |
| `--fps <num>` | Frames per second (video) | model default |
| `--duration <sec>` | Duration in seconds (video or music) | video 5, music 30 |
| `--frames <num>` | Override total frames (video) | - |
| `--target-resolution <px>` | Short-side video target preserving aspect ratio | - |
| `--auto-resize-assets` | Auto-resize video assets | true |
| `--no-auto-resize-assets` | Disable auto-resize | - |
| `--estimate-video-cost` | Estimate video cost and exit | - |
| `--photobooth` | Face transfer mode (InstantID + SDXL Turbo) | - |
| `--cn-strength <n>` | ControlNet strength (photobooth) | 0.8 |
| `--cn-guidance-end <n>` | ControlNet guidance end point (photobooth) | 0.3 |
| `--ref <path\|url>` | Reference image for video or photobooth face | required for video/photobooth |
| `--ref-end <path\|url>` | End frame for i2v interpolation | - |
| `--ref-audio <path\|url>` | Uploaded/generated audio for ia2v/a2v, or s2v lip-sync | - |
| `--audio-start <sec>` | Start offset into `--ref-audio` | - |
| `--audio-duration <sec>` | Duration slice from `--ref-audio` | - |
| `--reference-audio-identity <path>` | Voice identity clip for LTX native audio | - |
| `--voice-persona <name>` | Use saved persona voice clip as LTX voice identity | - |
| `--ref-video <path\|url>` | Reference video for animate/v2v workflows | - |
| `--video-start <sec>` | Start offset into `--ref-video` for segmented V2V/animate | - |
| `--controlnet-name <name>` | ControlNet type for v2v: canny\|pose\|depth\|detailer | - |
| `--controlnet-strength <n>` | ControlNet strength for v2v (0.0-1.0) | canny/pose/depth 0.85, detailer 1.0 |
| `--sam2-coordinates <coords>` | SAM2 click coords for animate-replace (x,y or x1,y1;x2,y2) | - |
| `--trim-end-frame` | Trim last frame for seamless video stitching | - |
| `--first-frame-strength <n>` | Keyframe strength for start frame (0.0-1.0) | - |
| `--last-frame-strength <n>` | Keyframe strength for end frame (0.0-1.0) | - |
| `--last` | Show last render info | - |
| `--json` | JSON output | false |
| `--strict-size` | Do not auto-adjust i2v video size for reference resizing constraints | false |
| `-q, --quiet` | No progress output | false |
| `--extract-last-frame <video> <image>` | Extract last frame from video (safe ffmpeg wrapper) | - |
| `--concat-videos <out> <clips...>` | Concatenate video clips (safe ffmpeg wrapper) | - |
| `--concat-audio <path>` | Optional audio track to mux over `--concat-videos` output | - |
| `--concat-audio-start <sec>` | Start offset into `--concat-audio` | - |
| `--list-media [type]` | List recent inbound media (images\|audio\|all) | images |
| `--api-chat` | Call `/v1/chat/completions` with Sogni creative-agent tool injection | - |
| `--api-tools <mode>` | API tool mode: creative-agent\|creative-tools\|none | creative-agent |
| `--no-api-tool-execution` | Plan/tool-call via API chat without executing Sogni tools | - |
| `--llm-model <id>` | LLM model for `--api-chat` | qwen3.6-35b-a3b-gguf-iq4xs |
| `--task-profile <profile>` | Sogni Intelligence task profile: general\|coding\|reasoning | - |
| `--max-tokens <n>` | Max hosted chat completion tokens | 1600 |
| `--thinking`, `--no-thinking` | Toggle `chat_template_kwargs.enable_thinking` for hosted chat | server default |
| `--list-api-models`, `--get-api-model <id>` | Inspect Sogni Intelligence LLM model metadata | - |
| `--list-replays [n]`, `--get-replay <id>`, `--ingest-replay <json\|@path>` | Manage Sogni Intelligence replay RunRecords (use `@path` to load JSON from a file) | - |
| `--api-workflow` | Start a durable workflow with explicit `input.steps`; optional `storyboard-video` preset | - |
| `--workflow-input <json\|@path>` | Durable workflow input JSON. Use `@path` to load from a file. | - |
| `--workflow-title <text>` | Title for generated or storyboard durable workflow input | - |
| `--workflow-max-cost <n>` | Reject hosted workflow starts above this estimated capacity-unit ceiling | - |
| `--confirm-cost`, `--no-confirm-cost` | Forward explicit hosted workflow cost confirmation | - |
| `--storyboard-frames <n>` | Beat count for storyboard-video workflow | - |
| `--video-prompt <text>` | Motion prompt for generated-keyframe durable workflow | - |
| `--negative-prompt <text>` | Negative prompt for generated-keyframe durable workflow | - |
| `--generate-audio`, `--no-generate-audio` | Toggle audio generation for generated video steps | - |
| `--expand-prompt`, `--no-expand-prompt` | Toggle prompt expansion for generated video steps | - |
| `--watch-workflow` | Stream durable workflow events after start | - |
| `--list-workflows`, `--get-workflow <id>`, `--workflow-events <id>`, `--stream-workflow <id>`, `--cancel-workflow <id>` | Durable workflow management helpers | - |
| `--api-base-url <url>` | Sogni API base for hosted API modes. Credentials are only sent to `https://api.sogni.ai` by default; use `SOGNI_API_ALLOWED_HOSTS` for trusted custom hosts or `SOGNI_ALLOW_UNSAFE_API_BASE_URL=1` for isolated local testing. | https://api.sogni.ai |
| `--no-filter` | Disable NSFW content filter | - |
| `--memory-set <key> <value>` | Save a user preference | - |
| `--memory-get <key>` | Get a specific memory | - |
| `--memory-list` | List all saved memories | - |
| `--memory-remove <key>` | Delete a memory | - |
| `--personality-set <text>` | Set custom agent personality instructions | - |
| `--personality-get` | Show current personality | - |
| `--personality-clear` | Reset personality to default | - |
| `--persona-add <name>` | Add a persona (with --ref, --relationship, --description) | - |
| `--persona-list` | List all saved personas | - |
| `--persona-remove <name>` | Remove a persona and its files | - |
| `--persona-resolve <name>` | Look up persona by name/tag/pronoun | - |
| `--persona <name>` | Generate using persona's reference photo as context | - |
| `--relationship <type>` | Persona relationship: self\|partner\|child\|friend\|pet | friend |
| `--voice-clip <path>` | Voice clip audio for LTX-2.3 voice cloning | - |

## OpenClaw Config Defaults

When installed as an OpenClaw plugin, Sogni Creative Agent Skill will read defaults from:

`~/.openclaw/openclaw.json`

```json
{
  "plugins": {
    "entries": {
      "sogni-creative-agent-skill": {
        "enabled": true,
        "config": {
          "defaultImageModel": "z_image_turbo_bf16",
          "defaultEditModel": "qwen_image_edit_2511_fp8_lightning",
          "defaultPhotoboothModel": "coreml-sogniXLturbo_alpha1_ad",
          "defaultMusicModel": "ace_step_1.5_turbo",
          "videoModels": {
            "t2v": "ltx23-22b-fp8_t2v_distilled",
            "i2v": "wan_v2.2-14b-fp8_i2v_lightx2v",
            "s2v": "wan_v2.2-14b-fp8_s2v_lightx2v",
            "ia2v": "ltx23-22b-fp8_ia2v_distilled",
            "a2v": "ltx23-22b-fp8_a2v_distilled",
            "animate-move": "wan_v2.2-14b-fp8_animate-move_lightx2v",
            "animate-replace": "wan_v2.2-14b-fp8_animate-replace_lightx2v",
            "v2v": "ltx23-22b-fp8_v2v_distilled"
          },
          "defaultVideoWorkflow": "t2v",
          "defaultNetwork": "fast",
          "defaultTokenType": "spark",
          "apiBaseUrl": "https://api.sogni.ai",
          "defaultLlmModel": "qwen3.6-35b-a3b-gguf-iq4xs",
          "defaultTaskProfile": "general",
          "defaultApiMaxTokens": 1600,
          "defaultApiThinking": false,
          "defaultApiToolMode": "creative-agent",
          "defaultWorkflowMaxCost": 25,
          "defaultWorkflowConfirmCost": false,
          "seedStrategy": "prompt-hash",
          "modelDefaults": {
            "flux1-schnell-fp8": { "steps": 4, "guidance": 3.5 },
            "flux2_dev_fp8": { "steps": 20, "guidance": 7.5 }
          },
          "defaultWidth": 768,
          "defaultHeight": 768,
          "defaultCount": 1,
          "defaultFps": 16,
          "defaultDurationSec": 5,
          "defaultImageTimeoutSec": 30,
          "defaultVideoTimeoutSec": 300,
          "defaultMusicDurationSec": 30,
          "defaultMusicTimeoutSec": 600,
          "credentialsPath": "~/.config/sogni/credentials",
          "lastRenderPath": "~/.config/sogni/last-render.json",
          "mediaInboundDir": "~/.clawdbot/media/inbound"
        }
      }
    }
  }
}
```

CLI flags always override these defaults.
If your OpenClaw config lives elsewhere, set `OPENCLAW_CONFIG_PATH`.
Seed strategies: `prompt-hash` (deterministic) or `random`.

## Image Models

| Model | Speed | Use Case |
|-------|-------|----------|
| `z_image_turbo_bf16` | Fast (~5-10s) | General purpose, default |
| `gpt-image-2` | Variable | OpenAI GPT Image 2 text-to-image and edit, strong prompt and text rendering |
| `flux1-schnell-fp8` | Very fast | Quick iterations |
| `flux2_dev_fp8` | Slow (~2min) | High quality |
| `chroma-v.46-flash_fp8` | Medium | Balanced |
| `qwen_image_edit_2511_fp8` | Medium | Image editing with context (up to 3) |
| `qwen_image_edit_2511_fp8_lightning` | Fast | Quick image editing |
| `coreml-sogniXLturbo_alpha1_ad` | Fast | Photobooth face transfer (SDXL Turbo) |

`gpt-image-2` supports flexible OpenAI image sizes up to `3840px` on either edge, max `3:1` aspect ratio, and total pixels from `655,360` through `8,294,400`; the API snaps dimensions to valid multiples of 16.

## Music Models

| Model | Use Case |
|-------|----------|
| `ace_step_1.5_turbo` | Default direct music generation model |
| `ace_step_1.5_sft` | Experimental option with stronger lyric handling |

Use `--music` for direct audio-only generation. Defaults are 30 seconds, `mp3`,
`ace_step_1.5_turbo`, 8 steps, `euler` sampler, and `simple` scheduler. Keep
`--audio` for video reference audio (`--ref-audio` alias); do not use it for
direct music generation.

## Video Models

### Current Video Model Selectors

| Model | Speed | Use Case |
|-------|-------|----------|
| `ltx23-22b-fp8_t2v_distilled` | Fast (~2-3min) | Default text-to-video with native dialogue/audio |
| `ltx23-22b-fp8_i2v_distilled` | Fast (~2-3min) | Image-to-video with native dialogue/audio |
| `ltx23-22b-fp8_ia2v_distilled` | Fast (~2-3min) | Image+audio-to-video |
| `ltx23-22b-fp8_a2v_distilled` | Fast (~2-3min) | Audio-to-video |
| `ltx23-22b-fp8_v2v_distilled` | Fast (~3min) | Video-to-video with ControlNet |
| `seedance2` | Variable | Seedance 2.0 text-to-video, 4-15s, native audio |
| `seedance2-fast` | Variable | Fast Seedance 2.0 text-to-video |
| `seedance2-ia2v` | Variable | Seedance 2.0 image+audio-to-video |
| `seedance2-v2v` | Variable | Seedance 2.0 video-to-video, no ControlNet |
| `wan_v2.2-14b-fp8_i2v_lightx2v` | Fast | Simple image-to-video |
| `wan_v2.2-14b-fp8_i2v` | Slow | Higher quality video |
| `wan_v2.2-14b-fp8_t2v_lightx2v` | Fast | Text-to-video |
| `wan_v2.2-14b-fp8_s2v_lightx2v` | Fast | Face lip-sync with uploaded audio |
| `wan_v2.2-14b-fp8_animate-move_lightx2v` | Fast | Animate-move |
| `wan_v2.2-14b-fp8_animate-replace_lightx2v` | Fast | Animate-replace |

### LTX-2 / LTX-2.3 Models

| Model | Speed | Use Case |
|-------|-------|----------|
| `ltx2-19b-fp8_t2v_distilled` | Fast (~2-3min) | Text-to-video, 8-step |
| `ltx2-19b-fp8_t2v` | Medium (~5min) | Text-to-video, 20-step quality |
| `ltx2-19b-fp8_i2v_distilled` | Fast (~2-3min) | Image-to-video, 8-step |
| `ltx2-19b-fp8_i2v` | Medium (~5min) | Image-to-video, 20-step quality |
| `ltx2-19b-fp8_ia2v_distilled` | Fast (~2-3min) | Image+audio-to-video |
| `ltx2-19b-fp8_a2v_distilled` | Fast (~2-3min) | Audio-to-video |
| `ltx2-19b-fp8_v2v_distilled` | Fast (~3min) | Video-to-video with ControlNet |
| `ltx2-19b-fp8_v2v` | Medium (~5min) | Video-to-video with ControlNet, quality |

## Image Editing with Context

Edit images using reference images. Qwen models support up to 3 context images; GPT Image 2 edit supports up to 16 when selected with `-m gpt-image-2`:

```bash
# Single context image
node sogni-agent.mjs -c photo.jpg "make the background a beach"

# Multiple context images (subject + style)
node sogni-agent.mjs -c subject.jpg -c style.jpg "apply the style to the subject"

# GPT Image 2 multi-reference edit
node sogni-agent.mjs -m gpt-image-2 -c subject.jpg -c outfit.jpg -c room.jpg "place the subject in the room wearing the outfit"

# Use last generated image as context
node sogni-agent.mjs --last-image "make it more vibrant"
```

When context images are provided without `-m`, defaults to `qwen_image_edit_2511_fp8_lightning`. Select `-m gpt-image-2` for GPT Image 2's higher reference-image limit and OpenAI-backed image editing.

## Photobooth (Face Transfer)

Generate stylized portraits from a face photo using InstantID ControlNet. When a user mentions "photobooth", wants a stylized portrait of themselves, or asks to transfer their face into a style, use `--photobooth` with `--ref` pointing to their face image.

```bash
# Basic photobooth
node sogni-agent.mjs --photobooth --ref face.jpg "80s fashion portrait"

# Multiple outputs
node sogni-agent.mjs --photobooth --ref face.jpg -n 4 "LinkedIn professional headshot"

# Custom ControlNet tuning
node sogni-agent.mjs --photobooth --ref face.jpg --cn-strength 0.6 --cn-guidance-end 0.5 "oil painting"
```

Uses SDXL Turbo (`coreml-sogniXLturbo_alpha1_ad`) at 1024x1024 by default. The face image is passed via `--ref` and styled according to the prompt. Cannot be combined with `--video` or `-c/--context`.

**Agent usage:**
```bash
# Photobooth: stylize a face photo
node {{skillDir}}/sogni-agent.mjs -q --photobooth --ref /path/to/face.jpg -o /tmp/stylized.png "80s fashion portrait"

# Multiple photobooth outputs
node {{skillDir}}/sogni-agent.mjs -q --photobooth --ref /path/to/face.jpg -n 4 -o /tmp/stylized.png "LinkedIn professional headshot"
```

## Multiple Angles (Turnaround)

Generate specific camera angles from a single reference image using the Multiple Angles LoRA:

```bash
# Single angle
node sogni-agent.mjs --multi-angle -c subject.jpg \
  --azimuth front-right --elevation eye-level --distance medium \
  --angle-strength 0.9 \
  "studio portrait, same person"

# 360 sweep (8 azimuths)
node sogni-agent.mjs --angles-360 -c subject.jpg --distance medium --elevation eye-level \
  "studio portrait, same person"

# 360 sweep video (looping mp4, uses i2v between angles; requires ffmpeg)
node sogni-agent.mjs --angles-360 --angles-360-video /tmp/turntable.mp4 \
  -c subject.jpg --distance medium --elevation eye-level \
  "studio portrait, same person"
```

The prompt is auto-built with the required `<sks>` token plus the selected camera angle keywords.
`--angles-360-video` generates i2v clips between consecutive angles (including last→first) and concatenates them with ffmpeg for a seamless loop.

### 360 Video Best Practices

When a user requests a "360 video", follow this workflow:

1. **Default camera parameters** (do not ask unless they specify):
   - **Elevation**: default to **medium**
   - **Distance**: default to **medium**

2. **Map user terms to flags**:
   | User says | Flag value |
   |-----------|------------|
   | "high" angle | `--elevation high-angle` |
   | "medium" angle | `--elevation eye-level` |
   | "low" angle | `--elevation low-angle` |
   | "close" | `--distance close-up` |
   | "medium" distance | `--distance medium` |
   | "far" | `--distance wide` |

3. **Always use first-frame/last-frame stitching** - the `--angles-360-video` flag automatically handles this by generating i2v clips between consecutive angles including last→first for seamless looping.

4. **Example command**:
   ```bash
   node sogni-agent.mjs --angles-360 --angles-360-video /tmp/output.mp4 \
     -c /path/to/image.png --elevation eye-level --distance medium \
     "description of subject"
   ```

### Transition Video Rule

For **any transition video work**, always use the **Sogni skill/plugin** (not raw ffmpeg or other shell commands). Use the built-in `--extract-last-frame`, `--concat-videos`, and `--looping` flags for video manipulation.

### Insufficient Funds Handling

Use `--token-type auto` to automatically retry with SOGNI tokens when SPARK is insufficient.

When you see **"Debit Error: Insufficient funds"** even with auto-fallback, reply:

"Insufficient funds. Claim 50 free daily Spark points at https://app.sogni.ai/"

## Video Generation

Generate videos from a reference image:

```bash
# Text-to-video (t2v)
node sogni-agent.mjs --video "A narrator says \"welcome to the story\" as ocean waves crash"

# Basic video from image
node sogni-agent.mjs --video --ref cat.jpg -o cat.mp4 "cat walks around"

# Use last generated image as reference
node sogni-agent.mjs --last-image --video "gentle camera pan"

# Custom duration and FPS
node sogni-agent.mjs --video --ref scene.png --duration 10 --fps 24 "zoom out slowly"

# Bare "720p" / "HD" without exact pixels: preserve aspect via short-side target
node sogni-agent.mjs --video --target-resolution 768 \
  "A calm cinematic shot of lanterns drifting across a night lake"

# Natural-language aspect and resolution inference
node sogni-agent.mjs --video \
  "Make a 720p 9:16 video of ocean waves at sunset"

# Seedance 2.0 text-to-video
node sogni-agent.mjs --video -m seedance2 --duration 8 \
  "A polished product reveal with native ambient sound"

# Seedance multimodal context with public HTTPS references
node sogni-agent.mjs --video -m seedance2 --workflow t2v \
  --ref https://cdn.example.com/product.png \
  --ref-video https://cdn.example.com/motion.mp4 \
  --ref-audio https://cdn.example.com/music.m4a \
  "Use @Image1 for product identity, @Video1 for camera movement, and @Audio1 for music rhythm"

# Sound-to-video (s2v)
node sogni-agent.mjs --video --ref face.jpg --ref-audio speech.m4a \
  -m wan_v2.2-14b-fp8_s2v_lightx2v "lip sync talking head"

# Image+audio-to-video (auto-routes to LTX 2.3 ia2v)
node sogni-agent.mjs --video --ref cover.jpg --ref-audio song.mp3 \
  "music video with synchronized motion"

# Audio-to-video (auto-routes to LTX 2.3 a2v)
node sogni-agent.mjs --video --ref-audio song.mp3 \
  "abstract audio-reactive visualizer"

# Persona/voice identity with LTX native audio
node sogni-agent.mjs --video --reference-audio-identity voice.webm \
  "NARRATOR: \"This is my voice.\""

# Prefer .webm, .m4a, or .mp3 voice clips. Local .wav clips are normalized
# to .m4a before upload when ffmpeg is available.

# LTX-2.3 text-to-video
node sogni-agent.mjs --video -m ltx23-22b-fp8_t2v_distilled --duration 20 \
  "A wide cinematic aerial shot opens over steep tropical cliffs at golden hour, warm sunlight grazing the rock faces while sea mist drifts above the water below. Palm trees bend gently along the ridge as waves roll against the shoreline, leaving bright bands of foam across the dark stone. The camera glides forward in one continuous pass, revealing more of the coastline as sunlight flickers across wet surfaces and distant birds wheel through the haze. The scene holds a calm, upscale travel-film mood with smooth stabilized motion and crisp environmental detail."

# Animate (motion transfer)
node sogni-agent.mjs --video --ref subject.jpg --ref-video motion.mp4 \
  --workflow animate-move "transfer motion"

# Segment a longer reference video for local stitched workflows
node sogni-agent.mjs --video --workflow v2v --ref-video dance.mp4 \
  --video-start 10 --duration 8 --controlnet-name pose \
  "robot dancing"
```

## Video-to-Video (V2V) with ControlNet

Transform an existing video using LTX-2 models with ControlNet guidance:

```bash
# Basic v2v with canny edge detection
node sogni-agent.mjs --video --workflow v2v --ref-video input.mp4 \
  --controlnet-name canny "stylized anime version"

# V2V with pose detection and custom strength
node sogni-agent.mjs --video --workflow v2v --ref-video dance.mp4 \
  --controlnet-name pose --controlnet-strength 0.7 "robot dancing"

# V2V with depth map
node sogni-agent.mjs --video --workflow v2v --ref-video scene.mp4 \
  --controlnet-name depth "watercolor painting style"
```

ControlNet types: `canny` (edge detection), `pose` (body pose), `depth` (depth map), `detailer` (detail enhancement).
Default V2V strengths are tuned from Sogni Chat: `canny`/`pose`/`depth` use `0.85` plus detailer assist, while `detailer` uses `1.0` for preservation. For Seedance V2V, use `-m seedance2-v2v` and omit ControlNet. Seedance accepts public HTTPS image, video, and audio references as URL context when they pass the CLI URL safety checks; localhost and private-network URLs are rejected before forwarding. Audio references must be paired with an image or video reference.

```bash
# Seedance V2V without ControlNet
node sogni-agent.mjs --video --workflow v2v -m seedance2-v2v \
  --ref-video input.mp4 "make the clip more cinematic"
```

## Photo Restoration

Restore damaged vintage photos using Qwen image editing:

```bash
# Basic restoration
sogni-agent -c damaged_photo.jpg -o restored.png \
  "professionally restore this vintage photograph, remove damage and scratches"

# Detailed restoration with preservation hints
sogni-agent -c old_photo.jpg -o restored.png -w 1024 -h 1280 \
  "restore this vintage photo, remove peeling, tears and wear marks, \
  preserve natural features and expression, maintain warm nostalgic color tones"
```

**Tips for good restorations:**
- Describe the damage: "peeling", "scratches", "tears", "fading"
- Specify what to preserve: "natural features", "eye color", "hair", "expression"
- Mention the era for color tones: "1970s warm tones", "vintage sepia"

**Finding received images (Telegram/etc):**
```bash
node {{skillDir}}/sogni-agent.mjs --json --list-media images
```

**Do NOT use `ls`, `cp`, or other shell commands to browse user files.** Always use `--list-media` to find inbound media.

## IMPORTANT KEYWORD RULE

- If the user message includes the word "photobooth" (case-insensitive), always use `--photobooth` mode with `--ref` set to the user-provided face image.
- Prioritize this rule over generic image-edit flows (`-c`) for that request.

## LTX-2.3 Prompt Rule

Whenever the chosen video model is `ltx23-22b-fp8_t2v_distilled`, do not pass the user's short request through unchanged. Rewrite it into an LTX-2.3-safe prompt before calling `sogni-agent`.

- Output one single paragraph only. No line breaks, bullet points, section labels, tag lists, or screenplay formatting.
- Use 4-8 flowing present-tense sentences describing one continuous shot. No cuts, montage, or unrelated scene jumps.
- Start with shot scale plus the scene's visual identity, then describe environment, time of day, atmosphere, textures, and specific light sources.
- Keep people, clothing, props, and locations concrete and stable across the whole paragraph.
- Give the scene one main action thread from start to finish. Use connectors like `as`, `while`, and `then` so motion reads as a continuous filmed moment.
- If the user asks for dialogue, embed the spoken words inline as prose and identify who is speaking and how they deliver the line.
- Express emotion through visible physical cues such as posture, grip, jaw tension, breathing, or pacing. Ambient sound can be woven into the prose naturally.
- Use positive phrasing only. Do not add negative prompts, "no ..." clauses, on-screen text/logo requests, vague filler words like `beautiful` or `nice`, or structural markup such as `[DIALOGUE]`.
- Keep action density proportional to duration. For short clips, describe one main beat rather than several separate events.
- Preserve the user's request, but expand it into cinematic prose. Do not invent a different story just to make the prompt longer.

### Duration-Aware Pacing

Match scene density to clip length so prompts stay filmable:

- About `1-4s`: describe exactly 1 action or moment.
- About `5-8s`: describe about 2 sequential actions.
- About `9-12s`: describe about 3 sequential actions.
- Longer clips: add only a small number of additional sequential beats. Do not turn the prompt into a montage or a full story arc unless the duration clearly supports it.

### Orientation Mapping

When the user explicitly asks for an orientation or aspect ratio, map it to safe LTX dimensions:

- `vertical`, `portrait`, `story`, `reel`, `tiktok` -> `-w 1088 -h 1920`
- `landscape`, `horizontal`, `widescreen`, `youtube`, `16:9` -> `-w 1920 -h 1088`
- `square`, `1:1` -> `-w 1088 -h 1088`
- `4:3 portrait` -> `-w 832 -h 1088`
- `4:3 landscape` -> `-w 1088 -h 832`

### Camera Language Normalization

When the user uses loose camera language, translate it into concrete motion phrasing inside the prose prompt:

- `zoom in` -> `slow push-in`
- `zoom out` -> `slow pull-back`
- `pan left` / `pan right` -> `smooth pan left` / `smooth pan right`
- `orbit` / `circle around` -> `slow arc left` or `slow arc right`
- `follow` -> `tracking follow`

Short example:

```text
User ask: "4k video of a woman in a neon alley"

Use this shape instead: "A medium cinematic shot frames a woman in her 30s standing in a rain-soaked neon alley at night, violet and amber signs reflecting across the wet pavement while warm steam drifts from street vents. She wears a dark trench coat with damp strands of black hair clinging near her cheek as light glances across the fabric texture and the brick walls behind her. She turns toward the camera and steps forward with measured focus, one hand tightening around the strap of her bag while rain taps softly on the metal fire escape and a distant train hum rolls through the block. The camera performs a slow push-in as her jaw sets and her breathing steadies, maintaining smooth stabilized motion and a tense urban-thriller mood."
```

## Agent Usage

When user asks to generate/draw/create an image:

```bash
# Generate and save locally (use -Q for quality presets instead of memorizing model IDs)
node {{skillDir}}/sogni-agent.mjs -q -Q fast -o /tmp/generated.png "user's prompt"
node {{skillDir}}/sogni-agent.mjs -q -Q pro -o /tmp/generated.png "user's prompt"

# Generate with prompt variations (diverse images in one call)
node {{skillDir}}/sogni-agent.mjs -q -n 3 -o /tmp/cars.png "a {red|blue|green} sports car"

# Edit an existing image
node {{skillDir}}/sogni-agent.mjs -q -c /path/to/input.jpg -o /tmp/edited.png "make it pop art style"

# Generate video from image
node {{skillDir}}/sogni-agent.mjs -q --video --ref /path/to/image.png -o /tmp/video.mp4 "A medium shot holds on the subject in soft late-afternoon light as fabric edges and background details remain clear and stable. The camera performs a slow push-in while the subject shifts weight subtly and turns slightly toward the lens, keeping the motion gentle and continuous. Leaves rustle softly in the background and the scene maintains smooth cinematic movement with no abrupt action changes."

# Generate text-to-video
node {{skillDir}}/sogni-agent.mjs -q --video -o /tmp/video.mp4 "A wide cinematic shot opens on ocean waves rolling toward a rocky shoreline at sunset, golden light spreading across the water while sea mist drifts through the air. Foam patterns form and recede over the dark sand as the horizon glows orange and pink in the distance. The camera glides forward in one continuous movement, holding smooth stabilized motion and calm environmental detail throughout the scene."

# Generate direct music/audio
node {{skillDir}}/sogni-agent.mjs -q --music --duration 30 -o /tmp/music.mp3 "uplifting cinematic synthwave theme for a product launch"

# HD / "4K" text-to-video: prefer LTX-2.3
node {{skillDir}}/sogni-agent.mjs -q --video -m ltx23-22b-fp8_t2v_distilled -w 1920 -h 1088 -o /tmp/video.mp4 "A wide cinematic aerial shot opens over a rugged ocean coastline at golden hour, warm sunlight catching the cliff faces while white surf breaks against dark rock below. Low sea mist hangs over the water and bands of foam trace the shoreline as gulls wheel through the distance. The camera glides forward in one continuous pass, revealing the curve of the coast while wet stone flashes with reflected light and the scene keeps smooth stabilized motion from start to finish. The overall mood feels expansive and polished, with crisp environmental detail and steady travel-film energy."

# HD / "4K" image-to-video: prefer LTX i2v
node {{skillDir}}/sogni-agent.mjs -q --video --ref /path/to/image.png -m ltx23-22b-fp8_i2v_distilled -w 1920 -h 1088 -o /tmp/video.mp4 "A medium cinematic shot holds on the scene with clean subject separation and stable environmental detail as directional light shapes the surfaces and background depth. The camera performs a slow push-in while the main subject makes one subtle continuous movement, keeping posture and identity consistent from start to finish. Ambient motion in the background stays gentle and the overall clip remains smooth, stabilized, and visually coherent."

# Photobooth: stylize a face photo
node {{skillDir}}/sogni-agent.mjs -q --photobooth --ref /path/to/face.jpg -o /tmp/stylized.png "80s fashion portrait"

# Token auto-fallback (tries SPARK first, retries with SOGNI on insufficient balance)
node {{skillDir}}/sogni-agent.mjs -q --token-type auto -o /tmp/generated.png "user's prompt"

# Check current SPARK/SOGNI balances (no prompt required)
node {{skillDir}}/sogni-agent.mjs --json --balance

# Find user-sent images/audio
node {{skillDir}}/sogni-agent.mjs --json --list-media images

# Then send via message tool with filePath
```

### Quality Presets

Use `-Q` / `--quality` instead of memorizing model IDs:

| Preset | Model | Steps | Size | Speed |
|--------|-------|-------|------|-------|
| `fast` | z_image_turbo_bf16 | 8 | 512x512 | ~5-10s |
| `hq` | z_image_turbo_bf16 | default | 768x768 | ~10-15s |
| `pro` | flux2_dev_fp8 | 40 | 1024x1024 | ~2min |

Explicit `-m` overrides the quality preset's model. Explicit `-w`/`-h` overrides dimensions. When the user asks for "high quality", "best quality", or "pro", use `-Q pro`. For quick drafts or previews, use `-Q fast`.

### Dynamic Prompt Variations

When the user wants multiple variations (different colors, styles, subjects), use `{option1|option2|option3}` syntax with `-n`:

```bash
# 3 color variations
node {{skillDir}}/sogni-agent.mjs -q -n 3 "a {red|blue|green} sports car"

# 4 style variations
node {{skillDir}}/sogni-agent.mjs -q -n 4 "a portrait in {oil painting|watercolor|pencil sketch|pop art} style"
```

Options cycle sequentially per image. Without `{...}` syntax, `-n` generates multiple images with the same prompt.

### Token Auto-Fallback

Use `--token-type auto` when the user's SPARK balance might be low. It tries SPARK first (free daily tokens) and automatically retries with SOGNI if insufficient.

## High-Res Video Routing

When the user asks for video in **"hd"**, **"1080p"**, **"4k"**, **"uhd"**, or **"high-res"**, do not use the default WAN video models.

- For **text-to-video**, use `-m ltx23-22b-fp8_t2v_distilled`.
- For **image-to-video**, use `-m ltx23-22b-fp8_i2v_distilled`.
- Prefer LTX-sized dimensions such as `-w 1920 -h 1088`.
- For bare named resolutions such as "720p" without orientation or exact pixels, prefer `--target-resolution 768` or the closest requested short side instead of forcing landscape dimensions.
- When the prompt combines a named resolution with an aspect ratio, such as "720p 9:16", let the CLI infer both instead of forcing manual `-w`/`-h` unless the user gave exact pixels.
- If the user explicitly asks for `vertical`, `portrait`, `story`, `reel`, `tiktok`, `square`, or `4:3`, apply the matching dimensions from the **Orientation Mapping** rules instead of defaulting to 16:9.
- Rewrite the user's request using the **LTX-2.3 Prompt Rule** before invoking the command. Do not send short slogan-style prompts to LTX.
- Treat "4k" as a signal to use the highest practical LTX path exposed by this skill, even though the current wrapper caps non-WAN video dimensions at 2048px on the long side.

**Security:** Agents must use the CLI's built-in flags (`--extract-last-frame`, `--concat-videos`, `--list-media`) for all file operations and video manipulation. Never run raw shell commands (`ffmpeg`, `ls`, `cp`, etc.) directly.

## Animate Between Two Images (First-Frame / Last-Frame)

When a user asks to **animate between two images**, use `--ref` (first frame) and `--ref-end` (last frame) to create a creative interpolation video:

```bash
# Animate from image A to image B
node {{skillDir}}/sogni-agent.mjs -q --video --ref /tmp/imageA.png --ref-end /tmp/imageB.png -o /tmp/transition.mp4 "descriptive prompt of the transition"
```

### Animate a Video to an Image (Scene Continuation)

When a user asks to **animate from a video to an image** (or "continue" a video into a new scene):

1. **Extract the last frame** of the existing video using the built-in safe wrapper:
   ```bash
   node {{skillDir}}/sogni-agent.mjs --extract-last-frame /tmp/existing.mp4 /tmp/lastframe.png
   ```
2. **Generate a new video** using the last frame as `--ref` and the target image as `--ref-end`:
   ```bash
   node {{skillDir}}/sogni-agent.mjs -q --video --ref /tmp/lastframe.png --ref-end /tmp/target.png -o /tmp/continuation.mp4 "scene transition prompt"
   ```
3. **Concatenate the videos** using the built-in safe wrapper:
   ```bash
   node {{skillDir}}/sogni-agent.mjs --concat-videos /tmp/full_sequence.mp4 /tmp/existing.mp4 /tmp/continuation.mp4
   ```

This ensures visual continuity — the new clip picks up exactly where the previous one ended.

When the final stitched output needs a single external soundtrack, add `--concat-audio /path/to/audio.mp3` and optional `--concat-audio-start <sec>` to the same `--concat-videos` command. This is the local-agent advantage over browser-only workflows: generate clips with Sogni, then use the safe FFmpeg wrapper to stitch and mux audio locally.

**Do NOT run raw `ffmpeg` commands.** Always use `--extract-last-frame` and `--concat-videos` for video manipulation.

**Always apply this pattern when:**
- User says "animate image A to image B" → use `--ref A --ref-end B`
- User says "animate this video to this image" → extract last frame, use as `--ref`, target image as `--ref-end`, then stitch
- User says "continue this video" with a target image → same as above

## JSON Output

```json
{
  "success": true,
  "prompt": "a cat wearing a hat",
  "model": "z_image_turbo_bf16", 
  "width": 512,
  "height": 512,
  "urls": ["https://..."],
  "localPath": "/tmp/cat.png"
}
```

On error (with `--json`), the script returns a single JSON object like:

```json
{
  "success": false,
  "error": "Reference image 2314x1200 would resize to 512x266, but both dimensions must be divisible by 16.",
  "errorCode": "INVALID_VIDEO_SIZE",
  "errorType": "PARAMETER_INVALID",
  "errorCategory": "schema_validation",
  "retryable": false,
  "hint": "Try: --width 1296 --height 672 (or omit --strict-size)"
}
```

Balance check example (`--json --balance`):

```json
{
  "success": true,
  "type": "balance",
  "spark": 12.34,
  "sogni": 0.56
}
```

## Cost

Uses Spark tokens from your Sogni account. 512x512 images are most cost-efficient. Use `--token-type auto` to automatically fall back to SOGNI tokens when SPARK is insufficient.

## Persona System

Personas are named people with saved reference photos and optional voice clips. They enable identity-preserving generation across sessions.

### Managing Personas

```bash
# Add a persona with a reference photo
node {{skillDir}}/sogni-agent.mjs --persona-add "Mark" --ref face.jpg --relationship self --description "30s male, brown hair, brown eyes"

# Add with voice clip for video voice cloning
node {{skillDir}}/sogni-agent.mjs --persona-add "Sarah" --ref sarah.jpg --relationship partner --voice-clip sarah-voice.webm --voice "warm alto with British accent"

# List all personas
node {{skillDir}}/sogni-agent.mjs --persona-list --json

# Resolve a persona by name, tag, or pronoun
node {{skillDir}}/sogni-agent.mjs --persona-resolve "me" --json

# Generate using a persona (auto-injects photo as context)
node {{skillDir}}/sogni-agent.mjs --persona "Mark" -o /tmp/hero.png "superhero in dramatic lighting"

# Remove a persona
node {{skillDir}}/sogni-agent.mjs --persona-remove "Mark"
```

### Persona Pipeline Rules

When a user mentions a persona (by name, tag, or pronoun):

1. **For images:** Use `--persona "Name" "prompt"` which auto-injects the persona's reference photo as context and selects the Qwen editing model
2. **For video with voice cloning:** The persona's voice clip is used as `--reference-audio-identity` when `--video` is combined with `--persona`
3. **For video without voice clip:** Describe the voice in the prompt ("speaks in a warm alto with a British accent")

**Pronoun matching:**
- "me" / "myself" / "I" → persona with `relationship: self`
- "my wife" / "my husband" / "my partner" → persona with `relationship: partner`
- "my son" / "my daughter" / "my kid" → persona with `relationship: child`
- "my dog" / "my cat" / "my pet" → persona with `relationship: pet`

**Important:** User-uploaded photos are NOT personas. Only use `--persona` when referring to a saved persona by name or pronoun. For ad-hoc photos, use `-c` (context image) directly.

## Memory System

Memories are persistent key-value preferences stored locally at `~/.config/sogni/memories.json`.

```bash
# Save a preference
node {{skillDir}}/sogni-agent.mjs --memory-set preferred_style "watercolor and soft lighting"
node {{skillDir}}/sogni-agent.mjs --memory-set aspect_ratio "16:9"
node {{skillDir}}/sogni-agent.mjs --memory-set favorite_artist "Studio Ghibli"

# Read all memories
node {{skillDir}}/sogni-agent.mjs --memory-list --json

# Get one memory
node {{skillDir}}/sogni-agent.mjs --memory-get preferred_style --json

# Delete a memory
node {{skillDir}}/sogni-agent.mjs --memory-remove preferred_style
```

**Agent behavior:** Before generating, check memories with `--memory-list` and respect saved preferences. If the user says "I always want watercolor style", save it with `--memory-set`. Categories: `preference` (default), `fact`, `context`.

## Personality (Custom Agent Instructions)

Users can set custom instructions that shape agent behavior, stored at `~/.config/sogni/personality.txt`.

```bash
# Set personality
node {{skillDir}}/sogni-agent.mjs --personality-set "Be concise, always use cinematic lighting, suggest bold creative ideas"

# Read current personality
node {{skillDir}}/sogni-agent.mjs --personality-get --json

# Clear (reset to default)
node {{skillDir}}/sogni-agent.mjs --personality-clear
```

**Agent behavior:** Check personality on startup and adopt those instructions. Personality overrides default style but not hard constraints (safety, tool usage rules).

## Style Transfer

Apply artistic styles to existing images:

```bash
# Apply a named artist style
node {{skillDir}}/sogni-agent.mjs -c photo.jpg -o /tmp/styled.png "Apply style: Andy Warhol pop art with bold primary colors"

# Studio Ghibli transformation
node {{skillDir}}/sogni-agent.mjs -c photo.jpg -o /tmp/ghibli.png "Apply style: Studio Ghibli watercolor with soft pastel sky and lush greenery"

# For photos with people, always preserve identity
node {{skillDir}}/sogni-agent.mjs -c portrait.jpg -o /tmp/styled.png "Apply style: oil painting in the style of Vermeer. Preserve all facial features, expressions, and identity."
```

**Tips:** Reference artists and styles BY NAME for best results. Use positive phrasing. For photos with people, always append identity preservation instructions.

## Change Angle (Novel View Synthesis)

Generate a photo from a different camera angle:

```bash
# 3/4 view
node {{skillDir}}/sogni-agent.mjs --multi-angle -c subject.jpg --azimuth front-right "same subject"

# Side view
node {{skillDir}}/sogni-agent.mjs --multi-angle -c subject.jpg --azimuth left --elevation eye-level --distance medium "same subject"

# Full 360 turntable
node {{skillDir}}/sogni-agent.mjs --angles-360 -c subject.jpg "same subject"
```

**User term mapping:**
- "from the left" / "side view" → `--azimuth left`
- "3/4 view" / "three-quarter" → `--azimuth front-right`
- "from behind" / "back" → `--azimuth back`
- "looking up at" → `--elevation low-angle`
- "bird's eye" / "top-down" → `--elevation high-angle`
- "closeup" → `--distance close-up`

## Creative Workflow Patterns

### After Image Generation — Suggest Next Steps:
- "Animate into a video" → `--video --ref <result>`
- "Apply a different style" → `-c <result> "Apply style: ..."`
- "Change the angle" → `--multi-angle -c <result>`
- "Generate variations" → `-n 3 "{style1|style2|style3}"`
- "Refine at higher quality" → use `-Q pro`

### After Video Generation — Suggest Next Steps:
- "Try different motion" → re-generate with adjusted prompt
- "Add dialogue" → include spoken words in the LTX-2.3 prompt
- "Make it longer" → increase `--duration`
- "Combine videos" → `--concat-videos`
- "Add one soundtrack over stitched clips" → `--concat-videos ... --concat-audio <audio>`
- "Use a section of a source video/audio" → `--video-start`, `--audio-start`, and `--audio-duration`

### Music-to-Video Pipeline:
1. Use the provided/generated audio file as `--ref-audio`
2. If there is also a reference image, omit `--workflow` and let the CLI auto-select LTX 2.3 `ia2v`
3. If there is no reference image, omit `--workflow` and let the CLI auto-select LTX 2.3 `a2v`
4. Use `--workflow s2v` only for explicit face lip-sync with a face image
5. If only part of the song/audio should drive the clip, pass `--audio-start <sec>` and optionally `--audio-duration <sec>`

### Multi-Persona Scene:
1. Resolve all personas: `--persona-resolve "Mark" --json` and `--persona-resolve "Sarah" --json`
2. Generate scene with both: `-c mark-photo.jpg -c sarah-photo.jpg "Mark and Sarah at a cafe, use face from picture 1 for Mark, face from picture 2 for Sarah"`
3. Animate with one persona's voice identity: `--video --ref <scene.png> --reference-audio-identity <mark-voice.webm> "MARK: \"Exact spoken words.\""`

## Troubleshooting

- **Auth errors**: Check `SOGNI_API_KEY` or the API key in `~/.config/sogni/credentials`
- **i2v sizing gotchas**: Video sizes are model-specific. WAN uses min 480px, max 1536px, divisible by 16. LTX uses divisible-by-64 dimensions, and the current wrapper caps non-WAN video dimensions at 2048px on the long side. For i2v, the client wrapper resizes the reference (`fit: inside`) and uses the resized dimensions as the final video size. Because this uses rounding, a requested size can still yield an invalid final size.
- **Auto-adjustment**: With a local `--ref`, the script will auto-adjust the requested size to avoid resized reference dimensions that miss the model divisor.
- **If the script adjusts your size but you want to fail instead**: pass `--strict-size` and it will print a suggested `--width/--height`.
- **Timeouts**: Try a faster model or increase `-t` timeout
- **No workers**: Check https://sogni.ai for network status
