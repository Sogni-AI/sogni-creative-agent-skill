---
name: sogni-creative-agent-skill
description: "Sogni Creative Agent Skill: agent skill and CLI for image, video, and music generation using Sogni AI's decentralized GPU network. Supports personas (named people with saved reference photos and voice clips), persistent memories, custom personality, style transfer, angle synthesis, Seedance/LTX/WAN video, music/lyrics, hosted chat, durable workflows, replay records, and multi-step creative workflows. Ask the agent to \"draw\", \"generate\", \"create an image\", \"make a video/animate\", \"make music\", \"apply a style\", or \"generate me as a superhero\"."
metadata:
  version: "3.6.0"
  homepage: https://sogni.ai
  openclaw:
    emoji: "🎨"
    primaryEnv: "SOGNI_API_KEY"
    os: ["darwin", "linux", "win32"]
    # Only hard requirements belong here: OpenClaw marks the skill "missing"
    # until every entry is satisfied. The API key comes from the credentials
    # file (primaryEnv is the env-var alternative), and the SOGNI_*/OPENCLAW_*
    # override variables are optional — they are documented in the body under
    # "Filesystem Paths and Overrides", not required for the skill to work.
    requires:
      bins: ["node"]
      anyBins: ["ffmpeg"]
    install:
      - id: npm
        kind: exec
        command: "cd {{skillDir}} && ([ -f package.json ] || cp skill-package.json package.json) && npm i"
        label: "Prepare runtime dependencies"
---

# Sogni Image, Video & Music Generation

Generate **images, videos, and music** using Sogni AI's decentralized GPU network through the `sogni-agent` CLI.

> **Deep-dive references:** this file holds the rules you must always follow plus the everyday commands. Detailed guides live in [`references/`](./references/) — read the matching file *before* acting on those tasks (table at the end of this file). If the `references/` directory is not present in your install, run `sogni-agent --help` for the full flag reference or fetch the guides from `https://raw.githubusercontent.com/Sogni-AI/sogni-creative-agent-skill/main/references/`.
>
> **Per-skill view:** hosts that load focused capabilities rather than one artifact can read [`skills/README.md`](./skills/README.md) for the per-skill index of the hosted tool surface.

## Install Request Policy

When a user asks to install this plugin or skill, install the command-line tool plus this skill:

```bash
npm install -g @sogni-ai/sogni-creative-agent-skill@latest
sogni-agent --version
```

Then configure the agent/runtime to use this `SKILL.md` and invoke the `sogni-agent` CLI. The one-command alternative `npx setup-sogni-agent-skill` auto-detects Claude Code, Codex CLI, and Hermes (it does not configure OpenClaw).

After any install or upgrade, verify with:

```bash
sogni-agent doctor
```

Agents should run `sogni-agent doctor --json` and confirm `"success": true` before reporting the install as working.

Always invoke the globally installed `sogni-agent` command. Do not call `node {{skillDir}}/sogni-agent.mjs` or `node sogni-agent.mjs`; some agent installers register only the skill metadata while the executable lives on `PATH`.

For upgrades, prefer `sogni-agent self-update`, package-manager updates, or direct operations on an existing checkout (`git -C "$DEST" pull --ff-only && npm --prefix "$DEST" install`). Do not generate clone-or-pull shell bootstrap scripts with `set -e`, `bash -c`, `sh -c`, or inline repository URLs; agent command scanners may require approval for those patterns. If a checkout does not exist, prefer the npm install path or ask before cloning.

**Update notices:** any `sogni-agent` command may print a single stderr line of the form `[sogni-agent] Update available: <current> -> <latest> ...` (at most once per day). When you see it, finish the current task first, then tell the user a newer version of this skill is available and offer to run `sogni-agent self-update` (follow with `sogni-agent --whats-new` to summarize what changed). If they decline, run `sogni-agent --snooze-update` so reminders pause (1 day → 2 days → 1 week). Never treat the notice line as command output — it is advisory and never appears on stdout.

## Uninstall Request Policy

