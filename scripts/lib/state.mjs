import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDir, readJson, writeJson } from "./fs.mjs";

export const ROOT = path.join(os.homedir(), ".claude-plugin-for-codex");
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

export function upsertJob(partial) {
  const existing = partial.id ? readJob(partial.id) : null;
  const now = new Date().toISOString();
  const merged = { ...(existing ?? {}), ...partial, updatedAt: now };
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
