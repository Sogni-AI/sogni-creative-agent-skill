# Krea 2 LoRA catalog

The 25 LoRAs Sogni publishes for the Krea 2 family. Every one of them works on
every Krea 2 based model:

- `krea2_turbo_fp8_scaled` — Krea 2 Turbo text-to-image
- `krea2_identity_edit_v1_2` — Krea 2 Identity Edit v1.2
- `krea2_identity_edit_sogni_v0_3_alpha` — Sogni identity edit alpha
- `dark_beast_krea2_fp8` — Dark Beast community text-to-image fine-tune
- `dark_beast_krea2_identity_edit_v1_2` — Dark Beast community identity edit

No other model family accepts these IDs.

## Live catalog is the source of truth

This page is a snapshot. Sogni publishes, retunes, and retires LoRAs without a
skill release, so read the live catalog before you rely on an exact range:

```bash
sogni-agent --list-loras --lora-catalog-model krea2_turbo_fp8_scaled
sogni-agent --search-loras skin
sogni-agent --list-loras --lora-category lighting
sogni-agent --json --list-loras          # full contracts, incl. descriptions
```

`--list-loras` goes through the SDK's `projects.availableLoras({ modelId })`,
which reads the same public catalog the web app renders its LoRA browser from
and applies the model filter server-side. Each row carries the hard range, the
recommended range, the default, the step, the bipolar direction labels, and the
creator and license. Results are cached for five minutes.

From code, use the SDK directly — the catalog is public, so this needs no
credentials and no socket:

```js
const { loras, models, constraints } = await sogni.projects.availableLoras({
  modelId: 'krea2_turbo_fp8_scaled'
});
// loras[]     — loraId, name, description, modelIds, ui{min,max,default,step,
//               recommendedMin, recommendedMax, rangeLabels, category,
//               section, nsfw, sexual, creator, sourceUrl, license, examples}
// models[]    — every model id that accepts LoRAs, ignoring the filter
// constraints — { maxPerRequest: 8, minStrength: -100, maxStrength: 100 }

const warmLight = await sogni.projects.getLora('krea2-warm-light');
if (await sogni.projects.supportsLoras(modelId)) { /* offer a LoRA control */ }
```

Never hard-code which models take LoRAs or how many stack — `models` and
`constraints.maxPerRequest` are served so that list stays correct when a LoRA
ships for a new model.

## Applying them

Order is significant and strengths are positional — `loraStrengths[i]` applies
to `loras[i]`:

```bash
sogni-agent -m krea2_turbo_fp8_scaled \
  --lora krea2-detail-enhancer --lora-strength 3 \
  --lora krea2-amateur --lora-strength -2 \
  "candid editorial street portrait at dusk"
```

`--loras a,b,c` and `--lora-strengths 1,2,3` are the comma-separated equivalents.

They apply to identity edits too — stack a LoRA on a context edit to shift age,
build, skin, or lighting while the identity LoRA holds the likeness:

```bash
sogni-agent -m krea2_identity_edit_v1_2 -c ./portrait.jpg \
  --lora krea2-age --lora-strength -3 \
  "same person, same outfit and background"
```

The hosted `generate_image` and `edit_image` tools take the same two arrays under
`loras` and `loraStrengths`. On `edit_image` they apply only when the model is
`krea-identity-edit` or `dark-beast-krea2-identity-edit`; Qwen and GPT Image 2
load no LoRAs and the ids are dropped.

- Up to 8 LoRAs per render — read `constraints.maxPerRequest` rather than
  assuming; the render pipeline rejects anything over it at submit.
- Omitted strengths default to 1, which is **not** every LoRA's own default —
  `krea2-chest-firmness`, `krea2-nipple-projection`, and `krea2-height` default
  to 0, and several community fine-tunes default below 1. Pass explicit
  strengths rather than relying on the fallback.
- Most of these are **bipolar sliders**: negative values apply the inverse
  effect and 0 disables it. Never clamp them to 0-2 — follow the range below.
- The first render with an uncached LoRA pauses while the worker downloads it.

**Safety rule the platform enforces:** `krea2-age` at a negative strength is
rejected outright when combined with `krea2-mystic-x` or `krea2-realism-engine`
(the two LoRAs flagged `sexual`). Keep Age at 0 or above in any adult context.
Only `krea2-aberrant`, `krea2-mystic-x`, and `krea2-realism-engine` are
mature-gated; the body sliders are not.

## Detail and composition

| LoRA ID | Name | Range | Recommended | Default | Direction |
|---------|------|-------|-------------|---------|-----------|
| `krea2-detail-enhancer` | Detail Enhancer | -5 to 5 | -2 to 5 | 1 | Less Detailed → More Detailed |
| `krea2-scene-complexity` | Scene Complexity | -10 to 10 | -4 to 4 | 1 | Simpler Scene → More Complex |
| `krea2-wetness` | Wetness | -3 to 3 | -3 to 3 | 1 | Drier → Wetter |
| `krea2-skin-detail` | Skin Detail | -10 to 10 | -0.5 to 3 | 1 | Smoother Skin → More Skin Detail |
| `krea2-zoom` | Zoom | -10 to 10 | -5 to 5 | 1 | Zoomed Out → Zoomed In |

