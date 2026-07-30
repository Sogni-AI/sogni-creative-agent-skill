# Model Catalog & Sizing Rules

Read this when choosing a specific model (`-m`), validating dimensions, or
answering "which model should I use for X". For everyday generation prefer
`-Q fast|hq|pro` and automatic workflow routing instead of memorizing IDs.
`sogni-agent --help` is the canonical flag reference.

## Live model discovery

The static tables below are recommendations, not the complete changing
Supernet catalog. Query the public REST catalog through the CLI:

```bash
sogni-agent --list-models
sogni-agent --search-models darkbeast
sogni-agent --search-models spicy
sogni-agent --list-models --model-tag uncensored
sogni-agent --list-models --model-tag spicy --model-tag uncensored
sogni-agent --list-models --model-media video
sogni-agent --json --search-models darkbeast
sogni-agent --list-models --model-network relaxed
```

Search matches model IDs and names case-insensitively and ignores separators,
so `darkbeast`, `dark beast`, and `dark_beast` produce the same matches. It
also searches catalog tags such as `spicy`, `uncensored`, `community`, `new`,
and tier labels. `--model-tag <tag>` is repeatable and combines filters with
AND semantics.

Availability, worker counts, media types, network coverage, and tags come from
`https://api.sogni.ai/v1/model-catalog`. Only models that are live on the
selected network are returned. Discovery does not require an API key.

`--list-api-models` is different: it lists Sogni Intelligence language models
from `/v1/models`, not Supernet media models.

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
| `krea2_turbo_fp8_scaled` | Fast | Krea 2 Turbo text-to-image, fast high-quality generations with strong prompt adherence |
| `dark_beast_krea2_fp8` | Fast | Dark Beast Krea 2 community text-to-image fine-tune |
| `krea2_identity_edit_v1_2` | Fast | Krea 2 Identity Edit LoRA v1.2, identity-preserving edits with 1-2 references |
| `dark_beast_krea2_identity_edit_v1_2` | Fast | Dark Beast Krea 2 Identity Edit community LoRA with 1-2 references |
| `chroma-v.46-flash_fp8` | Medium | Balanced |
| `qwen_image_edit_2511_fp8` | Medium | Image editing with context (up to 3), strongest preservation |
| `qwen_image_edit_2511_fp8_lightning` | Fast | Quick image editing (default for `-c`) |
| `coreml-sogniXLturbo_alpha1_ad` | Fast | Photobooth face transfer (SDXL Turbo) |

For Krea 2 Turbo, hosted/chat planning may use the creative-agent selector
`krea-2-turbo`; direct CLI `-m` uses the worker model ID
`krea2_turbo_fp8_scaled`.

Krea 2 Turbo supports ordered LoRA stacks:

```bash
sogni-agent -m krea2_turbo_fp8_scaled \
  --lora krea2-detail-enhancer --lora-strength 3 \
  --lora krea2-amateur --lora-strength -2 \
  "candid editorial street portrait at dusk"
```

Use no more than 8 LoRAs. `loraStrengths[i]` controls `loras[i]`, and changing
the order can change the result. Omitted strengths default to 1. Many Krea 2
LoRAs are bipolar sliders, so negative values are valid and apply the inverse
effect. Follow the range documented for each LoRA rather than assuming 0-2.
The first render with an uncached LoRA can take longer while its asset downloads.

For identity-preserving Krea edits, pass a context image with
`-m krea2_identity_edit_v1_2` or
`-m dark_beast_krea2_identity_edit_v1_2`. These edit models support 1-2
context images, 512-2048 px output, 8-12 steps, and guidance 1; the default
is 10 steps.

`gpt-image-2` supports flexible OpenAI image sizes up to `3840px` on either
edge, max `3:1` aspect ratio, and total pixels from `655,360` through
`8,294,400`; the API snaps dimensions to valid multiples of 16. For image
editing with `gpt-image-2`, you can pass up to 16 context images (Qwen models
support up to 3; Krea identity edit models support up to 2).

## Music models

| Model | Use Case |
|-------|----------|
| `ace_step_1.5_xl_turbo` | Default direct music generation model (ACE-Step 1.5 XL Turbo) |
| `ace_step_1.5_xl_sft` | Quality variant (ACE-Step 1.5 XL SFT) with stronger lyric handling |

