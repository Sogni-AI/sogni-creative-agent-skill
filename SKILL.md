---
name: sogni-creative-agent-skill
description: "Sogni Creative Agent Skill: agent skill and CLI for image, video, and music generation using Sogni AI's decentralized GPU network. Supports one-click image-folder loop reels, personas (named people with saved reference photos and voice clips), persistent memories, custom personality, style transfer, angle synthesis, Seedance/HappyHorse/LTX/WAN video, music/lyrics, hosted chat, durable workflows, replay records, and multi-step creative workflows. Ask the agent to \"draw\", \"generate\", \"create an image\", \"make a video/animate\", \"turn this image folder into a loop\", \"make music\", \"apply a style\", or \"generate me as a superhero\"."
metadata:
  version: "3.22.0"
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

**`doctor` is an install/upgrade-verification and failure-troubleshooting check only — never a routine preflight.** Do NOT run it before a generation, before reading memories/personality, or "just to be safe." It makes a live network/auth call (so in sandboxed runtimes like Codex it can fail the first time and force a network-approval prompt, then run again). Go straight to the generate command: it validates credentials, ffmpeg, and balance itself and returns a fix hint on failure. Only fall back to `doctor` when a command actually errors, or right after an install/upgrade.

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
- Reusable app-ID slot pool (read/write): `~/.config/sogni/app-ids/slot-<n>` plus `.lease` files; new IDs use `sogni-agent-<uuid>` (`SOGNI_APP_ID_POOL_DIR`/`SOGNI_APP_ID_POOL_MAX`). Concurrent agent processes lease distinct slots automatically; the legacy single `~/.config/sogni/app-id` file migrates into slot-0 on first use. Set a stable `SOGNI_APP_ID` for ephemeral/container homes or long-lived daemons, or `SOGNI_APP_ID_PATH` for legacy single-file mode.
- Last render metadata (read/write): `~/.config/sogni/last-render.json` (`SOGNI_LAST_RENDER_PATH`)
- Model catalog: `https://api.sogni.ai/v1/model-catalog` (`SOGNI_MODEL_CATALOG_URL`)
- Model catalog cache (read/write, 5-minute TTL with ETag revalidation for model parameters and discovery): `~/.config/sogni/model-catalog-cache.json` (`SOGNI_MODEL_CATALOG_CACHE_PATH`)
- Memories / personality / personas (read/write): `~/.config/sogni/`
- OpenClaw config (read): `~/.openclaw/openclaw.json` (`OPENCLAW_CONFIG_PATH`)
- Media listing for `--list-media` (read): `~/.openclaw/media/inbound`, falling back to the legacy `~/.clawdbot/media/inbound` when only it exists (`SOGNI_MEDIA_INBOUND_DIR`)
- Custom ffmpeg / ffprobe binaries: `FFMPEG_PATH`, `FFPROBE_PATH`

## Recommended path: you plan, Sogni executes

You (the calling LLM) are almost always more capable than Sogni's hosted planning model, so **do the planning and tool selection yourself** and let the hosted endpoints do what only the server can — run on the GPU network, persist assets/manifests, orchestrate durable multi-step runs with replay, and apply structured-contract repair. Don't flatten a rich request into a single natural-language string and hand planning back to a weaker model. Match the mode to the work:

- **One-shot generation** → direct-to-SDK flags (the Core Commands below). You already know the tool, model, and prompt — just run it. No LLM round-trip, lowest latency/cost.
- **Multi-step / durable / resumable** → `--api-workflow` with an explicit step graph via `--workflow-input <json|@path>`. *You* author the exact plan — `steps[]` with `toolName`, `arguments`, and `dependsOn` bindings (e.g. `sourceStepId`, `targetArgument`, `transform: "artifact_url"`) — and the server executes it durably with replay/resumability, **without re-planning through the hosted LLM**. Presets like `--api-workflow storyboard-video` are fine when they already match the request.
- **`--api-chat` / `--durable-chat` (hosted LLM owns the loop)** → reserve for when you deliberately *want* the hosted model to drive a long server-side tool loop (saves client round-trips on long async jobs), when structured-contract repair recipes should govern, or when several local files must be uploaded for a single turn (multi-file local upload is only supported here). These delegate planning to the hosted model — choose them on purpose, not by default.

