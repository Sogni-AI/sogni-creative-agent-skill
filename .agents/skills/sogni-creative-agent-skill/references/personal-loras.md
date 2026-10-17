# Personal LoRAs

Read this when the user wants to import, inspect, remove, or render with their own LoRA. These commands use `SOGNI_API_KEY` for the same account as Sogni Web. Import and generation require Unlimited; list and removal remain available after it expires.

```bash
sogni-agent --list-personal-loras
sogni-agent --import-lora https://huggingface.co/author/repository/resolve/main/style.safetensors --personal-lora-name "My style" --personal-lora-model krea2_turbo_fp8_scaled --confirm-lora-rights
sogni-agent --get-personal-lora personal-REPLACE-WITH-RETURNED-ID
sogni-agent --list-loras --include-personal-loras --lora-catalog-model krea2_turbo_fp8_scaled
```

The import command starts asynchronous validation, which reports no live events. Check it with `--get-personal-lora` at most once a minute and show `reason`/`failureCode` on failure; on `errorType: "RATE_LIMITED"`, make no Sogni request for `metadata.retryAfterSeconds`. Only `ready` entries can render; `queued`, `validating`, and `review` need more time. `rejected` and `revoked` cannot render. Do not re-import repeatedly to poll. `--list-personal-loras` returns supported import models and current limits; discover model IDs there.

Set `--confirm-lora-rights` only when the user has confirmed permission to use that file. Hugging Face safetensors links and Civitai model/version links are accepted. An import does not train a new adapter.

Once ready, use the actual returned ID:

```bash
sogni-agent -m krea2_turbo_fp8_scaled --lora personal-REPLACE-WITH-RETURNED-ID --no-filter "a glass sculpture"
sogni-agent --video -m minimax-h3-fasth3-t2v-turbo-2stage --target-resolution 1080p --lora personal-REPLACE-WITH-RETURNED-ID --no-filter "the user's H3 prompt"
```

MOSS supports Personal LoRAs on `moss_image_sft_int8_convrot` and
`moss_image_sft_dmd8_int8_convrot`. Import for either preset; compatible entries
are shared across both. The 8-step preset keeps its built-in DMD adapter at 1.0
and applies the personal adapter after it. Personal strength controls only the
personal adapter. MOSS LoRAs cannot be used on Krea or FLUX.

First confirm the selected model occurs in the entry's `modelIds`. Preserve the user's selected model. The CLI discovers owned entries through the authenticated catalog and uses catalog defaults when strengths are omitted; repeat `--lora-strength` to set explicit ordered strengths. Follow the entry's prompt and workflow requirements. Personal imports require `--no-filter`; explain that setting when it was not already requested. H3 audio-guided modes do not support LoRAs.

`--list-loras` remains public and requires no account; add `--include-personal-loras` to merge owned ready imports. Catalog responses are account-specific. Do not share them between users.

Remove an entry only when requested:

```bash
sogni-agent --remove-personal-lora personal-REPLACE-WITH-RETURNED-ID
```

For speech, `--speech --speech-mode clone --voice-reference clip.wav` clones the supplied original recording for synthesis. It is reference conditioning, not a persistent training job; see the speech guidance in SKILL.md. Background removal, multi-view 3D, and two-stage H3 have their existing direct CLI controls; hosted equivalents are documented in [hosted-api.md](hosted-api.md).
