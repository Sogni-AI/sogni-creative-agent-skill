# Video Prompting Guide (LTX-2.x, MiniMax H3, pacing, orientation, camera language)

Read this before writing any text-to-video or image-to-video prompt for LTX
models, before writing any MiniMax H3 prompt, and whenever the user asks for
"hd", "1080p", "4k", "uhd", or "high-res" video so you can choose between the
LTX and Seedance paths.

The families require different prompt **shapes**. LTX wants one unbroken prose
paragraph with no line breaks and no negative phrasing. MiniMax H3 requires the
official ordered-field rewrite contract, shot notation, speaker IDs, dialogue
tags, and mode-specific alignment preamble. Do not carry LTX's
single-paragraph, positive-only, no-markup rule into an H3 prompt. Pick the
section that matches the model you are about to invoke.

If the creator asks only for a prompt, the requested text is the final
deliverable: author it in the selected model's native shape without invoking
the CLI or hosted API. A request to generate/write a prompt does not authorize
media generation. A compound request that also asks to render or make the
video now does authorize execution after the prompt is shaped. This applies to
every video model and workflow, not only the families documented below. The
target model and mode are required. If either is omitted, ask for it. If that
exact model/mode has no validated native contract, say so and request the exact
specification; never substitute a generic prompt or another model's syntax.

## LTX-2.x Prompt Rule

Whenever the chosen video model is LTX-2.5 (or an LTX-2.3 rollback model), do
not pass the user's short request through unchanged. Rewrite it into an
LTX-safe prompt before calling `sogni-agent`.

- Output one single paragraph only. No line breaks, bullet points, section labels, tag lists, or screenplay formatting.
- Use 4-8 flowing present-tense sentences describing one continuous shot. No cuts, montage, or unrelated scene jumps.
- Start with shot scale plus the scene's visual identity, then describe environment, time of day, atmosphere, textures, and specific light sources.
- Keep people, clothing, props, and locations concrete and stable across the whole paragraph.
- Give the scene one main action thread from start to finish. Use connectors like `as`, `while`, and `then` so motion reads as a continuous filmed moment.
- Be specific and literal about motion. Describe what moves, where it moves,
  what it contacts, and what happens next in chronological order. Do not replace
  visible actions with euphemisms or broad summaries. For example, replace "a
  ball bouncing around" with "A red ball moves right, bounces off the wall,
  and returns to the center"; replace "fluid pouring" with "Water flows from
  the left container through the connecting tube into the right container
  until both levels are equal."
- Treat native audio as part of the scene design. Integrate relevant dialogue,
  voice delivery, foley, environmental sound, and music with the actions that
  produce or accompany them.
- Write dialogue out verbatim in double quotes and identify the speaker and
  delivery. Never merely suggest dialogue with phrases such as "they talk,"
  "she says something," or "the couple discusses the scene."
