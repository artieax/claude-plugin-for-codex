#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { appendFile, readStdin } from "./lib/fs.mjs";
import { buildAskArgv, buildReviewArgv, spawnClaude } from "./lib/claude.mjs";
import { ensureGitRepo, resolveDefaultBase } from "./lib/git.mjs";
import {
  ROOT,
  generateJobId,
  jobLog,
  latestJob,
  listJobsNewestFirst,
  readJob,
  upsertJob,
} from "./lib/state.mjs";
import { renderJob, renderSetup, renderStatusTable } from "./lib/render.mjs";

const COMPANION = fileURLToPath(import.meta.url);

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  claude-companion ask [--background] <prompt...>",
      "  claude-companion review [--background] [--base <ref>] [--focus <text>]",
      "  claude-companion status [<job-id>]",
      "  claude-companion result [<job-id>]",
      "  claude-companion cancel <job-id>",
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
      appendFile(jobLog(id), s);
    },
    onStderr: (s) => {
      process.stderr.write(s);
      appendFile(jobLog(id), s);
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
  });
  const background = flags.get("background") === true;
  const cwd = process.cwd();
  if (!ensureGitRepo(cwd)) {
    process.stderr.write("claude-companion review: not a git repository\n");
    process.exit(2);
  }
  const base =
    (typeof flags.get("base") === "string" ? flags.get("base") : null) ??
    resolveDefaultBase(cwd);
  const focusFromFlag = typeof flags.get("focus") === "string" ? flags.get("focus") : "";
  const focus = (focusFromFlag || positional.join(" ")).trim();
  const focusLine = focus ? `\n\nFocus: ${focus}` : "";
  const prompt =
    `Review the current working tree's changes against \`${base}\`. ` +
    `Run \`git diff ${base}...HEAD\` to see the changes. ` +
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
    try {
      process.kill(job.pid, "SIGTERM");
    } catch {
      /* already gone */
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
  const { done } = spawnClaude(job.argv, {
    cwd: job.cwd,
    onStdout: (s) => appendFile(jobLog(id), s),
    onStderr: (s) => appendFile(jobLog(id), s),
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
  process.exit(exitCode);
}

const DISPATCH = {
  ask: cmdAsk,
  review: cmdReview,
  status: cmdStatus,
  result: cmdResult,
  cancel: cmdCancel,
  setup: cmdSetup,
  __worker: cmdWorker,
};

async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  if (!verb || verb === "help" || verb === "--help" || verb === "-h") {
    printUsage();
    return;
  }
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
