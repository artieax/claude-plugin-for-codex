import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Use an isolated temp dir so tests never touch the real ~/.claude-plugin-for-codex
const TMP = path.join(os.tmpdir(), `claude-plugin-test-${process.pid}`);
process.env.HOME = TMP; // redirect os.homedir() for this process

// Dynamically import after setting HOME so the module picks up the temp dir
const {
  DEFAULT_RETENTION_DAYS,
  JOBS_DIR,
  autoPruneByEnv,
  pruneJobs,
  readJob,
  redactString,
  redactionEnabled,
  upsertJob,
} = await import("../scripts/lib/state.mjs");

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

test("redactString: scrubs OpenAI/Anthropic-style keys", () => {
  const out = redactString("token=sk-ant-1234567890abcdefghij next");
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /sk-ant-1234567890abcdefghij/);
});

test("redactString: scrubs GitHub PAT and JWT", () => {
  const ghp = "ghp_" + "a".repeat(36);
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.signature_part_here_x9z";
  const out = redactString(`pat=${ghp} jwt=${jwt}`);
  assert.doesNotMatch(out, new RegExp(ghp));
  assert.doesNotMatch(out, /signature_part_here/);
});

test("redactString: returns input unchanged when no patterns match", () => {
  assert.equal(redactString("plain content with no secrets"), "plain content with no secrets");
});

test("upsertJob: redacts stdout when CLAUDE_COMPANION_REDACT=1", () => {
  const prev = process.env.CLAUDE_COMPANION_REDACT;
  process.env.CLAUDE_COMPANION_REDACT = "1";
  try {
    const ghp = "ghp_" + "b".repeat(36);
    upsertJob({ id: "redact01", kind: "ask", status: "done", stdout: `leak=${ghp}` });
    const j = readJob("redact01");
    assert.match(j.stdout, /\[REDACTED\]/);
    assert.doesNotMatch(j.stdout, new RegExp(ghp));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_COMPANION_REDACT;
    else process.env.CLAUDE_COMPANION_REDACT = prev;
  }
});

test("pruneJobs --all: removes done and failed jobs", () => {
  upsertJob({ id: "prune03", kind: "ask", status: "done" });
  upsertJob({ id: "prune04", kind: "ask", status: "failed" });
  const count = pruneJobs({ all: true });
  assert.ok(count >= 2);
  assert.equal(readJob("prune03"), null);
  assert.equal(readJob("prune04"), null);
});

test("pruneJobs olderThanMs: keeps recent, removes old", () => {
  // Recent: createdAt = now → must survive.
  upsertJob({ id: "age01", kind: "ask", status: "done" });
  // Old: backdate createdAt by 10 days.
  upsertJob({ id: "age02", kind: "ask", status: "done" });
  const oldRec = readJob("age02");
  oldRec.createdAt = new Date(Date.now() - 10 * 86400000).toISOString();
  fs.writeFileSync(path.join(JOBS_DIR, "age02.json"), JSON.stringify(oldRec));

  const removed = pruneJobs({ olderThanMs: 5 * 86400000 });
  assert.ok(removed >= 1);
  assert.ok(readJob("age01") !== null);
  assert.equal(readJob("age02"), null);
});

test("pruneJobs olderThanMs: never removes running jobs even if old", () => {
  upsertJob({ id: "age03", kind: "ask", status: "running" });
  const rec = readJob("age03");
  rec.createdAt = new Date(Date.now() - 100 * 86400000).toISOString();
  fs.writeFileSync(path.join(JOBS_DIR, "age03.json"), JSON.stringify(rec));

  pruneJobs({ olderThanMs: 1 });
  assert.ok(readJob("age03") !== null);
});

// redactString — per-pattern coverage

test("redactString: scrubs AWS access key", () => {
  const out = redactString("AKIAIOSFODNN7EXAMPLE in env");
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /AKIAIOSFODNN7EXAMPLE/);
});

test("redactString: scrubs PEM private key block", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOwIBAAJBA...\n-----END RSA PRIVATE KEY-----";
  const out = redactString(`leak=${pem}`);
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /BEGIN RSA PRIVATE KEY/);
});

test("redactString: scrubs gho_ and ghs_ tokens", () => {
  const gho = "gho_" + "c".repeat(36);
  const ghs = "ghs_" + "d".repeat(36);
  const out = redactString(`a=${gho} b=${ghs}`);
  assert.doesNotMatch(out, new RegExp(gho));
  assert.doesNotMatch(out, new RegExp(ghs));
});

test("redactString: handles non-string input", () => {
  assert.equal(redactString(null), null);
  assert.equal(redactString(undefined), undefined);
  assert.equal(redactString(123), 123);
});

// redaction default — must be ON unless explicitly disabled.

test("redactionEnabled: default ON when env unset", () => {
  const prev = process.env.CLAUDE_COMPANION_REDACT;
  delete process.env.CLAUDE_COMPANION_REDACT;
  try {
    assert.equal(redactionEnabled(), true);
  } finally {
    if (prev !== undefined) process.env.CLAUDE_COMPANION_REDACT = prev;
  }
});

