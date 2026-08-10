# Video Editing & Stitching (local FFmpeg-wrapper workflows)

Read this when the user asks to animate between images, continue a video,
bridge two videos, build a 360 turntable video, stitch clips, or remix/layer
audio over a finished video.

**Never run raw `ffmpeg`, `ls`, or `cp` shell commands for any of this.**
Always use the built-in safe wrappers: `--extract-first-frame`,
`--extract-last-frame`, `--concat-videos`, `--remix-audio`, `--list-media`,
`--video-start`, `--audio-start`, `--audio-duration`. They produce safer, more
reproducible results and are the only sanctioned file operations.

## Animate Between Two Images (First-Frame / Last-Frame)

When a user asks to **animate between two images**, use `--ref` (first frame) and `--ref-end` (last frame):

```bash
sogni-agent -q --video --ref ./imageA.png --ref-end ./imageB.png -o ./transition.mp4 "<4-8 sentence LTX transition paragraph>"
```

**Default model:** with both `--ref` and `--ref-end` set and no `-m`, the CLI
defaults to `ltx23-22b-fp8_i2v_distilled` — the LTX-2.3 transition/morph path
described in the callout below — so write the prompt as an LTX paragraph per
[`video-prompting.md`](video-prompting.md). Pass
`-m wan_v2.2-14b-fp8_i2v_lightx2v` only when the user explicitly wants the
WAN path (silent clip, no transition LoRA). Plain single-image i2v (one
`--ref`, no end frame) defaults to `wan_v2.2-14b-fp8_i2v_lightx2v` instead.

**Always apply this pattern when:**
- User says "animate image A to image B" → use `--ref A --ref-end B`
- User says "animate this video to this image" → extract last frame, use as `--ref`, target image as `--ref-end`, then stitch
- User says "continue this video" with a target image → same as above

> **LTX-2.3 transition / morph LoRA (auto-applied).** When an LTX-2.3
> image-to-video render (`ltx23-22b-fp8_i2v_distilled`) is given **both** a start
> image (`--ref`) and an end image (`--ref-end`) — two keyframes — it
> automatically applies the ValiantCat transition/morph LoRA (lora id
> `transition`, trigger word `zhuanchang`, strength ~1.0), morphing the first
> image smoothly into the end image. This is a **single model-level render**, not
> a stitch — no extra flags are required for the two-frame LTX i2v path. The
> sogni-client SDK example uses `image <first>` and `end-image <last>` to supply
> the two frames (the morph LoRA engages automatically), and additionally exposes
> manual `transition` / `transition-strength` SDK arguments for the SDK path. Do
> **not** confuse this single-render morph with the manual "Transition Between Two
> Videos (Bridge Clip)" recipe below, which bridges two *finished videos* with a
> separately generated clip and `--concat-videos`.

## Animate a Video to an Image (Scene Continuation)

1. **Extract the last frame** of the existing video:
   ```bash
   sogni-agent --extract-last-frame ./existing.mp4 ./lastframe.png
   ```
2. **Generate a new video** using the last frame as `--ref` and the target image as `--ref-end`:
   ```bash
   sogni-agent -q --video --ref ./lastframe.png --ref-end ./target.png -o ./continuation.mp4 "<4-8 sentence LTX transition paragraph into the target image>"
   ```
   (No `-m` needed — the two-frame default is `ltx23-22b-fp8_i2v_distilled` with the auto-applied transition/morph LoRA.)
3. **Concatenate the videos**:
   ```bash
   sogni-agent --concat-videos ./full_sequence.mp4 ./existing.mp4 ./continuation.mp4
   ```

This ensures visual continuity — the new clip picks up exactly where the previous one ended.

When the final stitched output needs a single external soundtrack, add `--concat-audio /path/to/audio.mp3` and optional `--concat-audio-start <sec>` to the same `--concat-videos` command. This is the local-agent advantage over browser-only workflows: generate clips with Sogni, then stitch and mux audio locally.

## Transition Between Two Videos (Bridge Clip)

This recipe transitions between two **finished videos**. To morph between two
**still images** in a single render, use the LTX-2.3 two-keyframe i2v path with
its auto-applied transition/morph LoRA (see "Animate Between Two Images" above) —
do not build a bridge clip for that case.

To **create a transition between two existing videos** (A → B), bridge them with a generated clip anchored on both boundary frames:

1. Extract the boundary frames:
   ```bash
   sogni-agent --extract-last-frame ./videoA.mp4 ./A_last.png
   sogni-agent --extract-first-frame ./videoB.mp4 ./B_first.png
   ```
2. Generate the transition with i2v, anchoring start→end. Match `--fps` to the surrounding clips:
   ```bash
   sogni-agent -q --video -m wan_v2.2-14b-fp8_i2v_lightx2v \
     --ref ./A_last.png --ref-end ./B_first.png --fps 24 \
     -o ./transition.mp4 "descriptive morph between the two shots"
   ```
3. Concatenate A → transition → B:
   ```bash
   sogni-agent --concat-videos ./merged.mp4 ./videoA.mp4 ./transition.mp4 ./videoB.mp4
   ```

