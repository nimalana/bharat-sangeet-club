// The small hooks every screen shares (lib/hooks): use-async-action, use-debounced, use-polling.
// Each test names what a screen relies on; tests/component/*.test.tsx prove the screens that use them behave as before.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/errors";
import { useAsyncAction } from "../../lib/hooks/use-async-action";
import { useDebounced } from "../../lib/hooks/use-debounced";
import { usePolling } from "../../lib/hooks/use-polling";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

describe("useAsyncAction", () => {
  it("is pending from the moment run() is called until the action settles, and run() returns the value", async () => {
    const gate = deferred<string>();
    const { result } = renderHook(() => useAsyncAction());
    expect(result.current.pending).toBe(false);
    let outcome: Awaited<ReturnType<typeof result.current.run<string>>> | undefined;
    let running!: Promise<unknown>;
    act(() => { running = result.current.run(() => gate.promise).then((value) => { outcome = value; }); });
    expect(result.current.pending).toBe(true);
    await act(async () => { gate.resolve("saved"); await running; });
    expect(result.current.pending).toBe(false);
    expect(outcome).toEqual({ ok: true, value: "saved" });
    expect(result.current.error).toBe("");
  });

  it("a failure clears pending, becomes the friendly sentence in `error`, is sent to notify as an error and is returned", async () => {
    const notify = vi.fn();
    const { result } = renderHook(() => useAsyncAction(notify));
    const raw = new ApiError("Only administrators can change member roles", { code: "P0001" });
    let outcome: unknown;
    await act(async () => { outcome = await result.current.run(() => Promise.reject(raw), { fallback: "That change could not be saved." }); });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe("Only administrators can change member roles");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Only administrators can change member roles", "error");
    expect(outcome).toEqual({ ok: false, error: raw, message: "Only administrators can change member roles" });
  });

  it("a raw database message is replaced by the call's fallback, and the default fallback is used when none is given", async () => {
    const notify = vi.fn();
    const { result } = renderHook(() => useAsyncAction(notify));
    await act(async () => { await result.current.run(() => Promise.reject({ message: 'violates check constraint "x"', code: "23514" }), { fallback: "That change could not be saved." }); });
    expect(notify).toHaveBeenLastCalledWith("That change could not be saved.", "error");
    await act(async () => { await result.current.run(() => Promise.reject(new Error("syntax error at or near"))); });
    expect(notify).toHaveBeenLastCalledWith("Something went wrong. Please try again.", "error");
    await act(async () => { await result.current.run(() => Promise.reject(new TypeError("Failed to fetch"))); });
    expect(notify).toHaveBeenLastCalledWith("The connection dropped. Check your internet and try again.", "error");
  });

  it("a success sends `success` once, as a plain message (no tone), and nothing when there is no `success`", async () => {
    const notify = vi.fn();
    const { result } = renderHook(() => useAsyncAction(notify));
    await act(async () => { await result.current.run(() => Promise.resolve(1), { success: "Pinned to the top" }); });
    expect(notify.mock.calls).toEqual([["Pinned to the top"]]);
    notify.mockClear();
    await act(async () => { await result.current.run(() => Promise.resolve(1)); });
    expect(notify).not.toHaveBeenCalled();
  });

  it("uses the notify of the latest render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ notify }) => useAsyncAction(notify), { initialProps: { notify: first } });
    rerender({ notify: second });
    await act(async () => { await result.current.run(() => Promise.reject(new Error("boom"))); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("Boom", "error");
  });

  it("the next run clears the previous error, and clearError() does too", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => { await result.current.run(() => Promise.reject(new Error("first"))); });
    expect(result.current.error).toBe("First");
    const gate = deferred<void>();
    let running!: Promise<unknown>;
    act(() => { running = result.current.run(() => gate.promise); });
    expect(result.current.error).toBe("");
    await act(async () => { gate.resolve(); await running; });
    await act(async () => { await result.current.run(() => Promise.reject(new Error("second"))); });
    expect(result.current.error).toBe("Second");
    act(() => result.current.clearError());
    expect(result.current.error).toBe("");
  });

  it("two overlapping runs keep pending up until the last one settles", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const { result } = renderHook(() => useAsyncAction());
    let a!: Promise<unknown>;
    let b!: Promise<unknown>;
    act(() => { a = result.current.run(() => first.promise); b = result.current.run(() => second.promise); });
    await act(async () => { first.resolve(); await a; });
    expect(result.current.pending).toBe(true);
    await act(async () => { second.resolve(); await b; });
    expect(result.current.pending).toBe(false);
  });
});

