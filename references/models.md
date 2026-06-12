# Model Catalog & Sizing Rules

Read this when choosing a specific model (`-m`), validating dimensions, or
answering "which model should I use for X". For everyday generation prefer
`-Q fast|hq|pro` and automatic workflow routing instead of memorizing IDs.
`sogni-agent --help` is the canonical flag reference.

## Quality presets (images)

| Preset | Model | Steps | Size | Speed |
|--------|-------|-------|------|-------|
| `fast` | `z_image_turbo_bf16` | 8 | 512x512 | ~5-10s |
| `hq` | `z_image_turbo_bf16` | default | 768x768 | ~10-15s |
| `pro` | `flux2_dev_fp8` | 40 | 1024x1024 | ~2min |

Explicit `-m` overrides the preset's model. Explicit `-w`/`-h` overrides
dimensions. "high quality" / "best quality" / "pro" → `-Q pro`; quick drafts →
`-Q fast`.

## Image models

| Model | Speed | Use Case |
|-------|-------|----------|
| `z_image_turbo_bf16` | Fast (~5-10s) | General purpose, default |
| `gpt-image-2` | Variable | OpenAI GPT Image 2 text-to-image and edit, strong prompt and text rendering |
| `flux1-schnell-fp8` | Very fast | Quick iterations |
| `flux2_dev_fp8` | Slow (~2min) | High quality |
| `chroma-v.46-flash_fp8` | Medium | Balanced |
| `qwen_image_edit_2511_fp8` | Medium | Image editing with context (up to 3), strongest preservation |
| `qwen_image_edit_2511_fp8_lightning` | Fast | Quick image editing (default for `-c`) |
| `coreml-sogniXLturbo_alpha1_ad` | Fast | Photobooth face transfer (SDXL Turbo) |

`gpt-image-2` supports flexible OpenAI image sizes up to `3840px` on either
edge, max `3:1` aspect ratio, and total pixels from `655,360` through
`8,294,400`; the API snaps dimensions to valid multiples of 16. For image
editing with `gpt-image-2`, you can pass up to 16 context images (Qwen models
support up to 3).

## Music models

| Model | Use Case |
|-------|----------|
| `ace_step_1.5_turbo` | Default direct music generation model |
| `ace_step_1.5_sft` | Experimental option with stronger lyric handling |

Use `--music` for direct audio-only generation. Defaults: 30 seconds, `mp3`,
`ace_step_1.5_turbo`, 8 steps, `euler` sampler, `simple` scheduler. Keep
`--audio` for video reference audio (`--ref-audio` alias); do not use it for
direct music generation. Music controls: `--lyrics`, `--language`, `--bpm`
(30-300), `--keyscale`, `--timesig` (2|3|4|6), `--composer-mode`,
`--prompt-strength` (0-10), `--creativity` (0-2), `--music-shift` (1-6),
`--audio-format mp3|flac|wav`.

## Video models — current selectors

| Model | Speed | Use Case |
|-------|-------|----------|
| `ltx23-22b-fp8_t2v_distilled` | Fast (~2-3min) | Default text-to-video with native dialogue/audio |
| `ltx23-22b-fp8_i2v_distilled` | Fast (~2-3min) | Image-to-video with native dialogue/audio |
| `ltx23-22b-fp8_ia2v_distilled` | Fast (~2-3min) | Image+audio-to-video |
| `ltx23-22b-fp8_a2v_distilled` | Fast (~2-3min) | Audio-to-video |
| `ltx23-22b-fp8_v2v_distilled` | Fast (~3min) | Video-to-video with ControlNet |
| `seedance2` | Variable | Seedance 2.0 text-to-video, 4-15s, native audio |
| `seedance2-fast` | Variable | Fast Seedance 2.0 text-to-video |
| `seedance2-ia2v` | Variable | Seedance 2.0 image+audio-to-video |
| `seedance2-v2v` | Variable | Seedance 2.0 video-to-video, no ControlNet |
| `wan_v2.2-14b-fp8_i2v_lightx2v` | Fast | Simple image-to-video |
| `wan_v2.2-14b-fp8_i2v` | Slow | Higher quality video |
| `wan_v2.2-14b-fp8_t2v_lightx2v` | Fast | Text-to-video |
| `wan_v2.2-14b-fp8_s2v_lightx2v` | Fast | Face lip-sync with uploaded audio |
| `wan_v2.2-14b-fp8_animate-move_lightx2v` | Fast | Animate-move |
| `wan_v2.2-14b-fp8_animate-replace_lightx2v` | Fast | Animate-replace |

