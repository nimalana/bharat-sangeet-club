// lib/api/recordings.ts against the fake client: each function sends exactly the call the recordings screens used to make
// (table, chain, payload, bucket, path, options), answers with the data, and throws an ApiError that keeps the database's
// message and code. The screen tests (people-recordings.test.tsx) check what the person sees and the order of a save or delete;
// these check each request on its own.
import { describe, expect, it, vi } from "vitest";
import {
  RECORDINGS_PAGE_SIZE, createClubArchiveUrl, createNotationUrl, createRecordingUrl, deleteClubArchiveItem, deleteRecordingNote, deleteRecordingRow, insertClubArchiveItem, insertRecording,
  insertRecordingNote, isInRecordingRoom, listRecordingNotes, listRecordings, recordingBucket, removeAbandonedNotationFile, removeAbandonedTake, removeClubArchiveFile, removeNotationFile,
  removeRecordingTake, setRecordingStatus, updateClubArchiveItem, updateRecording, updateRecordingDetails, updateRecordingNote, uploadClubArchiveFile, uploadNotationFile, uploadRecordingTake,
  type RecordingPayload, type RecordingsQuery,
} from "../../lib/api/recordings";
import { ApiError } from "../../lib/errors";
import { FILE_NOT_DELETED } from "../../lib/storage-remove";
import { fail, fake, ok, rejects, withCount } from "../support/fake-supabase";

const caught = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);
const only = <T,>(calls: T[]): T => { expect(calls).toHaveLength(1); return calls[0]; };
const file = (name: string, type = "audio/webm") => new File(["x"], name, { type });

describe("recordingBucket", () => {
  it("is the recording's own bucket, or recordings", () => {
    expect(recordingBucket({})).toBe("recordings");
    expect(recordingBucket({ storage_bucket: "" })).toBe("recordings");
    expect(recordingBucket({ storage_bucket: "club-archive" })).toBe("club-archive");
  });
});

describe("listRecordings: the server filters and pages", () => {
  const base: RecordingsQuery = { view: "published", scope: "all", search: "", pages: 1, userId: "u-me", canManage: false };
  const list = async (over: Partial<RecordingsQuery> = {}) => {
    fake.from("recordings", "select").reply(withCount(60, [{ id: 3 }, { id: 2 }]));
    const answer = await listRecordings({ ...base, ...over });
    return { answer, call: only(fake.from("recordings", "select").calls) };
  };

  it("published: one page of 24, newest first, with an exact count", async () => {
    const { answer, call } = await list();
    expect(RECORDINGS_PAGE_SIZE).toBe(24);
    expect(call.uses("select")).toEqual([["*", { count: "exact" }]]);
    expect(call.uses("eq")).toEqual([["status", "published"]]);
    expect(call.uses("order")).toEqual([["created_at", { ascending: false }], ["id", { ascending: false }]]);
    expect(call.uses("range")).toEqual([[0, 23]]);
    expect(call.used("or")).toBe(false);
    expect(answer).toEqual({ rows: [{ id: 3 }, { id: 2 }], total: 60 });
  });

  it("each page asked for adds 24 rows from the first", async () => {
    const { call } = await list({ pages: 3 });
    expect(call.uses("range")).toEqual([[0, 71]]);
  });

  it("my drafts: only the person's own drafts", async () => {
    const { call } = await list({ view: "drafts" });
    expect(call.uses("eq")).toEqual([["status", "draft"], ["uploaded_by", "u-me"]]);
  });

  it("archived: the person's own, unless they manage recordings", async () => {
    expect((await list({ view: "archived" })).call.uses("eq")).toEqual([["status", "archived"], ["uploaded_by", "u-me"]]);
    fake.reset();
    expect((await list({ view: "archived", canManage: true })).call.uses("eq")).toEqual([["status", "archived"]]);
  });

  it("a group narrows the list to it", async () => {
    const { call } = await list({ scope: 7 });
    expect(call.uses("eq")).toEqual([["status", "published"], ["subgroup_id", 7]]);
  });

  it("a search looks in five columns, and drops the characters that mean something in the filter", async () => {
    const { call } = await list({ search: "bhairavi, (adi)*%" });
    expect(call.uses("or")).toEqual([["title.ilike.%bhairavi   adi%,description.ilike.%bhairavi   adi%,raga.ilike.%bhairavi   adi%,tala.ilike.%bhairavi   adi%,recording_kind.ilike.%bhairavi   adi%"]]);
  });

  it("a backslash is dropped too, and the words either side of it stay apart", async () => {
    const { call } = await list({ search: "sa\\ri" });
    expect(call.uses("or")[0][0]).toMatch(/^title\.ilike\.%sa ri%,/);
  });

  it("a search of only such characters is no search", async () => {
    expect((await list({ search: ",()" })).call.used("or")).toBe(false);
  });

  it("the total falls back to the number of rows when the answer has no count", async () => {
    fake.from("recordings", "select").reply(ok([{ id: 1 }]));
    expect(await listRecordings(base)).toEqual({ rows: [{ id: 1 }], total: 1 });
  });

  it("no rows at all is an empty list, not a failure", async () => {
    fake.from("recordings", "select").reply(ok(null));
    expect(await listRecordings(base)).toEqual({ rows: [], total: 0 });
  });

  it("a refused read throws an ApiError", async () => {
    fake.from("recordings", "select").reply(fail("permission denied for table recordings", "42501"));
    expect(await caught(listRecordings(base))).toMatchObject({ name: "ApiError", code: "42501" });
  });
});

