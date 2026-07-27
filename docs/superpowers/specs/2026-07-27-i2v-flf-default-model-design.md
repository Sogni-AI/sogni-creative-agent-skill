# i2v and First-Frame/Last-Frame Default Model — Design

Date: 2026-07-27
Status: Implemented

## Goal (per user, corrected mid-session)

- Plain single-image i2v (one `--ref`, no end frame), no model specified →
  default `wan_v2.2-14b-fp8_i2v_lightx2v`.
- Animate two images together / first-frame + last-frame (`--ref` +
  `--ref-end`), no model specified → default the LTX-2.3 transition/morph
  path: `ltx23-22b-fp8_i2v_distilled`, whose ValiantCat transition LoRA
  (trigger `zhuanchang`) auto-applies — **not** WAN.

## Findings

- Single-image i2v already defaulted to WAN via `selectDefaultVideoModel`
  (public-skill-runtime maps workflow `i2v` → WAN lightx2v). It auto-routes
  to LTX-2.3 i2v only for native-audio/story prompts or `-Q hq`/`-Q pro`.
- Two-image FLF is the same `i2v` workflow, so it **also** defaulted to WAN —
  contrary to the corrected goal. The LTX transition-LoRA auto-attach
  (`applyLtxTransitionLora` in `sogni-agent.mjs`) only fired when the agent
  explicitly passed an LTX i2v model.
- Docs never stated either default; `references/models.md`'s
  recommended-selectors table had no i2v rows at all.

## Change

**Code (`sogni-agent.mjs`, default-selection site):** when `--video` resolves
workflow `i2v` with both `refImage` and `refImageEnd`, no explicit `-m`, no
configured `videoModels.i2v`, and the runtime default is not already an LTX
model (audio/quality routing), default to `ltx23-22b-fp8_i2v_distilled`.
The existing `applyLtxTransitionLora` then auto-attaches the transition LoRA.
Precedence: explicit `-m` > configured `videoModels.i2v` > LTX audio/quality
routing > FLF-LTX default > WAN fallback.

**Unaffected by design:**

- `--looping` (injects the end frame after model selection) — stays WAN.
- `--angles-360-video` (own model resolution; LTX pairwise morphs don't
  produce true orbits) — stays WAN.
- SourceReel and loop-maker pass explicit models (WAN and LTX respectively).
- Bridge-clip recipe pins `-m wan…` explicitly (silent bridge between two
  finished videos).

**Docs/help:** default statements added to `references/models.md` (selector
tables + new "Default image-to-video routing" section, including the
audio/story-word auto-upgrade and how to pin WAN), `references/video-editing.md`
(two-image recipe + scene-continuation recipe), `SKILL.md` (core commands +
trigger patterns), `README.md`, CLI `--help`, the Claude plugin quick examples,
`references/openclaw-config.md`, and the desktop-extension `generate_video`
tool description.

**Tests:** default FLF → LTX morph model with `transition` LoRA and
`zhuanchang` trigger; explicit `-m wan…` still honored with the end frame
forwarded and no LoRA.

Left untouched: `generated/creative-agent-runtime.mjs` and hosted per-skill
`skills/*.md` (synced/parity-checked with the private sibling repo), and the
loop-maker skill (already LTX by design).
