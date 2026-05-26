---
name: video_generation
description: Text-to-video synthesis with LTX-2.3, WAN 2.2, and Seedance 2.0.
always_loaded: false
tool_names:
  - generate_video
---

# Video generation

Text-to-video synthesis with LTX-2.3, WAN 2.2, and Seedance 2.0. Use when the user wants a new video clip generated from a prompt with no source image, audio, or clip.

## Tools

- `generate_video` — produce a video clip from text or Seedance multimodal references.

## Constraints

- Persona-driven video requests must always go through `image_editing` first to produce a conditioned image; never go straight to text-to-video for personas.
- For prompt-only variants with the same model, duration, dimensions, and references, use one Dynamic Prompt branch with `numberOfVariations`/`-n` instead of serial video calls.
