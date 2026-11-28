// The finance tests' way of answering a storage upload now that the finance upload goes through XMLHttpRequest (uploadWithProgress)
// and no longer through the fake client's storage.upload.
//
//   beforeEach(() => routeUploads());                       // every upload request is answered by what the test scripted for it:
//   fake.storage("finance-private", "upload").reply(fail("The resource already exists"));     // as before
//   fake.storage("finance-private", "upload").calls[0].args   // [path, file, { upsert }]: what the request carried
//
// The request is turned back into a call on the fake client (bucket and path from the URL, the file from the form data's unnamed part,
// x-upsert from the header), so a test scripts `fake.storage(bucket, "upload")` exactly as it did when supabase-js made the call: an answer
// with `error` is the server's refusal (HTTP 400 and its message), a reply that rejects is a dropped connection. Nothing here knows
// about finance.
//
// For a test that watches the bytes: routeUploads({ manual: true }) holds every request until `xhr.last.finish()`, and
// `xhr.last.progress(loaded, total)` reports bytes as the browser does.
import { vi } from "vitest";
import { fake } from "../support/fake-supabase";
import { FAKE_SUPABASE_KEY, FAKE_SUPABASE_URL } from "../support/fake-xhr";

class RoutedXhr extends EventTarget {
  static all: RoutedXhr[] = [];
  static manual = false;
  readonly upload = new EventTarget();
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: FormData | null = null;
  sent = false;
  aborted = false;
  status = 0;
  statusText = "";
  responseText = "";

  constructor() { super(); RoutedXhr.all.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: FormData) {
    this.body = body;
    this.sent = true;
    if (!RoutedXhr.manual) void this.finish();
  }
  abort() { this.aborted = true; this.dispatchEvent(new Event("abort")); }

  /** The bytes of the body that have gone, as the browser reports them. */
  progress(loaded: number, total: number) {
    this.upload.dispatchEvent(new ProgressEvent("progress", { loaded, total, lengthComputable: true }));
  }

  /** Answers the request with what the test scripted for this bucket on the fake client. */
  async finish() {
    const [bucket, ...rest] = new URL(this.url).pathname.split("/object/")[1].split("/");
    const path = rest.join("/");
    const storage = fake.client.storage.from(bucket) as unknown as { upload(path: string, file: unknown, options: { upsert: boolean }): Promise<{ error: { message: string; code?: string } | null }> };
    let answer: { error: { message: string; code?: string } | null };
    try {
      answer = await storage.upload(path, this.body?.get(""), { upsert: this.headers["x-upsert"] === "true" });
    } catch {
      this.dispatchEvent(new Event("error"));
      return;
    }
    if (answer.error) this.respond(400, { message: answer.error.message, ...(answer.error.code ? { code: answer.error.code } : {}) });
    else this.respond(200, { Id: "object-id", Key: `${bucket}/${path}` });
  }

  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.dispatchEvent(new Event("load"));
  }
}

export type RoutedUploads = {
  requests: RoutedXhr[];
  /** The newest request. Throws when nothing was sent yet. */
  readonly last: RoutedXhr;
  /** Resolves once a request has been sent (the session is read first, so it does not go out in the same tick). */
  waitForRequest(): Promise<RoutedXhr>;
};

export function routeUploads(options: { manual?: boolean } = {}): RoutedUploads {
  RoutedXhr.all = [];
  RoutedXhr.manual = Boolean(options.manual);
  vi.stubGlobal("XMLHttpRequest", RoutedXhr);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", FAKE_SUPABASE_KEY);
  return {
    requests: RoutedXhr.all,
    get last() {
      const request = RoutedXhr.all.at(-1);
      if (!request) throw new Error("no upload request was sent yet");
      return request;
    },
    async waitForRequest() {
      await vi.waitFor(() => { if (!RoutedXhr.all.some((request) => request.sent)) throw new Error("no upload request was sent yet"); });
      return RoutedXhr.all.at(-1)!;
    },
  };
}
