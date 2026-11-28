// Phase 3.1 "feedback and states": the pieces a screen uses so that a failed load is not an empty page, a loading screen has a shape,
// and a button that sends something cannot send it twice. Each section says what a screen is promised.
//   - ErrorBlock: Try again, announced when asked, disabled while trying (the markup without those is what ui-blocks.test.tsx pins).
//   - SkeletonRows / Skeleton: bars hidden from assistive technology, one polite "Loading" status, a count of rows.
//   - useQuery: `error` and `retry()` for a failed first read; the rest of the hook is in use-query.test.tsx, unchanged.
//   - Button `pending`: disabled, aria-busy, looks as disabled does, cannot be pressed.
//   - useAsyncAction `exclusive`: a second press while the first runs does nothing.
//   - The pattern for a form: pending while it runs, the typed values kept on a failure, the failure toast stays.
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState, type FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../../components/ui/button";
import { ErrorBlock } from "../../components/ui/error-block";
import { Skeleton, SkeletonRows } from "../../components/ui/skeleton";
import { ToastProvider, ToastViewport, useToast } from "../../components/ui/toast";
import { setCacheOwner, writeCache } from "../../lib/cache";
import { ApiError } from "../../lib/errors";
import { useAsyncAction } from "../../lib/hooks/use-async-action";
import { useQuery } from "../../lib/hooks/use-query";
import { expectNoSeriousViolations } from "../support/a11y";
import { keyboardUser } from "../support/keyboard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("ErrorBlock", () => {
  it("offers Try again and calls onRetry", () => {
    const onRetry = vi.fn();
    render(<ErrorBlock message="The members could not be loaded." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("is announced as an alert when asked to be", () => {
    render(<ErrorBlock message="The members could not be loaded." onRetry={() => {}} role="alert" />);
    expect(screen.getByRole("alert")).toHaveTextContent("The members could not be loaded.");
  });

  it("while the retry is running the button is disabled and busy, and does not call onRetry again", () => {
    const onRetry = vi.fn();
    render(<ErrorBlock message="Nope." onRetry={onRetry} busy />);
    const button = screen.getByRole("button", { name: "Try again" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("has no serious accessibility violation", async () => {
    const { container } = render(<ErrorBlock message="The members could not be loaded." onRetry={() => {}} role="alert" />);
    await expectNoSeriousViolations(container);
  });
});

describe("SkeletonRows and Skeleton", () => {
  it("draws the asked number of bars, all hidden from assistive technology, and says Loading once, politely", () => {
    const { container } = render(<SkeletonRows rows={4} />);
    expect(container.querySelectorAll(".skeleton")).toHaveLength(4);
    expect(container.querySelector(".skeleton")!.closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(screen.getByRole("status").closest("[aria-hidden='true']")).toBeNull();
  });

  it("three bars by default, and the label can say what is loading", () => {
    const { container } = render(<SkeletonRows label="Loading the members" className="roster" />);
    expect(container.querySelectorAll(".skeleton")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the members");
    expect(container.firstElementChild).toHaveClass("roster");
  });

  it("one Skeleton is a hidden bar that takes the class given to size it", () => {
    const { container } = render(<Skeleton className="h-4 w-40" />);
    expect(container.firstElementChild).toHaveClass("skeleton", "h-4", "w-40");
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("has no serious accessibility violation", async () => {
    const { container } = render(<SkeletonRows rows={2} />);
    await expectNoSeriousViolations(container);
  });
});

describe("useQuery: error and retry", () => {
  it("a first read that fails exposes the error it threw", async () => {
    setCacheOwner("u-1");
    const boom = new ApiError("The members table is down");
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load: () => Promise.reject(boom) }));
    expect(result.current.error).toBeUndefined();
    await flush();
    expect(result.current).toMatchObject({ data: undefined, loading: false, failed: true });
    expect(result.current.error).toBe(boom);
  });

  it("retry() shows loading again at once (nothing to show yet), clears the error, and ends with the data", async () => {
    setCacheOwner("u-1");
    const gate = deferred<string[]>();
    const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error("first")).mockReturnValueOnce(gate.promise);
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load }));
    await flush();
    expect(result.current.failed).toBe(true);
    let retrying!: Promise<void>;
    act(() => { retrying = result.current.retry(); });
    expect(result.current).toMatchObject({ data: undefined, loading: true, failed: false, error: undefined });
    await act(async () => { gate.resolve(["a"]); await retrying; });
    expect(result.current).toMatchObject({ data: ["a"], loading: false, failed: false, error: undefined });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retry() resolves only when the read has settled", async () => {
    setCacheOwner("u-1");
    const gate = deferred<string[]>();
    const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error("first")).mockReturnValueOnce(gate.promise);
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load }));
    await flush();
    let settled = false;
    act(() => { void result.current.retry().then(() => { settled = true; }); });
    await flush();
    expect(settled).toBe(false);
    await act(async () => { gate.resolve(["a"]); });
    expect(settled).toBe(true);
  });

  it("retry() that fails again is a failure again, with the new error", async () => {
    setCacheOwner("u-1");
    const second = new Error("second");
    const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error("first")).mockRejectedValueOnce(second);
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load }));
    await flush();
    await act(async () => { await result.current.retry(); });
    expect(result.current).toMatchObject({ data: undefined, loading: false, failed: true });
    expect(result.current.error).toBe(second);
  });

  it("a failed refresh keeps the rows; retry() keeps them on screen while it tries and does not show loading", async () => {
    setCacheOwner("u-1");
    writeCache("u-1", "k", ["old"]);
    const gate = deferred<string[]>();
    const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error("refresh failed")).mockReturnValueOnce(gate.promise);
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load }));
    await flush();
    expect(result.current).toMatchObject({ data: ["old"], failed: true, loading: false });
    let retrying!: Promise<void>;
    act(() => { retrying = result.current.retry(); });
    expect(result.current).toMatchObject({ data: ["old"], failed: false, loading: false });
    await act(async () => { gate.resolve(["new"]); await retrying; });
    expect(result.current).toMatchObject({ data: ["new"], failed: false });
  });

  it("a good read after a failure clears the error without a retry (a poll, a refetch)", async () => {
    setCacheOwner("u-1");
    const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error("first")).mockResolvedValueOnce(["a"]);
    const { result } = renderHook(() => useQuery({ userId: "u-1", key: "k", load }));
    await flush();
    expect(result.current.error).toBeInstanceOf(Error);
    await act(async () => { await result.current.refetch(); });
    expect(result.current).toMatchObject({ data: ["a"], failed: false, error: undefined });
  });

  it("a screen draws the error with Try again for a failed first read, and the data after the retry", async () => {
    setCacheOwner("u-1");
    const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error("first")).mockResolvedValueOnce(["Asha Rao"]);
    function Roster() {
      const { data, loading, failed, retry } = useQuery({ userId: "u-1", key: "roster", load });
      if (failed && data === undefined) return <ErrorBlock message="The roster could not be loaded." onRetry={() => void retry()} role="alert" />;
      if (loading) return <SkeletonRows label="Loading the roster" />;
      return <ul>{data?.map((name) => <li key={name}>{name}</li>)}</ul>;
    }
    render(<Roster />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The roster could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Button pending", () => {
  it("is disabled and busy, looks as a disabled button does, and ignores a click", () => {
    const onClick = vi.fn();
    render(<><Button pending onClick={onClick}>Save</Button><Button disabled>Other</Button></>);
    const pending = screen.getByRole("button", { name: "Save" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending.className).toBe(screen.getByRole("button", { name: "Other" }).className.replace(/\s+/g, " "));
    fireEvent.click(pending);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("without pending it is the button it was: enabled, no aria-busy, and a disabled one stays disabled", () => {
    render(<><Button>Save</Button><Button disabled pending={false}>Off</Button></>);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button", { name: "Off" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Off" })).not.toHaveAttribute("aria-busy");
  });
});

