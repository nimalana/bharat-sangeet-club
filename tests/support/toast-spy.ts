// The one way a component test reads the toasts a screen shows. `notifySpy()` is re-exported by tests/support/helpers.ts; nothing
// else needs to be imported or mocked per test file.
//
// Every screen asks `useToast()` for its `notify`. Rendered on its own, with no ToastProvider above it, that would throw.
// tests/component/setup.ts mocks components/ui/toast for every test file with `withToastSpy`, so that
//
//   const notify = notifySpy();      // before rendering
//   notify.find("Saved").tone        // after: "error", "success" or undefined (untagged)
//
// makes `useToast()` answer that spy until the test ends (the setup file forgets it in afterEach). The spy keeps the toasts as
// { message, tone } in the order they were asked for, and `find` throws when there is none, so a missing toast is a clear failure.
// In a test that made no spy, `useToast()` is the real one: a screen rendered through the shell (or inside a ToastProvider the test
// renders) still shows its toast in the real viewport.
import { vi } from "vitest";
import type { Notify } from "../../lib/toast";

let target: Notify | null = null;

/** Called by the setup file after every test: the spy of a test does not leak into the next one. */
export function forgetToastSpy() { target = null; }

/** The `notify` a screen shows its toasts through for the rest of this test; `toasts()`, `messages()` and `find()` read what it was asked to show. */
export function notifySpy() {
  const spy = vi.fn<Notify>();
  target = spy;
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

// One function for every render, as the real notify is (screens list it in effect dependencies).
const forward: Notify = (message, tone) => target?.(message, tone);
const spyToast = { notify: forward };

/** The toast module with `useToast` answering the latest `notifySpy()` while a test has one. */
export function withToastSpy<T extends { useToast: () => { notify: Notify } }>(real: T): T {
  return { ...real, useToast: () => (target ? spyToast : real.useToast()) };
}
