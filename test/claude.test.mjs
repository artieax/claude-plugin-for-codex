import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteWinArg } from "../scripts/lib/claude.mjs";

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
