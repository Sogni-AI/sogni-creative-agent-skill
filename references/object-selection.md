# SAM 3 object selection

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
