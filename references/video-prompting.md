# Video Prompting Guide (LTX-2.x, MiniMax H3, Seedance, WAN 2.2, Wan 3, pacing, orientation, camera language)

Before writing any video prompt, run `sogni-agent prompt-guide <model> --mode
<mode>` for the model and mode you are about to run (free and offline), and read
that model's section below. Read [High-Res Video Routing](#high-res-video-routing)
whenever the user asks for "hd", "1080p", "4k", "uhd", or "high-res" video.
Direct CLI mode runs no model-aware prompt shaper: the model reads the words you
write (Wan 3 is the exception; see its section). So those rules are the only
shaping your prompt gets. Each section ends with the rules Sogni's own prompt
writer uses for one mode, generated from `@sogni-ai/sogni-intelligence-client`;
`sogni-agent prompt-guide` prints the same rules for every mode. Some of them
speak to that writer ("the base request", "output only the rewritten prompt"):
read the base request as your user's request.

The families require different prompt **shapes**. LTX wants plain present-tense
prose (in text-to-video, one sentence per shot) with no markup and no negative
phrasing. MiniMax H3 requires the
official ordered-field rewrite contract, shot notation, speaker IDs, dialogue
tags, and mode-specific alignment preamble. Seedance wants a director's shot
brief with one job per `@Image1` / `@Video1` / `@Audio1` reference and
time-coded beats. Do not carry one family's rules into another's prompt. Pick
the section that matches the model you are about to invoke:

