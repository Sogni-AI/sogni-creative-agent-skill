---
name: composition_planning
description: "Plan and shape creative work before any media is rendered: prompt enhancement, lyric/instrumental composition, script/storyboard writing, and durable workflow plans or savable workflow templates."
always_loaded: false
tool_names:
  - enhance_prompt
  - compose_lyrics
  - compose_instrumental
  - compose_script
  - compose_workflow
  - compose_workflow_template
---

# Composition & planning

Pre-render planning tools. Each one returns plans, prompts, or text — none of them consume render credits to produce media. The caller is responsible for handing the output to a generation tool (`generate_image`, `generate_video`, `generate_music`, etc.) when the user wants to actually render.

## Tools

- `enhance_prompt` — enhance or adapt a source prompt into a model-ready image, video, music, or edit prompt. Use for prompt expansion and model-specific prompt preparation. Not for lyrics or full scripts.
- `compose_lyrics` — compose vocal song lyrics and suggested musical parameters (ACE-Step). Use for songs with words, choruses, verses, jingles, vocal hooks, or lyric rewrites. Not for instrumental-only music.
- `compose_instrumental` — compose an instrumental music structure and suggested musical parameters (ACE-Step). Use for background scores, beds, cues, themes, and music requests without lyrics.
- `compose_script` — compose scripts, storyboards, video prompts, ad concepts, trailers, social shorts, campaign beats, and talking-head plans. Use for creative writing artifacts.
- `compose_workflow` — turn a creative brief into a runnable ONE-SHOT durable creative workflow plan (the same shape `POST /v1/creative-agent/workflows` accepts). Use when the user wants to RUN a multi-step pipeline once.
- `compose_workflow_template` — turn a creative brief into a savable, parameterized workflow template plus a concrete example plan. Use when the user wants to CREATE / SAVE / DESIGN a reusable workflow recipe, or to EDIT a saved workflow.

## Constraints

- Composition tools return plans, prompts, or text — never assume they produced media. After `enhance_prompt` / `compose_lyrics` / `compose_instrumental` / `compose_script`, hand the output to the matching generation tool (`generate_image`, `generate_video`, `generate_music`, etc.) only if the user asked you to render.
- `compose_workflow` returns a one-shot durable plan; `compose_workflow_template` returns a savable, parameterized template. Pick `compose_workflow_template` only when the user wants to SAVE / NAME / REUSE the recipe; otherwise pick `compose_workflow`.
- After `compose_workflow_template` returns the `template_draft`, finalize the turn immediately — do not call render tools "to preview" the template.
- `compose_workflow` returns a plan; the caller is responsible for submitting it to `POST /v1/creative-agent/workflows` with a caller-owned `Idempotency-Key`. The plan is not idempotent on its own.
- `compose_workflow_template` returns a draft; the caller is responsible for persisting it via `POST /v1/creative-agent/workflows/templates`.
