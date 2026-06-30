---
name: video_generation
description: Text-to-video synthesis with LTX-2.3, WAN 2.2, Seedance 2.0, and HappyHorse 1.1.
always_loaded: false
tool_names:
  - generate_video
---

# Video generation

Text-to-video synthesis with LTX-2.3, WAN 2.2, Seedance 2.0, and HappyHorse 1.1. Use when the user wants a new video clip generated from a prompt with no source image, audio, or clip.

## Tools

- `generate_video` — produce a video clip from text, Seedance multimodal references, or HappyHorse image references.

## Constraints

- Persona-driven video requests must always go through `image_editing` first to produce a conditioned image; never go straight to text-to-video for personas.
- For prompt-only variants with the same model, duration, dimensions, and references, use one Dynamic Prompt branch with `numberOfVariations`/`-n` instead of serial video calls.
- HappyHorse 1.1 is a Premium Spark vendor path: t2v is prompt-only, i2v uses one first-frame image, and r2v uses 1-9 image references. It accepts no reference audio or video.
