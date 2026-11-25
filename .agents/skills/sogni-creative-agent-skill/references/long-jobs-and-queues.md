# Long jobs, queued work, and results after a session

Sogni projects run on the network, not in the CLI process. A project keeps
going when the CLI stops waiting, when its connection drops, and when no agent
is connected at all. These commands follow a project by id instead of holding a
connection open for its whole life.

## Rendering on Relaxed

`--network relaxed` (or `defaultNetwork: "relaxed"` in the plugin config) sends a
render to the Relaxed Supernet. It is included in Sogni Unlimited, including while
Fast is paused at the plan's fair-use capacity. Relaxed has far fewer workers, so a
video can wait for hours. Anything unfinished 24 hours after you submit it is
cancelled, and a project no online worker can run is cancelled much sooner. Always
submit Relaxed video with `--detach` and collect it with `--result <id> --wait`.

`sogni-agent --list-models --model-network relaxed` shows what runs there for
Unlimited members; a job paid with Spark or SOGNI, or from a trial, can still be
refused for a listed model. To stay on Fast once its capacity is used up, pay with
Premium Spark using `--billing-mode tokens`.

A plain render on Relaxed waits at least 30 minutes before the CLI stops waiting,
and stopping leaves the project running. `--source-reel` waits the same time for
each clip and fails if one takes longer. To run a reel there, pick a model that runs
on Relaxed and pass a long `-t`, for example
`--reel-model minimax-h3-fastvideo-int8_i2v_turbo -t 14400`.

## Commands

```bash
# Submit and return at once; prints the project id and the follow-up commands.
sogni-agent --video -m minimax-h3-ref2va-fp8_r2v --workflow r2v -c face.png --detach --json "A slow dolly toward the subject"

# Wait for it over the live connection, then save the media (one call; bounded by -t,
# default 1800 s). Repeat this same call if the host cut it short.
sogni-agent --result <projectId> --wait -o clip.mp4 --json

# One look at its state and, while queued, why it is waiting (at most once a minute).
sogni-agent --status <projectId> --json

# Finished media (-o saves it; several renders get -2, -3 suffixes like a normal run).
sogni-agent --result <projectId> -o clip.mp4 --json

# This account's completed projects, newest first (default 24 h, max 168).
sogni-agent --recent --json
sogni-agent --recent 6 --json
```

`--detach` refuses flows that submit a second project after the first finishes
(`--looping`, `--multi-angle`, source reels, hosted workflows and `--api-chat`).

## Start of a session

Run `sogni-agent --recent --json` and offer the user any results they have not
seen. The socket holds a project that finished while its client was
disconnected for one hour only; `--recent` and `--result` read the durable
account history (7 days), so nothing that finished while the agent was away is
lost.

## Why a project is waiting

`--status` (and the progress log of a waiting run) reports the server's reason:

- **Plan limit**: "you've reached your Unlimited plan limit for simultaneous
  MiniMax H3 videos". The account is already running as many of these as its
  plan allows: the Unlimited plan runs one standard MiniMax H3 video at a time
  and Unlimited Pro two, while H3 Balanced and Turbo get more. It starts by
  itself when one of the account's own jobs finishes. This is not a shortage of
  workers; submitting more only lengthens the line. Tell the user plainly, and
  mention Unlimited Pro only when they ask how to run more at once.
- **Confirming payment**: brief; it clears on its own.
- **Waiting for an available worker**: the network has no free worker that can
  run it yet.

Never resubmit or cancel a queued project to "retry" it. That loses its place
and, for a plan-limited queue, changes nothing.

## Batches

Several standard MiniMax H3 videos submitted together on Unlimited run one after
another: the last waits for every render ahead of it. Before submitting a batch,
say so and estimate the wait as one render's time multiplied by the number of
renders ahead of it, not a single-job estimate. Before each video submission the
CLI notes how many of the account's other video projects are already queued or
rendering (from other runs, apps or devices).

## Timeouts

`-t` is how long a run waits, counted from submission (uploads excluded). Time
the account's own plan limit holds a project is not counted, because that wait
ends on its own. When `-t` runs out the project is **not** cancelled: the run
exits with `errorCode: "PROJECT_TIMEOUT_STILL_RUNNING"`, and
`details.resultCommands` holds the `sogni-agent --result <id>` commands that
fetch it later (`details.waitingReason` says why it was still waiting).
`--cancel-on-timeout` restores the old behavior of cancelling on timeout.

Hosts that cap a single tool call (often around 10 minutes) cannot wait out a
long video in one call. Submit it with `--detach`, then wait for it with
`sogni-agent --result <id> --wait -o <file>` in a later call, instead of raising
`-t`. `--wait` follows the project over the live connection and makes no
requests while it waits; if the host cuts the call short, run the same command
again.

