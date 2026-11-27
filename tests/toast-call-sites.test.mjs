import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// frontend (round 3): a toast's tone is not guessed for text that comes from the
// database. The words of a database message say nothing about whether it is a
// failure (81 of the 157 messages the migrations raise would read as a success),
// so every call that shows database text must say "error" itself.
// toast.test.mjs runs the real messages through the error path; this test keeps
// the call sites honest. It reads every notify(...) call in app/, components/ and lib/.

const root = new URL("../", import.meta.url);

async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(`${path}/`));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

// Reads from just after an opening "(" to its matching ")". Strings, template
// literals and comments are skipped so a ")" inside a message does not end the call.
// Returns the top-level arguments (trimmed source text).
function readArguments(source, start) {
  const args = [];
  let depth = 0;
  let current = "";
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      let end = i + 1;
      while (end < source.length && source[end] !== char) end += source[end] === "\\" ? 2 : 1;
      current += source.slice(i, end + 1);
      i = end;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") { while (i < source.length && source[i] !== "\n") i += 1; continue; }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) { args.push(current.trim()); return args; }
      depth -= 1;
    }
    if (char === "," && depth === 0) { args.push(current.trim()); current = ""; continue; }
    current += char;
  }
  throw new Error("unbalanced notify( call");
}

async function notifyCalls() {
  const calls = [];
  for (const file of [...await sourceFiles("app/"), ...await sourceFiles("components/"), ...await sourceFiles("lib/")]) {
    const source = await readFile(new URL(file, root), "utf8");
    for (const match of source.matchAll(/(?<![\w.])notify\(/g)) {
      const line = source.slice(0, match.index).split("\n").length;
      const args = readArguments(source, match.index + match[0].length);
      calls.push({ file, line, args, text: source.slice(match.index, source.indexOf("\n", match.index)).trim() });
    }
  }
  return calls;
}

const tone = (call) => call.args[1];

test("the scan sees the calls it is meant to check", async () => {
  const calls = await notifyCalls();
  assert.ok(calls.length > 120, `${calls.length} notify calls found`);
  for (const file of ["app/attendance.tsx", "app/portal.tsx", "app/finance.tsx", "components/attendance/attendance-corrections.tsx", "components/recordings/recording-manage.tsx"]) {
    assert.ok(calls.some((call) => call.file === file), file);
  }
  const tagged = calls.filter((call) => /friendlyError\s*\(|\.message\b/.test(call.args[0]) && tone(call) === '"error"');
  assert.ok(tagged.length > 40, `${tagged.length} database-text calls tagged as errors`);
});

test("every notify() that shows database text passes \"error\"", async () => {
  const untagged = (await notifyCalls())
    .filter((call) => /friendlyError\s*\(|\.message\b/.test(call.args[0]) && tone(call) !== '"error"')
    .map((call) => `${call.file}:${call.line}  ${call.text}`);
  assert.deepEqual(untagged, [], "database text must be tagged \"error\"; its words cannot be read for tone");
});

test("a message held in a variable states its tone (it may carry database text)", async () => {
  const untagged = (await notifyCalls())
    .filter((call) => /^[A-Za-z_$][\w$.]*$/.test(call.args[0]) && !tone(call))
    .map((call) => `${call.file}:${call.line}  ${call.text}`);
  assert.deepEqual(untagged, [], "pass \"error\" or \"success\" with a message that is not written at the call");
});

test("a tone is only ever one of the two the toast knows", async () => {
  const odd = (await notifyCalls())
    .filter((call) => call.args[1] !== undefined && !['"error"', '"success"'].includes(call.args[1]))
    .map((call) => `${call.file}:${call.line}  ${call.text}`);
  assert.deepEqual(odd, []);
});
