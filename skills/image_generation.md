---
name: image_generation
description: Text-to-image synthesis with Z-Image, Krea 2, Flux, Qwen, and GPT Image 2 models.
always_loaded: false
tool_names:
  - generate_image
---

# Image generation

Text-to-image synthesis with the current Sogni image stack (Z-Image, Krea 2, Flux, Qwen, and GPT Image 2). Use when the user wants a new image generated from a prompt with no source asset.

## Tools

- `generate_image {prompt, ...}` — produce one or more images from text.

## Prompting

- Use natural-language descriptions (subject, setting, composition, lighting, style) for the next-gen models (Krea 2, Z-Image, Flux, Qwen) rather than keyword lists.
- Krea 2 favors long, detailed prompts but also handles short ones; to render text in the image, wrap the exact words in quotes (e.g. a sign reading "OPEN").
- The app applies model-specific prompt-enhancement automatically — pass the user's intent faithfully and avoid empty quality-booster spam.

## Constraints

- For persona-driven requests, defer to `image_editing` — personas must be conditioned on reference photos, never generated from scratch.
