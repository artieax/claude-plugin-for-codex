---
description: Diagnose the claude-plugin-for-codex install and Claude CLI auth
---

Run:

```bash
claude-companion setup
```

Relay the output verbatim. If anything shows `MISSING`, tell the user the concrete fix:

- `claude CLI` missing → install Claude Code from https://claude.ai/code (or ensure `claude` is on PATH).
- `claude auth` missing → run `claude auth login`.
- `claude-companion` itself not found → from the plugin repo run `npm install && npm link` (or `npm install -g .`).
