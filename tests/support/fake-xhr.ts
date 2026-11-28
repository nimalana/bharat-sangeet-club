// A fake XMLHttpRequest for the code that uploads with progress (uploadWithProgress in lib/api/_core.ts).
//
//   const xhr = installFakeXhr();                 // in the test (or a beforeEach); setup.ts removes it after every test
//   const done = uploadWithProgress(client, "recordings", "u/take.mp3", file, {}, onProgress);
//   await xhr.waitForRequest();                   // the request is sent after the session token was read
//   xhr.last.progress(500, 1000);                 // the browser reports bytes: onProgress({ loaded: 500, total: 1000 })
//   xhr.last.respond(200, { Id: "1", Key: "recordings/u/take.mp3" });
//   await done;                                   // { data: { path, id, fullPath }, error: null }
//
// What the request looked like is on the request: `.method`, `.url`, `.headers` (as set, names in the case the code wrote them),
// `.body` (the FormData), `.aborted`. `respond(status, json)` answers; `networkError()` is a dropped connection. installFakeXhr also
// sets the two public environment variables the upload reads (the URL and the key of the project), as lib/supabase.ts does at build.
import { vi } from "vitest";

export const FAKE_SUPABASE_URL = "https://fake-project.supabase.co";
export const FAKE_SUPABASE_KEY = "fake-publishable-key";

class FakeXhr extends EventTarget {
  static all: FakeXhr[] = [];
  readonly upload = new EventTarget();
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = undefined;
  sent = false;
  aborted = false;
  status = 0;
  statusText = "";
  responseText = "";

  constructor() { super(); FakeXhr.all.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { this.body = body; this.sent = true; }
  abort() { this.aborted = true; this.dispatchEvent(new Event("abort")); }

  /** The browser says how many bytes of the body have gone. */
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.dispatchEvent(new ProgressEvent("progress", { loaded, total, lengthComputable }));
  }
  /** The server answers. `body` is sent as JSON unless it is a string. */
  respond(status: number, body: unknown, statusText = "") {
    this.status = status;
    this.statusText = statusText;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.dispatchEvent(new Event("load"));
  }
  /** The connection dropped before an answer. */
  networkError() { this.dispatchEvent(new Event("error")); }
}

export type FakeXhrHandle = {
  requests: FakeXhr[];
  /** The newest request. Throws when nothing was sent yet. */
  readonly last: FakeXhr;
  /** Resolves once a request has been sent (an upload reads the session first, so it is not sent in the same tick). */
  waitForRequest(): Promise<FakeXhr>;
};

export function installFakeXhr(): FakeXhrHandle {
  FakeXhr.all = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", FAKE_SUPABASE_KEY);
  return {
    requests: FakeXhr.all,
    get last() {
      const request = FakeXhr.all.at(-1);
      if (!request) throw new Error("no upload request was sent yet");
      return request;
    },
    async waitForRequest() {
      await vi.waitFor(() => { if (!FakeXhr.all.some((request) => request.sent)) throw new Error("no upload request was sent yet"); });
      return FakeXhr.all.at(-1)!;
    },
  };
}