describe("a recording's notation and its links", () => {
  it("the notes of one recording, oldest first", async () => {
    fake.from("recording_notes", "select").reply(ok([{ id: 1 }]));
    expect(await listRecordingNotes(9)).toEqual([{ id: 1 }]);
    const call = only(fake.from("recording_notes", "select").calls);
    expect(call.uses("select")).toEqual([["*"]]);
    expect(call.uses("eq")).toEqual([["recording_id", 9]]);
    expect(call.uses("order")).toEqual([["created_at"]]);
  });

  it("a failed notes read throws, a read with no rows is empty", async () => {
    fake.from("recording_notes", "select").replyOnce(fail("boom"));
    expect(await caught(listRecordingNotes(9))).toBeInstanceOf(ApiError);
    fake.from("recording_notes", "select").replyOnce(ok(null));
    expect(await listRecordingNotes(9)).toEqual([]);
  });

  it("the take plays through a 30 minute link from the bucket it is in", async () => {
    expect(await createRecordingUrl("club-archive", "a/b.webm")).toBe("https://files.test/club-archive/a/b.webm?signed");
    expect(only(fake.storage("club-archive", "createSignedUrl").calls).args).toEqual(["a/b.webm", 1800]);
    expect(await createRecordingUrl("recordings", "c.webm")).toBe("https://files.test/recordings/c.webm?signed");
  });

  it("a notation file opens through a 15 minute link; a club recording through a 5 minute one", async () => {
    await createNotationUrl("u/n.pdf");
    await createClubArchiveUrl("u/c.mp3");
    expect(only(fake.storage("recording-notations", "createSignedUrl").calls).args).toEqual(["u/n.pdf", 900]);
    expect(only(fake.storage("club-archive", "createSignedUrl").calls).args).toEqual(["u/c.mp3", 300]);
  });

  it("a link storage does not give is null; a refusal throws", async () => {
    fake.storage("recordings", "createSignedUrl").replyOnce(ok(null));
    expect(await createRecordingUrl("recordings", "a")).toBeNull();
    fake.storage("recording-notations", "createSignedUrl").replyOnce(fail("Object not found"));
    expect(await caught(createNotationUrl("a"))).toBeInstanceOf(ApiError);
    fake.storage("club-archive", "createSignedUrl").replyOnce(fail("Object not found"));
    expect(await caught(createClubArchiveUrl("a"))).toBeInstanceOf(ApiError);
  });
});

