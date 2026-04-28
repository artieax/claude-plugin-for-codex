function cell(v) {
  return String(v ?? "").replace(/\|/g, "\\|");
}

export function renderStatusTable(jobs) {
  if (!jobs.length) return "No jobs yet.\n";
  const header = ["id", "kind", "status", "started", "ended", "summary"];
  const rows = jobs.map((j) => [
    j.id,
    j.kind,
    j.status,
    j.createdAt?.slice(11, 19) ?? "-",
    j.endedAt?.slice(11, 19) ?? "-",
    (j.summary ?? "").slice(0, 50),
  ]);
  const lines = [
    "| " + header.join(" | ") + " |",
    "|" + header.map(() => "---").join("|") + "|",
    ...rows.map((r) => "| " + r.map(cell).join(" | ") + " |"),
  ];
  return lines.join("\n") + "\n";
}

export function renderJob(job) {
  if (!job) return "Job not found.\n";
  const lines = [
    `# Job ${job.id}`,
    `kind: ${job.kind}`,
    `status: ${job.status}`,
    `started: ${job.createdAt ?? "-"}`,
  ];
  if (job.endedAt) lines.push(`ended: ${job.endedAt}`);
  if (job.exitCode != null) lines.push(`exit: ${job.exitCode}`);
  lines.push("", "## stdout", job.stdout ?? "(none)");
  if (job.stderr && job.stderr.trim()) lines.push("", "## stderr", job.stderr);
  return lines.join("\n") + "\n";
}

export function renderSetup(report) {
  const line = (label, ok, detail) =>
    `${label}: ${ok ? "OK" : "MISSING"}${detail ? " — " + detail : ""}`;
  const lines = [
    "# claude-plugin-for-codex setup",
    line("claude CLI", report.claudeFound, report.claudeVersion ?? "not on PATH"),
    line(
      "claude auth",
      report.claudeAuthed,
      report.claudeAuthed ? "" : "run `claude auth login`",
    ),
    `state dir: ${report.stateDir}`,
    `redaction: ${report.redactionEnabled ? "ON (default)" : "OFF (CLAUDE_COMPANION_REDACT)"}`,
    `retention: ${report.retentionDays > 0 ? `${report.retentionDays}d (auto-prune)` : "OFF"}`,
    "note: job logs may contain repository contents and any secrets present in stdout/stderr.",
  ];
  return lines.join("\n") + "\n";
}
