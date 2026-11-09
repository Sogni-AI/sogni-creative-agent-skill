# SAM 3 object selection

For a moving object, use video selection:

```bash
sogni-agent --segment-video clip.mp4 --segment-text "unicorn horn" --segment-frame 126 -o horn-mask.mp4
sogni-agent --segment-video clip.mp4 --segment-point 0.45,0.6 --segment-exclude 0.1,0.1 -o object-mask.mp4
```

`--segment-video` uses `sam3_video_segment_fp16` and submits one paid project
for the complete clip. The result is a lossless binary mask MP4 with the
source's dimensions, frame count and frame rate. White selects the object.
The zero-based `--segment-frame` says which source frame the prompt describes;
tracking runs forward and backward from it. `--segment-object` chooses a
text-detected candidate in confidence order, starting at zero. Click prompts
select one object. Coordinates are normalized against the complete source frame.

Video selection accepts a constant-frame-rate SDR source up to 30 seconds,
900 frames, 2560 pixels on either edge and 100 MB. Inspect the mask over the
original video at native size, including chunk boundaries and occlusions,
before using it for compositing or moving hotspot outlines.

### Video selection options (JavaScript SDK only)

`sam3VideoPrompt` has four optional fields. The CLI has no flags for them: do
not invent any. Send them through the JavaScript SDK (5.80.0 or later) in
`sam3VideoPrompt`. A prompt without them runs and is priced exactly as before.

- `mask` selects a drawn region instead of text, points or boxes. `polygons`
  holds 1 to 64 rings of normalized `[x, y]` points (3 to 2048 per ring, 8192
  per region); a ring inside another ring is a hole. The region starts the
  tracker on its prompt frame, as a click does, so that frame's mask is the
  tracker's shape of the region, not the exact drawing. Draw it tight: any
  background or foreground object inside it stays in the mask for several
  frames. It cannot be combined with `text`, `points`, `boxes`, `threshold` or
  `multimask`, and `objectIndex` must be 0 or left out.

  ```json
  { "frameIndex": 0, "mask": { "polygons": [[[0.42, 0.18], [0.58, 0.18], [0.61, 0.55], [0.39, 0.55]]] } }
  ```

- `objects` tracks 2 to 16 things together, one selection each, and requires
  `combine: "union"`. Every output frame is the union of their masks, all
  selected on the top-level `frameIndex`. Use it for a crowd or several
  separate things: one selection that covers several similar things settles on
  just one of them. Top-level selection fields are refused alongside it.

  ```json
  { "combine": "union", "objects": [
    { "points": [{ "x": 0.21, "y": 0.48, "label": "positive" }] },
    { "points": [{ "x": 0.52, "y": 0.45, "label": "positive" }] }
  ] }
  ```

- `frames` gives the same selection on 2 to 8 different frames, each entry
  with its own `frameIndex`. Each output frame follows the nearest prompted
  frame (ties go to the earlier one). For a loop whose first and last frames
  are the same still, select the same thing on frame 0 and on the last frame.
  It cannot be combined with `objects` or with a top-level `frameIndex` or
  selection.

  ```json
  { "frames": [
    { "frameIndex": 0, "points": [{ "x": 0.47, "y": 0.62, "label": "positive" }] },
    { "frameIndex": 120, "points": [{ "x": 0.47, "y": 0.62, "label": "positive" }] }
  ] }
  ```

- `memory` sets how tracking carries between 32-frame chunks. `"chunk"`, the
  default, starts each chunk from the previous chunk's last mask; an object
  lost at the end of a chunk is not found again. `"anchor"` starts each chunk
  again from the prompt frame: errors do not carry over and a lost object can
  be found again, but the mask can shift where a chunk starts.

  ```json
  { "text": "unicorn horn", "frameIndex": 127, "memory": "anchor" }
  ```

A prompt holds at most 16384 region points and 1 MiB in all. Each object after
the first adds 8% of a one-object job's price; anchor memory adds 1/31;
`frames` and `mask` add nothing. Pass the job's `sam3VideoPrompt` to
`estimateVideoCost()` for the quote. These options run on Comfy worker
1.0.253 or newer; when none is online the request is refused at once with
error 4044, before any charge.

## Still-image selection

Use SAM 3 when a task needs an object mask from an existing still, for example
selecting a door before directing an edit. Coordinates refer to the original
image, normalized from 0 to 1, with the origin at the top left.
Use an upright original under 24 MB with each edge between 256 and 2560 pixels.

```bash
sogni-agent --segment original.png --segment-point 0.45,0.6 --segment-exclude 0.1,0.1 -o mask.png
sogni-agent --segment original.png --segment-text "the red backpack" --segment-box 0.2,0.2,0.8,0.9 -o mask.png
```

These commands submit one paid SAM 3 project using the configured account.
Include points identify the object; exclude points remove unwanted areas.
The result is one lossless binary PNG at the original dimensions. White selects
the object. Inspect the full-size mask before paying for a downstream edit.

The command selects `sam3_image_segment_bf16`, uses one inference step and no
previews, and keeps the content filter enabled. Do not supply output dimensions,
generation prompts, or another generation mode. It requires client 5.31.0 or later;
the package pins the compatible runtime. `--segment-box` accepts normalized
left,top,right,bottom bounds. A point may select only a flame, window, or other
subpart. To select a complete object, refine with a short text label and a box,
then inspect the actual SAM mask. Never use the box itself as a substitute mask.
Text and points cannot be combined. Limits: 240 text characters, 32 points,
16 boxes; point prompts accept at most one box.

Keep the original still as the edit reference. When the edit model supports only
context images, a binary mask is a visual selection guide, not a strict inpainting
constraint. Review what changed outside the selection as well as inside it.
A registered character needs its saved reference images; an object label or
character name cannot preserve identity.

For a branching world, create a destination **still** from the original and
selection, then animate between the original parent and destination stills at
matching aspect ratios. Every subsequent node starts from that generated still.
Never promote an extracted video frame or a screenshot into the canonical scene.

The CLI capability is separate from hosted chat tool discovery. Do not invent a
hosted `segment_image` tool: inspect the connected tool catalog before dispatching
through chat. Use the CLI or SDK when segmentation is absent there.