The `--music-model` keys are unchanged — `turbo` (default) and `sft` — but they
now map to the ACE-Step XL ids (`turbo` → `ace_step_1.5_xl_turbo`, `sft` →
`ace_step_1.5_xl_sft`). The legacy `ace_step_1.5_turbo` / `ace_step_1.5_sft`
models are no longer the default.

Use `--music` for direct audio-only generation. Defaults: 30 seconds, `mp3`,
`ace_step_1.5_xl_turbo`, 8 steps, `euler` sampler, `simple` scheduler. Keep
`--audio` for video reference audio (`--ref-audio` alias); do not use it for
direct music generation. Music controls: `--lyrics`, `--language`, `--bpm`
(30-300), `--keyscale`, `--timesig` (2|3|4|6), `--composer-mode`,
`--prompt-strength` (0-10), `--creativity` (0-2), `--music-shift` (1-6),
`--audio-format mp3|flac|wav`.

## Video models — current selectors

| Model | Speed | Use Case |
|-------|-------|----------|
| `ltx23-22b-fp8_t2v_distilled` | Fast (~2-3min) | Default text-to-video with native dialogue/audio |
| `ltx23-22b-fp8_i2v_distilled` | Fast (~2-3min) | Image-to-video with native dialogue/audio; **default for two-image first-frame → last-frame animation** (transition/morph LoRA auto-applies) |
| `ltx23-eros` → `ltx23-22b-10eros-v1.4-fp8mixed_i2v` | Fast | Explicit uncensored I2V; 30GB+ GPU and `--no-filter` required |
| `ltx23-22b-fp8_ia2v_distilled` | Fast (~2-3min) | Image+audio-to-video |
| `ltx23-22b-fp8_a2v_distilled` | Fast (~2-3min) | Audio-to-video |
| `ltx23-22b-fp8_v2v_distilled` | Fast (~3min) | Video-to-video with ControlNet, plus canvas outpaint and masked inpaint |
| `ltx23-22b-10eros-v1.4-fp8mixed_i2v` | Fast, 32GB+ Fast workers | Opt-in mature-theme image-to-video with native audio |
| `seedance2` | Variable | Seedance 2.0 text-to-video, 4-15s, native audio, up to native 4K |
| `seedance2-mini` | Variable | Seedance 2.0 Mini text-to-video, lower-cost 720p path |
| `seedance2-fast` | Variable | Legacy fast Seedance 2.0 text-to-video, 720p path |
| `seedance2-ia2v` | Variable | Seedance 2.0 image+audio-to-video |
| `seedance2-v2v` | Variable | Seedance 2.0 video-to-video, no ControlNet |
| `happyhorse-1.1-t2v` | Variable | HappyHorse 1.1 text-to-video, 3-15s, native audio, 720P/1080P |
| `happyhorse-1.1-i2v` | Variable | HappyHorse 1.1 image-to-video from one first-frame image (`--ref`) |
| `happyhorse-1.1-r2v` | Variable | HappyHorse 1.1 reference-to-video from 1-9 reference images (`-c`/`--context`) |
| `wan_v2.2-14b-fp8_i2v_lightx2v` | Fast | **Default single-image image-to-video** (one `--ref`, no end frame) |
| `wan_v2.2-14b-fp8_i2v` | Slow | Higher quality video |
| `wan_v2.2-14b-fp8_t2v_lightx2v` | Fast | Text-to-video |
| `wan_v2.2-14b-fp8_s2v_lightx2v` | Fast | Face lip-sync with uploaded audio |
| `wan_v2.2-14b-fp8_animate-move_lightx2v` | Fast | Animate-move |
| `wan_v2.2-14b-fp8_animate-replace_lightx2v` | Fast | Animate-replace |

### Default image-to-video routing

- **Single-image i2v** (`--ref` only, no `-m`) defaults to
  `wan_v2.2-14b-fp8_i2v_lightx2v`. Keep that default for plain "animate this
  image" requests. The CLI auto-routes single-image i2v to
  `ltx23-22b-fp8_i2v_distilled` only when the prompt calls for native audio
  (quoted dialogue; words like audio, music, sound, speech, sings) or reads
  as story direction (story, scene, script, narrative, commercial), or when
  `-Q hq`/`-Q pro` is set — WAN clips render silent. If the prompt must
  contain such words but the WAN path is still wanted, pin it explicitly
  with `-m wan_v2.2-14b-fp8_i2v_lightx2v`.