> **i2v clips are silent and use the model's own frame rate** (often not 24). `--concat-videos` normalizes fps/size and fills silent audio automatically, so mismatched clips stitch correctly — but passing `--fps` to the transition generation keeps things clean from the start. Use `--concat-fps <n>` to force a specific output frame rate.

## SourceReel: Folder of Images → Loopable Video

Turn a folder of images into one stitched video: each image becomes an animated
clip, consecutive images are bridged by generated transition clips, and the
whole set is concatenated into a single mp4 (a single image renders one clip with
no transitions). **Always plan first — `--reel-plan-only` prints the planned
clips/transitions for free without rendering.** The render populates a working
folder (`<source>/sogni-source-reel-*`, or `--reel-workdir <dir>`) that keeps
every intermediate ref, clip, and transition so reruns can reuse them; the final
stitch **requires ffmpeg**. Looping is on by default (a last→first transition
closes the loop) — pass `--no-reel-loop` for a one-way reel.

```bash
# 1. Plan the reel for free (no rendering)
sogni-agent --source-reel ./images --reel-plan-only

# 2. Render clips + transitions and stitch (loop on by default)
sogni-agent --source-reel ./images \
  --reel-image-seconds 3 --reel-transition-seconds 3 \
  --reel-image-prompt "friendly camera-ready motion" \
  --reel-output ./reel.mp4
```

## Segment a Longer Reference Video

For local stitched workflows that only need part of a source video:

```bash
sogni-agent --video --workflow v2v --ref-video dance.mp4 \
  --video-start 10 --duration 8 --controlnet-name pose -o ./clip-2.mp4 \
  "robot dancing"
```

## Remix / Layer Audio After Stitching

After concatenating, use `--remix-audio` to rebuild the audio track **without re-encoding the video** (the picture is stream-copied — fast and lossless):

```bash
# Loop one clip's audio across the whole merged video and fade it out at the end
sogni-agent --remix-audio ./merged.mp4 ./final.mp4 \
  --bed-audio ./clip1.mp4 --audio-loop --audio-fade-out 2

# Same, but also layer a second clip's original audio back in starting at 18s
sogni-agent --remix-audio ./merged.mp4 ./final.mp4 \
  --bed-audio ./clip1.mp4 --audio-loop --audio-fade-out 2 \
  --mix-audio ./clip3.mp4 --mix-at 18.01 --mix-gain -3
```

- `--bed-audio` accepts a video or audio file; if omitted, the input video's own audio is the bed.
- `--audio-loop` loops the bed to cover the full video; `--audio-fade-in` / `--audio-fade-out` fade it.
- `--mix-audio` overlays one extra track (mixed with a peak limiter so it never clips); position it with `--mix-at` and adjust level with `--mix-gain` (dB).
- To mix more than two layers, chain `--remix-audio` passes (each only re-encodes audio).

## Multiple Angles (Turnaround) and 360 Video

Generate specific camera angles from a single reference image using the Multiple Angles LoRA:

```bash
# Single angle
sogni-agent --multi-angle -c subject.jpg \
  --azimuth front-right --elevation eye-level --distance medium \
  --angle-strength 0.9 \
  "studio portrait, same person"

# 360 sweep (8 azimuths)
sogni-agent --angles-360 -c subject.jpg --distance medium --elevation eye-level \
  "studio portrait, same person"

# 360 sweep video (looping mp4, uses i2v between angles; requires ffmpeg)
sogni-agent --angles-360 --angles-360-video ./turntable.mp4 \
  -c subject.jpg --distance medium --elevation eye-level \
  "studio portrait, same person"
```

The prompt is auto-built with the required `<sks>` token plus the selected camera angle keywords. `--angles-360-video` generates i2v clips between consecutive angles (including last→first) and concatenates them with ffmpeg for a seamless loop. Use `--video-model <id>` to override the i2v model for the clips (e.g. `wan_v2.2-14b-fp8_i2v` for higher quality).

### 360 Video Best Practices

1. **Default camera parameters** (do not ask unless they specify): elevation **eye-level**, distance **medium**.
2. **Map user terms to flags**:

   | User says | Flag value |
   |-----------|------------|
   | "high" angle | `--elevation high-angle` |
   | "medium" angle | `--elevation eye-level` |
   | "low" angle | `--elevation low-angle` |
   | "close" | `--distance close-up` |
   | "medium" distance | `--distance medium` |
   | "far" | `--distance wide` |

3. **Always use first-frame/last-frame stitching** — `--angles-360-video` handles this automatically (i2v clips between consecutive angles including last→first).

### Change Angle (Novel View Synthesis) term mapping

- "from the left" / "side view" → `--azimuth left`
- "3/4 view" / "three-quarter" → `--azimuth front-right`
- "from behind" / "back" → `--azimuth back`
- "looking up at" → `--elevation low-angle`
- "bird's eye" / "top-down" → `--elevation high-angle`
- "closeup" → `--distance close-up`

## Wan Animate 2 motion transfer

