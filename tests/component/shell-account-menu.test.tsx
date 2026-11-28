// Phase 3.2: the account menu of the top bar (it replaced the one-click Sign out) and "My profile", which opens the members area's contact
// form from any page. Opened through the whole shell against the fake client.
//
//  - the button is a menu button (aria-haspopup, aria-expanded); it opens a menu with My profile and Sign out; Escape, a press outside and
//    choosing an item close it, and focus is back on the button; the arrow keys, Home and End move through the items;
//  - My profile reads the person's own row, shows the contact form (a placeholder of its height while it loads, an error with Try again if it
//    cannot), saves the four columns once however often the button is pressed, keeps the form as typed when the save fails, and shows the new
//    name in the top bar.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortalHeader } from "../../features/shell/components/portal-header";
import { expectNoSeriousViolations } from "../support/a11y";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { focusedName, keyboardUser } from "../support/keyboard";
import { openPortal } from "../support/portal";

const ownRow = { id: "u-me", full_name: "Asha Rao", email: "u-me@x.test", role: "member", phone: "919-555-0100", class_year: "2028", specialty: "Veena", joined_at: "2025-08-01" };
const accountButton = () => screen.getByRole("button", { name: /^Account menu for / });
const menu = () => screen.queryByRole("menu", { name: "Account" });
const ownReads = () => fake.from("profiles", "select").calls.filter((call) => call.used("eq", "id", "u-me"));
// The props go in as an object, so that the linter does not take the club role of PortalHeader for an ARIA role.
const headerProps = (over: Partial<ComponentProps<typeof PortalHeader>> = {}): ComponentProps<typeof PortalHeader> => ({ section: "home", role: "member", name: "Asha Rao", onNavigate: vi.fn(), onSignOut: vi.fn(), ...over });
const toasts = () => Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent);

// This person has answered the "Complete your profile" step before (shell-profile-step.test.tsx), so the reads of their row below are My profile's own.
beforeEach(() => window.localStorage.setItem("bharat-sangeet-profile-step:u-me", "done"));

async function openedPortal(name = "Asha Rao") {
  fake.from("profiles", "select").reply(ok(ownRow));
  openPortal({ name });
  await screen.findByText(new RegExp(`Welcome back, ${name}`));
}

describe("the account button", () => {
  it("is a menu button that is closed at first: it names the person, announces a menu and is not expanded", async () => {
    await openedPortal();
    expect(accountButton()).toHaveAttribute("aria-haspopup", "menu");
    expect(accountButton()).toHaveAttribute("aria-expanded", "false");
    expect(accountButton()).toHaveAccessibleName("Account menu for Asha Rao");
    expect(menu()).toBeNull();
  });

  it("opens a menu with My profile and Sign out, and says it is expanded", async () => {
    await openedPortal();
    fireEvent.click(accountButton());
    expect(accountButton()).toHaveAttribute("aria-expanded", "true");
    expect(within(menu()!).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["My profile", "Sign out"]);
    expect(accountButton()).toHaveAttribute("aria-controls", menu()!.id);
  });

  it("pressing it again closes the menu", async () => {
    await openedPortal();
    fireEvent.click(accountButton());
    fireEvent.click(accountButton());
    expect(menu()).toBeNull();
    expect(accountButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("a press outside the menu closes it; a press inside does not", async () => {
    await openedPortal();
    fireEvent.click(accountButton());
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "My profile" }));
    expect(menu()).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
  });

  it("is offered the same menu in every role, with the role named in the caption", async () => {
    fake.from("profiles", "select").reply(ok(ownRow));
    openPortal({ role: "executive", name: "Asha Rao" });
    await screen.findByText(/Welcome back/);
    expect(accountButton()).toHaveTextContent("Executive · Account");
    fireEvent.click(accountButton());
    expect(within(menu()!).getAllByRole("menuitem")).toHaveLength(2);
  });
});

