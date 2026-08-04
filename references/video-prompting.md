# Video Prompting Guide (LTX-2.3, MiniMax H3, pacing, orientation, camera language)

Read this before writing any text-to-video or image-to-video prompt for LTX
models, before writing any MiniMax H3 prompt, and whenever the user asks for
"hd", "1080p", "4k", "uhd", or "high-res" video so you can choose between the
LTX and Seedance paths.

Both families take natural cinematic language, but they want different
**shapes**. LTX wants one unbroken prose paragraph with no line breaks and no
negative phrasing. MiniMax H3 wants free-form prose laid out as a timed shot
list, with explicit audio direction and in-prompt negative direction. Do not
carry LTX's single-paragraph, positive-only, no-markup rule into an H3 prompt.
Pick the section that matches the model you are about to invoke.

## LTX-2.3 Prompt Rule

Whenever the chosen video model is `ltx23-22b-fp8_t2v_distilled` (or any LTX
family model), do not pass the user's short request through unchanged. Rewrite
it into an LTX-2.3-safe prompt before calling `sogni-agent`.

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
- Use positive phrasing only. Do not add negative prompts, "no ..." clauses, on-screen text/logo requests, vague filler words like `beautiful` or `nice`, or structural markup such as `[DIALOGUE]`. **This positive-only, no-markup rule is scoped to the LTX family only.** MiniMax H3 is the opposite on both counts: it responds unusually well to in-prompt negative direction ("no music, no slow motion") and to plain bracketed timecodes such as `[0-3 seconds]`, and any markup the user wrote themselves must be preserved rather than stripped — see [MiniMax H3 Prompting](#minimax-h3-prompting).
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

Write H3 prompts as **natural cinematic prose**. There is no required structure,
no field names, and no mandatory tags. Still expand a one-line user request into
a fully directed scene — H3 rewards detail and punishes slogans — but expand it
in plain English, the way you would brief a DP and a sound designer.

Applies to `minimax-h3` / `minimax-h3-t2v`, `minimax-h3-i2v`, and
`minimax-h3-flf2v` (worker ids `minimax-h3-fl2va-fp8_t2v`,
`minimax-h3-fl2va-fp8_i2v`, `minimax-h3-fl2va-fp8_flf2v`), and — with one extra
rule about reference tags — to `minimax-h3-r2v` (worker id
`minimax-h3-ref2va-fp8_r2v`). See
[MiniMax H3 reference-to-video (r2v)](#minimax-h3-reference-to-video-r2v) below
before writing an r2v prompt.

### Why this guidance is natural-language-first

The H3 tool contract accepts ordinary prompt text and does not require a tagged
IR wrapper. Use natural cinematic prose by default. MiniMax's tagged dialogue
and three-field IR forms remain valid optional inputs, so preserve them when a
user supplies them; see
[Optional / advanced: MiniMax's IR markup](#optional--advanced-minimaxs-ir-markup).

### Fixed model facts

- **24 fps, always.** Do not pass an fps override.
- **Frame counts sit on the `124 + n×17` grid**, from `124` through `362` —
  i.e. **5.17 s to 15.08 s**. The CLI snaps `--duration` onto that grid; an
  off-grid explicit `--frames` is a hard error.
- **Dimensions divisible by 32**, total pixels ≤ **1,032,192**. Use
  `-w 1344 -h 768` (landscape) or `-w 768 -h 1344` (portrait).
- **20 steps, guidance/CFG 1, distilled.** Do not send steps, guidance, sampler,
  scheduler, or a **negative prompt**. The checkpoint is CFG-distilled with
  guidance locked at 1, so there is no negative branch at all: a
  `negativePrompt` parameter is ignored wherever it is accepted. Negative
  direction goes in the prompt text instead.
- **Native 32 kHz stereo audio is generated jointly with the picture.** Every
  sound — dialogue, foley, ambience, score — exists only because the prompt
  asked for it. `generateAudio=false` strips that generated track from the
  delivered file; it does not skip audio generation.
- **Sogni's H3 is the 768p-class open-weights release.** Do not offer or claim
  2K; MiniMax's 2K stage is hosted-only and is not part of the open release.
- **Prompt length:** fal documents up to **7,000 characters** for H3, and timed
  shot lists get long. The Sogni CLI does not truncate. If the surface you are
  writing for caps prompts shorter than that, flag the cap explicitly rather
  than silently trimming a shot list.
- The initial Sogni release is routed to 32 GB-class workers.

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

### How to write an H3 prompt

In priority order.

**1. Write natural cinematic prose.** No required structure, no field names, no
tags. Open with the setting, the look, and who is in frame, then direct what
happens. Every detail should be something visible or audible.

**2. Use a timed shot list for anything longer than a single beat.** Plain
bracketed timecodes — `[0-2 seconds] …`, `[2-5 seconds] …` — one beat per
bracket, in order, covering the whole duration. **This is the single
highest-leverage technique for H3.** It fixes pacing and prevents slideshow
drift, where a long clip decays into a sequence of near-still poses. Keep the
beat count proportional to length: roughly one beat per 2-4 seconds, not a
montage.

**3. Direct the audio as deliberately as the picture.** Name the ambience, the
specific spot effects, and the music by instrumentation and timing ("bring in
the low beat at 3 seconds", "sparse upright bass, no drums"). Plain labels
inside the prose work well and read naturally — `Audio:`, `Sound design:`, or
`BGM:` on their own line. Say explicitly when you want **no music**; left
unsaid, H3 will invent some.

**4. Write dialogue as ordinary quoted prose.** Name the speaker, then the line
in double quotes, plus the delivery:
`The pilot says, flat and tired: "AI needs a lot more datacenters."` Preserve
the user's exact words and punctuation — never translate, paraphrase, or clean
them up. Budget roughly 3 words per second plus about 1 second for each
meaningful acting beat or pause; at 10 seconds, two short lines with reactions
is a full clip.

**5. State what you do not want, directly in the prompt text.** Negative
direction is unusually effective on H3 — "no music", "no slow motion", "no lens
flare", "no on-screen text", "do not change her jacket". There is no
negative-prompt field to put it in, so it belongs in the prose, usually as a
short closing line.

**6. Lock identity by naming concrete features, and give every reference image
an explicit job.** "Use the first frame for the character; keep her olive
jacket, chin-length dark hair, and the red vinyl seat." For `flf2v`, describe
the *motion path* between the two images rather than describing two static
frames. Reference images are the identity anchor — restate the features you
need preserved instead of assuming the model will hold them.

**7. Use real camera and film vocabulary.** Lens ("35mm", "long lens"), movement
("slow push-in", "handheld tracking follow", "static"), exposure and stock
("blown-out window highlights", "16mm grain"). Describe transitions as physical
events rather than named editing effects: "a passing truck fills the frame and
the next scene is already on the other side of it" beats "wipe transition".

### Worked example — text-to-video

```text
User ask: "10 second video of a barista and a customer arguing about oat milk"

sogni-agent -q --video -m minimax-h3 --duration 10 -w 1344 -h 768 -o ./cafe.mp4 "<prompt below>"
```

```text
A narrow espresso bar on a weekday morning, shot on a 35mm lens. Soft window
light from the left rakes across a brushed-steel machine and a glass pastry
case. Live-action, unstylized, slightly desaturated.

[0-3 seconds] Medium two-shot. A barista in her late twenties slides a small
white cup across the counter. A customer in a grey overcoat, mid-forties, stops
the saucer with two fingers. The camera pushes in slowly. He says, quiet and
clipped: "I asked for oat milk."

[3-7 seconds] Close-up over his shoulder, static. She lifts the oat carton,
turns it upside down to show it is empty, and sets it back on the wood. Flat,
even delivery: "We ran out at six this morning."

[7-10 seconds] Back to the two-shot. His jaw tightens, he pulls the cup toward
himself, and steam curls past his face while she turns to the next ticket.

Audio: low cafe room tone under everything, a steam wand hissing at 1 second,
ceramic clinking on the saucer, the hollow knock of the empty carton on wood at
5 seconds, a chair leg dragging behind them. Dialogue is close and dry, no
reverb. No music.

No slow motion, no lens flare, no on-screen text.
```

### Worked example — image-to-video

```text
User ask (with an uploaded portrait): "have her look up and say she's not going back"

sogni-agent -q --video -m minimax-h3-i2v --ref ./portrait.png --duration 6 -w 768 -h 1344 -o ./reply.mp4 "<prompt below>"
```

```text
Use the reference image as the first frame and keep the woman exactly as she is:
dark chin-length hair, olive canvas jacket, the red vinyl seatback behind her,
and the rain-streaked window to her right on a night bus.

[0-2 seconds] Static medium close-up. She lowers her phone into her lap and
lifts her gaze from her hands to the window. Passing sodium streetlights slide
across her cheek and wash out her reflection in the glass.

[2-4 seconds] She says, low and unhurried, barely above the engine: "I'm not
going back."

[4-6 seconds] She turns her head a few degrees toward the aisle, sets her jaw,
and closes one hand around the strap of the bag in her lap. The camera holds.

Sound design: steady diesel drone and the rattle of the bus frame throughout,
rain ticking on the glass, canvas shifting as she moves, one air-brake hiss near
the end. BGM: two widely spaced piano notes over sustained low strings, fading
out before the last second.

One continuous shot, no cuts. Do not change her hairstyle, jacket, or the seat
colour.
```

Round the brackets to whole seconds even though the grid rarely delivers one:
`--duration 6` renders 141 frames (5.88 s) and `--duration 10` renders 243
frames (10.13 s). H3 reads the shot list as pacing, not as a frame-accurate
edit decision list, so the last bracket does not need to match the delivered
length exactly.

### Optional / advanced: MiniMax's IR markup

MiniMax also defines a tagged intermediate format. Treat it as optional: useful
occasionally, never required, and **never strip a user's own markup if they
wrote it** — pass it through verbatim.

Where it can still earn its place: many speakers who need to stay distinct
across cuts, non-English dialogue where an explicit language tag removes
ambiguity, and speech that must survive a cut or run past the end of the clip.

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

**Shot markers and the camera vocabulary.** In the IR format, `[Shot 1]` opens
with the overall style and initial composition and takes no timestamp; every
later shot opens with a strictly increasing cut time — `[Shot 2] At 00:03.500,
the camera cuts to …` (also `the shot cuts to` / `transitions to` / `changes
to` / `switches to`). The IR's camera motion types are `Zoom In/Out`, `Push
In/Pull Out`, `Pan Left/Right`, `Truck Left/Right`, `Tilt Up/Down`, `Pedestal
Up/Down`, `Arc Shot`, `Tracking Shot`, `Static Shot`, `Shake
Slightly/Strongly`, `POV`, and `Roll Clockwise/Counterclockwise`, optionally
qualified `with small amplitude` / `with large amplitude` and `at slow speed` /
`at fast speed`. These are good words to use in plain prose too — a timed shot
list with `[0-3 seconds]` timecodes carries the same information without the
markers.

**The three-field IR document.** MiniMax's rewriter emits an optional alignment
line, a blank line, then exactly three labelled fields in this order:

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
deliberately silent video. Writing this document by hand is supported but buys
nothing over the prose examples above.

**Alignment instruction lines (i2v / flf2v only).** These pin a reference image
to a timestamp. Plain-English reference jobs ("use the reference image as the
first frame") work as well in Sogni's testing, but the verbatim lines are
available when a precise timestamp matters. Text-to-video has no alignment line.

Image-to-video (`minimax-h3-i2v`, one `--ref`):

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

First frame → last frame (`minimax-h3-flf2v`, `--ref` plus `--ref-end`). Note
the bare `Picture 1` / `Shot 1` with **no** angle or square brackets, and the em
dash (`—`) with a space on each side:

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

`N` is the index of the actual final shot (`Shot 1` for the usual single-shot
transition), and `S.SS` is the effective duration to exactly two decimal places
— `10.13` for 243 frames at 24 fps (243 ÷ 24 = 10.125, rounded up).

### MiniMax H3 reference-to-video (r2v)

`minimax-h3-r2v` conditions on a whole **reference set** rather than one or two
locked frames: up to **9 reference images** (at least one is required),
**3 reference videos** (24 fps, 2–15 s, each with an optional soundtrack) and
**3 standalone audio clips**, **12 files maximum in total**. It runs a separate
ref2va checkpoint, so it is never inferred — it must be chosen by name with
direct CLI `-m minimax-h3-r2v` or the `generate_video` tool's
`videoModel="minimax-h3-r2v"` (including callers such as Sogni Chat). Direct CLI
uses `--ref` then repeatable `-c` for images, plus repeatable `--ref-video` and
`--ref-audio` for those modalities. Reference videos and
audio are additions to the image set, never replacements for it, and r2v has no
frame anchors at all — for a locked opening frame use `minimax-h3-i2v`, and for a
first-to-last-frame transition use `minimax-h3-flf2v`.

Everything else on this page still applies — natural cinematic prose, the timed
shot list, deliberate audio direction, in-prompt negative direction, and no
negative-prompt field. r2v adds exactly one rule on top.

**Reference grammar.** References are numbered **from 1 per type**, in the order
images → videos → standalone audio, and H3's text encoder splices a literal label
in front of each one before your prompt text (`"<Picture i>: "`, `"<Video k>: "`,
`"<Audio j>: "`). Write the prompt with the same tags, **angle brackets
included**, so the sentence about a reference shares a token sequence with that
reference's own label:

- `<Picture 1>` … `<Picture 9>` for images
- `<Video 1>` … `<Video 3>` for videos
- `<Audio 1>` … for audio

Rewrite any alias the user typed — "image 2", "the second photo", `@Image2`,
`[Image 2]` — into `<Picture 2>`. This is deliberately **not** the Seedance
grammar: Seedance uses `@Image1` / `@Video1` / `@Audio1` (see the Seedance
reference modes in `models.md`), and the two must never be mixed. Never invent a
reference that was not attached, never mention file names, URLs or asset indices,
and never renumber the ones you were given.

Two ordinal traps:

- Numbering restarts per type, so the first image is `<Picture 1>` even when a
  video was attached before it.
- A reference video with sound contributes an `<Audio j>` of its own, counted
  immediately **before** its `<Video k>`. One soundtracked video plus one
  standalone clip means the soundtrack is `<Audio 1>` and the standalone clip is
  `<Audio 2>`.

**One explicit job per reference.** H3 blends everything it is shown unless told
what to take from where, so give every attached reference a single,
non-overlapping job in a plain sentence, and say who wins when two disagree. An
unassigned reference is the most common cause of identity drift and washed-out
style on this model.

Worked example — 3 images, 1 soundtracked video, 1 standalone audio clip (6
files):

```text
<Picture 1> is the identity reference for the woman: her face, her bone
structure, and her hairstyle carry over exactly, and nothing else from that
frame does. <Picture 2> is the wardrobe reference: the dark red jacket, its
collar, and the way it hangs — take the garment, not the person wearing it.
<Picture 3> is the location, lighting palette, and film texture: the wet street,
the sodium and neon colour, the grain. Do not copy any person, vehicle, or
signage from <Picture 3>. Use <Video 1> only for the camera movement — the slow
handheld push-in and its timing — and take nothing else from it; <Audio 1> is
that clip's own soundtrack and is reference only, do not reproduce it.
<Audio 2> is the voice character for her single line: dry, low, close-miked.
Where <Picture 1> and <Picture 3> disagree on colour or exposure, <Picture 1>
wins on her face and <Picture 3> wins on everything behind her.

[0-3 seconds] She walks toward camera along the rain-slicked street, hands in
the jacket pockets. Handheld medium shot, shallow focus, neon reflections
sliding across the wet asphalt.

[3-6 seconds] She stops and glances back over her shoulder as a bus passes
behind her, its headlights sweeping across her face.

[6-8 seconds] Medium close-up, street lights blooming behind her. She says,
quietly: "It was never going to be the last train."

Audio: steady rain on asphalt, tyres hissing through standing water, a bus
engine passing left to right at 4 seconds. No music.
```

Trim assignments for references that were not actually attached — a tag with
nothing behind it is noise. And do not reorder or drop a reference after the
prompt is written: submission order is ordinal order, so every later tag would
then point at the wrong file.

### Agent-ready H3 command shapes

```bash
# Text-to-video (landscape)
sogni-agent -q --video -m minimax-h3 --duration 10 -w 1344 -h 768 -o ./video.mp4 "<H3 prose prompt>"

# Image-to-video from one first frame (portrait)
sogni-agent -q --video -m minimax-h3-i2v --ref ./first.png --duration 8 -w 768 -h 1344 -o ./video.mp4 "<H3 prose prompt naming the reference image's job>"

# First frame -> last frame transition
sogni-agent -q --video -m minimax-h3-flf2v --ref ./first.png --ref-end ./last.png --duration 8 -w 1344 -h 768 -o ./video.mp4 "<H3 prose prompt describing the motion path between the two frames>"

# Reference-to-video (reference order defines the prompt ordinals)
sogni-agent -q --video -m minimax-h3-r2v --ref ./identity.png -c ./wardrobe.png --ref-video ./motion.mp4 --ref-audio ./voice.m4a --duration 8 -w 1344 -h 768 -o ./video.mp4 "<H3 prose assigning jobs to <Picture 1>, <Picture 2>, <Video 1>, and <Audio 1>>"
```

## High-Res Video Routing

When the user asks for video in **"hd"**, **"1080p"**, **"4k"**, **"uhd"**, or **"high-res"**, do not use the default WAN video models.

- For **native Seedance 4K / UHD**, use full Seedance with `-m seedance2 --target-resolution 2160`. This is a Premium Spark vendor path; do not use `seedance2-mini` or `seedance2-fast` for 4K.
- For **non-vendor HD / 1080p text-to-video**, use `-m ltx23-22b-fp8_t2v_distilled`.
- For **non-vendor HD / 1080p image-to-video**, use `-m ltx23-22b-fp8_i2v_distilled`.
- Prefer LTX-sized dimensions such as `-w 1920 -h 1088` when the chosen model is LTX.
- For bare named resolutions such as "720p" without orientation or exact pixels, prefer `--target-resolution 768` or the closest requested short side instead of forcing landscape dimensions.
- When the prompt combines a named resolution with an aspect ratio, such as "720p 9:16", let the CLI infer both instead of forcing manual `-w`/`-h` unless the user gave exact pixels.
- If the user explicitly asks for `vertical`, `portrait`, `story`, `reel`, `tiktok`, `square`, or `4:3`, apply the matching dimensions from the **Orientation Mapping** rules instead of defaulting to 16:9.
- Rewrite the user's request using the **LTX-2.3 Prompt Rule** only when invoking an LTX model. Do not send short slogan-style prompts to LTX.

## Agent-ready command shapes

```bash
# Native Seedance 4K / UHD text-to-video
sogni-agent -q --video -m seedance2 --target-resolution 2160 -o ./video.mp4 "A polished cinematic product reveal with native ambient sound"

# HD / 1080p text-to-video without the Seedance vendor path: prefer LTX-2.3
sogni-agent -q --video -m ltx23-22b-fp8_t2v_distilled -w 1920 -h 1088 -o ./video.mp4 "<LTX-rewritten paragraph>"

# HD / 1080p image-to-video without the Seedance vendor path: prefer LTX i2v
sogni-agent -q --video --ref /path/to/image.png -m ltx23-22b-fp8_i2v_distilled -w 1920 -h 1088 -o ./video.mp4 "<LTX-rewritten paragraph>"

# LTX-2.3 voice identity / persona
sogni-agent --video --reference-audio-identity voice.webm 'NARRATOR: "This is my voice."'

# Seedance 2.0 standard (4-15s vendor video path with native audio)
sogni-agent --video -m seedance2 --duration 8 "A polished product reveal with native ambient sound"
```

Prefer `.webm`, `.m4a`, or `.mp3` voice clips. Local `.wav` clips are normalized
to `.m4a` before upload when `ffmpeg` is available.