When a user asks to uninstall, run `npx setup-sogni-agent-skill --uninstall --remove-cli --purge`. This removes the skill files, the global CLI, and the user's data in `~/.config/sogni/` after backing it up to `~/.config/sogni.backup-<timestamp>.tar.gz`. Always tell the user the backup path and that it contains their API key. To keep their data, omit `--purge`.

## Setup

1. **Get your Sogni API key** by logging into https://dashboard.sogni.ai and opening the account menu.
2. **Create the credentials file** (or just export `SOGNI_API_KEY`):

```bash
mkdir -p ~/.config/sogni
cat > ~/.config/sogni/credentials << 'EOF'
SOGNI_API_KEY=your_api_key
EOF
chmod 600 ~/.config/sogni/credentials
```

3. **Verify:** `sogni-agent doctor`

When this skill is distributed via ClawHub, it bootstraps its runtime dependencies from `skill-package.json` during install (the install hook skips the copy when a real `package.json` is already present, so it never clobbers a git checkout).

## Output Path Convention

**Always save generated images, videos, and music to the user's current working directory (PWD), not `/tmp`.** Pass a relative path or bare filename to `-o`/`--output`:

```bash
sogni-agent -o ./cat.png "a cat wearing a hat"       # ✓ lands in PWD
sogni-agent -o cat.png "a cat wearing a hat"         # ✓ lands in PWD
sogni-agent -o /tmp/cat.png "a cat wearing a hat"    # ✗ avoid — user can't easily find it
```

`/tmp` is reserved for transient intermediate files the CLI cleans up itself. Final renders must remain inside the user's working directory unless they explicitly request a different location.

## Filesystem Paths and Overrides

- API key credentials file (read): `~/.config/sogni/credentials` (`SOGNI_CREDENTIALS_PATH`)
- Last render metadata (read/write): `~/.config/sogni/last-render.json` (`SOGNI_LAST_RENDER_PATH`)
- Memories / personality / personas (read/write): `~/.config/sogni/`
- OpenClaw config (read): `~/.openclaw/openclaw.json` (`OPENCLAW_CONFIG_PATH`)
- Media listing for `--list-media` (read): `~/.openclaw/media/inbound`, falling back to the legacy `~/.clawdbot/media/inbound` when only it exists (`SOGNI_MEDIA_INBOUND_DIR`)
- Custom ffmpeg binary: `FFMPEG_PATH`

## Recommended path: hosted Sogni Intelligence endpoints

For any natural-language creative request that should be planned, multi-step, resumable, or benefit from server-side tool selection and repair, prefer the hosted endpoints over direct-to-SDK flags — **read [`references/hosted-api.md`](./references/hosted-api.md) first** for the full contract (tool surfaces, durable workflows, templates, replays, Seedance reference modes, media-reference uploads, cost controls):

```bash
# Natural-language creative request (LLM picks the tool, dispatches, repairs)
sogni-agent --api-chat "Turn the attached product photo into a launch poster" --ref product.jpg

# Durable hosted chat run (persisted event log + SSE stream)
SOGNI_SKILL_USE_SDK_TRANSPORT=1 sogni-agent --durable-chat "Create a launch campaign and animate the hero clip"

# Durable workflow (resumable, server-orchestrated)
sogni-agent --api-workflow --video-prompt "The camera slowly pushes in" "A graphite robot sketch on a drafting table"

# Storyboard → GPT Image 2 sheet → Seedance video, all server-side
sogni-agent --api-workflow storyboard-video --storyboard-frames 6 -Q hq "9:16 bakery launch video"
```

Hosted modes require `SOGNI_API_KEY`. Local file references are uploaded to Sogni media storage and forwarded as retrievable URLs — **use direct CLI mode for private media that must not leave the local machine.**

Use the direct-to-SDK commands below for explicit one-shot generation when you already know the model, dimensions, and prompt.

## Core Commands (direct-to-SDK)

