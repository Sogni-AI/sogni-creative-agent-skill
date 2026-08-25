# Image Prompt Authoring Guide

Use this guide only when the creator asks for prompt text as the deliverable. A
prompt-only request does not authorize a render. Require both the exact target
model/version and the operation (`generate` or `edit`). If either is missing,
ask for it. If the exact pair is not registered, report that limitation; never
substitute a generic image prompt or another model's format.

## Output contracts by family

| Target family | Native prompt shape | Output envelope |
| --- | --- | --- |
| SD 1.5 | Weighted or comma-separated tags; quality/medium, subject, environment, lighting/camera | `positive_prompt:` plus `negative_prompt:` |
| SDXL | Hybrid natural language plus selective comma-separated style/quality terms; Pony variants start with their score tags | `positive_prompt:` plus `negative_prompt:` |
| FLUX.1 Schnell | One concise natural-language visual description centered on the subject, composition, light, and style; no SD score/tag soup | Prompt text only |
| Chroma 1 / v.46 / Detail | One coherent natural-language visual description; exact visible text in quotes; no SD score/tag soup | Prompt text only |
| Krea 2 / Krea 2 Turbo | Dense, fluent rich caption emphasizing observable composition, palette, light, texture, and atmosphere; no SD weighting syntax | Prompt text only |
| Qwen Image 2512 | Detailed natural-language description with explicit spatial relationships and exact quoted typography | `positive_prompt:` plus `negative_prompt:` |
| Z-Image | Compact instruction-aware natural-language caption | Foundation model: positive plus negative; Turbo: prompt text only |
| GPT Image 2 | Direct natural-language creative direction with explicit layout, hierarchy, and exact quoted copy | Prompt text only |
| Qwen / Krea / GPT edits | A direct delta instruction: what changes, what remains fixed, and the ordered role of each reference | Prompt text only |

The two-field envelope is exact: return two non-empty single lines in this
order and nothing else:

```text
positive_prompt: <model-ready positive prompt>
negative_prompt: <model-native exclusions and relevant failure modes>
```

Prompt-only families return the directly runnable prompt with no label,
Markdown fence, preamble, explanation, or render offer.

## Selector and operation discipline

- Treat a model selector as an exact capability declaration, not a name to
  fuzzy-match into a convenient family. Every selector exposed by
  `generate_image` and `edit_image` must resolve in the shared registry.
- A family can have different operation profiles. `gpt-image-2` supports
  registered generation and edit contracts. A generation-only selector such
  as `flux1-schnell-fp8` or `krea-2-turbo` must not silently accept an edit
  request.
- Use `qwen` / `qwen-lightning` as edit selectors and
  `qwen-2512` / `qwen-2512-lightning` as generation selectors.
- Use `krea-identity-edit` or
  `dark-beast-krea2-identity-edit` for Krea identity edits. Assign
  `context_image_0` as the base and `context_image_1` as the secondary
  identity/outfit/pose/style reference when two inputs are requested.
- Preserve the creator's subjects, actions, spatial relationships, exact
  visible copy, proper nouns, style, and constraints. Add supporting visual
  detail without inventing extra objects, labels, slogans, characters, or
  story events.
- Model capability selection comes from typed model and operation metadata.
  Never infer it from sentence-shape regexes or a list of creative keywords.

Primary references: [FLUX prompting](https://docs.bfl.ai/guides/prompting_unified_basics),
[Krea 2 technical report](https://www.krea.ai/blog/krea-2-technical-report),
[Qwen Image 2512](https://huggingface.co/Qwen/Qwen-Image-2512),
[Qwen Image Edit 2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511),
[Z-Image Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo), and
[Stability API](https://platform.stability.ai/docs/api-reference).
