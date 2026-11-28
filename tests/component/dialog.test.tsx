// components/ui/dialog.tsx, the one modal every dialog of the portal is built on, and the two dialogs that wrap it
// (ConfirmDialog, FormDialog). What each test protects is written in its name. Phase 3.4 (P3-11) asks of every modal:
// a role and a name, focus that goes in and stays in (Tab and Shift+Tab wrap), Escape, and focus that goes back to where it was.
// Colour contrast is not checked here (jsdom cannot compute it; see tests/support/a11y.ts).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Dialog } from "../../components/ui/dialog";
import { FormDialog } from "../../components/ui/form-dialog";
import { expectNoSeriousViolations } from "../support/a11y";
import { focusedName, keyboardUser, tabOrder } from "../support/keyboard";

// A page with an opener button, the dialog, a button beside it and a live region (the toasts), as the shell has.
function Page({ children = <><h2>Edit the date</h2><button>First</button><button>Second</button></>, ...props }: Partial<React.ComponentProps<typeof Dialog>> & { startOpen?: boolean }) {
  const [open, setOpen] = useState(props.startOpen ?? false);
  return <div>
    <main>
      <button onClick={() => setOpen(true)}>Open it</button>
      <section><p>Page text</p><a href="/elsewhere">A link on the page</a></section>
      <Dialog {...props} open={open} onClose={() => { props.onClose?.(); setOpen(false); }}>{children}</Dialog>
      <div aria-live="polite" data-testid="live" />
    </main>
    <footer>Footer</footer>
  </div>;
}
const closeSpy = () => vi.fn<() => void>();
const dialog = () => screen.queryByRole("dialog");

