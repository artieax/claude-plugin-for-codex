---
description: Fetch the stored output of a finished Claude delegation job
argument-hint: '[<job-id>]'
---

Run:

```bash
claude-companion result "$ARGUMENTS"
```

Relay the output verbatim. Without a job id, the companion returns the most recent job's full record. With one, it returns that specific job's record.

This output is Claude's answer, not yours. Do not condense it, do not second-guess it, do not reorder the sections.
