// Turns a Supabase/Postgres error into a sentence a member can act on.
// Functions in supabase/migrations raise readable messages; those pass
// through. Raw database errors are replaced.
//
// The data layer (lib/api/*.ts) throws ApiError for every failed call, so a screen has ONE kind of failure to catch;
// friendlyError reads it exactly as it read the raw Supabase error (same message and code), so the sentence a person
// sees does not change.

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

// ---------------------------------------------------------------- one error type for the data layer

/**
 * What every lib/api function throws when Supabase answers with an error (or a request cannot be made).
 * `message` and `code` are the database's own, untouched, so friendlyError(error) says what it said about the raw error.
 * `details` and `hint` are PostgREST's; `status` is the HTTP status when the answer carried one (storage errors do);
 * `cause` is the original error object.
 */
export class ApiError extends Error {
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;
  readonly status: number | undefined;

  constructor(message: string, fields: { code?: string; details?: string; hint?: string; status?: number; cause?: unknown } = {}) {
    super(message, fields.cause === undefined ? undefined : { cause: fields.cause });
    this.name = "ApiError";
    this.code = fields.code;
    this.details = fields.details;
    this.hint = fields.hint;
    this.status = fields.status;
  }
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const httpStatus = (value: unknown): number | undefined => {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= 100 && number <= 599 ? number : undefined;
};

/**
 * Turns whatever a call produced into an ApiError: a PostgREST error ({ message, code, details, hint }), a storage
 * error ({ message, statusCode | status }), an Error, a string. An ApiError is returned as it is. Something with no
 * message (null, a number, {}) gets an empty message, which friendlyError reads as "no detail" and answers with its
 * fallback, as it did for the raw value. `status` is the HTTP status of the response, used when the error has none.
 */
export function toApiError(error: unknown, status?: number): ApiError {
  if (error instanceof ApiError) return error;
  if (typeof error === "string") return new ApiError(error, { status: httpStatus(status), cause: error });
  if (error && typeof error === "object") {
    const fields = error as Record<string, unknown>;
    return new ApiError(typeof fields.message === "string" ? fields.message : "", {
      code: text(fields.code),
      details: text(fields.details),
      hint: text(fields.hint),
      status: httpStatus(fields.status) ?? httpStatus(fields.statusCode) ?? httpStatus(status),
      cause: error,
    });
  }
  return new ApiError("", { status: httpStatus(status), cause: error });
}
