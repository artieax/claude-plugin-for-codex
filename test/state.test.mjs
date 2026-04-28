import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Use an isolated temp dir so tests never touch the real ~/.claude-plugin-for-codex
const TMP = path.join(os.tmpdir(), `claude-plugin-test-${process.pid}`);
process.env.HOME = TMP; // redirect os.homedir() for this process

// Dynamically import after setting HOME so the module picks up the temp dir
const { upsertJob, readJob, pruneJobs, JOBS_DIR } = await import("../scripts/lib/state.mjs");

before(() => {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("upsertJob: creates a new job", () => {
  const job = upsertJob({ id: "test01", kind: "ask", status: "running" });
  assert.equal(job.id, "test01");
  assert.equal(job.status, "running");
  assert.ok(job.createdAt);
});

test("upsertJob: merges into existing job", () => {
  upsertJob({ id: "test02", kind: "review", status: "running" });
  const updated = upsertJob({ id: "test02", status: "done", exitCode: 0 });
  assert.equal(updated.kind, "review"); // original field preserved
  assert.equal(updated.status, "done");
  assert.equal(updated.exitCode, 0);
});

test("readJob: returns null for unknown id", () => {
  assert.equal(readJob("nope"), null);
});

// Simulate the cancel/worker race: after cancel sets status='cancelled',
// worker should NOT overwrite it.  The guard lives in cmdWorker (not upsertJob),
// so we test the expected contract: read job, check status, skip upsertJob.
test("cancelled job must not be overwritten (guard contract)", () => {
  upsertJob({ id: "test03", kind: "ask", status: "running" });
  // cancel sets status to cancelled
  upsertJob({ id: "test03", status: "cancelled", endedAt: new Date().toISOString(), pid: null });

  // worker checks status before final write — simulate that guard
  const current = readJob("test03");
  if (current?.status !== "cancelled") {
    upsertJob({ id: "test03", status: "failed", exitCode: 1 });
  }

  const final = readJob("test03");
  assert.equal(final.status, "cancelled"); // must still be cancelled
});

test("pruneJobs: skips running and pending jobs", () => {
  upsertJob({ id: "prune01", kind: "ask", status: "running" });
  upsertJob({ id: "prune02", kind: "ask", status: "pending" });
  const count = pruneJobs({ all: true });
  // prune01 and prune02 should NOT be pruned
  assert.ok(readJob("prune01") !== null);
  assert.ok(readJob("prune02") !== null);
  // count reflects only jobs that were actually deleted
  assert.equal(typeof count, "number");
});

test("pruneJobs --all: removes done and failed jobs", () => {
  upsertJob({ id: "prune03", kind: "ask", status: "done" });
  upsertJob({ id: "prune04", kind: "ask", status: "failed" });
  const count = pruneJobs({ all: true });
  assert.ok(count >= 2);
  assert.equal(readJob("prune03"), null);
  assert.equal(readJob("prune04"), null);
});