- Budget spoken dialogue at about 3 words per second, plus about 1 second for each meaningful acting beat or pause.
- Express emotion through visible physical cues such as posture, grip, jaw tension, breathing, or pacing. Ambient sound can be woven into the prose naturally.
- Use positive phrasing only. Do not add negative prompts, "no ..." clauses, on-screen text/logo requests, vague filler words like `beautiful` or `nice`, or structural markup such as `[DIALOGUE]`. **This positive-only, no-markup rule is scoped to the LTX family only.** MiniMax H3 has no separate negative-prompt input and instead requires its ordered fields, `[Shot N]` notation, `(Sx)` speaker IDs, and `<d>` dialogue tags; see [MiniMax H3 Prompting](#minimax-h3-prompting).
- Keep action density proportional to duration. For short clips, describe one main beat rather than several separate events.
- Preserve the user's request, but expand it into cinematic prose. Do not invent a different story just to make the prompt longer.

### Duration-Aware Pacing

Match scene density to clip length so prompts stay filmable:

- About `1-4s`: describe exactly 1 action or moment.
- About `5-8s`: describe about 2 sequential actions.
- About `9-12s`: describe about 3 sequential actions.
- Longer clips: add only a small number of additional sequential beats. Do not turn the prompt into a montage or a full story arc unless the duration clearly supports it.

### Orientation Mapping

When the user explicitly asks for an orientation or aspect ratio, map it to safe LTX dimensions:

- `vertical`, `portrait`, `story`, `reel`, `tiktok` -> `-w 1088 -h 1920`
- `landscape`, `horizontal`, `widescreen`, `youtube`, `16:9` -> `-w 1920 -h 1088`
- `square`, `1:1` -> `-w 1088 -h 1088`
- `4:3 portrait` -> `-w 832 -h 1088`
- `4:3 landscape` -> `-w 1088 -h 832`

### Camera Language Normalization

When the user uses loose camera language, translate it into concrete motion phrasing inside the prose prompt:

- `zoom in` -> `slow push-in`
- `zoom out` -> `slow pull-back`
- `pan left` / `pan right` -> `smooth pan left` / `smooth pan right`
- `orbit` / `circle around` -> `slow arc left` or `slow arc right`
- `follow` -> `tracking follow`

### Example rewrite

```text
User ask: "4k video of a woman in a neon alley"

Use this shape instead: "A medium cinematic shot frames a woman in her 30s standing in a rain-soaked neon alley at night, violet and amber signs reflecting across the wet pavement while warm steam drifts from street vents. She wears a dark trench coat with damp strands of black hair clinging near her cheek as light glances across the fabric texture and the brick walls behind her. She turns toward the camera and steps forward with measured focus, one hand tightening around the strap of her bag while rain taps softly on the metal fire escape and a distant train hum rolls through the block. The camera performs a slow push-in as her jaw sets and her breathing steadies, maintaining smooth stabilized motion and a tense urban-thriller mood."
```

## MiniMax H3 Prompting

Write every H3 prompt using MiniMax's official structured rewrite contract. Do
not substitute an unstructured prompt for the required fields. The field names,
order, shot notation, alignment preamble, reference labels, and dialogue markup
are part of the model contract.

For prompt-only authoring, return only the applicable ordered-field document.
Do not wrap it in Markdown, add a title or preamble, append generic prompting
tips, explain the format, offer to generate the video, or ask a follow-up
question after the contract. Those additions make the text invalid as direct
H3 input.

Applies to standard `minimax-h3` / `minimax-h3-t2v`, `minimax-h3-i2v`, and
`minimax-h3-flf2v`; their 4-step `minimax-h3-turbo`,
`minimax-h3-i2v-turbo`, and `minimax-h3-flf2v-turbo` variants; and—with its own
six-field contract—to standard `minimax-h3-r2v` and `minimax-h3-r2v-turbo`. The exact worker
ids are `minimax-h3-fl2va-fp8_{t2v,i2v,flf2v}` with an optional `_turbo`
suffix, plus `minimax-h3-ref2va-fp8_r2v` and `minimax-h3-ref2va-fp8_r2v_turbo`. See
[MiniMax H3 reference-to-video (r2v)](#minimax-h3-reference-to-video-r2v) below
before writing an r2v prompt.

This guidance follows MiniMax's official H3 prompt-writing skill from
[MiniMax-H3 commit 35491cd](https://github.com/MiniMax-AI/MiniMax-H3/tree/35491cdba2adfe62a510f725e8619f8e58783ea2/skills/h3-prompt-writing).

### Fixed model facts

- **24 fps, always.** Do not pass an fps override.
- **Frame counts sit on the `124 + n×17` grid**, from `124` through `362` —
  i.e. **5.17 s to 15.08 s**. The CLI snaps `--duration` onto that grid; an
  off-grid explicit `--frames` is a hard error.
- **Dimensions divisible by 32**, total pixels ≤ **1,032,192**. Use
  `-w 1344 -h 768` (landscape) or `-w 768 -h 1344` (portrait).
- **20 steps for standard H3; 4 steps for H3 Turbo; guidance/CFG 1.** Do not
  send steps, guidance, scheduler, or a **negative prompt**. Standard H3 and
  R2V accept no sampler override. FL2VA H3 Turbo defaults to `er_sde` on Socket, and
  the CLI omits the sampler unless `--sampler` is passed. Direct FL2VA CLI A/B tests
  may pass exactly `--sampler euler`, `--sampler er_sde`, or
  `--sampler sa_solver`. Ref2VA Turbo uses the exact upstream Euler/simple recipe,
  defaults to 960×544, and accepts only `--sampler euler`. The checkpoint is CFG-distilled with
  guidance locked at 1, so there is no negative branch at all: a
  `negativePrompt` parameter is ignored wherever it is accepted. Negative
  direction goes in the prompt text instead.
- **Turbo uses the same prompt contract as standard H3.** Its execution path is
  fixed at 4 steps with the `simple` scheduler; only the sampler has the three
  explicit variants above.
- **Native 32 kHz stereo audio is generated jointly with the picture.** Every
  sound — dialogue, foley, ambience, score — exists only because the prompt
  asked for it. `generateAudio=false` strips that generated track from the
  delivered file; it does not skip audio generation.
- **Sogni's H3 is the 768p-class open-weights release.** Do not offer or claim
  2K; MiniMax's 2K stage is hosted-only and is not part of the open release.
- The Sogni CLI does not truncate H3 prompts. If another surface has a shorter
  cap, flag it explicitly instead of silently removing required fields.
- FL2VA/Turbo and image-only R2V are routed to 32 GB-class workers;
  video-conditioned R2V requires a worker above 40 GB.

Because `--duration` snaps to the frame grid, the delivered length is rarely the
integer the user asked for:

| `--duration` | Frames | Actual length |
|---|---|---|
| 5 | 124 | 5.17 s |
| 6 | 141 | 5.88 s |
| 8 | 192 | 8.00 s |
| 10 | 243 | 10.13 s |
| 12 | 294 | 12.25 s |
| 15 | 362 | 15.08 s |

### Base and Turbo contract: T2V, I2V, and FLF2V

After the mode-specific preamble described below, write exactly these three
fields in this order:

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

`integrated_multimodal_description` carries the complete visual and diegetic
audio timeline. `[Shot 1]` has no timestamp; each later cut begins with a
strictly increasing marker such as `[Shot 2] At 00:03.500, the camera cuts
to...`. Describe camera movement as part of the shot. Use
`overall_soundscape` for ambience, physical action sounds, and non-verbal human
sound, without repeating dialogue, singing, or diegetic music. Use
`non_diegetic_music` only for audience-only score, or `N/A` when there is none.

Assign speaking or singing subjects stable `(S1)`, `(S2)`, ... IDs in order of
their first vocal event and reuse each ID across all shots. Keep the speaker,
action, and delivery outside the dialogue tag. Inside the tag, preserve only
the language and exact words:

```text
The record-store owner with a warm, gravelly voice (S1) says: <d>[English] I kept this one behind the counter for you.</d>
```

Do not translate, paraphrase, or clean up the user's dialogue. Use a compound
ID such as `(S1,S2)` only when already-numbered speakers vocalize together.

### Worked example — text-to-video

```text
User ask: "10 second video of a barista and a customer arguing about oat milk"

sogni-agent -q --video -m minimax-h3 --duration 10 -w 1344 -h 768 -o ./cafe.mp4 "<prompt below>"
```

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, slightly desaturated, a medium two-shot frames a narrow espresso bar on a weekday morning. Soft window light rakes across the brushed-steel machine and pastry case. A barista in her late twenties slides a white cup across the counter. A customer in a grey overcoat with a quiet, clipped voice (S1) stops the saucer with two fingers and says: <d>[English] I asked for oat milk.</d> [Shot 2] At 00:03.000, the camera cuts to a static close-up over the customer's shoulder. The barista with a flat, even voice (S2) lifts the oat carton, turns it upside down, sets it on the wood, and says: <d>[English] We ran out at six this morning.</d> [Shot 3] At 00:07.000, the camera cuts back to the two-shot. The customer tightens his jaw and pulls the cup toward himself while steam curls past his face and the barista turns to the next ticket.

overall_soundscape: Low cafe room tone continues under the scene. A steam wand hisses, ceramic clinks against the saucer, the empty carton knocks against wood, and a chair leg scrapes in the background.

non_diegetic_music: N/A
```

### Worked example — image-to-video

```text
User ask (with an uploaded portrait): "have her look up and say she's not going back"

sogni-agent -q --video -m minimax-h3-i2v --ref ./portrait.png --duration 6 -w 768 -h 1344 -o ./reply.mp4 "<prompt below>"
```

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a static medium close-up begins exactly from <Picture 1>, preserving the woman's dark chin-length hair, olive canvas jacket, red vinyl seatback, and the rain-streaked night-bus window. She lowers her phone into her lap and lifts her gaze toward the window as sodium streetlights slide across her cheek. The woman with a low, unhurried voice (S1) says: <d>[English] I'm not going back.</d> She turns slightly toward the aisle, sets her jaw, and closes one hand around her bag strap while the camera remains static.

overall_soundscape: A steady diesel drone and the bus-frame rattle continue throughout. Rain ticks against the glass, canvas shifts as she moves, and an air brake hisses near the end.

non_diegetic_music: Two widely spaced piano notes over sustained low strings, fading before the final second.
```

`--duration 6` renders 141 frames (5.88 s) and `--duration 10` renders 243
frames (10.13 s). Keep every `[Shot N] At MM:SS.mmm` cut time within the actual
snapped duration.

### Required dialogue and shot markup

The structured field document and its dialogue, speaker, and shot notation are
the default H3 rewrite format. Preserve valid markup a user supplied, and repair
free-form input into this contract before submission.

**Dialogue tags.** Only the language tag and the spoken words go inside
`<d>…</d>`. The speaker's identifying phrase, ID, action, and delivery all stay
outside it:

```text
The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d>
The two children (S1,S2) shout together, <d>[English] Wait for us!</d>
```

- Speaker IDs are `(S1)`, `(S2)`, … assigned in order of first vocal event and
  kept stable across every shot. A character who never vocalizes gets no ID. Two
  or more already-numbered speakers vocalizing together use a compound ID such
  as `(S1,S2)`.
- Supported dialogue languages: Arabic, Chinese, English, French, German,
  Italian, Japanese, Korean, Portuguese, Russian, Spanish. The tag is the
  English language name in square brackets, e.g. `<d>[Japanese] …</d>`.
- **Voiceover** uses the exact phrase `says in an off-screen voiceover`, and the
  `<d>` block is followed by a statement that the on-screen character's lips
  stay closed:

  ```text
  The man (S1) says in an off-screen voiceover: <d>[English] I still remember that road.</d> while his lips remain completely closed.
  ```

- `<scenetrans>` marks one line of dialogue or lyrics that crosses a cut: place
  it at the connecting point in **both** parts, and state explicitly that the
  audio continues across the cut (`continues seamlessly across the cut`,
  `continues uninterrupted into the next shot`, `carries over from the previous
  shot`, `remains audible across the transition`).
- `<cutoff>` marks speech that is truncated by the end of the video.

**Tokenizer tokens versus prompt markup.** The open-weights H3 tokenizer also
reserves the learned tokens `<d>`, `</d>`, `<|cutoff|>`,
`<|lyrics_start|>`, `<|lyrics_end|>`, `<|caption_start|>`, and
`<|caption_end|>`. Inference integrations must register all seven exactly as
released. Prompt authors should still follow MiniMax's public writing guide:
emit `<d>…</d>`, `<scenetrans>`, and the plain `<cutoff>` spelling described
above. The vertical-bar lyrics, caption, and cutoff tokens are tokenizer
internals, not documented author-facing prompt markup.

**Shot markers and the camera vocabulary.** In the IR format, `[Shot 1]` opens
with the overall style and initial composition and takes no timestamp; every
later shot opens with a strictly increasing cut time — `[Shot 2] At 00:03.500,
the camera cuts to …` (also `the shot cuts to` / `transitions to` / `changes
to` / `switches to`). The IR's camera motion types are `Zoom In/Out`, `Push
In/Pull Out`, `Pan Left/Right`, `Truck Left/Right`, `Tilt Up/Down`, `Pedestal
Up/Down`, `Arc Shot`, `Tracking Shot`, `Static Shot`, `Shake
Slightly/Strongly`, `POV`, and `Roll Clockwise/Counterclockwise`, optionally
qualified `with small amplitude` / `with large amplitude` and `at slow speed` /
`at fast speed`.

**The three-field document.** MiniMax's rewriter emits the required alignment
line when applicable, a blank line, then exactly three labelled fields in this
order:

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

`integrated_multimodal_description` is the whole audiovisual timeline;
`overall_soundscape` is 1-4 sentences of ambience, physical action sound, and
non-verbal human sound (no dialogue, singing, or diegetic music);
`non_diegetic_music` is 1-3 sentences of score-only instrumentation, tempo, and
dynamics. `N/A` is the schema's token for "nothing here" — used in
`non_diegetic_music` for no score, and in `overall_soundscape` only for a
deliberately silent video.

**Alignment instruction lines (i2v / flf2v only).** These exact preambles pin
reference images to the target timeline. They are mandatory for those modes and
must be the first line, followed by one blank line. T2V has no preamble.

Image-to-video (`minimax-h3-i2v` or `minimax-h3-i2v-turbo`, one `--ref`):

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

First frame → last frame (`minimax-h3-flf2v` or
`minimax-h3-flf2v-turbo`, `--ref` plus `--ref-end`). Note the bare `Picture 1`
and `Shot 1` with **no** angle or square brackets, and the em dash (`—`) with a
space on each side:

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

`N` is the index of the actual final shot (`Shot 1` for the usual single-shot
transition), and `S.SS` is the effective duration to exactly two decimal places
— `10.13` for 243 frames at 24 fps (243 ÷ 24 = 10.125, rounded up).

### MiniMax H3 reference-to-video (r2v)

`minimax-h3-r2v` conditions on a whole **reference set** rather than one or two
locked frames: up to **9 reference images**,
**3 reference videos** (24 fps, 2–15 s, each with an optional soundtrack) and
**3 standalone audio clips**, **12 files maximum in total**. It runs a separate
ref2va checkpoint, so it is never inferred — it must be chosen by name with
direct CLI `-m minimax-h3-r2v` or the `generate_video` tool's
`videoModel="minimax-h3-r2v"` (including callers such as Sogni Chat). Direct CLI
uses `--ref` then repeatable `-c` for images, plus repeatable `--ref-video` and
`--ref-audio` for those modalities. At least one visual reference (image or
video) is required. A reference video can be the only visual input; audio alone
is invalid. r2v
has no frame anchors at all—for
a locked opening frame use `minimax-h3-i2v`, and for a first-to-last-frame
transition use `minimax-h3-flf2v`.

Ref2VA does not use the three-field Base contract. Write exactly these six
fields, in this order:

```text
subject_definitions:

summary:

retention_analysis:

detailed_description:

overall_soundscape:

non_diegetic_music:
```

`subject_definitions` assigns stable labels and roles to every reused subject or
asset. `summary` begins with the applicable bracketed task type, such as
`[reference generation + audio reference]`. `retention_analysis` gives one line
per label using the official relationship values, such as `fully_preserved`,
`partially_preserved`, `attribute_transfer`, or `weak_reference` for visual
content and `fully_copy`, `partially_copy`, `reference`, or `weak_reference` for
audio. `detailed_description` is the shot-by-shot target-video timeline and
uses the same `[Shot N]`, `(Sx)`, and `<d>[Language] ...</d>` rules as Base H3.

**Reference grammar.** Reference assets are numbered from 1 independently per
type. Use the exact angle-bracket labels:

- `<Picture 1>` … `<Picture 9>` for images
- `<Video 1>` … `<Video 3>` for videos
- `<Audio 1>` … for audio

Visible people, objects, scenes, or effects reused from an image or video become
`<Subject N>` entries whose definitions cite their source asset. Reserve
`<Picture N>` for a concrete frame or storyboard relationship, `<Video N>` for
a whole-video edit, continuation, camera, cut, rhythm, or temporal relationship,
and `<Audio N>` for a standalone audio asset or an explicitly enabled audio
track. A video file does not automatically create an `<Audio N>` label merely
because it contains sound.

Rewrite aliases such as "image 2", `@Image2`, or `[Image 2]` to the correct H3
label. Seedance's `@Image1` / `@Video1` / `@Audio1` grammar must not leak into an
H3 prompt. Never invent, drop, or renumber references after the prompt is
written. Give every asset one explicit role and state the winner when sources
conflict.

Compact format example:

```text
subject_definitions:
<Subject 1> is the woman in <Picture 1>; preserve her face, hairstyle, and dark-red jacket.
<Video 1> is the camera-motion reference for the target video's slow handheld push-in.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
[reference generation + audio reference] The target video shows <Subject 1> walking through a rain-slicked street while following <Video 1>'s camera movement and <Audio 1>'s voice timbre.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - her identity, hairstyle, and jacket are retained.
<Video 1> (camera movement): weak_reference - its slow handheld push-in guides the new shot.
<Audio 1>: reference - its vocal timbre guides <Subject 1>'s dialogue without copying the source signal.

detailed_description:
The target video uses a live-action cinematic style with wet neon street lighting. [Shot 1] <Subject 1> (S1) walks toward the camera while the camera performs the slow handheld push-in referenced from <Video 1>. She stops beneath a streetlight, looks over her shoulder, and says with the dry, low timbre referenced from <Audio 1>: <d>[English] It was never going to be the last train.</d>

overall_soundscape:
Steady rain falls on asphalt while tyres hiss through standing water and a bus engine passes from left to right.

non_diegetic_music:
N/A
```

Trim definitions for references that were not attached; unresolved labels are
invalid.

### Agent-ready H3 command shapes

```bash
# Text-to-video (landscape)
sogni-agent -q --video -m minimax-h3 --duration 10 -w 1344 -h 768 -o ./video.mp4 "<three-field H3 prompt>"

# Image-to-video from one first frame (portrait)
sogni-agent -q --video -m minimax-h3-i2v --ref ./first.png --duration 8 -w 768 -h 1344 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt>"

# First frame -> last frame transition
sogni-agent -q --video -m minimax-h3-flf2v --ref ./first.png --ref-end ./last.png --duration 8 -w 1344 -h 768 -o ./video.mp4 "<FLF2V preamble plus three-field H3 prompt>"

# Turbo uses the same T2V/I2V/FLF2V prompt contracts
sogni-agent -q --video -m minimax-h3-turbo --duration 8 -w 1344 -h 768 -o ./video.mp4 "<three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-i2v-turbo --ref ./first.png --duration 8 -w 768 -h 1344 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-flf2v-turbo --ref ./first.png --ref-end ./last.png --duration 8 -w 1344 -h 768 -o ./video.mp4 "<FLF2V preamble plus three-field H3 prompt>"

# Reference-to-video (reference order defines the prompt ordinals)
sogni-agent -q --video -m minimax-h3-r2v --ref ./identity.png -c ./wardrobe.png --ref-video ./motion.mp4 --ref-audio ./voice.m4a --duration 8 -w 1344 -h 768 -o ./video.mp4 "<six-field Ref2VA prompt>"
```

When local primary `--ref-audio` is combined with `--audio-start` and/or
`--audio-duration` on MiniMax H3 R2V, the CLI prepares and physically trims the
audio window before upload. The worker receives only that window, and the CLI
does not forward redundant `audioStart` / `audioDuration` project fields. This
avoids worker failures on long source files and makes the attached `<Audio 1>`
the exact waveform-conditioned lip-sync input. Remote audio URLs and additional
audio references keep their existing handling.

## High-Res Video Routing

When the user asks for video in **"hd"**, **"1080p"**, **"4k"**, **"uhd"**, or **"high-res"**, do not use the default WAN video models.

- For **native Seedance 4K / UHD**, use full Seedance with `-m seedance2 --target-resolution 2160`. This is a Premium Spark vendor path; do not use `seedance2-mini`, `seedance2-fast`, or `seedance2-5` for 4K — Mini and Fast cap at 720p, and Seedance 2.5 renders 480p/720p only.
- For **non-vendor HD / 1080p text-to-video**, use `-m ltx25`.
- For **non-vendor HD / 1080p image-to-video**, use `-m ltx25-i2v`.
- Prefer LTX-sized dimensions such as `-w 1920 -h 1088` when the chosen model is LTX.
- For bare named resolutions such as "720p" without orientation or exact pixels, prefer `--target-resolution 768` or the closest requested short side instead of forcing landscape dimensions.
- When the prompt combines a named resolution with an aspect ratio, such as "720p 9:16", let the CLI infer both instead of forcing manual `-w`/`-h` unless the user gave exact pixels.
- If the user explicitly asks for `vertical`, `portrait`, `story`, `reel`, `tiktok`, `square`, or `4:3`, apply the matching dimensions from the **Orientation Mapping** rules instead of defaulting to 16:9.
- Rewrite the user's request using the **LTX-2.x Prompt Rule** only when invoking an LTX model. Do not send short slogan-style prompts to LTX.

## Agent-ready command shapes

```bash
# Native Seedance 4K / UHD text-to-video
sogni-agent -q --video -m seedance2 --target-resolution 2160 -o ./video.mp4 "A polished cinematic product reveal with native ambient sound"

# HD / 1080p text-to-video without the Seedance vendor path: prefer LTX-2.5
sogni-agent -q --video -m ltx25 -w 1920 -h 1088 -o ./video.mp4 "<LTX-rewritten paragraph>"

# HD / 1080p image-to-video without the Seedance vendor path: prefer LTX i2v
sogni-agent -q --video --ref /path/to/image.png -m ltx25-i2v -w 1920 -h 1088 -o ./video.mp4 "<LTX-rewritten paragraph>"

# LTX-2.3 voice identity / persona
sogni-agent --video --reference-audio-identity voice.webm 'NARRATOR: "This is my voice."'

# Seedance 2.0 standard (4-15s vendor video path with native audio)
sogni-agent --video -m seedance2 --duration 8 "A polished product reveal with native ambient sound"

# Seedance 2.5 (4-30s single clips, 480p/720p only — the one Seedance that renders past 15s in one call)
sogni-agent --video -m seedance2-5 --duration 24 "A continuous one-take product story with native ambient sound"
```

Prefer `.webm`, `.m4a`, or `.mp3` voice clips. Local `.wav` clips are normalized
to `.m4a` before upload when `ffmpeg` is available.