**Read [`references/hosted-api.md`](./references/hosted-api.md) first** for the full hosted contract (tool surfaces, durable workflows, templates, replays, Seedance reference modes, media-reference uploads, cost controls).

```bash
# One-shot: you pick the tool, the server just executes (see Core Commands below)
sogni-agent -q -Q hq -o ./poster.png "Turn the product photo into a launch poster"

# Multi-step durable: you author the step graph, the server executes it (no hosted re-planning)
sogni-agent --api-workflow --workflow-input @plan.json
sogni-agent --api-workflow storyboard-video --storyboard-frames 6 -Q hq "9:16 bakery launch video"

# Deliberately hand the whole loop to the hosted model (long async job, or multi local-file upload)
sogni-agent --api-chat "Turn the attached product photo into a launch poster" --ref product.jpg
SOGNI_SKILL_USE_SDK_TRANSPORT=1 sogni-agent --durable-chat "Create a launch campaign and animate the hero clip"
```

Hosted modes require `SOGNI_API_KEY`. Local file references are uploaded to Sogni media storage and forwarded as retrievable URLs — **use direct CLI mode for private media that must not leave the local machine.**

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
# Single-image i2v defaults to wan_v2.2-14b-fp8_i2v_lightx2v; adding --ref-end
# defaults to ltx23-22b-fp8_i2v_distilled (transition/morph LoRA auto-applies).
sogni-agent -q --video -o ./video.mp4 "<cinematic prose paragraph>"
sogni-agent -q --video --ref /path/to/image.png -o ./video.mp4 "<cinematic prose paragraph>"
sogni-agent -q --video --ref ./first.png --ref-end ./last.png -o ./morph.mp4 "<LTX transition paragraph>"

# LTX-2.3 10Eros v1.4 (explicit uncensored I2V; 30GB+ workers only)
sogni-agent -q --video --workflow i2v --ref /path/to/image.png -m ltx23-eros --no-filter -o ./video.mp4 "<LTX-rewritten paragraph>"

# Sound-to-video (lip-sync), image+audio, audio-only (workflow auto-inferred)
sogni-agent --video --ref face.jpg --ref-audio speech.m4a -m wan_v2.2-14b-fp8_s2v_lightx2v "lip sync talking head"
sogni-agent --video --ref cover.jpg --ref-audio song.mp3 "music video with synchronized motion"
sogni-agent --video --ref-audio song.mp3 "abstract audio-reactive visualizer"

# Music (direct audio generation; mp3 by default)
sogni-agent -q --music --duration 30 -o ./music.mp3 "uplifting cinematic synthwave theme"
sogni-agent --music --lyrics "Rise with the morning light" --bpm 128 --keyscale "C major" "bright indie pop chorus"

# Seedance 2.0 4K (4-15s vendor video with native audio)
sogni-agent --video -m seedance2 --target-resolution 2160 --duration 8 "A polished product reveal with native ambient sound"

# HappyHorse 1.1 (3-15s vendor video, fixed 24fps, native audio). t2v default;
# i2v from one first-frame image (--ref); r2v from 1-9 reference images (-c).
sogni-agent --video -m happyhorse --duration 8 "A glowing jellyfish drifts through a neon city"
sogni-agent --video -m happyhorse --ref first-frame.png "Bring the scene to life"
sogni-agent --video -m happyhorse-1.1-r2v -c ref1.png -c ref2.png "Blend the references into one continuous shot"

