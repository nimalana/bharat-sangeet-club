import { createClient } from "@supabase/supabase-js";
import { ACCOUNTS, ACCOUNT_KEYS } from "../accounts.mjs";
import { loggedFetch } from "./httplog.mjs";

// Marks every row the suite creates (titles, descriptions) so cleanup.sql can find it.
export const TAG = "[e2e]";
export const RUN = Date.now().toString(36);
export const mark = (label) => `${TAG} ${label} ${RUN}`;

export function newClient(cfg) {
  return createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: loggedFetch },
  });
}

// Signs every test account in with a password, the way the sign-in form does.
export async function createContext(cfg) {
  const c = {};
  const id = {};
  for (const key of ACCOUNT_KEYS) {
    const password = cfg.passwords[key];
    if (!password) throw new Error(`No password for ${key} in ${cfg.secretsPath}`);
    const client = newClient(cfg);
    const { data, error } = await client.auth.signInWithPassword({ email: ACCOUNTS[key].email, password });
    if (error || !data.user) throw new Error(`Sign-in as ${ACCOUNTS[key].email} failed: ${error?.message || "no user"} (was the setup SQL run on this project?)`);
    c[key] = client;
    id[key] = data.user.id;
  }
  const anon = newClient(cfg);

  // Accounts that are used up by a run (flagged `optional`) are signed in on demand; null means "not set up".
  async function signInOptional(key) {
    const client = newClient(cfg);
    const { data, error } = await client.auth.signInWithPassword({ email: ACCOUNTS[key].email, password: cfg.passwords[key] || "" });
    if (error || !data.user) return null;
    return { client, id: data.user.id };
  }
  return { cfg, c, id, anon, state: {}, accounts: ACCOUNTS, signInOptional };
}
