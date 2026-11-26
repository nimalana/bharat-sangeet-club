// Turns a Supabase/Postgres error into a sentence a member can act on.
// Functions in supabase/migrations raise readable messages; those pass
// through. Raw database errors are replaced.

type ErrorLike = { message?: string; code?: string } | null | undefined;

const RAW_DATABASE_MESSAGE = /violates|constraint|relation "|column "|syntax error|permission denied|row-level security|JWT|schema cache/i;

export function friendlyError(error: ErrorLike, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  const message = (error.message || "").trim();
  if (error.code === "23505") return message && !RAW_DATABASE_MESSAGE.test(message) ? message : "That already exists.";
  if (error.code === "23503") return "This is still linked to other records, so it cannot be changed here.";
  if (error.code === "42501" && RAW_DATABASE_MESSAGE.test(message)) return "You do not have permission to do that.";
  if (/Failed to fetch|NetworkError|load failed/i.test(message)) return "The connection dropped. Check your internet and try again.";
  if (!message || RAW_DATABASE_MESSAGE.test(message)) return fallback;
  return message.charAt(0).toUpperCase() + message.slice(1);
}
