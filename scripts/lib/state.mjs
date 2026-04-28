import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDir, readJson, writeJson } from "./fs.mjs";

export const ROOT =
  process.env.CLAUDE_COMPANION_STATE_DIR && process.env.CLAUDE_COMPANION_STATE_DIR.trim()
    ? path.resolve(process.env.CLAUDE_COMPANION_STATE_DIR)
    : path.join(os.homedir(), ".claude-plugin-for-codex");
export const JOBS_DIR = path.join(ROOT, "jobs");

export function generateJobId() {
  return crypto.randomBytes(6).toString("hex");
}

export function jobFile(id) {
  return path.join(JOBS_DIR, `${id}.json`);
}

export function jobLog(id) {
  return path.join(JOBS_DIR, `${id}.log`);
}

export function listJobs() {
  ensureDir(JOBS_DIR);
  return fs
    .readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(path.join(JOBS_DIR, f)))
    .filter(Boolean);
}

export function readJob(id) {
  return readJson(jobFile(id));
}

// Best-effort secret redaction. Off by default; enable with CLAUDE_COMPANION_REDACT=1.
// Applied at the persistence boundary so the on-disk job record never sees raw secrets.
const REDACT_PATTERNS = [
  /(?:sk|pk|rk)-[A-Za-z0-9_\-]{16,}/g,            // OpenAI/Stripe-style keys
  /sk-ant-[A-Za-z0-9_\-]{16,}/g,                  // Anthropic
  /ghp_[A-Za-z0-9]{20,}/g,                        // GitHub PAT
  /gho_[A-Za-z0-9]{20,}/g,                        // GitHub OAuth
  /ghs_[A-Za-z0-9]{20,}/g,                        // GitHub server token
  /AKIA[0-9A-Z]{16}/g,                            // AWS access key
  /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]+?-----END[^-]+PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, // JWT
];
export function redactString(s) {
  if (typeof s !== "string" || !s) return s;
  let out = s;
  for (const re of REDACT_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}
function redactPartial(partial) {
  if (process.env.CLAUDE_COMPANION_REDACT !== "1") return partial;
  const out = { ...partial };
  for (const k of ["stdout", "stderr", "summary", "prompt"]) {
    if (typeof out[k] === "string") out[k] = redactString(out[k]);
  }
  return out;
}

export function upsertJob(partial) {
  const safe = redactPartial(partial);
  const existing = safe.id ? readJob(safe.id) : null;
  const now = new Date().toISOString();
  const merged = { ...(existing ?? {}), ...safe, updatedAt: now };
  if (!existing) merged.createdAt = now;
  writeJson(jobFile(merged.id), merged);
  return merged;
}

export function listJobsNewestFirst() {
  return listJobs().sort((a, b) =>
    String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  );
}

export function latestJob() {
  return listJobsNewestFirst()[0] ?? null;
}

// CLAUDE_COMPANION_RETENTION_DAYS=N → auto-prune anything older than N days.
// Best-effort: errors are swallowed so a bad env value can never break a command.
export function autoPruneByEnv() {
  const raw = process.env.CLAUDE_COMPANION_RETENTION_DAYS;
  if (!raw) return 0;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) return 0;
  try {
    return pruneJobs({ olderThanMs: days * 86400000 });
  } catch {
    return 0;
  }
}

export function pruneJobs({ all = false, olderThanMs = null } = {}) {
  const jobs = listJobsNewestFirst();
  let pruned = 0;
  for (const job of jobs) {
    if (job.status === "running" || job.status === "pending") continue;
    if (!all && olderThanMs === null) continue;
    if (olderThanMs !== null) {
      const createdAt = job.createdAt ? new Date(job.createdAt).getTime() : 0;
      if (createdAt > Date.now() - olderThanMs) continue;
    }
    try { fs.unlinkSync(jobFile(job.id)); } catch { /* already gone */ }
    try { fs.unlinkSync(jobLog(job.id)); } catch { /* already gone */ }
    pruned++;
  }
  return pruned;
}
