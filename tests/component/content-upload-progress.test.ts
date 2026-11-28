// The four uploads of the content area (a recording's take, a notation file, a club-archive file, a library file) report the bytes
// that have left (Phase 3.1, plan: "uploads with progress"). They send the request supabase-js sent, through XMLHttpRequest
// (lib/api/_core.ts uploadWithProgress; the two requests are compared in upload-with-progress.test.ts). What each of them must do:
//
//  - go to its own bucket, under its own path, never replacing a file (x-upsert false);
//  - pass `onProgress` the bytes the browser reports, and work without one;
//  - answer with the stored path (the three recordings functions), and throw the ApiError of a refusal;
//  - the library's file: the content type argument is now the type that is sent (supabase-js ignored it for a File), and a refusal
//    still carries its sentence on an Error so the upload list can show it.
//
// These tests use the fake XMLHttpRequest as it is; the screens' tests route it to the fake client instead (content-uploads.ts).
import { describe, expect, it, vi } from "vitest";
import { uploadClubArchiveFile, uploadNotationFile, uploadRecordingTake } from "../../lib/api/recordings";
import { uploadResourceFile } from "../../lib/api/resources";
import { installFakeXhr } from "../support/fake-xhr";

const file = (name: string, type = "audio/webm", body = "bytes") => new File([body], name, { type });
const filePart = (body: unknown) => (body as FormData).get("") as File;

describe("a take, a notation file and a club-archive file", () => {
  const cases = [
    { name: "uploadRecordingTake", bucket: "recordings", send: (onProgress?: (p: { loaded: number; total: number }) => void) => uploadRecordingTake("u-me", 7, file("my take.webm"), onProgress), path: /^u-me\/subgroups\/7\/[0-9a-f-]{36}-my-take\.webm$/ },
    { name: "uploadNotationFile", bucket: "recording-notations", send: (onProgress?: (p: { loaded: number; total: number }) => void) => uploadNotationFile("u-me", file("sargam.pdf", "application/pdf"), onProgress), path: /^u-me\/[0-9a-f-]{36}-sargam\.pdf$/ },
    { name: "uploadClubArchiveFile", bucket: "club-archive", send: (onProgress?: (p: { loaded: number; total: number }) => void) => uploadClubArchiveFile("u-me", file("Spring concert.mp3", "audio/mpeg"), onProgress), path: /^u-me\/[0-9a-f-]{36}-Spring-concert\.mp3$/ },
  ];

  for (const { name, bucket, send, path } of cases) {
    it(`${name}: one POST to the ${bucket} bucket that never replaces a file, the bytes reported, the stored path answered`, async () => {
      const xhr = installFakeXhr();
      const onProgress = vi.fn();
      const done = send(onProgress);
      const request = await xhr.waitForRequest();
      expect(request.method).toBe("POST");
      const stored = request.url.split(`/storage/v1/object/${bucket}/`)[1];
      expect(stored).toMatch(path);
      expect(request.headers["x-upsert"]).toBe("false");
      expect(filePart(request.body)).toBeInstanceOf(File);
      request.progress(250, 1000);
      request.progress(1000, 1000);
      expect(onProgress.mock.calls).toEqual([[{ loaded: 250, total: 1000 }], [{ loaded: 1000, total: 1000 }]]);
      request.respond(200, { Id: "1", Key: `${bucket}/${stored}` });
      expect(await done).toBe(stored);
    });

    it(`${name}: works without a progress callback`, async () => {
      const xhr = installFakeXhr();
      const done = send();
      const request = await xhr.waitForRequest();
      request.progress(10, 20);
      request.respond(200, { Id: "1", Key: "x" });
      await expect(done).resolves.toMatch(path);
    });

    it(`${name}: a refusal is thrown as an ApiError with the server's sentence and status; a dropped connection says so`, async () => {
      const xhr = installFakeXhr();
      const refused = send();
      (await xhr.waitForRequest()).respond(413, { message: "The object exceeded the maximum allowed size", statusCode: "413" }, "Payload Too Large");
      await expect(refused).rejects.toMatchObject({ name: "ApiError", message: "The object exceeded the maximum allowed size", status: 413 });
      const dropped = send();
      await vi.waitFor(() => { if (xhr.requests.length < 2) throw new Error("not yet"); });
      xhr.requests[1].networkError();
      await expect(dropped).rejects.toMatchObject({ name: "ApiError", message: "Failed to fetch" });
    });
  }
});

describe("uploadResourceFile", () => {
  it("one POST to the club-resources bucket that never replaces a file, the bytes reported", async () => {
    const xhr = installFakeXhr();
    const onProgress = vi.fn();
    const done = uploadResourceFile("u-1/imp-1/a.pdf", file("a.pdf", "application/pdf"), "application/pdf", onProgress);
    const request = await xhr.waitForRequest();
    expect(request.url).toMatch(/\/storage\/v1\/object\/club-resources\/u-1\/imp-1\/a\.pdf$/);
    expect(request.headers["x-upsert"]).toBe("false");
    request.progress(1, 4);
    expect(onProgress).toHaveBeenCalledWith({ loaded: 1, total: 4 });
    request.respond(200, { Id: "1", Key: "club-resources/u-1/imp-1/a.pdf" });
    await expect(done).resolves.toBeUndefined();
  });

  it("a file with a type of its own is sent as it is", async () => {
    const xhr = installFakeXhr();
    const original = file("a.pdf", "application/pdf");
    const done = uploadResourceFile("u/a.pdf", original, "application/pdf");
    const request = await xhr.waitForRequest();
    expect(filePart(request.body).type).toBe("application/pdf");
    request.respond(200, { Id: "1", Key: "k" });
    await done;
  });

  it("a file with NO type (a score) is sent as the type the caller names, which is what the row records and what the bucket accepts for scores", async () => {
    const xhr = installFakeXhr();
    const score = file("hymn.mxl", "");
    expect(score.type).toBe("");
    const done = uploadResourceFile("u/hymn.mxl", score, "application/octet-stream");
    const request = await xhr.waitForRequest();
    const sent = filePart(request.body);
    expect(sent.type).toBe("application/octet-stream");
    expect(sent.name).toBe("hymn.mxl");
    expect(await sent.text()).toBe("bytes");
    request.respond(200, { Id: "1", Key: "k" });
    await done;
  });

  it("a refusal is an ApiError with the server's sentence, carried on an Error too (the upload list shows what an Error says, never a database answer)", async () => {
    const xhr = installFakeXhr();
    const done = uploadResourceFile("u/b.pdf", file("b.pdf", "application/pdf"), "application/pdf");
    (await xhr.waitForRequest()).respond(400, { message: "mime type application/x-foo is not supported", error: "invalid_mime_type", statusCode: "415" });
    const error = await done.then(() => null, (caught: unknown) => caught as { name: string; message: string; status: number; cause: unknown });
    expect(error).toMatchObject({ name: "ApiError", message: "mime type application/x-foo is not supported", status: 400 });
    expect(error?.cause).toBeInstanceOf(Error);
    expect((error?.cause as Error).message).toBe("mime type application/x-foo is not supported");
  });
});
