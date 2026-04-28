import { spawn } from "node:child_process";

export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];
export const REVIEW_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git status:*)",
  "Bash(git show:*)",
];

const REVIEW_TOOL_NAMES = ["Read", "Grep", "Glob", "Bash"];

export function buildAskArgv({
  prompt,
  allowedTools = READ_ONLY_TOOLS,
  permissionMode = "dontAsk",
}) {
  const argv = ["--output-format", "text", "--permission-mode", permissionMode];
  // --tools restricts which tools Claude may use; --allowedTools bypasses the prompt
  argv.push("--tools", READ_ONLY_TOOLS.join(","));
  argv.push("--allowedTools", ...allowedTools);
  argv.push("-p", prompt);
  return argv;
}

export function buildReviewArgv({ prompt }) {
  const argv = ["--output-format", "text"];
  argv.push("--tools", REVIEW_TOOL_NAMES.join(","));
  argv.push("--allowedTools", ...REVIEW_TOOLS);
  argv.push("--disallowedTools", "Edit", "Write", "MultiEdit");
  argv.push("-p", prompt);
  return argv;
}

function quoteWinArg(arg) {
  const s = String(arg);
  if (s === "" || /[\s"&|<>^()!%]/.test(s)) {
    return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
  }
  return s;
}

export function spawnClaude(argv, { cwd, onStdout, onStderr } = {}) {
  const isWin = process.platform === "win32";
  const spawnArgv = isWin ? argv.map(quoteWinArg) : argv;
  const child = spawn("claude", spawnArgv, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: isWin,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    const s = d.toString();
    stdout += s;
    onStdout?.(s);
  });
  child.stderr.on("data", (d) => {
    const s = d.toString();
    stderr += s;
    onStderr?.(s);
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ exitCode: code ?? -1, stdout, stderr }));
  });
  return { child, done };
}
