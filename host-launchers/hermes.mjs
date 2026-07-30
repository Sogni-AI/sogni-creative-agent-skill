#!/usr/bin/env node
process.env.SOGNI_AGENT_FRAMEWORK = 'hermes-agent';
process.env.SOGNI_AGENT_SURFACE = 'personal_skill';
await import('../sogni-agent.mjs');
