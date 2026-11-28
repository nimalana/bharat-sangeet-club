// Uploads of the content area (recordings, notation files, the club archive, library files) go through XMLHttpRequest since Phase 3.1
// (lib/api/_core.ts uploadWithProgress), not through the fake client's `storage.upload`. Most tests of these screens were written
// against `fake.storage(bucket, "upload")` (the answer a test scripts, the call it reads back) and care about WHAT is uploaded and
// WHAT the screen does with the answer, not about the transport. This routes each request of the fake XMLHttpRequest
// (tests/support/fake-xhr.ts) to the fake client's `storage.from(bucket).upload(path, file, { upsert })`, so the same scripts and
// the same reads keep working:
//
//   beforeEach(() => { routeUploadsToFakeClient(); });
//   fake.storage("club-archive", "upload").reply(fail("The object exceeded the maximum allowed size"));    // a refusal (HTTP 400)
//   fake.storage("club-archive", "upload").reply(rejects());                                               // a dropped connection
//   fake.storage("recordings", "upload").calls[0].args                                                    // [path, file, { upsert }]
//
// What a test of the transport itself (the URL, the headers, the bytes reported, the cancelled upload) needs is the fake XMLHttpRequest
// as it is: `installFakeXhr()` and `xhr.last.progress(...)`; the real client against the real transport is checked in
// tests/component/upload-with-progress.test.ts. The one difference from the old call: the options argument is `{ upsert }` only,
// because the file's own type (its `type`) is what travels, as it always did (supabase-js ignored `contentType` for a File).
import { vi } from "vitest";
import { fake } from "../support/fake-supabase";
import { installFakeXhr, type FakeXhrHandle } from "../support/fake-xhr";

type Request = EventTarget & {
  url: string;
  headers: Record<string, string>;
  send(body: unknown): void;
  respond(status: number, body: unknown, statusText?: string): void;
  networkError(): void;
};
type Upload = (path: string, file: unknown, options: { upsert: boolean }) => Promise<{ error: { message: string; code?: string } | null; status?: number }>;

export function routeUploadsToFakeClient(): FakeXhrHandle {
  const handle = installFakeXhr();
  const Base = globalThis.XMLHttpRequest as unknown as new () => Request;
  let sent = 0;

  async function route(request: Request, body: unknown) {
    // https://<project>.supabase.co/storage/v1/object/<bucket>/<path>
    const rest = new URL(request.url).pathname.replace(/^\/storage\/v1\/object\//, "");
    const slash = rest.indexOf("/");
    const bucket = decodeURIComponent(rest.slice(0, slash));
    const path = decodeURIComponent(rest.slice(slash + 1));
    const file = (body as FormData).get("");
    const storage = fake.client.storage.from(bucket) as unknown as { upload: Upload };
    let answer;
    try {
      answer = await storage.upload(path, file, { upsert: request.headers["x-upsert"] === "true" });
    } catch {
      request.networkError();
      return;
    }
    if (answer.error) request.respond(answer.status ?? 400, { message: answer.error.message, ...(answer.error.code ? { code: answer.error.code } : {}) });
    else request.respond(200, { Id: `object-${++sent}`, Key: `${bucket}/${path}` });
  }

  class Routed extends Base {
    send(body: unknown) {
      super.send(body);
      void route(this, body);
    }
  }
  vi.stubGlobal("XMLHttpRequest", Routed);
  return handle;
}
