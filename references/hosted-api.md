# Hosted Sogni Intelligence API Modes

Read this when a request should be planned, multi-step, resumable, or
server-orchestrated: `--api-chat`, `--durable-chat`, `--api-workflow`,
workflow templates, replay records, and the hosted tool surfaces.
All hosted modes require `SOGNI_API_KEY`.

## When to prefer the hosted path

For any natural-language creative request that benefits from tool selection,
repair, or durable workflows, prefer the hosted Sogni Intelligence endpoints
over direct-to-SDK media flags. They are the canonical home for
OpenAI-compatible chat, server-side creative tool dispatch, Structured
Contracts v1 (gating policies, repair recipes, prompt contracts), durable chat
runs, durable workflows, workflow templates, replay, and asset-manifest
mapping.

```bash
# Natural-language creative request (LLM picks the tool, dispatches, repairs)
sogni-agent --api-chat "Turn the attached product photo into a launch poster" --ref product.jpg

# Durable hosted chat run (persisted event log + SSE stream)
SOGNI_SKILL_USE_SDK_TRANSPORT=1 sogni-agent --durable-chat \
  "Create a four-shot launch campaign, generate the key art, and animate the hero clip"

# Multi-step durable workflow (resumable, replay-friendly, server-orchestrated)
sogni-agent --api-workflow \
  --video-prompt "The camera slowly pushes in" \
  "A graphite robot sketch on a drafting table"

# Storyboard → GPT Image 2 sheet → Seedance, all server-side
sogni-agent --api-workflow storyboard-video --storyboard-frames 6 -Q hq \
  "Create a 9:16 bakery launch video with a neon street-window reveal"
```

The direct-to-SDK flags remain available for explicit one-shot generation when
you already know the exact model, dimensions, and prompt and don't need LLM
planning — use them when latency or cost rules out the LLM round-trip.

## --api-chat (`POST /v1/chat/completions`)

Text-first natural-language workflows through Sogni API's OpenAI-compatible
loop. The public REST body uses snake_case controls such as `tool_choice`,
`response_format`, `task_profile`, `token_type`, `app_source`,
`media_references`, `chat_template_kwargs`, `sogni_tools`, and
`sogni_tool_execution`. The endpoint normalizes OpenAI `developer` messages to
`system`; when a developer message is present and no explicit `task_profile`
is supplied, the server treats the task as `coding`. The CLI sanitizes
prompt-injection markers before forwarding messages and sends API-key auth so
hosted Sogni tools can execute server-side.

Tune with `--api-tools creative-agent|creative-tools|none`,
`--no-api-tool-execution`, `--llm-model <id>`, `--system <text>`,
`--task-profile general|coding|reasoning`, `--max-tokens <n>`, and
`--thinking` / `--no-thinking` (forwarded as
`chat_template_kwargs.enable_thinking`; hosted Qwen may normalize thinking
server-side, so do not rely on `--no-thinking` as a hard suppression switch).

### Hosted tool surfaces (`sogni_tools`)

- `creative-tools` — the public API default when `sogni_tools` is omitted or
  true. Generation/editing tools (`generate_image`, `generate_video`,
  `generate_music`, `edit_image`, `apply_style`, `restore_photo`,
  `refine_result`, `animate_photo`, `change_angle`, `video_to_video`,
  `stitch_video`, `orbit_video`, `dance_montage`, `sound_to_video`,
  `extend_video`, `replace_video_segment`, `overlay_video`, `add_subtitles`),
  media-analysis tools (`analyze_image`, `analyze_video`, `extract_metadata`),
  and lightweight composition tools (`enhance_prompt`, `compose_lyrics`,
  `compose_instrumental`, `compose_script`).