# Balances / last render / inbound media / health (no prompt required)
sogni-agent --json --balance
sogni-agent --last --json
sogni-agent --json --list-media images
sogni-agent --list-models
sogni-agent --search-models darkbeast
sogni-agent --search-models spicy
sogni-agent --list-models --model-tag uncensored
sogni-agent --json --search-models darkbeast
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
| `--ref`, `--ref-end`, `--ref-audio`, `--ref-video`, `--mask` | Start frame / end frame / audio / video / inpaint mask references | - |
| `--control-type`, `--outpaint-position`, `--outpaint-aspect-ratio` | LTX-2.3 v2v control mode and outpaint canvas controls | - |
| `--duration <sec>` | Video or music length | video 5, music 30 |
| `--target-resolution <px>` | Short-side target preserving aspect ratio (use `2160` for Seedance 4K) | - |
| `--photobooth` | Face transfer mode (with `--ref`) | - |
| `--persona <name>` | Use a saved persona (photo + voice auto-attach) | - |
| `--token-type spark\|sogni\|auto` | `auto` retries native models with SOGNI when SPARK is low | spark |
| `--billing-mode auto\|subscription\|tokens` | `subscription` requires Sogni Unlimited coverage; `tokens` opts out of it | server decides |
| `--last`, `--last-image` | Inspect last render / reuse it as context or ref | - |
| `--list-models [query]`, `--search-models <query>` | List or search the live Supernet image/video/audio model catalog | - |
| `--model-media image\|video\|audio\|all` | Filter live model discovery by output media | all |
| `--model-network fast\|relaxed` | Select the Supernet used for live model discovery | configured network or fast |
| `--model-tag <tag>` | Filter by an official catalog tag such as `spicy` or `uncensored`; repeat for AND matching | - |
| `--json` | Machine-parseable stdout (progress goes to stderr) | false |
| `-q, --quiet` | Suppress progress output | false |
| `-t <sec>` | Timeout | 30 image / 300 video |
| `--strict-size` | Fail instead of auto-adjusting video size | false |
| `doctor`, `self-update`, `--whats-new`, `--snooze-update` | Health check / upgrade / changelog / snooze reminder | - |

## Routing Rules (always apply)

### Photobooth vs. context editing

- `--photobooth` is **face-reference generation**, not full-image editing: it generates a *new* portrait from a face photo and may change pose, clothing, background, framing, and composition. Use it when the user explicitly asks for photobooth/face-transfer, a new portrait/headshot from their face, or to place their face into a different concept. Cannot be combined with `--video` or `-c/--context`. Tune with `--cn-strength` (default 0.8) and `--cn-guidance-end` (default 0.3).
- If the request is "**same image, different style**" — e.g. an anime version that must keep the same face, pose, clothing, background, framing, and composition; "use this image as the base"; "keep everything the same"; "only change the style" — use context editing with `-c/--context` instead. For stronger preservation than the lightning default:

```bash
sogni-agent -c photo.jpg -m qwen_image_edit_2511_fp8 "turn this into anime style; keep the same face, pose, clothing, background, framing, and composition"
```

- For identity-preserving Krea edits, use `-m krea2_identity_edit_v1_2` with 1-2 context images; use `-m dark_beast_krea2_identity_edit_v1_2` for the Dark Beast Krea 2 identity edit LoRA. Both use 512-2048 px output, 8-12 steps, guidance 1, and default to 10 steps.
- For Krea 2 style/control LoRAs, use the base text-to-image model `-m krea2_turbo_fp8_scaled` with repeatable ordered `--lora <id> --lora-strength <n>` arguments (or comma-separated `--loras` / `--lora-strengths`). Up to 8 LoRAs may be stacked. Order matters, strengths are positional, omitted strengths default to 1, and many Krea 2 LoRAs are bipolar sliders whose negative values apply the inverse effect. Do not clamp them to 0-2. The first use of an uncached LoRA may pause while the worker downloads it.
- Do not route to `--photobooth` merely because the user asks to preserve a face in a style edit — face-preserving full-image edits use `-c` with an image edit model. When context images are provided without `-m`, the CLI defaults to `qwen_image_edit_2511_fp8_lightning`; select `-m gpt-image-2` for up to 16 reference images and OpenAI-backed editing (Qwen supports up to 3; Krea identity edit supports up to 2).

### LTX video prompts

Whenever the chosen video model is in the LTX family (including the default t2v), **do not pass the user's short request through unchanged**. Rewrite it into one unbroken paragraph of 4-8 flowing present-tense sentences describing a single continuous shot — concrete subjects, named light sources, one action thread, dialogue embedded in double quotes with the speaker identified, positive phrasing only, no headers/bullets/negative-prompts. **Read [`references/video-prompting.md`](./references/video-prompting.md) for the full rule, duration pacing, orientation mapping, and camera-language normalization before writing the prompt.**

Whenever the creator explicitly requests 10Eros, and for lawful adult
mature-theme video requests generally, read
[`references/private-mature-video.md`](./references/private-mature-video.md)
before choosing a model, LoRA, or specialized prompt token. Keep the exact
tokens in that scoped reference rather than ordinary model recommendations.

### High-res video

