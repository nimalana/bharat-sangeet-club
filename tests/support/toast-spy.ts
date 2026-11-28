// For tests that render a screen on its own (no shell around it) and want to read the toasts it shows through a spy.
//
// A screen that has moved onto the toast context asks `useToast()` for its `notify` instead of receiving it as a prop. Rendered
// directly, with no ToastProvider above it, that would throw. A test file that renders such screens says
//
//   vi.mock("../../components/ui/toast", async (importOriginal) => (await import("../support/toast-spy")).withToastSpy(await importOriginal()));
//   import { notifySpy } from "../support/toast-spy";      // instead of "../support/helpers"
//
// and `notifySpy()` is then both what a test passes as the `notify` prop (screens that still take it) and what `useToast()` answers
// (screens that moved), so `notify.find(...)`, `notify.toasts()` and the tone assertions read the same calls either way. In a test
// that made no spy, `useToast()` is the real one: a screen rendered through the shell still shows its toast in the real viewport.
import { afterEach } from "vitest";
import type { Notify } from "../../lib/toast";
import { notifySpy as plainNotifySpy } from "./helpers";

let target: Notify | null = null;
afterEach(() => { target = null; });

/** The `notify` a screen is given, which is also what `useToast()` answers until the test ends. */
export function notifySpy() {
  const spy = plainNotifySpy();
  target = spy;
  return spy;
}

// One function for every render, as the real notify is (screens list it in effect dependencies).
const forward: Notify = (message, tone) => target?.(message, tone);
const spyToast = { notify: forward };

/** The toast module with `useToast` answering the latest `notifySpy()` while a test has one. */
export function withToastSpy<T extends { useToast: () => { notify: Notify } }>(real: T): T {
  return { ...real, useToast: () => (target ? spyToast : real.useToast()) };
}
