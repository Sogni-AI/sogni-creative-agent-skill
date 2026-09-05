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
| `pro` | `qwen_image_2512_fp8` | 20 | 1024x1024 | ~30sec |

Explicit `-m` overrides the preset's model. Explicit `-w`/`-h` overrides
dimensions. "high quality" / "best quality" / "pro" → `-Q pro`; quick drafts →
`-Q fast`.

## Image models

| Model | Speed | Use Case |
|-------|-------|----------|
| `z_image_turbo_bf16` | Fast (~5-10s) | General purpose, default |
| `gpt-image-2` | Variable | OpenAI GPT Image 2 text-to-image and edit, strong prompt and text rendering |
| `flux1-schnell-fp8` | Very fast | Quick iterations |
| `qwen_image_2512_fp8` | Medium (~30s) | High quality |
| `krea2_turbo_fp8_scaled` | Fast | Krea 2 Turbo text-to-image, fast high-quality generations with strong prompt adherence |
| `dark_beast_krea2_fp8` | Fast | Dark Beast Krea 2 community text-to-image fine-tune |
| `krea2_identity_edit_v1_2` | Fast | Krea 2 Identity Edit LoRA v1.2, identity-preserving edits with 1-2 references |
| `dark_beast_krea2_identity_edit_v1_2` | Fast | Dark Beast Krea 2 Identity Edit community LoRA with 1-2 references |
| `chroma-v.46-flash_fp8` | Medium | Balanced |
| `qwen_image_edit_2511_fp8` | Medium | Image editing with context (up to 3), strongest preservation |
| `qwen_image_edit_2511_fp8_lightning` | Fast | Quick image editing (default for `-c`) |
| `coreml-sogniXLturbo_alpha1_ad` | Fast | Photobooth face transfer (SDXL Turbo) |
| `rtx_vsr_pro` | Fast | Promptless, deterministic NVIDIA RTX VSR upscale from one starting image; 512-15360 target box, 8px step |

RTX VSR is not a text-to-image or restoration model. Invoke it with
`sogni-agent --upscale <path|url>` (optionally `--upscale-scale 2|3|4` or
`--target-longest-edge <px>`), or use the hosted `upscale_image` tool. The
source is sent through `startingImage`, the prompt stays empty, and the worker
fits the result inside the requested box without cropping or stretching. Both
8px-aligned output edges must be 512-15360px. Use 7680 for 8K or 15360 for
16K; targets above 7680px return JPG. If a scale leaves the short edge below
512px, use the minimum target longest edge reported by the CLI/tool.

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

All 25 published Krea 2 LoRAs apply to every Krea 2 based model —
`krea2_turbo_fp8_scaled`, `krea2_identity_edit_v1_2`,
`krea2_identity_edit_sogni_v0_3_alpha`, `dark_beast_krea2_fp8`, and
`dark_beast_krea2_identity_edit_v1_2`. [`krea2-loras.md`](./krea2-loras.md) lists
every ID with its range, recommended range, default, and slider direction. The
catalog moves without a skill release, so read it live before relying on an
exact range:

```bash
sogni-agent --list-loras --lora-catalog-model krea2_turbo_fp8_scaled
sogni-agent --search-loras lighting
```

For an edit of a referenced person or character that must preserve likeness or
character identity while changing clothing, hair or makeup, pose or position,
face/head/body, background, lighting, or visual style, default to a context
edit with `-m krea2_identity_edit_v1_2`. Infer that semantic intent in any
language; never route from keyword or regex matching. Also use it for a
single-character sheet unless Pro/detail-critical layout requirements favor
GPT Image 2. An explicitly requested model always wins. Use
`-m dark_beast_krea2_identity_edit_v1_2` only when the creator explicitly
requests that community/uncensored variant.

