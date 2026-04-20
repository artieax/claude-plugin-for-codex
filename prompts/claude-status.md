---
description: List active and recent Claude delegation jobs
argument-hint: '[<job-id>]'
---

Run:

```bash
claude-companion status "$ARGUMENTS"
```

Relay the output verbatim.

- Without a job id: the companion prints a single Markdown table of recent jobs (id, kind, status, started, ended, summary). Do not reformat it.
- With a job id: the companion prints the full record (stdout, stderr, exit code). Do not summarize — the user asked for this detail on purpose.
