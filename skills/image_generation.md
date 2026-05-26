---
name: image_generation
description: Text-to-image synthesis with Z-Image, Flux, Qwen, and GPT Image 2 models.
always_loaded: false
tool_names:
  - generate_image
---

# Image generation

Text-to-image synthesis with the current Sogni image stack (Z-Image, Flux, Qwen, and GPT Image 2). Use when the user wants a new image generated from a prompt with no source asset.

## Tools

- `generate_image {prompt, ...}` — produce one or more images from text.

## Constraints

- For persona-driven requests, defer to `image_editing` — personas must be conditioned on reference photos, never generated from scratch.
