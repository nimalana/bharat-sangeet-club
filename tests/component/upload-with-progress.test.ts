// uploadWithProgress in lib/api/_core.ts: an upload through XMLHttpRequest that reports its bytes. The whole case for using it
// instead of supabase-js's own .upload() is that it sends THE SAME REQUEST, so the first group of tests runs the real supabase-js client
// and uploadWithProgress against one scripted transport and compares what each put on the wire: URL, method, headers, every part of
// the body, and what each makes of the server's answer (success, a refusal, a page that is not JSON, a dropped connection).
// The second group is what only uploadWithProgress does: the progress, the cancel, the refusal to run without a project.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { uploadWithProgress } from "../../lib/api/_core";
import { ApiError, friendlyError, toApiError } from "../../lib/errors";
import { fake } from "../support/fake-supabase";
import { FAKE_SUPABASE_KEY, FAKE_SUPABASE_URL, installFakeXhr } from "../support/fake-xhr";

type Sent = { url: string; method: string; headers: Record<string, string>; parts: unknown[] };
type Reply = { status: number; body: unknown; statusText?: string } | "network";

const describePart = (value: FormDataEntryValue) => (typeof value === "string" ? value : { file: value.name, type: value.type, size: value.size });
const partsOf = (body: unknown) => [...(body as FormData).entries()].map(([name, value]) => [name, describePart(value)]);
const lower = (headers: Record<string, string>) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

const SESSION = { access_token: "jwt-of-a-member", refresh_token: "r", token_type: "bearer", expires_in: 3600, user: { id: "u1", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };

// The real client, with its transport replaced by one that records the request and answers `reply`; `signedIn` stores a session for it.
function realClient(reply: Reply, signedIn: boolean) {
  const store = new Map<string, string>();
  if (signedIn) store.set("sb-test-auth", JSON.stringify({ ...SESSION, expires_at: Math.floor(Date.now() / 1000) + 3600 }));
  const sent: Sent[] = [];
  const client = createClient(FAKE_SUPABASE_URL, FAKE_SUPABASE_KEY, {
    auth: { storageKey: "sb-test-auth", storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); }, removeItem: (key) => { store.delete(key); } }, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        sent.push({ url: String(input), method: String(init?.method), headers: lower(Object.fromEntries(new Headers(init?.headers).entries())), parts: partsOf(init?.body) });
        if (reply === "network") throw new TypeError("Failed to fetch");
        return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), { status: reply.status, statusText: reply.statusText });
      },
    },
  });
  return { client, sent };
}

// Uploads the same file both ways and returns what each sent and answered.
async function both(args: { bucket?: string; path: string; reply: Reply; signedIn?: boolean; options?: { upsert?: boolean; cacheControl?: string } }) {
  const bucket = args.bucket ?? "recordings";
  const file = new File(["sa re ga ma"], "take 1.mp3", { type: "audio/mpeg" });
  const { client, sent } = realClient(args.reply, args.signedIn ?? false);
  const real = await client.storage.from(bucket).upload(args.path, file, { contentType: file.type, ...args.options });

  const xhr = installFakeXhr();
  const mine = uploadWithProgress(client, bucket, args.path, file, args.options);
  const request = await xhr.waitForRequest();
  if (args.reply === "network") request.networkError(); else request.respond(args.reply.status, args.reply.body, args.reply.statusText);
  return { real, sent: sent[0], mine: await mine, request, myRequest: { url: request.url, method: request.method, headers: lower(request.headers), parts: partsOf(request.body) } as Sent };
}

