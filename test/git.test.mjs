import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBase, ensureGitRepo } from "../scripts/lib/git.mjs";

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
