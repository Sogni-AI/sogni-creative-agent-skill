---
name: sogni-creative-agent
description: "Sogni Creative Agent: image, video, and music generation using Sogni AI's decentralized GPU network. Supports personas, persistent memories, custom personality, style transfer, angle synthesis, Seedance/HappyHorse/LTX/WAN video, music/lyrics, hosted chat, durable workflows, replay records, and multi-step creative workflows. Invoke when the user asks to \"draw\", \"generate\", \"create an image\", \"make a video\", \"animate\", \"make music\", \"apply a style\", or \"generate me as a superhero\"."
---

# Sogni Creative Agent

Generate **images, videos, and music** via Sogni AI's decentralized GPU network through the `sogni-agent` CLI shipped with this plugin.

## Setup

1. Install the CLI (one-time): `npm install -g @sogni-ai/sogni-creative-agent-skill@latest`.
2. Provide your Sogni API key (get one at https://dashboard.sogni.ai → account menu): either set `SOGNI_API_KEY` in the environment, or save it to `~/.config/sogni/credentials` as `SOGNI_API_KEY=<your-key>`.
3. Verify with `sogni-agent doctor --json` and confirm `"success": true` before reporting the install as working.
4. Optional config files honored: `~/.config/sogni/credentials`, `~/.config/sogni/last-render.json`.

Do not run the default `npx setup-sogni-agent-skill` from an installed plugin unless the user explicitly wants a separate personal skill registration in `~/.claude/skills/` or another host's personal skill directory; using both can create duplicate skills.

**Uninstall:** remove `sogni-creative-agent@sogni` with Claude Code's plugin manager. To also remove the global CLI and Sogni data, run `npx setup-sogni-agent-skill --uninstall --remove-cli --purge` after the plugin is removed; it backs up `~/.config/sogni/` to `~/.config/sogni.backup-<timestamp>.tar.gz` first. Tell the user the backup path; it holds their API key. Omit `--purge` to keep data. This cleanup command does not uninstall the Claude Code plugin itself.

## Quick examples

- Image: `sogni-agent "a cat on the moon, cinematic"`
- Image edit: `sogni-agent -c <path> "make it night, add fireflies"`
- Video (image-to-video): `sogni-agent --video --ref <path> "gentle camera pan"`
- One-click image-folder loop: `/sogni-creative-agent:loop-maker ./images`
- One-click image-folder loop in Codex: `$sogni-creative-agent:loop-maker ./images`
- Music: `sogni-agent --music "ambient drone, 30 seconds"`
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

## Full skill manifest

The complete skill spec — every workflow, model default, persona schema, memory schema, and prompt-engineering note — lives at `../../SKILL.md` relative to this file, with deep-dive guides under `../../references/`. Resolve those paths from this installed `SKILL.md`, not from the user's working directory. Read them when the user's request needs detail beyond the quick examples above (e.g. choosing between video workflows, configuring persona references, planning a multi-step composition).