describe("Dialog: what it is", () => {
  it("renders nothing while closed and a labelled modal dialog while open", () => {
    render(<Page />);
    expect(dialog()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    const open = screen.getByRole("dialog", { name: "Edit the date" });
    expect(open).toHaveAttribute("aria-modal", "true");
  });

  it("is named by labelledBy, by label, or by its first heading, in that order", () => {
    const { unmount } = render(<Page startOpen labelledBy="mine"><h2>Other heading</h2><p id="mine">The named one</p></Page>);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("The named one");
    unmount();
    const second = render(<Page startOpen label="Confirm things"><h2>Heading</h2></Page>);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Confirm things");
    second.unmount();
    render(<Page startOpen><h3>The heading names it</h3><button>x</button></Page>);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("The heading names it");
  });

  it("describedBy points at the text that explains it", () => {
    render(<Page startOpen label="Delete" describedBy="why"><p id="why">This cannot be undone.</p></Page>);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("This cannot be undone.");
  });

  it("has no serious accessibility violation (named, with buttons)", async () => {
    const { container } = render(<Page startOpen />);
    await expectNoSeriousViolations(container);
  });
});

describe("Dialog: focus", () => {
  it("moves focus into the dialog when it opens: the first control", async () => {
    const user = keyboardUser();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open it" }));
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("honours initialFocus, and leaves a field that took the focus itself (autoFocus) alone", () => {
    function WithRef() {
      const ref = useRef<HTMLButtonElement>(null);
      return <Dialog open onClose={() => {}} initialFocus={ref}><h2>Pick</h2><button>First</button><button ref={ref}>Cancel</button></Dialog>;
    }
    const first = render(<WithRef />);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    first.unmount();
    // eslint-disable-next-line jsx-a11y/no-autofocus
    render(<Dialog open onClose={() => {}}><h2>Field</h2><button>First</button><input aria-label="Reason" autoFocus /></Dialog>);
    expect(screen.getByLabelText("Reason")).toHaveFocus();
  });

  it("focuses the dialog itself when it has nothing to focus", () => {
    render(<Dialog open onClose={() => {}} label="Notice"><p>Just words</p></Dialog>);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("Tab and Shift+Tab stay inside: they wrap from the last control to the first and back", async () => {
    const user = keyboardUser();
    render(<Page startOpen><h2>Edit</h2><button>Alpha</button><input aria-label="Beta" /><button>Gamma</button></Page>);
    expect(focusedName()).toBe("Alpha");
    expect(await tabOrder(user, 5)).toEqual(["Beta", "Gamma", "Alpha", "Beta", "Gamma"]);
    expect(await tabOrder(user, 3, { shift: true })).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("a disabled control is skipped by the trap", async () => {
    const user = keyboardUser();
    render(<Page startOpen><h2>Edit</h2><button>Alpha</button><button disabled>Never</button><button>Omega</button></Page>);
    expect(await tabOrder(user, 3)).toEqual(["Omega", "Alpha", "Omega"]);
  });

  it("pulls a focus that got outside the dialog back in on the next Tab", async () => {
    const user = keyboardUser();
    render(<Page startOpen />);
    (screen.getByRole("link", { name: "A link on the page" }) as HTMLElement).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    (screen.getByRole("link", { name: "A link on the page" }) as HTMLElement).focus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
  });

  it("with no control at all Tab keeps the focus on the panel", async () => {
    const user = keyboardUser();
    render(<Dialog open onClose={() => {}} label="Notice"><p>Just words</p></Dialog>);
    await user.tab();
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("returns focus to the element that opened it when it closes", async () => {
    const user = keyboardUser();
    render(<Page />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await user.click(opener);
    expect(dialog()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("returns focus to the opener when it is closed by a button inside it, and does nothing if the opener is gone", async () => {
    function Gone() {
      const [stage, setStage] = useState<"closed" | "open" | "removed">("closed");
      return <div>
        {stage !== "removed" && <button onClick={() => setStage("open")}>Open it</button>}
        <Dialog open={stage === "open"} onClose={() => setStage("closed")}><h2>Edit</h2><button onClick={() => setStage("removed")}>Remove and close</button></Dialog>
      </div>;
    }
    const user = keyboardUser();
    render(<Gone />);
    await user.click(screen.getByRole("button", { name: "Open it" }));
    await user.click(screen.getByRole("button", { name: "Remove and close" }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Dialog: Escape and the backdrop", () => {
  it("Escape closes it, once", async () => {
    const onClose = closeSpy();
    const user = keyboardUser();
    render(<Page startOpen onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("Escape on the document (what a test or a script sends) closes it too", () => {
    const onClose = closeSpy();
    render(<Page startOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does nothing when another handler already used it, or while an input method is composing", () => {
    const onClose = closeSpy();
    render(<Page startOpen onClose={onClose} />);
    const used = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    used.preventDefault();
    document.dispatchEvent(used);
    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismissible={false}: neither Escape nor the backdrop closes it", async () => {
    const onClose = closeSpy();
    const user = keyboardUser();
    render(<Page startOpen onClose={onClose} dismissible={false} />);
    await user.keyboard("{Escape}");
    await user.click(dialog()!.parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("a click on the backdrop closes it; a click inside the panel does not", async () => {
    const onClose = closeSpy();
    const user = keyboardUser();
    render(<Page startOpen onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Second" }));
    await user.click(screen.getByRole("heading", { name: "Edit the date" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(dialog()!.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a press that starts inside the panel and ends on the backdrop (a selection drag) is not a click on the backdrop", () => {
    const onClose = closeSpy();
    render(<Page startOpen onClose={onClose} />);
    const backdrop = dialog()!.parentElement!;
    fireEvent.mouseDown(screen.getByRole("heading", { name: "Edit the date" }));
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closeOnBackdrop={false} ignores the backdrop but Escape still closes it", async () => {
    const onClose = closeSpy();
    const user = keyboardUser();
    render(<Page startOpen onClose={onClose} closeOnBackdrop={false} />);
    await user.click(dialog()!.parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with two open only the topmost answers Escape and Tab", async () => {
    const outer = closeSpy();
    const inner = closeSpy();
    const user = keyboardUser();
    render(<>
      <Dialog open onClose={outer} label="Outer"><button>Outer one</button></Dialog>
      <Dialog open onClose={inner} label="Inner"><button>Inner one</button><button>Inner two</button></Dialog>
    </>);
    await user.keyboard("{Escape}");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect(await tabOrder(user, 3)).toEqual(["Inner two", "Inner one", "Inner two"]);
  });

  it("stops listening when it closes or goes away: Escape afterwards calls nothing", () => {
    const onClose = closeSpy();
    const view = render(<Dialog open onClose={onClose} label="Gone"><button>x</button></Dialog>);
    view.rerender(<Dialog open={false} onClose={onClose} label="Gone"><button>x</button></Dialog>);
    fireEvent.keyDown(document, { key: "Escape" });
    view.rerender(<Dialog open onClose={onClose} label="Again"><button>x</button></Dialog>);
    view.unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls the latest onClose, not the one it had when it opened", () => {
    const first = closeSpy();
    const second = closeSpy();
    const view = render(<Dialog open onClose={first} label="Latest"><button>x</button></Dialog>);
    view.rerender(<Dialog open onClose={second} label="Latest"><button>x</button></Dialog>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog: the page behind", () => {
  it("locks the page scroll while open and gives it back as it was, also when it was set before", () => {
    document.documentElement.style.overflow = "scroll";
    const view = render(<Dialog open onClose={() => {}} label="Lock"><button>x</button></Dialog>);
    expect(document.documentElement.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.documentElement.style.overflow).toBe("scroll");
    document.documentElement.style.overflow = "";
  });

  it("two dialogs unlock the page only when both are closed", () => {
    const view = render(<><Dialog open onClose={() => {}} label="A"><button>a</button></Dialog><Dialog open onClose={() => {}} label="B"><button>b</button></Dialog></>);
    view.rerender(<><Dialog open={false} onClose={() => {}} label="A"><button>a</button></Dialog><Dialog open onClose={() => {}} label="B"><button>b</button></Dialog></>);
    expect(document.documentElement.style.overflow).toBe("hidden");
    view.rerender(<><Dialog open={false} onClose={() => {}} label="A"><button>a</button></Dialog><Dialog open={false} onClose={() => {}} label="B"><button>b</button></Dialog></>);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("makes the rest of the page inert while open (not the dialog, not a live region) and restores it on close", async () => {
    const user = keyboardUser();
    render(<Page />);
    const main = screen.getByRole("main");
    const footer = document.querySelector("footer")!;
    expect(main.querySelectorAll("[inert]")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Open it" }));
    expect(screen.getByRole("button", { name: "Open it", hidden: true })).toHaveAttribute("inert");
    expect(main.querySelector("section")).toHaveAttribute("inert");
    expect(footer).toHaveAttribute("inert");
    expect(dialog()!.closest("[inert]")).toBeNull();
    expect(screen.getByTestId("live")).not.toHaveAttribute("inert");
    expect(main).not.toHaveAttribute("inert");
    await user.keyboard("{Escape}");
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });

  it("leaves alone what was inert before, and a second dialog does not release what the first still holds", () => {
    function Two({ first, second }: { first: boolean; second: boolean }) {
      return <div><p data-testid="was" inert>Already inert</p><p data-testid="plain">Plain</p>
        <Dialog open={first} onClose={() => {}} label="One"><button>one</button></Dialog>
        <Dialog open={second} onClose={() => {}} label="Two"><button>two</button></Dialog></div>;
    }
    const view = render(<Two first second />);
    expect(screen.getByTestId("plain")).toHaveAttribute("inert");
    view.rerender(<Two first second={false} />);
    expect(screen.getByTestId("plain")).toHaveAttribute("inert");
    view.rerender(<Two first={false} second={false} />);
    expect(screen.getByTestId("plain")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("was")).toHaveAttribute("inert");
  });

  it("a toast announced from inside an open dialog is still reachable (the live region is not inert)", () => {
    render(<Page startOpen />);
    const live = screen.getByTestId("live");
    act(() => { live.textContent = "It failed"; });
    expect(live).toHaveTextContent("It failed");
    expect(live.closest("[inert]")).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  const confirm = (props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) => render(
    <ConfirmDialog open title="Delete this meeting?" confirmLabel="Delete meeting" danger onConfirm={props.onConfirm ?? (() => {})} onCancel={props.onCancel ?? (() => {})} {...props}>
      The attendance marks of this meeting go with it.
    </ConfirmDialog>);

  it("is a named, described dialog with Cancel focused first", () => {
    confirm();
    const open = screen.getByRole("dialog", { name: "Delete this meeting?" });
    expect(open).toHaveAccessibleDescription("The attendance marks of this meeting go with it.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("Cancel is focused even when the explanation holds a link that comes first in the page order", () => {
    render(<ConfirmDialog open title="Leave the group?" confirmLabel="Leave" onConfirm={() => {}} onCancel={() => {}}>See <a href="/rules">the rules</a> first.</ConfirmDialog>);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("Escape and the backdrop cancel; Enter on the focused Cancel does not confirm", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = keyboardUser();
    confirm({ onConfirm, onCancel });
    await user.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("while busy neither Escape nor the backdrop cancels, and both buttons are disabled", async () => {
    const onCancel = vi.fn();
    const user = keyboardUser();
    confirm({ busy: true, onCancel });
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });

  it("has no serious accessibility violation", async () => {
    const { container } = confirm();
    await expectNoSeriousViolations(container);
  });
});

describe("FormDialog", () => {
  const form = (props: Partial<React.ComponentProps<typeof FormDialog>> = {}) => render(
    <FormDialog open title="Void this payment" description="Say why it is being voided." submitLabel="Void payment" danger
      fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]} onSubmit={props.onSubmit ?? (() => {})} onCancel={props.onCancel ?? (() => {})} {...props} />);

  it("is a named, described dialog with its fields labelled", async () => {
    const { container } = form();
    expect(screen.getByRole("dialog", { name: "Void this payment" })).toHaveAccessibleDescription("Say why it is being voided.");
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });

  it("a form is not closed by a click beside it (what was typed would be lost), but Escape and Cancel close it", async () => {
    const onCancel = vi.fn();
    const user = keyboardUser();
    form({ onCancel });
    await user.type(screen.getByLabelText("Reason"), "Duplicate");
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Reason")).toHaveValue("Duplicate");
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("with no fields (a plain confirmation) the backdrop cancels", async () => {
    const onCancel = vi.fn();
    const user = keyboardUser();
    form({ fields: [], onCancel });
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("submitting sends the trimmed values, and while busy Escape does not close it", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const user = keyboardUser();
    const view = form({ onSubmit, onCancel });
    await user.type(screen.getByLabelText("Reason"), "  Duplicate entry  ");
    await user.click(screen.getByRole("button", { name: "Void payment" }));
    expect(onSubmit).toHaveBeenCalledWith({ reason: "Duplicate entry" });
    view.unmount();
    form({ busy: true, onCancel });
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Working…" })).toBeDisabled();
  });
});
