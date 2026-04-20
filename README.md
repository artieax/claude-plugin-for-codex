# claude-plugin-for-codex

A [Codex CLI](https://github.com/openai/codex) add-on that lets Codex delegate work to **Claude Code** in headless mode.

## What it provides

| Command          | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `/claude-ask`    | Delegate a read-only task or question to Claude.                 |
| `/claude-review` | Have Claude review the current git diff against a base branch.  |
| `/claude-status` | List active and recent Claude delegation jobs.                   |
| `/claude-result` | Fetch the stored output of a finished job.                       |
| `/claude-cancel` | Cancel a running job.                                            |
| `/claude-setup`  | Diagnose the install and Claude CLI auth.                        |

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

## Safety posture

`claude-companion ask` passes `--allowedTools Read Grep Glob` — no edits, no shell.
`claude-companion review` passes `--bare --allowedTools Read Grep Glob Bash(git diff:*) Bash(git log:*) Bash(git status:*) Bash(git show:*)` — Claude can inspect git history but cannot modify files, run arbitrary shell, or commit.

There is no opt-in flag to loosen this — this plugin is the read-only shell-out version on purpose.

## License

Apache-2.0
