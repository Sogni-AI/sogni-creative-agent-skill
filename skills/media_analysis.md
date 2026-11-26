---
name: media_analysis
description: Vision analysis of uploaded images / videos, speech-to-text transcription of audio / video clips, and structured metadata extraction from previously rendered results.
always_loaded: false
tool_names:
  - analyze_image
  - analyze_video
  - transcribe_audio
  - extract_metadata
---

# Media analysis

Vision, speech transcription, and metadata inspection of images, audio, and videos. The model uses these to ground later creative decisions on what is actually in the uploaded asset rather than guessing.

## Tools

- `analyze_image` — vision analysis of an uploaded or generated image.
- `analyze_video` — vision analysis of a video clip.
- `transcribe_audio` — speech-to-text transcription of an audio or video clip using `parakeet` (default fast 25-language STT up to 2 hours) or `nemotron` (40-language STT up to 1 hour with `diarize` speaker labels `S01`, `S02`, ... and `hotwords` / `prompt` vocabulary hints), with `responseFormat=json/text/srt/vtt`.
- `extract_metadata` — structured extraction of generation metadata (model, prompt, params) from previously rendered results.
