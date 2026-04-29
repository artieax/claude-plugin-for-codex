---
description: Delegate a read-only task or question to Claude Code
argument-hint: '[--background] [--summary|--raw] <your question>'
---

Run this shell command and relay its stdout verbatim to the user:

```bash
claude-companion ask "$ARGUMENTS"
```

Accepted flags (consumed by the companion, not by you):

- `--background` — run asynchronously. Relay the printed job id and tell the user to use `/claude-status` or `/claude-result`.
- `--summary` — ask Claude for a short bullet-list answer instead of a full prose response. Use when the user asks for a "quick", "tl;dr", or "summary" answer.
- `--raw` — explicit verbatim mode (this is the default, so you only need to pass it if the user explicitly says so).

Rules:

- Do not modify, summarize, or re-interpret Claude's response. Frame it with a single line like `Claude:` and then paste stdout verbatim. (`--summary` is how the user asks for a shorter answer — let Claude do the shortening, not you.)
- Do not add `--background` or `--summary` unless the user's request implies it. Default is foreground + raw.
- If the command exits non-zero, relay stderr and suggest the user run `/claude-setup`.
- Claude is always invoked read-only (`Read Grep Glob`). This plugin intentionally has no flag to loosen that — if the user wants Claude to edit files, that is out of scope for this delegation bridge.

## User request
