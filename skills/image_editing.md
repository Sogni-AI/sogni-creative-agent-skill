---
name: image_editing
description: Edit, restore, restyle, refine, upscale, or change the camera angle of an existing image.
always_loaded: false
tool_names:
  - edit_image
  - restore_photo
  - upscale_image
  - apply_style
  - change_angle
  - refine_result
---

# Image editing

Edit, restore, restyle, refine, upscale, or change the camera angle of an existing image. Includes deterministic RTX VSR upscaling and persona-conditioned edits — persona images must always be produced with `edit_image` and reference photos, never via text-to-image.

## Tools

- `edit_image` — instruction-based image editing including persona-reference flows.
- `restore_photo` — AI photo restoration (Qwen Image Edit).
- `upscale_image` — promptless deterministic NVIDIA RTX VSR enlargement through 16K.
- `apply_style` — artistic style transfer.
- `change_angle` — camera-angle synthesis over an existing subject.
- `refine_result` — iterative refinement of a prior result in the session.

## Constraints

- Persona images must always be produced with `edit_image` and a reference photo — never invoke `generate_image` for persona output.
- Use `-m krea2_identity_edit_v1_2` for identity-preserving Krea 2 edits with 1-2 context images; use `-m dark_beast_krea2_identity_edit_v1_2` for the Dark Beast Krea 2 identity edit LoRA. Both support 512-2048 px output, 8-12 steps, guidance 1, and default to 10 steps.
- Qwen Image Edit supports up to 3 context images, GPT Image 2 supports up to 16, and Krea identity edit models support up to 2.
- `refine_result` acts on a prior generation in the session; do not call it before any image has been produced or uploaded.
- Use `upscale_image` when the user only wants a larger, higher-resolution copy. It takes one source image plus an optional 2x/3x/4x scale or target longest edge. Both 8px-aligned output edges must remain within 512-15360px; use 7680 for 8K or 15360 for 16K. Targets above 7680px return JPG. If a scale leaves the short edge below 512px, retry with the minimum target longest edge reported by the tool. Never stretch the image, invent a prompt, or substitute `restore_photo`, `refine_result`, or `edit_image` for a pure upscale.
- For source-preserving style edits such as "anime version of this image", "keep everything the same", or requests that preserve pose, clothing, background, framing, or composition, use image editing with the provided image as context. Do not switch to photobooth/face-transfer just because the user asks to preserve the face.
- Photobooth/face-transfer is for generating a new portrait from a face reference. It is not full-image editing and may change pose, clothing, background, framing, and composition.
