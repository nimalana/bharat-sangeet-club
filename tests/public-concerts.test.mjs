import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_CONCERT_COLUMNS, loadPublicConcerts, parsePublicConcerts, publicConcertsUrl } from "../lib/public-concerts.ts";

const row = { id: 1, title: "Spring", description: "d", type: "recording", storage_path: "a/b.mp3", event_date: "2026-04-01", raga: null, tala: null, created_at: "2026-04-02T00:00:00Z", is_public: true };

test("the request asks only for public recordings and the columns the page shows", () => {
  const url = new URL(publicConcertsUrl("https://x.supabase.co/"));
  assert.equal(url.origin + url.pathname, "https://x.supabase.co/rest/v1/archive_items");
  assert.equal(url.searchParams.get("is_public"), "eq.true");
  assert.equal(url.searchParams.get("type"), "eq.recording");
  assert.equal(url.searchParams.get("select"), PUBLIC_CONCERT_COLUMNS);
  assert.doesNotMatch(PUBLIC_CONCERT_COLUMNS, /signed|url/i, "no signed link is ever part of the cached list");
});

test("rows that are not public recordings are dropped, and bad bodies give null", () => {
  assert.deepEqual(parsePublicConcerts([row, { ...row, id: 2, is_public: false }, { ...row, id: 3, type: "other" }, null, { id: "x" }]).map((r) => r.id), [1]);
  assert.equal(parsePublicConcerts({ message: "error" }), null);
});

test("the list is fetched with the anon key, cached five minutes, and failure gives null (browser fallback)", async () => {
  let seen;
  const ok = await loadPublicConcerts({ url: "https://x.supabase.co", key: "anon" }, async (input, init) => { seen = { input, init }; return { ok: true, json: async () => [row] }; });
  assert.equal(ok.length, 1);
  assert.equal(seen.init.headers.apikey, "anon");
  assert.equal(seen.init.headers.Authorization, "Bearer anon");
  assert.equal(seen.init.next.revalidate, 300);
  assert.equal(await loadPublicConcerts({ url: "https://x.supabase.co", key: "anon" }, async () => ({ ok: false, json: async () => [] })), null);
  assert.equal(await loadPublicConcerts({ url: "https://x.supabase.co", key: "anon" }, async () => { throw new Error("down"); }), null);
  assert.equal(await loadPublicConcerts({}), null);
});