## Do not poll

Never re-run `--status` in a loop to see whether a project finished. Each run is
a new connection plus an API request, and Sogni limits requests per network:
too many in a minute block that network for a while, including the user's own
browser. Use `--wait`. When you must look without waiting, do it at most once a
minute. An error with `errorType: "RATE_LIMITED"` (HTTP 429) says how many
seconds to wait (`metadata.retryAfterSeconds`); make no Sogni request before
then.

`--status`, `--result` and `--recent` need `@sogni-ai/sogni-client` 5.57.0 or
later, and `--wait` needs 5.58.0; an older installation says so and asks for a
skill update.

## Price, charge and progress for host apps

Three opt-in flags let an app show a render's price before it starts, what it
cost afterwards, and its queue and time-left status while it runs. Without them
the output is unchanged.

```bash
# Price this exact request and exit; nothing is submitted.
sogni-agent --quote --json -m z_image_turbo_bf16 -w 1024 -h 1024 "A red bicycle against a brick wall"

# Render, report what Sogni recorded as the charge, and print status lines.
sogni-agent --json --receipt --progress-events --video -m minimax-h3-fasth3-t2v-turbo --duration 5 -o clip.mp4 "Waves at sunset"
sogni-agent --json --receipt --progress-events --result <projectId> --wait -o clip.mp4
```

`--quote` resolves every priced setting the way the render would (model id,
size, count, steps, frames or duration, fps, network, token type) and prints
`{ "type": "quote", "media", "model", "network", "tokenType", "settings",
"price", "partnerModel", "planCovered", "plan", "time", "dailyFairUsePct",
"balance" }`. `price` is Sogni's quote for all outputs; on partner models
(Seedance, Seedream, GPT Image, Wan 3) a member with a plan
discount also gets `memberPrice`, the quote after that discount. Sogni settles
some partner models from the vendor's actual usage, so the charge it records
(`--receipt`) can differ slightly from the quote. Partner models are never
plan-covered. `planCovered` is the CLI's reading of the
account; Sogni decides again when the render is submitted. `time` holds Sogni's
own estimate (`renderSeconds`, `queueSeconds`, `totalSeconds`) and is absent
when Sogni has none for these settings; `dailyFairUsePct` and `balance` appear
only when known. A request Sogni cannot quote (a looping return clip,
`--multi-angle`, source reels, hosted chat and workflows, Wan 3
`--smart-duration`, music or speech on Relaxed) fails with
`errorCode: "QUOTE_UNAVAILABLE"`; a lost connection keeps its own error.

`--receipt` adds `charge` to a finished render's JSON and to `--result`:
`paidBy` (`plan`, `spark`, `sogni` or `credit` for promotional credit) comes
from Sogni's project record, `amount` is what left the balances (all zero when
the plan paid) and `value` is the work's price as Sogni recorded it. When the
record cannot be read or does not say, `charge` is `null` and
`chargeUnavailable` gives the reason. It costs one extra request per project,
after the project finished.

`--progress-events` writes one stderr line per lifecycle event, beside the usual
progress lines, also with `-q`:

```text
SOGNI_EVENT {"event":"queued","projectId":"…","queuePosition":3,"startsInSeconds":45}
SOGNI_EVENT {"event":"model-loading","projectId":"…"}
SOGNI_EVENT {"event":"started","projectId":"…"}
SOGNI_EVENT {"event":"progress","projectId":"…","percent":40,"step":12,"stepCount":30,"etaSeconds":95}
SOGNI_EVENT {"event":"eta","projectId":"…","etaSeconds":95}
SOGNI_EVENT {"event":"retry","projectId":"…","attempt":2,"maxAttempts":3}
```

A field appears only when the server sent it. Each kind of line prints at most
once every 5 seconds per project (the newest value then); a new phase prints at
once.

## Fast, Relaxed and Priority

`--network fast|relaxed` selects the worker network for a render. `--priority` is a per-run opt-in for paid Unlimited or Unlimited Pro on Fast: earlier queue placement behind Premium Spark, with daily and monthly fair-use consumption at 1.5×. Explain that tradeoff and use it only when requested. It applies to covered worker models, excluding third-party vendor models, Relaxed, token billing, hosted chat and hosted workflows. It does not make the GPU faster. If refused, show the error and let the user choose standard Fast or Relaxed. Never retry or spend Premium Spark automatically.

```bash
sogni-agent --priority --network fast --video -m minimax-h3-fasth3-t2v-turbo --duration 5 -o ./priority.mp4 "A paper bird flies across a sunlit courtyard"
```
