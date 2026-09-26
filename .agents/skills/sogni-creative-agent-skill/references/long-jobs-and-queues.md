# Long jobs, queued work, and results after a session

Sogni projects run on the network, not in the CLI process. A project keeps
going when the CLI stops waiting, when its connection drops, and when no agent
is connected at all. These commands follow a project by id instead of holding a
connection open for its whole life.

## Commands

```bash
# Submit and return at once; prints the project id and the follow-up commands.
sogni-agent --video -m minimax-h3-ref2va-fp8_r2v --workflow r2v -c face.png --detach --json "A slow dolly toward the subject"

# State, and while queued, why it is waiting.
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
long video in one call. Submit it with `--detach`, check back with `--status`,
and collect it with `--result <id> -o <file>` in later calls, instead of
raising `-t`.

`--status`, `--result` and `--recent` need `@sogni-ai/sogni-client` 5.57.0 or
later; an older installation says so and asks for a skill update.
