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
console.log(JSON.stringify({
  argv: process.argv.slice(2),
  env: {
    SOGNI_API_KEY: process.env.SOGNI_API_KEY ?? null,
    FFMPEG_PATH: process.env.FFMPEG_PATH ?? null,
  },
}));
process.exit(Number(process.env.FAKE_AGENT_EXIT ?? 0));