These models accept 1-2 context images at 512-2048 px. With two references,
pass the base scene first and the person/detail/outfit/pose/style reference
second. Use a concise 1-4 sentence delta instruction rather than restating the
whole image, do not send a negative prompt, and leave steps, guidance, sampler,
and scheduler unset so the current model tier and worker choose their optimized
defaults.

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
| `ltx25` → `ltx25-22b-int8_t2v_distilled` | Distilled | Default text-to-video with native synchronized audio |
| `ltx25-i2v` → `ltx25-22b-int8_i2v_distilled` | Distilled | Image-to-video; also first/last-frame conditioning through the separate FLF template |
| `ltx25-ia2v` → `ltx25-22b-int8_ia2v_distilled` | Distilled | Image+audio-to-video |
| `ltx25-a2v` → `ltx25-22b-int8_a2v_distilled` | Distilled | Audio-to-video |
| `ltx25-v2v` → `ltx25-22b-int8_v2v_distilled` | Distilled | Video-to-video canny, depth, pose, detailer, inpaint, and outpaint templates; pose requires both source video and subject reference image |
| `ltx25-22b-int8_{t2v,i2v,ia2v,a2v,v2v}_dev` | Dev/HQ | Official two-stage Dev workflow for the matching mode |
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
| `seedance2-5` | Variable | Seedance 2.5 text-to-video (alias `seedance2-5-t2v`), 4-30s single clips, native audio, 480p/720p only |
| `seedance2-5-ia2v` | Variable | Seedance 2.5 image+audio-to-video |
| `seedance2-5-v2v` | Variable | Seedance 2.5 video-to-video and video editing/extension, no ControlNet |
| `happyhorse-1.1-t2v` | Variable | HappyHorse 1.1 text-to-video, 3-15s, native audio, 720P/1080P |
| `happyhorse-1.1-i2v` | Variable | HappyHorse 1.1 image-to-video from one first-frame image (`--ref`) |
| `happyhorse-1.1-r2v` | Variable | HappyHorse 1.1 reference-to-video from 1-9 reference images (`-c`/`--context`) |
| `wan3` / `wan3.0-video` | Variable | Alibaba Wan 3 unified text/frame/reference/audio/video generation, 2-30s, native audio, 480P/720P/1080P |
| `wan3-enhanced` / `wan3.0-spicy-video` | Variable | MuleRouter `w3.0-video`: Wan 3.0 Enhanced text/frame/reference/audio/video generation, fixed or smart 2-30s, native audio, 480P/720P/1080P |
| `minimax-h3` / `minimax-h3-t2v` | Standard | MiniMax H3 text-to-video at 24 fps with native stereo audio |
| `minimax-h3-i2v` | Standard | MiniMax H3 first-frame image-to-video with native stereo audio |
| `minimax-h3-flf2v` | Standard | MiniMax H3 first-frame → last-frame video; pass both `--ref` and `--ref-end` |
| `minimax-h3-r2v` | Standard | MiniMax H3 reference-to-video from a whole reference set (up to 9 images / 3 videos / 3 audio, 12 files total) |
| `minimax-h3-balanced` / `minimax-h3-t2v-balanced` | 8-step | H3 Balanced text-to-video; the generic selector also infers i2v/flf2v from supplied frames |
| `minimax-h3-i2v-balanced` | 8-step | H3 Balanced first-frame image-to-video |
| `minimax-h3-flf2v-balanced` | 8-step | H3 Balanced first-frame → last-frame video; pass both `--ref` and `--ref-end` |
| `minimax-h3-r2v-balanced` | 8-step | H3 Balanced reference-to-video from a whole reference set |
| `minimax-h3-turbo` / `minimax-h3-t2v-turbo` | 4-step | H3 LightX2V Turbo text-to-video; the generic selector also infers i2v/flf2v from supplied frames |
| `minimax-h3-i2v-turbo` | 4-step | H3 LightX2V Turbo first-frame image-to-video |
| `minimax-h3-flf2v-turbo` | 4-step | H3 LightX2V Turbo first-frame → last-frame video; pass both `--ref` and `--ref-end` |
| `minimax-h3-r2v-turbo` | 4-step | H3 Turbo reference-to-video from a whole reference set; 960×544 default |
| `minimax-h3-fasth3-turbo` / `minimax-h3-fasth3-t2v-turbo` | 4-step | FastVideo VSA FastH3 text-to-video; generic selector infers frame modes; about 2x faster than LightX2V Turbo and up to 6x Standard |
| `minimax-h3-fasth3-i2v-turbo` | 4-step | FastH3 first-frame image-to-video or last-frame-only L2VA |
| `minimax-h3-fasth3-flf2v-turbo` | 4-step | FastH3 first-frame → last-frame video; no FastH3 R2V mode |
| `wan_v2.2-14b-fp8_i2v_lightx2v` | Fast | **Default single-image image-to-video** (one `--ref`, no end frame) |
| `wan_v2.2-14b-fp8_i2v` | Slow | Higher quality video |
| `wan_v2.2-14b-fp8_t2v_lightx2v` | Fast | Text-to-video |
| `wan_v2.2-14b-fp8_s2v_lightx2v` | Fast | Face lip-sync with uploaded audio |
| `wan_v2.2-14b-fp8_animate-move_lightx2v` | Fast | Animate-move |
| `wan_v2.2-14b-fp8_animate-replace_lightx2v` | Fast | Animate-replace |

### CLI selector aliases