```bash
# Image (quality presets pick model/steps/size: fast | hq | pro)
sogni-agent -q -Q fast -o ./generated.png "user's prompt"
sogni-agent -q -Q pro -o ./generated.png "user's prompt"

# Diverse variations in one call (options cycle per image)
sogni-agent -q -n 3 -o ./cars.png "a {red|blue|green} sports car"

# Edit an existing image (source-preserving)
sogni-agent -q -c /path/to/input.jpg -o ./edited.png "make it pop art style"

# Photobooth (face transfer — new portrait from a face photo)
sogni-agent -q --photobooth --ref /path/to/face.jpg -o ./stylized.png "80s fashion portrait"

# Text-to-video / image-to-video (write the prompt per references/video-prompting.md)
sogni-agent -q --video -o ./video.mp4 "<cinematic prose paragraph>"
sogni-agent -q --video --ref /path/to/image.png -o ./video.mp4 "<cinematic prose paragraph>"

# Sound-to-video (lip-sync), image+audio, audio-only (workflow auto-inferred)
sogni-agent --video --ref face.jpg --ref-audio speech.m4a -m wan_v2.2-14b-fp8_s2v_lightx2v "lip sync talking head"
sogni-agent --video --ref cover.jpg --ref-audio song.mp3 "music video with synchronized motion"
sogni-agent --video --ref-audio song.mp3 "abstract audio-reactive visualizer"

# Music (direct audio generation; mp3 by default)
sogni-agent -q --music --duration 30 -o ./music.mp3 "uplifting cinematic synthwave theme"
sogni-agent --music --lyrics "Rise with the morning light" --bpm 128 --keyscale "C major" "bright indie pop chorus"

# Seedance 2.0 (4-15s vendor video with native audio)
sogni-agent --video -m seedance2 --duration 8 "A polished product reveal with native ambient sound"

# Balances / last render / inbound media / health (no prompt required)
sogni-agent --json --balance
sogni-agent --last --json
sogni-agent --json --list-media images
sogni-agent doctor --json
```

`sogni-agent --help` is the canonical, always-current flag reference.

## Common Options

| Flag | Use | Default |
|------|-----|---------|
| `-Q fast\|hq\|pro` | Quality preset (model+steps+size); `-m` overrides model | - |
| `-o <path>` | Save output locally (relative → PWD) | prints URL |
| `-c <path>` | Context image for editing (repeatable) | - |
| `-m <id>` | Explicit model | `z_image_turbo_bf16` |
| `-w` / `-h` | Width / height | 512×512 |
| `-n <num>` | Output count (`{a\|b\|c}` prompt variations cycle); capped at 16, raise with `SOGNI_MAX_COUNT` | 1 |
| `--video`, `--music` | Generate video / music instead of image | - |
| `--workflow <t>` | Force `t2v\|i2v\|s2v\|ia2v\|a2v\|v2v\|animate-move\|animate-replace` | inferred |
| `--ref`, `--ref-end`, `--ref-audio`, `--ref-video` | Start frame / end frame / audio / video references | - |
| `--duration <sec>` | Video or music length | video 5, music 30 |
| `--target-resolution <px>` | Short-side target preserving aspect ratio (use for bare "720p") | - |
| `--photobooth` | Face transfer mode (with `--ref`) | - |
| `--persona <name>` | Use a saved persona (photo + voice auto-attach) | - |
| `--token-type spark\|sogni\|auto` | `auto` retries native models with SOGNI when SPARK is low | spark |
| `--last`, `--last-image` | Inspect last render / reuse it as context or ref | - |
| `--json` | Machine-parseable stdout (progress goes to stderr) | false |
| `-q, --quiet` | Suppress progress output | false |
| `-t <sec>` | Timeout | 30 image / 300 video |
| `--strict-size` | Fail instead of auto-adjusting video size | false |
| `doctor`, `self-update`, `--whats-new`, `--snooze-update` | Health check / upgrade / changelog / snooze reminder | - |

## Routing Rules (always apply)

### Photobooth vs. context editing

