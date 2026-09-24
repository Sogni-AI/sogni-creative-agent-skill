---
name: sogni-creative-agent-skill
description: "Generate and edit images, create Pixal3D 3D models, remove backgrounds with BiRefNet, synthesize Qwen3-TTS speech, upscale images, create video and music, animate image folders into seamless reels, and manage reusable personas with Sogni AI. Use when a Hermes user asks to draw, render, upscale, edit or restyle an image, animate an image, make a video, create music or lyrics, build a media workflow, apply a saved identity, or refine an earlier Sogni result."
license: MIT
metadata:
  version: "3.52.4"
  author: Sogni AI
  hermes:
    category: creative
    tags:
      - sogni
      - image-generation
      - image-editing
      - video-generation
      - music-generation
      - creative-media
---

# Sogni Creative Agent for Hermes

Generate images, video, and music through Sogni AI's decentralized GPU network.

For SAM 3 object masks, read [references/object-selection.md](references/object-selection.md).
Use `--segment` with an original still and normalized points or an object description.

Invoke `sogni-agent-hermes` for every command in this skill. Fall back to
`sogni-agent` only when the Hermes launcher is not on `PATH`. The two commands
have identical flags and output; the Hermes launcher adds host attribution.

## Set up the CLI

Only perform setup when the user asks to install or upgrade the skill, or when
a command fails because the CLI is missing.

1. Install the CLI:

   ```bash
   npm install -g @sogni-ai/sogni-creative-agent-skill@latest
   sogni-agent-hermes --version
   ```

2. Ask the user to get an API key from https://dashboard.sogni.ai by opening
   the account menu. Accept either `SOGNI_API_KEY` in the environment or the
   credentials file `~/.config/sogni/credentials` containing
   `SOGNI_API_KEY=<key>`. Never echo, log, commit, or embed the key in generated
   files.
3. Run `sogni-agent-hermes doctor --json` after installation or upgrade and
   confirm that `success` is `true`. Do not run `doctor` as a routine preflight;
   normal generation commands perform their own checks.

## Execute requests

- Save final media in the user's current working directory unless they request
  another destination. Never put final output in `/tmp`.
- Use paths the user supplied. If an agent host exposes inbound attachments,
  run `sogni-agent-hermes --json --list-media` instead of guessing filenames.
- Honor an explicitly requested model. Otherwise use the CLI defaults and
  consult [models.md](references/models.md) only when model selection matters.
- Answer capability questions without generating. Stop at text for a writing or
  review request and at a still for a storyboard-image request. Continue through
  a requested images-to-video sequence unless the user requested a review pause.
- Preserve exact prompts, source choices, counts, and the latest duration. Each
  variation needs all its own lettering, visual, dialogue, and loop requirements.
  Continue from successful stages instead of rendering them again.
- Plan multi-step work in Hermes, then invoke the focused CLI command. Use the
  hosted workflow API only when its durable orchestration or replay behavior is
  useful.
- Parse `--json` output when subsequent steps need exact job IDs, paths, URLs,
  costs, or error fields.
- Return the final local path and the important render settings. On failure,
  preserve the CLI's error and actionable recovery hint. Do not automatically
  add `--no-filter` or retry a rejection. Optional filter changes need the user's
  explicit choice and cannot override a model's policy. Honor hosted requests
  to wait for user input.

## Common commands