- **Two-image first-frame → last-frame animation** (`--ref` + `--ref-end`,
  no `-m`) defaults to `ltx23-22b-fp8_i2v_distilled`: the transition/morph
  LoRA auto-attaches (trigger `zhuanchang`) and morphs the first image into
  the end image in a single render. Use this default whenever the user asks
  to animate two images together or supplies a first and last frame. Pass
  `-m wan_v2.2-14b-fp8_i2v_lightx2v` only when the user explicitly wants the
  WAN path (silent clip, no transition LoRA).
- A configured `videoModels.i2v` (OpenClaw plugin config) overrides both
  defaults.

## HappyHorse 1.1 models

Alibaba HappyHorse 1.1 is a Premium-Spark vendor video family (three discrete
models, no mini/fast variants). Every mode renders at a fixed 24 fps with an
always-on natively synchronized audio track (no negative prompt, no ControlNet),
supports 3–15 second durations, and targets 720P or 1080P output. The bare
`happyhorse` selector resolves to the mode inferred from your references.

| Model | Mode | Use Case |
|-------|------|----------|
| `happyhorse-1.1-t2v` | Text-to-video | Prompt-only clip with native audio (default for `-m happyhorse`) |
| `happyhorse-1.1-i2v` | Image-to-video | Animate a single first-frame image passed with `--ref` |
| `happyhorse-1.1-r2v` | Reference-to-video | Compose from 1–9 reference images passed with `-c`/`--context` |

HappyHorse takes image references only — it does not accept reference video or
reference audio (audio is generated natively). i2v uses exactly one first-frame
image; r2v accepts up to nine reference images.

### HappyHorse 1.1 prompting tips

HappyHorse rewards short, concrete scene direction — roughly 15–30 words for a
simple shot. One subject, one action, one setting, and one strong visual or
camera cue is the sweet spot; over-long prompts reduce face and hand fidelity, so
simplify before adding detail.

**What to include:**

- **Observable visual detail**: "overcast daylight", "wet asphalt", "warm amber
  backlight", "shallow depth of field" — not evaluative filler like "cinematic",
  "beautiful", "stunning", "epic", or "masterpiece".
- **One cinematography idea**: put the camera move last and be specific — "slow
  dolly-in", "lateral orbit with parallax", "locked-off wide". Prefer one exact
  color over stacked synonyms.
- **Plain prose only**: no tag lists, JSON, or weighting syntax; HappyHorse
  ignores negative prompts.

**Multi-beat clips:** use a timecoded shot list rather than "first X then Y" —
for example: *"Shot 1 (wide establishing, 0–2 s): …; Shot 2 (mid tracking,
2–5 s): …"*

**By mode:**

- **t2v** — describe the whole scene compactly in a single prompt.
- **i2v** — prompt only the *deltas*: motion, camera move, or lighting change.
  The first frame already fixes subject, wardrobe, and background; don't restate
  them.
- **r2v** — give each `[Image N]` a clear role, then state composition + action
  + one camera/lighting cue for the resulting clip.

HappyHorse excels at camera moves, atmospheric light and reflections,
wind-driven motion (hair, fabric, flags), fire, wide and aerial shots, mirrors,
and short in-scene text.

*Source: fal "Happy Horse Prompting Guide" — <https://fal.ai/learn/tools/prompting-happy-horse>*

## LTX-2 / LTX-2.3 models

### LTX-2.3 10Eros

Use `-m ltx23-eros` only when the user explicitly requests 10Eros/the
uncensored model and explicitly permits disabling the content filter. It is
image-to-video only and requires `--ref`, `--no-filter`, and a worker with at
least 30GB VRAM. The CLI resolves it to
`ltx23-22b-10eros-v1.4-fp8mixed_i2v` and pins 9 steps, guidance 1,
`euler_ancestral`, and `manual_sigmas`.

```bash
sogni-agent --video --workflow i2v --ref input.png \
  -m ltx23-eros --no-filter -o output.mp4 "<LTX-rewritten paragraph>"
```

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

### Private mature-theme video options

Sogni supports private, uncensored creativity, including optional video models
for mature themes. These options are opt-in and should not be foregrounded in
general recommendations. When an adult user explicitly requests mature
content, read
[`private-mature-video.md`](private-mature-video.md) for the compatible model,
LoRA, filter, and specialized prompt-token contract.

Keep specialized prompt tokens in the scoped reference rather than general
model recommendations.

