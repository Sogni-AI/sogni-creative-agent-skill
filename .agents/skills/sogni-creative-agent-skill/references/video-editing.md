# Video Editing & Stitching (local FFmpeg-wrapper workflows)

Read this when the user asks to animate between images, continue a video,
bridge two videos, build a 360 turntable video, stitch clips (above all clips
from different models), or remix/layer audio over a finished video.

**Never run raw `ffmpeg`, `ls`, or `cp` shell commands for any of this.**
Always use the built-in safe wrappers: `--extract-first-frame`,
`--extract-last-frame`, `--concat-videos`, `--remix-audio`, `--list-media`,
`--video-start`, `--audio-start`, `--audio-duration`. They produce safer, more
reproducible results and are the only sanctioned file operations.

## Before you show a stitched video: check every join

Judge video from many frames, never a handful (Mark, 2026-11-02: judging from "a
handful of frames" is "a major major major detriment to quality"). Look at
two dozen or more frames across every clip. After every `--concat-videos`,
check each join: pull the last frame of each clip and the first frame of the
next (`--extract-last-frame` / `--extract-first-frame`) and compare them at full
size. Check:

- the same people on the same sides, with the same props and wardrobe;
- a vehicle that keeps its model, lights, mirrors, plate and passengers;
- eyelines that point at whoever is being spoken to, and motion that keeps its
  screen direction;
- the same light and time of day.

Two clips in the same framing but a different place or time read as a jump:
put a clip between them. A join that breaks continuity is a defect even when
each clip is good on its own. The Sogni Worlds Kit's `node world joins <video>`
lays out every cut of a finished film, frame by frame on both sides, in one step.

## Check that the world stays physical, and split the checking up

A video model draws whatever the prompt names, even when the first frame lacks it:
"the cars pile into a pillar" over a still with no pillar grows one down out of the
sky. On every clip, check that:

- nothing appears, vanishes or grows;
- people sit the right way in vehicles (the driver faces the wheel);
- people are in scale with doors, windows and wheels;
- props stay on the same side in every angle;
- the skyline, bridges and direction of travel agree across clips, and pursuers stay
  behind;
- a shot that should move moves;
- every sign and plate reads correctly.

Name only what the first frame shows, or put the object in the still first. Before
the user sees a stitched video, have a fresh agent with no stake in the clips run the
same list over it.

Work in parallel wherever it costs no quality: build every contact sheet in one
ffmpeg pass, then give each reviewer a few clips with their ready sheets (one reviewer
working through a whole film clip by clip took 32 minutes; split up, it takes a few).
Re-check only what changed since the last review, and submit independent renders
together, judging each as it lands. One agent keeps the edit and the final call:
helpers report what they find and never change the cut.

## Animate Between Two Images (First-Frame / Last-Frame)

When a user asks to **animate between two images**, use `--ref` (first frame) and `--ref-end` (last frame):

```bash
sogni-agent -q --video --ref ./imageA.png --ref-end ./imageB.png -o ./transition.mp4 "<4-8 sentence LTX transition paragraph>"
```

**Default model:** with both `--ref` and `--ref-end` set and no `-m`, the CLI
defaults to `ltx25-22b-int8_i2v_distilled` and its dedicated FLF template, so
write the prompt as an LTX paragraph per
[`video-prompting.md`](video-prompting.md). Pass
`-m wan_v2.2-14b-fp8_i2v_lightx2v` only when the user explicitly wants the
WAN path (silent clip). Plain single-image i2v (one
`--ref`, no end frame) defaults to `wan_v2.2-14b-fp8_i2v_lightx2v` instead.

**Always apply this pattern when:**
- User says "animate image A to image B" → use `--ref A --ref-end B`
- User says "animate this video to this image" → extract last frame, use as `--ref`, target image as `--ref-end`, then stitch
- User says "continue this video" with a target image → same as above

> **Explicit LTX-2.3 rollback: transition / morph LoRA.** When an LTX-2.3
> image-to-video render (`ltx23-22b-fp8_i2v_distilled`) is given **both** a start
> image (`--ref`) and an end image (`--ref-end`) — two keyframes — it
> automatically applies the ValiantCat transition/morph LoRA (lora id
> `transition`, trigger word `zhuanchang`, strength ~1.0), morphing the first
> image smoothly into the end image. This is a **single model-level render**, not
> a stitch — no extra flags are required for the two-frame LTX i2v path. The
> sogni-client SDK example uses `image <first>` and `end-image <last>` to supply
> the two frames (the morph LoRA engages automatically), and additionally exposes
> manual `transition` / `transition-strength` SDK arguments for the SDK path. Do
> Pin `-m ltx23-22b-fp8_i2v_distilled` to request this legacy path; LTX-2.5
> FLF does not use that LoRA. Do **not** confuse this single-render morph with the manual "Transition Between Two
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
   (No `-m` needed — the two-frame default is `ltx25-22b-int8_i2v_distilled` with the standard FLF template.)
3. **Concatenate the videos**:
   ```bash
   sogni-agent --concat-videos ./full_sequence.mp4 ./existing.mp4 ./continuation.mp4
   ```

This ensures visual continuity — the new clip picks up exactly where the previous one ended.

When the final stitched output needs a single external soundtrack, add `--concat-audio /path/to/audio.mp3` and optional `--concat-audio-start <sec>` to the same `--concat-videos` command. This is the local-agent advantage over browser-only workflows: generate clips with Sogni, then stitch and mux audio locally.

## Preserve a Specific Song or Trending Soundtrack

Treat a user-specified original/specific/trending song and its timeline as
immutable. Never ask a generative video model to imitate, recompose, remix, or
replace it, including for copyright-avoidance. For MiniMax H3 Ref2VA, author
`audio reuse` plus `<Audio N>: fully_copy` and explicit choreography times, then
stream-copy/remux the original soundtrack into the final video. `audio
reference` explicitly permits a newly generated signal and is not equivalent.
If exact dance timing is mandatory, loose R2V conditioning is insufficient;
use a pose/edit-controlled workflow or stop before rendering.

## Transition Between Two Videos (Bridge Clip)

This recipe transitions between two **finished videos**. To morph between two
**still images** in a single render, use the LTX-2.5 FLF path (see "Animate
Between Two Images" above) —
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

## Cutting takes from different models together

Learned on Sogni's own productions (2026-10):

- **Set the frame rate yourself.** `--concat-videos` uses the highest clip fps
  by default. One Wan 3 shot (30 fps) among Seedance or MiniMax H3 shots (24
  fps) turns the whole sequence into 30 fps with repeated frames. Pass
  `--concat-fps 24`.
- **Watch the joined sequence at full size.** A shot from another model often
  has a different contrast and colour from the shots around it. Point it out to
  the person: matching the grade needs a colour tool outside this CLI.
- **Listen to the last second of each clip.** Generated clips often end on a
  whoosh or swish that nothing on screen makes, and it sounds bad on a cut.
  If a clip ends on one, end the shot before it. Between scenes, a plain cut
  beats a whoosh, a synthetic whip blur or a crossfade.
- **To change what a screen or a sign shows across a moving shot,** edit the
  clip with Seedance 2.5 (`--seedance-task-type edit`), rather than tracking a
  mask and compositing. See models.md › Seedance 2.5 takes in practice.

## Multiple Angles (Turnaround) and 360 Video

Generate specific camera angles from a single reference image using the Multiple Angles LoRA:

These flags run Qwen Image Edit 2511, the only model with the Multiple Angles
LoRA. It is an older model that is never a default or a recommendation: use
`--multi-angle` / `--angles-360` only when the user asks for them (or the
Multiple Angles LoRA) by name. For an ordinary change of camera angle, edit
with `-c` on the model SKILL.md's edit-model routing picks (Krea 2 Identity
Edit for a person, FLUX 3 Image Klein for type or design).

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

## Video-to-Video (V2V) with ControlNet

```bash
# Basic v2v with canny edge detection
sogni-agent --video --workflow v2v --ref-video input.mp4 \
  --controlnet-name canny "stylized anime version"

# V2V with pose detection and custom strength
sogni-agent --video --workflow v2v --ref-video dance.mp4 \
  --ref robot-subject.png \
  --controlnet-name pose --controlnet-strength 0.7 "robot dancing"

# Seedance V2V without ControlNet
sogni-agent --video --workflow v2v -m seedance2-v2v \
  --ref-video input.mp4 "make the clip more cinematic"
```

ControlNet types: `canny` (edges), `pose` (body pose), `depth` (depth map), `detailer` (detail enhancement). LTX 2.5 `pose` requires both `--ref-video` for the motion/pose sequence and `--ref` for the subject appearance; explicit LTX 2.3 rollback keeps its existing optional-image behavior. Default strengths are tuned from Sogni Chat: `canny`/`pose`/`depth` use `0.85` plus detailer assist; `detailer` uses `1.0` for preservation. For Seedance V2V, use `-m seedance2-v2v` and omit ControlNet. Audio references must be paired with an image or video reference.

### V2V Outpaint (Canvas Extension) and Inpaint (Masked Region)

The LTX-2.5 v2v selector `ltx25-v2v` adds two control modes
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
sogni-agent -q --video --workflow v2v -m ltx25-v2v \
  --ref-video ./source.mp4 --control-type outpaint \
  --outpaint-position center --outpaint-aspect-ratio 16:9 \
  -o ./outpainted.mp4 "Extend the surrounding scene naturally"

sogni-agent -q --video --workflow v2v -m ltx25-v2v \
  --ref-video ./source.mp4 --control-type inpaint --mask ./mask.png \
  -o ./inpainted.mp4 "Replace the masked region with clean matching detail"
```

## Music-to-Video Pipeline

1. Use the provided/generated audio file as `--ref-audio`
2. If there is also a reference image, omit `--workflow` and let the CLI auto-select LTX 2.5 `ia2v`
3. If there is no reference image, omit `--workflow` and let the CLI auto-select LTX 2.5 `a2v`
4. Use `--workflow s2v` only for explicit face lip-sync with a face image
5. If only part of the song/audio should drive the clip, pass `--audio-start <sec>` and optionally `--audio-duration <sec>`
