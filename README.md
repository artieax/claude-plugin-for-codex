# claude-plugin-for-codex

Delegate from Codex CLI to Claude Code.

This is a small bridge that lets Codex ask Claude Code for a second opinion without wiring MCP or replacing your Codex workflow. Use it when you want Claude to inspect a codebase while you stay inside Codex, get an independent review pass from a different coding agent, or run background Claude jobs while Codex continues the main session.

## What it provides

| Command          | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `/claude-ask`    | Delegate a read-only task or question to Claude.                 |
| `/claude-review` | Have Claude review the current git diff against a base branch.  |
| `/claude-status` | List active and recent Claude delegation jobs.                   |
| `/claude-result` | Fetch the stored output of a finished job.                       |
| `/claude-cancel` | Cancel a running job.                                            |
| `/claude-setup`  | Diagnose the install and Claude CLI auth.                        |

`/claude-review` is not a replacement for Codex's built-in `/review`. It delegates to Claude Code as a separate agent, giving you a second opinion from a different model and reasoning pipeline.

All six are Codex custom prompts in `prompts/`. Each one is a thin wrapper that tells Codex to shell out to:

```bash
claude-companion <verb> "$ARGUMENTS"
```

`claude-companion` is the dispatcher script (`scripts/claude-companion.mjs`). It builds the right `claude` CLI invocation (with a read-only tool allowlist), spawns it, captures stdout/stderr, and persists per-job state under `~/.claude-plugin-for-codex/jobs/`.

## Architecture

```
claude-plugin-for-codex/
├── prompts/                            # drop into ~/.codex/prompts/
│   ├── claude-ask.md
│   ├── claude-review.md
│   ├── claude-status.md
│   ├── claude-result.md
│   ├── claude-cancel.md
│   └── claude-setup.md
├── scripts/
│   ├── claude-companion.mjs            # verb dispatcher (ask/review/status/…)
│   └── lib/
│       ├── args.mjs                    # arg parsing + $ARGUMENTS splitter
│       ├── claude.mjs                  # `claude` argv builder + spawn
│       ├── fs.mjs                      # file / stdin helpers
│       ├── git.mjs                     # repo + base-branch detection
│       ├── render.mjs                  # status table / job view
│       └── state.mjs                   # ~/.claude-plugin-for-codex/jobs/<id>.json
├── install.mjs                         # copies prompts → ~/.codex/prompts/
├── plugin.json                         # informational manifest
├── package.json                        # exposes `claude-companion` via bin
└── README.md
```

## Prerequisites

- Node.js 20+
- [Codex CLI](https://github.com/openai/codex) installed and authenticated
- [Claude Code](https://claude.ai/code) installed and authenticated. `claude auth status` must return 0.

## Install

```sh
npx github:artieax/claude-plugin-for-codex install
```

That one command clones this repo, copies the prompts into `~/.codex/prompts/`, and puts `claude-companion` on your PATH (via a global npm install). Then in Codex, `/claude-setup`, `/claude-ask`, etc. appear in the slash-command list.

Verify:

```sh
claude-companion setup
# or
claude-plugin-for-codex doctor
```

To uninstall:

```sh
claude-plugin-for-codex uninstall
```

To upgrade to the latest version:

```sh
claude-plugin-for-codex upgrade
```

## Use

```
/claude-ask where is rate limiting implemented in this repo?
/claude-review --base develop --focus auth middleware
/claude-review --background
/claude-status
/claude-result 4f8b1a9c2d01
/claude-cancel 4f8b1a9c2d01
```

> **Codex version note:** Depending on your Codex build, custom prompts may appear in the slash-command menu as `/claude-ask` or `/prompts:claude-ask`. Run `/` in Codex to see which form your version uses. Both work identically.

> **`--focus` tip:** Multi-word focus strings do not require quoting — `/claude-review --focus auth middleware` works as-is. Quoted forms also work: `--focus "auth middleware"`.

Direct CLI usage (without Codex) also works:

```sh
claude-companion ask "what does this repo do?"
echo "multi-line question" | claude-companion ask
claude-companion review --base main
claude-companion status
```

## State

- `~/.claude-plugin-for-codex/jobs/<id>.json` — per-job record (kind, status, argv, cwd, stdout, stderr, timing)
- `~/.claude-plugin-for-codex/jobs/<id>.log` — interleaved stdout+stderr stream captured during the run

Both are plain files; delete the directory to wipe history.

**Security note:** Job history is stored as plain JSON/log files under `~/.claude-plugin-for-codex/jobs/`. Outputs may include repository paths, code snippets, stack traces, or secrets from your working tree. Use `claude-companion prune` to clean up:

```sh
claude-companion prune --older-than 7d
claude-companion prune --all
```

## Safety posture

Both `ask` and `review` invoke Claude with `--permission-mode dontAsk` so the runtime never falls through to an interactive approval prompt for an untrusted tool. Layered on top of that:

- `claude-companion ask` passes `--tools Read,Grep,Glob` (restricts available tools) and `--allowedTools Read Grep Glob` (bypasses permission prompts for those tools).
- `claude-companion review` passes `--tools Read,Grep,Glob,Bash` with `--allowedTools` scoped to `git diff/log/status/show` patterns, plus `--disallowedTools Edit Write MultiEdit` as a belt-and-suspenders guard against file writes.

There is no opt-in flag to loosen this — this plugin is the read-only delegation bridge on purpose.

## Configuration (env vars)

| Variable                            | Effect                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `CLAUDE_COMPANION_STATE_DIR`        | Override the state directory (default `~/.claude-plugin-for-codex`).                  |
| `CLAUDE_COMPANION_RETENTION_DAYS=N` | Auto-prune finished jobs older than N days at the start of every command.             |
| `CLAUDE_COMPANION_REDACT=1`         | Best-effort redaction of common secret shapes (API keys, JWTs, PEMs) in stored job records and log files. Live stdout is not redacted. |

## License

Apache-2.0
