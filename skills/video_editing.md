---
name: video_editing
description: Source-conditioned video flows: animate a photo, audio-driven motion, video style transfer, promptless FlashVSR video upscaling, Seedance/HappyHorse/MiniMax H3 references, stitching, orbits, dance-montage compositions, segment extend/replace, and pure-ffmpeg post-production (overlay, subtitles).
always_loaded: false
tool_names:
  - animate_photo
  - sound_to_video
  - video_to_video
  - upscale_video
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
- `upscale_video` — promptless FlashVSR upscale of one uploaded or generated video to 1080p or 1440p, keeping every frame, the frame rate, the aspect ratio, and the audio.
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
- Use `upscale_video` when the user only wants a sharper, higher-resolution copy of an existing video. Pick the source with `sourceVideoIndex` (generated results are 0-based; -1 is the first upload) and optionally `targetResolution` 1080 or 1440 (default 1440, or 1080 for sources under 720p). It cannot produce 4K. Sources must be ≤768px on the short edge, ≤362 frames (~15 s), 1-60 fps, and ≤100 MB. Never invent a prompt or substitute `video_to_video`/`generate_video` unless the user names a generative model such as Seedance for a re-render.
- For multiple prompt-only takes from one fixed source/end image and shared settings, prefer one Dynamic Prompt request with `numberOfVariations`/`-n`, then stitch the returned clips if the user asked for a single final video.
- Keep per-clip prompt arrays and source/end image arrays when clips need different assets, durations, audio windows, or other per-output settings.
- HappyHorse i2v uses exactly one first-frame image and r2v uses 1-9 image references; do not attach reference audio, reference video, ControlNet, or negative prompts.
- MiniMax H3 i2v uses one first frame and H3 flf2v uses both first and last frames. For a loose image/video/audio set use `generate_video` with explicit `minimax-h3-r2v`; r2v references are roles, not frame anchors.
