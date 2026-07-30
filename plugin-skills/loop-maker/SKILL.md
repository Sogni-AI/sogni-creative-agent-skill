---
name: loop-maker
description: Turn a folder of images into a polished, music-backed seamless loop using visually deduplicated source frames and direct LTX first-frame/last-frame transitions. Invoke as /sogni-creative-agent:loop-maker IMAGE_FOLDER in Claude Code or $sogni-creative-agent:loop-maker in Codex, with optional start, music, output, pacing, or aspect preferences. Use when the user asks for a one-click image-folder reel, animated photo loop, looping montage, or slideshow where every image animates briefly before morphing into the next. Do not route true 360 novel-view synthesis here.
---

# Sogni Loop Maker

Create the image-folder loop described in the user's current request. Treat text after the explicit skill invocation as its arguments when the host provides them.

When running this Claude Code plugin, invoke `sogni-agent-claude-code` wherever
the root skill or loop workflow says `sogni-agent`.

1. Resolve the plugin root as two directories above this `SKILL.md`. Read the root `SKILL.md` completely. A host-provided plugin-root variable may be used, but do not depend on one.
2. Read `references/loop-maker.md` under that plugin root completely and follow it as the canonical workflow.
3. Treat the first folder path in the arguments as the source. Treat remaining text as optional preferences such as the opening image, music direction, output name, pacing, aspect ratio, compositor effects, or cleanup request.
4. If no folder is supplied, use the current directory only when it contains at least two supported source images; otherwise ask for the folder path.
5. Execute through final verification. Ask no stylistic questions when the defaults in the workflow are safe.

Preserve original source images. Use Sogni for all generated video and music, and use the CLI's safe media wrappers for extraction, concatenation, audio remixing, and verification. Do not use HyperFrames or Remotion unless the user explicitly requests text, overlays, or compositor effects that need one of them.
