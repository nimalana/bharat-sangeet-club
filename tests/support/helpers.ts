// Small helpers shared by the component tests.
import type { User } from "@supabase/supabase-js";
import { act } from "@testing-library/react";
import { vi } from "vitest";

/** A signed-in user as the screens receive it. */
export const userOf = (id = "user-1", email = `${id}@x.test`) =>
  ({ id, email, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" }) as User;

// The spy for the toasts a screen shows (useToast() answers it): see tests/support/toast-spy.ts.
export { notifySpy } from "./toast-spy";

/** Moves the fake clock and lets the promises that were waiting on it run (use with vi.useFakeTimers()). */
export async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Lets already-resolved promises run, without moving any clock. */
export async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
