---
description: Delegate a read-only task or question to Claude Code
argument-hint: '[--background] <your question>'
---

Run this shell command and relay its stdout verbatim to the user:

```bash
claude-companion ask "$ARGUMENTS"
```

Rules:

- Do not modify, summarize, or re-interpret Claude's response. Frame it with a single line like `Claude:` and then paste stdout verbatim.
- Do not add `--background` unless the user explicitly asked for it. Default to foreground.
- If the command exits non-zero, relay stderr and suggest the user run `/claude-setup`.
- Claude is always invoked read-only (`Read Grep Glob`). This plugin intentionally has no flag to loosen that — if the user wants Claude to edit files, that is out of scope for this delegation bridge.

## User request
