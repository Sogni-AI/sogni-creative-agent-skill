# Seamless Tiling & Tessellations

How to render an image that repeats edge to edge without visible joins — a
seamless pattern, repeating texture, wallpaper, tiling background, or an
Escher-style tessellation of interlocking figures.

An ordinary render will **not** wrap. Diffusion models have no tiling mode
here (no circular padding is exposed), so border continuity is never
enforced — it only *emerges* when the sampled pattern happens to phase-align
with the canvas. Everything below is about stacking the odds, then checking.

## The configuration

```bash
sogni-agent -m krea2_turbo_fp8_scaled -w 1024 -h 1024 -n 4 -o tile.png \
  "<subject>, a perfect crop from an infinite repeating pattern that continues beyond every edge, <motif-scale clause>, <lighting clause>"
```

| Element | Why |
|---|---|
| `krea2_turbo_fp8_scaled` | The only model that composes edge-to-edge. `z_image_turbo_bf16` renders an object on a background instead and cannot tile. |
| **1024×1024, always** | The only size that tiles. 768, 1280, 1536, landscape, and 896×1152 all measured **0%**. It is the model's native resolution; off-native sizes never phase-align. |
| `a perfect crop from an infinite repeating pattern…` | Removes edge-framing behaviour — the model stops composing *for* a frame. |
| motif-scale clause | Sets how big the motif reads. Does **not** affect whether it tiles. |
| lighting clause | Kills the global light gradient, which is what makes opposite edges disagree. The dominant failure mode. |

### Motif scale — pick for looks, not for tiling

`the motif repeats exactly N times across and N times down`

Use **N = 1** for large bold figures or **N = 2** for a medium pattern, and
keep the two counts equal. Measured over 30 renders each: 1× and 2× both hit
**63%**, against 50% for 4× and 40% for 3× — so stick to 1 or 2 and pick
between them purely on how large you want the motif to read. This clause is a
scale dial, not a tiling requirement.

### Lighting — global evenness required, local depth optional

The constraint is *global*: no directional gradient or vignette across the
frame. Individual figures may still be shaded, which usually looks better.

- **Keep depth (recommended):** `consistent even illumination from edge to
  edge, with natural shading and depth modeled within each object` — 47%,
  and figures keep glossy highlights and three-dimensional modelling.
- **Flat graphic look:** `uniform flat lighting with no shadows or vignette`
  — 59%, slightly better odds, flatter result.

**Do not omit this clause, and do not soften it to something vague** like
"evenly lit across the frame": both measured **8%**. The wording has to
explicitly forbid the gradient and vignette.

**Palette rule:** keep the subject tonally close — one dominant colour
family. High-contrast pairings expose the seam, because a border offset in
luminance can be flattened by prompting but an offset in *chroma* cannot.

## For interlocking Escher tessellations

Phrase the subject as `photorealistic Escher tessellation of <objects>` and
add `every figure complete and recognizable, fitting its neighbors perfectly
with no gaps, no overlaps`.

`Escher tessellation` is the phrase that makes the model *deform silhouettes*
so neighbours nest. Without it you get dense packing, not tessellation.
Tested alternatives that do **not** work: "optical illusion", "negative
space", "figure-ground reversal", "interlocking silhouettes", "wallpaper",
"tessellation" alone.

Compliant rounded shapes tessellate — frogs, ducks, octopi, shells, leaves,
feathers, lizards, rubber chickens. Rigid objects (garden gnomes) resist and
fall back to packing.

## It is probabilistic — always offer several

Roughly **half** the renders wrap cleanly on a good subject, fewer on a
hard one. So generate a batch and let the user pick:

```bash
sogni-agent -m krea2_turbo_fp8_scaled -w 1024 -h 1024 -n 4 -o tile.png "<prompt>"
```

Never promise that a given result tiles without checking. To check, place
two copies side by side and look at the join, or measure it: compare the
mean difference between opposite border rows/columns against the image's own
mean adjacent-pixel difference. A ratio near 1.0 is seamless; the join is
visible from roughly 3.5 upward.

## Subjects with the best odds

Natural forms outperform kitsch — they already interlock, so the model is
not asked to invent a deformation, and their palettes are inherently tonal.

| Subject | Hit rate |
|---|---|
| iridescent teal peacock feathers | 4/4 |
| pearlescent white nautilus seashells | 3/4 |
| yellow rubber chickens | ~5/8 |
| morpho butterflies, ginkgo leaves, glass jellyfish, koi, ceramic lizards | 2/4 |
| green plastic aliens + glossy ceramic frogs | ~2/8 |

Avoid subjects that render on a white ground (origami cranes, delft
porcelain birds): they look beautiful but produce a uniform border, which
means the image is not actually edge-to-edge.

## Reference implementation

<https://infinity.sogni.ai> generates these interactively, and the
repository (`Sogni-AI/sogni-infinity`) carries the full research log,
the seam validator, and the calibration evidence behind these numbers.
