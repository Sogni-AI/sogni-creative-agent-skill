---
name: sogni-creative-agent-skill
description: "Generate and edit images, upscale images, create video and music, animate image folders into seamless reels, and manage reusable personas with Sogni AI. Use when a Hermes user asks to draw, render, upscale, edit or restyle an image, animate an image, make a video, create music or lyrics, build a media workflow, apply a saved identity, or refine an earlier Sogni result."
license: MIT
metadata:
  version: "3.32.0"
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
- Plan multi-step work in Hermes, then invoke the focused CLI command. Use the
  hosted workflow API only when its durable orchestration or replay behavior is
  useful.
- Parse `--json` output when subsequent steps need exact job IDs, paths, URLs,
  costs, or error fields.
- Return the final local path and the important render settings. On failure,
  preserve the CLI's error and actionable recovery hint.

## Common commands

```bash
# Generate or edit an image
sogni-agent-hermes -o ./image.png "cinematic moonlit mountain lake"
sogni-agent-hermes -c ./source.png -o ./edited.png "make it night; add fireflies"

# Promptless RTX VSR upscale
sogni-agent-hermes --upscale ./source.png -o ./upscaled.png

# Generate or animate video
sogni-agent-hermes --video -o ./video.mp4 "a paper dragon takes flight"
sogni-agent-hermes --video --ref ./start.png -o ./animated.mp4 "slow camera push-in"
sogni-agent-hermes --video --ref ./first.png --ref-end ./last.png -o ./transition.mp4 "smooth transformation"

# Generate music
sogni-agent-hermes --music -o ./soundtrack.mp3 "30-second ambient synth theme"

# Inspect state and available media
sogni-agent-hermes --last --json
sogni-agent-hermes --json --list-media
sogni-agent-hermes --help
```

## Load detailed guidance only when needed

- Model choice, quality tiers, Krea identity edits, and video aliases: read
  [models.md](references/models.md).
- Krea 2 LoRA ids, strength ranges, bipolar sliders, and stacking up to 8 in
  one render: read [krea2-loras.md](references/krea2-loras.md).
- Video prompts, reference roles, LTX, WAN, MiniMax, Seedance, and HappyHorse:
  read [video-prompting.md](references/video-prompting.md).
- Local video cutting, stitching, overlays, subtitles, audio remixing, and
  verification: read [video-editing.md](references/video-editing.md).
- Saved identities, reusable assets, memory, and personality: read
  [personas-memory.md](references/personas-memory.md).
- Hosted chat, durable workflows, structured contracts, and replay records:
  read [hosted-api.md](references/hosted-api.md).
- Turning an image folder into a deduplicated, music-backed seamless reel:
  read [loop-maker.md](references/loop-maker.md) completely before starting.
- Seamless textures or tiles: read
  [seamless-tiling.md](references/seamless-tiling.md).
- Explicit private/adult video requests: read
  [private-mature-video.md](references/private-mature-video.md) and follow its
  eligibility and prompting rules.

Where a reference says `sogni-agent`, substitute `sogni-agent-hermes`.
