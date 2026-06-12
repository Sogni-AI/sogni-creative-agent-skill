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
sogni-agent -q --video --ref ./imageA.png --ref-end ./imageB.png -o ./transition.mp4 "descriptive prompt of the transition"
```

**Always apply this pattern when:**
- User says "animate image A to image B" → use `--ref A --ref-end B`
- User says "animate this video to this image" → extract last frame, use as `--ref`, target image as `--ref-end`, then stitch
- User says "continue this video" with a target image → same as above

## Animate a Video to an Image (Scene Continuation)

1. **Extract the last frame** of the existing video:
   ```bash
   sogni-agent --extract-last-frame ./existing.mp4 ./lastframe.png
   ```
2. **Generate a new video** using the last frame as `--ref` and the target image as `--ref-end`:
   ```bash
   sogni-agent -q --video --ref ./lastframe.png --ref-end ./target.png -o ./continuation.mp4 "scene transition prompt"
   ```
3. **Concatenate the videos**:
   ```bash
   sogni-agent --concat-videos ./full_sequence.mp4 ./existing.mp4 ./continuation.mp4
   ```

This ensures visual continuity — the new clip picks up exactly where the previous one ended.

When the final stitched output needs a single external soundtrack, add `--concat-audio /path/to/audio.mp3` and optional `--concat-audio-start <sec>` to the same `--concat-videos` command. This is the local-agent advantage over browser-only workflows: generate clips with Sogni, then stitch and mux audio locally.

## Transition Between Two Videos (Bridge Clip)

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
     -o ./transition.mp4 "descriptive morph between the two scenes"
   ```
3. Concatenate A → transition → B:
   ```bash
   sogni-agent --concat-videos ./merged.mp4 ./videoA.mp4 ./transition.mp4 ./videoB.mp4
   ```

> **i2v clips are silent and use the model's own frame rate** (often not 24). `--concat-videos` normalizes fps/size and fills silent audio automatically, so mismatched clips stitch correctly — but passing `--fps` to the transition generation keeps things clean from the start. Use `--concat-fps <n>` to force a specific output frame rate.

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

## Music-to-Video Pipeline

1. Use the provided/generated audio file as `--ref-audio`
2. If there is also a reference image, omit `--workflow` and let the CLI auto-select LTX 2.3 `ia2v`
3. If there is no reference image, omit `--workflow` and let the CLI auto-select LTX 2.3 `a2v`
4. Use `--workflow s2v` only for explicit face lip-sync with a face image
5. If only part of the song/audio should drive the clip, pass `--audio-start <sec>` and optionally `--audio-duration <sec>`
