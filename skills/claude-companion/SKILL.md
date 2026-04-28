---
name: claude-companion
description: Delegate read-only tasks from Codex to Claude Code (ask, review, status/result/cancel jobs). Triggers when the user wants a second-opinion review from Claude, asks Claude to inspect a repo, or runs a background Claude job from inside Codex.
---

# claude-companion

Delegates tasks from Codex to Claude Code as a background or inline subprocess.

## Commands

| Slash command   | What it does                                          |
| --------------- | ----------------------------------------------------- |
| `/claude-ask`   | Ask Claude a read-only question about the repo        |
| `/claude-review`| Have Claude review the current git diff               |
| `/claude-status`| List active and recent delegation jobs                |
| `/claude-result`| Fetch the output of a finished job                    |
| `/claude-cancel`| Cancel a running job                                  |
| `/claude-setup` | Diagnose Claude CLI installation and auth             |

## Usage

```
/claude-ask where is rate limiting implemented?
/claude-review --base develop --focus auth middleware
/claude-review --background
/claude-status
/claude-result 4f8b1a9c2d01
/claude-cancel 4f8b1a9c2d01
```

## Implementation

Prompts live in `../../prompts/`. Each prompt tells Codex to shell out to:

```bash
claude-companion <verb> "$ARGUMENTS"
```

The dispatcher (`../../scripts/claude-companion.mjs`) builds a `claude` CLI invocation
with a read-only tool allowlist, spawns it, and persists per-job state under
`~/.claude-plugin-for-codex/jobs/`.

## Prerequisites

- Node.js 20+
- Claude Code CLI installed and authenticated (`claude auth status` must succeed)
