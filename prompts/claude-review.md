---
description: Have Claude review the current git diff against a base branch
argument-hint: '[--background] [--base <ref>] [--focus <text>] [focus text]'
---

Run this shell command and relay its stdout verbatim:

```bash
claude-companion review "$ARGUMENTS"
```

Accepted arguments (parsed by the companion script, not by you):

- `--base <ref>` — base branch. Defaults to `main` or `master` (autodetected).
- `--focus <text>` — extra focus line appended to the review prompt.
- `--background` — run asynchronously. Relay the printed job id and tell the user to use `/claude-status` or `/claude-result`.
- Any remaining positional text after flags is also treated as focus text.

Rules:

- This is review-only. Do not apply fixes, suggest patches as if you are about to apply them, or rewrite Claude's review.
- Do not pre-read the diff yourself. Let Claude do it — that is the entire point of the delegation.
- If the companion reports "not a git repository", surface that error as-is.

## User request