## Art direction

| LoRA ID | Name | Range | Recommended | Default | Direction |
|---------|------|-------|-------------|---------|-----------|
| `krea2-realism` | Illustrated ↔ Realistic | -2 to 2 | -1 to 1 | 1 | More Illustrated → More Photoreal |
| `krea2-amateur` | Professional ↔ Amateur | -5 to 5 | -2 to 2 | 1 | More Professional → More Amateur |
| `krea2-candid` | Editorial ↔ Candid | -10 to 10 | 3 to 9 | 3 | More Editorial → More Candid |
| `krea2-purple-grainy` | Purple Grainy | -2 to 2 | -1 to 1.5 | 1 | Clean & Saturated → Grainy & Muted |

## Lighting

| LoRA ID | Name | Range | Recommended | Default | Direction |
|---------|------|-------|-------------|---------|-----------|
| `krea2-afterlight` | Afterlight | -1.2 to 1.2 | 0.25 to 1.2 | 0.75 | Cooler Light → Golden Afterlight |
| `krea2-warm-light` | Warm Light | -10 to 10 | -3 to 3 | 1 | Cooler & Darker → Warmer & Golden |

## Character

| LoRA ID | Name | Range | Recommended | Default | Direction |
|---------|------|-------|-------------|---------|-----------|
| `krea2-height` | Height | -5 to 5 | -3 to 3 | 0 | Shorter → Taller |
| `krea2-weight` | Weight | -3 to 3 | -3 to 3 | 1 | Leaner → Heavier |
| `krea2-age` | Age | -10 to 10 | -3 to 8 | 1 | Younger → Older |
| `krea2-skin-tone` | Skin Tone | -4 to 4 | -1.5 to 1.5 | 1 | Lighter Tone → Darker Tone |
| `krea2-hourglass-figure` | Figure | -1.5 to 1.5 | 0.7 to 1 | 0.8 | Less Hourglass → More Hourglass |
| `krea2-breast` | Chest Size | -5 to 5 | -2 to 4 | 1 | Smaller Chest → Larger Chest |
| `krea2-chest-firmness` | Natural Sag → Firm | -8 to 8 | -5 to 5 | 0 | Natural Sag → Firm |
| `krea2-nipple-projection` | Nipple Flat → Protruding | -10 to 10 | -5 to 5 | 0 | Flat → Protruding |

The three chest sliders are anatomy controls that the web app groups under one
"Chest" section. Apply them only when the creator asks for that adjustment.

## Prompt control

| LoRA ID | Name | Range | Recommended | Default |
|---------|------|-------|-------------|---------|
| `krea2-filter-bypass-2` | Krea2FilterBypass 2vector | 0 to 100 | 1 to 2 | 1 |
| `krea2-filter-bypass-3` | Krea2FilterBypass 3vector | 0 to 100 | 1 to 2 | 1 |

Both steer Krea 2 away from its normalized archetypes — the "resting Krea 2
face" problem — and improve prompt adherence, expressive emotion, and anatomy.
Reach for the 2-vector version first and the 3-vector version when it is not
enough. Use the lowest strength that works; 1, 2, and 100 are the common values,
and higher values trade image quality for control.

## Popular community fine-tunes

These are full concept fine-tunes, not sliders. Each carries its own subject and
style bias, so treat one as a look you build on rather than a finishing pass.

| LoRA ID | Name | Range | Recommended | Default | Creator |
|---------|------|-------|-------------|---------|---------|
| `krea2-realism-engine` | Realism Engine v3 | 0 to 2 | 0.5 to 1 | 0.8 | razzz |
| `krea2-bloomgirls` | BloomGirls UltraRealism | 0 to 2 | 0.4 to 1 | 0.8 | coolstrad |
| `krea2-mystic-x` | Mystic X | 0 to 2 | 0 to 1 | 1 | alcaitiff |
| `krea2-aberrant` | Aberrant | 0 to 2 | 0.2 to 1.5 | 0.75 | alcaitiff |

- **Realism Engine v3** pushes toward photographic realism and carries mature
  subject knowledge the base model lacks. Above ~1.0 skin turns plastic. It
  often pairs well with a filter-bypass LoRA.
- **BloomGirls** is the polished lifestyle/influencer look: soft bloom, richer
  saturation, smooth skin, close phone-camera framing. It restyles face and hair
  as well as the grade. Trained on the token `bl00m`, which only nudges the
  result. Holds together to ~1.0 on Turbo at 8 steps; smears by 2.0.
- **Mystic X** is an all-round uncensored adult fine-tune; keep it at or below
  1, and the author recommends euler/beta at 12 steps.
- **Aberrant** adds industrial body-horror: dirt, scars, and mechanical
  undertones low; fused tissue and rusted metal high.

`krea2-mystic-x` and `krea2-realism-engine` are flagged NSFW and sexual in the
catalog; `krea2-aberrant` is flagged NSFW. Honor the creator's intent and the
usual mature-content handling when selecting them.
