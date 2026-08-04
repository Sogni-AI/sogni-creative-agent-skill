---
name: video_editing
description: Source-conditioned video flows: animate a photo, audio-driven motion, video style transfer, Seedance/HappyHorse/MiniMax H3 references, stitching, orbits, dance-montage compositions, segment extend/replace, and pure-ffmpeg post-production (overlay, subtitles).
always_loaded: false
tool_names:
  - animate_photo
  - sound_to_video
  - video_to_video
  - stitch_video
  - orbit_video
  - dance_montage
  - extend_video
  - replace_video_segment
  - overlay_video
  - add_subtitles
---

# Video editing

Convert a still image, audio track, or existing clip into video, plus Seedance and MiniMax H3 multimodal references, HappyHorse image references, stitching, orbits, dance-montage compositions, segment extend/replace, and pure-ffmpeg post-production (overlay, subtitles) over previously rendered or uploaded clips.

## Tools

- `animate_photo` — photo-to-video animation with LTX/WAN/Seedance/HappyHorse/MiniMax H3 i2v and first/last-frame routing.
- `sound_to_video` — audio-synced video generation.
- `video_to_video` — video style transfer with ControlNet.
- `stitch_video` — concatenate previously rendered clips.
- `orbit_video` — 360° orbit composition with optional dialogue.
- `dance_montage` — beat-synced dance-style composition over uploaded photos.
- `extend_video` — append new tail content to an existing video without rewriting the rest.
- `replace_video_segment` — swap a bounded time window inside a video while preserving the unchanged portion and original audio outside the replaced window.
- `overlay_video` — burn-in a static text/logo overlay onto an existing video via ffmpeg.
- `add_subtitles` — burn-in subtitle cues onto an existing video via ffmpeg.

## Constraints

- Per-clip retry and the batch progress contract are sacred — never collapse a multi-clip render down to a single waterfall call.
- `animate_photo` errors with `all_failed` must surface to the user; do not auto-retry from inside the chat loop.
- For multiple prompt-only takes from one fixed source/end image and shared settings, prefer one Dynamic Prompt request with `numberOfVariations`/`-n`, then stitch the returned clips if the user asked for a single final video.
- Keep per-clip prompt arrays and source/end image arrays when clips need different assets, durations, audio windows, or other per-output settings.
- HappyHorse i2v uses exactly one first-frame image and r2v uses 1-9 image references; do not attach reference audio, reference video, ControlNet, or negative prompts.
- MiniMax H3 i2v uses one first frame and H3 flf2v uses both first and last frames. For a loose image/video/audio set use `generate_video` with explicit `minimax-h3-r2v`; r2v references are roles, not frame anchors.
