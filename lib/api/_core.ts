// The smallest piece the per-area modules (lib/api/<area>.ts) share: turn a Supabase answer into its data, or throw.
//
//   const rows = must(await supabase.from("events").select("id,title").order("starts_at"));
//
// An answer with an error throws an ApiError (lib/errors.ts) that keeps the database's message, code, details, hint and
// the HTTP status; an answer without one gives its `data` (null stays null: `.maybeSingle()` with no row is not a
// failure). The call itself stays written out in the area module, with a literal table or function name, because the
// contract check (scripts/contract-check) reads those literals.
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { toApiError } from "../errors";

export function must<T>(answer: PostgrestSingleResponse<T>): T {
  if (answer.error) throw toApiError(answer.error, answer.status);
  return answer.data;
}

/** A file's name as it may appear in a storage path: every character outside letters, digits, dot, underscore and hyphen becomes a hyphen. */
export function safeFileName(file: Pick<File, "name">): string {
  return file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
}
