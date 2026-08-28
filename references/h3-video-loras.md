# MiniMax H3 video LoRA catalog

The adapters Sogni publishes for MiniMax H3 — the only video family that loads
LoRAs. Everything else (LTX, WAN, Seedance, HappyHorse) ignores `--lora`, and
the CLI refuses the combination rather than rendering as if you had not asked.

Video LoRAs are a different shape from the Krea 2 image sliders:

- **Positive-only.** A negative strength is not an inverse effect, and `0` is
  off. The bipolar convention belongs to the Krea 2 image sliders alone.
- **One file per family**, not one per effect.
- **Availability differs by H3 mode.** Read the live catalog for the exact mode
  you are rendering; the mode's canonical model id is the filter.

## Selecting a compatible model

LoRAs attach to the resolved H3 model, so name the mode in the same command:

| Mode | Selector | Canonical model id |
|------|----------|--------------------|
| Text-to-video | `-m minimax-h3-t2v` (`-turbo`) | `minimax-h3-fl2va-fp8_t2v` |
| Image-to-video | `-m minimax-h3-i2v` (`-turbo`) | `minimax-h3-fl2va-fp8_i2v` |
| First+last frame | `-m minimax-h3-flf2v` (`-turbo`) | `minimax-h3-fl2va-fp8_flf2v` |
| Reference-to-video | `-m minimax-h3-r2v` (`-turbo`) | `minimax-h3-ref2va-fp8_r2v` |

Bare `-m minimax-h3` is not enough to validate a LoRA request: it resolves by
frame arguments, and availability differs per mode. Name the explicit mode.
The Balanced PDD selectors do not currently publish user-selectable adapters
(as of 2026-08); their built-in PDD acceleration dependency is not a custom
LoRA slot. The live catalog remains authoritative if that changes.

## Published adapters

`h3-realism-people` (fal) — a realism pass trained on live-action footage of
people. Restores skin texture and pores, stray hairs, fabric weave, and a fine
sensor grain the base model smooths away; holds up in close-up. Range `0-2`,
catalog default `0.8`, usable band `0.6-1`. **It needs its trigger word**: put
`r34l1sm` near the FRONT of the prompt, or the render comes back as ordinary H3
with no error. It also pulls the camera in as it climbs — at `1.5` and above the
shot reliably recomposes and the grade darkens, which on an image-conditioned
mode can crop the subject out of the frame you supplied. Prefer the default when
you supplied a first or last frame.

`h3-vbvr-video-reasoning` — a prompt-adherence pass that holds the model to what
was asked instead of improvising. Range `0-1`, default `1`, usable band
`0.7-1`. No trigger word. Opt-in mature-capable; requires `--no-filter`.

`h3-mystic-xxx-v4` — an uncensored all-round adult adapter that keeps motion,
temporal consistency, and fine detail. Range `0-1`, default `1`, usable band
`0.2-1`. No trigger word. Requires `--no-filter`.

Only `h3-realism-people` is published on every mode. Ref2VA carries it alone.

## Usage

```bash
# Single adapter at its catalog default strength
sogni-agent --video --ref shot.png -m minimax-h3-i2v \
  --lora h3-realism-people "r34l1sm, a slow push-in as she looks up"

# Explicit strength, and a stack (order matters — adapters do not commute)
sogni-agent --video -m minimax-h3-t2v --no-filter \
  --loras h3-realism-people,h3-vbvr-video-reasoning \
  --lora-strengths 0.8,0.9 "r34l1sm, a welder lowers her mask"
```

Omitting `--lora-strengths` applies each adapter's **catalog default**. Sending
a LoRA to the worker with no strength at all falls back to `1.0`, which for
`h3-realism-people` is already the top of its band — so the CLI fills the
catalog default in for you rather than letting that happen. Stack up to 8.

## Live catalog is the source of truth

This page is a snapshot. Sogni publishes and retires adapters without a skill
release, so read the catalog before relying on an exact range:

```bash
sogni-agent --list-loras --lora-catalog-model minimax-h3-fl2va-fp8_i2v
sogni-agent --json --list-loras --lora-catalog-model minimax-h3-ref2va-fp8_r2v
```

The CLI validates `--lora` against exactly this catalog for the model you
selected, so an id it accepts is an id the render will actually load, and a
wrong id fails before it costs a render. A LoRA the model cannot load is dropped
silently server-side — that check is what stops it reaching that point.