Every key below is a valid `-m` value. The shared intelligence-client
`VIDEO_MODEL_ALIASES` map resolves aliases (workflow-aware, so one Seedance
alias can serve several workflows) to canonical worker/vendor model ids.
`test/docs-consistency.test.mjs` asserts every alias key in that map appears
in this file, so a new runtime model family fails CI until it is documented
here. The bare `happyhorse` / `happyhorse-1.1` selector is resolved by the CLI
itself (see [HappyHorse 1.1 models](#happyhorse-11-models)).

| Alias | Resolves to |
|-------|-------------|
| `ltx25`, `ltx25-t2v` | `ltx25-22b-int8_t2v_distilled` |
| `ltx25-i2v` | `ltx25-22b-int8_i2v_distilled` |
| `ltx25-ia2v` | `ltx25-22b-int8_ia2v_distilled` |
| `ltx25-a2v` | `ltx25-22b-int8_a2v_distilled` |
| `ltx25-v2v` | `ltx25-22b-int8_v2v_distilled` |
| `ltx23`, `ltx23-t2v` | `ltx23-22b-fp8_t2v_distilled` |
| `ltx23-i2v` | `ltx23-22b-fp8_i2v_distilled` |
| `ltx23-ia2v` | `ltx23-22b-fp8_ia2v_distilled` |
| `ltx23-a2v` | `ltx23-22b-fp8_a2v_distilled` |
| `ltx23-v2v` | `ltx23-22b-fp8_v2v_distilled` |
| `ltx23-eros`, `10eros` | `ltx23-22b-10eros-v1.4-fp8mixed_i2v` |
| `wan22`, `wan22-t2v` | `wan_v2.2-14b-fp8_t2v_lightx2v` |
| `wan22-i2v` | `wan_v2.2-14b-fp8_i2v_lightx2v` |
| `wan22-s2v` | `wan_v2.2-14b-fp8_s2v_lightx2v` |
| `wan22-animate-move` | `wan_v2.2-14b-fp8_animate-move_lightx2v` |
| `wan22-animate-replace` | `wan_v2.2-14b-fp8_animate-replace_lightx2v` |
| `seedance2`, `seedance2-t2v`, `seedance2-ia2v`, `seedance2-v2v` | `seedance-2-0` (suffix picks the workflow) |
| `seedance2-mini`, `seedance2-mini-t2v` | `seedance-2-0-mini` |
| `seedance2-fast`, `seedance2-fast-t2v` | `seedance-2-0-fast` |
| `seedance2-5`, `seedance2-5-t2v`, `seedance2-5-ia2v`, `seedance2-5-v2v` | `seedance-2-5` (suffix picks the workflow) |

### Default image-to-video routing

- **Single-image i2v** (`--ref` only, no `-m`) defaults to
  `wan_v2.2-14b-fp8_i2v_lightx2v`. Keep that default for plain "animate this
  image" requests. The CLI auto-routes single-image i2v to
  `ltx25-22b-int8_i2v_distilled` only when the prompt calls for native audio
  (quoted dialogue; words like audio, music, sound, speech, sings) or reads
  as story direction (story, scene, script, narrative, commercial), or when
  `-Q hq`/`-Q pro` is set — WAN clips render silent. If the prompt must
  contain such words but the WAN path is still wanted, pin it explicitly
  with `-m wan_v2.2-14b-fp8_i2v_lightx2v`.
- **Two-image first-frame → last-frame animation** (`--ref` + `--ref-end`,
  no `-m`) defaults to `ltx25-22b-int8_i2v_distilled` and uses the dedicated
  FLF template. FLF shares the I2V public model ID; it does not attach the
  LTX-2.3 transition LoRA. Pin `ltx23-22b-fp8_i2v_distilled` only when the
  legacy LoRA-assisted transition behavior is explicitly required.
- A configured `videoModels.i2v` (OpenClaw plugin config) overrides both
  defaults.

## Seedance 2.5

`seedance2-5` (vendor model `seedance-2-5`) is the newest Seedance generation.
Like the rest of the family it is an external-vendor Premium-Spark path (never
subscription-covered), renders at a fixed 24 fps with native audio, and takes
no negative prompt and no ControlNet.

- **Duration**: 4-30 s per clip (97-721 frames) — the only Seedance that
  renders past 15 s in a single call. Prefer `seedance2-5` over splitting and
  stitching 2.0 segments when the user wants one continuous Seedance clip
  longer than 15 s.
- **Resolution**: 480p/720p only (max dimension 1280; default 1280×720). It
  cannot render 1080p or 4K — keep full `seedance2` for those requests.
- **Workflows**: text-to-video, image-to-video from a first frame, first- and
  last-frame conditioning (`--ref` + `--ref-end`), image+audio-to-video
  (`seedance2-5-ia2v`), and multimodal reference / video-to-video including
  video editing and extension (`seedance2-5-v2v`).
- **Reference budget**: up to 30 image / 10 video / 10 standalone audio refs,
  50 reference files total across those per-modality caps — much larger than
  the 2.0 family's 9 / 3 / 3 / 12.
  Per-model caps come from `@sogni-ai/sogni-protocol`'s
  `seedance-reference-limits` catalog.
- **Prompting**: the same `@Image1` / `@Video1` / `@Audio1` loose-reference
  grammar and the same mutually exclusive dedicated-frame vs loose-reference
  modes as Seedance 2.0.
- **Task contract**: Seedance 2.5 first/last-frame, edit, and extend requests
  use adaptive output ratio. The CLI sends typed task metadata so
  `seedance2-5-v2v` defaults to edit; pass `--seedance-task-type extend` for
  continuation or `reference` when a video is only a loose creative reference.
  Edit requires `--duration` equal to the source video's duration. Extend uses
  the requested 4-30 second continuation duration. For edit/extend, select only
  `--target-resolution 480|720`; the provider inherits `@Video1`'s aspect ratio.
  Untyped automatic classification is rejected before billing because it can
  fail asynchronously after inferring the task.
- **Audio-only reference**: unlike 2.0, Seedance 2.5 accepts standalone audio as
  its only loose reference.

The pinned `@sogni-ai/sogni-intelligence-client` 3.24.1 runtime recognizes
`seedance-2-5`, and the package override pins `@sogni-ai/sogni-client` 5.20.0
for typed task transport. The direct CLI applies Seedance's fixed 24 fps,
4-30 s duration window, larger reference caps, reference-mode exclusivity, and
HTTPS reference forwarding before dispatch.

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

## Alibaba Wan 3

`wan3`, `wan3-video`, `wan3.0`, and `wan-3` resolve to the single Premium-Spark
vendor model `wan3.0-video`.
Media shape selects the operation; there are no separate t2v/i2v/v2v model
IDs. It renders 2–30 second clips at fixed 30 fps with native audio (enabled by
default, disable with `--no-generate-audio`) at 480P, 720P, or 1080P.
Supported ratios are `adaptive`, `16:9`, `4:3`, `1:1`, `3:4`, and `9:16`.
Use `--smart-duration` for provider-selected timing or `--duration 2..30` for
an exact request. `--no-expand-prompt` bypasses local prompt guardrails and
sends literal wording; hosted agent paths run Sogni's exact-model shaper. The
configured Alibaba Model Studio WAN3 endpoint accepts no provider-side
`prompt_extend` behavior is coordinated with Sogni's own model-specific shaping
so a prompt is not rewritten twice.

- **Frame mode:** `--ref` is the first frame; optional `--ref-end` is the last
  frame. A last frame requires a first frame.
- **Loose-reference mode:** select `r2v`, `a2v`, or `ia2v`. In these
  modes `--ref` is a loose `Image 1`; `--ref-video` and `--ref-audio` are
  repeatable loose `Video N` / `Audio N` inputs. Give every reference one
  explicit job in the prompt.
- **Mutual exclusion:** first/last-frame anchors cannot be mixed with loose
  image, video, or audio references, document context, or webpage context.
- **Document/web context:** `--reference-file-url` accepts one public HTTPS
  PDF, Office, text, Markdown, Keynote, Pages, or Numbers file up to 100 MB
  (PDF/DOCX/DOC/PPTX/PPT/Keynote/Pages: up to 50 pages);
  `--reference-link-url` accepts one public HTTPS webpage. File and link are
  mutually exclusive. They may accompany loose-reference generation but not
  dedicated first/last-frame anchors.
- **Caps:** 10 images, 5 videos, and 5 audio clips. There is no additional
  aggregate media-count cap in the upstream contract.
  Each video/audio input is 1–15 seconds; total video input is at most 15
  seconds.
- **Inputs:** a prompt or at least one media input is required; prompts allow up
  to 20,000 characters. Send no negative prompt, steps, guidance, sampler,
  scheduler, ControlNet, or mask. Seeds are integers from 0 through 2147483647.
- **No edit/extend task:** video references are loose conditioning for a new
  generation. Alibaba exposes no edit/extend task mode or task-type field; use
  a dedicated video-to-video model when source-preserving editing is required.
- **Cost (as of 2026-08):** platform artist pricing is $0.065/s at 480P,
  $0.13/s at 720P, and $0.26/s at 1080P; native audio does not change the rate.

Prompt in plain natural language. Name references exactly as `Image 1`,
`Video 1`, and `Audio 1` in per-modality submission order. For dialogue, quote
the words and identify the speaker; keep the visual action and camera direction
observable and concise.

## Wan 3.0 Enhanced

`wan3-enhanced`, `wan3.0-enhanced`, `wan3-spicy`, and `wan3.0-spicy` resolve to
the Sogni model `wan3.0-spicy-video`; MuleRouter's provider ID is
`w3.0-video`. Public surfaces call it **Wan 3.0 Enhanced**. It renders fixed or
smart 2–30 second clips at 30 fps with native audio and 480P, 720P, or 1080P
output. Supported ratios are `adaptive`, `16:9`, `9:16`, `1:1`, `4:3`, and
`3:4`.

- Use t2v for prompt-only video, i2v for first/optional last frame, r2v for
  loose media references, and a2v/ia2v when audio drives the result.
- Use either first/last-frame anchors or loose references; the modes cannot be
  combined. Loose-reference limits are 10 images, 5 videos, and 5 audio clips;
  every input must be supplied through the context image/media workflow because
  a prompt name alone cannot preserve identity.
- Smart duration (`--smart-duration`) and provider prompt expansion are
  supported. There is no document/web context, watermark control, negative
  prompt, sampling override, source-video edit, or extend mode. Seeds are
  integers from `0` through `2147483647`; omit the seed for a random result.
- Standard artist PAYG rates are $0.08/s at 480P, $0.16/s at 720P, and
  $0.32/s at 1080P (as of 2026-09). Existing paid subscribers receive a
  one-time model credit of $10 on Unlimited or $20 on Unlimited Pro through
  September 1, 2026 00:00 UTC (August 31 at 5:00 PM PT). That credit is not
  subscription coverage; once used or expired, normal PAYG applies.

## MiniMax H3 models

MiniMax H3 is a Sogni-hosted video family with **fifteen current selectors**:
four Standard workflows, four 8-step Balanced workflows, four 4-step
LightX2V Turbo workflows, and three FastVideo VSA FastH3 Turbo workflows. Every mode
generates picture and **native 32 kHz stereo audio jointly**.
`--no-generate-audio` (SDK `generateAudio=false`) strips the generated track
from the delivered file rather than skipping audio generation. It is an explicit model choice, never a
universal default. The bare `minimax-h3`, `minimax-h3-balanced`, and
`minimax-h3-turbo`, and `minimax-h3-fasth3-turbo` selectors resolve to the matching engine and mode inferred
from your references. The Standard, Balanced, and LightX2V Turbo families accept
an explicit `--workflow r2v`; FastH3 rejects it.
**`minimax-h3-r2v` is never inferred** — it runs a different checkpoint and must
be asked for by name. Its Balanced and Turbo counterparts are
`minimax-h3-r2v-balanced` and `minimax-h3-r2v-turbo`.
FastH3 has no R2V mode, so `--workflow r2v` is rejected with its generic selector.

| Model | Mode | Use Case |
|-------|------|----------|
| `minimax-h3` / `minimax-h3-t2v` | Text-to-video | Prompt-only clip with native audio (default for `-m minimax-h3` with no refs) |
| `minimax-h3-i2v` | Image-to-video | Animate a single first-frame image passed with `--ref` |
| `minimax-h3-flf2v` | First → last frame | Interpolate between `--ref` and `--ref-end` |
| `minimax-h3-r2v` | Reference-to-video | Compose from a labelled reference SET: up to 9 images, 3 videos, 3 audio clips, 12 files total |
| `minimax-h3-balanced` / `minimax-h3-t2v-balanced` | Balanced text-to-video | Fixed 8-step Euler/simple LightX2V prompt-only path; generic `minimax-h3-balanced` infers the frame workflow |
| `minimax-h3-i2v-balanced` | Balanced image-to-video | Fixed 8-step animation from one first frame |
| `minimax-h3-flf2v-balanced` | Balanced first → last frame | Fixed 8-step interpolation between `--ref` and `--ref-end` |
| `minimax-h3-r2v-balanced` | Balanced reference-to-video | Fixed 8-step Euler/simple Ref2VA from a labelled reference set |
| `minimax-h3-turbo` / `minimax-h3-t2v-turbo` | Turbo text-to-video | 4-step prompt-only path; generic `minimax-h3-turbo` infers the frame workflow |
| `minimax-h3-i2v-turbo` | Turbo image-to-video | 4-step animation from one first frame |
| `minimax-h3-flf2v-turbo` | Turbo first → last frame | 4-step interpolation between `--ref` and `--ref-end` |
| `minimax-h3-r2v-turbo` | Turbo reference-to-video | Dedicated 4-step Ref2VA LoRA; Euler/simple and 960×544 by default |
| `minimax-h3-fasth3-turbo` / `minimax-h3-fasth3-t2v-turbo` | FastH3 text-to-video | Separate FastVideo VSA four-step engine; generic selector infers frame workflows |
| `minimax-h3-fasth3-i2v-turbo` | FastH3 image-to-video | First-frame I2VA or last-frame-only L2VA from one endpoint |
| `minimax-h3-fasth3-flf2v-turbo` | FastH3 first → last frame | Both endpoints; FastH3 has no R2V selector |

The three standard frame modes share the FL2VA checkpoint: worker ids
`minimax-h3-fl2va-fp8_t2v`, `minimax-h3-fl2va-fp8_i2v`, and
`minimax-h3-fl2va-fp8_flf2v`. The CLI resolves those three short selectors,
picking i2v vs flf2v from whether `--ref-end` is present. Turbo applies
LightX2V's 4-step distillation LoRA to those same workflows through worker ids
`minimax-h3-fl2va-fp8_t2v_turbo`, `minimax-h3-fl2va-fp8_i2v_turbo`, and
`minimax-h3-fl2va-fp8_flf2v_turbo`. Balanced applies the fixed 8-step LightX2V path
through `minimax-h3-fl2va-fp8_t2v_balanced`,
`minimax-h3-fl2va-fp8_i2v_balanced`, and
`minimax-h3-fl2va-fp8_flf2v_balanced`. Reference-to-video is a
SEPARATE checkpoint — worker id `minimax-h3-ref2va-fp8_r2v` — selected directly
with `-m minimax-h3-r2v`, or through the creative-agent `generate_video` tool
with `videoModel="minimax-h3-r2v"` (including callers such as Sogni Chat). The
dedicated LightX2V LoRA exposes it as `minimax-h3-ref2va-fp8_r2v_turbo` through
the public `minimax-h3-r2v-turbo` selector; the Balanced Larry v4 version is
`minimax-h3-ref2va-fp8_r2v_balanced`, exposed as `minimax-h3-r2v-balanced`.
FastH3 is not an alias for LightX2V: it maps to
`minimax-h3-fastvideo-int8_t2v_turbo`, `minimax-h3-fastvideo-int8_i2v_turbo`,
and `minimax-h3-fastvideo-int8_flf2v_turbo`. Its qualified FastVideo VSA recipe
is fixed four-step Euler/simple, it is about 2x faster than LightX2V Turbo and
up to 6x faster than Standard for comparable 768p, 15-second requests, and it has no R2V mode.

The **fl2va** modes (t2v / i2v / flf2v) take image references only — they do not
accept reference video or reference audio, because audio is generated natively.
**r2v is the one H3 mode that does**: see
[MiniMax H3 reference-to-video (r2v)](#minimax-h3-reference-to-video-r2v).
FastH3 uses 23 GB without LoRA and 32 GB with an H3 LoRA. FL2VA/Balanced/LightX2V Turbo and image-only R2V are routed to 32 GB-class workers;
video-conditioned R2V requires a worker above 40 GB.

**Fixed parameters (do not override):**

- **24 fps**, always.
- **Frames on the `124 + n×17` grid**, `124` through `362` — **5.17 s to
  15.08 s**. `--duration` snaps onto that grid; an off-grid explicit `--frames`
  is a hard error.
- **Dimensions divisible by 32**, total pixels ≤ **1,032,192**. Standard,
  Balanced, and FL2VA Turbo default to `1344×768`; Ref2VA Turbo defaults to
  `960×544`.
- **20 steps for Standard; 8 for Balanced; 4 for Turbo; guidance/CFG 1** — send
  no steps, guidance, scheduler, or **negative prompt**. Standard and Balanced
  accept no sampler override; Balanced is fixed to Euler/simple. FL2VA H3 Turbo
  defaults to `er_sde` on Socket, and the CLI
  omits the sampler unless `--sampler` is passed. Direct FL2VA CLI A/B tests may pass
  exactly `--sampler euler`, `--sampler er_sde`, or `--sampler sa_solver`.
  Ref2VA Turbo uses the exact upstream Euler/simple recipe and accepts only
  `--sampler euler`. The checkpoint is CFG-distilled with
  guidance locked at 1, so there is no negative branch and a `negativePrompt`
  parameter is ignored wherever it is accepted. Put negative direction in the
  prompt text instead.
- **Balanced and Turbo use the same prompt contract as Standard H3.** Balanced
  is fixed at 8 steps with Euler/simple; Turbo is fixed at 4 steps with the
  `simple` scheduler; only Turbo's sampler has the three
  explicit variants above.
- **768p-class open-weights release.** Do not offer or claim 2K; MiniMax's 2K
  stage is hosted-only and not part of the open release.

```bash
sogni-agent -q --video -m minimax-h3 --duration 10 -w 1344 -h 768 -o ./video.mp4 "<three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-i2v --ref first.png --duration 8 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-flf2v --ref first.png --ref-end last.png --duration 8 -o ./video.mp4 "<FLF2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-r2v --ref identity.png -c wardrobe.png --ref-video motion.mp4 --ref-audio voice.m4a -o ./video.mp4 "<six-field Ref2VA prompt>"
sogni-agent -q --video -m minimax-h3-balanced --duration 8 -o ./video.mp4 "<three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-i2v-balanced --ref first.png --duration 8 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-flf2v-balanced --ref first.png --ref-end last.png --duration 8 -o ./video.mp4 "<FLF2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-r2v-balanced --ref identity.png -c wardrobe.png --duration 8 -o ./video.mp4 "<six-field Ref2VA prompt>"
sogni-agent -q --video -m minimax-h3-turbo --duration 8 -o ./video.mp4 "<three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-fasth3-turbo --duration 8 -o ./video.mp4 "<three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-i2v-turbo --ref first.png --duration 8 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-flf2v-turbo --ref first.png --ref-end last.png --duration 8 -o ./video.mp4 "<FLF2V preamble plus three-field H3 prompt>"
```

### MiniMax H3 prompting

Standard, Balanced, and Turbo T2V, I2V, and FLF2V use MiniMax's exact three-field rewrite
contract, in this order:

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

I2V prepends the exact first-frame alignment line; FLF2V prepends the exact
first-and-last-frame alignment line. The preamble must be the first line,
followed by one blank line before the fields. T2V has no preamble. Balanced and
Turbo use the same structure as their corresponding Standard mode.

Vocal sources receive stable `(S1)`, `(S2)`, ... IDs across all shots. Put only
the language tag and exact spoken words inside `<d>`, for example
`<d>[English] I kept this one behind the counter for you.</d>`. Do not translate
or paraphrase dialogue. **Read [`video-prompting.md`](video-prompting.md) §
MiniMax H3 Prompting** for the exact preambles, shot notation, field semantics,
and complete Ref2VA contract.

### MiniMax H3 reference-to-video (r2v)

The `minimax-h3-r2v`, `minimax-h3-r2v-balanced`, and
`minimax-h3-r2v-turbo` selectors are the H3 modes that condition on a whole
**reference set** instead of one or two locked frames. Ref2VA runs its own
checkpoint, so it is **never inferred** from stray uploads the way HappyHorse
r2v is — the user or the plan must name a tier. Direct CLI uses
`-m minimax-h3-r2v`: `--ref` supplies loose image 1, repeatable `-c` supplies
additional images, and repeatable `--ref-video` / `--ref-audio` supply those
modalities. At least one visual reference must be supplied: an image or a
video. A video can be the only visual input; audio alone is invalid. The
creative-agent `generate_video` tool uses
`videoModel="minimax-h3-r2v"` plus its typed reference-index arrays.

Everything in [MiniMax H3 models](#minimax-h3-models) above still applies: 24 fps,
the `124 + n×17` frame grid (5.17–15.08 s), dimensions divisible by 32 inside the
1,032,192-pixel budget, tier-fixed sampling (20/8/4 steps for
Standard/Balanced/Turbo), guidance 1, no negative prompt, and jointly generated
stereo audio.

**Reference ceilings** (from the `MiniMaxH3ReferenceToVideo` node, enforced by
Sogni Socket before the job is priced):

| Kind | Max | Notes |
|------|-----|-------|
| Reference images | 9 | Optional when a reference video supplies the required visual input |
| Reference videos | 3 | Read as 24 fps, 2–15 s each; a clip's own soundtrack is presented too |
| Reference audio | 3 | Standalone clips, separate from any video soundtrack |
| Total files | 12 | 9 + 3 + 3 = 15 does **not** fit; trade slots (e.g. 6 + 3 + 3) |

At least one image or video is required; audio alone is invalid. For a prompt-only render use
`minimax-h3-t2v`; for a locked opening frame use `minimax-h3-i2v`; to
interpolate between two anchors use `minimax-h3-flf2v`. r2v has no frame anchors
at all, so an end-frame parameter is rejected rather than ignored.

Ref2VA uses exactly six fields in this order:

```text
subject_definitions:

summary:

retention_analysis:

detailed_description:

overall_soundscape:

non_diegetic_music:
```

This is a different prompt contract from FL2VA H3. Standard, Balanced, and Turbo Ref2VA
share it.

#### Ordinals and the prompt tag form

References are numbered **from 1 independently per type**. Use `<Subject N>`
for visible referenced people, objects, scenes, or effects; cite the source
`<Picture N>` or `<Video N>` in that subject definition. Reserve `<Picture N>`
for a concrete frame or storyboard relationship, `<Video N>` for a whole-video
edit, continuation, camera, cut, rhythm, or temporal relationship, and
`<Audio N>` for a standalone audio asset or an explicitly enabled audio track.

This mirrors Seedance's loose-reference grammar — same 9 / 3 / 12 shape, same
"give every reference one explicit job" rule — but the tag form differs: Seedance
uses `@Image1` / `@Video1` / `@Audio1`, H3 uses `<Picture 1>` / `<Video 1>` /
`<Audio 1>`. Never carry one model's tags into the other's prompt.

Numbering restarts per type, so the first image is `<Picture 1>` even when a
video was attached before it. A video file does not automatically create an
`<Audio N>` label merely because it contains sound. Submission order remains
ordinal order; never reorder or drop a reference after writing the prompt.

#### One explicit job per reference

H3 blends everything it is shown unless told what to take from where. Give every
attached reference a single, non-overlapping job — identity, wardrobe, location,
camera movement, voice character — and state who wins when two disagree. An
unassigned reference is the most common cause of identity drift and washed-out
style on this model.

Compact format example:

```text
subject_definitions:
<Subject 1> is the woman in <Picture 1>; preserve her face, hairstyle, and dark-red jacket.
<Video 1> is the camera-motion reference for a slow handheld push-in.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
[reference generation + audio reference] The target video follows <Subject 1> through a rain-slicked street using <Video 1>'s camera movement and <Audio 1>'s voice timbre.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - her identity, hairstyle, and jacket are retained.
<Video 1> (camera movement): weak_reference - its slow handheld push-in guides the new shot.
<Audio 1>: reference - its vocal timbre guides <Subject 1>'s dialogue without copying the source signal.

detailed_description:
The target video uses a live-action cinematic style with wet neon street lighting. [Shot 1] <Subject 1> (S1) walks toward the camera while it performs the slow handheld push-in referenced from <Video 1>. She stops beneath a streetlight and says with the dry, low timbre referenced from <Audio 1>: <d>[English] It was never going to be the last train.</d>

overall_soundscape:
Steady rain falls on asphalt while tyres hiss through standing water and a bus engine passes from left to right.

non_diegetic_music:
N/A
```

Trim definitions for references that were not attached; unresolved labels are
invalid. See the full Ref2VA section in `video-prompting.md` for relationship
markers and detailed field semantics.

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
| Highest-quality images | `qwen_image_2512_fp8` (or `-Q pro`) |
| Image editing | `qwen_image_edit_2511_fp8_lightning` |
| Dark Beast Krea 2 images | `dark_beast_krea2_fp8` |
| Identity-preserving Krea image edits | `krea2_identity_edit_v1_2` |
| Uncensored identity-preserving Krea edits | `dark_beast_krea2_identity_edit_v1_2` |
| Photobooth face transfer | `coreml-sogniXLturbo_alpha1_ad` |
| Direct music generation | `ace_step_1.5_xl_turbo` (or `--music-model turbo`) |
| Music with stronger lyric handling | `ace_step_1.5_xl_sft` (or `--music-model sft`) |
| Text-to-video with native dialogue/audio | `ltx25` |
| Image-to-video from one start frame (default) | `wan_v2.2-14b-fp8_i2v_lightx2v` |
| Animate two images together (first frame → last frame) | `ltx25-i2v` with `--ref A --ref-end B` (FLF template, no transition LoRA) |
| Explicit uncensored image-to-video on 30GB+ GPUs | `ltx23-eros` with `--no-filter` |
| Image+audio-to-video | `ltx25-ia2v` |
| Audio-to-video | `ltx25-a2v` |
| Video-to-video with ControlNet/edit templates | `ltx25-v2v` |
| Private mature-theme image-to-video | `ltx23-22b-10eros-v1.4-fp8mixed_i2v` |
| Seedance text-to-video | `seedance2`, `seedance2-mini`, or `seedance2-fast` |
| Seedance video-to-video without ControlNet | `seedance2-v2v` |
| Seedance 2.5 single clip up to 30s (480p/720p only) | `seedance2-5` |
| Seedance 2.5 video-to-video, editing, or extension | `seedance2-5-v2v` |
| HappyHorse text-to-video with native audio | `happyhorse-1.1-t2v` (or `happyhorse`) |
| HappyHorse image-to-video from one first frame | `happyhorse-1.1-i2v` |
| HappyHorse reference-to-video from up to 9 images | `happyhorse-1.1-r2v` |
| Wan 3 unified text/frame/reference/audio/video generation | `wan3` / `wan3.0-video` |
| Wan 3.0 Enhanced text/frame/reference/audio/video generation | `wan3-enhanced` / `wan3.0-spicy-video` |
| MiniMax H3 text-to-video with native stereo audio | `minimax-h3` (or `minimax-h3-t2v`) |
| MiniMax H3 image-to-video from one first frame | `minimax-h3-i2v` with `--ref` |
| MiniMax H3 first frame → last frame transition | `minimax-h3-flf2v` with `--ref A --ref-end B` |
| MiniMax H3 from a set of loose references (identity + wardrobe + location, a motion clip, a voice clip) | `minimax-h3-r2v` with `--ref`/`-c`, repeatable `--ref-video`, and repeatable `--ref-audio` |
| MiniMax H3 Balanced text-to-video | `minimax-h3-balanced` or `minimax-h3-t2v-balanced` |
| MiniMax H3 Balanced image-to-video from one first frame | `minimax-h3-i2v-balanced` with `--ref` |
| MiniMax H3 Balanced first frame → last frame transition | `minimax-h3-flf2v-balanced` with `--ref A --ref-end B` |
| MiniMax H3 Balanced from loose references | `minimax-h3-r2v-balanced` with `--ref`/`-c`, repeatable `--ref-video`, and repeatable `--ref-audio` |
| MiniMax H3 LightX2V Turbo text-to-video | `minimax-h3-turbo` or `minimax-h3-t2v-turbo` |
| MiniMax H3 LightX2V Turbo image-to-video from one first frame | `minimax-h3-i2v-turbo` with `--ref` |
| MiniMax H3 LightX2V Turbo first frame → last frame transition | `minimax-h3-flf2v-turbo` with `--ref A --ref-end B` |
| MiniMax H3 Ref2VA Turbo from loose references | `minimax-h3-r2v-turbo` with `--ref`/`-c`, repeatable `--ref-video`, and repeatable `--ref-audio` |
| MiniMax H3 FastH3 Turbo text-to-video | `minimax-h3-fasth3-turbo` or `minimax-h3-fasth3-t2v-turbo` |
| MiniMax H3 FastH3 Turbo image-to-video | `minimax-h3-fasth3-i2v-turbo` with `--ref` |
| MiniMax H3 FastH3 Turbo first frame → last frame | `minimax-h3-fasth3-flf2v-turbo` with `--ref A --ref-end B`; no R2V |
| Face lip-sync with uploaded audio | `wan_v2.2-14b-fp8_s2v_lightx2v` |

## Video sizing & aspect ratios

- **WAN 2.2 models** use dimensions divisible by 16, min 480 px, max 1536 px.
- **Wan 3** uses fixed 30 fps, fixed or smart 2–30 s output, and 480P/720P/1080P buckets with `adaptive`, `16:9`, `4:3`, `1:1`, `3:4`, and `9:16`; see [Alibaba Wan 3](#alibaba-wan-3).
- **Wan 3.0 Enhanced** uses fixed 30 fps, fixed or smart 2–30 s output, 480P/720P/1080P buckets, and `adaptive`, `16:9`, `9:16`, `1:1`, `4:3`, or `3:4`; see [Wan 3.0 Enhanced](#wan-30-enhanced).
- **MiniMax H3 Standard, Balanced, LightX2V Turbo, and FastH3 Turbo** use dimensions divisible by 32, fixed 24 fps, 124–362 frames on the `124 + n×17` grid (5.17–15.08 s), and no more than 1,032,192 pixels. Standard, Balanced, LightX2V FL2VA Turbo, and FastH3 default to 1344×768; Ref2VA Turbo defaults to 960×544. Standard uses 20 steps; Balanced uses fixed 8-step Euler/simple acceleration, with LightX2V for FL2VA and Larry v4 for Ref2VA; both Turbo engines use 4 steps. LightX2V FL2VA H3 Turbo defaults to `er_sde` and accepts `euler`, `er_sde`, or `sa_solver`; the CLI omits the sampler unless `--sampler` is passed. Ref2VA Turbo and FastH3 use Euler/simple only. FastH3 is the separate FastVideo VSA engine and has no R2V mode. Guidance 1 and native stereo audio apply to all. FastH3 requires 23 GB without LoRA and 32 GB with an H3 LoRA; other FL2VA/Balanced/Turbo and image-only R2V routes require 32 GB-class workers, while video-conditioned R2V requires above 40 GB. See [MiniMax H3 models](#minimax-h3-models).
- **LTX family** (`ltx2-*`, `ltx23-*`, `ltx25-*`) uses dimensions divisible by 64. The current wrapper caps non-WAN video dimensions at 2048 px on the long side.
- **Seedance** runs at fixed 24 fps. The 2.0 family (`seedance2`, `seedance2-mini`, `seedance2-fast`) supports 4–15 s durations; full `seedance2` supports native 4K via `--target-resolution 2160` while `seedance2-mini` and `seedance2-fast` remain capped to the 720p lower-resolution path. `seedance2-5` renders 4–30 s single clips (97–721 frames) but caps at 480p/720p (max dimension 1280) — it cannot render 1080p or 4K. Other default/WAN paths support up to 10 s; LTX and WAN animate workflows support up to 20 s.
- **HappyHorse 1.1** runs at fixed 24 fps and supports 3–15 s durations at 720P or 1080P, with always-on native audio (no negative prompt, no ControlNet). Accepted aspect ratios are `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `4:5`, `5:4`, `9:21`, and `21:9`. i2v takes one first-frame image (`--ref`); r2v takes 1–9 reference images (`-c`/`--context`); it accepts no reference video or audio.
- For spoken dialogue, budget roughly 3 words per second plus about 1 second per meaningful acting beat or pause.
- The CLI auto-normalizes video sizes to satisfy these constraints.
- Use `--target-resolution <px>` for bare resolution requests like "720p" — it targets the short side and preserves the inherited aspect ratio.
- Natural-language aspect requests like "portrait", "square", "16:9", or "9:16" are inferred when width/height aren't explicitly set. Combined requests like "720p 9:16" keep the requested short side while applying the requested shape.
- For i2v (and any workflow using `--ref` / `--ref-end`), the client wrapper resizes the reference image with strict aspect-fit (`fit: inside`) and uses the *resized* dimensions as the final video size. Because that resize uses rounding, a "valid" requested size can still produce an invalid final size (example: `1024×1536` requested, but the ref becomes `1024×1535`). The CLI detects this for local refs and auto-adjusts to a nearby safe size.
- Pass `--strict-size` to fail instead — the CLI prints a suggested size.
