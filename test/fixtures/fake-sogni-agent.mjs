#!/usr/bin/env node
// test/fixtures/fake-sogni-agent.mjs
// Stand-in for the real CLI: echoes how it was invoked so tests can assert
// argv construction and env plumbing without touching the network.
if (process.env.FAKE_AGENT_SLEEP_MS) {
  await new Promise((r) => setTimeout(r, Number(process.env.FAKE_AGENT_SLEEP_MS)));
}
if (process.env.FAKE_AGENT_STDERR) {
  process.stderr.write(process.env.FAKE_AGENT_STDERR);
}
const line = JSON.stringify({
  argv: process.argv.slice(2),
  env: {
    SOGNI_API_KEY: process.env.SOGNI_API_KEY ?? null,
    FFMPEG_PATH: process.env.FFMPEG_PATH ?? null,
  },
});
// FAKE_AGENT_PAD appends N filler chars AFTER the JSON line so tests can exercise
// the server's oversized-output truncation. Exit only after stdout has flushed to
// the pipe so large payloads are not truncated by an early process.exit().
const pad = process.env.FAKE_AGENT_PAD ? 'x'.repeat(Number(process.env.FAKE_AGENT_PAD)) : '';
process.stdout.write(line + '\n' + pad, () => process.exit(Number(process.env.FAKE_AGENT_EXIT ?? 0)));
