// Recording room: upload through Storage, publish, notation, delete in the app's order (files first),
// who may delete, and recordings copied from the legacy club-archive bucket.
import { ok, equal, refused, succeeded, rowsOf, nothingHappened, describeError } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";
import { wav, pdf, sha256 } from "../lib/fixtures.mjs";
import { put, sign, download, listed, putAndVerify, freshUrl, proveGone, uid } from "../lib/storage.mjs";

// The row the recording studio writes (components/recordings/recording-workspace.tsx save()).
const payload = (over) => ({
  title: mark("Take"), description: "e2e recording", subgroup_id: null, storage_path: "", mime_type: "audio/wav", media_kind: "audio",
  status: "draft", audience: "subgroup", recording_kind: "practice", raga: "Bhairavi", tala: "Adi", sruthi: "C", tempo: "Madhyama",
  duration_seconds: 1, published_at: null, updated_at: new Date().toISOString(), ...over,
});

// The delete order from RecordingManageBar: notation files, then the take, then the row.
async function deleteLikeTheApp(client, recording, notes) {
  for (const note of notes) {
    if (!note.storage_path) continue;
    const removed = await client.storage.from("recording-notations").remove([note.storage_path]);
    if (removed.error) throw new Error(`remove notation: ${describeError(removed.error)}`);
    if (!removed.data?.length) throw new Error(`remove notation returned nothing for ${note.storage_path}`);
  }
  const removed = await client.storage.from(recording.storage_bucket || "recordings").remove([recording.storage_path]);
  if (removed.error) throw new Error(`remove take: ${describeError(removed.error)}`);
  if (!removed.data?.length) throw new Error(`remove take returned nothing for ${recording.storage_path}`);
  const row = await client.from("recordings").delete().eq("id", recording.id).select("id");
  if (row.error || !row.data?.length) throw new Error(`delete recording row: ${row.error ? describeError(row.error) : "no row deleted"}`);
}