describe("the keyboard", () => {
  it("Enter on the button opens the menu with the first item focused; Down and Up move and wrap; Home and End jump", async () => {
    await openedPortal();
    const user = keyboardUser();
    accountButton().focus();
    await user.keyboard("{Enter}");
    expect(focusedName()).toBe("My profile");
    await user.keyboard("{ArrowDown}");
    expect(focusedName()).toBe("Sign out");
    await user.keyboard("{ArrowDown}");
    expect(focusedName()).toBe("My profile");
    await user.keyboard("{ArrowUp}");
    expect(focusedName()).toBe("Sign out");
    await user.keyboard("{Home}");
    expect(focusedName()).toBe("My profile");
    await user.keyboard("{End}");
    expect(focusedName()).toBe("Sign out");
  });

  it("the Down arrow on the button opens it on the first item, the Up arrow on the last", async () => {
    await openedPortal();
    const user = keyboardUser();
    accountButton().focus();
    await user.keyboard("{ArrowDown}");
    expect(focusedName()).toBe("My profile");
    await user.keyboard("{Escape}");
    await user.keyboard("{ArrowUp}");
    expect(focusedName()).toBe("Sign out");
  });

  it("Escape closes the menu and puts focus back on the button", async () => {
    await openedPortal();
    const user = keyboardUser();
    accountButton().focus();
    await user.keyboard("{Enter}");
    expect(menu()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(menu()).toBeNull();
    expect(accountButton()).toHaveFocus();
  });

  it("Tab closes the menu and carries on from the button: to what comes after the button, not to the start of the page", async () => {
    await openedPortal();
    const user = keyboardUser();
    accountButton().focus();
    await user.tab();
    const afterTheButton = focusedName();
    expect(afterTheButton).not.toBe("(page)");
    accountButton().focus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(menu()).toBeNull();
    expect(focusedName()).toBe(afterTheButton);
  });

  it("choosing an item with Enter closes the menu, and Sign out signs out", async () => {
    await openedPortal();
    const user = keyboardUser();
    accountButton().focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(fake.auth("signOut").count).toBe(1);
    expect(menu()).toBeNull();
  });

  it("the whole way by keyboard: Tab reaches the button, Space opens the menu", async () => {
    await openedPortal();
    const user = keyboardUser();
    for (let step = 0; step < 20 && document.activeElement !== accountButton(); step += 1) await user.tab();
    expect(accountButton()).toHaveFocus();
    await user.keyboard(" ");
    expect(menu()).not.toBeNull();
    expect(focusedName()).toBe("My profile");
  });
});

describe("My profile", () => {
  async function openProfile() {
    fireEvent.click(accountButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "My profile" }));
    return screen.findByRole("heading", { name: "Contact information" });
  }
  const dialog = () => screen.getByRole("dialog", { name: "Contact information" });

  it("closes the menu, reads the person's own row, and shows the form with those values and the email that cannot be changed", async () => {
    await openedPortal();
    await openProfile();
    expect(menu()).toBeNull();
    expect(ownReads()).toHaveLength(1);
    expect(ownReads()[0].used("maybeSingle")).toBe(true);
    const form = within(dialog());
    await waitFor(() => expect(form.getByLabelText("Preferred name")).toHaveValue("Asha Rao"));
    expect(form.getByLabelText("Email")).toHaveValue("u-me@x.test");
    expect(form.getByLabelText("Email")).toBeDisabled();
    expect(form.getByLabelText("Phone number")).toHaveValue("919-555-0100");
    expect(form.getByLabelText("Class year")).toHaveValue("2028");
    expect(form.getByLabelText("Voice / instrument")).toHaveValue("Veena");
  });

  it("shows a placeholder of the form's height while the row is on the way, named for a screen reader", async () => {
    const slow = deferred();
    fake.from("profiles", "select").reply(slow.reply);
    openPortal();
    await screen.findByText(/Welcome back/);
    fireEvent.click(accountButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "My profile" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Loading your profile");
    expect(screen.getByRole("dialog", { name: "Contact information" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Preferred name")).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok(ownRow)); });
    expect(await screen.findByLabelText("Preferred name")).toHaveValue("Asha Rao");
  });

  it("puts the focus on the first field once the form has appeared", async () => {
    await openedPortal();
    await openProfile();
    await waitFor(() => expect(screen.getByLabelText("Preferred name")).toHaveFocus());
  });

  it("a row that cannot be read says so with Try again, in an alert; Try again shows the placeholder while it reads again, then the form", async () => {
    const again = deferred();
    fake.from("profiles", "select").replyOnce(fail("boom")).reply(again.reply);
    openPortal();
    await screen.findByText(/Welcome back/);
    await openProfile();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your profile could not be loaded.");
    expect(screen.queryByLabelText("Preferred name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your profile");
    await act(async () => { again.resolve(ok(ownRow)); });
    expect(await screen.findByLabelText("Preferred name")).toHaveValue("Asha Rao");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(ownReads()).toHaveLength(2);
  });

  it("saving sends the four columns for the person's own row, says so, closes the dialog and shows the new name in the top bar", async () => {
    await openedPortal();
    fake.from("profiles", "update").reply(ok(null));
    await openProfile();
    const form = within(dialog());
    await waitFor(() => expect(form.getByLabelText("Preferred name")).toHaveValue("Asha Rao"));
    fireEvent.change(form.getByLabelText("Preferred name"), { target: { value: "Asha R." } });
    fireEvent.change(form.getByLabelText("Phone number"), { target: { value: "919-555-0199" } });
    fireEvent.submit(form.getByLabelText("Preferred name").closest("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const [call] = fake.from("profiles", "update").calls;
    expect(call.payload).toEqual({ full_name: "Asha R.", phone: "919-555-0199", class_year: "2028", specialty: "Veena" });
    expect(call.used("eq", "id", "u-me")).toBe(true);
    expect(toasts()).toContain("✓ Your contact information was updated");
    expect(accountButton()).toHaveAccessibleName("Account menu for Asha R.");
    await waitFor(() => expect(accountButton()).toHaveFocus());   // the dialog hands the focus back when it has unmounted, a beat after it left the page
  });

  it("a double press on Save sends ONE request, and the button says Saving… and is off while it runs", async () => {
    await openedPortal();
    const slow = deferred();
    fake.from("profiles", "update").reply(slow.reply);
    await openProfile();
    const form = (await screen.findByLabelText("Preferred name")).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(fake.from("profiles", "update").calls).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.from("profiles", "update").calls).toHaveLength(1);
  });

  it("a refused save keeps the form open and as typed, shows the sentence as an error that stays, and the button works again", async () => {
    await openedPortal();
    fake.from("profiles", "update").replyOnce(fail("Phone numbers must be 10 digits")).reply(ok(null));
    await openProfile();
    const form = (await screen.findByLabelText("Preferred name")).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Phone number"), { target: { value: "12" } });
    fireEvent.submit(form);
    const toast = await screen.findByText(/Phone numbers must be 10 digits/, { selector: ".toast" });
    expect(toast).toHaveClass("error");
    expect(screen.getByRole("dialog", { name: "Contact information" })).toBeInTheDocument();
    expect(within(form).getByLabelText("Phone number")).toHaveValue("12");
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled();
    // The next try goes through.
    fireEvent.change(within(form).getByLabelText("Phone number"), { target: { value: "919-555-0100" } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.from("profiles", "update").calls).toHaveLength(2);
  });

  it("a raw database error is not shown as it is: the person is told what to do", async () => {
    await openedPortal();
    fake.from("profiles", "update").reply(fail('new row violates row-level security policy for table "profiles"'));
    await openProfile();
    fireEvent.submit((await screen.findByLabelText("Preferred name")).closest("form")!);
    expect(await screen.findByText(/^! Your contact information could not be saved\. Try again\.$/, { selector: ".toast" })).toHaveClass("error");
  });

  it("Escape and Close close it without saving, and focus goes back to the account button", async () => {
    await openedPortal();
    const user = keyboardUser();
    await openProfile();
    await screen.findByLabelText("Preferred name");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(accountButton()).toHaveFocus();
    await openProfile();
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(accountButton()).toHaveFocus();
    expect(fake.from("profiles", "update").calls).toHaveLength(0);
  });

  it("while it saves, Escape does not close it", async () => {
    await openedPortal();
    const slow = deferred();
    fake.from("profiles", "update").reply(slow.reply);
    await openProfile();
    fireEvent.submit((await screen.findByLabelText("Preferred name")).closest("form")!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Contact information" })).toBeInTheDocument();
    await act(async () => { slow.resolve(ok(null)); });
  });
});

describe("the header on its own", () => {
  const header = (props: { onOpenProfile?: () => void } = {}) => render(<PortalHeader {...headerProps(props)} />);

  it("offers only Sign out when the shell gives it nothing to open (the props of PortalHeader are as before: the new one is optional)", () => {
    header();
    fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    expect(within(menu()!).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Sign out"]);
  });

  it("calls the handlers it was given: My profile opens the profile, Sign out signs out", () => {
    const onSignOut = vi.fn(); const onOpenProfile = vi.fn();
    render(<PortalHeader {...headerProps({ role: "admin", onSignOut, onOpenProfile })} />);
    fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "My profile" }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("accessibility (axe, no serious or critical violation; colour contrast is not computed in jsdom)", () => {
  it("the top bar with the menu closed and open", async () => {
    const view = render(<PortalHeader {...headerProps({ onOpenProfile: vi.fn() })} />);
    await expectNoSeriousViolations(view.container);
    fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    await expectNoSeriousViolations(view.container);
  });

  it("the profile dialog while it loads, with the form, and when the row could not be read", async () => {
    const slow = deferred();
    fake.from("profiles", "select").replyOnce(slow.reply).reply(ok(ownRow));
    openPortal();
    await screen.findByText(/Welcome back/);
    fireEvent.click(accountButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "My profile" }));
    await screen.findByRole("status");
    await expectNoSeriousViolations(document.body);
    await act(async () => { slow.resolve(fail("boom")); });
    await screen.findByRole("alert");
    await expectNoSeriousViolations(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Preferred name");
    await expectNoSeriousViolations(document.body);
  });
});

describe("the page menu next to it", () => {
  const trigger = () => screen.getByRole("button", { name: /Navigate/ });

  it("Escape closes it and puts focus back on its button (as it always did)", async () => {
    await openedPortal();
    const user = keyboardUser();
    trigger().focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu", { name: "All pages" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "All pages" })).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("Escape somewhere else leaves it alone: it used to pull focus to its button whenever Escape was pressed anywhere on the page", async () => {
    await openedPortal();
    const user = keyboardUser();
    accountButton().focus();
    await user.keyboard("{Escape}");
    expect(accountButton()).toHaveFocus();
  });
});
