---
name: claude-companion
description: Delegate read-only tasks from Codex to Claude Code (ask, review, status/result/cancel jobs). Triggers when the user wants a second-opinion review from Claude, asks Claude to inspect a repo, or runs a background Claude job from inside Codex.
---

# claude-companion

Delegates tasks from Codex to Claude Code as a background or inline subprocess.

## Verbs

| Verb       | What it does                                          |
| ---------- | ----------------------------------------------------- |
| `ask`      | Ask Claude a read-only question about the repo        |
| `review`   | Have Claude review the current git diff               |
| `status`   | List active and recent delegation jobs                |
| `result`   | Fetch the output of a finished job                    |
| `cancel`   | Cancel a running job                                  |
| `setup`    | Diagnose Claude CLI installation and auth             |
| `prune`    | Remove finished job records                           |

## Usage (skill mode — primary)

On Codex builds that surface skills, invoke verbs through the skill entry point:

```
$claude-companion ask where is rate limiting implemented?
$claude-companion review --base develop --focus auth middleware
$claude-companion review --background
$claude-companion review --summary
$claude-companion status
$claude-companion result 4f8b1a9c2d01
$claude-companion cancel 4f8b1a9c2d01
```

## Usage (legacy custom prompts — fallback)

On older Codex builds without skill support, the same dispatcher is reachable via custom prompts installed under `~/.codex/prompts/`:

```
/claude-ask where is rate limiting implemented?
/claude-review --base develop --focus auth middleware
/claude-status
/claude-result 4f8b1a9c2d01
/claude-cancel 4f8b1a9c2d01
```

Both layouts ship in this plugin so the same repo works on old and new Codex builds.

## Output modes

`ask` and `review` accept `--raw` (default; relay Claude's output verbatim) and `--summary` (ask Claude for a short bulleted report instead). Use `--summary` when the verbatim relay would be too long to read inline.

## Implementation

Each prompt and the skill entry point both shell out to the same dispatcher:

```bash
claude-companion <verb> "$ARGUMENTS"
```

The dispatcher (`../../scripts/claude-companion.mjs`) builds a `claude` CLI invocation
with a read-only tool allowlist (`Read,Grep,Glob`), spawns it, and persists per-job
state under `~/.claude-plugin-for-codex/jobs/`. The argv is **not** persisted — the
background worker rebuilds it from the structured payload (`{kind, prompt, base, focus, mode}`)
so the on-disk record never contains the raw `-p <prompt>` slot.

## Prerequisites

- Node.js 20+
- Claude Code CLI installed and authenticated (`claude auth status` must succeed)
