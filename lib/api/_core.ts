// The smallest piece the per-area modules (lib/api/<area>.ts) share: turn a Supabase answer into its data, or throw.
//
//   const rows = must(await supabase.from("events").select("id,title").order("starts_at"));
//
// An answer with an error throws an ApiError (lib/errors.ts) that keeps the database's message, code, details, hint and
// the HTTP status; an answer without one gives its `data` (null stays null: `.maybeSingle()` with no row is not a
// failure). The call itself stays written out in the area module, with a literal table or function name, because the
// contract check (scripts/contract-check) reads those literals.
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { ApiError, toApiError } from "../errors";

export function must<T>(answer: PostgrestSingleResponse<T>): T {
  if (answer.error) throw toApiError(answer.error, answer.status);
  return answer.data;
}

/** A file's name as it may appear in a storage path: every character outside letters, digits, dot, underscore and hyphen becomes a hyphen. */
export function safeFileName(file: Pick<File, "name">): string {
  return file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

// ---------------------------------------------------------------- an upload that reports its bytes

/** How much of the request body has been sent. `total` is the size of the whole body (the file plus a few bytes of form framing). */
export type UploadProgress = { loaded: number; total: number };
export type UploadOptions = { upsert?: boolean; cacheControl?: string; signal?: AbortSignal };
/** The same two-sided answer as supabase-js's `.upload()`, with the error already an ApiError: `if (answer.error) throw answer.error`. */
export type UploadAnswer = { data: { path: string; id: string; fullPath: string }; error: null } | { data: null; error: ApiError };

// supabase-js sends a file through fetch, which cannot say how many bytes have left. This sends THE SAME REQUEST through XMLHttpRequest,
// which can (`upload.onprogress`), so a screen can show a bar for a recording of tens of megabytes:
//
//   const answer = await uploadWithProgress(client, "recordings", path, file, { upsert: false }, (p) => setLoaded(p.loaded / p.total));
//   if (answer.error) throw answer.error;
//
// "The same request" is checked, not assumed: tests/component/upload-with-progress.test.ts runs the real supabase-js client and this function
// against one fake transport and compares the URL, the method, the headers and every part of the body. The only difference is the
// `X-Client-Info` header (which names the SDK version) that supabase-js adds and this does not send.
//   POST {SUPABASE_URL}/storage/v1/object/{bucket}/{path}
//   apikey: the publishable key, Authorization: Bearer <the signed-in person's token, or the key when nobody is signed in>, x-upsert
//   body: multipart form data with `cacheControl` and the file as the unnamed part (the browser writes the content type and the boundary)
// The bucket is a parameter written as a literal at the call site, because scripts/contract-check reads it there (config.json "storageHelpers").
// Errors come back, they are not thrown: a refused upload carries the server's own message and HTTP status, a dropped connection the
// message "Failed to fetch" (friendlyError turns it into its "connection dropped" sentence, as it does for supabase-js), and a cancelled one
// (`options.signal`) the code "aborted".
type UploadClient = { auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> } };

export async function uploadWithProgress(
  client: UploadClient, bucket: string, path: string, file: Blob, options: UploadOptions = {}, onProgress?: (progress: UploadProgress) => void,
): Promise<UploadAnswer> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { data: null, error: new ApiError("The portal is not connected.") };
  const failed = (message: string, fields: ConstructorParameters<typeof ApiError>[1] = {}): UploadAnswer => ({ data: null, error: new ApiError(message, fields) });
  if (options.signal?.aborted) return failed("The upload was cancelled.", { code: "aborted" });

  // The path as storage-js writes it: no slash at either end, no empty folder.
  const cleanPath = path.replace(/^\/|\/$/g, "").replace(/\/+/g, "/");
  const target = `${new URL("storage/v1", url.endsWith("/") ? url : `${url}/`).href}/object/${bucket}/${cleanPath}`;
  const token = (await client.auth.getSession()).data.session?.access_token ?? key;
  const body = new FormData();
  body.append("cacheControl", options.cacheControl ?? "3600");
  body.append("", file);

  return new Promise<UploadAnswer>((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", target);
    request.setRequestHeader("apikey", key);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("x-upsert", String(options.upsert ?? false));
    request.upload.addEventListener("progress", (event) => onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : file.size }));
    request.addEventListener("load", () => {
      let answer: Record<string, unknown> | null = null;
      try { answer = JSON.parse(request.responseText) as Record<string, unknown> | null; } catch { /* not JSON: handled below */ }
      if (request.status >= 200 && request.status < 300 && answer) {
        resolve({ data: { path: cleanPath, id: String(answer.Id), fullPath: String(answer.Key) }, error: null });
        return;
      }
      // storage-js reads the message of a refused request from these fields, in this order.
      const said = answer && ["msg", "message", "error_description", "error"].map((field) => answer[field]).find((value) => typeof value === "string");
      resolve(failed(typeof said === "string" ? said : request.statusText || `HTTP ${request.status} error`, { status: request.status, code: typeof answer?.code === "string" ? answer.code : undefined, cause: answer }));
    });
    request.addEventListener("error", () => resolve(failed("Failed to fetch")));
    request.addEventListener("abort", () => resolve(failed("The upload was cancelled.", { code: "aborted" })));
    options.signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });
}
