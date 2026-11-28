// components/ui/toast.tsx: the toast every screen notifies through. The shell's use of it (the tick, the role, the length of
// stay as the person sees them) is also in shell-feedback.test.tsx and toast-tone.test.tsx; this file is the component itself.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, ToastViewport, useToast } from "../../components/ui/toast";
import type { Notify } from "../../lib/toast";

let seen: Notify[] = [];
function Probe({ message, tone, label = "go" }: { message: string; tone?: "success" | "error"; label?: string }) {
  const { notify } = useToast();
  seen.push(notify);
  return <button onClick={() => notify(message, tone)}>{label}</button>;
}
const app = (probe: React.ReactElement) => render(<ToastProvider><div id="screen">{probe}</div><ToastViewport /></ToastProvider>);
const toast = () => document.querySelector(".toast") as HTMLElement | null;

afterEach(() => { vi.useRealTimers(); seen = []; });

describe("ToastProvider and useToast", () => {
  it("a message with no tone is a status with the tick, in the toast block", () => {
    app(<Probe message="Saved" />);
    expect(toast()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(toast()).toHaveTextContent("✓ Saved");
    expect(toast()).toHaveAttribute("role", "status");
    expect(toast()).toHaveClass("toast", "success");
    expect(toast()!.outerHTML).toBe('<div class="toast success" role="status">✓ Saved</div>');
  });

  it("a failure is an alert without the tick, even when its words say nothing about failing", () => {
    app(<Probe message="Everything has been saved" tone="error" />);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(toast()!.outerHTML).toBe('<div class="toast error" role="alert">! Everything has been saved</div>');
  });

  it("an untagged fixed sentence that reads as a failure is shown as one (the tone rules of lib/toast.ts)", () => {
    app(<Probe message="The file could not be opened" />);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(toast()).toHaveClass("toast", "error");
  });

  it("a confirmation goes after 2.8 s and a failure after 6 s", () => {
    vi.useFakeTimers();
    const view = app(<Probe message="Saved" />);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    act(() => { vi.advanceTimersByTime(2799); });
    expect(toast()).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(toast()).toBeNull();
    view.unmount();
    app(<Probe message="No" tone="error" />);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    act(() => { vi.advanceTimersByTime(5999); });
    expect(toast()).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(toast()).toBeNull();
  });

  it("a newer toast replaces the older and takes over its timer", () => {
    vi.useFakeTimers();
    function Two() {
      const { notify } = useToast();
      return <><button onClick={() => notify("First")}>one</button><button onClick={() => notify("Second")}>two</button></>;
    }
    app(<Two />);
    fireEvent.click(screen.getByRole("button", { name: "one" }));
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(screen.getByRole("button", { name: "two" }));
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
    expect(toast()).toHaveTextContent("Second");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(toast()).toHaveTextContent("Second");
    act(() => { vi.advanceTimersByTime(800); });
    expect(toast()).toBeNull();
  });

  it("notify is the same function on every render, and a toast appearing does not re-draw the screens that notify", () => {
    const drawn = vi.fn();
    function Counted() { drawn(); const { notify } = useToast(); seen.push(notify); return <button onClick={() => notify("Hi")}>count</button>; }
    app(<Counted />);
    const before = drawn.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "count" }));
    fireEvent.click(screen.getByRole("button", { name: "count" }));
    expect(toast()).not.toBeNull();
    expect(drawn.mock.calls.length).toBe(before);
    expect(new Set(seen).size).toBe(1);
  });

  it("stops its timer when it goes away: nothing is changed after unmount", () => {
    vi.useFakeTimers();
    const view = app(<Probe message="Saved" />);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(spy).not.toHaveBeenCalled();
  });

  it("useToast outside a provider says so, instead of silently dropping the message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe message="x" />)).toThrow("useToast must be used inside a ToastProvider");
    spy.mockRestore();
  });

  it("the viewport draws nothing when nothing is showing, and wherever it is placed", () => {
    render(<ToastProvider><main data-testid="shell"><Probe message="Placed" /><ToastViewport /></main></ToastProvider>);
    expect(toast()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(toast()!.parentElement).toBe(screen.getByTestId("shell"));
  });
});
