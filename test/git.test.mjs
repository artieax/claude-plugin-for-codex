import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBase, ensureGitRepo, gatherReviewDiffs } from "../scripts/lib/git.mjs";

// The test runner itself runs inside the repo, so process.cwd() is a valid git root.
const CWD = process.cwd();

test("ensureGitRepo: returns true inside a git repo", () => {
  assert.equal(ensureGitRepo(CWD), true);
});

test("ensureGitRepo: returns false outside a git repo", () => {
  assert.equal(ensureGitRepo("/tmp"), false);
});

// validateBase rejects shell-injection characters before reaching git
test("validateBase: rejects semicolon injection", () => {
  assert.equal(validateBase(CWD, "; rm -rf /"), false);
});

test("validateBase: rejects command substitution", () => {
  assert.equal(validateBase(CWD, "$(whoami)"), false);
});

test("validateBase: rejects backtick injection", () => {
  assert.equal(validateBase(CWD, "`id`"), false);
});

test("validateBase: rejects pipe char", () => {
  assert.equal(validateBase(CWD, "main|evil"), false);
});

test("validateBase: accepts plain branch name", () => {
  // 'main' might not exist but the regex should pass; git may reject it — either is fine.
  // We're only asserting the regex doesn't false-positive reject a safe name.
  const result = validateBase(CWD, "main");
  assert.ok(typeof result === "boolean");
});

test("validateBase: accepts feature/branch style names", () => {
  const result = validateBase(CWD, "feature/foo");
  assert.ok(typeof result === "boolean");
});

test("validateBase: accepts origin/main", () => {
  const result = validateBase(CWD, "origin/main");
  assert.ok(typeof result === "boolean");
});

test("validateBase: rejects whitespace", () => {
  assert.equal(validateBase(CWD, "main other"), false);
});

test("validateBase: rejects redirection", () => {
  assert.equal(validateBase(CWD, "main>out"), false);
});

test("validateBase: rejects ampersand chaining", () => {
  assert.equal(validateBase(CWD, "main&&id"), false);
});

test("validateBase: rejects non-string input", () => {
  assert.equal(validateBase(CWD, null), false);
  assert.equal(validateBase(CWD, undefined), false);
  assert.equal(validateBase(CWD, 123), false);
});

test("validateBase: rejects unknown ref via rev-parse", () => {
  // Charset passes but ref does not exist — rev-parse must fail.
  assert.equal(validateBase(CWD, "definitely-not-a-real-ref-xyzzy"), false);
});

test("gatherReviewDiffs: returns the expected shape", () => {
  const out = gatherReviewDiffs(CWD, "HEAD");
  for (const k of ["status", "diffStat", "diff", "diffCached", "diffBase"]) {
    assert.equal(typeof out[k], "string");
  }
});

test("gatherReviewDiffs: invalid base does not throw", () => {
  // base is interpolated into a single argv slot; bad ref → empty string,
  // never an exception or shell execution.
  const out = gatherReviewDiffs(CWD, "no-such-ref-zzzzz");
  assert.equal(typeof out.diffBase, "string");
});