describe("saving from the studio", () => {
  const payload: RecordingPayload = {
    title: "Varnam take 2", description: "Listen for the gamakas", subgroup_id: 7, storage_path: "u-me/subgroups/7/x-take.webm", mime_type: "audio/webm", media_kind: "audio",
    status: "published", audience: "subgroup", recording_kind: "practice", raga: "Bhairavi", tala: null, sruthi: "C", tempo: null, duration_seconds: 95,
    published_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-01T10:00:00.000Z",
  };

  it("a take goes under the person's folder and the group's in the recordings bucket, with its type, never replacing a file", async () => {
    const path = await uploadRecordingTake("u-me", 7, file("my take (2).webm"));
    expect(path).toMatch(/^u-me\/subgroups\/7\/[0-9a-f-]{36}-my-take--2-\.webm$/);
    const upload = only(fake.storage("recordings", "upload").calls);
    expect(upload.args[0]).toBe(path);
    expect(upload.args[2]).toEqual({ contentType: "audio/webm", upsert: false });
  });

  it("a notation file goes under the person's folder in recording-notations, with its type", async () => {
    const path = await uploadNotationFile("u-me", file("sargam.pdf", "application/pdf"));
    expect(path).toMatch(/^u-me\/[0-9a-f-]{36}-sargam\.pdf$/);
    const upload = only(fake.storage("recording-notations", "upload").calls);
    expect(upload.args[0]).toBe(path);
    expect(upload.args[2]).toEqual({ contentType: "application/pdf", upsert: false });
  });

  it("a refused upload throws an ApiError (nothing is returned for the caller to use)", async () => {
    fake.storage("recordings", "upload").reply(fail("Bucket not found"));
    fake.storage("recording-notations", "upload").reply(fail("Payload too large"));
    expect(await caught(uploadRecordingTake("u-me", 7, file("a.webm")))).toMatchObject({ name: "ApiError", message: "Bucket not found" });
    expect(await caught(uploadNotationFile("u-me", file("a.pdf")))).toMatchObject({ name: "ApiError", message: "Payload too large" });
  });

  it("a new recording is inserted with its uploader and answers with its id", async () => {
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    expect(await insertRecording(payload, "u-me")).toBe(41);
    const call = only(fake.from("recordings", "insert").calls);
    expect(call.payload).toEqual({ ...payload, uploaded_by: "u-me" });
    expect(call.uses("select")).toEqual([["id"]]);
    expect(call.used("single")).toBe(true);
  });

  it("a draft that is finished is updated by id with the same columns, and no uploader", async () => {
    fake.from("recordings", "update").reply(ok(null));
    await updateRecording(12, payload);
    const call = only(fake.from("recordings", "update").calls);
    expect(call.payload).toEqual(payload);
    expect(call.uses("eq")).toEqual([["id", 12]]);
  });

  it("a recording the database refuses throws an ApiError", async () => {
    fake.from("recordings", "insert").reply(fail("new row violates row-level security policy", "42501"));
    fake.from("recordings", "update").reply(fail("boom"));
    expect(await caught(insertRecording(payload, "u-me"))).toMatchObject({ name: "ApiError", code: "42501" });
    expect(await caught(updateRecording(12, payload))).toBeInstanceOf(ApiError);
  });

  it("a note is inserted with its recording, its kind, its file and its author", async () => {
    fake.from("recording_notes", "insert").reply(ok(null));
    await insertRecordingNote({ recordingId: 41, title: "sargam.pdf", noteType: "file", body: "", storagePath: "u-me/x-sargam.pdf", mimeType: "application/pdf", uploadedBy: "u-me" });
    expect(only(fake.from("recording_notes", "insert").calls).payload).toEqual({
      recording_id: 41, title: "sargam.pdf", note_type: "file", body: "", storage_path: "u-me/x-sargam.pdf", mime_type: "application/pdf", uploaded_by: "u-me",
    });
  });

  it("a note the database refuses throws an ApiError", async () => {
    fake.from("recording_notes", "insert").reply(fail("boom"));
    expect(await caught(insertRecordingNote({ recordingId: 1, title: "t", noteType: "text", body: "b", storagePath: null, mimeType: null, uploadedBy: "u" }))).toBeInstanceOf(ApiError);
  });
});