- LTX-2.5 and the LTX-2.3 rollback models: [LTX-2.x Prompt Rule](#ltx-2x-prompt-rule).
- MiniMax H3, every tier: [MiniMax H3 Prompting](#minimax-h3-prompting).
- Seedance 2.0, Mini, Fast and 2.5, uncensored variants included: [Seedance Prompting](#seedance-prompting).
- WAN 2.2: [WAN 2.2 Prompting](#wan-22-prompting).
- Wan 3 and Wan 3.0 Enhanced: [Wan 3 Prompting](#wan-3-prompting).
- HappyHorse 1.1: [HappyHorse 1.1 Prompting](#happyhorse-11-prompting).

Set the clip length yourself on every video command (`--duration`, or Wan 3's
`--smart-duration`). Without it, the CLI counts every double-quoted span in the
prompt as dialogue, signs and title text included, and can lengthen the clip to
fit it; vendor models bill per second.

If the creator asks only for a prompt, the requested text is the final
deliverable: author it in the selected model's native shape without invoking
the CLI or hosted API. A request to generate/write a prompt does not authorize
media generation. A compound request that also asks to render or make the
video now does authorize execution after the prompt is shaped. This applies to
every video model and workflow, not only the families documented below. The
target model and mode are required. If either is omitted, ask for it. If that
exact model/mode has no validated native contract (the sections listed above
are the validated ones), say so and ask for the exact target or that model's
own published prompt guide;
never substitute a generic prompt or another model's syntax.

## LTX-2.x Prompt Rule

Whenever the chosen video model is LTX-2.5 (`ltx25-*`, including the default
text-to-video and first/last-frame models) or an LTX-2.3 rollback model
(`ltx23-*`, 10Eros), do not pass the user's short request through unchanged.
Rewrite it into an LTX-safe prompt before calling `sogni-agent`. The shape and
length differ by version and mode: print the rules for the one you will run
(`sogni-agent prompt-guide ltx25 --mode i2v`); both versions' text-to-video rules
are generated in full at the end of this section.

- **Text-to-video (LTX-2.5 and LTX-2.3): one sentence per shot**, each with exactly one shot type (extreme wide, wide, medium, medium close-up, close-up, or extreme close-up). When the user has not asked for cuts, write one continuous shot and invent no cut, montage, or scene jump. When they ask for shots, keep every one in their order and open every sentence after the first with its cut time, for example `At exactly 3 seconds, a hard cut switches to a close-up of the captain as he shouts "Hard to port!"`. Copy any cut times the user gave; otherwise space the cuts so every shot is seen. A single newline between shot sentences is allowed.
- **Image-to-video and first/last-frame render one continuous take.** On LTX-2.5 the prompt opens exactly on the supplied image in one or two short sentences (a last-frame-only clip instead ends on it); on LTX-2.3 it is one paragraph of short sentences about what happens next, each simultaneous change in its own sentence. If the user asked for a cut on one of these, say so instead of dropping it silently.
- Follow the length in the printed rules, but never drop, merge, or shorten a requested detail to meet it.
- No bullet points, section labels, tag lists, Markdown, or screenplay formatting.
- Begin with action or visual detail, never "The scene opens", "We see", or "There is". In text-to-video that is the shot scale plus the scene's visual identity, its environment, time of day, textures, and specific light sources; in the image modes the frame already shows them, so start on the first motion.
- Keep people, clothing, props, and locations concrete and stable across the whole prompt.
- Give each shot one main action thread from start to finish. In an LTX-2.5 one-sentence shot, connectors like `as`, `while`, and `then` keep the motion reading as one continuous filmed moment.
- Be specific and literal about motion. Describe what moves, where it moves,
  what it contacts, and what happens next in chronological order. Do not replace
  visible actions with euphemisms or broad summaries. For example, replace "a
  ball bouncing around" with "A red ball moves right, bounces off the wall,
  and returns to the center"; replace "fluid pouring" with "Water flows from
  the left container through the connecting tube into the right container
  until both levels are equal."
- Treat native audio as part of the scene design: quoted dialogue plus the one
  or two most important foley or ambient sounds, woven in with the actions that
  produce them, and music only when the user asks for it.
- Write dialogue out verbatim in double quotes and identify the speaker and
  delivery. Never merely suggest dialogue with phrases such as "they talk,"
  "she says something," or "the couple discusses the scene."
- Budget spoken dialogue at about 3 words per second, plus about 1 second for each meaningful acting beat or pause.
- Express emotion through visible physical cues such as posture, grip, jaw tension, breathing, or pacing. Ambient sound can be woven into the prose naturally.
- Use positive phrasing only. Do not add negative prompts, "no ..." clauses, vague filler words like `beautiful` or `nice`, or structural markup such as `[DIALOGUE]`. **This positive-only, no-markup rule is scoped to the LTX family only.** MiniMax H3 has no separate negative-prompt input and instead requires its ordered fields, `[Shot N]` notation, `(Sx)` speaker IDs, and `<d>` dialogue tags; see [MiniMax H3 Prompting](#minimax-h3-prompting).
- Keep any visible text the user asks for (a sign, a title card, a label) exactly as written, in double quotes after `reads`: `a neon sign above the door reads "OPEN ALL NIGHT"`. Add no text, logos, or captions they did not ask for.
- Fit every action the user names into the clip, in order. Add actions of your own only to fill out a thin request (see Duration-Aware Pacing below). If the named actions cannot all finish on screen in the requested length, say so and suggest a longer clip; never drop one silently.
- Preserve the user's request and enrich it only with observable detail. Do not invent a different story just to make the prompt longer.

### Duration-Aware Pacing

When a request is thin and you are filling it out, size what you add to the clip length so the prompt stays filmable:

- About `1-4s`: about 1 action or moment.
- About `5-8s`: about 2 sequential actions.
- About `9-12s`: about 3 sequential actions.
- Longer clips: add only a small number of additional sequential beats. Do not turn the prompt into a montage or a full story arc unless the duration clearly supports it.

These counts limit what you add, never what you keep: every action the user named stays in the prompt.

### Orientation Mapping

When the user explicitly asks for an orientation or aspect ratio, map it to safe LTX dimensions:

- `vertical`, `portrait`, `story`, `reel`, `tiktok` -> `-w 1088 -h 1920`
- `landscape`, `horizontal`, `widescreen`, `youtube`, `16:9` -> `-w 1920 -h 1088`
- `square`, `1:1` -> `-w 1088 -h 1088`
- `4:3 portrait` -> `-w 832 -h 1088`
- `4:3 landscape` -> `-w 1088 -h 832`

### Camera Language Normalization

When the user uses loose camera language, turn it into one concrete film move, at the pace the request implies, inside the prose prompt:

- `zoom in` -> `push-in`, or `crash zoom` when the moment is sudden
- `zoom out` -> `pull-back`
- `pan left` / `pan right` -> `pan left` / `pan right`, or `whip pan` for a fast reveal
- `orbit` / `circle around` -> `orbit` (`arc left` / `arc right`), or `fast arc` around fast action
- `follow` -> `tracking shot`

Add `slow` or `fast` only when the request or its action implies it: a quiet portrait can take a slow push-in and a chase a fast tracking shot. A crash zoom or whip pan the user named stays one.

### Example rewrite

```text
User ask: "video of a woman in a neon alley"

LTX-2.5 text-to-video, one shot, so one sentence: "A medium shot frames a woman in her 30s in a dark trench coat standing in a rain-soaked neon alley at night, violet and amber signs reflecting across the wet pavement and steam drifting from a street vent behind her, as she turns toward the camera and steps forward with one hand tightening around her bag strap while the camera pushes in on her set jaw, rain tapping on a metal fire escape and a distant train humming through the block."
```

<!-- BEGIN GENERATED PROMPT GUIDE: ltx-2.5 -->
<!-- Generated by npm run sync:prompt-guides from @sogni-ai/sogni-intelligence-client 4.23.0; edit the rules there, not here. -->

### Sogni's prompt rules: ltx-2.5

`sogni-agent prompt-guide ltx25 --mode t2v` prints the rules Sogni's own prompt writer uses for LTX 2.5 text-to-video, shown in full below. Print the guide for the mode you will run before writing its prompt:

| Mode | Guide | Command |
| --- | --- | --- |
| `t2v` | LTX 2.5 text-to-video | `sogni-agent prompt-guide ltx25 --mode t2v` |
| `i2v` | LTX 2.5 first-frame image-to-video | `sogni-agent prompt-guide ltx25 --mode i2v` |
| `l2v` | LTX 2.5 last-frame image-to-video | `sogni-agent prompt-guide ltx25 --mode l2v` |
| `flf` | LTX 2.5 first-and-last-frame video | `sogni-agent prompt-guide ltx25 --mode flf` |
| `a2v` | LTX 2.5 audio-to-video | `sogni-agent prompt-guide ltx25 --mode a2v` |
| `ia2v` | LTX 2.5 image-and-audio-to-video | `sogni-agent prompt-guide ltx25 --mode ia2v` |
| `v2v` | LTX 2.5 video-to-video | `sogni-agent prompt-guide ltx25 --mode v2v` |

```text
# LTX 2.5 text-to-video

Guide: ltx-2.5 t2v
Models: ltx25

Each rule below is quoted from the system prompt Sogni's own prompt writer uses for this model and mode, so some rules speak to that writer about its base request or user message.

## Rules

Begin immediately with action or visual detail. Never begin with "The scene opens", "We see", or "There is". Describe only objective, visible, and audible facts; express emotion through observable face, posture, gesture, performance, and voice rather than inferred intent.

Include the visual details needed to identify the subject, setting, action, continuity, and requested style. Prefer concrete nouns and motion verbs. Faithfully enrich an underspecified request with observable motion, weather or environmental interaction, key material cues, and visible identity anchors, but never replace or bury a requested beat. When a human appears, preserve their distinguishing visible features consistently. Never infer ethnicity, nationality, religion, or culture.

Give every requested shot one sentence and exactly one clear shot type (extreme wide shot, wide shot, medium shot, medium close-up, close-up, or extreme close-up). Add at most one camera motion or subject-relative viewpoint when it materially clarifies that shot. Read the request in whatever language and wording it uses. If it specifies multiple shots, scenes, or cuts, preserve all of them in order and begin every sentence after the first with an explicit transition such as "At exactly 2.5 seconds, a hard cut switches to..." Preserve requested transition types and copy every requested timestamp verbatim in numeric notation; never spell a numeric timestamp out as words. When no cut time was supplied but clip duration is known, place simple numeric cut times that divide the requested shots evenly enough for every shot to be seen. When the user does not explicitly request multiple shots, scenes, or cuts, or asks for one continuous take in any wording, write one continuous shot and do not invent a cut.

Keep sound concise: preserve exact quoted dialogue in its original language plus the one or two most important environmental, foley, or requested music cues. If the request asks, in any language or wording, for silence, a muted clip, or no sound, describe that silence and add no sound; otherwise include the sounds the scene makes. Never invent dialogue when the request does not imply speech, talking, singing, or conversation. Preserve exact quoted dialogue, visible text, proper nouns, and product or brand spelling.

Describe strict chronological, real-time flow and keep every requested action in motion. Use detailed but bounded prose with one sentence per shot; a single newline between shot sentences is allowed. Do not use bullets, headings, labels, JSON, preamble, or Markdown. Target 35-65 words per shot, usually 60-100 words for a single-shot request, and stay under 70 words per shot (under 140 words for one or two shots) so every cut still reads. When the request itself is longer than that, keep all of it: never drop, merge, or shorten a requested detail to meet a length target, and trim only your own additions. If the user wrote in another language, write the visual prompt in English while retaining exact dialogue and visible text in the requested language.

Preserve requested visual style and production value without adding new objects, people, actions, dialogue, shots, or story events. When the user did not specify a rendering style, describe the look the request implies (for example phone footage, home video, documentary, animation, or film) in concrete terms, and do not add generic quality words.

## Model notes

- Keep LTX 2.5 prompts detailed but bounded: preserve production-ready input, faithfully enrich observable identity, motion, and environment, describe the look the request implies rather than adding generic quality words, target 35-65 words per shot, and stay under 70 words per shot (under 140 words for one or two shots) without dropping any requested detail.
- Give every requested shot one sentence and one clear shot type; preserve every requested transition and copy exact cut times in numeric notation, and do not invent cuts when the request asks, in any language or wording, for one continuous take.
- Preserve exact quoted dialogue and visible text, retain only the most important synchronized ambience and foley, describe silence when the request asks for silence or no sound, and never invent dialogue unless speech, talking, singing, or conversation is requested.
- For I2V, match the attached first frame exactly and use one continuous take. For FLF, ground both endpoint images and describe a physically coherent continuous transition between them.
- Use the standard T2V, I2V/FLF, A2V, or IA2V workflow that matches the supplied assets.
- FLF uses the I2V public model ID with a separate first/last-frame template.
- Fast, HQ, and Pro currently use the release-validated official Distilled/Turbo workflow. Dev checkpoints are withheld from public routing until upstream publishes and Sogni validates an official ComfyUI Dev recipe.
- V2V supports canny, depth, pose, detailer, inpaint, and outpaint through the validated Distilled path. LTX 2.5 pose requires both a source video and a still reference image for the subject appearance.
- The pinned official control templates supply their compatible Union Control or In/Outpainting IC-LoRA internally.
- Do not attach LTX 2.3-only voice ID-LoRA, community transition LoRA, or 10Eros assets.
```

<!-- END GENERATED PROMPT GUIDE: ltx-2.5 -->

<!-- BEGIN GENERATED PROMPT GUIDE: ltx-2.3 -->
<!-- Generated by npm run sync:prompt-guides from @sogni-ai/sogni-intelligence-client 4.23.0; edit the rules there, not here. -->

### Sogni's prompt rules: ltx-2.3

`sogni-agent prompt-guide ltx23 --mode t2v` prints the rules Sogni's own prompt writer uses for LTX 2.3 text-to-video, shown in full below. Print the guide for the mode you will run before writing its prompt:

| Mode | Guide | Command |
| --- | --- | --- |
| `t2v` | LTX 2.3 text-to-video | `sogni-agent prompt-guide ltx23 --mode t2v` |
| `i2v` | LTX 2.3 first-frame image-to-video | `sogni-agent prompt-guide ltx23 --mode i2v` |
| `flf` | LTX 2.3 first-and-last-frame video | `sogni-agent prompt-guide ltx23 --mode flf` |
| `a2v` | LTX 2.3 audio-to-video | `sogni-agent prompt-guide ltx23 --mode a2v` |
| `ia2v` | LTX 2.3 image-and-audio-to-video | `sogni-agent prompt-guide ltx23 --mode ia2v` |
| `v2v` | LTX 2.3 video-to-video | `sogni-agent prompt-guide ltx23 --mode v2v` |

```text
# LTX 2.3 text-to-video

Guide: ltx-2.3 t2v
Models: ltx23

Each rule below is quoted from the system prompt Sogni's own prompt writer uses for this model and mode, so some rules speak to that writer about its base request or user message.

## Rules

Begin immediately with action or visual detail. Never begin with "The scene opens", "We see", or "There is". Describe only objective, visible, and audible facts; express emotion through observable face, posture, gesture, performance, and voice rather than inferred intent.

Include the visual details needed to identify the subject, setting, action, continuity, and requested style. Prefer concrete nouns and motion verbs. Faithfully enrich an underspecified request with observable motion, weather or environmental interaction, key material cues, and visible identity anchors, but never replace or bury a requested beat. When a human appears, preserve their distinguishing visible features consistently. Never infer ethnicity, nationality, religion, or culture.

Give every requested shot one sentence and exactly one clear shot type (extreme wide shot, wide shot, medium shot, medium close-up, close-up, or extreme close-up). Add at most one camera motion or subject-relative viewpoint when it materially clarifies that shot. Read the request in whatever language and wording it uses. If it specifies multiple shots, scenes, or cuts, preserve all of them in order and begin every sentence after the first with an explicit transition such as "At exactly 2.5 seconds, a hard cut switches to..." Preserve requested transition types and copy every requested timestamp verbatim in numeric notation; never spell a numeric timestamp out as words. When no cut time was supplied but clip duration is known, place simple numeric cut times that divide the requested shots evenly enough for every shot to be seen. When the user does not explicitly request multiple shots, scenes, or cuts, or asks for one continuous take in any wording, write one continuous shot and do not invent a cut.

Keep sound concise: preserve exact quoted dialogue in its original language plus the one or two most important environmental, foley, or requested music cues. If the request asks, in any language or wording, for silence, a muted clip, or no sound, describe that silence and add no sound; otherwise include the sounds the scene makes. Never invent dialogue when the request does not imply speech, talking, singing, or conversation. Preserve exact quoted dialogue, visible text, proper nouns, and product or brand spelling.

Describe strict chronological, real-time flow and keep every requested action in motion. Use detailed but bounded prose with one sentence per shot; a single newline between shot sentences is allowed. Do not use bullets, headings, labels, JSON, preamble, or Markdown. Target 35-65 words per shot, usually 60-100 words for a single-shot request, and stay under 70 words per shot (under 140 words for one or two shots) so every cut still reads. When the request itself is longer than that, keep all of it: never drop, merge, or shorten a requested detail to meet a length target, and trim only your own additions. If the user wrote in another language, write the visual prompt in English while retaining exact dialogue and visible text in the requested language.

Preserve requested visual style and production value without adding new objects, people, actions, dialogue, shots, or story events. When the user did not specify a rendering style, describe the look the request implies (for example phone footage, home video, documentary, animation, or film) in concrete terms, and do not add generic quality words.

## Model notes

- For first/last-frame generation, focus on what changes instead of redescribing static frame contents.
- Use short present-tense sentences with concrete camera, action, lighting, and audio cues.
- Keep quoted dialogue within the clip duration budget.
```

<!-- END GENERATED PROMPT GUIDE: ltx-2.3 -->

## MiniMax H3 Prompting

For MiniMax reference-to-video, default to **Balanced R2V** (`minimax-h3-r2v-balanced`), the tier that passes the quality bar for mature content and holds Mystic X at full strength (as of 2026-10). Use `minimax-h3-r2v-balanced-2stage` for two-stage, 1080p or 2K output. Keep Standard, LightX2V Turbo, or FastH3 Omni R2V only when explicitly requested.

Write every H3 prompt using MiniMax's official structured rewrite contract. Do
not substitute an unstructured prompt for the required fields. The field names,
order, shot notation, alignment preamble, reference labels, and dialogue markup
are part of the model contract.

For prompt-only authoring, return only the applicable ordered-field document.
Do not wrap it in Markdown, add a title or preamble, append generic prompting
tips, explain the format, offer to generate the video, or ask a follow-up
question after the contract. Those additions make the text invalid as direct
H3 input.

Applies to Standard `minimax-h3` / `minimax-h3-t2v`, `minimax-h3-i2v` for both
opening-frame I2VA and closing-frame L2VA, and `minimax-h3-flf2v`; their 8-step
Balanced `*-balanced` and 4-step Turbo `*-turbo` variants; and—with its own
six-field contract—to `minimax-h3-r2v`, `minimax-h3-r2v-balanced`,
`minimax-h3-r2v-turbo`, and FastH3 Reference `minimax-h3-fasth3-r2v-turbo`. The
exact FL2VA worker ids are `minimax-h3-fl2va-fp8_{t2v,i2v,flf2v}` with an
optional `_balanced` or `_turbo` suffix; Ref2VA uses `minimax-h3-ref2va-fp8_r2v`
with the same tier suffixes, and FastH3 Reference uses
`minimax-h3-fastvideo-omni-int8_r2v_turbo`. See
[MiniMax H3 reference-to-video (r2v)](#minimax-h3-reference-to-video-r2v) below
before writing an r2v prompt.

This guidance follows MiniMax's official H3 prompt-writing skill from
[MiniMax-H3 commit d21241f](https://github.com/MiniMax-AI/MiniMax-H3/tree/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing).

### Fixed model facts

- **24 fps, always.** Do not pass an fps override.
- **Frame counts sit on the `124 + n×17` grid**, from `124` through `362` —
  i.e. **5.17 s to 15.08 s**. The CLI snaps `--duration` onto that grid; an
  off-grid explicit `--frames` is a hard error.
- **Dimensions divisible by 32**, total pixels ≤ **1,032,192**. Use
  `-w 1344 -h 768` (landscape) or `-w 768 -h 1344` (portrait). The exception
  is `minimax-h3-r2v-turbo`: at most **522,240** pixels, its own canvas, so use
  `-w 960 -h 544` or `-w 544 -h 960`; larger requests are fitted inside it.
- **1080p and 2K output is the FastH3 Two-Stage model, not a canvas.**
  `-m minimax-h3-fasth3-turbo-2stage` (or `minimax-h3-fasth3-t2v-turbo-2stage`,
  `minimax-h3-fasth3-i2v-turbo-2stage`, `minimax-h3-fasth3-flf2v-turbo-2stage`)
  renders FastH3 on a half-size canvas and delivers the clip at exactly twice
  it with the same length and audio; apart from Ref2VA Two-Stage (below), no
  other H3 tier delivers above 768p.
  `--target-resolution` names the delivered size: `2K` (or `1440`, the default)
  renders 1344×768 → 2688×1536, `1080` renders 960×544 → 1920×1088, and `720`
  renders 672×384 → 1344×768, in the prompt's or reference's aspect; any other
  value is refused. Do not enlarge `-w`/`-h` to reach 2K — the pixel budget
  still applies to the canvas. 1080p costs 10 Spark per second (FastH3's 4 plus
  6), 2K costs 16 (plus 12), and 720p costs the FastH3 rate of 4. Use it
  when the user asks for 1080p, 1440p or 2K H3 output, two-stage, or the
  sharpest H3 output; ordinary 768p stays on the regular FastH3 selectors. The
  prompt contract is FastH3's.
- **1080p and 2K reference-to-video is Ref2VA Two-Stage.**
  `-m minimax-h3-r2v-2stage` (Standard, 20 steps),
  `-m minimax-h3-r2v-balanced-2stage` (Balanced, 8 steps) and
  `-m minimax-h3-fasth3-r2v-turbo-2stage` (FastH3 Reference) take exactly the
  references, limits, durations, LoRAs and six-field Ref2VA prompt contract of
  `minimax-h3-r2v` / `minimax-h3-r2v-balanced` / `minimax-h3-fasth3-r2v-turbo`,
  render the half-size canvas and deliver twice it. `--target-resolution` reads as above (2K default, `1080`,
  `720`); a reference image never sets the canvas aspect. Each bills its
  tier's reference rate plus the two-stage surcharge of the delivered class;
  quote it with `--estimate-video-cost`. Keep ordinary 768p reference video on
  the one-stage R2V selectors.
- **20 steps for Standard; 8 for Balanced; 4 for both Turbo engines; guidance/CFG 1.** Do not
  send steps, guidance, scheduler, or a **negative prompt**. Standard and
  Balanced accept no sampler override; Balanced is fixed to Euler/simple.
  FL2VA H3 Turbo defaults to `er_sde` on Socket, and
  the CLI omits the sampler unless `--sampler` is passed. Direct FL2VA CLI A/B tests
  may pass exactly `--sampler euler`, `--sampler er_sde`, or
  `--sampler sa_solver`. Ref2VA Turbo uses the exact upstream Euler/simple recipe,
  defaults to 960×544, and accepts only `--sampler euler`. The checkpoint is CFG-distilled with
  guidance locked at 1, so there is no negative branch at all: a
  `negativePrompt` parameter is ignored wherever it is accepted. Exclusions go
  in the prompt text as positive facts (`the hall is empty`).
- **Balanced and Turbo use the same prompt contract as Standard H3.** Balanced
  is fixed at 8 steps with Euler/simple; Turbo is fixed at 4 steps with the
  `simple` scheduler. Existing `minimax-h3-turbo` / `minimax-h3-*-turbo`
  selectors are the LightX2V engine and retain the three sampler variants above.
  FastH3 is the separate FastVideo VSA engine: use
  `minimax-h3-fasth3-turbo`, `minimax-h3-fasth3-t2v-turbo`,
  `minimax-h3-fasth3-i2v-turbo`, or `minimax-h3-fasth3-flf2v-turbo`.
  FastH3 uses Euler/simple only and is about 2x faster than LightX2V Turbo and up
  to 6x faster than Standard for comparable 768p, 15-second requests. Its
  reference-to-video is FastH3 Reference, `minimax-h3-fasth3-r2v-turbo`, which
  uses the six-field Ref2VA contract and takes no sampler override.
- **Native 32 kHz stereo audio is generated jointly with the picture.** Every
  sound — dialogue, foley, ambience, score — exists only because the prompt
  asked for it. `generateAudio=false` strips that generated track from the
  delivered file; it does not skip audio generation.
- **FastH3 audio-to-video takes the user's own audio instead.**
  `minimax-h3-fasth3-ia2v-turbo` (`--ref` + `--ref-audio`),
  `minimax-h3-fasth3-flfa2v-turbo` (`--ref` + `--ref-end` + `--ref-audio`) and
  `minimax-h3-fasth3-a2v-turbo` (`--ref-audio` only), plus their `-2stage`
  forms, drive the picture from the uploaded track and deliver that track as
  the soundtrack. Keep the same ordered-field contract, with the I2V or FLF2V
  preamble when frames are supplied. Write the words actually spoken in the
  upload, exactly, inside `<d>[Language] …</d>` with their `(Sx)` speaker so the
  mouth follows the right text, and describe the uploaded sound in the sound
  fields rather than requesting different audio. `--audio-start` picks the
  window; its length is the clip length. No LoRAs; see
  [models.md § FastH3 audio-to-video](./models.md#fasth3-audio-to-video).
- **Intermediate keyframes pin extra images at chosen times.** Repeatable
  `--keyframe <image>@<seconds>` (up to 8) works on the image-to-video,
  first/last-frame, Sound to Video, and Ref2VA selectors, in addition to
  `--ref` / `--ref-end`. The prompt names each keyframe `<Picture N>` and, since
  H3's text encoder never sees keyframe images, describes each one at its time; see
  [Intermediate keyframes](#intermediate-keyframes) below.
- **Sogni's H3 tiers render the 768p-class open-weights release.** Only FastH3
  Two-Stage delivers 1080p or 2K (Sogni's own latent enlargement); do not claim
  either for any other H3 selector. MiniMax's hosted 2K stage is not part of
  the open release.
- The Sogni CLI does not truncate H3 prompts. If another surface has a shorter
  cap, flag it explicitly instead of silently removing required fields.
- FL2VA/Balanced/Turbo and image-only R2V are routed to 32 GB-class workers;
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

### Standard, Balanced, and Turbo contract: T2V, I2V, L2V, and FLF2V

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
The record-store owner with a warm, gravelly voice, a plain American accent and an easy pace (S1) says: <d>[English] I kept this one behind the counter for you.</d>
```

Do not translate, paraphrase, or clean up the user's dialogue. If the user
explicitly requests speaking, dialogue, lyrics, or a vocal performance but
supplies no words, author one concise line that realizes that request. If there
is no vocal intent, do not invent speech. Use a compound ID such as `(S1,S2)`
only when already-numbered speakers vocalize together.

### Writing the body the way the Base model reads it

Audited 2026-09-10 against MiniMax's `VIDEO_PROMPT_WRITING_GUIDE_base_en.md`
(the guide the h3-prompt-writing skill wraps) and the LightX2V rewriter that
was trained on the same rewrite policy. The open-weights H3-Base checkpoint
reads the prompt directly with no hosted Context-IR rewrite in front of it, so
every sentence is model input. Everything below is what the official examples
do and never deviate from:

- **Open `[Shot 1]` with the medium and look as concrete facts** (`Live-action,
  cinematic`, `2D-animated`, `3D CG`, `claymation`, `watercolor`, `vintage
  film`) plus the initial composition. In frame-anchored modes derive the look
  from the picture. Genre, mood, audience, and intent labels (`horror`, `eerie`,
  `adult`, `tense`, `jump scare`) are not visible and never appear in an
  official example; write the light, surfaces, distances, movements, and sounds
  that produce them.
- **Every sentence is a depiction.** The guide's rule is that every detail must
  correspond to something visible or audible. Never write notes to the model
  (`preserve believable anatomy`, `keep the foley prominent`, `hard cut, no
  morph or dissolve`, `hold six frames only`, `this anchor is excluded from the
  presentation`) and never shout in capitals.
- **State exclusions as positive facts.** There is no negative field and the
  contract has no negation grammar, so `no people, faces or words` names the
  things it tries to remove. Write `the hall is empty and still`, `the walls are
  bare`, `the air is clear and sharply lit`. Keep a user-supplied exclusion only
  when it cannot be stated positively, phrased once. `non_diegetic_music: N/A`
  is the reliable way to keep score out even when the rest of the structure is
  loose.
- **Clock times exist only on cut markers.** `[Shot 2] At 00:03.500, the camera
  cuts to …` is the only place a time appears. Inside a shot, order events with
  words (`early in the shot`, `as the doors part`, `toward the end`). In-shot
  ranges such as `From 00:02.000 to 00:04.000` are not H3 syntax; the shaper now
  flags them.
- **Camera moves use the official vocabulary** as natural prose: `Zoom In/Out`,
  `Push In/Pull Out`, `Pan Left/Right`, `Truck Left/Right`, `Tilt Up/Down`,
  `Pedestal Up/Down`, `Arc Shot`, `Tracking Shot`, `Static Shot`, `Shake
  Slightly/Strongly`, `POV`, `Roll Clockwise/Counterclockwise`, with `with
  small/large amplitude` and `at slow/fast speed` only when they matter. One
  primary move per shot. First-person coverage is a `POV shot`; `handheld` reads
  as camera shake, so write it only when shake is wanted.
- **Frame-anchored modes describe the path, not the pictures.** The model sees
  every attached picture; describing one back at length, or adding objects,
  text, fluids, or figures that are not in it, produces crossfades and invented
  props. I2VA: first-frame anchor → action onset → continuous development →
  result or reaction. FL2VA: first-frame state → observable intermediate
  changes → progressively narrowing differences → last-frame state, preferring
  **one continuous shot** and cutting only when the user asks or the context
  calls for it (see Beats and voices below); begin `in the
  position and framing established by Picture 1`, carry the identity anchors
  that must stay fixed into the motion sentences, and end by arriving `on the
  pose, spacing, and composition established by Picture 2 at the end of the
  shot`, still moving at the action's own pace. L2VA: plausible preceding
  state → explicit action and transition path → gradual convergence in the
  final shot → last-frame landing on `<Picture 1>`.
  Exact composition matching applies only at a picture's assigned timestamp.
- **Bind every vocal line to its speaker in the same sentence:**
  `The young woman with a quiet, breathy voice (S1) says: <d>[English] I get
  off at the next station.</d>` and `The two children (S1,S2) shout together,
  <d>[English] Wait for us!</d>`.
- **Length.** Official bodies run roughly 150–450 words; Ref2VA
  `detailed_description` targets 350–500. Long is fine when every sentence is a
  visible or audible event.

### Beats and voices (2026-09-11 review lessons)

Tested on a branching horror route the same day, on top of the rules above:

- **One continuous shot is still the default.** In most cases it is preferred
  and the shot count stays as low as the content allows. What made the slow
  takes boring was emptiness, not the lack of cuts: when the user leaves pacing
  open, something new should happen every 1.5–2.5 seconds inside the shot (an
  action, a reaction, a reveal, a line) drawn from the request rather than
  empty walking or waiting, never a new event or line invented only to fill
  time.
  Walking, waiting, or stillness the user asks for keeps its requested length.
- **Beats and multi-shot are tools for when the context calls for them.** A
  chase, a reveal that needs a new viewpoint, an exchange of lines, a jump in
  space or time: then cut (`[Shot 2] At 00:01.500, the camera cuts to …`),
  keep continuous motion inside each shot, and let the final shot cut to the
  Picture 2 composition and hold with a live action, which lands cleanly where
  a long interpolation would crossfade. Never cut a simple movement into
  pieces, and if both pictures share one camera position the camera does not
  move at all (a curtain dropping needs a static shot, not a tracking shot
  away).
- **Write physical acts as acts.** A fall is the rail giving, the wall of
  windows streaking upward, the ground rushing in. A bite is the jaws snapping
  shut over the picture. A shove is two palms filling the frame. "His lips
  part as he bends closer" produced no bite; "You brought it back" followed by
  a cut to an aftermath still produced no fall.
- **Describe the voice, not just the mood.** At a speaker's first line give
  accent, pitch, timbre and speaking rate: `The woman (S1), speaking in a
  plain American accent with a light, mid-pitched voice at a quick, breathless
  pace, says: <d>[English] …</d>`. "A bright, breathless voice" alone drifted
  to a British accent between takes.
- **A recurring character keeps one voice, word for word.** Write each speaking
  character's voice once (their reference clip if they have one, plus one fixed
  wording) and paste it verbatim into every clip they speak in. With a Seedance
  voice reference, say "Jean's voice is exactly @Audio1." once and "Jean, in his
  own voice exactly @Audio1," before each of his lines, and add no accent or
  language words: a fresh description ("plain American English") pulls the take
  off the reference, and the character sounds like a different person from clip
  to clip. Delivery (quiet, gritted) goes after the tag. Judge by ear, played
  right after an approved line.
- **Dialogue after the action that motivates it.** She says "That's my dad"
  after she has picked the photograph up, in the shot where she holds it.
- **Whose hands.** In first-person coverage say whose hands are in frame
  ("both his palms fill the frame as he shoves"); "hands seizing the front of
  the cardigan" was rendered as the attacker's own point of view.

### Worked example — first frame → last frame

```text
User ask (two uploaded stills): "the elevator doors open onto the laundry and we walk in"

sogni-agent -q --video -m minimax-h3-flf2v-balanced --ref ./elevator.png --ref-end ./laundry.png --duration 8 -w 1344 -h 768 -o ./press-b.mp4 "<prompt below>"
```

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 8.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a POV shot at standing eye level begins in the position and framing established by Picture 1, facing the closed brass elevator doors from inside the small wood-panelled vestibule with its dark red velvet panels, marble floor and crystal ceiling lamp. Early in the shot the lamp flickers twice and the floor shudders as the car settles. The brass doors slide apart with a slow steady motion, and bright white fluorescent light from beyond spills across the marble floor and the brass door frame. Through the widening gap the long white-tiled laundry hall comes into view: the raised tiled walkway with steel rails, the row of round steel washing-machine doors along the left wall, and the open steel service door with its amber wall lamp at the far right. The camera pushes in with large amplitude at slow speed through the open doorway, the brass frame sliding out of the picture on both sides as the tiled floor takes over the foreground and the red brake lever comes into view at the near left. Toward the end the differences narrow as the camera glides forward and arrives on the composition, spacing and lighting established by Picture 2 at the end of the shot, with the machines still, the grey curtains hanging straight and the hall empty and quiet.

overall_soundscape: A low electrical hum from the crystal lamp, a muffled cable groan and a soft mechanical shudder as the car settles, then the smooth metallic slide of the brass doors parting. Beyond the doors an even ventilation hum and the buzz of fluorescent tubes grow louder over slow footsteps that move from marble onto tile.

non_diegetic_music: N/A
```

### Worked example — text-to-video

```text
User ask: "10 second video of a barista and a customer arguing about oat milk"

sogni-agent -q --video -m minimax-h3 --duration 10 -w 1344 -h 768 -o ./cafe.mp4 "<prompt below>"
```

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, slightly desaturated, a medium two-shot frames a narrow espresso bar on a weekday morning. Soft window light rakes across the brushed-steel machine and pastry case. A barista in her late twenties slides a white cup across the counter. A customer in a grey overcoat with a quiet, clipped voice, a plain American accent and a quick pace (S1) stops the saucer with two fingers and says: <d>[English] I asked for oat milk.</d> [Shot 2] At 00:03.000, the camera cuts to a static close-up over the customer's shoulder. The barista with a flat, even voice, a light British accent and a measured pace (S2) lifts the oat carton, turns it upside down, sets it on the wood, and says: <d>[English] We ran out at six this morning.</d> [Shot 3] At 00:07.000, the camera cuts back to the two-shot. The customer tightens his jaw and pulls the cup toward himself while steam curls past his face and the barista turns to the next ticket.

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

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a static medium close-up begins exactly from <Picture 1>, preserving the woman's dark chin-length hair, olive canvas jacket, red vinyl seatback, and the rain-streaked night-bus window. She lowers her phone into her lap and lifts her gaze toward the window as sodium streetlights slide across her cheek. The woman with a low, unhurried voice and a plain American accent (S1) says: <d>[English] I'm not going back.</d> She turns slightly toward the aisle, sets her jaw, and closes one hand around her bag strap while the camera remains static.

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
- MiniMax documents stable dialogue support for Arabic, Chinese, English,
  French, German, Italian, Japanese, Korean, Portuguese, Russian, and Spanish,
  with varying support for additional languages. This list is advisory, not a
  validation allowlist: preserve the user's actual language. Write its language
  name in square brackets, e.g. `<d>[Japanese] …</d>`.
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
internals, not documented author-facing prompt markup. Never "repair" them by
globally deleting pipe characters. Rewrite the meaning: caption boundaries and
their contents become exact visible text in English double quotes; lyrics
boundaries become an ordinary `<d>[Language] exact words</d>` block with the
singer and delivery outside it; and `<|cutoff|>` becomes plain `<cutoff>`.
Plain `<caption_start>`, `<caption_end>`, `<lyrics_start>`, and `<lyrics_end>`
are not valid substitutes. If a generated draft still leaks one of these forms,
warn and make one bounded semantic repair attempt, then keep the best non-empty
structured prompt rather than blocking generation.

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

**Alignment instruction lines (i2v / l2v / flf2v only).** These exact preambles pin
reference images to the target timeline. They are mandatory for those modes and
must be the first line, followed by one blank line. T2V has no preamble.

Image-to-video (`minimax-h3-i2v` or `minimax-h3-i2v-turbo`, one `--ref`):

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

Last-frame-only video (`minimax-h3-i2v` or `minimax-h3-i2v-turbo`, one
`--ref-end`; there is deliberately no separate L2V selector):

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

`N` is the actual final shot. Infer a plausible earlier state and describe the
continuous action, object state, camera, light, and composition converging on
the supplied closing frame at the snapped `S.SS` endpoint.

First frame → last frame (`minimax-h3-flf2v` or
`minimax-h3-flf2v-turbo`, `--ref` plus `--ref-end`). Note the bare `Picture 1`
and `Shot 1` with **no** angle or square brackets, and the em dash (`—`) with a
space on each side:

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

`N` is the index of the actual final shot (`Shot 1` for the usual single-shot
transition; FL2VA favours one continuous shot and cuts when the user asks or the context calls for it),
and `S.SS` is the effective duration to exactly two decimal places — `10.13` for
243 frames at 24 fps (243 ÷ 24 = 10.125, rounded up).

### MiniMax H3 reference-to-video (r2v)

`minimax-h3-r2v` conditions on a whole **reference set** rather than one or two
locked frames: up to **9 reference images**,
**3 reference videos** (24 fps, 2–15 s, each with an optional soundtrack) and
**3 standalone audio clips** (2–15 s each), **12 files maximum in total**.
The 24 fps requirement applies to the reference files themselves: normalize any
other frame rate without changing duration before submission, or H3 will
time-distort the visual reference relative to its soundtrack.
Reference-video duration totals may not exceed 15 seconds, and standalone
reference-audio duration totals may not exceed 15 seconds. It runs a separate
ref2va checkpoint, so it is never inferred — the Standard, Balanced, Turbo, or
FastH3 Reference selector must be chosen by name with direct CLI
`-m minimax-h3-r2v*` or `-m minimax-h3-fasth3-r2v-turbo`, or the
`generate_video` tool's matching `videoModel` (including callers such as Sogni
Chat). Direct CLI
uses `--ref` then repeatable `-c` for images, plus repeatable `--ref-video` and
`--ref-audio` for those modalities. At least one visual reference (image or
video) is required. A reference video can be the only visual input; audio alone
is invalid. r2v
has no frame anchors at all—for
a locked opening frame use `minimax-h3-i2v`, and for a first-to-last-frame
transition use `minimax-h3-flf2v`. Ref2VA can still pin stills strictly inside
the clip with `--keyframe`; those are not references, but each is named
`<Picture N>` after the reference pictures (see
[Intermediate keyframes](#intermediate-keyframes)).

Ref2VA does not use the three-field Standard contract. Write exactly these six
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
asset. `summary` begins with one or more exact task types: `keyframe completion`,
`reference generation`, `video editing`, `video continuation`, `audio reuse`,
or `audio reference`. Join multiple types with exactly ` + ` and never repeat
one. Choose tasks from the reference's assigned job, not merely because a file
is attached. A direct video-editing summary begins its body exactly `The target
video is an edited version of <Video 1>.` `retention_analysis` gives one line
per label using the official relationship values, such as `fully_preserved`,
`partially_preserved`, `attribute_transfer`, or `weak_reference` for visual
content and `fully_copy`, `partially_copy`, `reference`, or `weak_reference` for
audio. `detailed_description` is the shot-by-shot target-video timeline and
uses the same `[Shot N]`, `(Sx)`, and `<d>[Language] ...</d>` rules as Base H3.

**Immutable soundtrack rule.** If the user asks for the same, specific,
original, or trending song/soundtrack—or choreography tied to that audio—the
source signal and timeline are locked. Never generate a substitute, loose
imitation, remix, recomposition, or copyright-avoidance melody/lyric change.
Use `audio reuse` in `summary`, assign every locked `<Audio N>` `fully_copy` in
`retention_analysis`, name it directly in `non_diegetic_music`, and put the
source action onset/beat times in `detailed_description`. `audio reference`
means H3 may generate a new signal and is valid only when the user explicitly
wants style, timbre, rhythm, or delivery guidance rather than the original
track. A generative request cannot guarantee waveform identity, so the final
exact-song deliverable must stream-copy/remux the original audio after render.
Soundtrack identity and choreography timing are separate: Ref2VA is loose
conditioning, not an edit-level timing guarantee. If exact movement timing is
mandatory, use a pose/edit-controlled workflow or stop before paid generation.

**Reference grammar.** Reference assets are numbered from 1 independently per
type. Use the exact angle-bracket labels:

- `<Picture 1>` … `<Picture 9>` for images
- `<Video 1>` … `<Video 3>` for videos
- `<Audio 1>` … for audio

Visible people, objects, scenes, or effects reused from an image or video become
`<Subject N>` entries whose definitions cite their source asset. Reserve
`<Picture N>` for a concrete frame or storyboard relationship, `<Video N>` for
a whole-video edit, continuation, camera, cut, rhythm, or temporal relationship,
and `<Audio N>` for a standalone audio asset or a reference-video soundtrack.
Every soundtracked reference video contributes an `<Audio N>` ordinal before
standalone audio clips; probe the files and use the runtime's reported order so
the soundtrack cannot bind to the wrong label.

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

**Source-shot edits.** When the user asks to transform an attached source shot,
use `video editing` and the exact edited-version opening above. Ref2VA carries
the source through the ordinary video reference input; it needs no extra SDK
edit flag. For appearance replacement, mark `<Video N>` `partially_preserved`:
list the camera, scene, positions, action and timing that stay, and the identity,
hair, clothing or body attributes that change. Do not mark the whole source
`fully_preserved` just because its motion or framing is retained.

Define the replacement subject from its image references, with face and wardrobe
pictures assigned to the correct person. The replaced performer supplies the
performance, not a second retained visible identity. Keep original clothing only
when requested. Define untouched performers separately. If the replacement
resembles an existing performer, explicitly state the final subject count and
distinct positions so the image does not bind only to the existing match.

For a new shot borrowing motion, use `reference generation` and state the
transferred attributes and requested identity/setting. Neither task label
guarantees pixel-exact preservation or exact choreography. `video continuation`
still needs an actual continuation workflow. Use I2VA, L2VA, or FL2VA when an
endpoint must be locked.

For voice references, bind the voice to the speaking subject by reusing that
subject's `(Sx)` in `subject_definitions`; do not put the speaker ID in
`retention_analysis`. A timbre/rhythm/emotion/delivery reference must not import
the source recording's words. If the user explicitly asks to reuse or reperform
reference speech, preserve its words and language and mark unintelligible spans
`[unclear]` rather than guessing. A verbal cue embedded in copied background
music can cite `<Audio N>` without an invented speaker ID. Put copied ambience
and effects in `overall_soundscape`, audience-only score in
`non_diegetic_music`, and use both fields when the source contains both.

### Intermediate keyframes

`--keyframe <image>@<seconds>` pins a still image (local path or URL) at an
exact moment inside an H3 clip, in addition to the first and last frame. Repeat
it for up to 8 keyframes. It works on every image-to-video and first/last-frame
selector (Standard, Balanced, Turbo, FastH3, and FastH3 Two-Stage), on the FastH3
Sound to Video selectors (`minimax-h3-fasth3-ia2v-turbo`, `-flfa2v-turbo`,
`-a2v-turbo`, and their `-2stage` forms), and on every Ref2VA selector.
Text-to-video cannot pin keyframes.

- **Timing.** A keyframe lands on frame `round(seconds × 24)`, which must fall
  strictly inside the snapped clip: from 0.1 s to one frame before the last
  (0.1–7.9 s on an 8 s, 192-frame clip). The first and last frames belong to
  `--ref` and `--ref-end`, never to a keyframe, and two keyframes cannot share a
  frame. The CLI refuses anything else and names the range to use; it never
  moves or drops a keyframe.
- **Name each keyframe `<Picture N>` (MiniMax's keyframe format).** Keyframes
  are numbered in time order after the mode's own pictures: after the first
  frame `<Picture 1>` on I2V and IA2V, after the last frame `<Picture 1>` on L2V,
  after `<Picture 1>` (first) and `<Picture 2>` (last) on FLF2V and FLFA2V, from
  `<Picture 1>` on A2V, and after the last reference `<Picture N>` on Ref2VA.
  They are still not references, get no `<Subject N>`, and never count toward
  the reference caps. The word keyframe is allowed.
  - **I2V, L2V, FLF2V, and Sound to Video:** the first line is one alignment
    line listing every picture at its mark (frame ÷ 24, two decimals; the last
    frame at the clip's end), in time order, each credited to the shot on
    screen there. It replaces the I2V and L2V preambles:
    `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 2.88-second mark of the target video.`
  - **Ref2VA:** add `<Picture N> is the keyframe of [Shot M], showing …` to
    `subject_definitions`, `keyframe completion` to the summary task prefix (as
    in `[reference generation + keyframe completion]`), and
    `<Picture N> ([Shot M] keyframe): fully_preserved - …` to
    `retention_analysis`.
  - The shot where a keyframe lands names it: "the shot's keyframe corresponds
    to `<Picture N>`", or, at a cut, `[Shot N] At MM:SS.mmm, the camera cuts to
    …, whose keyframe corresponds to <Picture N>.` (Ref2VA: "the shot cuts to").
- **H3's text encoder never sees the keyframe images.** Only the frame-pinning
  node receives them, so H3 knows what a keyframe shows only from your words:
  describe each one where it lands.
- **Compare each keyframe with the anchor before it** (the first frame or the
  previous keyframe):
  - **Same camera angle, place, and light; only the subjects moved.** Stay in the
    same shot and bring the action to the pose, position, facing, expression,
    and props the keyframe shows, ordered with words (`as she reaches the rail`),
    never with a clock time, and write "the shot's keyframe corresponds to
    `<Picture N>`" where that moment arrives. A tighter framing from the same
    angle can arrive as a push-in.
  - **New camera angle, place, or light.** Start a new shot exactly at its time,
    `[Shot N] At MM:SS.mmm, the camera cuts to …, whose keyframe corresponds to
    <Picture N>`, and open that shot with the
    keyframe's composition: shot size, camera angle, where each subject stands
    and faces, the setting, and the light. An action in progress carries across
    the cut. These cuts apply even when the request prefers one continuous shot,
    and the alignment line's final `Shot N` counts them. If the last frame is
    framed or lit differently from the last keyframe, the final shot cuts to it.
- **Never put two differently framed or lit anchors in one shot.** They
  cross-fade into each other, and a shot described differently from its keyframe
  can flash the keyframe for a single frame.
- **The cut clock** is the keyframe's frame ÷ 24, rounded down to the
  millisecond: `@3.5` is frame 84, `00:03.500`; `@2.3` is frame 55, `00:02.291`.
  The CLI prints each one before rendering (`Keyframe at 00:03.500 (frame 84)`).
- **Sound to Video:** the uploaded audio still drives the performance; keyframes
  pin how the clip looks at their times.
- **Framing and price.** Each keyframe is centre-cropped onto the clip's canvas
  like the last frame, so use stills with the clip's aspect ratio. Two keyframes
  are included in the price; each additional keyframe adds a little output time
  (see [models.md § MiniMax H3 keyframes](./models.md#minimax-h3-keyframes)).

Worked example — the courier leaves the alley (first frame), is inside a
stairwell at 4 s (a new place, so a cut), and reaches the top of the stairs
(last frame, same stairwell and light, so no second cut):

```bash
sogni-agent -q --video -m minimax-h3-fasth3-flf2v-turbo --ref ./alley.png --ref-end ./stair-top.png --keyframe ./stairwell.png@4 --duration 8 -w 1344 -h 768 -o ./courier.mp4 "<prompt below>"
```

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 3 (from Shot 2) aligns with the 4.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 8.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic. In the position and framing established by Picture 1, a bike courier in a yellow rain jacket wheels her bike down a narrow wet alley toward a steel side door while rain drips from the fire escape above. She leans the bike against the brick, hauls the door open, and steps through as the static wide shot holds on the alley. [Shot 2] At 00:04.000, the camera cuts to a low-angle shot inside a bare concrete stairwell lit by a caged orange bulb, whose keyframe corresponds to <Picture 3>: the courier on the bottom step with her helmet in one hand, facing up the stairs. She climbs two steps at a time, one hand sliding along the painted rail, and arrives on the pose, spacing, and composition established by Picture 2 at the end of the shot.

overall_soundscape: Rain patters on metal in the alley, the steel door clangs shut behind her, and her footsteps echo up the stairwell.

non_diegetic_music: N/A
```

### Agent-ready H3 command shapes

```bash
# Text-to-video (landscape)
sogni-agent -q --video -m minimax-h3 --duration 10 -w 1344 -h 768 -o ./video.mp4 "<three-field H3 prompt>"

# Image-to-video from one first frame (portrait)
sogni-agent -q --video -m minimax-h3-i2v --ref ./first.png --duration 8 -w 768 -h 1344 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt>"

# Last-frame-only L2VA reuses the I2V selector
sogni-agent -q --video -m minimax-h3-i2v --ref-end ./last.png --duration 8 -w 768 -h 1344 -o ./video.mp4 "<L2V preamble plus three-field H3 prompt>"

# First frame -> last frame transition
sogni-agent -q --video -m minimax-h3-flf2v --ref ./first.png --ref-end ./last.png --duration 8 -w 1344 -h 768 -o ./video.mp4 "<FLF2V preamble plus three-field H3 prompt>"

# Balanced and Turbo use the same T2V/I2V/L2V/FLF2V prompt contracts
sogni-agent -q --video -m minimax-h3-balanced --duration 8 -w 1344 -h 768 -o ./video.mp4 "<three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-i2v-balanced --ref ./first.png --duration 8 -w 768 -h 1344 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-flf2v-balanced --ref ./first.png --ref-end ./last.png --duration 8 -w 1344 -h 768 -o ./video.mp4 "<FLF2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-turbo --duration 8 -w 1344 -h 768 -o ./video.mp4 "<three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-i2v-turbo --ref ./first.png --duration 8 -w 768 -h 1344 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-i2v-turbo --ref-end ./last.png --duration 8 -w 768 -h 1344 -o ./video.mp4 "<L2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-flf2v-turbo --ref ./first.png --ref-end ./last.png --duration 8 -w 1344 -h 768 -o ./video.mp4 "<FLF2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-fasth3-turbo --duration 8 -w 1344 -h 768 -o ./video.mp4 "<three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-fasth3-i2v-turbo --ref ./first.png --duration 8 -w 768 -h 1344 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-fasth3-flf2v-turbo --ref ./first.png --ref-end ./last.png --duration 8 -w 1344 -h 768 -o ./video.mp4 "<FLF2V preamble plus three-field H3 prompt>"
sogni-agent -q --video -m minimax-h3-fasth3-ia2v-turbo --ref ./first.png --ref-audio ./voice.m4a --duration 8 -o ./video.mp4 "<I2V preamble plus three-field H3 prompt with the uploaded words in <d> tags>"

# Intermediate keyframes: repeat --keyframe <image>@<seconds> (up to 8) on i2v, flf2v, Sound to Video, or Ref2VA
sogni-agent -q --video -m minimax-h3-fasth3-i2v-turbo --ref ./first.png --keyframe ./turn.png@3.5 --keyframe ./wave.png@6 --duration 8 -o ./video.mp4 "<keyframe alignment line plus three-field H3 prompt that names each keyframe <Picture N> where it lands>"

# Reference-to-video (reference order defines the prompt ordinals)
sogni-agent -q --video -m minimax-h3-r2v --ref ./identity.png -c ./wardrobe.png --ref-video ./motion.mp4 --ref-audio ./voice.m4a --duration 8 -w 1344 -h 768 -o ./video.mp4 "<six-field Ref2VA prompt>"
sogni-agent -q --video -m minimax-h3-r2v-balanced --ref ./identity.png -c ./wardrobe.png --duration 8 -w 1344 -h 768 -o ./video.mp4 "<six-field Ref2VA prompt>"
```

When local primary `--ref-audio` is combined with `--audio-start` and/or
`--audio-duration` on MiniMax H3 R2V, the CLI prepares and physically trims the
audio window before upload. The worker receives only that window, and the CLI
does not forward redundant `audioStart` / `audioDuration` project fields. This
avoids worker failures on long source files and makes the attached `<Audio 1>`
the exact waveform-conditioned lip-sync input. Remote audio URLs and additional
audio references keep their existing handling.

<!-- BEGIN GENERATED PROMPT GUIDE: minimax-h3 -->
<!-- Generated by npm run sync:prompt-guides from @sogni-ai/sogni-intelligence-client 4.23.0; edit the rules there, not here. -->

### Sogni's prompt rules: minimax-h3

`sogni-agent prompt-guide minimax-h3 --mode t2v` prints the rules Sogni's own prompt writer uses for MiniMax H3 text-to-video (T2VA), shown in full below. Print the guide for the mode you will run before writing its prompt:

| Mode | Guide | Command |
| --- | --- | --- |
| `t2v` | MiniMax H3 text-to-video (T2VA) | `sogni-agent prompt-guide minimax-h3 --mode t2v` |
| `extend` | MiniMax H3 video continuation (T2VA) | `sogni-agent prompt-guide minimax-h3 --mode extend` |
| `i2v` | MiniMax H3 first-frame image-to-video (I2VA) | `sogni-agent prompt-guide minimax-h3-i2v --mode i2v` |
| `l2v` | MiniMax H3 last-frame image-to-video (L2VA) | `sogni-agent prompt-guide minimax-h3-i2v --mode l2v` |
| `flf` | MiniMax H3 first-and-last-frame video (FL2VA) | `sogni-agent prompt-guide minimax-h3-flf2v --mode flf` |
| `i2v-keyframes` | MiniMax H3 image-to-video with intermediate keyframes (I2VA) | `sogni-agent prompt-guide minimax-h3-i2v --mode i2v-keyframes` |
| `r2v` | MiniMax H3 reference-to-video (Ref2VA) | `sogni-agent prompt-guide minimax-h3-r2v --mode r2v` |
| `ia2v` | MiniMax H3 FastH3 Sound to Video with a first frame (I2VA) | `sogni-agent prompt-guide minimax-h3-fasth3-ia2v-turbo --mode ia2v` |
| `flfa2v` | MiniMax H3 FastH3 Sound to Video with first and last frames (FL2VA) | `sogni-agent prompt-guide minimax-h3-fasth3-flfa2v-turbo --mode flfa2v` |
| `a2v` | MiniMax H3 FastH3 Sound to Video from audio only (T2VA) | `sogni-agent prompt-guide minimax-h3-fasth3-a2v-turbo --mode a2v` |
| `a2v-keyframes` | MiniMax H3 FastH3 Sound to Video from audio with intermediate keyframes (T2VA) | `sogni-agent prompt-guide minimax-h3-fasth3-a2v-turbo --mode a2v-keyframes` |

```text
# MiniMax H3 text-to-video (T2VA)

Guide: minimax-h3 t2v
Models: minimax-h3, minimax-h3-t2v, minimax-h3-t2v-balanced, minimax-h3-fasth3-t2v-turbo

Each rule below is quoted from the system prompt Sogni's own prompt writer uses for this model and mode, so some rules speak to that writer about its base request or user message.

## Rules

This is T2VA: establish the complete video from text with no reference labels or alignment line.

CREATIVE FIDELITY: Preserve the user's specified subjects and ages, relationships, wardrobe, setting, genre, mood, action, shot composition, camera behavior, dialogue, visible text, and exclusions. Enrich only unspecified details that support those choices. Express the requested mood through observable performance, light, texture, and composition without replacing the premise or adding a new story event. Pacing and cinematography suggestions are defaults: an explicit locked camera, held pose, quiet pause, sustained action, or silence takes priority. Keep supplied dialogue and visible text in their original language and wording. Before returning, check the result against the original request and remove additions that contradict it.

CONTEXT PLANNING: before drafting, account for every subject, visible reference, audio reference, user constraint, exact quoted string, shot, sound cue, and music instruction. Resolve conflicts in favor of explicit user wording and state the winning source when attached references conflict. Do not invent brands, references, absences, or story facts. Preserve supplied dialogue character-for-character. If the user explicitly requests speaking, dialogue, lyrics, or a vocal performance but supplies no words, author one concise line that realizes that request. Otherwise do not invent speech.

BASE OUTPUT CONTRACT: output exactly three lowercase field headings, once each, in this order:
integrated_multimodal_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: ...
Do not output JSON, YAML, markdown, bullets, code fences, a preamble, or commentary. Do not add any other field. Structural prose is English; preserve dialogue, lyrics, and visible text in their original language.

SHOT GRAMMAR: [Shot 1] has no timestamp. Every later cut starts exactly "[Shot N] At MM:SS.mmm, ..." using contiguous chronological times within the effective duration. Clock times exist only on cut markers: inside a shot, order events with words (early in the shot, as the doors part, toward the end) and never write "From 00:02.000 to 00:04.000" ranges or per-event clock times. Cut only when the cut adds new subject, space, viewpoint, or time information; otherwise carry the change with camera motion. Put a visual-style preface before [Shot 1] only in Ref2VA detailed_description. For each shot describe subject, action, setting, lighting, composition, and camera movement in filmable prose; add amplitude and speed when they are meaningful.

SCENE: describe only visible or audible facts. [Shot 1] opens with the medium and look as concrete facts (Live-action; 2D-animated; 3D CG; claymation; watercolor; vintage film) and the initial composition; in frame-anchored modes derive that look from the supplied picture. Genre, mood, audience, and intent labels (horror, eerie, romantic, adult, tense, jump scare) are not visible, so never write them: write the light, surfaces, distances, movements, and sounds that produce them. Establish subject appearance and position, environment, props, action, light, weather, and continuity. Keep identity, wardrobe, colors, objects, and spatial relationships stable unless the request changes them.

PHYSICAL PRECISION: the video model reads words literally and may never have seen the action, so describe anatomy, contact, and physical interactions in plain, concrete, almost scientific terms. Say which body part moves, where it starts and ends, how fast and how far it travels, and what touches what. Say how materials look (color, opacity, texture, amount, consistency) and how they behave (flow, drip, stretch, bounce); honey poured from a jar, for example, is a slow, glossy amber ribbon that folds onto itself where it lands. Replace euphemisms, slang, idioms, and genre stock phrases with the literal visible event they stand for, in as much detail as the action needs. Prefer precise everyday words over clinical jargon the model may not know. Keep every specific the user asked for.

DEPICTION ONLY: the prompt is a depiction, not a note to the model. Never write production instructions or meta-commentary (preserve believable anatomy, keep the foley prominent, hard cut with no morph or dissolve, this shot is excluded from the presentation, hold six frames only) and never use capital letters for emphasis. Say what is seen and heard at each moment instead.

PACING: in most cases one continuous shot is preferred, and the shot count stays as low as the content allows. When the user leaves pacing open, prefer a purposeful development every 1.5 to 2.5 seconds: an action, a reaction, a reveal, a line. Preserve requested walking, waiting, stillness, pauses, and sustained actions for their requested duration; do not invent a new event or dialogue just to meet a pacing target. Beats and multi-shot sequences are available when the context calls for them (a chase, a reveal that needs a new viewpoint, an exchange of lines, a jump in space or time): then cut with "[Shot N] At MM:SS.mmm, the camera cuts to ..." and keep continuous motion inside each shot; never cut a simple movement into pieces. Write physical acts as acts, never as suggestions: a fall is the rail giving, the wall streaking upward, the ground rushing in; a bite is the jaws snapping shut; a shove is two palms filling the frame. Place dialogue after the action that motivates it.

KEYFRAME PATHS: the model sees every supplied picture, so never describe a picture back at length and never invent objects, text, fluids, or figures that are not in it. I2VA: first-frame anchor, then action onset, continuous development, and a result or reaction. FL2VA: prefer one continuous shot; write the first-frame state, the observable intermediate changes, the progressively narrowing differences, and the last-frame state; begin "in the position and framing established by Picture 1", carry the identity anchors that must stay fixed into the motion sentences, and reach "the composition established by Picture 2" inside the final shot named by the alignment line. When the context calls for beats (see PACING), cut, and let the final shot cut to the Picture 2 composition and hold with a live action, which lands cleanly where a long interpolation would crossfade. If both pictures share one camera position, the camera does not move at all. L2VA: a plausible preceding state, an explicit action and transition path, gradual convergence in the final shot, and the last-frame landing on <Picture 1>. Apply exact composition matching only at a picture's assigned timestamp.

AUDIO SECTIONS: overall_soundscape is one to four sentences covering diegetic ambience, effects, and spatial continuity; do not repeat dialogue or music there. Use overall_soundscape: N/A only when the requested video is totally silent. non_diegetic_music is one to three sentences describing audience-only score through instrumentation, tempo, rhythm, timing, and dynamic development rather than abstract mood labels; use non_diegetic_music: N/A when there is no score.

SOURCE-LOCKED AUDIO: decide semantically whether supplied audio is immutable before drafting. When the user asks for the same, exact, original, specific, or trending song/soundtrack, or asks to recreate choreography tied to that audio, the source signal and its timeline are immutable. Never invent a replacement track, request a loose imitation, or add a copyright-avoidance melody/lyric substitution unless the user explicitly asks for different music. In Ref2VA use the official audio reuse task, assign every immutable <Audio N> fully_copy, name it directly in the relevant audio section, and preserve its original timing. Ref2VA reference videos must themselves be exactly 24fps; normalize other rates without changing duration or audio timing before submission. Audio reference means a new signal is generated and is valid only when the user explicitly wants loose style/timbre/rhythm guidance. A generative prompt cannot guarantee waveform identity: an exact-song deliverable must stream-copy/remux the original audio after rendering. Choreography lock is separate from soundtrack lock; use explicit action times from the source, and never represent loose Ref2VA conditioning as guaranteed edit-level beat synchronization. If exact choreography timing is mandatory and the chosen workflow cannot guarantee it, stop before paid generation or use a pose/edit-controlled workflow.

DIALOGUE: give every vocal source a stable identifier such as (S1), assigned in order of first vocal event and reused across shots. Put the speaker's identity, ID, action, and delivery outside <d>; put only the language tag and spoken words inside <d>[Language] ...</d>. Preserve user-supplied words, language, and punctuation character-for-character, and speak each supplied line exactly as often as the request does, never again to fill a later shot. If the user explicitly requests speech, dialogue, lyrics, or a vocal performance without supplying words, author one concise line that serves that intent; without vocal intent, do not invent speech. Put combined speakers outside the tag as (S1,S2). Bind every line to its speaker in the same sentence, as in: The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d> and: The two children (S1,S2) shout together, <d>[English] Wait for us!</d> When a speaker first vocalizes, describe the voice itself with its accent, pitch, timbre, and speaking rate (for example "speaking in a plain American accent with a light, mid-pitched voice at a quick, breathless pace"); an unstated accent lets the model pick one, and a voice described only by mood drifts between takes. For voiceover, use the exact phrase "says in an off-screen voiceover" and state immediately after the </d> tag that the on-screen character's lips remain closed. When one line of dialogue or lyrics crosses a cut, place <scenetrans> at the connecting point in both parts (the end of the first <d> block and the start of the next) and explicitly state that the audio continues across the cut; <scenetrans> never appears unpaired. Use <cutoff> when the video ending truncates speech. These are the author-facing spellings from MiniMax's prompt guide; do not emit tokenizer-internal <|...|> markers. Never fix an internal marker by merely deleting its pipe characters: caption markers become exact visible text in double quotes, lyrics markers become an ordinary <d>[Language] ...</d> singing block with the singer and delivery outside it, and <|cutoff|> becomes plain <cutoff>. Visible text is not dialogue: keep it in exact double quotes inside the visual description.

ABSENCES: H3 has no negative-prompt input, and its contract describes only what is visible or audible, so a negation names the very thing it tries to remove. State every exclusion as a positive fact: "the hall is empty and still" instead of "no people", "the walls are bare" instead of "no text or signs", "the air is clear and sharply lit" instead of "no haze", and "non_diegetic_music: N/A" instead of "no music". Never add exclusions the user did not supply and never add a negative_prompt field. Keep a user-supplied exclusion only when it cannot be stated positively, phrased once as a plain statement.

IDENTITY: use concrete visible identity anchors and keep them stable across shots. For frame-anchored modes, preserve the supplied frame's identity, wardrobe, setting, lighting direction, and composition without redundantly cataloguing every pixel.

CAMERA: state shot size and lens when useful. Write camera movement as natural prose from the official vocabulary (Zoom In/Out, Push In/Pull Out, Pan Left/Right, Truck Left/Right, Tilt Up/Down, Pedestal Up/Down, Arc Shot, Tracking Shot, Static Shot, Shake Slightly/Strongly, POV, Roll Clockwise/Counterclockwise), adding "with small amplitude" / "with large amplitude" and "at slow speed" / "at fast speed" only when they matter. Keep one primary move per shot unless the request clearly requires a compound move. First-person coverage is a POV shot; write "handheld" only when the user wants visible shake, because it reads as Shake Slightly or Shake Strongly.

VISIBLE TEXT: place every sign, label, title, or other text that must appear on screen in exact double quotes, preserving the user's spelling, capitalization, punctuation, and language.

TIMEBASE: H3 renders at a fixed 24 fps, 124 to 362 frames on a 17-frame grid (5.17 to 15.08 seconds). Never write frame counts, frame rates, steps, samplers, or a resolution such as 1080p or 2K in the prompt: delivery size is the caller's setting, not something the prompt can ask for.

LENGTH: keep every result under 7000 characters. For Ref2VA, target 350-500 words in detailed_description; do not pad the other five sections. If compression is needed, preserve required fields, user-authored exact text, reference labels and jobs, retention relationships, and shot timing first; shorten redundant adjectives and audio prose. Never silently truncate.

FINAL ASSESSMENT: silently verify the exact field order, required alignment line, reference-label consistency, shot syntax, speaker IDs, dialogue markup, visible-text spelling, duration, source-audio policy, sound ownership, and character limit. Output only the typed prompt after every check passes.

## Model notes

- T2V, I2V, FLF2V, and L2V use exactly three ordered fields: integrated_multimodal_description, overall_soundscape, non_diegetic_music.
- I2V, FLF2V, and L2V prepend MiniMax's exact mode-specific image-alignment line. L2V uses the existing I2V selector with only a typed last-frame asset; minimax-h3-l2v is not a hosted model selector.
- Use [Shot 1] without a timestamp; every later shot uses [Shot N] At MM:SS.mmm, ... .
- Use stable (S1) speaker IDs and wrap exact spoken words in <d>[Language] ...</d>; keep visible text in exact double quotes.
- overall_soundscape owns diegetic ambience and effects; non_diegetic_music owns audience-only score and is N/A when there is none.
- Standard runs 20 steps with res_multistep/simple. Balanced uses fixed 8-step Euler/simple acceleration: LightX2V for FL2VA and Larry v4 for Ref2VA. FL2VA Turbo runs 4 steps with simple scheduling; er_sde is the default sampler, with euler and sa_solver available as explicit A/B variants. Ref2VA Turbo uses the exact upstream 4-step euler/simple recipe. All run at fixed 24 fps and guidance 1.
- Default MiniMax reference-to-video to Balanced R2V (minimax-h3-r2v-balanced), or minimax-h3-r2v-balanced-2stage for two-stage, 1080p or 2K output. Preserve an explicitly requested Standard, LightX2V Turbo, or FastH3 Omni R2V tier.
- Standard, Balanced, and Turbo Ref2VA use exactly six ordered fields: subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music. The two-stage Ref2VA selectors (minimax-h3-r2v-2stage at 20 steps, minimax-h3-r2v-balanced-2stage at 8 steps) write the same six-field contract with the same references; only the delivered size changes. FastH3 Reference (minimax-h3-fasth3-r2v-turbo and its -2stage form, the FastH3 tier's reference-to-video) writes the same six-field contract.
- Ref2VA uses <Subject N> for reusable visible content, <Picture N> only for concrete keyframe/composition anchors, <Video N> for whole-video relationships, and <Audio N> for copied or referenced signals. It requires at least one image or video; audio alone is invalid.
- The FastH3 audio guide on sound_to_video (minimax-h3-fasth3-ia2v-turbo, minimax-h3-fasth3-flfa2v-turbo, minimax-h3-fasth3-a2v-turbo and their -2stage forms) writes the Base contract of its mode: image + audio as I2V, first/last frame + audio as FLF2V, audio only as T2V. The uploaded audio drives the picture from frame 0 and is the soundtrack, so describe what it contains and never add other dialogue or music. Use these selectors only when the user asks for MiniMax H3 or FastH3.
```

<!-- END GENERATED PROMPT GUIDE: minimax-h3 -->

## Seedance Prompting

Applies to Seedance 2.0 (`seedance2`, `seedance2-ia2v`, `seedance2-v2v`), Mini
and Fast (`seedance2-mini`, `seedance2-fast`), Seedance 2.5 (`seedance2-5`,
`seedance2-5-ia2v`, `seedance2-5-v2v`), and the uncensored variants
(`seedance2-5-uncensored`, `seedance2-mini-uncensored`). They all read the same
director-style grammar. Seedance 2.5 widens only the limits: 4-30 s clips and
30 image / 10 video / 10 audio references (50 in all), against 4-15 s and
9 / 3 / 3 (12 in all) for the 2.0 family, and it also accepts audio as the only
reference. Direct mode sends your prompt to the model as written, and there is
no negative-prompt field. The rules Sogni's own prompt writer uses close this
section; `sogni-agent prompt-guide seedance2-5 --mode <mode>` prints the one for
your mode. What follows adds the CLI side and what the rules leave out.
Production lessons (opening frames, sizing people, keyframes, lip-sync, edit
quirks) are in
[models.md § Seedance 2.5 takes in practice](./models.md#seedance-25-takes-in-practice-as-of-2026-11).

### Pick the mode first

- **Reference mode** when people, props, or vehicles must persist through the
  shot: pass every image with `-c` (plus any `--ref-video` / `--ref-audio`) and
  give each one a job in the prompt. On 2.5 the CLI selects
  `--seedance-task-type reference` for you. A lone first frame plus prose lets
  Seedance re-invent whatever leaves that frame: a passenger, a car's wheels, a
  prop.
- **Frame mode** when the opening must be locked or the clip must join another
  one seamlessly: `--ref` is the first frame and `--ref-end` the last. Write no
  `@Image` tags in frame mode and do not redescribe what the frames show beyond
  the few traits that must hold as things move;
  describe the motion that carries the first frame forward, or arrives on the
  last. Add `--ref-end` only when it shows the camera and arrangement the action
  naturally ends on; otherwise Seedance morphs the shot to reach it.
- The two modes cannot be combined; the CLI rejects the mix before billing.
  `--workflow ia2v` is the one exception: there `--ref` is a loose `@Image1`
  beside the audio.
- **Edits are written as edits** (`-m seedance2-5-v2v --seedance-task-type edit
  --ref-video source.mp4 --duration <source seconds>`): open with `Edit
  @Video1.`, name what changes, then what stays, as in `Edit @Video1. Replace the
  red sedan with a teal 1960s convertible. Keep the driver, the street, the camera
  move, and the timing.` A storyboard-style prompt (sections, timed beats) for an
  edit is refused as a video extension. To keep the camera where it is, write `the camera holds
  @Video1's exact framing for the whole clip, one continuous shot`.

### Write the prompt in this order

1. **The shot in one sentence first:** the look, the camera position, and the
   one event, carrying the evidence the shot must land, as in `A low tracking
   shot races alongside a teal convertible at highway speed, palms and
   streetlamps whipping past the lens.`
2. **One job per reference, one sentence each.** Write the tags as `@Image1`,
   `@Video1`, `@Audio1`: numbered from 1 within each type in the order you
   attached them, no brackets or spaces, never a URL or file name. Say whether
   each one is the edit target or only a reference, and what it controls:
   `Use @Image1 for the driver's face and wardrobe.` `Use @Image2 for the car and
   its teal paint.` `Use @Video1 for the camera move and timing only.` `@Audio1 is
   the driver's voice.` A reference without a job leaks its lighting, framing,
   and pacing into the shot. In reference mode the take tends to open on
   `@Image1`'s composition, so when the shot needs a new opening, make a still
   of it, attach it first, and give it that job (`Use @Image1 as the opening
   shot reference.`), with the identity and vehicle references after it.
3. **Time-coded beats** for any clip longer than about 5 seconds (`0–2 s: …`,
   `2–4.5 s: …`), each one a visible physical event and its result: `2–4 s: the
   cruiser clips the rear bumper and the convertible fishtails across both
   lanes, tires smoking.` A 2.5 clip longer than 15 s stays one clip whose beats
   cover its whole length.
4. **One primary camera move** for the shot or beat, kept apart from what the
   subject does: a push-in, a tracking shot, a whip pan, an orbit, a POV, or a
   locked-off static shot when stillness serves it. Never stack moves in one
   sentence. Map loose camera words as in
   [Camera Language Normalization](#camera-language-normalization).
5. **Sound** as plain nouns: engine roar, rain on glass, a siren closing in.
   When speech is wanted, write the exact spoken words in double quotes, name
   the speaker outside them, put no acting words inside them, and say an
   on-screen speaker's lips move with the words: `The driver shouts, "Hold on!",
   his lips moving with the words.` If the user wants speech but gave no words, write the
   line. Add no music they did not ask for. With a voice reference, write
   `The driver's voice is exactly @Audio1.`
6. **Constraints as positive facts:** `both hands stay on the wheel`, `a full
   car length of open road between them`, `the road ahead is empty`, `the logo
   stays crisp and readable`. Write no list of things to avoid: there is no
   negative prompt, and naming a thing brings it into the shot.

### Pace, cuts, text, and length

- **Pace words match the shot.** Slow, smooth, or gradual suit a calm moment.
  Fast action is shown, not stated: what rushes past the lens, the ground
  covered within a beat, impacts and what they knock loose. A number ("90 mph")
  or the word "fast" on its own renders slower than intended. Every quality a
  shot must land (speed, size, weight, danger) is written as what a camera and
  a microphone would capture.
- **Cuts follow the request.** One continuous shot when it describes one
  continuous action, place, or camera move; a new time-coded shot for each cut
  when it asks for cuts or a montage, or moves between places, viewpoints, or
  moments: `4–6 s: cut to a close-up of the driver's hands on the wheel.` In
  frame mode, cut only when asked.
- **On-screen text** the user asks for goes in double quotes after `reads`:
  `the diner sign reads "OPEN ALL NIGHT"`. Spell brand and product names
  exactly.
- **Length:** about 80–150 words for a single-beat shot plus 30–50 for each
  further beat, with no padding. Never drop a beat, a line, a reference job, or
  any detail the user gave to reach a word count; when they will not fit the
  clip, suggest a longer one.

### Worked example: reference-mode chase

```text
User ask: "8 s Seedance 2.5 chase at 1080p: hero-car.png is the hero car, cruiser.png the cop car"

sogni-agent -q --video -m seedance2-5 -c ./hero-car.png -c ./cruiser.png --duration 8 --target-resolution 1080 -o ./chase.mp4 "<prompt below>"
```

```text
A low tracking shot races alongside a teal 1960s convertible down a sunlit coastal highway, palms and guardrail posts whipping past the lens. Use @Image1 for the convertible's body, teal paint, and chrome wheels. Use @Image2 for the black-and-white police cruiser. 0–3 s: the convertible swerves around a delivery van and the cruiser bursts out from behind it two car lengths back, lights flashing. 3–6 s: the cruiser closes to one car length as both cars bank through a long left curve, dust kicking off the shoulder. 6–8 s: the convertible cuts onto an exit ramp and the cruiser overshoots it, braking hard in a cloud of tire smoke. The camera stays low and level with the convertible the whole way. Engine roar, a wailing siren closing in, tires screeching through the curve. The convertible keeps its teal paint and chrome wheels in every frame.
```

<!-- BEGIN GENERATED PROMPT GUIDE: seedance-2.5 -->
<!-- Generated by npm run sync:prompt-guides from @sogni-ai/sogni-intelligence-client 4.23.0; edit the rules there, not here. -->

### Sogni's prompt rules: seedance-2.5

`sogni-agent prompt-guide seedance2-5 --mode t2v` prints the rules Sogni's own prompt writer uses for Seedance 2.5 text-to-video and loose references, shown in full below. Print the guide for the mode you will run before writing its prompt:

| Mode | Guide | Command |
| --- | --- | --- |
| `t2v` | Seedance 2.5 text-to-video and loose references | `sogni-agent prompt-guide seedance2-5 --mode t2v` |
| `i2v` | Seedance 2.5 first-frame image-to-video | `sogni-agent prompt-guide seedance2-5 --mode i2v` |
| `l2v` | Seedance 2.5 last-frame image-to-video | `sogni-agent prompt-guide seedance2-5 --mode l2v` |
| `flf` | Seedance 2.5 first-and-last-frame video | `sogni-agent prompt-guide seedance2-5 --mode flf` |
| `v2v` | Seedance 2.5 video-to-video: edit, extend or reference a source video | `sogni-agent prompt-guide seedance2-5 --mode v2v` |

```text
# Seedance 2.5 text-to-video and loose references

Guide: seedance-2.5 t2v
Models: seedance2-5, seedance2-5-uncensored

Each rule below is quoted from the system prompt Sogni's own prompt writer uses for this model and mode, so some rules speak to that writer about its base request or user message.

## Reference grammar

REFERENCE GRAMMAR: Use BytePlus-style @ tags as the canonical prompt-visible reference labels. Refer to attached assets by 1-indexed counters per modality, written exactly as @Image1, @Video1, or @Audio1 with no brackets and no spaces. Counting is independent per modality and follows attachment order. If the base request uses aliases such as Image 1, Video 2, Audio 1, @Image 1, or @Video 2, normalize them to @Image1, @Video2, or @Audio1 in the rewritten prompt. Never mention reference URLs or asset IDs.

## Rules

REFERENCE ROLE DISCIPLINE: Assign every useful reference asset a clear creative role. Do not write vague phrases like "use the attached files." State whether each useful file is an edit target or only a reference. Use role language such as "Use @Image1 as the character identity reference," "Use @Image2 for wardrobe and color palette," "Use @Video1 for camera movement and action timing only," or "Use @Audio1 as the rhythm and background music guide."

DIRECTORIAL BRIEF: Write like a concise director's shot brief, not a static image caption. Include concrete physical interactions, motion timing, mood, lighting, and sound cues that help the model understand both what the scene looks like and how it changes over time. Turn each quality the shot must convey, such as speed, size, weight, danger or feeling, into what a camera and microphone would capture at real-world proportions, because the model renders what it can see and hear, not a number or an adjective.

PROMPT ANATOMY: Include task intent, reference-role assignments, subject/action, scene, camera, style/lighting, audio behavior, continuity, and any final message only when needed. For multi-beat clips, use compact time-coded beats or shot-script phrasing instead of a dense unordered list.

CAMERA AND PHYSICS: Prefer one primary camera move. Separate subject motion from camera motion. Describe pace in words that match the shot instead of technical camera settings: slow, smooth, gradual, or controlled for calm moments; for fast action, show the speed through what rushes past the camera, the ground covered within a beat, and impacts with their consequences, because a stated speed or the word "fast" alone renders slower than intended. Ground action in physical details such as fabric movement, reflections, dust, water, contact, momentum, and object interaction when relevant.

POSITIVE CONSTRAINTS: Prefer positive preservation language over negative-only phrasing. Say "Keep the logo crisp and readable," "Maintain the same face structure, outfit, silhouette, and proportions from @Image1," and "Keep every person, prop and color consistent from the first frame to the last."

SHOTS: Use one continuous shot when the request describes one continuous action, place or camera move, and separate shots when it asks for cuts or a montage or moves between places, viewpoints or moments. Open each new shot with its own time-coded beat that names the cut, such as "4-7s: Cut to a close-up of ...".

SPEECH: Write every spoken line in double quotes with who says it, and state plainly that an on-screen speaker's lips move with the words. When the request gives an @Audio reference the role of a person's voice, keep that role: it is the character's voice identity, not background music or the soundtrack.

VISIBLE TEXT: Put every word that must appear on screen in double quotes after "reads", such as a sign that reads "OPEN 24H", with the request's exact spelling.

When reference videos are listed, use them only for the role requested, such as camera movement, action timing, edit rhythm, or visual effects. When audio references are listed, assign them as soundtrack, rhythm guide, speech reference, or ambience based on the request.

FORMAT: Single present-tense paragraph of short sentences. No bullets, headers, markdown, preamble, or labels. Output ONLY the rewritten prompt.

CAMERA: Choose one primary camera behavior for the shot or beat in concrete cinematographic language, matched to scene geometry, subject motion, and mood. The camera may move, hold a POV, or stay locked/static when stillness best serves the shot. Keep camera motion separate from subject motion and do not stack multiple camera moves in one sentence.

TIME-CODED BEATS: For clips longer than 5 seconds, segment the action with time-coded beats such as "0-2s: ..., 2-4s: ..., 4-6s: ...".

DIALOGUE & AUDIO: Seedance generates synchronized audio natively. Preserve quoted dialogue verbatim. Add foley and ambience as plain sentences. Do not invent music when none was requested.

PROPER NOUNS: Preserve exact spelling and punctuation of brand or product names from the base request, including dotted names such as Sogni.ai.

AVOID: Contradictions, semicolons, em dashes, parentheticals.

LENGTH: About 80–150 words for a single-beat shot, plus about 30–50 words for each further time-coded beat. Never drop a detail, beat, quoted line or reference role from the request to save words.

TARGET CAPABILITIES: Seedance 2.5 uses the same director-style prompt grammar and per-modality @Image / @Video / @Audio reference syntax as the Seedance 2.0 series. Its capability envelope is larger: 4-30 second clips and up to 30 image references, 10 video references, and 10 audio references, with 50 files total across those per-modality caps. For new footage longer than 15 seconds, use a coherent chronology with time-coded beats that cover the requested duration; do not split the request into multiple clips.

## Model notes

- Use @Image1, @Video1, and @Audio1 tags without brackets or spaces.
- Assign every useful reference asset a concrete role.
- Use one 4-30 second call for a continuous clip when the requested duration fits.
- Prefer positive preservation constraints and concise time-coded beats for longer clips.
- Write each spoken line in double quotes with its speaker, keeping the user's words exactly, and on-screen text in double quotes after "reads".
```

<!-- END GENERATED PROMPT GUIDE: seedance-2.5 -->

<!-- BEGIN GENERATED PROMPT GUIDE: seedance-2.0 -->
<!-- Generated by npm run sync:prompt-guides from @sogni-ai/sogni-intelligence-client 4.23.0; edit the rules there, not here. -->

### Sogni's prompt rules: seedance-2.0

`sogni-agent prompt-guide seedance2 --mode t2v` prints the rules Sogni's own prompt writer uses for Seedance 2.0 text-to-video and loose references, shown in full below. Print the guide for the mode you will run before writing its prompt:

| Mode | Guide | Command |
| --- | --- | --- |
| `t2v` | Seedance 2.0 text-to-video and loose references | `sogni-agent prompt-guide seedance2 --mode t2v` |
| `i2v` | Seedance 2.0 first-frame image-to-video | `sogni-agent prompt-guide seedance2 --mode i2v` |
| `l2v` | Seedance 2.0 last-frame image-to-video | `sogni-agent prompt-guide seedance2 --mode l2v` |
| `flf` | Seedance 2.0 first-and-last-frame video | `sogni-agent prompt-guide seedance2 --mode flf` |
| `v2v` | Seedance 2.0 video-to-video: edit, extend or reference a source video | `sogni-agent prompt-guide seedance2 --mode v2v` |

```text
# Seedance 2.0 text-to-video and loose references

Guide: seedance-2.0 t2v
Models: seedance2, seedance2-mini, seedance2-mini-uncensored

Each rule below is quoted from the system prompt Sogni's own prompt writer uses for this model and mode, so some rules speak to that writer about its base request or user message.

## Reference grammar

REFERENCE GRAMMAR: Use BytePlus-style @ tags as the canonical prompt-visible reference labels. Refer to attached assets by 1-indexed counters per modality, written exactly as @Image1, @Video1, or @Audio1 with no brackets and no spaces. Counting is independent per modality and follows attachment order. If the base request uses aliases such as Image 1, Video 2, Audio 1, @Image 1, or @Video 2, normalize them to @Image1, @Video2, or @Audio1 in the rewritten prompt. Never mention reference URLs or asset IDs.

## Rules

REFERENCE ROLE DISCIPLINE: Assign every useful reference asset a clear creative role. Do not write vague phrases like "use the attached files." State whether each useful file is an edit target or only a reference. Use role language such as "Use @Image1 as the character identity reference," "Use @Image2 for wardrobe and color palette," "Use @Video1 for camera movement and action timing only," or "Use @Audio1 as the rhythm and background music guide."

DIRECTORIAL BRIEF: Write like a concise director's shot brief, not a static image caption. Include concrete physical interactions, motion timing, mood, lighting, and sound cues that help the model understand both what the scene looks like and how it changes over time. Turn each quality the shot must convey, such as speed, size, weight, danger or feeling, into what a camera and microphone would capture at real-world proportions, because the model renders what it can see and hear, not a number or an adjective.

PROMPT ANATOMY: Include task intent, reference-role assignments, subject/action, scene, camera, style/lighting, audio behavior, continuity, and any final message only when needed. For multi-beat clips, use compact time-coded beats or shot-script phrasing instead of a dense unordered list.

CAMERA AND PHYSICS: Prefer one primary camera move. Separate subject motion from camera motion. Describe pace in words that match the shot instead of technical camera settings: slow, smooth, gradual, or controlled for calm moments; for fast action, show the speed through what rushes past the camera, the ground covered within a beat, and impacts with their consequences, because a stated speed or the word "fast" alone renders slower than intended. Ground action in physical details such as fabric movement, reflections, dust, water, contact, momentum, and object interaction when relevant.

POSITIVE CONSTRAINTS: Prefer positive preservation language over negative-only phrasing. Say "Keep the logo crisp and readable," "Maintain the same face structure, outfit, silhouette, and proportions from @Image1," and "Keep every person, prop and color consistent from the first frame to the last."

SHOTS: Use one continuous shot when the request describes one continuous action, place or camera move, and separate shots when it asks for cuts or a montage or moves between places, viewpoints or moments. Open each new shot with its own time-coded beat that names the cut, such as "4-7s: Cut to a close-up of ...".

SPEECH: Write every spoken line in double quotes with who says it, and state plainly that an on-screen speaker's lips move with the words. When the request gives an @Audio reference the role of a person's voice, keep that role: it is the character's voice identity, not background music or the soundtrack.

VISIBLE TEXT: Put every word that must appear on screen in double quotes after "reads", such as a sign that reads "OPEN 24H", with the request's exact spelling.

When reference videos are listed, use them only for the role requested, such as camera movement, action timing, edit rhythm, or visual effects. When audio references are listed, assign them as soundtrack, rhythm guide, speech reference, or ambience based on the request.

FORMAT: Single present-tense paragraph of short sentences. No bullets, headers, markdown, preamble, or labels. Output ONLY the rewritten prompt.

CAMERA: Choose one primary camera behavior for the shot or beat in concrete cinematographic language, matched to scene geometry, subject motion, and mood. The camera may move, hold a POV, or stay locked/static when stillness best serves the shot. Keep camera motion separate from subject motion and do not stack multiple camera moves in one sentence.

TIME-CODED BEATS: For clips longer than 5 seconds, segment the action with time-coded beats such as "0-2s: ..., 2-4s: ..., 4-6s: ...".

DIALOGUE & AUDIO: Seedance generates synchronized audio natively. Preserve quoted dialogue verbatim. Add foley and ambience as plain sentences. Do not invent music when none was requested.

PROPER NOUNS: Preserve exact spelling and punctuation of brand or product names from the base request, including dotted names such as Sogni.ai.

AVOID: Contradictions, semicolons, em dashes, parentheticals.

LENGTH: About 80–150 words for a single-beat shot, plus about 30–50 words for each further time-coded beat. Never drop a detail, beat, quoted line or reference role from the request to save words.

## Model notes

- Use @Image1, @Video1, and @Audio1 tags without brackets or spaces.
- Assign every useful reference asset a concrete role.
- Prefer positive preservation constraints and concise time-coded beats for longer clips.
- Write each spoken line in double quotes with its speaker, keeping the user's words exactly, and on-screen text in double quotes after "reads".
```

<!-- END GENERATED PROMPT GUIDE: seedance-2.0 -->

## WAN 2.2 Prompting

Applies to `wan22-i2v` (`wan_v2.2-14b-fp8_i2v_lightx2v`, the default when one
`--ref` image is animated without `-m`), `wan22-t2v`, `wan22-s2v`, and the
Animate move and replace models. Bare `-m wan22` renders text-to-video and
image-to-video on LTX-2.5, so name the WAN 2.2 selector (and pass it to
`sogni-agent prompt-guide`). WAN 2.2 renders a silent picture (S2V keeps the
audio you upload), so describe what is seen and keep any words the user quoted. The rules Sogni's own prompt
writer uses close this section.

- **Pin the model.** Without `-m`, a single-image prompt that asks for sound,
  speech, or story is routed to LTX-2.5 instead
  ([models.md § Default image-to-video routing](./models.md#default-image-to-video-routing));
  pass `-m wan22-i2v` to keep WAN 2.2, or write the prompt per the LTX rule.
- **One English paragraph** in the present tense, with no headings, bullets,
  labels, or negative-prompt list. State constraints as positive facts
  (`the background is empty`, `the walls are bare`).
- **Text-to-video order:** the requested style, if any; shot scale and
  composition; the subject; the setting and its named light sources; the action
  as a concrete physical sequence; then one camera move.
- **Image-to-video:** the first frame already fixes the subject, wardrobe, and
  setting. Describe what happens next and the camera move that carries it, not
  the still.
- **Keep everything the user asked for:** every action in order, exact visible
  text in double quotes after `reads`, and proper nouns as spelled. Add no
  people, props, text, or style they did not ask for. When the request names no
  motion, add one small, physically plausible movement.
- **Camera and pace** follow the request: one primary move per clip, mapped as
  in [Camera Language Normalization](#camera-language-normalization).
- **S2V lip-sync** (`wan22-s2v`: a portrait plus `--ref-audio`): the portrait
  fixes identity and framing, the audio fixes timing. Describe the visible
  performance that goes with it (lips, expression, gaze, breathing, head, body,
  and hand motion), as still or as energetic as the request implies, and quote
  words only when the user supplied them.
- **Animate move / replace:** one direct instruction naming who performs the
  driving video's motion, or who replaces its performer, and what stays: the
  motion timing, camera path, framing, and background.

<!-- BEGIN GENERATED PROMPT GUIDE: wan-2.2 -->
<!-- Generated by npm run sync:prompt-guides from @sogni-ai/sogni-intelligence-client 4.23.0; edit the rules there, not here. -->

### Sogni's prompt rules: wan-2.2

`sogni-agent prompt-guide wan22-i2v --mode i2v` prints the rules Sogni's own prompt writer uses for Wan 2.2 first-frame image-to-video, shown in full below. Print the guide for the mode you will run before writing its prompt:

| Mode | Guide | Command |
| --- | --- | --- |
| `t2v` | Wan 2.2 text-to-video | `sogni-agent prompt-guide wan22-i2v --mode t2v` |
| `i2v` | Wan 2.2 first-frame image-to-video | `sogni-agent prompt-guide wan22-i2v --mode i2v` |
| `l2v` | Wan 2.2 last-frame image-to-video | `sogni-agent prompt-guide wan22-i2v --mode l2v` |
| `flf` | Wan 2.2 first-and-last-frame video | `sogni-agent prompt-guide wan22-i2v --mode flf` |
| `s2v` | Wan 2.2 speech-to-video | `sogni-agent prompt-guide wan22-i2v --mode s2v` |
| `animate-move` | Wan 2.2 Animate movement transfer | `sogni-agent prompt-guide wan22-i2v --mode animate-move` |
| `animate-replace` | Wan 2.2 Animate character replacement | `sogni-agent prompt-guide wan22-i2v --mode animate-replace` |

```text
# Wan 2.2 first-frame image-to-video

Guide: wan-2.2 i2v
Models: wan22

Each rule below is quoted from the system prompt Sogni's own prompt writer uses for this model and mode, so some rules speak to that writer about its base request or user message.

## Rules

Your prompt MUST:
- Preserve the user's base request, style, constraints, motion/action beats, and exact quoted dialogue if any is present
- Only invent a default practical action when the base request lacks motion. Keep explicit user instructions rather than replacing them with generic morphing, dissolves, or wardrobe transformations.
- Identify the important visible subjects, objects, poses, background elements, lighting, and perspective from the anchor only as needed to plan motion — do not redescribe static details
- Describe how each key element moves, shifts, transforms, or becomes occluded/revealed forward from the anchor
- Specify camera motion with directional language such as dolly in, tracking shot, orbit, pan, tilt, push in, pull back, or whip pan
- Maintain subject identity and visual continuity
- Use a concise present-tense paragraph with short sentences

NEGATIVE CONSTRAINT TRANSLATION: WAN receives only this positive prompt. Translate user avoid/no/don't constraints into affirmative production constraints instead of copying negative phrasing. For translated constraints, the output prompt must not use words such as "no", "not", "without", "avoid", or "never" except inside exact quoted user-requested text. Examples: "no people in background" becomes single subject focus with an empty background; "no text" becomes clean blank surfaces; "don't make it blurry" becomes crisp sharp focus; "no weird hands" becomes natural anatomically consistent hands; "no mouth movement, no talking, no lip syncing" becomes silent expression-only physical performance with facial motion independent of speech timing; "don't change the room" becomes the same room and layout remain consistent. If the user asks for exact quoted visible text, preserve that quoted text exactly.

DYNAMIC PROMPT BRANCHES: If the base request contains one Dynamic Prompt branch such as "{option A|option B}", preserve exactly one branch with the same option count. Put shared production constraints before the branch, then rewrite each branch option as a complete concrete motion option. Do not remove the braces, split the branch into bullets, add orchestration labels, or change the number of options.

OUTPUT CONSTRAINTS:
- Single concise paragraph only: no preamble, explanations, bullets, markdown, labels, second-keyframe language, target-frame language, interpolation language, or input ordinal references
- Motion-focused prose: static details appear only when they affect the forward motion
- Physically coherent motion at the pace the request calls for, showing fast action through what rushes past the camera and the ground covered
- Lettering already in the anchor frame stays exactly as it reads

## Model notes

- Use compact motion-first prompts for animate and transition workflows.
- Avoid crowded simultaneous actions and rigid numerical camera constraints.
```

<!-- END GENERATED PROMPT GUIDE: wan-2.2 -->

## Wan 3 Prompting

Applies to Wan 3 (`wan3`, Alibaba `wan3.0-video`) and Wan 3.0 Enhanced
(`wan3-enhanced`, `wan3.0-spicy-video`): 2-30 s at 30 fps with native audio.
The rules Sogni's own prompt writer uses close this section.

- **Sogni rewrites Wan 3 prompts by default.** Unless you pass
  `--no-expand-prompt`, Sogni's AI Screenwriter rewrites the prompt on the
  server before Wan 3 sees it, and the provider's own expander stays off. With
  `--no-expand-prompt` your words are the model input. Write the prompt the
  same way either way.
- **One English present-tense prompt** covering what matters of the subject,
  action, setting, camera, lighting, timing, dialogue, foley, ambience, and
  music. There is no negative-prompt field, so state constraints as positive
  facts.
- **Write the shot plan and the beats.** Wan 3 makes its own cuts when the
  prompt leaves the shot plan out: open with `One continuous shot, no cuts.` or
  the shot count (`Two shots.`), start each later shot's first beat with `Hard
  cut:` and its framing, and cover the whole clip with consecutive time-coded
  beats at every length. Cut where the user asks, when the action moves to
  another place or a later time, or when a closer angle shows a requested act
  better.
- **Dialogue** in double quotes with the speaker named; visible text in double
  quotes after `reads`.
- **Frame mode** (`--ref`, optional `--ref-end`): the first frame fixes the
  opening. Describe the motion that flows forward from it, or converges on the
  last frame, and do not call either frame `Image 1`.
- **Loose references** (`--workflow r2v`, `a2v`, or `ia2v`): name them exactly
  `Image 1`, `Video 1`, `Audio 1` (a capital letter and one space, no `@`, no
  brackets), numbered within each type in submission order. Give each one job
  and say which wins if two conflict. A document or webpage
  (`--reference-file-url` / `--reference-link-url`, Wan 3 only) is "the attached
  document" or "the linked webpage", never an `Image N`. In `a2v` the audio sets
  the timing.
- Prompts may run to 20,000 characters.

<!-- BEGIN GENERATED PROMPT GUIDE: wan-3 -->
<!-- Generated by npm run sync:prompt-guides from @sogni-ai/sogni-intelligence-client 4.23.0; edit the rules there, not here. -->

### Sogni's prompt rules: wan-3

`sogni-agent prompt-guide wan3 --mode t2v` prints the rules Sogni's own prompt writer uses for Wan 3 text-to-video, shown in full below. Print the guide for the mode you will run before writing its prompt:

| Mode | Guide | Command |
| --- | --- | --- |
| `t2v` | Wan 3 text-to-video | `sogni-agent prompt-guide wan3 --mode t2v` |
| `i2v` | Wan 3 first-frame image-to-video | `sogni-agent prompt-guide wan3 --mode i2v` |
| `flf` | Wan 3 first-and-last-frame video | `sogni-agent prompt-guide wan3 --mode flf` |
| `r2v` | Wan 3 multimodal reference-to-video | `sogni-agent prompt-guide wan3 --mode r2v` |
| `a2v` | Wan 3 audio-driven video | `sogni-agent prompt-guide wan3 --mode a2v` |

```text
# Wan 3 text-to-video

Guide: wan-3 t2v
Models: wan3, wan3-enhanced

Each rule below is quoted from the system prompt Sogni's own prompt writer uses for this model and mode, so some rules speak to that writer about its base request or user message.

## Rules

Wan 3 renders 2-30 seconds at fixed 30 fps and can generate synchronized audio.

CREATIVE FIDELITY: Preserve the user's specified subjects and ages, relationships, wardrobe, setting, genre, mood, action, shot composition, camera behavior, dialogue, visible text, and exclusions. Enrich only unspecified details that support those choices. Express the requested mood through observable performance, light, texture, and composition without replacing the premise or adding a new story event. Pacing and cinematography suggestions are defaults: an explicit locked camera, held pose, quiet pause, sustained action, or silence takes priority. Keep supplied dialogue and visible text in their original language and wording. Before returning, check the result against the original request and remove additions that contradict it.

OUTPUT CONTRACT: Write one production-ready English video prompt in present tense. Preserve exact user-provided dialogue in double quotes. Describe subject, action, setting, camera, lighting, timing, dialogue, foley, ambience, and music only when relevant. Use compact timecoded beats for multi-shot or longer clips. Do not add a negative-prompt section because Wan 3 has no negative_prompt request field. Return only the rewritten prompt with no preamble or markdown.

STEP TIMING AND VISIBLE STATE: Wan 3 renders an action reliably only when the prompt gives it its own time and says what it visibly changes. Write the artist's actions as consecutive timecoded beats that cover the clip's full length (for example "0-3 s: ...", "3-7 s: ..."), in the artist's order, each beat long enough for its action to be seen. When an action changes clothing or exposure (pulling fabric aside, lowering or lifting a garment, opening it, putting it back on, letting it snap back), give it its own beat: describe the hand motion, then state the visible result plainly, and keep that result true in every later beat unless the artist undoes it (for example "the crotch of her thong stays held to the side and her bare vulva stays visible"). This holds at every clip length: in a short clip use short beats (one or two seconds is fine), and never fold a clothing or exposure change into the same beat as the action that follows it. Keep your own additions short so the artist's actions get the screen time.

SHOTS AND CAMERA: Wan 3 makes its own cuts when the prompt does not say how the clip is shot, so write the shot plan into the prompt and keep the timecoded beats either way. Cut when the artist asks for cuts, when the action moves to another place or a later time, or when a closer angle shows a requested act better; otherwise keep one take. For one take, open the prompt with "One continuous shot, no cuts." For several shots, open with the number of shots (for example "Two shots.") and begin the first beat of every shot after the first with "Hard cut:" followed by that shot's framing; give every shot at least 2 seconds. Name the shot size and one camera move or "fixed camera" for each shot (for example "medium-wide shot, slow push in"); when the artist chose the camera or framing, use exactly theirs. Every person, body part and act the artist asked for appears on screen: describe each one as visible in the shot, inside the artist's framing when they chose one. When the starting frame does not show a requested person, bring them into view in the first beat, by the person stepping into frame or, if the artist did not lock the camera, by a camera move such as a pull back.

## Model notes

- Use Image 1, Video 1, and Audio 1 as plain 1-based per-type labels without brackets, angle brackets, or @ prefixes.
- Use native first/last-frame endpoints through animate_photo; do not mix those endpoint fields with loose multimodal references in the same request.
- Use generate_video for text or loose references and sound_to_video when an audio asset drives timing. A video input is loose conditioning for a new generation, not a provider-backed edit or continuation.
- Keep output duration within 2-30 seconds at the fixed 30 fps. When loose video references are present, their combined duration plus output duration must stay at or below 30 seconds.
- Use only 480p, 720p, or 1080p and one of 16:9, 4:3, 1:1, 3:4, or 9:16.
- Describe native dialogue, ambience, foley, and music directly; audio is enabled by default and can be disabled explicitly.
- Translate exclusions into affirmative preservation language because Wan 3 does not accept a separate negative prompt.
```

<!-- END GENERATED PROMPT GUIDE: wan-3 -->

## HappyHorse 1.1 Prompting

Applies to HappyHorse 1.1 (`happyhorse` / `happyhorse-1.1`, which pick the mode
from the inputs, and `happyhorse-1.1-t2v`, `-i2v`, `-r2v`): 3-15 s with native
audio that is always on. What it renders well and the reference limits are in
[models.md § HappyHorse 1.1](./models.md#happyhorse-11-prompting-tips).

<!-- BEGIN GENERATED PROMPT GUIDE: happyhorse-1.1 -->
<!-- Generated by npm run sync:prompt-guides from @sogni-ai/sogni-intelligence-client 4.23.0; edit the rules there, not here. -->

### Sogni's prompt rules: happyhorse-1.1

`sogni-agent prompt-guide happyhorse-1.1 --mode t2v` prints the rules Sogni's own prompt writer uses for HappyHorse 1.1 text-to-video, shown in full below. Print the guide for the mode you will run before writing its prompt:

| Mode | Guide | Command |
| --- | --- | --- |
| `t2v` | HappyHorse 1.1 text-to-video | `sogni-agent prompt-guide happyhorse-1.1 --mode t2v` |
| `i2v` | HappyHorse 1.1 first-frame image-to-video | `sogni-agent prompt-guide happyhorse-1.1-i2v --mode i2v` |
| `r2v` | HappyHorse 1.1 reference-to-video | `sogni-agent prompt-guide happyhorse-1.1-r2v --mode r2v` |

```text
# HappyHorse 1.1 text-to-video

Guide: happyhorse-1.1 t2v
Models: happyhorse-1.1, happyhorse-1.1-t2v

Each rule below is quoted from the system prompt Sogni's own prompt writer uses for this model and mode, so some rules speak to that writer about its base request or user message.

## Rules

CINEMATOGRAPHY: Write like a concise director's shot brief. Use one continuous shot unless the request asks for cuts, a montage or separate shots; then open each shot with its own time-coded beat that names the cut. Weave together the subjects with rich physical detail, the environment and the light sources the scene implies, and one primary thread of physically filmable motion using temporal connectors ("as", "then", "while"). Add a lens, color grade or film-stock note only when the request names a look or style. Express emotion through visible behavior — posture, gesture, breathing — never emotional labels. Match the pace to the action: calm words for calm moments, and for fast action show the speed through what rushes past the camera and the ground covered within a beat, because the word "fast" alone renders slower than intended.

CAMERA: One primary camera move per shot — dolly in, slow pan, tracking shot, orbital arc, crane up, push-in, or pull-back. Stacking multiple moves causes jitter. Keep the camera move in its own clause, separate from subject motion.

AUDIO: HappyHorse renders a native synchronized audio track — always on, with multilingual lip-sync. Weave foley and ambient sound into plain sentences (footsteps, fabric, wind, water, room tone, environmental ambience). When the scene involves speech or the user supplies dialogue, keep the spoken lines in double quotes and state that the subject speaks on camera with mouth movements matched to the words. Do not invent songs or a musical score unless the user asks for them.

NEGATIVE CONSTRAINT TRANSLATION: HappyHorse has no negative-prompt input and receives only this positive prompt. Translate user avoid/no/don't constraints into affirmative production constraints instead of copying negative phrasing. The output prompt must not use words such as "no", "not", "without", "avoid", or "never" except inside exact quoted user-requested text. Examples: "no people in background" becomes single subject focus with an empty background; "no text" becomes clean blank surfaces; "don't make it blurry" becomes crisp sharp focus; "no music" becomes only natural ambient sound and foley. If the user asks for exact quoted visible text, preserve that quoted text exactly.

DYNAMIC PROMPT BRANCHES: If the base request contains one Dynamic Prompt branch such as "{option A|option B}", preserve exactly one branch with the same option count. Put shared production constraints before the branch, then rewrite each branch option as a complete concrete motion option. Do not remove the braces, split the branch into bullets, add orchestration labels, or change the number of options.

FORMAT: A single present-tense paragraph of flowing, visually specific prose. No bullets, headers, markdown, preamble, or labels. Avoid vague words ("beautiful", "nice"); avoid semicolons, em dashes, and parentheticals.

TIME-CODED BEATS: For clips longer than 5 seconds, segment the action with compact time-coded beats such as "0-3s: …, 3-6s: …, 6-10s: …" so the motion reads in order.

PROPER NOUNS: Preserve exact spelling and punctuation of brand or product names from the base request, including dotted names such as Sogni.ai.

LENGTH: About 80–160 words for a single-beat shot, plus about 30 words for each further time-coded beat. Never drop a requested detail to fit. Output ONLY the rewritten prompt — no explanations, no labels.

## Model notes

- Use one flowing, present-tense director brief: one continuous shot with one primary camera move, or time-coded shots when the request asks for cuts or a montage.
- For I2V, treat the single image as the locked first frame and describe only the motion that follows; do not add a reference tag.
- For R2V, label image references exactly [Image 1] through [Image 9] and assign each image a concrete identity, wardrobe, setting, prop, or style role.
- Describe synchronized dialogue, ambience, and foley in the prompt because native audio is always enabled.
- Translate exclusions into affirmative visual constraints because HappyHorse does not accept a separate negative prompt.
- Keep clips within the validated 3-15 second, 720p/1080p operating range.
```

<!-- END GENERATED PROMPT GUIDE: happyhorse-1.1 -->

## High-Res Video Routing

When the user asks for video in **"hd"**, **"1080p"**, **"4k"**, **"uhd"**, or **"high-res"**, do not use the default WAN video models.

- For **native Seedance 4K / UHD**, use full Seedance with `-m seedance2 --target-resolution 2160`. This is a Premium Spark vendor path; do not use `seedance2-mini`, `seedance2-fast`, or `seedance2-5` for 4K — Mini and Fast cap at 720p, and Seedance 2.5 renders up to 1080p.
- For **Seedance 2.5 HD / 1080p**, preserve the requested model with `-m seedance2-5 --target-resolution 1080`. Its frame, loose-reference, edit, and extend workflows also accept 1080p; edit/extend inherit the source video's aspect ratio.
- For **non-vendor HD / 1080p text-to-video**, use `-m ltx25`.
- For **non-vendor HD / 1080p image-to-video**, use `-m ltx25-i2v`.
- Prefer LTX-sized dimensions such as `-w 1920 -h 1088` when the chosen model is LTX.
- For bare "720p" on LTX/WAN 2.2 without orientation or exact pixels, prefer `--target-resolution 768` instead of forcing landscape dimensions. Seedance uses `--target-resolution 720`; honor the selected model's supported tiers.
- When the prompt combines a named resolution with an aspect ratio, such as "720p 9:16", let the CLI infer both instead of forcing manual `-w`/`-h` unless the user gave exact pixels.
- If the user explicitly asks for `vertical`, `portrait`, `story`, `reel`, `tiktok`, `square`, or `4:3`, apply the matching dimensions from the **Orientation Mapping** rules instead of defaulting to 16:9.
- Rewrite the user's request using the **LTX-2.x Prompt Rule** only when invoking an LTX model. Do not send short slogan-style prompts to LTX.

## Agent-ready command shapes

```bash
# Native Seedance 4K / UHD text-to-video (prompt per sogni-agent prompt-guide seedance2 --mode t2v)
sogni-agent -q --video -m seedance2 --target-resolution 2160 -o ./video.mp4 "<Seedance prompt>"

# HD / 1080p text-to-video without the Seedance vendor path: prefer LTX-2.5
sogni-agent -q --video -m ltx25 -w 1920 -h 1088 -o ./video.mp4 "<LTX-rewritten paragraph>"

# HD / 1080p image-to-video without the Seedance vendor path: prefer LTX i2v
sogni-agent -q --video --ref /path/to/image.png -m ltx25-i2v -w 1920 -h 1088 -o ./video.mp4 "<LTX-rewritten paragraph>"

# LTX-2.3 voice identity / persona
sogni-agent --video --reference-audio-identity voice.webm 'A medium close-up frames the narrator as he looks into the lens and says in a calm, low voice, "This is my voice."'

# Seedance 2.0 standard (4-15s vendor video path with native audio)
sogni-agent --video -m seedance2 --duration 8 "<Seedance prompt with time-coded beats>"

# Seedance 2.5 (4-30s single clips, 480p/720p/1080p — the one Seedance that renders past 15s in one call)
sogni-agent --video -m seedance2-5 --duration 24 "<Seedance prompt whose time-coded beats cover all 24 s>"

# Seedance 2.5 edit (duration must match @Video1; aspect ratio is inherited)
sogni-agent --video -m seedance2-5-v2v --seedance-task-type edit --ref-video source.mp4 --duration 8 --target-resolution 720 "Edit @Video1. Replace <what changes>. Keep the subject, camera path, and timing."

# Seedance 2.5 extension (duration is the new continuation length)
sogni-agent --video -m seedance2-5-v2v --seedance-task-type extend --ref-video source.mp4 --duration 8 --target-resolution 720 "Extend @Video1. <the new footage after its ending, in time-coded beats>"
```

Prefer `.webm`, `.m4a`, or `.mp3` voice clips. Local `.wav` clips are normalized
to `.m4a` before upload when `ffmpeg` is available.