test("redactionEnabled: OFF when set to 0/off/false/no", () => {
  const prev = process.env.CLAUDE_COMPANION_REDACT;
  try {
    for (const v of ["0", "off", "OFF", "false", "no"]) {
      process.env.CLAUDE_COMPANION_REDACT = v;
      assert.equal(redactionEnabled(), false, `expected OFF for ${v}`);
    }
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_COMPANION_REDACT;
    else process.env.CLAUDE_COMPANION_REDACT = prev;
  }
});

test("upsertJob: redacts by default (no env var set)", () => {
  const prev = process.env.CLAUDE_COMPANION_REDACT;
  delete process.env.CLAUDE_COMPANION_REDACT;
  try {
    const ghp = "ghp_" + "e".repeat(36);
    upsertJob({ id: "redact-default", kind: "ask", status: "done", stdout: `leak=${ghp}` });
    const j = readJob("redact-default");
    assert.match(j.stdout, /\[REDACTED\]/);
    assert.doesNotMatch(j.stdout, new RegExp(ghp));
  } finally {
    if (prev !== undefined) process.env.CLAUDE_COMPANION_REDACT = prev;
  }
});

test("upsertJob: redacts argv strings as belt-and-suspenders", () => {
  // The dispatcher now persists structured {kind, prompt, ...} instead of
  // argv, but if a caller ever stores argv we must scrub secrets from it too.
  const prev = process.env.CLAUDE_COMPANION_REDACT;
  delete process.env.CLAUDE_COMPANION_REDACT;
  try {
    const ghp = "ghp_" + "g".repeat(36);
    upsertJob({
      id: "redact-argv",
      kind: "ask",
      status: "pending",
      argv: ["-p", `leak=${ghp}`, "--allowedTools", "Read"],
    });
    const j = readJob("redact-argv");
    assert.deepEqual(j.argv.slice(2), ["--allowedTools", "Read"]);
    assert.match(j.argv[1], /\[REDACTED\]/);
    assert.doesNotMatch(j.argv[1], new RegExp(ghp));
  } finally {
    if (prev !== undefined) process.env.CLAUDE_COMPANION_REDACT = prev;
  }
});

test("upsertJob: redacts focus string", () => {
  const prev = process.env.CLAUDE_COMPANION_REDACT;
  delete process.env.CLAUDE_COMPANION_REDACT;
  try {
    const ghp = "ghp_" + "h".repeat(36);
    upsertJob({ id: "redact-focus", kind: "review", status: "pending", focus: `audit ${ghp}` });
    const j = readJob("redact-focus");
    assert.match(j.focus, /\[REDACTED\]/);
    assert.doesNotMatch(j.focus, new RegExp(ghp));
  } finally {
    if (prev !== undefined) process.env.CLAUDE_COMPANION_REDACT = prev;
  }
});

test("upsertJob: stores raw stdout when CLAUDE_COMPANION_REDACT=0", () => {
  const prev = process.env.CLAUDE_COMPANION_REDACT;
  process.env.CLAUDE_COMPANION_REDACT = "0";
  try {
    const ghp = "ghp_" + "f".repeat(36);
    upsertJob({ id: "redact-off", kind: "ask", status: "done", stdout: `leak=${ghp}` });
    const j = readJob("redact-off");
    assert.match(j.stdout, new RegExp(ghp));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_COMPANION_REDACT;
    else process.env.CLAUDE_COMPANION_REDACT = prev;
  }
});

// Default retention — autoPruneByEnv with no env should clean old finished jobs.

test("autoPruneByEnv: defaults to ~30 days when env unset", () => {
  assert.equal(DEFAULT_RETENTION_DAYS, 30);
  const prev = process.env.CLAUDE_COMPANION_RETENTION_DAYS;
  delete process.env.CLAUDE_COMPANION_RETENTION_DAYS;
  try {
    upsertJob({ id: "ret01", kind: "ask", status: "done" });
    const rec = readJob("ret01");
    rec.createdAt = new Date(Date.now() - 60 * 86400000).toISOString();
    fs.writeFileSync(path.join(JOBS_DIR, "ret01.json"), JSON.stringify(rec));

    autoPruneByEnv();
    assert.equal(readJob("ret01"), null);
  } finally {
    if (prev !== undefined) process.env.CLAUDE_COMPANION_RETENTION_DAYS = prev;
  }
});

test("autoPruneByEnv: CLAUDE_COMPANION_RETENTION_DAYS=0 disables pruning", () => {
  const prev = process.env.CLAUDE_COMPANION_RETENTION_DAYS;
  process.env.CLAUDE_COMPANION_RETENTION_DAYS = "0";
  try {
    upsertJob({ id: "ret02", kind: "ask", status: "done" });
    const rec = readJob("ret02");
    rec.createdAt = new Date(Date.now() - 365 * 86400000).toISOString();
    fs.writeFileSync(path.join(JOBS_DIR, "ret02.json"), JSON.stringify(rec));

    const removed = autoPruneByEnv();
    assert.equal(removed, 0);
    assert.ok(readJob("ret02") !== null);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_COMPANION_RETENTION_DAYS;
    else process.env.CLAUDE_COMPANION_RETENTION_DAYS = prev;
  }
});
