# Private Mature-Theme Video Reference

Use this reference for lawful adult mature-theme video requests.

## Routing

Prefer `ltx23-22b-10eros-v1.4-fp8mixed_i2v` (`10eros`) for this use case. It
is a fast LTX image-to-video model with generated audio. It accepts a first
frame, a last frame, or both, and requires `--no-filter`.

Use `dr34ml4y-v3` at strength 1 with 10Eros by default. It improves mature-theme
prompt adherence, motion, and physical behavior even when no action token is
needed. Omit it only when the creator requests the base 10Eros model alone or
when comparing/troubleshooting the model and LoRA separately.

The LoRA supports:

- `ltx23-22b-fp8_i2v`
- `ltx23-22b-fp8_i2v_dev`
- `ltx23-22b-10eros-v1.4-fp8mixed_i2v` (preferred)

Sogni installs the LT3X v3 LoRA, not the separately trained WAN release. Do not
use this LoRA ID with WAN models.

## Specialized prompt vocabulary

The LoRA is one multi-concept adapter. Each token selects an action concept:

| User intent | Token |
|-------------|-------|
| Missionary position | `m15510n4ry` |
| Oral action | `bl0wj0b` |
| Two-person oral action | `d0ubl3_bj` |
| Rear-entry position | `d0gg1e` |
| Partner-on-top position | `c0wg1rl` |
| Reverse partner-on-top position | `r3v3rs3_c0wg1rl` |

Use one matching token for a clip focused on one action. Multiple tokens can be
used for sequential actions, but results may blend the concepts. For more
reliable output, render one action per clip and stitch the clips. When a single
continuous transition is preferred, keep the sequence short, describe it
chronologically, and place each token beside its corresponding action.

## Prompt construction for 10Eros + DR34ML4Y

Write the prompt solely to produce the result the creator requested. Use one
unbroken, chronological LTX paragraph:

1. Describe the supplied frame's visible composition and pose.
2. State the action concretely. Include a LoRA token when the requested action
   matches one of its trained concepts.
3. Describe what happens step by step in chronological order: who moves, which
   body parts move, their direction, changes in position or contact, and the
   resulting pose.
4. Specify shot scale, camera angle, framing, and any camera movement.
5. Integrate the audio design with the action: voice delivery, dialogue, foley,
   environmental sound, and music where relevant.

Be specific and literal. Do not substitute euphemisms or generalizations for
the requested visible action. Keep the action density appropriate for the
duration, and avoid contradictory positions, unrelated cuts, generic quality
tags, and repeating the same action in several different ways.

Write every spoken line verbatim in double quotes and identify who says it and
how. Never imply dialogue with a summary such as "they talk" or "she says
something." Keep dialogue concise enough to fit the clip and coordinate sounds
with the motion that produces them.

For first+last keyframes, describe the exact continuous change that connects
the supplied boundaries rather than reimagining either endpoint. For
last-frame-only generation, describe the preceding motion and composition that
must resolve naturally into the supplied final frame. For a same-frame loop,
describe motion that departs from and settles back into that boundary pose.

Action tokens are optional: attach the LoRA for its broader domain improvement
even when none of its specialized concepts apply. Generate multiple seeds for
difficult poses, transitions, or multi-action clips.

## Frame modes and loops

- First-frame animation: `--ref ./first.png`
- Last-frame-directed animation: `--ref-end ./last.png`
- First-to-last interpolation: use both `--ref ./first.png` and
  `--ref-end ./last.png`
- Single-render anchored loop: use the same image as both the first and last
  frame, or use deliberately matching boundary frames. Do not add `--looping`
  to this form.
- Automatic two-clip loop: use `--looping --ref ./first.png`. The CLI generates
  A→B and B→A and joins them; this mode creates its own return endpoint and
  therefore does not accept `--ref-end`.

The optional DR34ML4Y LoRA works with each compatible 10Eros frame mode.

Command shape:

```bash
sogni-agent --video --ref ./start.png -m 10eros \
  --lora dr34ml4y-v3 --lora-strength 1 --no-filter \
  "<purpose-built LTX prompt matching the creator's intended result>"
```
