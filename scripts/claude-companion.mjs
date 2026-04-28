#!/usr/bin/env node
import { spawn, spawnSync, execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { appendFile, readStdin } from "./lib/fs.mjs";
import { buildAskArgv, buildReviewArgv, spawnClaude } from "./lib/claude.mjs";
import { ensureGitRepo, resolveDefaultBase, validateBase } from "./lib/git.mjs";
import {
  ROOT,
  autoPruneByEnv,
  generateJobId,
  jobFile,
  jobLog,
  latestJob,
  listJobsNewestFirst,
  pruneJobs,
  readJob,
  redactString,
  upsertJob,
} from "./lib/state.mjs";
import { renderJob, renderSetup, renderStatusTable } from "./lib/render.mjs";

const COMPANION = fileURLToPath(import.meta.url);

// Live console output stays raw; on-disk log is redacted when env says so.
const REDACT_LOG = () => process.env.CLAUDE_COMPANION_REDACT === "1";
const logChunk = (s) => (REDACT_LOG() ? redactString(s) : s);

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  claude-companion ask [--background] <prompt...>",
      "  claude-companion review [--background] [--base <ref>] [--focus <text>]",
      "  claude-companion status [<job-id>]",
      "  claude-companion result [<job-id>]",
      "  claude-companion cancel <job-id>",
      "  claude-companion prune [--older-than <Nd|Nh|Nm>] [--all]",
      "  claude-companion setup",
      "",
    ].join("\n"),
  );
}

function summarize(stdout) {
  return String(stdout ?? "")
    .split("\n")
    .find((l) => l.trim())
    ?.slice(0, 80) ?? "";
}

async function runInline(kind, argv, cwd, prompt) {
  const id = generateJobId();
  upsertJob({ id, kind, status: "running", argv, cwd, prompt, pid: process.pid });
  const { done } = spawnClaude(argv, {
    cwd,
    onStdout: (s) => {
      process.stdout.write(s);
      appendFile(jobLog(id), logChunk(s));
    },
    onStderr: (s) => {
      process.stderr.write(s);
      appendFile(jobLog(id), logChunk(s));
    },
  });
  const { exitCode, stdout, stderr } = await done;
  upsertJob({
    id,
    status: exitCode === 0 ? "done" : "failed",
    exitCode,
    stdout,
    stderr,
    endedAt: new Date().toISOString(),
    pid: null,
    summary: summarize(stdout),
  });
  if (exitCode !== 0) process.exit(exitCode);
}

