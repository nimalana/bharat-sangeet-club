// A small in-memory cache so a screen you have already opened shows its last
// data immediately while it refreshes in the background.
//
// Entries are keyed by the signed-in user's id, are never written to disk, and
// are dropped on sign-out, so one account can never see another's data.
const store = new Map<string, unknown>();
let owner: string | null = null;

export function setCacheOwner(userId: string | null) {
  if (owner !== userId) store.clear();
  owner = userId;
}

export function readCache<T>(userId: string, key: string): T | undefined {
  return owner === userId ? (store.get(key) as T | undefined) : undefined;
}

export function writeCache<T>(userId: string, key: string, value: T) {
  if (owner === userId) store.set(key, value);
}

export function clearCache() {
  store.clear();
}

// Drops every entry whose key starts with `prefix`. Used after a change so the
// lists built from the old data are read again.
export function clearCachePrefix(prefix: string) {
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key);
}
