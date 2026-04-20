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
  for (const candidate of ["main", "master"]) {
    try {
      run(`git rev-parse --verify ${candidate}`, cwd);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return "main";
}

export function diffShortstat(cwd, base) {
  try {
    return run(`git diff --shortstat ${base}...HEAD`, cwd).trim();
  } catch {
    return "";
  }
}
