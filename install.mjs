#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_PROMPTS = path.join(HERE, "prompts");
const DST_PROMPTS = path.join(os.homedir(), ".codex", "prompts");

const sub = process.argv[2] ?? "install";
if (sub !== "install") {
  console.error(`unknown subcommand: ${sub}`);
  console.error(`usage: claude-plugin-for-codex install`);
  process.exit(2);
}

fs.mkdirSync(DST_PROMPTS, { recursive: true });
let copied = 0;
for (const f of fs.readdirSync(SRC_PROMPTS)) {
  if (!f.endsWith(".md")) continue;
  fs.copyFileSync(path.join(SRC_PROMPTS, f), path.join(DST_PROMPTS, f));
  copied++;
}
console.log(`copied ${copied} prompts → ${DST_PROMPTS}`);

const pkgName = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).name;
spawnSync("npm", ["rm", "-g", pkgName], { stdio: "ignore", shell: true });

console.log(`installing ${HERE} globally so \`claude-companion\` is on PATH…`);
const r = spawnSync("npm", ["i", "-g", HERE], { stdio: "inherit", shell: true });
if (r.status !== 0) {
  console.error(`\nglobal install failed. Run manually:\n  npm i -g ${HERE}`);
  process.exit(r.status ?? 1);
}

console.log(`\ndone. try \`claude-companion setup\` or \`/claude-setup\` in Codex.`);