describe("useAsyncAction exclusive", () => {
  it("a second run while the first is running does nothing: no call, no toast, and the outcome says skipped", async () => {
    const notify = vi.fn();
    const gate = deferred<string>();
    const action = vi.fn(() => gate.promise);
    const { result } = renderHook(() => useAsyncAction(notify, { exclusive: true }));
    let first!: Promise<unknown>;
    let second: unknown;
    act(() => {
      first = result.current.run(action, { success: "Saved" });
      void result.current.run(action, { success: "Saved" }).then((outcome) => { second = outcome; });
    });
    await flush();
    expect(action).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ ok: false, error: undefined, message: "", skipped: true });
    await act(async () => { gate.resolve("done"); await first; });
    expect(notify.mock.calls).toEqual([["Saved"]]);
    expect(result.current.pending).toBe(false);
    await act(async () => { await result.current.run(() => Promise.resolve(1), { success: "Again" }); });
    expect(notify).toHaveBeenLastCalledWith("Again");
  });

  it("without exclusive overlapping runs still both run (a list of rows sharing one hook)", async () => {
    const action = vi.fn(() => Promise.resolve(1));
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => { await Promise.all([result.current.run(action), result.current.run(action)]); });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("a double click on a Button wired in one line sends one request", async () => {
    const gate = deferred<void>();
    const send = vi.fn(() => gate.promise);
    function Wired() {
      const save = useAsyncAction(undefined, { exclusive: true });
      return <Button pending={save.pending} onClick={() => save.run(send)}>Save</Button>;
    }
    render(<Wired />);
    const button = screen.getByRole("button", { name: "Save" });
    act(() => { button.click(); button.click(); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => { gate.resolve(); });
    expect(button).toBeEnabled();
  });
});

