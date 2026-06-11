# Video Prompting Guide (LTX-2.3, pacing, orientation, camera language)

Read this before writing any text-to-video or image-to-video prompt for LTX
models, and whenever the user asks for "hd", "1080p", "4k", "uhd", or
"high-res" video.

## LTX-2.3 Prompt Rule

Whenever the chosen video model is `ltx23-22b-fp8_t2v_distilled` (or any LTX
family model), do not pass the user's short request through unchanged. Rewrite
it into an LTX-2.3-safe prompt before calling `sogni-agent`.

- Output one single paragraph only. No line breaks, bullet points, section labels, tag lists, or screenplay formatting.
- Use 4-8 flowing present-tense sentences describing one continuous shot. No cuts, montage, or unrelated scene jumps.
- Start with shot scale plus the scene's visual identity, then describe environment, time of day, atmosphere, textures, and specific light sources.
- Keep people, clothing, props, and locations concrete and stable across the whole paragraph.
- Give the scene one main action thread from start to finish. Use connectors like `as`, `while`, and `then` so motion reads as a continuous filmed moment.
- If the user asks for dialogue, embed the spoken words inline as prose and identify who is speaking and how they deliver the line.
- Budget spoken dialogue at about 3 words per second, plus about 1 second for each meaningful acting beat or pause.
- Express emotion through visible physical cues such as posture, grip, jaw tension, breathing, or pacing. Ambient sound can be woven into the prose naturally.
- Use positive phrasing only. Do not add negative prompts, "no ..." clauses, on-screen text/logo requests, vague filler words like `beautiful` or `nice`, or structural markup such as `[DIALOGUE]`.
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

## High-Res Video Routing

When the user asks for video in **"hd"**, **"1080p"**, **"4k"**, **"uhd"**, or **"high-res"**, do not use the default WAN video models.

- For **text-to-video**, use `-m ltx23-22b-fp8_t2v_distilled`.
- For **image-to-video**, use `-m ltx23-22b-fp8_i2v_distilled`.
- Prefer LTX-sized dimensions such as `-w 1920 -h 1088`.
- For bare named resolutions such as "720p" without orientation or exact pixels, prefer `--target-resolution 768` or the closest requested short side instead of forcing landscape dimensions.
- When the prompt combines a named resolution with an aspect ratio, such as "720p 9:16", let the CLI infer both instead of forcing manual `-w`/`-h` unless the user gave exact pixels.
- If the user explicitly asks for `vertical`, `portrait`, `story`, `reel`, `tiktok`, `square`, or `4:3`, apply the matching dimensions from the **Orientation Mapping** rules instead of defaulting to 16:9.
- Rewrite the user's request using the **LTX-2.3 Prompt Rule** before invoking the command. Do not send short slogan-style prompts to LTX.
- Treat "4k" as a signal to use the highest practical LTX path exposed by this skill, even though the current wrapper caps non-WAN video dimensions at 2048px on the long side.

## Agent-ready command shapes

```bash
# HD / "4K" text-to-video: prefer LTX-2.3 (prompt must already be rewritten as above)
sogni-agent -q --video -m ltx23-22b-fp8_t2v_distilled -w 1920 -h 1088 -o ./video.mp4 "<LTX-rewritten paragraph>"

# HD / "4K" image-to-video: prefer LTX i2v
sogni-agent -q --video --ref /path/to/image.png -m ltx23-22b-fp8_i2v_distilled -w 1920 -h 1088 -o ./video.mp4 "<LTX-rewritten paragraph>"

# LTX-2.3 voice identity / persona
sogni-agent --video --reference-audio-identity voice.webm 'NARRATOR: "This is my voice."'

# Seedance 2.0 (4-15s vendor video path with native audio)
sogni-agent --video -m seedance2 --duration 8 "A polished product reveal with native ambient sound"
```

Prefer `.webm`, `.m4a`, or `.mp3` voice clips. Local `.wav` clips are normalized
to `.m4a` before upload when `ffmpeg` is available.
