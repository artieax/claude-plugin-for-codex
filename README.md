# claude-plugin-for-codex

A lightweight bridge that lets Codex call Claude Code as a **read-only second reviewer** — no MCP, just shell-out, with built-in job management.

OpenAI's official `codex-plugin-cc` goes the other direction (call Codex *from* Claude Code). This plugin is the inverse: while you're driving Codex, you can ask Claude for a delegated read-only opinion or review without leaving the session.

## What it provides

Three modes, same dispatcher (`scripts/claude-companion.mjs`).

### Codex plugin + skill *(primary; new Codex builds)*

Codex auto-discovers `.codex-plugin/plugin.json` and `skills/claude-companion/SKILL.md`. In skill mode the entry point is `$claude-companion …`:

```
$claude-companion ask where is rate limiting implemented?
$claude-companion review --base develop --focus auth middleware
$claude-companion status
```

This is what the OpenAI Codex docs steer new add-ons toward.

### Custom prompts *(legacy; older Codex builds)*

The `.md` files under `prompts/` are copied to `~/.codex/prompts/` by the installer. Custom Prompts are deprecated upstream in favor of skills but still work, with a different invocation prefix:

```
/claude-ask where is rate limiting implemented?
/claude-review --base develop --focus auth middleware
/claude-status
```

> The installer ships **both** layouts so the same repo works with old and new Codex builds. Use `$claude-companion <verb>` if your Codex shows skills, `/claude-<verb>` otherwise. (Some Codex builds also surface custom prompts as `/prompts:claude-ask`.)

### Direct CLI *(any shell, no Codex)*

```sh
claude-companion ask "what does this repo do?"
claude-companion review --base main
claude-companion status
```

### Verbs

| Verb       | What it does                                                    |
| ---------- | --------------------------------------------------------------- |
| `ask`      | Delegate a read-only task or question to Claude.                |
| `review`   | Have Claude review the current git diff against a base branch. |
| `status`   | List active and recent Claude delegation jobs.                  |
| `result`   | Fetch the stored output of a finished job.                      |
| `cancel`   | Cancel a running job.                                           |
| `setup`    | Diagnose the install and Claude CLI auth.                       |

`review` is not a replacement for Codex's built-in `/review`; it delegates to Claude Code as a separate agent, giving you an independent pass from a different model and reasoning pipeline.

All entry points call the same dispatcher, which builds a `claude` CLI invocation with a read-only tool allowlist, spawns it, captures stdout/stderr, and persists per-job state under `~/.claude-plugin-for-codex/jobs/`.

## Architecture

```
claude-plugin-for-codex/
├── .codex-plugin/
│   └── plugin.json                     # plugin manifest (per Codex spec)
├── skills/
│   └── claude-companion/SKILL.md       # skill description for Codex
├── prompts/                            # legacy custom prompts (~/.codex/prompts/)
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
├── install.mjs                         # copies prompts + global-installs the bin
├── package.json                        # exposes `claude-companion` via bin
└── README.md
```

## Prerequisites

- Node.js 20+
- [Codex CLI](https://github.com/openai/codex) installed and authenticated
- [Claude Code](https://claude.ai/code) installed and authenticated. `claude auth status` must return 0.

## Install

### As a Codex plugin (recommended)

If your Codex build supports the plugin layout under `.codex-plugin/`, point Codex at this repo and it will pick up the skill in `skills/claude-companion/`. The skill's `name`/`description` make it explicit-callable (`/claude-companion …`) and implicit-callable when Codex thinks a delegation to Claude is appropriate. The `install.run` hook in `plugin.json` shells out to the same installer described below, which puts `claude-companion` on your PATH.

### One-shot npx (works everywhere)

```sh
npx github:artieax/claude-plugin-for-codex install
```

That one command clones this repo, copies the legacy custom prompts into `~/.codex/prompts/`, and puts `claude-companion` on your PATH (via a global npm install). The legacy prompts are kept around so Codex builds without skill support still get `/claude-setup`, `/claude-ask`, etc. in the slash-command list.

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

Skill mode (new Codex):

```
$claude-companion ask where is rate limiting implemented in this repo?
$claude-companion review --base develop --focus auth middleware
$claude-companion review --background
$claude-companion status
$claude-companion result 4f8b1a9c2d01
$claude-companion cancel 4f8b1a9c2d01
```

Legacy custom-prompt mode (older Codex):

```
/claude-ask where is rate limiting implemented in this repo?
/claude-review --base develop --focus auth middleware
/claude-review --background
/claude-status
/claude-result 4f8b1a9c2d01
/claude-cancel 4f8b1a9c2d01
```

> **`--focus` tip:** Multi-word focus strings do not require quoting — `--focus auth middleware` works as-is. Quoted forms also work: `--focus "auth middleware"`.

Direct CLI usage (without Codex):

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

**Security note:** Job history is stored as plain JSON/log files under `~/.claude-plugin-for-codex/jobs/`. Outputs may include repository paths, code snippets, or stack traces from your working tree. To reduce blast radius, the companion ships with two defaults on:

- **Best-effort redaction** of common secret shapes (API keys, JWTs, PEMs) is applied at the persistence boundary, so on-disk records never see raw values. Disable with `CLAUDE_COMPANION_REDACT=0`.
- **30-day auto-prune** runs on every command. Override with `CLAUDE_COMPANION_RETENTION_DAYS=N`, or disable with `CLAUDE_COMPANION_RETENTION_DAYS=0`.

> **Background mode caveat:** background jobs persist the prompt to disk so the worker can rebuild the `claude` argv after the parent exits. Persistence goes through the same redaction pipeline, so any secret-shaped tokens in your prompt (e.g. `ghp_…`, `sk-ant-…`, JWTs) will be replaced with `[REDACTED]` *before* the worker invokes Claude. If your prompt intentionally contains a secret-shaped string and you need Claude to see the raw value, use foreground mode (default) — it builds the argv in-process and never writes the prompt to disk in raw form.

You can also prune manually:

```sh
claude-companion prune --older-than 7d
claude-companion prune --all
```

## Safety posture

Both `ask` and `review` invoke Claude with `--permission-mode dontAsk` so the runtime never falls through to an interactive approval prompt for an untrusted tool. Layered on top of that:

- `claude-companion ask` passes `--tools Read,Grep,Glob` (restricts available tools) and `--allowedTools Read Grep Glob` (bypasses permission prompts for those tools).
- `claude-companion review` is also `Read,Grep,Glob` only. The companion gathers `git status` / `git diff` / `git diff --cached` / `git diff <base>...HEAD` itself via `execFileSync` (no shell) and embeds the result in the prompt; Claude never invokes `Bash`. `--disallowedTools Edit Write MultiEdit Bash` is set as defense in depth.
- `--base <ref>` is gated by a safe-ref regex *and* is only ever passed to `git` as an argv slot — there is no shell interpolation anywhere in the companion.

There is no opt-in flag to loosen this — this plugin is the read-only delegation bridge on purpose.

## Configuration (env vars)

| Variable                            | Effect                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `CLAUDE_COMPANION_STATE_DIR`        | Override the state directory (default `~/.claude-plugin-for-codex`).                  |
| `CLAUDE_COMPANION_RETENTION_DAYS=N` | Auto-prune finished jobs older than N days at the start of every command. **Default: 30.** Set to `0` (or `off`/`false`/`no`) to disable. |
| `CLAUDE_COMPANION_REDACT=0`         | Disable best-effort redaction of common secret shapes (API keys, JWTs, PEMs) in stored job records and log files. **Default: ON.** Live stdout is never redacted. |

## License

Apache-2.0