// The pattern the screens follow (docs/UI_PATTERNS.md, "Forms"): the button is pending while the request runs, the person's input is
// still there when it fails, the failure toast stays, and only a success clears the form.
describe("a form: pending, the values kept on a failure, the failure toast stays", () => {
  function Form({ save }: { save: () => Promise<void> }) {
    const { notify } = useToast();
    const action = useAsyncAction(notify, { exclusive: true });
    const [title, setTitle] = useState("");
    async function submit(event: FormEvent) {
      event.preventDefault();
      const outcome = await action.run(save, { fallback: "The announcement could not be saved.", success: "Announcement saved" });
      if (outcome.ok) setTitle("");
    }
    return <form onSubmit={submit}>
      <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <Button type="submit" pending={action.pending}>Save</Button>
    </form>;
  }
  const app = (save: () => Promise<void>) => render(<ToastProvider><Form save={save} /><ToastViewport /></ToastProvider>);

  it("a failure keeps what was typed, re-enables the button, and its toast is still there a minute later", async () => {
    vi.useFakeTimers();
    const user = keyboardUser({ fakeTimers: true });
    const gate = deferred<void>();
    app(() => gate.promise);
    await user.type(screen.getByLabelText("Title"), "Fall concert");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await act(async () => { gate.reject(new ApiError("Only executives can post announcements")); });
    expect(screen.getByLabelText("Title")).toHaveValue("Fall concert");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Only executives can post announcements");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Only executives can post announcements");
  });

  it("a success clears the form and shows a confirmation that fades", async () => {
    vi.useFakeTimers();
    const user = keyboardUser({ fakeTimers: true });
    app(() => Promise.resolve());
    await user.type(screen.getByLabelText("Title"), "Fall concert");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue(""));
    expect(screen.getByRole("status")).toHaveTextContent("Announcement saved");
    await act(async () => { await vi.advanceTimersByTimeAsync(2800); });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