```bash
# Promptless 3D reconstruction and background removal
sogni-agent-hermes --image-to-3d ./object.png --mesh-faces 30000 -o ./object.glb
# Multi-view: front plus any of its own left side, back and right side
sogni-agent-hermes --image-to-3d ./front.png --left-view ./left.png --back-view ./back.png --right-view ./right.png -o ./object.glb
sogni-agent-hermes --remove-background ./source.png -o ./cutout.png

# MiniMax Music 3 and Qwen3-TTS (read models.md for lyrics and voice controls)
sogni-agent-hermes --music -m music3 --duration 30 -o ./score.mp3 "instrumental ambient score"
sogni-agent-hermes --speech --speech-voice ryan -o ./speech.wav "Welcome to the story."

# Generate or edit an image
sogni-agent-hermes -o ./image.png "cinematic moonlit mountain lake"
sogni-agent-hermes -c ./source.png -o ./edited.png "make it night; add fireflies"

# Promptless RTX VSR upscale
sogni-agent-hermes --upscale ./source.png -o ./upscaled.png

# Promptless FlashVSR video upscale to 1440p (or --upscale-resolution 1080)
sogni-agent-hermes --upscale-video ./clip.mp4 -o ./clip-1440p.mp4

# Generate or animate video
sogni-agent-hermes --video -o ./video.mp4 "a paper dragon takes flight"
sogni-agent-hermes --video --ref ./start.png -o ./animated.mp4 "slow camera push-in"
sogni-agent-hermes --video --ref ./first.png --ref-end ./last.png -o ./transition.mp4 "smooth transformation"
sogni-agent-hermes --video -m minimax-h3-fasth3-ia2v-turbo --ref ./first.png --ref-audio ./voice.m4a --duration 8 -o ./talking.mp4 "<I2V preamble plus three-field H3 prompt>"
sogni-agent-hermes --video -m seedance2-5 --target-resolution 1080 --duration 8 -o ./seedance-1080p.mp4 "A quiet bookshop, slow camera push-in, soft room ambience"
sogni-agent-hermes --video -m wan3 --target-resolution 1080 --duration 8 -o ./wan3.mp4 'a presenter says "Welcome" in a detailed studio'
sogni-agent-hermes --video -m wan3-enhanced --target-resolution 1080 --duration 8 --wan3-ratio 16:9 -o ./wan3-enhanced.mp4 'a presenter says "Welcome" in a detailed studio'

# Generate music
sogni-agent-hermes --music -o ./soundtrack.mp3 "30-second ambient synth theme"

# Inspect state and available media
sogni-agent-hermes --last --json
sogni-agent-hermes --json --list-media
sogni-agent-hermes --help
```

## Load detailed guidance only when needed

Seedance 2.5 supports 4–30s at 480p/720p/1080p, including edit/extend,
with optional `--output-format mov` and `--return-last-frame`. FastH3 Two-Stage
delivers 720p/1080p/2K through its own model selector. FastH3 audio-to-video
(`minimax-h3-fasth3-ia2v-turbo`, `-flfa2v-turbo`, `-a2v-turbo`) drives H3 with an
uploaded `--ref-audio` track and keeps it as the soundtrack. GPT Image 2.5 Sunburst
and Flare support edits, masks, and transparency. For capability questions or
model selection, read [models.md](references/models.md) for current controls
and limits; preserve the user's requested model and resolution.

Use `--image-to-3d` for Pixal3D (add `--left-view`, `--back-view` and/or
`--right-view` for multi-view; views are named by the subject's own sides, so
the left view shows the subject facing screen-left), `--remove-background` for BiRefNet (add
`--matte` for a soft mask), `--music -m music3` for MiniMax Music 3, and
`--speech --speech-mode voice|clone|design` for Qwen3-TTS. Read the model guide
before these modes for exact scripts, studio voices, 3–30s clone references,
and Music 3 section tags. Discover 3D with `--search-models pixal3d` or
`--model-media model`.

- Model choice, quality tiers, Krea identity edits, and video aliases: read
  [models.md](references/models.md).
- Krea 2 LoRA ids, strength ranges, bipolar sliders, and stacking up to 8 in
  one render: read [krea2-loras.md](references/krea2-loras.md).
- Video prompts, reference roles, LTX, WAN 2.2, Wan 3, MiniMax, Seedance, and HappyHorse:
  read [video-prompting.md](references/video-prompting.md).
- Prompt-only image deliverables for SD/SDXL, FLUX.1 Schnell, Chroma, Krea 2, Qwen,
  Z-Image, GPT Image, and model-specific editing: read
  [image-prompting.md](references/image-prompting.md).
- Local video cutting, stitching, overlays, subtitles, audio remixing, and
  verification: read [video-editing.md](references/video-editing.md).
- Saved identities, reusable assets, memory, and personality: read
  [personas-memory.md](references/personas-memory.md).
- Hosted chat, durable workflows, structured contracts, and replay records:
  read [hosted-api.md](references/hosted-api.md).
- Turning an image folder into a deduplicated, music-backed seamless reel:
  read [loop-maker.md](references/loop-maker.md) completely before starting.
- Explorable scenes, clickable objects, collectible 3D assets, and recurring
  voices: read [interactive-worlds.md](references/interactive-worlds.md).
- Seamless textures or tiles: read
  [seamless-tiling.md](references/seamless-tiling.md).
- Explicit private/adult video requests: read
  [private-mature-video.md](references/private-mature-video.md) and follow its
  eligibility and prompting rules.

Where a reference says `sogni-agent`, substitute `sogni-agent-hermes`.

Personal LoRA imports and library management: read [Personal LoRAs](./references/personal-loras.md) for account-bound discovery, asynchronous import status, consent, compatible models, and rendering with owned adapters.