function spawnWorker(kind, argv, cwd, prompt) {
  const id = generateJobId();
  upsertJob({ id, kind, status: "pending", argv, cwd, prompt });
  const child = spawn(process.execPath, [COMPANION, "__worker", id], {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return id;
}

async function cmdAsk(tokens) {
  const { flags, positional } = parseArgs(tokens, {
    booleanFlags: new Set(["background"]),
  });
  const background = flags.get("background") === true;
  let prompt = positional.join(" ").trim();
  if (!prompt) {
    const piped = await readStdin();
    if (piped) prompt = piped.trim();
  }
  if (!prompt) {
    process.stderr.write("claude-companion ask: no prompt given\n");
    process.exit(2);
  }
  const argv = buildAskArgv({ prompt });
  if (background) {
    const id = spawnWorker("ask", argv, process.cwd(), prompt);
    process.stdout.write(
      `Started background job ${id}. Check with \`/claude-status ${id}\` or \`/claude-result ${id}\`.\n`,
    );
  } else {
    await runInline("ask", argv, process.cwd(), prompt);
  }
}

async function cmdReview(tokens) {
  const { flags, positional } = parseArgs(tokens, {
    booleanFlags: new Set(["background"]),
    restFlags: new Set(["focus"]),
  });
  const background = flags.get("background") === true;
  const cwd = process.cwd();
  if (!ensureGitRepo(cwd)) {
    process.stderr.write("claude-companion review: not a git repository\n");
    process.exit(2);
  }
  const rawBase = typeof flags.get("base") === "string" ? flags.get("base") : null;
  if (rawBase && !validateBase(cwd, rawBase)) {
    process.stderr.write(`claude-companion review: invalid --base ref: ${rawBase}\n`);
    process.exit(2);
  }
  const base = rawBase ?? resolveDefaultBase(cwd);
  const focusFromFlag = typeof flags.get("focus") === "string" ? flags.get("focus") : "";
  const focus = (focusFromFlag || positional.join(" ")).trim();
  const focusLine = focus ? `\n\nFocus: ${focus}` : "";
  const prompt =
    `Review the changes in this repository. ` +
    `Run these commands in order: ` +
    `(1) \`git status --short\`, ` +
    `(2) \`git diff --stat\`, ` +
    `(3) \`git diff\`, ` +
    `(4) \`git diff --cached\`, ` +
    `(5) \`git diff ${base}...HEAD\`. ` +
    `Report: (1) bugs or correctness issues, (2) security concerns, ` +
    `(3) test coverage gaps, (4) anything surprising. ` +
    `Be concrete — quote file paths and line numbers. ` +
    `Do NOT modify any files.${focusLine}`;
  const argv = buildReviewArgv({ prompt });
  if (background) {
    const id = spawnWorker("review", argv, cwd, prompt);
    process.stdout.write(`Started background review job ${id}.\n`);
  } else {
    await runInline("review", argv, cwd, prompt);
  }
}

function cmdStatus(tokens) {
  const { positional } = parseArgs(tokens);
  if (positional.length) {
    process.stdout.write(renderJob(readJob(positional[0])));
  } else {
    process.stdout.write(renderStatusTable(listJobsNewestFirst()));
  }
}

function cmdResult(tokens) {
  const { positional } = parseArgs(tokens);
  const job = positional[0] ? readJob(positional[0]) : latestJob();
  if (!job) {
    process.stderr.write("No jobs found.\n");
    process.exit(2);
  }
  process.stdout.write(renderJob(job));
}

function cmdCancel(tokens) {
  const { positional } = parseArgs(tokens);
  const id = positional[0];
  if (!id) {
    process.stderr.write("claude-companion cancel: job id required\n");
    process.exit(2);
  }
  const job = readJob(id);
  if (!job) {
    process.stderr.write("claude-companion cancel: job not found\n");
    process.exit(2);
  }
  if (job.status !== "running" && job.status !== "pending") {
    process.stdout.write(`Job ${id} already ${job.status}.\n`);
    return;
  }
  if (job.pid) {
    if (process.platform === "win32") {
      // Windows: negative PIDs are unsupported — use taskkill for tree kill
      const pids = [job.claudePid, job.pid].filter(Number.isInteger);
      for (const pid of pids) {
        try {
          spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
        } catch { /* already gone */ }
      }
    } else {
      // POSIX: try process group kill (worker + claude child) first
      try {
        process.kill(-job.pid, "SIGTERM");
      } catch {
        try { process.kill(job.pid, "SIGTERM"); } catch { /* already gone */ }
      }
      // Also explicitly kill the claude child if we stored its PID
      if (job.claudePid) {
        try { process.kill(job.claudePid, "SIGTERM"); } catch { /* already gone */ }
      }
    }
  }
  upsertJob({
    id,
    status: "cancelled",
    endedAt: new Date().toISOString(),
    pid: null,
  });
  process.stdout.write(`Cancelled ${id}.\n`);
}

function cmdPrune(tokens) {
  const { flags } = parseArgs(tokens, { booleanFlags: new Set(["all"]) });
  const all = flags.get("all") === true;
  const olderThanRaw = typeof flags.get("older-than") === "string" ? flags.get("older-than") : null;
  let olderThanMs = null;
  if (olderThanRaw) {
    const m = olderThanRaw.match(/^(\d+)([dhm])$/);
    if (!m) {
      process.stderr.write("claude-companion prune: --older-than format must be e.g. 7d, 24h, 60m\n");
      process.exit(2);
    }
    const multiplier = { d: 86400000, h: 3600000, m: 60000 }[m[2]];
    olderThanMs = Number(m[1]) * multiplier;
  }
  if (!all && olderThanMs === null) {
    process.stderr.write("claude-companion prune: pass --all or --older-than <Nd|Nh|Nm>\n");
    process.exit(2);
  }
  const count = pruneJobs({ all, olderThanMs });
  process.stdout.write(`Pruned ${count} job(s) from ${ROOT}\n`);
}

function cmdSetup() {
  const report = { stateDir: ROOT };
  try {
    report.claudeVersion = execSync("claude --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    report.claudeFound = true;
  } catch {
    report.claudeFound = false;
  }
  try {
    execSync("claude auth status", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    report.claudeAuthed = true;
  } catch {
    report.claudeAuthed = false;
  }
  process.stdout.write(renderSetup(report));
}

async function cmdWorker(tokens) {
  const id = tokens[0];
  if (!id) process.exit(2);
  const job = readJob(id);
  if (!job) process.exit(2);
  upsertJob({ id, status: "running", pid: process.pid });
  const { child, done } = spawnClaude(job.argv, {
    cwd: job.cwd,
    onStdout: (s) => appendFile(jobLog(id), logChunk(s)),
    onStderr: (s) => appendFile(jobLog(id), logChunk(s)),
  });
  // Store the Claude child PID so cancel can kill it on Windows too
  if (child.pid) upsertJob({ id, claudePid: child.pid });
  const { exitCode, stdout, stderr } = await done;
  // Don't overwrite a job that was cancelled while we were running
  const current = readJob(id);
  if (current?.status === "cancelled") {
    process.exit(exitCode);
  }
  upsertJob({
    id,
    status: exitCode === 0 ? "done" : "failed",
    exitCode,
    stdout,
    stderr,
    endedAt: new Date().toISOString(),
    pid: null,
    claudePid: null,
    summary: summarize(stdout),
  });
  process.exit(exitCode);
}

const DISPATCH = {
  ask: cmdAsk,
  review: cmdReview,
  status: cmdStatus,
  result: cmdResult,
  cancel: cmdCancel,
  prune: cmdPrune,
  setup: cmdSetup,
  __worker: cmdWorker,
};

async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  if (!verb || verb === "help" || verb === "--help" || verb === "-h") {
    printUsage();
    return;
  }
  // Honor CLAUDE_COMPANION_RETENTION_DAYS for every invocation except __worker
  // (__worker writes back to a job that the parent expects to still exist).
  if (verb !== "__worker") autoPruneByEnv();
  const cmd = DISPATCH[verb];
  if (!cmd) {
    process.stderr.write(`Unknown verb: ${verb}\n`);
    printUsage();
    process.exit(2);
  }
  // When invoked as `claude-companion ask "$ARGUMENTS"`, rest is a single
  // string holding the whole arg list — split it. When invoked directly by a
  // user in a shell, rest is already token-split.
  const tokens = rest.length === 1 ? splitRawArgumentString(rest[0]) : rest;
  await Promise.resolve(cmd(tokens));
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + "\n");
  process.exit(1);
});
