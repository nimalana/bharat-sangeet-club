// Small helpers shared by the component tests.
import type { User } from "@supabase/supabase-js";
import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { Notify } from "../../lib/toast";

/** A signed-in user as the screens receive it. */
export const userOf = (id = "user-1", email = `${id}@x.test`) =>
  ({ id, email, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" }) as User;

/** The `notify` a screen is given. `toasts()` lists what it was asked to show, with the tone resolved the way the shell resolves it. */
export function notifySpy() {
  const spy = vi.fn<Notify>();
  return Object.assign(spy, {
    /** Every toast, as { message, tone }; tone is undefined when the caller passed none. */
    toasts: () => spy.mock.calls.map(([message, tone]) => ({ message, tone })),
    messages: () => spy.mock.calls.map(([message]) => message),
    /** The toast with exactly this message (throws if there is none, so a missing toast is a clear failure). */
    find(message: string | RegExp) {
      const hit = spy.mock.calls.find(([text]) => (typeof message === "string" ? text === message : message.test(text)));
      if (!hit) throw new Error(`no toast matching ${String(message)}; toasts were: ${JSON.stringify(spy.mock.calls.map(([text]) => text))}`);
      return { message: hit[0], tone: hit[1] };
    },
  });
}

/** Moves the fake clock and lets the promises that were waiting on it run (use with vi.useFakeTimers()). */
export async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Lets already-resolved promises run, without moving any clock. */
export async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
