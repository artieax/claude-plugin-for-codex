import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES_DIR = path.join(HERE, "suites");

const suites = fs
  .readdirSync(SUITES_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .sort();

if (suites.length === 0) {
  console.error(`no eval suites found in ${SUITES_DIR}`);
  process.exit(2);
}

const results = [];
for (const s of suites) {
  const configPath = path.join(SUITES_DIR, s);
  console.log(`\n=== suite: ${s} ===`);
  const r = spawnSync(
    "npx",
    ["promptfoo", "eval", "-c", configPath],
    { stdio: "inherit", shell: true },
  );
  results.push({ suite: s, code: r.status ?? -1 });
}

console.log("\n=== summary ===");
let failed = 0;
for (const { suite, code } of results) {
  const tag = code === 0 ? "PASS" : "FAIL";
  console.log(`${tag}  ${suite} (exit ${code})`);
  if (code !== 0) failed++;
}
process.exit(failed === 0 ? 0 : 1);
