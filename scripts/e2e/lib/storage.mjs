// Storage helpers shared by the tests. They go through the same supabase-js calls the app uses.
import { randomUUID } from "node:crypto";
import { asFile, sha256 } from "./fixtures.mjs";
import { describeError } from "./assert.mjs";

export const uid = () => randomUUID();

export async function put(client, bucket, path, buffer, type) {
  const name = path.split("/").pop();
  return client.storage.from(bucket).upload(path, asFile(buffer, name, type), { contentType: type, upsert: false });
}

export function sign(client, bucket, path, seconds = 300) {
  return client.storage.from(bucket).createSignedUrl(path, seconds);
}

// Downloads a signed URL (no auth needed: the token is the credential).
export async function download(url) {
  const response = await fetch(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes, sha: sha256(bytes), type: response.headers.get("content-type") };
}

// Is an object listed in its folder, as seen by this client?
export async function listed(client, bucket, path) {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const name = path.slice(slash + 1);
  const res = await client.storage.from(bucket).list(folder, { limit: 100, search: name });
  if (res.error) throw new Error(`list ${bucket}/${folder} failed: ${describeError(res.error)}`);
  return (res.data || []).some((entry) => entry.name === name);
}

// Uploads, signs and downloads to prove the stored bytes are the uploaded bytes. Returns the signed URL.
export async function putAndVerify(client, bucket, path, buffer, type, label) {
  const up = await put(client, bucket, path, buffer, type);
  if (up.error) throw new Error(`${label || "upload"} to ${bucket} failed: ${describeError(up.error)}`);
  const signed = await sign(client, bucket, path, 600);
  if (signed.error) throw new Error(`${label || "sign"} ${bucket}/${path} failed: ${describeError(signed.error)}`);
  const got = await download(signed.data.signedUrl);
  if (got.status !== 200) throw new Error(`${label || "download"} ${bucket}/${path} returned HTTP ${got.status}`);
  if (got.sha !== sha256(buffer)) throw new Error(`${label || "download"} ${bucket}/${path}: downloaded bytes differ from what was uploaded`);
  return signed.data.signedUrl;
}

// An unfetched signed URL with a long expiry. Made before a delete and fetched only after it, it shows
// whether the stored bytes are really gone (a URL that was fetched before the delete may be served from
// the CDN cache, which says nothing about storage).
export async function freshUrl(client, bucket, path) {
  const signed = await sign(client, bucket, path, 3600);
  if (signed.error) throw new Error(`sign ${bucket}/${path} failed: ${describeError(signed.error)}`);
  return signed.data.signedUrl;
}

// Signed URLs that were fetched before the delete and were still served afterwards (CDN cache), for the report.
export const servedFromCache = [];

// Proves a stored file is really gone:
//   - nobody who could list it before lists it now, and nobody can create a new signed URL for it,
//   - a signed URL that was made before the delete but never fetched (`fresh`) no longer downloads,
//   - a signed URL that was already fetched before the delete (`fetched`) is only reported if it still
//     downloads: that is the CDN cache, not storage.
export async function proveGone(clients, bucket, path, urls = {}) {
  const problems = [];
  for (const [who, client] of Object.entries(clients)) {
    try { if (await listed(client, bucket, path)) problems.push(`${who} still lists ${bucket}/${path}`); }
    catch (error) { /* a refused listing means it is not visible to them either */ void error; }
    const again = await sign(client, bucket, path, 60);
    if (!again.error && again.data?.signedUrl) problems.push(`${who} can still sign ${bucket}/${path}`);
  }
  if (urls.fresh) {
    const got = await download(urls.fresh);
    if (got.status === 200) problems.push(`a signed URL made before the delete (never fetched) still downloads ${got.bytes.length} bytes: the stored bytes were not removed`);
  }
  if (urls.fetched) {
    const got = await download(urls.fetched);
    if (got.status === 200) servedFromCache.push({ bucket, path, bytes: got.bytes.length });
  }
  if (problems.length) throw new Error(problems.join("; "));
}