- `creative-agent` — this CLI's default for `--api-chat`. Includes
  `creative-tools` plus session-control tools (`ask_clarifying_question`,
  `finalize_response`), asset-manifest tools (`create_asset_manifest`,
  `inspect_asset`, `label_asset`, `map_assets_for_model`,
  `validate_asset_references`), and durable planning tools
  (`compose_workflow`, `compose_workflow_template`). Use this surface when the
  model should design one-shot workflow plans, draft savable workflow
  templates, or maintain stable asset references across a multi-step turn.
- `none` — disables Sogni tool injection, leaving only caller-supplied OpenAI
  tools on raw API/SDK requests. In the CLI, combine with
  `--no-api-tool-execution` for text-only planning.

## --durable-chat (`POST /v1/chat/runs`)

Long-running, LLM-in-the-loop turns persisted as chat-run records instead of a
single completion request. Chat runs keep an event log, stream via
`/v1/chat/runs/:id/events/stream`, support cancellation, and can pause for
persisted cost approval (`/v1/chat/runs/:id/confirm-cost`) in first-party
clients. Requires `SOGNI_SKILL_USE_SDK_TRANSPORT=1`. The CLI streams assistant
deltas plus de-duplicated per-job progress / ETA / result lines from hosted
run events. The SDK exposes `sogni.chat.runs.{create, get, cancel,
streamEvents}`.

## --api-workflow (`POST /v1/creative-agent/workflows`)

Durable, async workflow records with event streaming and cancellation. The
API accepts either an inline durable plan (`input.steps`) or a saved workflow
template invocation (`workflow_id` plus `inputs`) and rejects requests that
provide both. The CLI's generated-keyframe and `storyboard-video` presets
submit inline `input.steps`; `--workflow-input <json|@path>` supplies the
`input` object directly (use `@path` to load from a file).

- Saved template CRUD lives at `/v1/creative-agent/workflows/templates`; run a
  saved template later with `workflow_id + inputs`. Draft savable templates
  with `compose_workflow_template` through `--api-chat` — the caller persists
  the returned `template_draft`.
- Exact multi-step plans should use explicit step dependencies, including
  `replace_video_segment` steps with bounded `replacementStartSeconds` /
  `replacementEndSeconds` when interleaving existing video slices. Workflow
  JSON can bind request media into step arguments with
  `sourceStepId: "$input_media"`.
- `--api-workflow storyboard-video` generates a storyline, creates one GPT
  Image 2 storyboard sheet, then feeds that artifact into Seedance as the
  video reference. `-Q fast|hq|pro` maps to GPT Image 2 low|medium|high
  quality for the storyboard sheet.
- Cost controls: `--workflow-max-cost <n>` rejects workflow starts above a
  capacity-unit ceiling; `--confirm-cost` / `--no-confirm-cost` forward
  explicit billing confirmation. Use `--workflow-idempotency-key <key>` when
  retrying a start request.
- Manage runs with `--watch-workflow`, `--list-workflows`,
  `--get-workflow <id>`, `--workflow-events <id>`, `--stream-workflow <id>`,
  `--cancel-workflow <id>`, `--resume-workflow <id>`. In `--json` mode, SSE
  progress frames stream to stderr so stdout stays a single JSON object.

```bash
# Durable workflow with a media reference and a cost ceiling
sogni-agent --api-workflow --ref https://cdn.example.com/sketch.png \
  --workflow-max-cost 25 --confirm-cost \
  --video-prompt "The camera slowly pushes in as the sketch comes alive" \
  "Animate the referenced sketch"

# Exact durable workflow input
sogni-agent --api-workflow --workflow-input @workflow.json \
  --workflow-idempotency-key product-teaser-v1
```

## Media references in hosted modes

Hosted API requests forward media references from `-c`, `--ref`, `--ref-end`,
`--ref-audio`, `--reference-audio-identity`, and `--ref-video` as
`media_references` metadata. `--ref-audio` and `--ref-video` are repeatable in
api-chat / durable-chat mode — each entry uploads independently and is exposed
to the hosted LLM as `@Audio1` / `@Audio2` / `@Video1` etc. API chat also
attaches image refs as vision inputs. Local file references are uploaded to
Sogni media storage first, then forwarded as retrievable URLs so durable
executors do not depend on `data:` URI support. **Use direct CLI mode for
private media that must not leave the local machine.**