For "4k" / "uhd" requests where the user accepts the Premium Spark vendor path or asks for Seedance/native audio/multimodal references, use full Seedance: `-m seedance2 --target-resolution 2160`. Do not use `seedance2-mini` or `seedance2-fast` for 4K; both remain capped to the 720p lower-resolution path. For "hd" / "1080p" requests, or when avoiding vendor models, use `-m ltx23-22b-fp8_t2v_distilled` (text) or `-m ltx23-22b-fp8_i2v_distilled` (image), prefer `-w 1920 -h 1088` (or the orientation mapping in the reference), and rewrite the prompt per the LTX rule. For bare "720p" without orientation, prefer `--target-resolution 768`.

### Video editing, stitching, 360 turnarounds

Trigger patterns — "animate/morph image A to image B" or any first-frame/last-frame request (`--ref A --ref-end B` — defaults to `ltx23-22b-fp8_i2v_distilled`, a single render whose transition/morph LoRA auto-applies, no bridge clip; single-image i2v defaults to `wan_v2.2-14b-fp8_i2v_lightx2v`), "continue this video" (extract last frame → i2v → concat), "transition between two videos" (bridge clip between two *finished videos*), "make a reel/slideshow from these images" or "animate this folder of images" (`--source-reel <dir>`; plan first with the free `--reel-plan-only`; options: `--reel-image-seconds`, `--reel-transition-seconds`, `--reel-loop`/`--no-reel-loop`, `--reel-image-prompt`, `--reel-transition-prompt`), "360 video" (`--angles-360 --angles-360-video`), "add/replace the soundtrack" (`--concat-audio` / `--remix-audio`). **Read [`references/video-editing.md`](./references/video-editing.md) for the step-by-step recipes.**

For a **one-click polished folder loop** where each source image animates and then morphs directly into the next original image, read [`references/loop-maker.md`](./references/loop-maker.md). Use its visually deduplicated, one-LTX-clip-per-pair workflow instead of the default SourceReel split animation-plus-bridge structure. Do not route true 360 novel-view synthesis to this direct pairwise workflow: a turning subject or occluder wipe is not a camera orbit. Trigger on requests such as "Sogni Loop Maker", "make this image folder a seamless loop", "one-click animated photo reel", the Claude Code command `/sogni-creative-agent:loop-maker`, or the Codex skill `$sogni-creative-agent:loop-maker`.

**Security: never run raw shell commands (`ffmpeg`, `ffprobe`, `ls`, `cp`, etc.) for file operations or video/audio manipulation.** Always use the CLI's built-in safe wrappers: `--extract-first-frame`, `--extract-frame-at`, `--extract-last-frame`, `--verify-video`, `--concat-videos`, `--remix-audio`, `--list-media`, `--video-start`, `--audio-start`, `--audio-duration`, `--looping`.

### Finding user-sent media

Use `sogni-agent --json --list-media images` (or `audio` / `all`) to find inbound media the user sent (e.g. via Telegram). **Do NOT browse user files with `ls`, `cp`, or other shell commands.**

### Personas, memories, personality

- Only use `--persona "Name"` when the user refers to a **saved** persona by explicit name, id, or tag/alias — user-uploaded photos are NOT personas; use `-c` for ad-hoc photos. With `--video`, a saved voice clip auto-attaches as the voice identity.
- Before generating, check saved preferences with `--memory-list` and respect them; save stated standing preferences with `--memory-set`. Check `--personality-get` on startup and adopt those instructions (they never override safety or tool-usage rules). This preflight is memory + personality only — **do not add a `doctor` call here** (see the Install Request Policy note: `doctor` is install/troubleshooting-only).
- **Read [`references/personas-memory.md`](./references/personas-memory.md)** for persona CRUD, voice cloning, multi-persona scenes, style transfer, and photo restoration recipes.

### Seamless tiling and tessellations

When the requested image is meant to **repeat edge to edge without visible joins** — a seamless pattern, repeating texture, wallpaper, tiling background, or an Escher-style tessellation of interlocking figures — an ordinary render will not wrap. Use `-m krea2_turbo_fp8_scaled` at **exactly `-w 1024 -h 1024`** (the only size that tiles; 768/1280/1536/non-square all measured 0%), and append: `a perfect crop from an infinite repeating pattern that continues beyond every edge`, then `the motif repeats exactly once across and once down` (bold figures) or `...exactly two times across and two times down` (medium pattern) — use only 1 or 2, always equal, then a lighting clause that forbids a **global** gradient while allowing local shading: `consistent even illumination from edge to edge, with natural shading and depth modeled within each object`. Never omit or vaguen the lighting clause. Keep the subject's palette tonally close. Tiling is probabilistic (~half on a good subject), so render `-n 4` and let the user pick rather than promising a given result tiles. **Read [`references/seamless-tiling.md`](./references/seamless-tiling.md) for the full recipe, the Escher-tessellation variant, subject hit rates, and how to verify a seam.**

