import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, splitRawArgumentString } from "../scripts/lib/args.mjs";

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
