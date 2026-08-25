---
name: video_generation
description: Text-to-video synthesis with LTX-2.3, WAN 2.2, Alibaba Wan 3, Seedance, HappyHorse, and MiniMax H3.
always_loaded: false
tool_names:
  - generate_video
---

# Video generation

Text-to-video synthesis with LTX-2.3, WAN 2.2, Alibaba Wan 3, Seedance, HappyHorse, and MiniMax H3. Use when the user wants a new video clip generated from a prompt or a loose multimodal reference set.

## Tools

- `generate_video` — produce a video clip from text, Wan 3/Seedance/H3 multimodal references, or HappyHorse image references.

## Constraints

- Persona-driven video requests must always go through `image_editing` first to produce a conditioned image; never go straight to text-to-video for personas.
- For prompt-only variants with the same model, duration, dimensions, and references, use one Dynamic Prompt branch with `numberOfVariations`/`-n` instead of serial video calls.
- HappyHorse 1.1 is a Premium Spark vendor path: t2v is prompt-only, i2v uses one first-frame image, and r2v uses 1-9 image references. It accepts no reference audio or video.
- Wan 3 (`wan3.0-video`) is a Premium Spark unified vendor path: 2-30 s at fixed 30 fps with native audio and 480P/720P/1080P output. Use either first/last-frame anchors or a loose set capped at 10 images, 5 videos, 5 audios, and 20 files total; never combine the two reference modes.
- MiniMax H3 t2v uses `minimax-h3-t2v`; H3 r2v must be selected explicitly as `minimax-h3-r2v` and accepts up to 9 images, 3 videos, and 3 audio clips, capped at 12 files with at least one image. Address references with per-type `<Picture 1>` / `<Video 1>` / `<Audio 1>` tags and assign each one a role.
