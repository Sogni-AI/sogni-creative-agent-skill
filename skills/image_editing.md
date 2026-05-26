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