describe("uploadWithProgress sends the request supabase-js sends", () => {
  it("the URL, the method, the body and the headers are the same, apart from the SDK's own X-Client-Info", async () => {
    const run = await both({ path: "u1/subgroups/3/take.mp3", reply: { status: 200, body: { Id: "obj-1", Key: "recordings/u1/subgroups/3/take.mp3" } } });
    expect(run.myRequest.url).toBe(`${FAKE_SUPABASE_URL}/storage/v1/object/recordings/u1/subgroups/3/take.mp3`);
    expect(run.myRequest.url).toBe(run.sent.url);
    expect(run.myRequest.method).toBe("POST");
    expect(run.myRequest.method).toBe(run.sent.method);
    expect(run.myRequest.parts).toEqual([["cacheControl", "3600"], ["", { file: "take 1.mp3", type: "audio/mpeg", size: 11 }]]);
    expect(run.myRequest.parts).toEqual(run.sent.parts);
    expect(run.sent.headers).toEqual({ ...run.myRequest.headers, "x-client-info": expect.stringMatching(/^supabase-js\//) });
  });

  it("with nobody signed in the key is the bearer token, as supabase-js does it", async () => {
    const run = await both({ path: "a.mp3", reply: { status: 200, body: { Id: "1", Key: "recordings/a.mp3" } } });
    expect(run.myRequest.headers).toMatchObject({ apikey: FAKE_SUPABASE_KEY, authorization: `Bearer ${FAKE_SUPABASE_KEY}`, "x-upsert": "false" });
  });

  it("a signed-in person's token is the bearer token, and upsert and cacheControl are passed on", async () => {
    const run = await both({ path: "a.mp3", signedIn: true, options: { upsert: true, cacheControl: "60" }, reply: { status: 200, body: { Id: "1", Key: "recordings/a.mp3" } } });
    expect(run.myRequest.headers).toMatchObject({ apikey: FAKE_SUPABASE_KEY, authorization: "Bearer jwt-of-a-member", "x-upsert": "true" });
    expect(run.myRequest.parts[0]).toEqual(["cacheControl", "60"]);
    expect(run.sent.headers.authorization).toBe("Bearer jwt-of-a-member");
    expect(run.sent.headers["x-upsert"]).toBe("true");
    expect(run.sent.parts).toEqual(run.myRequest.parts);
  });

  it("a path with slashes at its ends, an empty folder and a space is written as storage-js writes it", async () => {
    const run = await both({ bucket: "club-archive", path: "/folder//sub folder/take.mp3/", reply: { status: 200, body: { Id: "1", Key: "club-archive/folder/sub folder/take.mp3" } } });
    expect(run.myRequest.url).toBe(run.sent.url);
    expect(run.myRequest.url).toContain("/object/club-archive/folder/sub folder/take.mp3");
    expect(run.mine.data?.path).toBe(run.real.data?.path);
  });

  it("a stored file answers { path, id, fullPath }, the same as supabase-js", async () => {
    const run = await both({ path: "a.mp3", reply: { status: 200, body: { Id: "obj-7", Key: "recordings/a.mp3" } } });
    expect(run.real.error).toBeNull();
    expect(run.mine).toEqual({ data: { path: "a.mp3", id: "obj-7", fullPath: "recordings/a.mp3" }, error: null });
    expect(run.mine).toEqual({ data: run.real.data, error: null });
  });

  it.each([
    ["the file is already there", { status: 409, body: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } }],
    ["the file is too large", { status: 413, body: { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" } }],
    ["a policy refuses it", { status: 400, body: { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" } }],
    ["the answer carries a code", { status: 400, body: { code: "InvalidKey", message: "Invalid key", statusCode: "400" } }],
    ["the answer is a page, not JSON", { status: 502, body: "<html>Bad Gateway</html>", statusText: "Bad Gateway" }],
  ] satisfies [string, Reply][])("when %s, the error says what supabase-js's says", async (_name, reply) => {
    const run = await both({ path: "a.mp3", reply });
    expect(run.real.error).not.toBeNull();
    expect(run.mine.data).toBeNull();
    const [wanted, got] = [toApiError(run.real.error), run.mine.error!];
    expect(got).toBeInstanceOf(ApiError);
    expect({ message: got.message, status: got.status, code: got.code }).toEqual({ message: wanted.message, status: wanted.status, code: wanted.code });
    expect(friendlyError(got)).toBe(friendlyError(wanted));
  });

  it("a dropped connection is \"Failed to fetch\", which friendlyError turns into the same sentence", async () => {
    const run = await both({ path: "a.mp3", reply: "network" });
    expect(run.mine.data).toBeNull();
    expect(run.mine.error!.message).toBe("Failed to fetch");
    expect(friendlyError(run.mine.error)).toBe("The connection dropped. Check your internet and try again.");
    expect(friendlyError(run.mine.error)).toBe(friendlyError(toApiError(run.real.error)));
  });
});

describe("uploadWithProgress reports what supabase-js cannot", () => {
  const signedOut = { auth: { getSession: async () => ({ data: { session: null } }) } };
  const file = new File(["x".repeat(1000)], "take.mp3", { type: "audio/mpeg" });

  it("calls onProgress with the bytes sent and the size of the body, as the browser reports them", async () => {
    const xhr = installFakeXhr();
    const seen: unknown[] = [];
    const done = uploadWithProgress(signedOut, "recordings", "a.mp3", file, {}, (progress) => seen.push(progress));
    const request = await xhr.waitForRequest();
    request.progress(250, 1100);
    request.progress(1100, 1100);
    request.respond(200, { Id: "1", Key: "recordings/a.mp3" });
    await done;
    expect(seen).toEqual([{ loaded: 250, total: 1100 }, { loaded: 1100, total: 1100 }]);
  });

  it("falls back to the size of the file when the browser cannot tell the size of the body", async () => {
    const xhr = installFakeXhr();
    const seen: unknown[] = [];
    const done = uploadWithProgress(signedOut, "recordings", "a.mp3", file, {}, (progress) => seen.push(progress));
    const request = await xhr.waitForRequest();
    request.progress(300, 0, false);
    request.respond(200, { Id: "1", Key: "k" });
    await done;
    expect(seen).toEqual([{ loaded: 300, total: 1000 }]);
  });

  it("works without a progress listener", async () => {
    const xhr = installFakeXhr();
    const done = uploadWithProgress(signedOut, "recordings", "a.mp3", file);
    const request = await xhr.waitForRequest();
    request.progress(10, 20);
    request.respond(200, { Id: "1", Key: "k" });
    expect((await done).error).toBeNull();
  });

  it("an aborted signal stops the request and answers with the code \"aborted\"", async () => {
    const xhr = installFakeXhr();
    const controller = new AbortController();
    const done = uploadWithProgress(signedOut, "recordings", "a.mp3", file, { signal: controller.signal });
    const request = await xhr.waitForRequest();
    controller.abort();
    const answer = await done;
    expect(request.aborted).toBe(true);
    expect(answer.data).toBeNull();
    expect(answer.error).toMatchObject({ code: "aborted", message: "The upload was cancelled." });
  });

  it("a signal that is aborted before the start sends nothing", async () => {
    const xhr = installFakeXhr();
    const controller = new AbortController();
    controller.abort();
    const answer = await uploadWithProgress(signedOut, "recordings", "a.mp3", file, { signal: controller.signal });
    expect(xhr.requests).toHaveLength(0);
    expect(answer.error).toMatchObject({ code: "aborted" });
  });

  it("without a project (no URL or key) it sends nothing and says the portal is not connected", async () => {
    const xhr = installFakeXhr();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const answer = await uploadWithProgress(signedOut, "recordings", "a.mp3", file);
    expect(xhr.requests).toHaveLength(0);
    expect(answer).toEqual({ data: null, error: expect.objectContaining({ message: "The portal is not connected." }) });
  });

  it("works with the fake client of the component tests: the key is the token until fake.signIn gives a session", async () => {
    const xhr = installFakeXhr();
    const first = uploadWithProgress(fake.client as never, "recordings", "a.mp3", file);
    const signedOutRequest = await xhr.waitForRequest();
    signedOutRequest.respond(200, { Id: "1", Key: "k" });
    await first;
    expect(signedOutRequest.headers.Authorization).toBe(`Bearer ${FAKE_SUPABASE_KEY}`);

    fake.signIn({ id: "u1" });
    const second = uploadWithProgress(fake.client as never, "recordings", "b.mp3", file);
    await vi.waitFor(() => expect(xhr.requests.filter((request) => request.sent)).toHaveLength(2));
    xhr.last.respond(200, { Id: "2", Key: "k" });
    await second;
    expect(xhr.last.headers.Authorization).toBe("Bearer fake-token");
  });

  it("a project URL that ends with a slash gives the same address", async () => {
    const xhr = installFakeXhr();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `${FAKE_SUPABASE_URL}/`);
    const done = uploadWithProgress(signedOut, "recordings", "a.mp3", file);
    const request = await xhr.waitForRequest();
    request.respond(200, { Id: "1", Key: "k" });
    await done;
    expect(request.url).toBe(`${FAKE_SUPABASE_URL}/storage/v1/object/recordings/a.mp3`);
  });
});
