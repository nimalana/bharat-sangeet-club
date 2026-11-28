// components/ui/toast.tsx: the toast every screen notifies through. The shell's use of it (the tick, the role, the length of
// stay as the person sees them) is also in shell-feedback.test.tsx and toast-tone.test.tsx; this file is the component itself.
//
// Phase 3.1 changed three things the first version of this file pinned (each test below says which): a failure no longer fades after
// 6 s (it stays until dismissed or replaced by the next failure), toasts stack (at most 3) instead of replacing one another, and the
// viewport is a live region that is in the page before the first message.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, ToastViewport, useToast } from "../../components/ui/toast";
import type { Notify } from "../../lib/toast";
import { expectNoSeriousViolations } from "../support/a11y";
import { keyboardUser } from "../support/keyboard";

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

  // Was "a confirmation goes after 2.8 s and a failure after 6 s": a failure no longer has a time limit.
  it("a confirmation goes after 2.8 s; a failure is still there a minute later and goes when it is dismissed", () => {
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
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(toast()).toHaveTextContent("! No");
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(toast()).toBeNull();
  });

  // Was "a newer toast replaces the older and takes over its timer": confirmations now stack, each with its own timer.
  it("two confirmations stack, and each goes at its own time", () => {
    vi.useFakeTimers();
    function Two() {
      const { notify } = useToast();
      return <><button onClick={() => notify("First")}>one</button><button onClick={() => notify("Second")}>two</button></>;
    }
    app(<Two />);
    fireEvent.click(screen.getByRole("button", { name: "one" }));
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(screen.getByRole("button", { name: "two" }));
    expect(Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent)).toEqual(["✓ First", "✓ Second"]);
    act(() => { vi.advanceTimersByTime(800); });
    expect(Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent)).toEqual(["✓ Second"]);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(toast()).toBeNull();
  });

  it("the same confirmation twice is shown once, and its timer starts again", () => {
    vi.useFakeTimers();
    app(<Probe message="Saved" />);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(toast()).not.toBeNull();
    act(() => { vi.advanceTimersByTime(800); });
    expect(toast()).toBeNull();
  });

  it("a newer failure replaces the failure before it, and a confirmation does not end a failure", () => {
    vi.useFakeTimers();
    function Many() {
      const { notify } = useToast();
      return <>
        <button onClick={() => notify("First failure", "error")}>fail one</button>
        <button onClick={() => notify("Second failure", "error")}>fail two</button>
        <button onClick={() => notify("Saved")}>save</button>
      </>;
    }
    app(<Many />);
    fireEvent.click(screen.getByRole("button", { name: "fail one" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent)).toEqual(["! First failure"]);
    fireEvent.click(screen.getByRole("button", { name: "fail two" }));
    expect(Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent)).toEqual(["! Second failure"]);
    expect(screen.getAllByRole("button", { name: "Dismiss message" })).toHaveLength(1);
  });

  it("at most 3 are on screen: the oldest confirmation goes first and a failure is kept", () => {
    vi.useFakeTimers();
    function Five() {
      const { notify } = useToast();
      return <><button onClick={() => notify("The failure", "error")}>fail</button>{["A", "B", "C", "D"].map((name) => <button key={name} onClick={() => notify(`Saved ${name}`)}>{name}</button>)}</>;
    }
    app(<Five />);
    fireEvent.click(screen.getByRole("button", { name: "fail" }));
    for (const name of ["A", "B", "C", "D"]) fireEvent.click(screen.getByRole("button", { name: name }));
    expect(Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent)).toEqual(["! The failure", "✓ Saved C", "✓ Saved D"]);
    // The dropped ones left no timer behind: one timer for each confirmation still showing, none for the failure.
    expect(vi.getTimerCount()).toBe(2);
    act(() => { vi.advanceTimersByTime(2800); });
    expect(Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent)).toEqual(["! The failure"]);
    expect(vi.getTimerCount()).toBe(0);
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

  // Was "the viewport draws nothing when nothing is showing": it now draws its live region (empty) from the start, so a screen reader
  // that watches it hears the first message; the toasts are inside it, wherever it is placed.
  it("the viewport is a live region that exists before the first message, holds no toast until one is sent, and goes where it is placed", () => {
    render(<ToastProvider><main data-testid="shell"><Probe message="Placed" /><ToastViewport /></main></ToastProvider>);
    const region = screen.getByTestId("shell").querySelector(".toast-stack") as HTMLElement;
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    expect(toast()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(toast()!.closest(".toast-stack")).toBe(region);
    expect(region.parentElement).toBe(screen.getByTestId("shell"));
  });

  it("the same region element stays in the page while toasts come and go (a live region that is replaced is not announced)", () => {
    vi.useFakeTimers();
    app(<Probe message="Saved" />);
    const before = document.querySelector(".toast-stack");
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(document.querySelector(".toast-stack")).toBe(before);
  });

  it("a failure is announced as an alert and a confirmation as a status; only the failure has a Dismiss button, which is next to the alert and not part of it", () => {
    function Both() {
      const { notify } = useToast();
      return <><button onClick={() => notify("It broke", "error")}>fail</button><button onClick={() => notify("Saved")}>save</button></>;
    }
    app(<Both />);
    fireEvent.click(screen.getByRole("button", { name: "fail" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/^! It broke$/);
    expect(within(screen.getByRole("alert")).queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/^✓ Saved$/);
    expect(screen.getAllByRole("button", { name: "Dismiss message" })).toHaveLength(1);
  });

  it("the Dismiss button works from the keyboard", async () => {
    function Fail() { const { notify } = useToast(); return <button onClick={() => notify("It broke", "error")}>fail</button>; }
    app(<Fail />);
    const user = keyboardUser();
    await user.click(screen.getByRole("button", { name: "fail" }));
    await user.tab();
    expect(screen.getByRole("button", { name: "Dismiss message" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toast()).toBeNull();
  });

  it("has no serious accessibility violation with a failure and a confirmation on screen", async () => {
    function Both() {
      const { notify } = useToast();
      return <button onClick={() => { notify("It broke", "error"); notify("Saved"); }}>both</button>;
    }
    const view = app(<Both />);
    fireEvent.click(screen.getByRole("button", { name: "both" }));
    expect(document.querySelectorAll(".toast")).toHaveLength(2);
    await expectNoSeriousViolations(view.container);
  });
});
