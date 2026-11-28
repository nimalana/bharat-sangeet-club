// Reads the journeys use to prove an effect outside the screen (a file is really gone from storage). They run INSIDE the page, with
// the session the app itself holds, so they go through the browser's proxy and see exactly what that person may see.
import { SESSION_KEY } from "./config.mjs";
import { loadState } from "./state.mjs";

export async function storageHasObject(page, bucket, path) {
  const state = loadState();
  return page.evaluate(async ({ base, key, sessionKey, bucket, path }) => {
    const token = JSON.parse(window.localStorage.getItem(sessionKey) || "{}").access_token;
    const slash = path.lastIndexOf("/");
    const response = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ prefix: path.slice(0, slash), search: path.slice(slash + 1), limit: 100 }),
    });
    if (!response.ok) throw new Error(`storage list ${bucket} answered ${response.status}`);
    const rows = await response.json();
    return rows.some((row) => row.name === path.slice(slash + 1));
  }, { base: state.supabaseUrl, key: state.supabaseKey, sessionKey: SESSION_KEY, bucket, path });
}

export async function restRows(page, query) {
  const state = loadState();
  return page.evaluate(async ({ base, key, sessionKey, query }) => {
    const token = JSON.parse(window.localStorage.getItem(sessionKey) || "{}").access_token;
    const response = await fetch(`${base}/rest/v1/${query}`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`${query} answered ${response.status}`);
    return response.json();
  }, { base: state.supabaseUrl, key: state.supabaseKey, sessionKey: SESSION_KEY, query });
}
