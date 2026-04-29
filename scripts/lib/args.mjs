// `ask` accepts free-form prompt text that often contains `--flag`-shaped tokens
// (e.g. `what does --base do?`). parseArgs would consume those as flags and
// drop them from the prompt, so ask uses this stricter splitter: only the
// `--background` boolean is recognized; everything else stays in the prompt.
export function parseAskTokens(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  const background = list.includes("--background");
  const promptTokens = list.filter((t) => t !== "--background");
  return { background, prompt: promptTokens.join(" ").trim() };
}

// restFlags: flag names whose value consumes all remaining tokens until the next --flag.
// Useful for --focus auth middleware (no quoting required).
export function parseArgs(tokens, { booleanFlags = new Set(), restFlags = new Set() } = {}) {
  const flags = new Map();
  const positional = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (typeof t !== "string") continue;
    if (t.startsWith("--")) {
      const name = t.slice(2);
      if (booleanFlags.has(name)) {
        flags.set(name, true);
        continue;
      }
      if (restFlags.has(name)) {
        const rest = [];
        for (let j = i + 1; j < tokens.length; j++) {
          if (String(tokens[j]).startsWith("--")) break;
          rest.push(tokens[j]);
          i = j;
        }
        flags.set(name, rest.join(" "));
        continue;
      }
      const next = tokens[i + 1];
      if (next != null && !String(next).startsWith("--")) {
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, true);
      }
    } else {
      positional.push(t);
    }
  }
  return { flags, positional };
}

export function splitRawArgumentString(raw) {
  if (raw == null) return [];
  const s = String(raw);
  const tokens = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\" && i + 1 < s.length) {
        cur += s[++i];
      } else if (ch === quote) {
        quote = null; // close quote — do not add the quote char to the token
      } else {
        cur += ch;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch; // open quote — do not add the quote char to the token
    } else if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}