## LTX-2 / LTX-2.3 models

| Model | Speed | Use Case |
|-------|-------|----------|
| `ltx2-19b-fp8_t2v_distilled` | Fast (~2-3min) | Text-to-video, 8-step |
| `ltx2-19b-fp8_t2v` | Medium (~5min) | Text-to-video, 20-step quality |
| `ltx2-19b-fp8_i2v_distilled` | Fast (~2-3min) | Image-to-video, 8-step |
| `ltx2-19b-fp8_i2v` | Medium (~5min) | Image-to-video, 20-step quality |
| `ltx2-19b-fp8_ia2v_distilled` | Fast (~2-3min) | Image+audio-to-video |
| `ltx2-19b-fp8_a2v_distilled` | Fast (~2-3min) | Audio-to-video |
| `ltx2-19b-fp8_v2v_distilled` | Fast (~3min) | Video-to-video with ControlNet |
| `ltx2-19b-fp8_v2v` | Medium (~5min) | Video-to-video with ControlNet, quality |

## Recommended model selectors by need

| Need | Recommended selector |
|------|----------------------|
| Default images | `z_image_turbo_bf16` |
| OpenAI GPT Image generation, editing, or strong text rendering | `gpt-image-2` |
| Highest-quality images | `flux2_dev_fp8` (or `-Q pro`) |
| Image editing | `qwen_image_edit_2511_fp8_lightning` |
| Photobooth face transfer | `coreml-sogniXLturbo_alpha1_ad` |
| Direct music generation | `ace_step_1.5_turbo` (or `--music-model turbo`) |
| Music with stronger lyric handling | `ace_step_1.5_sft` (or `--music-model sft`) |
| Text-to-video with native dialogue/audio | `ltx23-22b-fp8_t2v_distilled` |
| Image+audio-to-video | `ltx23-22b-fp8_ia2v_distilled` |
| Audio-to-video | `ltx23-22b-fp8_a2v_distilled` |
| Video-to-video with ControlNet | `ltx23-22b-fp8_v2v_distilled` |
| Seedance text-to-video | `seedance2` or `seedance2-fast` |
| Seedance video-to-video without ControlNet | `seedance2-v2v` |
| Face lip-sync with uploaded audio | `wan_v2.2-14b-fp8_s2v_lightx2v` |

## Video sizing & aspect ratios

- **WAN models** use dimensions divisible by 16, min 480 px, max 1536 px.
- **LTX family** (`ltx2-*`, `ltx23-*`) uses dimensions divisible by 64. The current wrapper caps non-WAN video dimensions at 2048 px on the long side.
- **Seedance** runs at fixed 24 fps and supports 4–15 s durations. Other default/WAN paths support up to 10 s; LTX and WAN animate workflows support up to 20 s.
- For spoken dialogue, budget roughly 3 words per second plus about 1 second per meaningful acting beat or pause.
- The CLI auto-normalizes video sizes to satisfy these constraints.
- Use `--target-resolution <px>` for bare resolution requests like "720p" — it targets the short side and preserves the inherited aspect ratio.
- Natural-language aspect requests like "portrait", "square", "16:9", or "9:16" are inferred when width/height aren't explicitly set. Combined requests like "720p 9:16" keep the requested short side while applying the requested shape.
- For i2v (and any workflow using `--ref` / `--ref-end`), the client wrapper resizes the reference image with strict aspect-fit (`fit: inside`) and uses the *resized* dimensions as the final video size. Because that resize uses rounding, a "valid" requested size can still produce an invalid final size (example: `1024×1536` requested, but the ref becomes `1024×1535`). The CLI detects this for local refs and auto-adjusts to a nearby safe size.
- Pass `--strict-size` to fail instead — the CLI prints a suggested size.
