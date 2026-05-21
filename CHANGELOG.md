# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.3.0] - 2026-05-20

### Added

- **Background npm update check.** `sogni-agent` now checks the npm registry at most once every 24 hours and surfaces a trailing "update available" notice when a newer version is published. The check times out at 1.5s, never blocks the foreground command, detects the package manager that installed the CLI (npm, pnpm, or yarn) so the suggested install command matches the user's environment, and persists throttle state at `~/.config/sogni/update-check.json`.
- **`--no-update-check`** flag to opt out of the update check for a single run.
- **Claude Code plugin install instructions** in README and `llm.txt`. Both now show the `npm install -g` prerequisite, the marketplace registration command, and the new `/plugin install sogni-creative-agent@sogni` step, with a brief explanation of what each command does.

### Documentation

- Clarified that the Claude Code plugin shells out to the `sogni-agent` CLI installed via `npm install -g @sogni-ai/sogni-creative-agent-skill`, so both the global CLI install and the two slash commands are required to activate the skill.
