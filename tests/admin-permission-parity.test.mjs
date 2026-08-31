import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("admin-facing archive controls use the shared management capability", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /const canManage = role !== "member";/);
  assert.match(page, /section === "recordings"[^\n]+\{canManage && <button[^\n]+Upload recording/);
  assert.match(page, /No recordings yet" text=\{canManage \?/);
  assert.doesNotMatch(page, /role === "executive" && <button/);
  assert.doesNotMatch(page, /text=\{role === "executive" \?/);
});
