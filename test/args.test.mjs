import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, parseAskTokens, splitRawArgumentString } from "../scripts/lib/args.mjs";

// splitRawArgumentString

test("splitRawArgumentString: double-quoted string is one token without quotes", () => {
  const t = splitRawArgumentString('--focus "auth middleware"');
  assert.deepEqual(t, ["--focus", "auth middleware"]);
});

test("splitRawArgumentString: single-quoted string is one token without quotes", () => {
  const t = splitRawArgumentString("--focus 'auth middleware'");
  assert.deepEqual(t, ["--focus", "auth middleware"]);
});

test("splitRawArgumentString: backslash escapes inside quotes", () => {
  const t = splitRawArgumentString('"auth\\ middleware"');
  assert.deepEqual(t, ["auth middleware"]);
});

test("splitRawArgumentString: unquoted words split on whitespace", () => {
  assert.deepEqual(splitRawArgumentString("a b c"), ["a", "b", "c"]);
});

test("splitRawArgumentString: null/undefined returns []", () => {
  assert.deepEqual(splitRawArgumentString(null), []);
  assert.deepEqual(splitRawArgumentString(undefined), []);
});

// parseArgs — restFlags

test("parseArgs: --focus with restFlags consumes multiple unquoted tokens", () => {
  const { flags, positional } = parseArgs(
    ["--focus", "auth", "middleware", "--background"],
    { booleanFlags: new Set(["background"]), restFlags: new Set(["focus"]) },
  );
  assert.equal(flags.get("focus"), "auth middleware");
  assert.equal(flags.get("background"), true);
  assert.deepEqual(positional, []);
});

test("parseArgs: restFlags stops consuming at next -- flag", () => {
  const { flags } = parseArgs(
    ["--focus", "auth", "middleware", "--base", "main"],
    { restFlags: new Set(["focus"]) },
  );
  assert.equal(flags.get("focus"), "auth middleware");
  assert.equal(flags.get("base"), "main");
});

test("parseArgs: quoted value (after splitRawArgumentString) works end-to-end", () => {
  const tokens = splitRawArgumentString('--focus "auth middleware" --background');
  const { flags } = parseArgs(tokens, {
    booleanFlags: new Set(["background"]),
    restFlags: new Set(["focus"]),
  });
  assert.equal(flags.get("focus"), "auth middleware");
  assert.equal(flags.get("background"), true);
});

test("parseArgs: unknown flag treated as single-value flag", () => {
  const { flags } = parseArgs(["--base", "develop"]);
  assert.equal(flags.get("base"), "develop");
});

test("parseArgs: boolean flag has no value", () => {
  const { flags, positional } = parseArgs(["--background", "hello"], {
    booleanFlags: new Set(["background"]),
  });
  assert.equal(flags.get("background"), true);
  assert.deepEqual(positional, ["hello"]);
});

// parseAskTokens — `ask` keeps unknown --flags in the prompt (only --background
// is consumed) so prompts like `what does --base do?` are not silently mangled.

test("parseAskTokens: --background as the first token sets background", () => {
  const r = parseAskTokens(["--background", "hello", "world"]);
  assert.equal(r.background, true);
  assert.equal(r.prompt, "hello world");
});

test("parseAskTokens: --background anywhere sets background", () => {
  const r = parseAskTokens(["hello", "--background", "world"]);
  assert.equal(r.background, true);
  assert.equal(r.prompt, "hello world");
});

test("parseAskTokens: unknown --flag stays in the prompt verbatim", () => {
  const r = parseAskTokens(["what", "does", "--base", "do", "in", "this", "repo?"]);
  assert.equal(r.background, false);
  assert.equal(r.prompt, "what does --base do in this repo?");
});

test("parseAskTokens: prompt with --base value-shaped argument is preserved", () => {
  const r = parseAskTokens(["explain", "--focus", "auth", "middleware"]);
  assert.equal(r.background, false);
  assert.equal(r.prompt, "explain --focus auth middleware");
});

test("parseAskTokens: empty / non-array input is safe", () => {
  assert.deepEqual(parseAskTokens([]), { background: false, prompt: "" });
  assert.deepEqual(parseAskTokens(undefined), { background: false, prompt: "" });
  assert.deepEqual(parseAskTokens(null), { background: false, prompt: "" });
});