### Model selection

Prefer `-Q` presets and automatic workflow routing. When a specific model is needed (GPT Image 2 text rendering, Seedance or HappyHorse native audio, WAN lip-sync, LTX dialogue), **read [`references/models.md`](./references/models.md)** for the catalog, recommended selectors, and sizing/divisibility rules.

`ltx23-eros` is an explicit-only uncensored LTX-2.3 image-to-video selector. Never choose it merely because a prompt appears sexual or another model rejects a request. Use it only when the user explicitly asks for 10Eros/the uncensored model and explicitly permits disabling the content filter. It requires an input image, `--no-filter`, and a 30GB+ worker; the CLI pins its required 9 steps, guidance 1, `euler_ancestral` sampler, and `manual_sigmas` scheduler.

### Insufficient funds

Use `--token-type auto` to retry native Sogni models with SOGNI tokens when SPARK is insufficient. Vendor models (Seedance, HappyHorse, GPT Image 2) require Premium Spark eligibility and never fall back to SOGNI. When you see **"Debit Error: Insufficient funds"** even with auto-fallback, reply exactly:

"Insufficient funds. Buy Spark Packs to continue: https://docs.sogni.ai/pricing/#spark-packs"

Do not collect payment details, quote a custom price, or simulate a purchase in the terminal.

### Sogni Unlimited Subscription & Billing Errors

On a **Sogni Unlimited** subscription, Sogni-hosted (Supernet) image, video, and music generation is covered by the plan under a fair-use policy instead of spending Spark or SOGNI. Plans: Unlimited ($20/mo, $199/yr) and Unlimited Pro ($50/mo, $498/yr), with a one-per-account 3-day free trial. External-vendor models — **GPT Image 2**, **Seedance 2.0 / Mini / Fast**, and **HappyHorse 1.1** — are never covered and always require Premium Spark, even on an active subscription. Selecting SOGNI opts a job out of coverage. The server decides coverage from the verified entitlement and resolved model; never tell the user a vendor model is "free on Unlimited."

**Do not infer a Spark charge from `tokenType: "spark"`.** `tokenType` is the quote/accounting denomination and may remain `spark` on a covered Unlimited job. Billing is decided separately by the server's `paymentModel`: `subscription` means the artist Spark/SOGNI debit was skipped; `paid_spark`, `free_spark`, or `sogni` means token billing. If a result does not expose `paymentModel`, treat the payment source as unknown rather than warning that Spark was spent. Check the structured subscription state or transaction history when available. A successful request made with `--billing-mode subscription` is covered: if the server cannot use Unlimited, it rejects the request with `4078` or `4080` instead of silently falling back to Spark.

Unlimited is fair-use, not unmetered: per-UTC-day concurrency ceilings step down as completed renders climb (and reset at UTC midnight), and once a plan's fast-lane allowance is exceeded, further jobs run best-effort in a lower-priority standard queue until capacity resets. Describe this as **fair use** / a **standard (throttled) queue** — never as "relaxed."

When a generation cannot bill to the subscription, the CLI returns a structured error (`errorCategory: "subscription_billing"`). Respond by the `errorCode`, and **do not** collect payment details or simulate a purchase:

- **`4078` — Unlimited billing unavailable for this generation.** Either a vendor model the subscription never covers (use Premium Spark for GPT Image 2 / Seedance / HappyHorse), or no verified entitlement right now (reconnect and retry). Offer the Premium Spark / `--token-type` path; do not claim the subscription will cover a vendor model.
- **`4079` — Maximum queued jobs reached.** Ask the user to wait for queued jobs to finish before submitting more; this resolves on its own.
- **`4080` — Renewal payment is being retried; access is paused.** Tell the user Unlimited resumes automatically once the renewal succeeds and that they can render now with Spark or SOGNI (`--token-type spark` / `sogni`). **Never auto-retry the covered job in a loop** — it will keep failing until billing recovers.
- **`4081` — Higher plan required.** Suggest upgrading to Unlimited Pro.

