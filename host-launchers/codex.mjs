#!/usr/bin/env node
process.env.SOGNI_AGENT_FRAMEWORK = 'codex';
process.env.SOGNI_AGENT_SURFACE = 'plugin';
await import('../sogni-agent.mjs');