Wan Animate 2 uses a reference image for identity and scene appearance plus a raw driving video for body, facial, hand, and camera motion. It is an `animate-move` workflow, not ControlNet V2V and not a replacement for the default WAN 2.2 workflow. Select it explicitly:

```bash
sogni-agent --video -m wan-animate-2 --workflow animate-move \
  --ref original-image-model-still.png \
  --ref-video driving-video-with-dialogue.mp4 \
  --pose-prompt "The actor speaks while walking forward and gesturing naturally" \
  --duration 3.375 \
  "Preserve the actor's identity, wardrobe, and finely detailed practical set"
```

The workflow is fixed at 24 fps, 17-81 frames on a `1+n×4` grid, 10 steps, guidance 1, shift 5, sampler `euler`, and scheduler `simple`. The source video's audio is retained. `--pose-strength` and `--reference-image-strength` accept 0-10; `--pose-start-percent` and `--pose-end-percent` accept 0-1 with start no greater than end. `--enable-context-window` selects the official optional 21-frame/8-overlap temporal path; it defaults off for the full-sequence release-quality recipe.

Production routing requires a 32 GB-class worker for every supported Animate 2 size; do not bypass the router's VRAM gate.

For release-quality checks, use an original still generated directly by an image model. Never use a screenshot or a frame extracted from the driving video or any generated video. Test a visible person, meaningful motion, fine detail, and spoken dialogue, and require manual user approval before making Animate 2 the default.

## Video-to-Video (V2V) with ControlNet

```bash
# Basic v2v with canny edge detection
sogni-agent --video --workflow v2v --ref-video input.mp4 \
  --controlnet-name canny "stylized anime version"

# V2V with pose detection and custom strength
sogni-agent --video --workflow v2v --ref-video dance.mp4 \
  --controlnet-name pose --controlnet-strength 0.7 "robot dancing"

# Seedance V2V without ControlNet
sogni-agent --video --workflow v2v -m seedance2-v2v \
  --ref-video input.mp4 "make the clip more cinematic"
```

ControlNet types: `canny` (edges), `pose` (body pose), `depth` (depth map), `detailer` (detail enhancement). Default strengths are tuned from Sogni Chat: `canny`/`pose`/`depth` use `0.85` plus detailer assist; `detailer` uses `1.0` for preservation. For Seedance V2V, use `-m seedance2-v2v` and omit ControlNet. Audio references must be paired with an image or video reference.

### V2V Outpaint (Canvas Extension) and Inpaint (Masked Region)

The LTX-2.3 v2v model `ltx23-22b-fp8_v2v_distilled` adds two control modes
beyond `canny`/`pose`/`depth`/`detailer`:

- **`outpaint`** — extend/expand the video canvas (for example, make a vertical
  clip widescreen, or add space in one direction). Outpaint is **positional and
  mask-free**: it anchors the original frame inside a larger canvas. The anchor
  position is `center`, `top`, `bottom`, `left`, or `right` (where the original
  frame sits in the expanded canvas — `left` keeps the original on the left and
  grows to the right; `center` expands all sides). An optional target aspect
  ratio (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`) shapes the expanded
  canvas. The canvas only grows — it never crops. **No mask is needed.**
- **`inpaint`** — regenerate a masked region of the source video (for example,
  "replace what's behind the subject"). Inpaint **requires a mask image** where
  **white pixels mark the region to regenerate**.

These modes run as Sogni Projects on the v2v surface. In the hosted
`video_to_video` tool the control mode is selected with `controlMode` set to
`outpaint` or `inpaint` (with `outpaintPosition` / optional
`outpaintAspectRatio` for outpaint, or `maskImageIndex` for inpaint). Hosted
execution can derive an inpaint mask if the user did not upload one. The direct
CLI and underlying sogni-client SDK example expose them as `--control-type` /
`control-type` (`canny|pose|depth|detailer|outpaint|inpaint`), with `--mask`
for direct inpaint (white = region to regenerate), `--outpaint-position`
(`center|top|bottom|left|right`), and optional `--outpaint-aspect-ratio`
(`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`) for direct outpaint. These
extension/inpaint controls are video-only.

```bash
sogni-agent -q --video --workflow v2v -m ltx23 \
  --ref-video ./source.mp4 --control-type outpaint \
  --outpaint-position center --outpaint-aspect-ratio 16:9 \
  -o ./outpainted.mp4 "Extend the surrounding scene naturally"

sogni-agent -q --video --workflow v2v -m ltx23 \
  --ref-video ./source.mp4 --control-type inpaint --mask ./mask.png \
  -o ./inpainted.mp4 "Replace the masked region with clean matching detail"
```

## Music-to-Video Pipeline

1. Use the provided/generated audio file as `--ref-audio`
2. If there is also a reference image, omit `--workflow` and let the CLI auto-select LTX 2.3 `ia2v`
3. If there is no reference image, omit `--workflow` and let the CLI auto-select LTX 2.3 `a2v`
4. Use `--workflow s2v` only for explicit face lip-sync with a face image
5. If only part of the song/audio should drive the clip, pass `--audio-start <sec>` and optionally `--audio-duration <sec>`