- `--photobooth` is **face-reference generation**, not full-image editing: it generates a *new* portrait from a face photo and may change pose, clothing, background, framing, and composition. Use it when the user explicitly asks for photobooth/face-transfer, a new portrait/headshot from their face, or to place their face into a different concept. Cannot be combined with `--video` or `-c/--context`. Tune with `--cn-strength` (default 0.8) and `--cn-guidance-end` (default 0.3).
- If the request is "**same image, different style**" — e.g. an anime version that must keep the same face, pose, clothing, background, framing, and composition; "use this image as the base"; "keep everything the same"; "only change the style" — use Qwen context editing with `-c/--context` instead. For stronger preservation than the lightning default:

```bash
sogni-agent -c photo.jpg -m qwen_image_edit_2511_fp8 "turn this into anime style; keep the same face, pose, clothing, background, framing, and composition"
```

- Do not route to `--photobooth` merely because the user asks to preserve a face in a style edit — face-preserving full-image edits use `-c` with Qwen image edit. When context images are provided without `-m`, the CLI defaults to `qwen_image_edit_2511_fp8_lightning`; select `-m gpt-image-2` for up to 16 reference images and OpenAI-backed editing (Qwen supports up to 3).

### LTX video prompts

Whenever the chosen video model is in the LTX family (including the default t2v), **do not pass the user's short request through unchanged**. Rewrite it into one unbroken paragraph of 4-8 flowing present-tense sentences describing a single continuous shot — concrete subjects, named light sources, one action thread, dialogue embedded in double quotes with the speaker identified, positive phrasing only, no headers/bullets/negative-prompts. **Read [`references/video-prompting.md`](./references/video-prompting.md) for the full rule, duration pacing, orientation mapping, and camera-language normalization before writing the prompt.**

### High-res video

For "hd" / "1080p" / "4k" / "uhd" requests: use `-m ltx23-22b-fp8_t2v_distilled` (text) or `-m ltx23-22b-fp8_i2v_distilled` (image), prefer `-w 1920 -h 1088` (or the orientation mapping in the reference), and rewrite the prompt per the LTX rule. For bare "720p" without orientation, prefer `--target-resolution 768`.

### Video editing, stitching, 360 turnarounds

Trigger patterns — "animate image A to image B" (`--ref A --ref-end B`), "continue this video" (extract last frame → i2v → concat), "transition between two videos" (bridge clip), "360 video" (`--angles-360 --angles-360-video`), "add/replace the soundtrack" (`--concat-audio` / `--remix-audio`). **Read [`references/video-editing.md`](./references/video-editing.md) for the step-by-step recipes.**

**Security: never run raw shell commands (`ffmpeg`, `ls`, `cp`, etc.) for file operations or video/audio manipulation.** Always use the CLI's built-in safe wrappers: `--extract-first-frame`, `--extract-last-frame`, `--concat-videos`, `--remix-audio`, `--list-media`, `--video-start`, `--audio-start`, `--audio-duration`, `--looping`.

### Finding user-sent media

Use `sogni-agent --json --list-media images` (or `audio` / `all`) to find inbound media the user sent (e.g. via Telegram). **Do NOT browse user files with `ls`, `cp`, or other shell commands.**

### Personas, memories, personality

- Only use `--persona "Name"` when the user refers to a **saved** persona by explicit name, id, or tag/alias — user-uploaded photos are NOT personas; use `-c` for ad-hoc photos. With `--video`, a saved voice clip auto-attaches as the voice identity.
- Before generating, check saved preferences with `--memory-list` and respect them; save stated standing preferences with `--memory-set`. Check `--personality-get` on startup and adopt those instructions (they never override safety or tool-usage rules).
- **Read [`references/personas-memory.md`](./references/personas-memory.md)** for persona CRUD, voice cloning, multi-persona scenes, style transfer, and photo restoration recipes.

### Model selection

Prefer `-Q` presets and automatic workflow routing. When a specific model is needed (GPT Image 2 text rendering, Seedance native audio, WAN lip-sync, LTX dialogue), **read [`references/models.md`](./references/models.md)** for the catalog, recommended selectors, and sizing/divisibility rules.