export default async function recordings(t, ctx) {
  const { c, id } = ctx;
  const g = ctx.state.g;
  const s = (ctx.state.rec = {});
  t.setSection("30 recordings");

  await t.test("member1 saves a draft take: file upload to the recordings bucket, draft row, a text note and a notation file", async () => {
    s.take1 = { path: `${id.member1}/subgroups/${g.A}/${uid()}-take1.wav`, bytes: wav(0.3) };
    s.take1.url = await putAndVerify(c.member1, "recordings", s.take1.path, s.take1.bytes, "audio/wav", "take 1");
    s.take1.fresh = await freshUrl(c.member1, "recordings", s.take1.path);
    // Control for the delete proofs below: an unfetched signed URL does download while the file exists.
    const control = await download(await freshUrl(c.member1, "recordings", s.take1.path));
    equal(control.status, 200, "control: an unfetched signed URL downloads");
    const row = succeeded(await c.member1.from("recordings").insert(payload({ title: mark("Take 1"), subgroup_id: g.A, storage_path: s.take1.path, uploaded_by: id.member1 })).select("id").single(), "insert draft recording");
    s.take1.id = row.id;
    s.note1 = { path: `${id.member1}/${uid()}-notes.pdf`, bytes: pdf("notation") };
    s.note1.url = await putAndVerify(c.member1, "recording-notations", s.note1.path, s.note1.bytes, "application/pdf", "notation file");
    s.note1.fresh = await freshUrl(c.member1, "recording-notations", s.note1.path);
    const file = succeeded(await c.member1.from("recording_notes").insert({ recording_id: s.take1.id, title: "notes.pdf", note_type: "file", body: "", storage_path: s.note1.path, mime_type: "application/pdf", uploaded_by: id.member1 }).select("id").single(), "insert file note");
    s.note1.id = file.id;
    const txt = succeeded(await c.member1.from("recording_notes").insert({ recording_id: s.take1.id, title: "Notation", note_type: "text", body: "sa ri ga ma", storage_path: null, mime_type: null, uploaded_by: id.member1 }).select("id").single(), "insert text note");
    s.note1.textId = txt.id;
  });

  await t.test("a draft is private: other members of the group cannot see the row or sign its file; an executive can", async () => {
    equal(rowsOf(await c.leader.from("recordings").select("id").eq("id", s.take1.id), "leader reads draft").length, 0, "draft visible to a group member");
    ok(!(await sign(c.leader, "recordings", s.take1.path)).data?.signedUrl, "a group member could sign a draft's file");
    equal(rowsOf(await c.execA.from("recordings").select("id").eq("id", s.take1.id), "exec reads draft").length, 1, "draft visible to executive");
  });

  await t.test("uploader publishes the draft; group members see and play it, members of other groups do not", async () => {
    const res = await c.member1.from("recordings").update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", s.take1.id).select("id");
    equal(succeeded(res, "publish").length, 1, "rows published");
    const list = rowsOf(await c.leader.from("recordings").select("*", { count: "exact" }).eq("status", "published").eq("subgroup_id", g.A).order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, 23), "leader lists published");
    ok(list.some((r) => r.id === s.take1.id), "published take is not in the group member's list");
    const signed = succeeded(await sign(c.leader, "recordings", s.take1.path, 1800), "leader signs the take");
    const got = await download(signed.signedUrl);
    equal(got.status, 200, "download status");
    equal(got.sha, sha256(s.take1.bytes), "downloaded bytes");
    const note = succeeded(await sign(c.leader, "recording-notations", s.note1.path, 900), "leader signs the notation file");
    equal((await download(note.signedUrl)).sha, sha256(s.note1.bytes), "notation bytes");
    equal(rowsOf(await c.member2.from("recordings").select("id").eq("id", s.take1.id), "member2 reads").length, 0, "member2 (other group) sees the recording");
    ok(!(await sign(c.member2, "recordings", s.take1.path)).data?.signedUrl, "member2 could sign the take");
    ok(!(await sign(c.member2, "recording-notations", s.note1.path)).data?.signedUrl, "member2 could sign the notation file");
  });

  await t.test("a member who is not the uploader cannot delete the take, its row, its notes or its status (group member and group manager)", async () => {
    for (const key of ["leader", "manager"]) {
      const removed = await c[key].storage.from("recordings").remove([s.take1.path]);
      ok(!removed.data?.length, `${key} removed the take file: ${JSON.stringify(removed)}`);
      const removedNote = await c[key].storage.from("recording-notations").remove([s.note1.path]);
      ok(!removedNote.data?.length, `${key} removed the notation file: ${JSON.stringify(removedNote)}`);
      nothingHappened(await c[key].from("recordings").delete().eq("id", s.take1.id).select("id"), `${key} deleting the row`);
      nothingHappened(await c[key].from("recordings").update({ status: "archived" }).eq("id", s.take1.id).select("id"), `${key} archiving`);
      nothingHappened(await c[key].from("recordings").update({ title: "hijacked" }).eq("id", s.take1.id).select("id"), `${key} editing`);
      nothingHappened(await c[key].from("recording_notes").delete().eq("id", s.note1.id).select("id"), `${key} deleting the uploader's note`);
    }
    const still = await download((await sign(c.member1, "recordings", s.take1.path)).data.signedUrl);
    equal(still.sha, sha256(s.take1.bytes), "the take survived");
  });

  await t.test("a group member adds a notation file as its author; only the author, the uploader-as-executive or an executive can delete it", async () => {
    s.note2 = { path: `${id.leader}/${uid()}-leader-notes.pdf`, bytes: pdf("leader-notation") };
    s.note2.url = await putAndVerify(c.leader, "recording-notations", s.note2.path, s.note2.bytes, "application/pdf", "leader notation");
    s.note2.fresh = await freshUrl(c.leader, "recording-notations", s.note2.path);
    s.note2.id = succeeded(await c.leader.from("recording_notes").insert({ recording_id: s.take1.id, title: "leader-notes.pdf", note_type: "file", body: "", storage_path: s.note2.path, mime_type: "application/pdf", uploaded_by: id.leader }).select("id").single(), "leader adds a note").id;
    // The uploader of the recording is not the author of this note.
    const removed = await c.member1.storage.from("recording-notations").remove([s.note2.path]);
    ok(!removed.data?.length, "the recording's uploader removed another member's notation file");
    nothingHappened(await c.member1.from("recording_notes").delete().eq("id", s.note2.id).select("id"), "recording uploader deleting another member's note");
    // Author deletes: file first, then the row (NoteActions.remove).
    const gone = await c.leader.storage.from("recording-notations").remove([s.note2.path]);
    equal(gone.data?.length, 1, "author removing own notation file");
    const row = succeeded(await c.leader.from("recording_notes").delete().eq("id", s.note2.id).select("id"), "author deleting own note row");
    equal(row.length, 1, "note rows deleted");
    await proveGone({ leader: c.leader, execA: c.execA }, "recording-notations", s.note2.path, { fresh: s.note2.fresh, fetched: s.note2.url });
  });

  await t.test("uploader edits the text note; uploader archives and restores the recording (hidden from the published list while archived)", async () => {
    equal(succeeded(await c.member1.from("recording_notes").update({ title: "Notation v2", body: "sa ri ga ma pa" }).eq("id", s.note1.textId).select("id"), "edit note").length, 1, "rows edited");
    succeeded(await c.member1.from("recordings").update({ status: "archived" }).eq("id", s.take1.id).select("id"), "archive");
    const published = rowsOf(await c.leader.from("recordings").select("id").eq("status", "published").eq("subgroup_id", g.A), "leader published list");
    ok(!published.some((r) => r.id === s.take1.id), "archived recording is still in the published list");
    const archivedForUploader = rowsOf(await c.member1.from("recordings").select("id").eq("status", "archived").eq("uploaded_by", id.member1), "uploader archived list");
    ok(archivedForUploader.some((r) => r.id === s.take1.id), "uploader cannot see their archived recording");
    succeeded(await c.member1.from("recordings").update({ status: "published" }).eq("id", s.take1.id).select("id"), "restore");
  });

  await t.test("an executive can edit another member's recording details", async () => {
    equal(succeeded(await c.execA.from("recordings").update({ title: mark("Take 1 (edited by exec)"), description: "edited" }).eq("id", s.take1.id).select("id"), "exec edit").length, 1, "rows edited");
  });

  await t.test("uploader deletes the recording in the app's order; the take, the notation file and the rows are gone (listing, signing, and an earlier signed URL)", async () => {
    const recording = succeeded(await c.member1.from("recordings").select("*").eq("id", s.take1.id).single(), "read recording");
    const notes = rowsOf(await c.member1.from("recording_notes").select("*").eq("recording_id", s.take1.id), "read notes");
    equal(notes.length, 2, "note count before delete");
    await deleteLikeTheApp(c.member1, recording, notes);
    await proveGone({ member1: c.member1, execA: c.execA, leader: c.leader }, "recordings", s.take1.path, { fresh: s.take1.fresh, fetched: s.take1.url });
    await proveGone({ member1: c.member1, execA: c.execA }, "recording-notations", s.note1.path, { fresh: s.note1.fresh, fetched: s.note1.url });
    for (const key of ["member1", "execA", "leader"]) {
      equal(rowsOf(await c[key].from("recordings").select("id").eq("id", s.take1.id), `${key} re-reads row`).length, 0, `${key}: recording row after delete`);
      equal(rowsOf(await c[key].from("recording_notes").select("id").eq("recording_id", s.take1.id), `${key} re-reads notes`).length, 0, `${key}: note rows after delete`);
    }
  });

  await t.test("an executive deletes another member's published recording the same way", async () => {
    const path = `${id.member1}/subgroups/${g.A}/${uid()}-take2.wav`;
    const bytes = wav(0.2);
    const url = await putAndVerify(c.member1, "recordings", path, bytes, "audio/wav", "take 2");
    const fresh = await freshUrl(c.member1, "recordings", path);
    const row = succeeded(await c.member1.from("recordings").insert(payload({ title: mark("Take 2"), subgroup_id: g.A, storage_path: path, uploaded_by: id.member1, status: "published", published_at: new Date().toISOString() })).select("*").single(), "insert published recording");
    await deleteLikeTheApp(c.execA, row, []);
    await proveGone({ member1: c.member1, execA: c.execA }, "recordings", path, { fresh, fetched: url });
  });

  await t.test("a recording cannot be created for a group the uploader does not belong to, or in another member's name", async () => {
    const path = `${id.member2}/subgroups/${g.A}/${uid()}-x.wav`;
    const up = await put(c.member2, "recordings", path, wav(0.1), "audio/wav");
    succeeded(up, "member2 uploads to their own folder");
    refused(await c.member2.from("recordings").insert(payload({ subgroup_id: g.A, storage_path: path, uploaded_by: id.member2 })).select("id"), "member2 recording into group A");
    refused(await c.member2.from("recordings").insert(payload({ subgroup_id: g.B, storage_path: path, uploaded_by: id.member1 })).select("id"), "member2 recording in member1's name");
    const other = await put(c.member2, "recordings", `${id.member1}/subgroups/${g.A}/${uid()}-y.wav`, wav(0.1), "audio/wav");
    refused(other, "member2 uploading into member1's folder");
    // clean the stray object the way the app would have to: it needs a row first (see the orphan test).
    s.orphanPath = path;
  });

  await t.observe("a take uploaded but never saved as a row (failed publish) cannot be removed by the app's cleanup call", async () => {
    const path = s.orphanPath;
    const removed = await c.member2.storage.from("recordings").remove([path]);
    const stillListed = await listed(c.member2, "recordings", path);
    const detail = `remove([path]) returned ${JSON.stringify(removed.data)}${removed.error ? ` error ${describeError(removed.error)}` : ""}; still listed for its owner: ${stillListed}`;
    // Tidy up: give the file a row, remove it through the API, drop the row.
    const row = succeeded(await c.member2.from("recordings").insert(payload({ title: mark("orphan cleanup"), subgroup_id: g.B, storage_path: path, uploaded_by: id.member2 })).select("id").single(), "temporary row for cleanup");
    const second = await c.member2.storage.from("recordings").remove([path]);
    succeeded(await c.member2.from("recordings").delete().eq("id", row.id).select("id"), "drop temporary row");
    return `${detail}. After a temporary row was added, remove() returned ${JSON.stringify(second.data)} and the file is ${(await listed(c.member2, "recordings", path)) ? "still there" : "gone"}.`;
  });

  // ---------------------------------------------------------------- legacy copies in club-archive

  await t.test("a recording copied from the legacy archive (bucket club-archive) plays for the group; the row records the bucket so the app offers Archive but not Delete", async () => {
    s.legacy = { path: `${id.execA}/${uid()}-legacy.wav`, bytes: wav(0.25) };
    s.legacy.url = await putAndVerify(c.execA, "club-archive", s.legacy.path, s.legacy.bytes, "audio/wav", "legacy file");
    s.legacy.fresh = await freshUrl(c.execA, "club-archive", s.legacy.path);
    s.legacy.itemId = succeeded(await c.execA.from("archive_items").insert({ title: mark("Legacy concert"), description: "legacy", type: "recording", storage_path: s.legacy.path, visibility: "members", subgroup_id: g.A, is_public: false, uploaded_by: id.execA }).select("id").single(), "insert archive item").id;
    s.legacy.id = succeeded(await c.execA.from("recordings").insert(payload({ title: mark("Legacy copy"), subgroup_id: g.A, storage_path: s.legacy.path, storage_bucket: "club-archive", uploaded_by: id.execA, status: "published", published_at: new Date().toISOString(), audience: "subgroup" })).select("id").single(), "insert legacy recording copy").id;
    for (const key of ["member1", "leader"]) {
      const row = succeeded(await c[key].from("recordings").select("*").eq("id", s.legacy.id).single(), `${key} reads legacy recording`);
      equal(row.storage_bucket, "club-archive", "bucket recorded on the row");
      // recordingBucket(row) in the app picks the bucket to sign from, and sharedWithLegacy hides Delete.
      const bucket = row.storage_bucket || "recordings";
      ok(bucket !== "recordings", "the app would offer Delete for a legacy-bucket recording");
      const signed = succeeded(await sign(c[key], bucket, row.storage_path, 1800), `${key} signs the legacy file`);
      const got = await download(signed.signedUrl);
      equal(got.status, 200, `${key} download status`);
      equal(got.sha, sha256(s.legacy.bytes), `${key} downloaded bytes`);
    }
    ok(!(await sign(c.member2, "club-archive", s.legacy.path)).data?.signedUrl, "member2 (other group) could sign the legacy file");
  });

  await t.test("the legacy file cannot be deleted by members, and the club-archive manager's own guard sees the shared recording row", async () => {
    const removed = await c.member1.storage.from("club-archive").remove([s.legacy.path]);
    ok(!removed.data?.length, "a plain member removed a club-archive file");
    const removedByManager = await c.manager.storage.from("club-archive").remove([s.legacy.path]);
    ok(!removedByManager.data?.length, "a group manager removed a club-archive file");
    // ClubArchiveManager.remove(): a recordings row with the same storage_path blocks the delete.
    const shared = rowsOf(await c.execA.from("recordings").select("id").eq("storage_path", s.legacy.path).limit(1), "shared-file check");
    equal(shared.length, 1, "recordings rows that share the legacy file");
  });

  await t.test("the legacy-copied recording can be archived and restored (Archive is the supported action)", async () => {
    succeeded(await c.execA.from("recordings").update({ status: "archived" }).eq("id", s.legacy.id).select("id"), "archive legacy copy");
    equal(rowsOf(await c.member1.from("recordings").select("id").eq("id", s.legacy.id).eq("status", "published"), "member1 published list").length, 0, "archived legacy copy still published");
    succeeded(await c.execA.from("recordings").update({ status: "published" }).eq("id", s.legacy.id).select("id"), "restore legacy copy");
  });

  await t.test("cleanup of the legacy fixture: row of the copy, then the file from club-archive, then the archive item; all gone", async () => {
    succeeded(await c.execA.from("recordings").delete().eq("id", s.legacy.id).select("id"), "delete the recording copy");
    const removed = await c.execA.storage.from("club-archive").remove([s.legacy.path]);
    equal(removed.data?.length, 1, "executive removing the club-archive file");
    succeeded(await c.execA.from("archive_items").delete().eq("id", s.legacy.itemId).select("id"), "delete archive item");
    await proveGone({ execA: c.execA, member1: c.member1 }, "club-archive", s.legacy.path, { fresh: s.legacy.fresh, fetched: s.legacy.url });
  });
}
