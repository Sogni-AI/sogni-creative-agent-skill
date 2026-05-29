---
name: image_editing
description: Edit, restore, restyle, refine, or change the camera angle of an existing image.
always_loaded: false
tool_names:
  - edit_image
  - restore_photo
  - apply_style
  - change_angle
  - refine_result
---

# Image editing

Edit, restore, restyle, refine, or change the camera angle of an existing image. Includes persona-conditioned edits — persona images must always be produced with `edit_image` and reference photos, never via text-to-image.

## Tools

- `edit_image` — instruction-based image editing including persona-reference flows.
- `restore_photo` — AI photo restoration (Qwen Image Edit).
- `apply_style` — artistic style transfer.
- `change_angle` — camera-angle synthesis over an existing subject.
- `refine_result` — iterative refinement of a prior result in the session.

## Constraints

- Persona images must always be produced with `edit_image` and a reference photo — never invoke `generate_image` for persona output.
- `refine_result` acts on a prior generation in the session; do not call it before any image has been produced or uploaded.
- For source-preserving style edits such as "anime version of this image", "keep everything the same", or requests that preserve pose, clothing, background, framing, or composition, use image editing with the provided image as context. Do not switch to photobooth/face-transfer just because the user asks to preserve the face.
- Photobooth/face-transfer is for generating a new portrait from a face reference. It is not full-image editing and may change pose, clothing, background, framing, and composition.
