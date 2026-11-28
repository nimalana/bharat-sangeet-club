import { createClient } from "@supabase/supabase-js";
import type { AppDatabase } from "./db";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Development only: count and time every Supabase request so the cost of a
// screen is visible. In the browser console, run `__supabaseRequests()` for a
// table of what has been sent since the page loaded (or since the last
// `__supabaseRequests(true)`, which also clears it).
type RequestLogEntry = { at: string; page: string; method: string; target: string; status: number; ms: number };
const requestLog: RequestLogEntry[] = [];

const timedFetch: typeof fetch = async (input, init) => {
  const started = performance.now();
  const response = await fetch(input, init);
  try {
    const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requestLog.push({
      at: new Date().toISOString().slice(11, 23),
      page: typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("page") || "home",
      method: init?.method || "GET",
      target: requestUrl.pathname.replace(/^\/(rest|storage|auth)\/v1\//, "$1:"),
      status: response.status,
      ms: Math.round(performance.now() - started),
    });
  } catch { /* logging must never break a request */ }
  return response;
};

const measure = process.env.NODE_ENV === "development";
if (measure && typeof window !== "undefined") {
  (window as unknown as { __supabaseRequests: (clear?: boolean) => RequestLogEntry[] }).__supabaseRequests = (clear = false) => {
    const entries = [...requestLog];
    console.table(entries);
    console.info(`${entries.length} requests, ${entries.reduce((total, entry) => total + entry.ms, 0)} ms in total (not wall-clock: requests overlap)`);
    if (clear) requestLog.length = 0;
    return entries;
  };
}

// The one place the client is created. It is typed with the generated schema (lib/database.types.ts through lib/db.ts):
// a wrong table, column, argument or enum value is a compile error.
export const supabase = url && key
  ? createClient<AppDatabase>(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      ...(measure ? { global: { fetch: timedFetch } } : {}),
    })
  : null;
