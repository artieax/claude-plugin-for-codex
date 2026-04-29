import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAskArgv,
  buildReviewArgv,
  decorateForMode,
  quoteWinArg,
} from "../scripts/lib/claude.mjs";

// Windows uses `shell: true` because `claude` ships as a `.cmd` shim, so each
// argv slot is re-parsed by cmd.exe. quoteWinArg wraps values that contain
// whitespace or cmd metacharacters and escapes embedded quotes / trailing
// backslashes. Each case below is a regression target — bugs in quoting
// silently corrupt the prompt and are hard to notice from output alone.

test("quoteWinArg: plain alphanumeric is returned unchanged", () => {
  assert.equal(quoteWinArg("hello"), "hello");
  assert.equal(quoteWinArg("path123"), "path123");
});

test("quoteWinArg: empty string is wrapped as empty quoted token", () => {
  assert.equal(quoteWinArg(""), '""');
});

test("quoteWinArg: whitespace forces quoting", () => {
  assert.equal(quoteWinArg("hello world"), '"hello world"');
});

test("quoteWinArg: %VAR% (cmd.exe variable expansion) is wrapped in quotes", () => {
  // The % sign can't be defanged inline, but quoting prevents cmd.exe from
  // splitting on it; the receiving program's argv parser sees the literal.
  assert.equal(quoteWinArg("%PATH%"), '"%PATH%"');
  assert.equal(quoteWinArg("100%complete"), '"100%complete"');
});

test("quoteWinArg: !VAR! (delayed expansion) is wrapped in quotes", () => {
  assert.equal(quoteWinArg("!USERNAME!"), '"!USERNAME!"');
  assert.equal(quoteWinArg("alpha!beta!gamma"), '"alpha!beta!gamma"');
});

test("quoteWinArg: ^ (cmd.exe escape char) is wrapped in quotes", () => {
  assert.equal(quoteWinArg("^caret"), '"^caret"');
  assert.equal(quoteWinArg("a^b^c"), '"a^b^c"');
});

test("quoteWinArg: cmd metachars & | < > ( ) all force quoting", () => {
  assert.equal(quoteWinArg("a&b"), '"a&b"');
  assert.equal(quoteWinArg("a|b"), '"a|b"');
  assert.equal(quoteWinArg("a<b"), '"a<b"');
  assert.equal(quoteWinArg("a>b"), '"a>b"');
  assert.equal(quoteWinArg("a(b)"), '"a(b)"');
});

test("quoteWinArg: embedded double quotes are escaped", () => {
  // `"hello"` → `"\"hello\""` so the called program sees the literal "hello"
  // with quotes (after argv parsing).
  assert.equal(quoteWinArg('"hello"'), '"\\"hello\\""');
  assert.equal(quoteWinArg('say "hi"'), '"say \\"hi\\""');
});

test("quoteWinArg: newline in prompt forces quoting and is preserved verbatim", () => {
  // Multi-line prompts are common (review, multi-line ask). \s matches the
  // newline so the value is wrapped; the newline itself is not escaped.
  const input = "line1\nline2\nline3";
  const out = quoteWinArg(input);
  assert.equal(out, `"${input}"`);
  assert.ok(out.includes("\n"));
});

test("quoteWinArg: trailing backslash on a quoted token is doubled", () => {
  // Without doubling, the closing quote would be treated as escaped: the
  // CommandLineToArgvW rule says (2n+1) backslashes + " ⇒ n backslashes + ".
  // With a single trailing backslash inside quotes, we emit `\\` so the
  // receiving runtime sees one literal backslash and a closing quote.
  assert.equal(quoteWinArg("hello path\\"), '"hello path\\\\"');
  assert.equal(quoteWinArg("hello path\\\\"), '"hello path\\\\\\\\"');
});

test("quoteWinArg: bare backslash (no metachars) is returned unchanged", () => {
  // A lone backslash is not a cmd metacharacter; only the trailing-backslash
  // doubling rule matters when we're already inside quotes.
  assert.equal(quoteWinArg("path\\to\\file"), "path\\to\\file");
});

test("quoteWinArg: backslashes before embedded quote are doubled", () => {
  // (\\)" must become (\\\\)\\\" so the consumer's argv parser sees `\"`.
  // Input: a\"  (3 chars: a, \, ")  →  output wrapped: "a\\\""
  assert.equal(quoteWinArg('a\\"'), '"a\\\\\\""');
});

// decorateForMode / buildAskArgv / buildReviewArgv — output mode plumbing

test("decorateForMode: raw mode returns prompt unchanged", () => {
  assert.equal(decorateForMode("hello", "raw"), "hello");
  assert.equal(decorateForMode("hello", undefined), "hello");
});

test("decorateForMode: summary mode appends a short-output instruction", () => {
  const out = decorateForMode("hello", "summary");
  assert.notEqual(out, "hello");
  assert.match(out, /bullets/i);
  assert.ok(out.startsWith("hello"), "user prompt must come first");
});

test("buildAskArgv: default mode is raw — prompt slot is verbatim", () => {
  const argv = buildAskArgv({ prompt: "what does X do?" });
  const i = argv.indexOf("-p");
  assert.equal(argv[i + 1], "what does X do?");
});

test("buildAskArgv: mode=summary appends summary suffix to the -p slot", () => {
  const argv = buildAskArgv({ prompt: "what does X do?", mode: "summary" });
  const i = argv.indexOf("-p");
  assert.match(argv[i + 1], /^what does X do\?/);
  assert.match(argv[i + 1], /bullets/i);
});

test("buildAskArgv: mode does not affect tool restrictions", () => {
  // --tools / --allowedTools must remain Read,Grep,Glob in both modes.
  for (const mode of ["raw", "summary"]) {
    const argv = buildAskArgv({ prompt: "x", mode });
    const ti = argv.indexOf("--tools");
    assert.equal(argv[ti + 1], "Read,Grep,Glob");
    const ai = argv.indexOf("--allowedTools");
    assert.deepEqual(argv.slice(ai + 1, ai + 4), ["Read", "Grep", "Glob"]);
  }
});

test("buildReviewArgv: mode=summary still includes Bash in --disallowedTools", () => {
  const argv = buildReviewArgv({ prompt: "review", mode: "summary" });
  const i = argv.indexOf("--disallowedTools");
  assert.deepEqual(argv.slice(i + 1, i + 5), ["Edit", "Write", "MultiEdit", "Bash"]);
});

test("buildReviewArgv: mode=summary appends summary suffix to the -p slot", () => {
  const argv = buildReviewArgv({ prompt: "review the diff", mode: "summary" });
  const i = argv.indexOf("-p");
  assert.match(argv[i + 1], /^review the diff/);
  assert.match(argv[i + 1], /bullets/i);
});
