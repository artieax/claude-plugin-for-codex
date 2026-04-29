import { execFileSync } from "node:child_process";

const BASE_OPTS = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
// Diffs on real PRs can blow past the default 1 MiB buffer.
const DIFF_OPTS = { ...BASE_OPTS, maxBuffer: 64 * 1024 * 1024 };

function git(args, cwd, opts = BASE_OPTS) {
  return execFileSync("git", args, { ...opts, cwd });
}

export function ensureGitRepo(cwd) {
  try {
    git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

export function resolveDefaultBase(cwd) {
  const candidates = [
    "origin/HEAD",
    "origin/main",
    "origin/master",
    "upstream/main",
    "main",
    "master",
  ];
  for (const candidate of candidates) {
    try {
      git(["rev-parse", "--verify", candidate], cwd);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return "main";
}

// Belt-and-suspenders: refs are passed as argv to execFileSync (no shell), so
// shell-injection chars cannot reach a shell. We still gate on a safe ref
// charset so a malformed --base fails fast rather than triggering git errors.
const SAFE_REF_RE = /^[\w/.\-@^~{}[\]]+$/;

export function validateBase(cwd, base) {
  if (typeof base !== "string" || !SAFE_REF_RE.test(base)) return false;
  try {
    git(["rev-parse", "--verify", base], cwd);
    return true;
  } catch {
    return false;
  }
}

// safeGit returns a structured result so the caller can distinguish
// "git ran and produced an empty diff" (ok=true, stdout="") from
// "git failed" (ok=false, stderr=...). The review prompt embeds the
// stderr as a warning so Claude doesn't silently treat a failure as
// "nothing to review".
export function safeGit(args, cwd, opts = DIFF_OPTS) {
  try {
    return { stdout: git(args, cwd, opts), stderr: "", ok: true };
  } catch (err) {
    const stderr =
      (err && err.stderr && String(err.stderr)) ||
      (err && err.message && String(err.message)) ||
      "git command failed";
    return { stdout: "", stderr, ok: false };
  }
}

// --no-ext-diff and --no-textconv disable user-configured external diff drivers
// and textconv filters. On an untrusted repo, those gitattributes/config hooks
// could otherwise execute arbitrary commands when we run `git diff`.
const DIFF_HARDEN = ["--no-ext-diff", "--no-textconv"];

export function diffShortstat(cwd, base) {
  return safeGit(["diff", ...DIFF_HARDEN, "--shortstat", `${base}...HEAD`], cwd).stdout.trim();
}

export function gatherReviewDiffs(cwd, base) {
  return {
    status: safeGit(["status", "--short"], cwd),
    diffStat: safeGit(["diff", ...DIFF_HARDEN, "--stat"], cwd),
    diff: safeGit(["diff", ...DIFF_HARDEN], cwd),
    diffCached: safeGit(["diff", ...DIFF_HARDEN, "--cached"], cwd),
    diffBase: safeGit(["diff", ...DIFF_HARDEN, `${base}...HEAD`], cwd),
  };
}
