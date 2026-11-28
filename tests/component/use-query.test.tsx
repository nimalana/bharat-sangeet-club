// lib/hooks/use-query.ts: a cached read for a screen. Each test is one rule of the old hand-written version (the member
// directory's load, which is the pilot): cache first, loading only while there is nothing to show, a failure keeps the data,
// only the newest read may change anything.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readCache, setCacheOwner, writeCache } from "../../lib/cache";
import { useQuery } from "../../lib/hooks/use-query";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("useQuery", () => {
  it("starts loading with nothing, then has the data, is not loading, has not failed, and remembers the data for the next visit", async () => {
    setCacheOwner("u-1");
    const gate = deferred<string[]>();
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load: () => gate.promise }));
    expect(result.current).toMatchObject({ data: undefined, loading: true, failed: false });
    await act(async () => { gate.resolve(["a", "b"]); });
    expect(result.current).toMatchObject({ data: ["a", "b"], loading: false, failed: false });
    expect(readCache("u-1", "k")).toEqual(["a", "b"]);
  });

  it("with a remembered read, shows it at once and is not loading, still reads, and replaces it with the new read", async () => {
    setCacheOwner("u-1");
    writeCache("u-1", "k", ["old"]);
    const gate = deferred<string[]>();
    const load = vi.fn(() => gate.promise);
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load }));
    expect(result.current).toMatchObject({ data: ["old"], loading: false, failed: false });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(["new"]); });
    expect(result.current.data).toEqual(["new"]);
    expect(readCache("u-1", "k")).toEqual(["new"]);
  });

  it("another person's remembered read is never shown", async () => {
    setCacheOwner("u-1");
    writeCache("u-1", "k", ["mine"]);
    setCacheOwner("u-2");
    const { result } = renderHook(() => useQuery({ userId: "u-2", key: "k", load: () => new Promise<string[]>(() => {}) }));
    expect(result.current).toMatchObject({ data: undefined, loading: true });
  });

  it("a first read that fails: no data, no longer loading, failed, onError called once with the error, nothing remembered", async () => {
    setCacheOwner("u-1");
    const boom = new Error("boom");
    const onError = vi.fn();
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load: () => Promise.reject(boom), onError }));
    await flush();
    expect(result.current).toMatchObject({ data: undefined, loading: false, failed: true });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(readCache("u-1", "k")).toBeUndefined();
  });

  it("a refresh that fails keeps the data on screen and the remembered read as it was, and a good read after it clears the failure", async () => {
    setCacheOwner("u-1");
    const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(["a"]).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(["a", "b"]);
    const onError = vi.fn();
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load, onError }));
    await flush();
    expect(result.current.data).toEqual(["a"]);
    await act(async () => { await result.current.refetch(); });
    expect(result.current).toMatchObject({ data: ["a"], loading: false, failed: true });
    expect(readCache("u-1", "k")).toEqual(["a"]);
    expect(onError).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.refetch(); });
    expect(result.current).toMatchObject({ data: ["a", "b"], failed: false });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("of two overlapping reads only the newest may change anything: an older answer arriving last is dropped, and so is an older failure", async () => {
    setCacheOwner("u-1");
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const third = deferred<string[]>();
    const load = vi.fn<() => Promise<string[]>>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const onError = vi.fn();
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load, onError }));
    let again!: Promise<void>;
    act(() => { again = result.current.refetch(); });
    await act(async () => { second.resolve(["newest"]); await again; });
    expect(result.current.data).toEqual(["newest"]);
    await act(async () => { first.resolve(["stale"]); });
    expect(result.current.data).toEqual(["newest"]);
    expect(readCache("u-1", "k")).toEqual(["newest"]);
    let latest!: Promise<void>;
    act(() => { latest = result.current.refetch(); });
    await act(async () => { third.resolve(["third"]); await latest; });
    const late = deferred<string[]>();
    load.mockReturnValueOnce(late.promise);
    let slow!: Promise<void>;
    act(() => { slow = result.current.refetch(); });
    load.mockResolvedValueOnce(["fastest"]);
    await act(async () => { await result.current.refetch(); });
    await act(async () => { late.reject(new Error("late failure")); await slow; });
    expect(result.current).toMatchObject({ data: ["fastest"], failed: false });
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not read again when a new load or onError function is passed; refetch uses the newest ones", async () => {
    setCacheOwner("u-1");
    const first = vi.fn().mockResolvedValue("one");
    const second = vi.fn().mockResolvedValue("two");
    const { result, rerender } = renderHook(({ load }) => useQuery({ userId: "u-1", key: "k", load, onError: () => {} }), { initialProps: { load: first as () => Promise<string> } });
    await flush();
    rerender({ load: second as () => Promise<string> });
    rerender({ load: second as () => Promise<string> });
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    await act(async () => { await result.current.refetch(); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe("two");
  });

  it("refetch resolves only when its read has settled", async () => {
    setCacheOwner("u-1");
    const gate = deferred<string>();
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("a").mockReturnValueOnce(gate.promise);
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load }));
    await flush();
    let settled = false;
    act(() => { void result.current.refetch().then(() => { settled = true; }); });
    await flush();
    expect(settled).toBe(false);
    await act(async () => { gate.resolve("b"); });
    expect(settled).toBe(true);
    expect(result.current.data).toBe("b");
  });

  it("while disabled nothing is read and loading stays as it was; when enabled it reads", async () => {
    setCacheOwner("u-1");
    const load = vi.fn().mockResolvedValue("x");
    const { result, rerender } = renderHook(({ on }) => useQuery({ userId: "u-1", key: "k", load, enabled: on }), { initialProps: { on: false } });
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ data: undefined, loading: true });
    await act(async () => { await result.current.refetch(); });
    expect(load).not.toHaveBeenCalled();
    rerender({ on: true });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ data: "x", loading: false });
  });

  it("reads again when the key changes and writes under the new key", async () => {
    setCacheOwner("u-1");
    const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(["one"]).mockResolvedValueOnce(["two"]);
    const { result, rerender } = renderHook(({ key }) => useQuery({ userId: "u-1", key, load }), { initialProps: { key: "a" } });
    await flush();
    expect(result.current.data).toEqual(["one"]);
    rerender({ key: "b" });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(["two"]);
    expect(readCache("u-1", "a")).toEqual(["one"]);
    expect(readCache("u-1", "b")).toEqual(["two"]);
  });

  it("a new key starts from its own remembered read, or from nothing, never from the data of the key before", async () => {
    setCacheOwner("u-1");
    writeCache("u-1", "b", ["remembered b"]);
    const hold = new Promise<string[]>(() => {});
    const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(["rows of a"]).mockReturnValue(hold);
    const { result, rerender } = renderHook(({ key }) => useQuery({ userId: "u-1", key, load }), { initialProps: { key: "a" } });
    await flush();
    expect(result.current.data).toEqual(["rows of a"]);
    rerender({ key: "b" });
    expect(result.current).toMatchObject({ data: ["remembered b"], loading: false });
    rerender({ key: "c" });
    expect(result.current).toMatchObject({ data: undefined, loading: true });
    rerender({ key: "a" });
    expect(result.current).toMatchObject({ data: ["rows of a"], loading: false });
  });

  it("when the person changes, the first person's data is gone at once, whatever the key", async () => {
    setCacheOwner("u-1");
    const hold = new Promise<string[]>(() => {});
    const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(["u-1's rows"]).mockReturnValue(hold);
    const { result, rerender } = renderHook(({ userId }) => useQuery({ userId, key: "members", load }), { initialProps: { userId: "u-1" } });
    await flush();
    expect(result.current.data).toEqual(["u-1's rows"]);
    setCacheOwner("u-2");
    rerender({ userId: "u-2" });
    expect(result.current).toMatchObject({ data: undefined, loading: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a read that fails for a new key does not keep the rows of the old key", async () => {
    setCacheOwner("u-1");
    const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(["rows of a"]).mockRejectedValueOnce(new Error("boom"));
    const { result, rerender } = renderHook(({ key }) => useQuery({ userId: "u-1", key, load }), { initialProps: { key: "a" } });
    await flush();
    expect(result.current.data).toEqual(["rows of a"]);
    rerender({ key: "b" });
    await flush();
    expect(result.current).toMatchObject({ data: undefined, loading: false, failed: true });
  });

  it("an answer for the key that was left is dropped", async () => {
    setCacheOwner("u-1");
    const slowA = deferred<string[]>();
    const load = vi.fn<() => Promise<string[]>>().mockReturnValueOnce(slowA.promise).mockResolvedValueOnce(["b rows"]);
    const { result, rerender } = renderHook(({ key }) => useQuery({ userId: "u-1", key, load }), { initialProps: { key: "a" } });
    rerender({ key: "b" });
    await flush();
    await act(async () => { slowA.resolve(["a rows"]); });
    expect(result.current.data).toEqual(["b rows"]);
    expect(readCache("u-1", "a")).toBeUndefined();
  });
});
