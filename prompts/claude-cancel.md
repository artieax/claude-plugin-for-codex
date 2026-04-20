---
description: Cancel a running Claude delegation job by id
argument-hint: '<job-id>'
---

Run:

```bash
claude-companion cancel "$ARGUMENTS"
```

Relay the output verbatim. The companion will `SIGTERM` the worker process if it is still alive and mark the job as `cancelled` in its state file.

If the user did not pass a job id, the companion will error — suggest they run `/claude-status` first to see ids.
