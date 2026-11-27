// Signed-out visitors (the anon role): the public concert archive works, and nothing else does.
// The sweep covers every table, every RPC and every storage bucket listed in inventory.json
// (made by inventory.sql), so a table or function added later shows up as a failing sweep.
import { readFileSync } from "node:fs";
import { ok, equal, succeeded, rowsOf, describeError } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";
import { wav, sha256 } from "../lib/fixtures.mjs";
import { put, sign, download, freshUrl, uid } from "../lib/storage.mjs";
import { loadPublicConcerts, publicConcertsUrl, PUBLIC_CONCERT_COLUMNS } from "../../../lib/public-concerts.ts";

const inventory = JSON.parse(readFileSync(new URL("../inventory.json", import.meta.url), "utf8"));

function dummy(type) {
  if (inventory.enums[type]) return inventory.enums[type][0];
  switch (type) {
    case "uuid": return "00000000-0000-0000-0000-000000000000";
    case "bigint": case "integer": case "numeric": return 1;
    case "boolean": return false;
    case "date": return "2026-01-01";
    case "timestamp with time zone": return "2026-01-01T00:00:00Z";
    case "bigint[]": return [1];
    default: return "x";
  }
}

export default async function anonymous(t, ctx) {
  const { c, id, anon, cfg } = ctx;
  const s = (ctx.state.anon = {});
  t.setSection("80 anonymous access and the public archive");

  const archiveItem = async (label, { isPublic, visibility }) => {
    const path = `${id.execA}/${uid()}-${label.replace(/[^a-z0-9]+/gi, "-")}.wav`;
    const bytes = wav(0.2);
    succeeded(await put(c.execA, "club-archive", path, bytes, "audio/wav"), `upload ${label}`);
    const row = succeeded(await c.execA.from("archive_items").insert({ title: mark(label), description: "e2e", type: "recording", storage_path: path, visibility, is_public: isPublic, raga: "Yaman", tala: "Teental", event_date: "2026-01-15", uploaded_by: id.execA }).select("id").single(), `insert ${label}`);
    return { id: row.id, path, bytes, title: mark(label) };
  };
  const visitor = (key = cfg.key, bearer = true) => fetch(publicConcertsUrl(cfg.url), { headers: { apikey: key, ...(bearer ? { Authorization: `Bearer ${key}` } : {}), Accept: "application/json" } });

  await t.test("an executive adds a public concert, a members-only recording and an executives-only recording to club-archive (the Add club recording form)", async () => {
    s.pub = await archiveItem("public concert", { isPublic: true, visibility: "members" });
    s.mem = await archiveItem("members-only recording", { isPublic: false, visibility: "members" });
    s.exe = await archiveItem("executives-only recording", { isPublic: false, visibility: "executives" });
    for (const [item, memberSees] of [[s.pub, true], [s.mem, true], [s.exe, false]]) {
      equal(rowsOf(await c.member1.from("archive_items").select("id").eq("id", item.id), "member reads item").length, memberSees ? 1 : 0, `member sees ${item.title}`);
      equal(!!(await sign(c.member1, "club-archive", item.path, 120)).data?.signedUrl, memberSees, `member can sign ${item.title}`);
    }
  });

  await t.test("the public concert list works for a signed-out visitor with the app's own request: only the public recording, only the columns the page needs", async () => {
    const response = await visitor();
    const body = await response.text();
    ok(response.status === 200, `GET ${publicConcertsUrl(cfg.url)} with the publishable key as apikey and Bearer returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    const rows = JSON.parse(body);
    ok(rows.some((r) => r.id === s.pub.id), "the public concert is missing from the visitor's list");
    ok(!rows.some((r) => r.id === s.mem.id || r.id === s.exe.id), "a non-public recording appears in the visitor's list");
    ok(rows.every((r) => r.is_public === true && r.type === "recording"), "a row that is not a public recording was returned");
    equal(Object.keys(rows[0]).sort(), PUBLIC_CONCERT_COLUMNS.split(",").sort(), "columns returned");
    const loaded = await loadPublicConcerts({ url: cfg.url, key: cfg.key });
    ok(Array.isArray(loaded) && loaded.some((r) => r.id === s.pub.id), `loadPublicConcerts (the page's server loader) returned ${loaded === null ? "null (the page falls back to the browser)" : "a list without the concert"}`);
    const apikeyOnly = await visitor(cfg.key, false);
    equal(apikeyOnly.status, 200, "the same request with only the apikey header");
    const viaClient = rowsOf(await anon.from("archive_items").select(PUBLIC_CONCERT_COLUMNS).eq("is_public", true).eq("type", "recording").order("event_date", { ascending: false }), "supabase-js visitor list");
    ok(viaClient.some((r) => r.id === s.pub.id) && !viaClient.some((r) => r.id === s.mem.id), "supabase-js visitor list");
  });

  await t.observe("the public list request with the legacy anon JWT (only when SUPABASE_LEGACY_ANON_KEY is set for the run)", async () => {
    const legacy = process.env.SUPABASE_LEGACY_ANON_KEY;
    if (!legacy) return "not run: set SUPABASE_LEGACY_ANON_KEY to compare. The publishable key works as both apikey and Bearer (see the test above).";
    const response = await visitor(legacy);
    const rows = response.status === 200 ? await response.json() : [];
    return `legacy anon JWT as apikey and Bearer: HTTP ${response.status}, public concert present: ${rows.some((r) => r.id === s.pub.id)}`;
  });

  await t.test("a visitor streams the public concert (signed URL, bytes match) but not the others; the bucket is private, so a direct object URL is refused", async () => {
    const signed = succeeded(await sign(anon, "club-archive", s.pub.path, 600), "visitor signs the public concert");
    const got = await download(signed.signedUrl);
    equal(got.status, 200, "visitor download status");
    equal(got.sha, sha256(s.pub.bytes), "visitor download bytes");
    ok((await sign(anon, "club-archive", s.mem.path, 60)).error, "a visitor could sign a members-only recording");
    ok((await sign(anon, "club-archive", s.exe.path, 60)).error, "a visitor could sign an executives-only recording");
    // The bucket is private: the public-bucket URL form never works, and the policy-checked object URL works only for public concert files.
    const direct = (path, form) => fetch(`${cfg.url}/storage/v1/object/${form}${encodeURI(path)}`, { headers: { apikey: cfg.key } });
    equal((await direct(s.pub.path, "public/club-archive/")).status === 200, false, "GET /object/public/club-archive/<public concert> (the public-bucket URL form)");
    equal((await direct(s.mem.path, "club-archive/")).status === 200, false, "GET /object/club-archive/<members-only recording> by a visitor");
    equal((await direct(s.exe.path, "club-archive/")).status === 200, false, "GET /object/club-archive/<executives-only recording> by a visitor");
    const policyRead = await direct(s.pub.path, "club-archive/");
    equal(policyRead.status, 200, "GET /object/club-archive/<public concert> by a visitor (allowed by the 'Visitors stream public concert files' policy)");
    const listing = await anon.storage.from("club-archive").list(id.execA, { limit: 100 });
    ok(!listing.error ? (listing.data || []).every((o) => o.name !== s.mem.path.split("/").pop() && o.name !== s.exe.path.split("/").pop()) : true, "a visitor can list non-public archive files");
    s.pubFresh = await freshUrl(anon, "club-archive", s.pub.path);
  });

  await t.test("a visitor cannot add, change or remove archive items: the public concert row and its file stay as they were", async () => {
    const insert = await anon.from("archive_items").insert({ title: mark("visitor item"), type: "recording", storage_path: `${id.execA}/${uid()}-visitor.wav`, uploaded_by: id.execA, is_public: true }).select("id");
    ok(insert.error, `a visitor inserted an archive item: ${JSON.stringify(insert.data)}`);
    equal(insert.error.code, "42501", "error code for the visitor insert");
    const update = await anon.from("archive_items").update({ title: "defaced" }).eq("id", s.pub.id).select("id");
    ok(update.error || (update.data || []).length === 0, `a visitor updated the public concert: ${JSON.stringify(update.data)}`);
    const del = await anon.from("archive_items").delete().eq("id", s.pub.id).select("id");
    ok(del.error || (del.data || []).length === 0, `a visitor deleted the public concert: ${JSON.stringify(del.data)}`);
    const removed = await anon.storage.from("club-archive").remove([s.pub.path]);
    equal((removed.data || []).length, 0, "files a visitor removed from club-archive");
    const upload = await put(anon, "club-archive", `${id.execA}/${uid()}-visitor.wav`, wav(0.1), "audio/wav");
    ok(upload.error, "a visitor uploaded to club-archive");
    const row = succeeded(await c.execA.from("archive_items").select("title,is_public").eq("id", s.pub.id).single(), "re-read the concert");
    equal(row, { title: s.pub.title, is_public: true }, "the public concert after the visitor's attempts");
  });

  await t.test(`every table refuses a visitor: reads return nothing (except public concert rows), inserts are refused; the sweep covers all ${inventory.tables.length} tables in inventory.json`, async () => {
    const problems = [];
    const table = (name) => anon.from(name);
    for (const info of inventory.tables) {
      const read = await table(info.name).select("*").limit(5);
      if (read.error) {
        if (read.error.code !== "42501") problems.push(`${info.name}: read failed with ${describeError(read.error)} (expected permission denied or an empty result)`);
      } else if (info.name === "archive_items") {
        const bad = (read.data || []).filter((r) => !(r.is_public === true && r.type === "recording"));
        if (bad.length) problems.push(`archive_items: a visitor reads ${bad.length} non-public row(s)`);
      } else if ((read.data || []).length) problems.push(`${info.name}: a visitor reads ${read.data.length} row(s)`);

      const insert = await table(info.name).insert({}).select();
      if (!insert.error) problems.push(`${info.name}: an empty insert by a visitor succeeded: ${JSON.stringify(insert.data)}`);
      else if (insert.error.code !== "42501") problems.push(`${info.name}: insert by a visitor failed with ${describeError(insert.error)} (expected 42501, a row-level security refusal)`);

      const first = info.columns[0];
      const update = await table(info.name).update({ [first]: null }).is(first, null).select();
      if (!update.error && (update.data || []).length) problems.push(`${info.name}: an update by a visitor changed rows`);
      const del = await table(info.name).delete().is(first, null).select();
      if (!del.error && (del.data || []).length) problems.push(`${info.name}: a delete by a visitor removed rows`);
    }
    // A control: the sweep is not vacuous, an executive reads real rows from the same tables.
    const control = await c.execA.from("profiles").select("id").limit(3);
    ok(!control.error && (control.data || []).length > 0, "control read of profiles by an executive returned nothing");
    if (problems.length) throw new Error(`${problems.length} problem(s):\n${problems.join("\n")}`);
  });

  await t.test(`every RPC refuses a visitor (permission denied for function): the sweep calls all ${inventory.functions.length} functions in inventory.json with dummy arguments`, async () => {
    const problems = [];
    const seen = {};
    for (const fn of inventory.functions) {
      const args = Object.fromEntries(fn.args.map((a) => [a.name, dummy(a.type)]));
      const res = await anon.rpc(fn.name, args);
      const code = res.error ? res.error.code || String(res.status) : "OK";
      seen[code] = (seen[code] || 0) + 1;
      if (!res.error) problems.push(`${fn.name}(${fn.args.map((a) => a.name).join(", ")}) ran for a visitor and returned ${JSON.stringify(res.data)?.slice(0, 100)}`);
      else if (res.error.code !== "42501") problems.push(`${fn.name}: ${describeError(res.error)} (expected 42501 permission denied for function)`);
      if (fn.anonExecute) problems.push(`${fn.name}: the database grants EXECUTE to anon`);
    }
    // A control: the same call shape works for a signed-in user.
    succeeded(await c.member1.rpc("get_finance_summary"), "control RPC as a member");
    s.rpcCodes = seen;
    if (problems.length) throw new Error(`${problems.length} problem(s):\n${problems.join("\n")}`);
  });

  await t.test("storage refuses a visitor on every bucket: no listing, no signed URL, no upload, no delete; the schema API and the admin API are closed", async () => {
    const problems = [];
    for (const bucket of inventory.buckets) {
      if (bucket.public) problems.push(`${bucket.id} is a public bucket`);
      const list = await anon.storage.from(bucket.id).list("", { limit: 10 });
      // club-archive shows the folder that holds a public concert (by design); nothing else is listed.
      const rootEntries = (list.data || []).filter((o) => !(bucket.id === "club-archive" && o.name === id.execA));
      if (!list.error && rootEntries.length) problems.push(`${bucket.id}: a visitor lists ${rootEntries.length} entries: ${rootEntries.map((o) => o.name).join(", ")}`);
      const known = await anon.storage.from(bucket.id).list(id.execA, { limit: 100 });
      const visible = (known.data || []).filter((o) => o.name !== ".emptyFolderPlaceholder" && !(bucket.id === "club-archive" && o.name === s.pub.path.split("/").pop()));
      if (visible.length) problems.push(`${bucket.id}: a visitor lists ${visible.length} entries in an executive's folder`);
      const signedUrl = await anon.storage.from(bucket.id).createSignedUrl(`${id.execA}/x.bin`, 60);
      if (signedUrl.data?.signedUrl) problems.push(`${bucket.id}: a visitor signed a path`);
      const up = await put(anon, bucket.id, `${id.execA}/${uid()}-visitor.pdf`, wav(0.1), "audio/wav");
      if (!up.error) problems.push(`${bucket.id}: a visitor uploaded a file`);
      const rm = await anon.storage.from(bucket.id).remove([`${id.execA}/x.bin`]);
      if ((rm.data || []).length) problems.push(`${bucket.id}: a visitor removed a file`);
    }
    const schema = await fetch(`${cfg.url}/rest/v1/`, { headers: { apikey: cfg.key } });
    if (schema.status === 200) problems.push("GET /rest/v1/ (the OpenAPI schema) is open to the publishable key");
    const privateSchema = await anon.schema("private").from("anything").select("*").limit(1);
    if (!privateSchema.error) problems.push("the private schema is reachable through the API");
    const admin = await fetch(`${cfg.url}/auth/v1/admin/users`, { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } });
    if (admin.status === 200) problems.push("GET /auth/v1/admin/users answered 200 to the publishable key");
    if (problems.length) throw new Error(`${problems.length} problem(s):\n${problems.join("\n")}`);
  });

  await t.test("making the concert members-only removes it from the public list and stops new signed URLs; making it public again restores both", async () => {
    succeeded(await c.execA.from("archive_items").update({ is_public: false }).eq("id", s.pub.id).select("id").single(), "make members-only");
    const rows = await (await visitor()).json();
    ok(!rows.some((r) => r.id === s.pub.id), "the concert is still in the public list");
    ok((await sign(anon, "club-archive", s.pub.path, 60)).error, "a visitor could still sign the file after it stopped being public");
    equal(rowsOf(await c.member1.from("archive_items").select("id").eq("id", s.pub.id), "member").length, 1, "members still see the recording");
    succeeded(await c.execA.from("archive_items").update({ is_public: true }).eq("id", s.pub.id).select("id").single(), "make public again");
    ok((await (await visitor()).json()).some((r) => r.id === s.pub.id), "the concert is back in the public list");
    ok(!(await sign(anon, "club-archive", s.pub.path, 60)).error, "a visitor cannot sign the file after it is public again");
  });

  await t.test("deleting the concert (file first, then the row) removes it everywhere: the list, new signed URLs, and an unfetched signed URL made earlier", async () => {
    for (const item of [s.pub, s.mem, s.exe]) {
      const removed = await c.execA.storage.from("club-archive").remove([item.path]);
      if (removed.error || (removed.data || []).length !== 1) throw new Error(`removing ${item.path}: ${removed.error ? describeError(removed.error) : "nothing removed"}`);
      const row = await c.execA.from("archive_items").delete().eq("id", item.id).select("id");
      if (row.error || !row.data?.length) throw new Error(`deleting archive item ${item.id}: ${row.error ? describeError(row.error) : "no row"}`);
    }
    ok(!(await (await visitor()).json()).some((r) => r.id === s.pub.id), "the deleted concert is still listed");
    ok((await sign(anon, "club-archive", s.pub.path, 60)).error, "a visitor could sign the deleted file");
    ok((await sign(c.execA, "club-archive", s.pub.path, 60)).error, "an executive could sign the deleted file");
    equal((await download(s.pubFresh)).status === 200, false, "a signed URL made before the delete (never fetched) still downloads");
  });

  await t.observe("what the sign-in service tells a signed-out visitor (auth/v1/settings) and the error codes of the RPC sweep", async () => {
    const settings = await (await fetch(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.key } })).json();
    const on = Object.entries(settings.external || {}).filter(([, enabled]) => enabled).map(([name]) => name);
    return `providers enabled: ${on.join(", ") || "none"}; disable_signup: ${settings.disable_signup}; mailer_autoconfirm: ${settings.mailer_autoconfirm}. `
      + `RPC sweep result codes: ${JSON.stringify(s.rpcCodes)}. `
      + (settings.external?.email && !settings.disable_signup ? "Email sign-up is open on this project (the test accounts need the email provider). If the same is true of production, anyone with a mailbox can register and the signup trigger gives them a member profile; Google-only sign-in in the UI does not prevent that. Check Authentication > Providers on production." : "");
  });
}