describe("managing a recording and its notation", () => {
  it("details are updated by id and the answer says which rows changed", async () => {
    fake.from("recordings", "update").reply(ok([{ id: 5 }]));
    const rows = await updateRecordingDetails(5, { title: "T", description: "D", recording_kind: "lesson", raga: "Todi", tala: null, sruthi: null, tempo: "96" });
    expect(rows).toEqual([{ id: 5 }]);
    const call = only(fake.from("recordings", "update").calls);
    expect(call.payload).toEqual({ title: "T", description: "D", recording_kind: "lesson", raga: "Todi", tala: null, sruthi: null, tempo: "96" });
    expect(call.uses("eq")).toEqual([["id", 5]]);
    expect(call.uses("select")).toEqual([["id"]]);
  });

  it("archive and restore change only the status", async () => {
    fake.from("recordings", "update").reply(ok([{ id: 5 }]));
    await setRecordingStatus(5, "archived");
    await setRecordingStatus(5, "published");
    expect(fake.from("recordings", "update").calls.map((call) => call.payload)).toEqual([{ status: "archived" }, { status: "published" }]);
  });

  it("an update that no policy lets through answers with no rows, which the screen reads as a refusal", async () => {
    fake.from("recordings", "update").reply(ok([]));
    expect(await setRecordingStatus(5, "archived")).toEqual([]);
  });

  it("the recording row is deleted by id, answering with the rows it removed", async () => {
    fake.from("recordings", "delete").reply(ok([{ id: 5 }]));
    expect(await deleteRecordingRow(5)).toEqual([{ id: 5 }]);
    const call = only(fake.from("recordings", "delete").calls);
    expect(call.uses("eq")).toEqual([["id", 5]]);
    expect(call.uses("select")).toEqual([["id"]]);
  });

  it("a text note changes its title and body; a file note only its title", async () => {
    fake.from("recording_notes", "update").reply(ok([{ id: 8 }]));
    await updateRecordingNote(8, { title: "Alaap", body: "Sa Re Ga" });
    await updateRecordingNote(8, { title: "Renamed.pdf" });
    const calls = fake.from("recording_notes", "update").calls;
    expect(calls.map((call) => call.payload)).toEqual([{ title: "Alaap", body: "Sa Re Ga" }, { title: "Renamed.pdf" }]);
    expect("body" in (calls[1].payload as object)).toBe(false);
    expect(calls[0].uses("eq")).toEqual([["id", 8]]);
  });

  it("a note is deleted by id", async () => {
    fake.from("recording_notes", "delete").reply(ok([{ id: 8 }]));
    expect(await deleteRecordingNote(8)).toEqual([{ id: 8 }]);
    expect(only(fake.from("recording_notes", "delete").calls).uses("eq")).toEqual([["id", 8]]);
  });

  it("every refused write throws an ApiError that keeps the database's sentence", async () => {
    for (const table of ["recordings", "recording_notes"]) fake.from(table).reply(fail("permission denied", "42501"));
    const calls = [
      () => updateRecordingDetails(5, { title: "T", description: "", recording_kind: "practice", raga: null, tala: null, sruthi: null, tempo: null }),
      () => setRecordingStatus(5, "archived"), () => deleteRecordingRow(5), () => updateRecordingNote(8, { title: "T" }), () => deleteRecordingNote(8),
    ];
    for (const call of calls) expect(await caught(call())).toMatchObject({ name: "ApiError", message: "permission denied", code: "42501" });
  });
});

