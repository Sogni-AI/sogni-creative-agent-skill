---
name: asset_reference_management
description: Three-layer asset manifest (asset_id / user_label / model_ref) and per-model reference token formatting.
always_loaded: true
tool_names:
  - create_asset_manifest
  - inspect_asset
  - label_asset
  - map_assets_for_model
  - validate_asset_references
---

# Asset reference management

Keep a session-level manifest of every uploaded or generated asset and translate between three layers — the internal `asset_id` (stable), a `user_label` (what the user calls it), and a per-model `model_ref` (the literal token a target model expects in its prompt). Use these tools when the conversation involves multiple images / videos / audio so prompts stay consistent across model swaps.

## Tools

- `create_asset_manifest {assets[]}` — reset the manifest and seed it with assets (each entry needs `user_label` + `type`).
- `inspect_asset` — read by `asset_id` or `user_label`, or list all when no argument is provided.
- `label_asset {asset_id, user_label?, description?, must_preserve?, avoid?, url?}` — update fields in place.
- `map_assets_for_model {model_id}` — emit per-asset `model_ref` tokens for the target model. Indices reset per asset type so a mixed manifest emits `@Image1, @Video1, @Image2`.
- `validate_asset_references {model_id, prompt}` — scan the prompt for dangling reference tokens before dispatch.

## Per-model reference formats

| Model id | Image | Video | Audio |
|---|---|---|---|
| `seedance` (incl. `seedance2`, `seedance2-mini`, `seedance2-fast`) | `@Image1` | `@Video1` | `@Audio1` |
| `gpt-image-2`, `flux*` | `Image 1` | `Video 1` | `Audio 1` |
| `ltx23`, `wan`, `qwen-image-edit` | `context_image_0` (0-indexed) | `context_video_0` | `context_audio_0` |

## Constraints

- When a user uploads or a tool produces a new asset, register it with `create_asset_manifest` (or via a follow-up `label_asset`) before referring to it in subsequent prompts.
- Before sending a prompt that names an asset to a target model, call `map_assets_for_model` to obtain the correct `model_ref` tokens for that `model_id` — never hand-format `@Image1` / `Image 1` / `context_image_0`.
- When `validate_asset_references` reports dangling tokens, repair the prompt or re-register the missing asset rather than dispatching the workflow.
