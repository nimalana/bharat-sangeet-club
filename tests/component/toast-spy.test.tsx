// tests/support/toast-spy.ts: the helper that lets a test read the toasts of a screen rendered on its own. Its three promises:
// notifySpy() is what useToast() answers; without a spy the real toast is used (a screen in the shell still shows its toast in the
// viewport); and the spy is forgotten when the test ends.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, ToastViewport, useToast } from "../../components/ui/toast";
import { notifySpy } from "../support/toast-spy";

vi.mock("../../components/ui/toast", async (importOriginal) => (await import("../support/toast-spy")).withToastSpy(await importOriginal()));

let seen: unknown[] = [];
function Screen() {
  const { notify } = useToast();
  seen.push(notify);
  return <button onClick={() => notify("Saved")}>save</button>;
}

describe("notifySpy and useToast", () => {
  it("a screen rendered on its own, with no provider, notifies the spy", () => {
    const notify = notifySpy();
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(notify.toasts()).toEqual([{ message: "Saved", tone: undefined }]);
  });

  it("the function it answers is the same on every render (screens list it in effect dependencies)", () => {
    notifySpy();
    seen = [];
    const view = render(<Screen />);
    view.rerender(<Screen />);
    expect(new Set(seen).size).toBe(1);
  });

  it("the spy of an earlier test is gone: with none made, the real provider's toast is shown", () => {
    render(<ToastProvider><Screen /><ToastViewport /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(document.querySelector(".toast")).toHaveTextContent("✓ Saved");
  });
});
