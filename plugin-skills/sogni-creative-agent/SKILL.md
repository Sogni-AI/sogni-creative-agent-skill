---
name: sogni-creative-agent
description: "Sogni Creative Agent: image, 3D, speech, video, and music generation using Sogni AI's decentralized GPU network. Supports personas, persistent memories, custom personality, style transfer, angle synthesis, MiniMax H3/Seedance/HappyHorse/LTX/WAN video, music/lyrics, hosted chat, durable workflows, replay records, and multi-step creative workflows. Invoke when the user asks to \"draw\", \"generate\", \"create an image\", \"make a video\", \"animate\", \"make music\", \"build a playable world\", \"apply a style\", or \"generate me as a superhero\"."
---

# Sogni Creative Agent

Generate **images, videos, and music** via Sogni AI's decentralized GPU network through the `sogni-agent` CLI shipped with this plugin.

**Claude Code plugin command:** invoke `sogni-agent-claude-code` for every
Sogni command in this skill. Wherever this file or a referenced root guide says
`sogni-agent`, substitute `sogni-agent-claude-code`. This fixed launcher
preserves normal CLI behavior while attributing the request to Claude Code.

## Setup

1. Install the CLI (one-time): `npm install -g @sogni-ai/sogni-creative-agent-skill@latest`.
2. Provide your Sogni API key (get one at https://dashboard.sogni.ai → account menu): either set `SOGNI_API_KEY` in the environment, or save it to `~/.config/sogni/credentials` as `SOGNI_API_KEY=<your-key>`.
3. Verify with `sogni-agent doctor --json` and confirm `"success": true` before reporting the install as working. Run `doctor` only after an install or upgrade, or when a command fails, never as a preflight before generating: generation commands check the key, ffmpeg and balance themselves.
4. Optional config files honored: `~/.config/sogni/credentials`, `~/.config/sogni/last-render.json`.

Keep the key secret. When the user has a terminal, have them save it there rather than paste it into the chat; if they give it to you anyway, write it only to the credentials file and don't repeat it back. Never read or print the key or that file (`sogni-agent doctor --json` checks it without showing it), and never put it in a commit, a generated file or a log.

Do not run the default `npx setup-sogni-agent-skill` from an installed plugin unless the user explicitly wants a separate personal skill registration in `~/.claude/skills/` or another host's personal skill directory; using both can create duplicate skills.

**Uninstall:** remove `sogni-creative-agent@sogni` with Claude Code's plugin manager. To also remove the global CLI and Sogni data, run `npx setup-sogni-agent-skill --uninstall --remove-cli --purge` after the plugin is removed; it backs up `~/.config/sogni/` to `~/.config/sogni.backup-<timestamp>.tar.gz` first. Tell the user the backup path; it holds their API key. Omit `--purge` to keep data. This cleanup command does not uninstall the Claude Code plugin itself.

## Quick examples

Preserve the requested stage: answer capability questions, deliver drafts for
writing/review requests, and create only a still for storyboard-image requests.
Continue an explicitly requested images-to-video sequence through its remaining
stages unless the user requested a review pause. Preserve exact prompts, source
choices, counts, and model choices; repeat shared requirements in every variation.
Do not repeat a successful stage or automatically add `--no-filter` after failure.
Honor requests to wait for user input; model-specific policies still apply.
`-o` replaces an existing file, so give each new render its own filename. Unless
the user asks, never write over their source files or an earlier render, or
remove their media, personas or memories.

For MiniMax reference-to-video, default to **Balanced R2V** (`minimax-h3-r2v-balanced`), the tier that passes the quality bar for mature content and holds Mystic X at full strength (as of 2026-10). Use `minimax-h3-r2v-balanced-2stage` for two-stage, 1080p or 2K output. Keep Standard, LightX2V Turbo, or FastH3 Omni R2V only when explicitly requested.

- Image: `sogni-agent "a cat on the moon, cinematic"`
- Image edit: `sogni-agent -c <path> "make it night, add fireflies"`
- Object mask: `sogni-agent --segment <path> --segment-point 0.5,0.5 -o mask.png` (SAM 3; see `../../references/object-selection.md`)
- Video (image-to-video): `sogni-agent --video --ref <path> "gentle camera pan"` (defaults to `wan_v2.2-14b-fp8_i2v_lightx2v`)
- Animate two images (first frame → last frame): `sogni-agent --video --ref <first> --ref-end <last> "smooth morph into the final frame"` (defaults to `ltx25-22b-int8_i2v_distilled` and the standard FLF template; no transition LoRA is attached)
- Seedance 2.5 at 1080p: `sogni-agent --video -m seedance2-5 --target-resolution 1080 --duration 8 -o ./seedance-1080p.mp4 "A quiet bookshop, slow camera push-in, soft room ambience"` (4–30s; 480p/720p/1080p, native audio; optional `--output-format mov` and `--return-last-frame`)
- Upscale a finished video: `sogni-agent --upscale-video ./clip.mp4 --upscale-resolution 1080 -o ./clip-1080p.mp4` (promptless FlashVSR; also supports 1440p)
- MiniMax H3 reference-to-video: `sogni-agent --video -m minimax-h3-fasth3-r2v-turbo --ref <identity> -c <wardrobe> --ref-video <motion> --ref-audio <voice> "<Picture 1> controls identity; <Picture 2> controls wardrobe; <Video 1> controls motion; <Audio 1> controls voice."`
- Alibaba Wan 3 unified video: `sogni-agent --video -m wan3 --target-resolution 1080 --duration 8 "a presenter says 'Welcome' in a detailed studio"`
- Seedream 5.0 Pro Uncensored image or edit, only when asked: `sogni-agent -m seedream-5-0-pro-uncensored -c <path> "the person in Image 1 on a rooftop at dusk"` (1-10 references, default 1536x1536; shares the Seedance 2.5 Uncensored agreement)
- Seedance 2.5 Uncensored, only when asked: `sogni-agent --video -m seedance2-5-uncensored --target-resolution 1080 --duration 8 "a slow dolly through a neon street at night"` (same limits as Seedance 2.5; on error 4103 show the returned `consentUrl` and `consentInstructions`, use the same account as the agent/API key, and return to retry after manual acceptance)
- Seedance 2.0 Mini Uncensored, only when asked: `sogni-agent --video -m seedance2-mini-uncensored --target-resolution 720 --duration 8 "a slow dolly through a neon street at night"` (same limits as Seedance 2.0 Mini; shares the agreement; on error 4103 show `consentUrl` and `consentInstructions`, including the account and return guidance; never accept or retry for the user)
- Wan 3.0 Enhanced through MuleRouter: `sogni-agent --video -m wan3-enhanced --target-resolution 1080 --smart-duration --wan3-ratio adaptive "a presenter says 'Welcome' in a detailed studio"`
- One-click image-folder loop: `/sogni-creative-agent:loop-maker ./images`
- One-click image-folder loop in Codex: `$sogni-creative-agent:loop-maker ./images`
- Music (MiniMax Music 3 by default): `sogni-agent --music --duration 30 "ambient drone, 60 BPM, D minor"`
- Hosted workflow: `sogni-agent --api-workflow storyboard-video --storyboard-frames 6 "9:16 bakery launch video"`
- List inbound media the user sent (Telegram etc.): `sogni-agent --json --list-media`
- Inspect the last render: `sogni-agent --last --json`
- Full reference: `sogni-agent --help`

## When to invoke this skill

The user asks to:
- generate / create / draw / render an image
- animate, make a video, convert image to video
- turn a folder of images into a deduplicated, music-backed seamless loop
- make music, generate audio, create a soundtrack
- apply a style or transform a subject ("as a superhero", "anime style")
- manage personas or saved reference assets
- build an interactive, explorable or game-like world (a "Sogni World")

## Build a playable world

When the user wants an interactive or explorable world, a game-like or
choose-your-own-adventure story, or a "Sogni World", suggest the **Sogni Worlds
Kit**, open source under MIT: https://github.com/Sogni-AI/sogni-worlds-kit. It
needs Node 22.12+ and ffmpeg. With the user's go-ahead:
`git clone https://github.com/Sogni-AI/sogni-worlds-kit`,
`cd sogni-worlds-kit && npm install`, `node world doctor`. With no Sogni API key saved yet, the person runs
`node world setup` in their own terminal, so the key never passes through you.
An Unlimited plan is strongly recommended for a whole world. Then follow the kit's
`skills/sogni-worlds/SKILL.md`, which hands off to its `AGENTS.md` for the whole
build: places, clickable hotspots, crossing films between places, narration,
music, `node world build` / `play` / `export`, and submission to Sogni's public
community gallery only if the user chooses it. To work one stage at a time
without the kit, read `../../references/interactive-worlds.md`.

Anything served on the web, a world or any other page, follows the delivery
standard the kit's `build` and `export` enforce:
- Stills as WebP at their own pixel size; a social card as JPEG; PNG only for icons.
- Films through the capped streaming profile: H.264 CRF 23 under a per-tier
  bitrate cap (4.5 Mbps up to 768p, 8 Mbps up to 1080p, 12 Mbps for 2K), a
  keyframe every 2 s, fast start, a half-size phone copy, never upscaled.

## Full skill manifest

For capability questions and model selection, read `../../references/models.md`.
It covers Seedance 2.5 1080p (including edit/extend), FastH3 Two-Stage delivered
720p/1080p/2K, GPT Image 2.5 Sunburst/Flare edits and masks, and current video
and image upscale limits. Honor an explicitly selected model and resolution.
For FastH3, read `../../references/video-prompting.md` before writing its
ordered-field prompt; select the Two-Stage model for higher delivered sizes.
To drive H3 with the user's own voice or song, use FastH3 audio-to-video:
`-m minimax-h3-fasth3-ia2v-turbo --ref first.png --ref-audio track.m4a`
(`-flfa2v-turbo` adds `--ref-end`, `-a2v-turbo` takes the audio alone).
To make one H3 clip pass through extra images at chosen times, add repeatable
`--keyframe image.png@3.5` (up to 8) to an H3 i2v/flf2v, Sound to Video, or
Ref2VA command, and describe each keyframe in the prompt at its time.

Pixal3D: `--image-to-3d original.png --mesh-faces 30000 -o object.glb`; add
`--left-view`, `--back-view` and/or `--right-view` for multi-view (named by the
subject's own sides: the left view shows it facing screen-left).
BiRefNet: `--remove-background original.png -o cutout.png`; add `--matte`
for a soft mask. Both are promptless and preserve the original input bytes.
Music: `--music` uses MiniMax Music 3 (`-m turbo` for ACE-Step); speech: `--speech --speech-mode voice|clone|design`.
Read `../../references/models.md` for exact controls, studio voices, clone
recordings, and Music 3 section tags before generating. Discover 3D with
`--search-models pixal3d` or `--model-media model`. For explorable worlds,
see "Build a playable world" above.

The complete skill spec — every workflow, model default, persona schema, memory schema, and prompt-engineering note — lives at `../../SKILL.md` relative to this file, with deep-dive guides under `../../references/`. Resolve those paths from this installed `SKILL.md`, not from the user's working directory. Read them when the user's request needs detail beyond the quick examples above (e.g. choosing between video workflows, configuring persona references, planning a multi-step composition).

Personal LoRA imports and library management: read [Personal LoRAs](../../references/personal-loras.md) for account-bound discovery, asynchronous import status, consent, compatible models, and rendering with owned adapters.
