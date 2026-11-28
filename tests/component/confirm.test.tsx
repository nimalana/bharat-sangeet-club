// components/ui/confirm.tsx: useConfirm() asks "are you sure?" as an awaited question, ConfirmProvider draws it on the ConfirmDialog.
// What the screens that adopt it rely on: the answer is true only on Confirm; Cancel, Escape and the backdrop are a No; focus starts
// on Cancel so Enter never confirms by accident; a destructive tone is the danger button; focus goes back to the button that asked;
// two questions are asked one after the other; a question open when the provider goes away is a No.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmProvider, useConfirm, type ConfirmOptions } from "../../components/ui/confirm";
import { expectNoSeriousViolations } from "../support/a11y";
import { ConfirmWrapper, withConfirm } from "../support/confirm";
import { focusedName, keyboardUser, tabOrder } from "../support/keyboard";

// A screen with a destructive button: the action runs only after a Yes. `ask` is what the screen asks.
function Screen({ ask, action }: { ask?: Partial<ConfirmOptions>; action: () => void }) {
  const { confirm } = useConfirm();
  const [answer, setAnswer] = useState("");
  return <div>
    <button onClick={async () => {
      const yes = await confirm({ title: "Delete this announcement?", message: "It disappears for everyone.", confirmLabel: "Delete announcement", tone: "destructive", ...ask });
      setAnswer(yes ? "yes" : "no");
      if (yes) action();
    }}>Delete</button>
    <p data-testid="answer">{answer}</p>
  </div>;
}
const asked = () => screen.queryByRole("dialog");

describe("useConfirm", () => {
  it("shows a named dialog with the question and the explanation, nothing before it is asked", async () => {
    const user = keyboardUser();
    render(withConfirm(<Screen action={() => {}} />));
    expect(asked()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this announcement?" });
    expect(dialog).toHaveAccessibleDescription("It disappears for everyone.");
    expect(screen.getByRole("button", { name: "Delete announcement" })).toBeInTheDocument();
  });

  it("resolves true on Confirm: the action runs, and the dialog is gone", async () => {
    const action = vi.fn();
    const user = keyboardUser();
    render(withConfirm(<Screen action={action} />));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Delete announcement" }));
    await waitFor(() => expect(screen.getByTestId("answer")).toHaveTextContent("yes"));
    expect(action).toHaveBeenCalledTimes(1);
    expect(asked()).toBeNull();
  });

  it("resolves false on Cancel, on Escape and on the backdrop: the action never runs", async () => {
    const action = vi.fn();
    const user = keyboardUser();
    render(withConfirm(<Screen action={action} />));
    const ask = () => user.click(screen.getByRole("button", { name: "Delete" }));
    await ask();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(asked()).toBeNull());
    await ask();
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(asked()).toBeNull());
    await ask();
    await user.click((await screen.findByRole("dialog")).parentElement!);
    await waitFor(() => expect(asked()).toBeNull());
    expect(screen.getByTestId("answer")).toHaveTextContent("no");
    expect(action).not.toHaveBeenCalled();
  });

  it("starts on Cancel, so Enter is a No; Tab then Enter on Confirm is a Yes", async () => {
    const action = vi.fn();
    const user = keyboardUser();
    render(withConfirm(<Screen action={action} />));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog");
    expect(focusedName()).toBe("Cancel");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(asked()).toBeNull());
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog");
    expect(await tabOrder(user, 1)).toEqual(["Delete announcement"]);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it("starts on Cancel for the default tone too", async () => {
    const user = keyboardUser();
    render(withConfirm(<Screen action={() => {}} ask={{ tone: "default", title: "Mark as paid?", confirmLabel: "Mark paid" }} />));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog", { name: "Mark as paid?" });
    expect(focusedName()).toBe("Cancel");
  });

  it("a destructive tone makes Confirm the danger button; the default tone keeps the primary one", async () => {
    const user = keyboardUser();
    const view = render(withConfirm(<Screen action={() => {}} />));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const danger = (await screen.findByRole("button", { name: "Delete announcement" })).className;
    view.unmount();
    render(withConfirm(<Screen action={() => {}} ask={{ tone: undefined, confirmLabel: "Delete announcement" }} />));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const primary = (await screen.findByRole("button", { name: "Delete announcement" })).className;
    expect(danger).not.toBe(primary);
    expect(danger).toContain("#8b2832");
    expect(primary).toContain("bg-[var(--ink)]");
  });

  it("says Confirm when no label is given", async () => {
    const user = keyboardUser();
    render(withConfirm(<Screen action={() => {}} ask={{ confirmLabel: undefined }} />));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("returns the focus to the button that asked", async () => {
    const user = keyboardUser();
    render(withConfirm(<Screen action={() => {}} />));
    const button = screen.getByRole("button", { name: "Delete" });
    await user.click(button);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("asks two questions that came together one after the other, in order", async () => {
    const seen: boolean[] = [];
    function Two() {
      const { confirm } = useConfirm();
      return <button onClick={() => {
        void confirm({ title: "First?", message: "one" }).then((yes) => seen.push(yes));
        void confirm({ title: "Second?", message: "two" }).then((yes) => seen.push(yes));
      }}>Ask both</button>;
    }
    const user = keyboardUser();
    render(withConfirm(<Two />));
    await user.click(screen.getByRole("button", { name: "Ask both" }));
    await screen.findByRole("dialog", { name: "First?" });
    expect(screen.queryByRole("dialog", { name: "Second?" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("dialog", { name: "Second?" });
    expect(focusedName()).toBe("Cancel");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(seen).toEqual([true, false]));
    expect(asked()).toBeNull();
  });

  it("a question that is open when the provider goes away is a No", async () => {
    const answers: boolean[] = [];
    function Ask() {
      const { confirm } = useConfirm();
      return <button onClick={() => { void confirm({ title: "Still there?", message: "m" }).then((yes) => answers.push(yes)); }}>Ask</button>;
    }
    const user = keyboardUser();
    const view = render(<ConfirmProvider><Ask /></ConfirmProvider>);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByRole("dialog");
    view.unmount();
    await waitFor(() => expect(answers).toEqual([false]));
  });

  it("confirm is the same function on every render, also after a question was asked and answered (screens list it in effect dependencies)", async () => {
    const seen = new Set<unknown>();
    function Probe() {
      const { confirm } = useConfirm();
      seen.add(confirm);
      const [, force] = useState(0);
      return <><button onClick={() => force((n) => n + 1)}>again</button><button onClick={() => { void confirm({ title: "Sure?", message: "m" }); }}>ask</button></>;
    }
    const user = keyboardUser();
    render(withConfirm(<Probe />));
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    await user.click(screen.getByRole("button", { name: "ask" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(asked()).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    expect(seen.size).toBe(1);
  });

  it("outside a ConfirmProvider it says so instead of silently confirming", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Screen action={() => {}} />)).toThrow("useConfirm must be used inside a ConfirmProvider");
    spy.mockRestore();
  });

  it("has no serious accessibility violation while it is asking", async () => {
    const user = keyboardUser();
    const view = render(<Screen action={() => {}} />, { wrapper: ConfirmWrapper });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog");
    await expectNoSeriousViolations(view.baseElement);
  });
});