describe("removing stored files: an empty answer from storage is a refusal, not a success", () => {
  it("a take that storage removes resolves to null, from the recordings bucket", async () => {
    expect(await removeRecordingTake("u-me/take.webm")).toBeNull();
    expect(only(fake.storage("recordings", "remove").calls).args).toEqual([["u-me/take.webm"]]);
  });

  it("a notation file is removed from recording-notations", async () => {
    expect(await removeNotationFile("u-me/n.pdf")).toBeNull();
    expect(only(fake.storage("recording-notations", "remove").calls).args).toEqual([["u-me/n.pdf"]]);
  });

  it("an empty answer for a file that still opens says it was not deleted (a policy refused it)", async () => {
    fake.storage("recordings", "remove").reply(ok([]));
    expect(await removeRecordingTake("u-me/take.webm")).toBe(FILE_NOT_DELETED);
    expect(only(fake.storage("recordings", "createSignedUrl").calls).args).toEqual(["u-me/take.webm", 60]);
  });

  it("an empty answer for a file that is already gone counts as removed (a retry after a half-finished delete)", async () => {
    fake.storage("recording-notations", "remove").reply(ok([]));
    fake.storage("recording-notations", "createSignedUrl").reply(fail("Object not found"));
    expect(await removeNotationFile("u-me/n.pdf")).toBeNull();
  });

  it("a clean-up after a failed save does not check whether the file can still be signed: an empty answer is a refusal", async () => {
    fake.storage("recordings", "remove").reply(ok([]));
    fake.storage("recording-notations", "remove").reply(ok([]));
    expect(await removeAbandonedTake("u-me/take.webm")).toBe(FILE_NOT_DELETED);
    expect(await removeAbandonedNotationFile("u-me/n.pdf")).toBe(FILE_NOT_DELETED);
    expect(fake.callsTo("storage").some((call) => call.op === "createSignedUrl")).toBe(false);
  });

  it("a storage error is said in storage's own words, and a dropped connection reads as a failure too", async () => {
    fake.storage("recordings", "remove").replyOnce(fail("The resource was not found"));
    expect(await removeAbandonedTake("a")).toBe("The resource was not found");
    fake.storage("recordings", "remove").replyOnce(rejects());
    expect(await removeAbandonedTake("a")).toBe("The connection dropped. Check your internet and try again.");
  });

  it("a club recording's file: the helper's options are passed on", async () => {
    fake.storage("club-archive", "remove").reply(ok([]));
    expect(await removeClubArchiveFile("u/c.mp3", { refusedMessage: "Ask an administrator to delete it." })).toBe("Ask an administrator to delete it.");
    expect(fake.storage("club-archive", "createSignedUrl").count).toBe(0);
    expect(only(fake.storage("club-archive", "remove").calls).args).toEqual([["u/c.mp3"]]);
    fake.reset();
    fake.storage("club-archive", "remove").reply(ok([]));
    fake.storage("club-archive", "createSignedUrl").reply(fail("Object not found"));
    expect(await removeClubArchiveFile("u/c.mp3", { confirmGone: true })).toBeNull();
  });
});

