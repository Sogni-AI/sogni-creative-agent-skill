# OpenClaw Plugin Configuration

Read this only when the skill runs as an OpenClaw plugin and you need to
inspect or explain plugin defaults. CLI flags always override these values.

When installed as an OpenClaw plugin, the skill reads defaults from
`~/.openclaw/openclaw.json` (override the location with
`OPENCLAW_CONFIG_PATH`). The supported config schema is defined in
[`openclaw.plugin.json`](../openclaw.plugin.json).

Example entry (values shown are sample overrides, not schema defaults — the
CLI defaults are 512×512 images, count 1, spark tokens, prompt-hash seeds):

```json
{
  "plugins": {
    "entries": {
      "sogni-creative-agent-skill": {
        "enabled": true,
        "config": {
          "defaultImageModel": "z_image_turbo_bf16",
          "defaultEditModel": "qwen_image_edit_2511_fp8_lightning",
          "defaultPhotoboothModel": "coreml-sogniXLturbo_alpha1_ad",
          "defaultMusicModel": "ace_step_1.5_turbo",
          "videoModels": {
            "t2v": "ltx23-22b-fp8_t2v_distilled",
            "i2v": "wan_v2.2-14b-fp8_i2v_lightx2v",
            "s2v": "wan_v2.2-14b-fp8_s2v_lightx2v",
            "ia2v": "ltx23-22b-fp8_ia2v_distilled",
            "a2v": "ltx23-22b-fp8_a2v_distilled",
            "animate-move": "wan_v2.2-14b-fp8_animate-move_lightx2v",
            "animate-replace": "wan_v2.2-14b-fp8_animate-replace_lightx2v",
            "v2v": "ltx23-22b-fp8_v2v_distilled"
          },
          "defaultVideoWorkflow": "t2v",
          "defaultNetwork": "fast",
          "defaultTokenType": "spark",
          "apiBaseUrl": "https://api.sogni.ai",
          "defaultLlmModel": "qwen3.6-35b-a3b-gguf-iq4xs",
          "defaultTaskProfile": "general",
          "defaultApiMaxTokens": 1600,
          "defaultApiThinking": false,
          "defaultApiToolMode": "creative-agent",
          "defaultWorkflowMaxCost": 25,
          "defaultWorkflowConfirmCost": false,
          "seedStrategy": "prompt-hash",
          "modelDefaults": {
            "flux1-schnell-fp8": { "steps": 4, "guidance": 3.5 },
            "flux2_dev_fp8": { "steps": 20, "guidance": 7.5 }
          },
          "defaultWidth": 512,
          "defaultHeight": 512,
          "defaultCount": 1,
          "defaultFps": 16,
          "defaultDurationSec": 5,
          "defaultImageTimeoutSec": 30,
          "defaultVideoTimeoutSec": 300,
          "defaultMusicDurationSec": 30,
          "defaultMusicTimeoutSec": 600,
          "credentialsPath": "~/.config/sogni/credentials",
          "lastRenderPath": "~/.config/sogni/last-render.json",
          "mediaInboundDir": "~/.openclaw/media/inbound"
        }
      }
    }
  }
}
```

Notes:

- Seed strategies: `prompt-hash` (deterministic) or `random`.
- `defaultCount` is clamped to the CLI's safety cap (16 unless raised with
  `SOGNI_MAX_COUNT`).
- `mediaInboundDir` defaults to `~/.openclaw/media/inbound`; when unset and
  only the legacy `~/.clawdbot/media/inbound` exists (pre-rename installs),
  the CLI falls back to it automatically.
- The API key is **never** stored in plugin config. Provide `SOGNI_API_KEY`
  via the environment the OpenClaw gateway passes to the CLI, or save it to
  `~/.config/sogni/credentials`.
