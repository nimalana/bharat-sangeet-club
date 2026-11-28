// The public concert list, read on the server with the anon key and cached for
// five minutes. It holds only the columns the signed-out page shows. Signed
// links are never part of it: they are requested when a visitor clicks Watch
// (10 minute expiry), so nothing time-limited sits in the cached page.
//
// No React or Next imports, so the module runs under `node --test`.

const PUBLIC_CONCERTS_REVALIDATE_SECONDS = 300;
export const PUBLIC_CONCERT_COLUMNS = "id,title,description,type,storage_path,event_date,raga,tala,created_at,is_public";

export type PublicConcert = {
  id: number;
  title: string;
  description: string;
  type: "recording";
  storage_path: string;
  event_date: string | null;
  raga: string | null;
  tala: string | null;
  created_at: string;
  is_public: boolean;
};

export function publicConcertsUrl(supabaseUrl: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  const query = new URLSearchParams({
    select: PUBLIC_CONCERT_COLUMNS,
    type: "eq.recording",
    is_public: "eq.true",
    order: "event_date.desc",
  });
  return `${base}/rest/v1/archive_items?${query.toString()}`;
}

// Only rows with the shape the page needs are kept. A row that is not a public
// recording is dropped even though the database policy already hides it.
export function parsePublicConcerts(body: unknown): PublicConcert[] | null {
  if (!Array.isArray(body)) return null;
  const rows: PublicConcert[] = [];
  for (const raw of body) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "number" || typeof row.title !== "string" || typeof row.storage_path !== "string") continue;
    if (row.type !== "recording" || row.is_public !== true) continue;
    rows.push({
      id: row.id,
      title: row.title,
      description: typeof row.description === "string" ? row.description : "",
      type: "recording",
      storage_path: row.storage_path,
      event_date: typeof row.event_date === "string" ? row.event_date : null,
      raga: typeof row.raga === "string" ? row.raga : null,
      tala: typeof row.tala === "string" ? row.tala : null,
      created_at: typeof row.created_at === "string" ? row.created_at : "",
      is_public: true,
    });
  }
  return rows;
}

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

// Null means "could not be read": the page then falls back to loading the list
// in the browser, exactly as before, instead of showing an empty archive.
export async function loadPublicConcerts(
  env: { url?: string; key?: string },
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<PublicConcert[] | null> {
  if (!env.url || !env.key) return null;
  try {
    const response = await fetchImpl(publicConcertsUrl(env.url), {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, Accept: "application/json" },
      next: { revalidate: PUBLIC_CONCERTS_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    return parsePublicConcerts(await response.json());
  } catch {
    return null;
  }
}
