// What the signed-in shell does with the answer from get_portal_bootstrap.
//
// The shell must never show the member screens on a guess. The role and the
// deactivated flag both come from this one answer, so when it does not arrive
// (offline, a server error, no profile, a thrown request) the shell shows an
// error with Retry instead of falling back to the default "member" role, and a
// deactivated account always gets the deactivated screen when the profile says so.
// Pure, so it can be tested without a browser (tests/bootstrap.test.mjs).

// Type-only import: lib modules that tests load directly import nothing at run time.
import type { ClubRole } from "./sections";

export type BootstrapProfile = { full_name: string; role: ClubRole; status: "active" | "deactivated" };

export type BootstrapOutcome<T> =
  | { kind: "ready"; boot: T & { profile: BootstrapProfile } }
  | { kind: "deactivated" }
  | { kind: "failed" };

// What the shell shows. "loading" is the state before any answer.
export type ShellState = "loading" | "ready" | "failed" | "deactivated";

type Answer = { data: unknown; error: unknown };

const ROLES: readonly ClubRole[] = ["member", "executive", "admin"];
const isRole = (value: unknown): value is ClubRole => typeof value === "string" && (ROLES as readonly string[]).includes(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function interpretBootstrap<T>(answer: Answer): BootstrapOutcome<T> {
  if (answer.error) return { kind: "failed" };
  if (!isRecord(answer.data) || !isRecord(answer.data.profile)) return { kind: "failed" };
  const profile = answer.data.profile;
  // A deactivated account is recognised even if the rest of the answer is odd.
  if (profile.status === "deactivated") return { kind: "deactivated" };
  if (profile.status !== "active" || !isRole(profile.role)) return { kind: "failed" };
  return { kind: "ready", boot: answer.data as T & { profile: BootstrapProfile } };
}

// Runs the request and turns every way it can go wrong into "failed". The
// Supabase client reports network errors as `error`, but a thrown request must
// not leave the shell waiting forever either.
export async function runBootstrap<T>(call: () => PromiseLike<Answer>): Promise<BootstrapOutcome<T>> {
  try {
    return interpretBootstrap<T>(await call());
  } catch {
    return { kind: "failed" };
  }
}