describe("useDebounced", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("starts with the first value and follows a changed value only after it has been still for the delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 250)[0], { initialProps: { value: "" } });
    expect(result.current).toBe("");
    rerender({ value: "r" });
    act(() => { vi.advanceTimersByTime(249); });
    expect(result.current).toBe("");
    rerender({ value: "ra" });
    act(() => { vi.advanceTimersByTime(249); });
    expect(result.current).toBe("");
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe("ra");
  });

  it("runs onSettled with the settled value, in the same batch as the update, every time the wait ends (the first one after mount too)", () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    let renders = 0;
    const { result, rerender } = renderHook(({ value }) => { renders += 1; return useDebounced(value, 250, onSettled)[0]; }, { initialProps: { value: "a" } });
    act(() => { vi.advanceTimersByTime(250); });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenLastCalledWith("a");
    rerender({ value: "ab" });
    const before = renders;
    act(() => { vi.advanceTimersByTime(250); });
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenLastCalledWith("ab");
    expect(result.current).toBe("ab");
    expect(renders - before).toBe(1);
  });

  it("calls the newest onSettled, and not at all after unmount", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ cb }) => useDebounced("x", 250, cb)[0], { initialProps: { cb: first } });
    rerender({ cb: second });
    act(() => { vi.advanceTimersByTime(250); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    rerender({ cb: second });
    unmount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("setNow sets the settled value at once, and the wait that was running ends with the value it was started for", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 250), { initialProps: { value: "" } });
    rerender({ value: "organ" });
    expect(result.current[0]).toBe("");
    act(() => result.current[1]("organ"));
    expect(result.current[0]).toBe("organ");
    rerender({ value: "" });
    act(() => result.current[1](""));
    expect(result.current[0]).toBe("");
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current[0]).toBe("");
  });

  it("a change of the delay restarts the wait with the new delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value, delay }) => useDebounced(value, delay)[0], { initialProps: { value: "a", delay: 1000 } });
    rerender({ value: "b", delay: 1000 });
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ value: "b", delay: 100 });
    act(() => { vi.advanceTimersByTime(99); });
    expect(result.current).toBe("a");
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe("b");
  });
});

describe("usePolling", () => {
  const setVisibility = (state: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  afterEach(() => { vi.useRealTimers(); setVisibility("visible"); });

  it("calls back every interval while enabled and the page is visible, and not before the first interval", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 10_000, true));
    act(() => { vi.advanceTimersByTime(9_999); });
    expect(callback).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(callback).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("skips the tick while the page is hidden and calls once when it becomes visible again", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 10_000, true));
    setVisibility("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(30_000); });
    expect(callback).not.toHaveBeenCalled();
    setVisibility("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled, starts when enabled, and stops when disabled again", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { rerender } = renderHook(({ on }) => usePolling(callback, 1000, on), { initialProps: { on: false } });
    act(() => { vi.advanceTimersByTime(5000); document.dispatchEvent(new Event("visibilitychange")); });
    expect(callback).not.toHaveBeenCalled();
    rerender({ on: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(1);
    rerender({ on: false });
    act(() => { vi.advanceTimersByTime(5000); document.dispatchEvent(new Event("visibilitychange")); });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("restarts the wait when the callback changes, and calls the new one", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => usePolling(cb, 1000, true), { initialProps: { cb: first } });
    act(() => { vi.advanceTimersByTime(900); });
    rerender({ cb: second });
    act(() => { vi.advanceTimersByTime(900); });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("restarts the wait with the new interval when the interval changes", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { rerender } = renderHook(({ ms }) => usePolling(callback, ms, true), { initialProps: { ms: 10_000 } });
    rerender({ ms: 1000 });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("stops the timer and the listener on unmount", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { unmount } = renderHook(() => usePolling(callback, 1000, true));
    unmount();
    act(() => { vi.advanceTimersByTime(5000); document.dispatchEvent(new Event("visibilitychange")); });
    expect(callback).not.toHaveBeenCalled();
  });
});