## Seedance reference modes (mutually exclusive)

When `--video -m seedance2` or `-m seedance2-fast` is selected, pick one mode
per video request:

- **Dedicated frame mode — `--ref` and/or `--ref-end`.** First-class
  first-frame / last-frame anchoring; the Seedance worker pins them as
  parameter-mode firstFrame / lastFrame. Max 2 images.
- **Loose reference mode — `-c/--context` plus optional `--ref-audio` and
  `--ref-video` extras.** Anchor frame intent in the prompt with `@Image1` /
  `@Video1` / `@Audio1` etc. (e.g. *"Use @Image1 as the opening shot
  reference"*). Supports up to 9 image refs, 3 video refs, 3 audio refs, and
  12 total reference assets per request (canonical caps come from
  `SEEDANCE_REFERENCE_LIMITS` / `validateSeedanceReferenceCounts()` in
  `@sogni-ai/sogni-intelligence-client/tools`).

Combining `--ref` / `--ref-end` with `-c/--context` on Seedance is rejected
client-side with an error pointing at the correct mode. In CLI direct-gen
mode, additional `--ref-audio` / `--ref-video` entries beyond the first must
be HTTPS URLs (the primary entry can still be a local file); for local
multi-file Seedance uploads, use `--api-chat` / `--durable-chat` instead.
Seedance accepts public HTTPS image, video, and audio references that pass the
CLI URL safety checks; localhost and private-network URLs are rejected before
forwarding. Audio references must be paired with an image or video reference.

## Models, replays, and contract debugging

- `--list-api-models` / `--get-api-model <id>` inspect `/v1/models`.
- `--list-replays [n]`, `--get-replay <id>`, `--ingest-replay <json|@path>`
  manage `/v1/replay/records` RunRecords for replay/debug viewers. List/get
  output is run through `redactRunRecord` before printing, so signed URLs,
  bearer tokens, JWTs, and PEM blocks cannot leak via the CLI.
  `--skip-redact` / `--no-redact` bypass redaction (debug-only).
- `--turn-classify`, `--compile-tools`, `--dispatch-tool <name>` (+
  `--tool-args <json>`) print the public-skill Structured Contracts v1
  verdicts (turn policy, compiled tool surface, dispatch verdict) the default
  contract runtime would produce.
- `--storyboard-plan` builds a storyboard project locally
  (`buildStoryboardProject` + `compileForModel`) and prints the plan as JSON
  without network calls. It expects scene-structured prompt input
  (`SCENE NN - Title` / `VISUAL:` / `ACTION:` / `CAMERA:` / `AUDIO/SFX:`
  blocks) — for casual prompts use `--api-workflow storyboard-video`, which
  runs an LLM storyline expansion first. Pair with
  `--storyboard-plan-frames`, `--storyboard-plan-model` (seedance, seedance2,
  gpt-image-2, ltx23, wan), `--storyboard-plan-stage` (storyboard_image,
  scene_clip).

## Endpoint safety

Override the API origin with `--api-base-url`, `SOGNI_API_BASE_URL`, or
`SOGNI_REST_ENDPOINT`. Hosted API credentials are only sent to
`https://api.sogni.ai` by default. Add trusted custom hosts with
`SOGNI_API_ALLOWED_HOSTS`; loopback or non-HTTPS local testing requires
`SOGNI_ALLOW_UNSAFE_API_BASE_URL=1`. With `SOGNI_SKILL_USE_SDK_TRANSPORT=1`,
hosted workflow + chat operations route through the SDK transport; the skill's
`sogni-hosted-client.mjs` factory still validates `restEndpoint` /
`socketEndpoint` against the SSRF guard before constructing the SDK client.
