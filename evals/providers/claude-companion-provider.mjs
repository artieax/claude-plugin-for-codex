import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const COMPANION = path.join(REPO_ROOT, "scripts", "claude-companion.mjs");
const JOBS_DIR = path.join(os.homedir(), ".claude-plugin-for-codex", "jobs");
const FIXTURE_ROOT = path.join(os.tmpdir(), "claude-plugin-for-codex-evals");

function prepReviewFixture() {
  const dir = path.join(FIXTURE_ROOT, "review-fixture");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const git = (...args) => {
    const r = spawnSync("git", args, {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
    }
    return r.stdout;
  };

  git("init", "-b", "main");
  git("config", "user.email", "eval@example.com");
  git("config", "user.name", "Eval");
  git("config", "commit.gpgsign", "false");

  const srcDir = path.join(dir, "src");
  fs.mkdirSync(srcDir);
  fs.writeFileSync(
    path.join(srcDir, "util.js"),
    [
      "export function sumToN(n) {",
      "  let total = 0;",
      "  for (let i = 1; i <= n; i++) total += i;",
      "  return total;",
      "}",
      "",
    ].join("\n"),
  );
  git("add", ".");
  git("commit", "-m", "initial correct impl");

  git("checkout", "-b", "feature");
  fs.writeFileSync(
    path.join(srcDir, "util.js"),
    [
      "export function sumToN(n) {",
      "  let total = 0;",
      "  for (let i = 1; i < n; i++) total += i;",
      "  return total;",
      "}",
      "",
    ].join("\n"),
  );
  git("add", ".");
  git("commit", "-m", "add feature");

  return dir;
}

function resolveCwd(config) {
  if (config.fixture === "review") return prepReviewFixture();
  if (config.cwd) {
    return path.isAbsolute(config.cwd)
      ? config.cwd
      : path.resolve(REPO_ROOT, config.cwd);
  }
  return process.cwd();
}

function runCompanionForeground({ args, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [COMPANION, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err?.message ?? err) });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForJobTerminal(jobId, timeoutMs) {
  const jobFile = path.join(JOBS_DIR, `${jobId}.json`);
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(jobFile, "utf8");
      const job = JSON.parse(raw);
      if (
        job.status === "done" ||
        job.status === "failed" ||
        job.status === "cancelled"
      ) {
        return job;
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500);
  }
  throw new Error(
    `job ${jobId} did not reach terminal state within ${timeoutMs}ms` +
      (lastErr ? ` (last read error: ${lastErr.message})` : ""),
  );
}

async function runCompanionBackground({ args, cwd, timeoutMs }) {
  const bgArgs = [args[0], "--background", ...args.slice(1)];
  const start = await runCompanionForeground({ args: bgArgs, cwd, timeoutMs: 30_000 });
  if (start.code !== 0) {
    return { error: `background start exited ${start.code}: ${start.stderr || start.stdout}` };
  }
  const m = start.stdout.match(/background(?:\s+review)?\s+job\s+([a-f0-9]+)/i);
  if (!m) {
    return { error: `could not parse job id from: ${start.stdout.trim()}` };
  }
  const jobId = m[1];
  let job;
  try {
    job = await waitForJobTerminal(jobId, timeoutMs);
  } catch (e) {
    return { error: e.message };
  }
  return {
    job,
    stdout: job.stdout ?? "",
    stderr: job.stderr ?? "",
  };
}

export default class ClaudeCompanionProvider {
  constructor(options = {}) {
    this.options = options;
    this.config = options.config ?? {};
    this.providerId =
      options.id ??
      `claude-companion:${this.config.verb ?? "ask"}:${this.config.mode ?? "fg"}`;
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt) {
    const verb = this.config.verb ?? "ask";
    const mode = this.config.mode ?? "foreground";
    const timeoutMs = this.config.timeoutMs ?? 180_000;
    const extraArgs = Array.isArray(this.config.extraArgs)
      ? this.config.extraArgs
      : [];
    const cwd = resolveCwd(this.config);
    const args = [verb, ...extraArgs, prompt];

    if (mode === "background") {
      const r = await runCompanionBackground({ args, cwd, timeoutMs });
      if (r.error) return { error: r.error };
      if (r.job.status !== "done") {
        return {
          error:
            `background job ${r.job.id} ended with status=${r.job.status}, ` +
            `exitCode=${r.job.exitCode}. stderr: ${r.stderr || "(empty)"}`,
        };
      }
      return {
        output: String(r.stdout).trim(),
        metadata: {
          jobStatus: r.job.status,
          jobId: r.job.id,
          exitCode: r.job.exitCode,
        },
      };
    }

    const r = await runCompanionForeground({ args, cwd, timeoutMs });
    if (r.code === 0) return { output: r.stdout.trim() };
    return {
      error: `claude-companion ${verb} exited ${r.code}: ${r.stderr || r.stdout}`,
    };
  }
}
