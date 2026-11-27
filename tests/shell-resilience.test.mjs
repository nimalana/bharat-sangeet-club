import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// frontend-5: code-split screens had no error state, and the club archive tab
// had no loading state. These read the source because the screens are React
// components; the decision about which errors need a reload is tested in
// tests/load-state.test.mjs.

test("every code-split screen has a loading fallback", async () => {
  const shell = await read("app/portal.tsx");
  const dynamics = [...shell.matchAll(/const (\w+) = dynamic\(.*$/gm)].map((match) => match[0]);
  assert.equal(dynamics.length, 5, "the five heavy screens are still code-split");
  for (const line of dynamics) assert.match(line, /loading: SectionLoading/, line.slice(0, 40));
});

test("the screens sit inside an error boundary that is reset when the screen changes", async () => {
  const shell = await read("app/portal.tsx");
  assert.match(shell, /<SectionBoundary key=\{section\}>/);
  const open = shell.indexOf("<SectionBoundary key={section}>");
  const close = shell.indexOf("</SectionBoundary>");
  assert.ok(open > 0 && close > open);
  const inside = shell.slice(open, close);
  for (const screen of ["ClubDashboard", "SubgroupSpaces", "AdminPage", "RecordingWorkspace", "ClubArchiveManager", "AttendancePage", "MembersPage", "ResourceLibrary", "FinancePage"]) {
    assert.ok(inside.includes(`<${screen}`), `${screen} is inside the boundary`);
  }
});

test("the boundary offers Try again, and a reload for a chunk that cannot be fetched", async () => {
  const boundary = await read("components/ui/section-boundary.tsx");
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /isChunkLoadError\(this\.state\.error\)\) \{ window\.location\.reload\(\)/);
  assert.match(boundary, /role="alert"/);
});

test("anything left over lands on an error page with a retry, not a blank page", async () => {
  const page = await read("app/error.tsx");
  assert.match(page, /^"use client"/);
  assert.match(page, /export default function RootError/);
  assert.match(page, /reset\(\)/);
});
