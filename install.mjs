#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_PROMPTS = path.join(HERE, "prompts");
const DST_PROMPTS = path.join(os.homedir(), ".codex", "prompts");
const PKG_NAME = "@artieax/claude-plugin-for-codex";
// This package is distributed via GitHub (not the npm registry), so install /
// upgrade routes through `npm i -g github:...` rather than `npm update -g`.
const GH_SPEC = "github:artieax/claude-plugin-for-codex";

const USAGE = `Usage: claude-plugin-for-codex <subcommand> [--dry-run]

Subcommands:
  install    Copy prompts → ~/.codex/prompts/ and add claude-companion to PATH
  uninstall  Remove prompts from ~/.codex/prompts/ and uninstall the global package
  upgrade    Re-install from npm (npm update -g) then re-copy prompts
  doctor     Check that claude is installed, authenticated, and prompts are in place
`;

const args = process.argv.slice(2);
const sub = args.find((a) => !a.startsWith("--")) ?? "install";
const dryRun = args.includes("--dry-run");

if (!["install", "uninstall", "upgrade", "doctor"].includes(sub)) {
  console.error(`unknown subcommand: ${sub}\n${USAGE}`);
  process.exit(2);
}

function log(msg) { console.log(msg); }
function dry(msg) { if (dryRun) console.log(`[dry-run] ${msg}`); }
// shell:true is only needed on Windows (npm/.cmd shims). On POSIX we keep
// shell:false so argv elements never reach a shell parser.
const NEEDS_SHELL = process.platform === "win32";
function exec(cmd, cmdArgs, opts = {}) {
  if (dryRun) { dry(`${cmd} ${cmdArgs.join(" ")}`); return { status: 0 }; }
  return spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: NEEDS_SHELL, ...opts });
}

// ── install ────────────────────────────────────────────────────────────────

function copyPrompts() {
  if (!dryRun) fs.mkdirSync(DST_PROMPTS, { recursive: true });
  let copied = 0;
  for (const f of fs.readdirSync(SRC_PROMPTS)) {
    if (!f.endsWith(".md")) continue;
    const dst = path.join(DST_PROMPTS, f);
    if (dryRun) { dry(`copy ${f} → ${dst}`); }
    else { fs.copyFileSync(path.join(SRC_PROMPTS, f), dst); }
    copied++;
  }
  log(`copied ${copied} prompts → ${DST_PROMPTS}`);
  return copied;
}

function globalInstall() {
  log(`installing ${PKG_NAME} globally so \`claude-companion\` is on PATH…`);
  // --force overwrites stale shim files left by prior `npm link` registrations
  // under a pre-scoped name (e.g. unscoped `claude-plugin-for-codex`).
  const r = exec("npm", ["i", "-g", "--force", HERE]);
  if (r.status !== 0) {
    console.error(
      `\nglobal install failed. Run manually:\n  npm i -g --force ${HERE}`,
    );
    process.exit(r.status ?? 1);
  }
  log(`done. try \`claude-companion setup\` or \`/claude-setup\` in Codex.`);
}

// ── uninstall ──────────────────────────────────────────────────────────────

function removePrompts() {
  let removed = 0;
  try {
    for (const f of fs.readdirSync(DST_PROMPTS)) {
      if (!f.startsWith("claude-") || !f.endsWith(".md")) continue;
      const fp = path.join(DST_PROMPTS, f);
      if (dryRun) { dry(`remove ${fp}`); }
      else { fs.unlinkSync(fp); }
      removed++;
    }
  } catch { /* prompts dir didn't exist */ }
  log(`removed ${removed} prompt(s) from ${DST_PROMPTS}`);
}

function globalUninstall() {
  log(`uninstalling ${PKG_NAME} from global npm…`);
  const r = exec("npm", ["uninstall", "-g", PKG_NAME]);
  if (r.status !== 0) {
    console.error(`global uninstall returned non-zero (package may not have been installed globally).`);
  }
}

// ── upgrade ────────────────────────────────────────────────────────────────

function globalUpgrade() {
  // GitHub-installed packages don't get version bumps from `npm update`, so we
  // re-resolve the spec instead. --force is needed for the same reason as in
  // globalInstall (stale shim files from earlier link registrations).
  log(`upgrading ${PKG_NAME} from ${GH_SPEC}…`);
  const r = exec("npm", ["i", "-g", "--force", GH_SPEC]);
  if (r.status !== 0) {
    console.error(`upgrade failed. Run manually: npm i -g --force ${GH_SPEC}`);
    process.exit(r.status ?? 1);
  }
}

// ── doctor ─────────────────────────────────────────────────────────────────

function doctor() {
  let ok = true;

  // shell: NEEDS_SHELL on Windows because `claude` ships as a .cmd shim;
  // matches companionCheck below so doctor doesn't false-negative on Windows.
  const claudeCheck = spawnSync("claude", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: NEEDS_SHELL });
  if (claudeCheck.status === 0) {
    log(`claude CLI:  OK  (${claudeCheck.stdout.trim()})`);
  } else {
    console.error(`claude CLI:  MISSING — install from https://claude.ai/code`);
    ok = false;
  }

  const authCheck = spawnSync("claude", ["auth", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: NEEDS_SHELL });
  if (authCheck.status === 0) {
    log(`claude auth: OK`);
  } else {
    console.error(`claude auth: NOT LOGGED IN — run \`claude auth login\``);
    ok = false;
  }

  const companionCheck = spawnSync("claude-companion", ["--help"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: NEEDS_SHELL });
  if (companionCheck.status === 0 || companionCheck.stdout) {
    log(`claude-companion: OK`);
  } else {
    console.error(`claude-companion: NOT FOUND — run \`claude-plugin-for-codex install\``);
    ok = false;
  }

  let promptsOk = true;
  try {
    const files = fs.readdirSync(DST_PROMPTS).filter((f) => f.startsWith("claude-") && f.endsWith(".md"));
    if (files.length === 0) promptsOk = false;
  } catch { promptsOk = false; }
  if (promptsOk) {
    log(`prompts in ~/.codex/prompts/: OK`);
  } else {
    console.error(`prompts in ~/.codex/prompts/: MISSING — run \`claude-plugin-for-codex install\``);
    ok = false;
  }

  process.exit(ok ? 0 : 1);
}

// ── dispatch ───────────────────────────────────────────────────────────────

switch (sub) {
  case "install":
    copyPrompts();
    globalInstall();
    break;
  case "uninstall":
    removePrompts();
    globalUninstall();
    log("uninstall complete.");
    break;
  case "upgrade":
    globalUpgrade();
    // After the global install completes, the bin we're running (HERE) is the
    // pre-upgrade copy, so its prompts are stale. Hand off to the *new* global
    // bin to do the prompt sync from the freshly-installed package.
    {
      const r = exec("claude-plugin-for-codex", ["install"]);
      if (r.status !== 0) {
        console.error(
          "post-upgrade prompt sync failed. Run manually: claude-plugin-for-codex install",
        );
        process.exit(r.status ?? 1);
      }
    }
    log("upgrade complete.");
    break;
  case "doctor":
    doctor();
    break;
}