## Recommended model selectors by need

| Need | Recommended selector |
|------|----------------------|
| Default images | `z_image_turbo_bf16` |
| OpenAI GPT Image generation, editing, or strong text rendering | `gpt-image-2` |
| Highest-quality images | `flux2_dev_fp8` (or `-Q pro`) |
| Image editing | `qwen_image_edit_2511_fp8_lightning` |
| Dark Beast Krea 2 images | `dark_beast_krea2_fp8` |
| Identity-preserving Krea image edits | `krea2_identity_edit_v1_2` |
| Uncensored identity-preserving Krea edits | `dark_beast_krea2_identity_edit_v1_2` |
| Photobooth face transfer | `coreml-sogniXLturbo_alpha1_ad` |
| Direct music generation | `ace_step_1.5_xl_turbo` (or `--music-model turbo`) |
| Music with stronger lyric handling | `ace_step_1.5_xl_sft` (or `--music-model sft`) |
| Text-to-video with native dialogue/audio | `ltx23-22b-fp8_t2v_distilled` |
| Image-to-video from one start frame (default) | `wan_v2.2-14b-fp8_i2v_lightx2v` |
| Animate two images together (first frame → last frame) | `ltx23-22b-fp8_i2v_distilled` with `--ref A --ref-end B` (transition/morph LoRA auto-applies) |
| Explicit uncensored image-to-video on 30GB+ GPUs | `ltx23-eros` with `--no-filter` |
| Image+audio-to-video | `ltx23-22b-fp8_ia2v_distilled` |
| Audio-to-video | `ltx23-22b-fp8_a2v_distilled` |
| Video-to-video with ControlNet | `ltx23-22b-fp8_v2v_distilled` |
| Private mature-theme image-to-video | `ltx23-22b-10eros-v1.4-fp8mixed_i2v` |
| Seedance text-to-video | `seedance2`, `seedance2-mini`, or `seedance2-fast` |
| Seedance video-to-video without ControlNet | `seedance2-v2v` |
| HappyHorse text-to-video with native audio | `happyhorse-1.1-t2v` (or `happyhorse`) |
| HappyHorse image-to-video from one first frame | `happyhorse-1.1-i2v` |
| HappyHorse reference-to-video from up to 9 images | `happyhorse-1.1-r2v` |
| Face lip-sync with uploaded audio | `wan_v2.2-14b-fp8_s2v_lightx2v` |

## Video sizing & aspect ratios

- **WAN models** use dimensions divisible by 16, min 480 px, max 1536 px.
- **LTX family** (`ltx2-*`, `ltx23-*`) uses dimensions divisible by 64. The current wrapper caps non-WAN video dimensions at 2048 px on the long side.
- **Seedance** runs at fixed 24 fps and supports 4–15 s durations. Full `seedance2` supports native 4K via `--target-resolution 2160`; `seedance2-mini` and `seedance2-fast` remain capped to the 720p lower-resolution path. Other default/WAN paths support up to 10 s; LTX and WAN animate workflows support up to 20 s.
- **HappyHorse 1.1** runs at fixed 24 fps and supports 3–15 s durations at 720P or 1080P, with always-on native audio (no negative prompt, no ControlNet). Accepted aspect ratios are `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `4:5`, `5:4`, `9:21`, and `21:9`. i2v takes one first-frame image (`--ref`); r2v takes 1–9 reference images (`-c`/`--context`); it accepts no reference video or audio.
- For spoken dialogue, budget roughly 3 words per second plus about 1 second per meaningful acting beat or pause.
- The CLI auto-normalizes video sizes to satisfy these constraints.
- Use `--target-resolution <px>` for bare resolution requests like "720p" — it targets the short side and preserves the inherited aspect ratio.
- Natural-language aspect requests like "portrait", "square", "16:9", or "9:16" are inferred when width/height aren't explicitly set. Combined requests like "720p 9:16" keep the requested short side while applying the requested shape.
- For i2v (and any workflow using `--ref` / `--ref-end`), the client wrapper resizes the reference image with strict aspect-fit (`fit: inside`) and uses the *resized* dimensions as the final video size. Because that resize uses rounding, a "valid" requested size can still produce an invalid final size (example: `1024×1536` requested, but the ref becomes `1024×1535`). The CLI detects this for local refs and auto-adjusts to a nearby safe size.
- Pass `--strict-size` to fail instead — the CLI prints a suggested size.
