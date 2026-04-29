import { spawn } from "node:child_process";

export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

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

// Review uses the same read-only allowlist as ask. The companion gathers the
// git diff itself (via execFileSync) and embeds it in the prompt, so Claude
// never needs Bash. --disallowedTools is kept as a defense-in-depth guard.
export function buildReviewArgv({ prompt, permissionMode = "dontAsk" }) {
  const argv = ["--output-format", "text", "--permission-mode", permissionMode];
  argv.push("--tools", READ_ONLY_TOOLS.join(","));
  argv.push("--allowedTools", ...READ_ONLY_TOOLS);
  argv.push("--disallowedTools", "Edit", "Write", "MultiEdit", "Bash");
  argv.push("-p", prompt);
  return argv;
}

// quoteWinArg renders an argv slot for Windows `cmd.exe` when we have to spawn
// with `shell: true` (because `claude` ships as a .cmd shim on Windows).
// We wrap any value containing whitespace or cmd metacharacters
// (`" & | < > ^ ( ) ! %`) in quotes, escape embedded `"` per the
// classic "double up backslashes preceding quotes" rule, and double a
// trailing run of backslashes so a final `\"` doesn't escape the closing quote.
// `!` is included because cmd.exe expands `!VAR!` under DelayedExpansion;
// `%` because it expands `%VAR%`; both are neutralized by the surrounding
// quotes when the called program's runtime parses argv.
export function quoteWinArg(arg) {
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
