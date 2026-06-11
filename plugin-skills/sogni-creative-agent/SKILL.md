---
name: sogni-creative-agent
description: "Sogni Creative Agent: image, video, and music generation using Sogni AI's decentralized GPU network. Supports personas, persistent memories, custom personality, style transfer, angle synthesis, Seedance/LTX/WAN video, music/lyrics, hosted chat, durable workflows, replay records, and multi-step creative workflows. Invoke when the user asks to \"draw\", \"generate\", \"create an image\", \"make a video\", \"animate\", \"make music\", \"apply a style\", or \"generate me as a superhero\"."
---

# Sogni Creative Agent

Generate **images, videos, and music** via Sogni AI's decentralized GPU network through the `sogni-agent` CLI shipped with this plugin.

## Setup

1. Install everything (one-time): `npx setup-sogni-agent-skill` — installs the CLI globally and prompts for your API key. (Manual alternative: `npm i -g @sogni-ai/sogni-creative-agent-skill`.)
2. Provide your Sogni API key (get one at https://dashboard.sogni.ai → account menu): either set `SOGNI_API_KEY` in the environment, or save it to `~/.config/sogni/credentials` as `SOGNI_API_KEY=<your-key>`.
3. Verify with `sogni-agent doctor --json` and confirm `"success": true` before reporting the install as working.
4. Optional config files honored: `~/.config/sogni/credentials`, `~/.config/sogni/last-render.json`.

**Uninstall:** run `npx setup-sogni-agent-skill --uninstall --remove-cli --purge` — removes the skill, CLI, and `~/.config/sogni/` data after backing it up to `~/.config/sogni.backup-<timestamp>.tar.gz`. Tell the user the backup path; it holds their API key. Omit `--purge` to keep data.

## Quick examples

- Image: `sogni-agent "a cat on the moon, cinematic"`
- Image edit: `sogni-agent -c <path> "make it night, add fireflies"`
- Video (image-to-video): `sogni-agent --video --ref <path> "gentle camera pan"`
- Music: `sogni-agent --music "ambient drone, 30 seconds"`
- Hosted workflow: `sogni-agent --api-workflow storyboard-video --storyboard-frames 6 "9:16 bakery launch video"`
- List inbound media the user sent (Telegram etc.): `sogni-agent --json --list-media`
- Inspect the last render: `sogni-agent --last --json`
- Full reference: `sogni-agent --help`

## When to invoke this skill

The user asks to:
- generate / create / draw / render an image
- animate, make a video, convert image to video
- make music, generate audio, create a soundtrack
- apply a style or transform a subject ("as a superhero", "anime style")
- manage personas or saved reference assets

## Full skill manifest

The complete skill spec — every workflow, model default, persona schema, memory schema, and prompt-engineering note — lives at `${CLAUDE_PLUGIN_ROOT}/SKILL.md` (the root of this plugin), with deep-dive guides under `${CLAUDE_PLUGIN_ROOT}/references/`. Read them when the user's request needs detail beyond the quick examples above (e.g. choosing between video workflows, configuring persona references, planning a multi-step composition).