describe("the club archive", () => {
  it("asks whether a group's recording room plays the same file", async () => {
    fake.from("recordings", "select").reply(ok([{ id: 4 }]));
    expect(await isInRecordingRoom("u/c.mp3")).toBe(true);
    const call = only(fake.from("recordings", "select").calls);
    expect(call.uses("select")).toEqual([["id"]]);
    expect(call.uses("eq")).toEqual([["storage_path", "u/c.mp3"]]);
    expect(call.uses("limit")).toEqual([[1]]);
    fake.from("recordings", "select").reply(ok([]));
    expect(await isInRecordingRoom("u/other.mp3")).toBe(false);
  });

  it("a failed check throws, so the caller cannot mistake it for 'not shared'", async () => {
    fake.from("recordings", "select").reply(fail("boom"));
    expect(await caught(isInRecordingRoom("u/c.mp3"))).toBeInstanceOf(ApiError);
  });

  it("an edit writes the details and the two access columns, by id", async () => {
    fake.from("archive_items", "update").reply(ok([{ id: 3 }]));
    const rows = await updateClubArchiveItem(3, { title: "Concert", description: "d", raga: null, tala: "Adi", event_date: "2026-05-01", visibility: "members", is_public: true });
    expect(rows).toEqual([{ id: 3 }]);
    const call = only(fake.from("archive_items", "update").calls);
    expect(call.payload).toEqual({ title: "Concert", description: "d", raga: null, tala: "Adi", event_date: "2026-05-01", visibility: "members", is_public: true });
    expect(call.uses("eq")).toEqual([["id", 3]]);
    expect(call.uses("select")).toEqual([["id"]]);
  });

  it("a delete removes the row by id", async () => {
    fake.from("archive_items", "delete").reply(ok([{ id: 3 }]));
    expect(await deleteClubArchiveItem(3)).toEqual([{ id: 3 }]);
    expect(only(fake.from("archive_items", "delete").calls).uses("eq")).toEqual([["id", 3]]);
  });

  it("a file goes under the person's folder in club-archive, never replacing a file", async () => {
    const path = await uploadClubArchiveFile("u-me", file("Spring concert.mp3", "audio/mpeg"));
    expect(path).toMatch(/^u-me\/[0-9a-f-]{36}-Spring-concert\.mp3$/);
    const upload = only(fake.storage("club-archive", "upload").calls);
    expect(upload.args[0]).toBe(path);
    expect(upload.args[2]).toEqual({ upsert: false });
  });

  it("a refused upload throws an ApiError", async () => {
    fake.storage("club-archive", "upload").reply(fail("Payload too large"));
    expect(await caught(uploadClubArchiveFile("u-me", file("a.mp3")))).toMatchObject({ name: "ApiError", message: "Payload too large" });
  });

  it("the row that points at the file is a recording, with its access, its details and its uploader", async () => {
    fake.from("archive_items", "insert").reply(ok(null));
    await insertClubArchiveItem({ title: "Concert", description: "", storagePath: "u-me/x-a.mp3", visibility: "members", isPublic: false, raga: null, tala: null, uploadedBy: "u-me" });
    expect(only(fake.from("archive_items", "insert").calls).payload).toEqual({
      title: "Concert", description: "", type: "recording", storage_path: "u-me/x-a.mp3", visibility: "members", is_public: false, raga: null, tala: null, uploaded_by: "u-me",
    });
  });

  it("every refused write throws an ApiError", async () => {
    fake.from("archive_items").reply(fail("permission denied", "42501"));
    expect(await caught(insertClubArchiveItem({ title: "c", description: "", storagePath: "p", visibility: "members", isPublic: false, raga: null, tala: null, uploadedBy: "u" }))).toMatchObject({ code: "42501" });
    expect(await caught(updateClubArchiveItem(3, { title: "c", description: "", raga: null, tala: null, event_date: null, visibility: "members", is_public: false }))).toBeInstanceOf(ApiError);
    expect(await caught(deleteClubArchiveItem(3))).toBeInstanceOf(ApiError);
  });
});

describe("a portal with no connection", () => {
  it("says so instead of calling anything", async () => {
    vi.resetModules();
    vi.doMock("../../lib/supabase", () => ({ supabase: null }));
    const offline = await import("../../lib/api/recordings");
    const { ApiError: OfflineApiError } = await import("../../lib/errors");
    expect(await caught(offline.listRecordingNotes(1))).toBeInstanceOf(OfflineApiError);
    expect(await caught(offline.isInRecordingRoom("a"))).toMatchObject({ message: "The portal is not connected." });
    expect(fake.calls).toHaveLength(0);
    vi.doUnmock("../../lib/supabase");
    vi.resetModules();
  });
});