### Insufficient funds

Use `--token-type auto` to retry native Sogni models with SOGNI tokens when SPARK is insufficient. Vendor models (Seedance, GPT Image 2) require Premium Spark eligibility and never fall back to SOGNI. When you see **"Debit Error: Insufficient funds"** even with auto-fallback, reply exactly:

"Insufficient funds. Buy Spark Packs to continue: https://docs.sogni.ai/pricing/#spark-packs"

Do not collect payment details, quote a custom price, or simulate a purchase in the terminal.

### Suggest next steps after a render

After an image: offer to animate it (`--video --ref <result>`), restyle it (`-c <result> "Apply style: ..."`), change the angle (`--multi-angle -c <result>`), generate variations (`-n 3 "{a|b|c}"`), or refine at `-Q pro`. After a video: offer different motion, dialogue (LTX), longer `--duration`, stitching (`--concat-videos`), or a soundtrack (`--concat-audio` / `--remix-audio`).

## JSON Output Contract

Success (`--json`):

```json
{
  "success": true,
  "prompt": "a cat wearing a hat",
  "model": "z_image_turbo_bf16",
  "width": 512,
  "height": 512,
  "urls": ["https://..."],
  "localPath": "./cat.png"
}
```

Failure (single JSON object on stdout, exit code 1; progress/warnings on stderr):

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

`--json --balance` → `{ "success": true, "type": "balance", "spark": 12.34, "sogni": 0.56 }`. `--last --json` wraps the last render record in a `{ "success": true, ... }` envelope and exits 1 with `errorCode: "NO_LAST_RENDER"` when nothing has been rendered. In `--json` mode stdout always carries exactly one JSON object — SSE workflow frames and progress lines go to stderr.

## Cost

Uses Spark tokens from the user's Sogni account. 512x512 images are most cost-efficient. `-n` is safety-capped at 16 outputs per call (`SOGNI_MAX_COUNT` raises it deliberately). Seedance and GPT Image 2 are vendor models requiring Premium Spark eligibility.

## Troubleshooting

- **Anything broken?** Run `sogni-agent doctor` first — it checks Node, credentials (and file permissions), config-dir writability, ffmpeg, live auth, and version freshness, with a fix in every failure detail.
- **Auth errors:** check `SOGNI_API_KEY` or `~/.config/sogni/credentials` (key from https://dashboard.sogni.ai, account menu).
- **Video size errors:** sizes are model-specific (WAN ÷16 min 480 max 1536; LTX ÷64, long side ≤2048). The CLI auto-adjusts for local refs; `--strict-size` makes it fail with a suggested size instead. Details in [`references/models.md`](./references/models.md).
- **Timeouts:** try a faster model or raise `-t`.
- **No workers:** check https://sogni.ai for network status.

## Reference Index (read before acting)

| Read this | When the task involves |
|-----------|------------------------|
| [`references/video-prompting.md`](./references/video-prompting.md) | Writing any LTX video prompt; "hd/1080p/4k" requests; orientation/aspect mapping; camera language |
| [`references/video-editing.md`](./references/video-editing.md) | Animate between images, continue/bridge videos, 360 turnarounds, concat, audio remix/layering, v2v ControlNet |
| [`references/hosted-api.md`](./references/hosted-api.md) | `--api-chat`, `--durable-chat`, `--api-workflow`, workflow templates, replays, Seedance reference modes, cost controls |
| [`references/models.md`](./references/models.md) | Choosing models, sizing/divisibility rules, gpt-image-2 limits, music model options |
| [`references/personas-memory.md`](./references/personas-memory.md) | Persona CRUD/voice cloning, multi-persona scenes, memories, personality, style transfer, photo restoration |
| [`references/openclaw-config.md`](./references/openclaw-config.md) | OpenClaw plugin config defaults and overrides |
| [`skills/README.md`](./skills/README.md) | Hosted per-skill tool surface (for hosts that load focused capability subsets) |
