---
name: image_generation
description: Text-to-image synthesis with Z-Image, Krea 2, Dark Beast Krea 2, FLUX 3 Image Klein, FLUX.1 Schnell, Chroma, Qwen, and GPT Image 2 models.
always_loaded: false
tool_names:
  - generate_image
---

# Image generation

Text-to-image synthesis with the current Sogni image stack (Z-Image, Krea 2, Dark Beast Krea 2, FLUX 3 Image Klein, FLUX.1 Schnell, Chroma, Qwen, and GPT Image 2). Use when the user wants a new image generated from a prompt with no source asset.

## Tools

- `generate_image {prompt, ...}` — produce one or more images from text.

## Prompting

- Use natural-language descriptions (subject, setting, composition, lighting, style) for Krea 2, Z-Image, FLUX.1 Schnell, Chroma, and Qwen rather than keyword lists.
- Krea 2 favors long, detailed prompts but also handles short ones; to render text in the image, wrap the exact words in quotes (e.g. a sign reading "OPEN").
- Use `-m dark_beast_krea2_fp8` when the user explicitly requests Dark Beast Krea 2 or the uncensored community Krea 2 fine-tune.
- FLUX 3 Image Klein (`-m flux3_image_klein_sd_int8_convrot`; hosted selector `flux-3-klein`) works best with a full scene caption. Its guidance is fixed at 1, so a negative prompt has no effect, and it does not take LoRAs.
- The app applies model-specific prompt-enhancement automatically — pass the user's intent faithfully and avoid empty quality-booster spam.

## Constraints

- For persona-driven requests, defer to `image_editing` — personas must be conditioned on reference photos, never generated from scratch.