Cancelling a paid subscription keeps access until the end of the paid period; cancelling during the trial ends access immediately. Manage billing where it was purchased (Stripe portal for web, App Store / Google Play settings for mobile) — the CLI does not change plans.

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

`--json --balance` → `{ "success": true, "type": "balance", "spark": 12.34, "sogni": 0.56, "username": "name", "subscription": { "active": true, "status": "active", "tier": "unlimited" } }` (`username`/`subscription` are `null` when unavailable; an active subscription means eligible renders are covered by Sogni Unlimited even when `spark` is low). `--last --json` wraps the last render record in a `{ "success": true, ... }` envelope and exits 1 with `errorCode: "NO_LAST_RENDER"` when nothing has been rendered. In `--json` mode stdout always carries exactly one JSON object — SSE workflow frames and progress lines go to stderr.

## Cost

Eligible Sogni-hosted renders use Unlimited coverage when active; otherwise renders use the selected Spark or SOGNI token path. 512x512 images are most cost-efficient. `-n` is safety-capped at 16 outputs per call (`SOGNI_MAX_COUNT` raises it deliberately). Seedance, HappyHorse, and GPT Image 2 are vendor models requiring Premium Spark eligibility.

## Troubleshooting

- **Anything broken?** Run `sogni-agent doctor` first — it checks Node, credentials (and file permissions), config-dir writability, ffmpeg, live auth, and version freshness, with a fix in every failure detail.
- **Auth errors:** check `SOGNI_API_KEY` or `~/.config/sogni/credentials` (key from https://dashboard.sogni.ai, account menu).
- **Error 4061 / too many app IDs:** the CLI leases stable IDs from the persistent pool in `~/.config/sogni/app-ids/`. Do not delete that directory between runs. For ephemeral/container homes, set the same `SOGNI_APP_ID` on every session. App IDs already registered today remain counted until 00:00 UTC, so an existing block may require waiting for that reset once after upgrading.
- **Kicked mid-render / SWITCH_CONNECTION 4015:** two processes shared one app ID. The slot pool prevents this for concurrent CLI runs; if a long-lived daemon also uses this account, give it its own pinned `SOGNI_APP_ID`.
- **Video size errors:** sizes are model-specific (WAN ÷16 min 480 max 1536; LTX ÷64, long side ≤2048). The CLI auto-adjusts for local refs; `--strict-size` makes it fail with a suggested size instead. Details in [`references/models.md`](./references/models.md).
- **Timeouts:** try a faster model or raise `-t`.
- **No workers:** check https://sogni.ai for network status.

## Reference Index (read before acting)

| Read this | When the task involves |
|-----------|------------------------|
| [`references/video-prompting.md`](./references/video-prompting.md) | Writing LTX video prompts; high-res/4K routing; orientation/aspect mapping; camera language |
| [`references/private-mature-video.md`](./references/private-mature-video.md) | Mature-theme video model, LoRA, frame modes, and prompt tokens |
| [`references/video-editing.md`](./references/video-editing.md) | Animate between images, continue/bridge videos, 360 turnarounds, concat, audio remix/layering, v2v ControlNet |
| [`references/loop-maker.md`](./references/loop-maker.md) | One-click image-folder loops with visual deduplication, direct LTX first/last-frame clips, music, and verification |
| [`references/hosted-api.md`](./references/hosted-api.md) | `--api-chat`, `--durable-chat`, `--api-workflow`, workflow templates, replays, Seedance reference modes, cost controls |
| [`references/seamless-tiling.md`](./references/seamless-tiling.md) | Seamless repeating patterns, wallpapers, tiling textures, Escher tessellations |
| [`references/models.md`](./references/models.md) | Choosing models, sizing/divisibility rules, image edit reference limits, music model options |
| [`references/personas-memory.md`](./references/personas-memory.md) | Persona CRUD/voice cloning, multi-persona scenes, memories, personality, style transfer, photo restoration |
| [`references/openclaw-config.md`](./references/openclaw-config.md) | OpenClaw plugin config defaults and overrides |
| [`skills/README.md`](./skills/README.md) | Hosted per-skill tool surface (for hosts that load focused capability subsets) |
