import { execSync } from "node:child_process";

function run(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function ensureGitRepo(cwd) {
  try {
    run("git rev-parse --is-inside-work-tree", cwd);
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
      run(`git rev-parse --verify ${candidate}`, cwd);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return "main";
}

// Allow only safe git ref characters to prevent shell injection via --base
const SAFE_REF_RE = /^[\w/.\-@^~{}[\]]+$/;

export function validateBase(cwd, base) {
  if (!SAFE_REF_RE.test(base)) return false;
  try {
    run(`git rev-parse --verify ${base}`, cwd);
    return true;
  } catch {
    return false;
  }
}

export function diffShortstat(cwd, base) {
  try {
    return run(`git diff --shortstat ${base}...HEAD`, cwd).trim();
  } catch {
    return "";
  }
}
