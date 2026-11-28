// Phase 3.2 (P3-06): "Complete your profile". The sign-in form no longer asks for a name (and keeps none in sessionStorage); after the first
// sign-in as an ACTIVE member whose profile has no contact detail yet, the shell shows one step, with the same fields and the same save as
// "My profile" and Skip for now. Run through the whole shell against the fake client.
//
//  - who sees it: an active member with no phone, class year or voice/instrument, and nobody else (a profile with any of them, a pending or a
//    rejected sign-up, a read that failed or answered nothing readable);
//  - once: Save profile or Skip for now (or Close, or Escape) is remembered for that person in this browser (localStorage, every access guarded:
//    the page works without it) and the step does not come back, and a profile with details is not read again either;
//  - what it does: the same four columns as My profile, one save however often the button is pressed, a failed save keeps it open and as
//    typed, a saved name is the name in the top bar;
//  - how it behaves as a dialog: named by its heading, focus on the first field, Tab stays inside it, no serious axe violation.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousViolations } from "../support/a11y";
import { deferred, fail, fake, ok, rejects } from "../support/fake-supabase";
import { focusedName, keyboardUser } from "../support/keyboard";
import { bootstrapAnswer, openPortal, renderPortal } from "../support/portal";

const bare = { id: "u-me", full_name: "Asha Rao", email: "u-me@x.test", role: "member", phone: null, class_year: null, specialty: null, joined_at: "2026-11-20" };
const flag = (userId = "u-me") => window.localStorage.getItem(`bharat-sangeet-profile-step:${userId}`);
const ownReads = () => fake.from("profiles", "select").calls.filter((call) => call.used("eq", "id", "u-me"));
const saves = () => fake.from("profiles", "update").calls;
const step = () => screen.queryByRole("dialog", { name: "Complete your profile" });
const toasts = () => Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent);

async function openWith(row: unknown = bare, name = "Asha Rao") {
  fake.from("profiles", "select").reply(ok(row));
  const view = openPortal({ name });
  await screen.findByText(new RegExp(`Welcome back, ${name}`));
  return view;
}

/** The name of the focused control as a person hears it: its label, else its own text (focusedName() says "input" for a field). */
const focusLabel = () => {
  const element = document.activeElement as HTMLInputElement | null;
  return element?.labels?.[0]?.firstChild?.textContent?.trim() || focusedName();
};

describe("who sees the step", () => {
  it("an active member with no contact detail, once the portal is open: a dialog named Complete your profile, with the four fields and the two buttons", async () => {
    await openWith();
    const dialog = await screen.findByRole("dialog", { name: "Complete your profile" });
    expect(within(dialog).getByLabelText("Preferred name")).toHaveValue("Asha Rao");
    expect(within(dialog).getByLabelText("Email")).toBeDisabled();
    for (const label of ["Phone number", "Class year", "Voice / instrument"]) expect(within(dialog).getByLabelText(label)).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Save profile" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Skip for now" })).toBeEnabled();
    expect(within(dialog).getByText(/Tell the club how to reach you/)).toBeInTheDocument();
    expect(ownReads()).toHaveLength(1);
    expect(flag()).toBeNull();
  });

  it.each([["a phone number", { phone: "919-555-0100" }], ["a class year", { class_year: "2028" }], ["a voice or instrument", { specialty: "Veena" }]])("a member who already has %s does not, and is not asked again later", async (_label, extra) => {
    const view = await openWith({ ...bare, ...extra });
    await waitFor(() => expect(flag()).toBe("done"));
    expect(step()).not.toBeInTheDocument();
    view.unmount();
    fake.reset();
    await openWith({ ...bare, ...extra });
    expect(ownReads()).toHaveLength(0);
  });

  it("details that are only spaces are no details", async () => {
    await openWith({ ...bare, phone: "   ", specialty: " " });
    expect(await screen.findByRole("dialog", { name: "Complete your profile" })).toBeInTheDocument();
  });

  it("a sign-up still waiting for approval never sees it, and nothing is read for it", async () => {
    fake.signIn({ id: "u-me" });
    fake.from("profiles", "select").reply(ok(bare));
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer("member", "New Person", { profile: { full_name: "New Person", role: "member", status: "pending" } })));
    renderPortal();
    await screen.findByText("Your sign-up is waiting for approval by a club executive.");
    await act(async () => { await Promise.resolve(); });
    expect(step()).not.toBeInTheDocument();
    expect(fake.from("profiles").calls).toHaveLength(0);
    expect(flag()).toBeNull();
  });

  it("a declined sign-up never sees it either", async () => {
    fake.signIn({ id: "u-me" });
    fake.from("profiles", "select").reply(ok(bare));
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer("member", "New Person", { profile: { full_name: "New Person", role: "member", status: "rejected" } })));
    renderPortal();
    await screen.findByRole("heading", { name: "Your sign-up was not approved" });
    expect(step()).not.toBeInTheDocument();
    expect(fake.from("profiles").calls).toHaveLength(0);
  });

  it("a deactivated account never sees it", async () => {
    fake.signIn({ id: "u-me" });
    fake.from("profiles", "select").reply(ok(bare));
    fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer("member", "Old", { profile: { full_name: "Old", role: "member", status: "deactivated" } })));
    renderPortal();
    await screen.findByText("Your access has been deactivated");
    expect(step()).not.toBeInTheDocument();
    expect(fake.from("profiles").calls).toHaveLength(0);
  });

  it("a read that fails shows nothing (no error for a step nobody asked for) and is not remembered: it looks again next time", async () => {
    fake.from("profiles", "select").reply(fail("permission denied for table profiles"));
    openPortal();
    await screen.findByText(/Welcome back/);
    await waitFor(() => expect(ownReads()).toHaveLength(1));
    await act(async () => { await Promise.resolve(); });
    expect(step()).not.toBeInTheDocument();
    expect(toasts()).toEqual([]);
    expect(flag()).toBeNull();
  });

  it("a read that never reaches the server (a thrown error) is the same", async () => {
    fake.from("profiles", "select").reply(rejects(new Error("network down")));
    openPortal();
    await screen.findByText(/Welcome back/);
    await waitFor(() => expect(ownReads()).toHaveLength(1));
    await act(async () => { await Promise.resolve(); });
    expect(step()).not.toBeInTheDocument();
    expect(flag()).toBeNull();
  });

  it.each([["no row", null], ["somebody else's row", { ...bare, id: "u-other" }]])("an answer of %s shows nothing", async (_label, answer) => {
    await openWith(answer);
    await act(async () => { await Promise.resolve(); });
    expect(step()).not.toBeInTheDocument();
    expect(flag()).toBeNull();
  });

  it("is offered on the home page: somebody who opened a link to another page is not interrupted, and sees it when they open Home", async () => {
    fake.from("profiles", "select").reply(ok(bare));
    openPortal({ page: "calendar" });
    await screen.findByRole("heading", { level: 1, name: "Important dates" });
    await act(async () => { await Promise.resolve(); });
    expect(step()).not.toBeInTheDocument();
    expect(ownReads()).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name: "Overview" }));
    expect(await screen.findByRole("dialog", { name: "Complete your profile" })).toBeInTheDocument();
    expect(ownReads()).toHaveLength(1);
  });

  it("leaving Home with the step open takes it away, and one read is all it costs however often Home is opened", async () => {
    await openWith();
    await screen.findByRole("dialog", { name: "Complete your profile" });
    act(() => { window.history.pushState({}, "", "/?page=calendar"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(step()).not.toBeInTheDocument());
    act(() => { window.history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(await screen.findByRole("dialog", { name: "Complete your profile" })).toBeInTheDocument();
    expect(ownReads()).toHaveLength(1);
  });

  it("is remembered per person: another person's answer in the same browser does not hide it", async () => {
    window.localStorage.setItem("bharat-sangeet-profile-step:u-other", "skipped");
    await openWith();
    expect(await screen.findByRole("dialog", { name: "Complete your profile" })).toBeInTheDocument();
  });
});

describe("Skip for now, Close and Escape", () => {
  it("Skip for now closes it, saves nothing, remembers it, and the step does not come back on the next sign-in (nothing is read)", async () => {
    const view = await openWith();
    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    expect(step()).not.toBeInTheDocument();
    expect(saves()).toHaveLength(0);
    expect(flag()).toBe("skipped");
    view.unmount();
    fake.reset();
    await openWith();
    await act(async () => { await Promise.resolve(); });
    expect(step()).not.toBeInTheDocument();
    expect(ownReads()).toHaveLength(0);
  });

  it("the Close button is the same as Skip for now", async () => {
    await openWith();
    const dialog = await screen.findByRole("dialog", { name: "Complete your profile" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(step()).not.toBeInTheDocument();
    expect(flag()).toBe("skipped");
    expect(saves()).toHaveLength(0);
  });

  it("Escape is the same, and a click beside the dialog is not (what was typed is not lost by a stray click)", async () => {
    await openWith();
    const dialog = await screen.findByRole("dialog", { name: "Complete your profile" });
    fireEvent.change(within(dialog).getByLabelText("Phone number"), { target: { value: "919-555-0100" } });
    fireEvent.click(document.querySelector('[role="presentation"]') as HTMLElement);
    expect(step()).toBeInTheDocument();
    expect(within(step()!).getByLabelText("Phone number")).toHaveValue("919-555-0100");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(step()).not.toBeInTheDocument();
    expect(flag()).toBe("skipped");
  });

  it("the page works with storage that refuses everything: the step shows, Skip for now closes it, nothing throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await openWith();
    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    expect(step()).not.toBeInTheDocument();
    expect(screen.getByText(/Welcome back/)).toBeInTheDocument();
  });
});

describe("Save profile", () => {
  async function fill() {
    const dialog = await screen.findByRole("dialog", { name: "Complete your profile" });
    fireEvent.change(within(dialog).getByLabelText("Preferred name"), { target: { value: "  Asha R.  " } });
    fireEvent.change(within(dialog).getByLabelText("Phone number"), { target: { value: "919-555-0100" } });
    fireEvent.change(within(dialog).getByLabelText("Class year"), { target: { value: "2028" } });
    fireEvent.change(within(dialog).getByLabelText("Voice / instrument"), { target: { value: "Veena" } });
    return dialog;
  }

  it("sends the four columns of the person's own row, says so, closes, remembers it, and the top bar has the new name", async () => {
    await openWith();
    fake.from("profiles", "update").reply(ok(null));
    const dialog = await fill();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(step()).not.toBeInTheDocument());
    expect(saves()).toHaveLength(1);
    expect(saves()[0].payload).toEqual({ full_name: "  Asha R.  ", phone: "919-555-0100", class_year: "2028", specialty: "Veena" });
    expect(saves()[0].used("eq", "id", "u-me")).toBe(true);
    expect(toasts().join(" ")).toContain("Your contact information was updated");
    expect(flag()).toBe("done");
    expect(await screen.findByRole("button", { name: "Account menu for Asha R." })).toBeInTheDocument();
  });

  it("pressing it twice while it saves sends one request, and the buttons say Saving… and are off", async () => {
    await openWith();
    const slow = deferred();
    fake.from("profiles", "update").reply(slow.reply);
    const dialog = await fill();
    const form = within(dialog).getByRole("button", { name: "Save profile" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(within(dialog).getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Skip for now" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(step()).toBeInTheDocument();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(step()).not.toBeInTheDocument());
    expect(saves()).toHaveLength(1);
  });

  it("a refused save keeps it open and as typed, says so (the toast stays), remembers nothing, and the next press can succeed", async () => {
    await openWith();
    fake.from("profiles", "update").replyOnce(fail("Phone numbers must be 10 digits", "P0001")).reply(ok(null));
    const dialog = await fill();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(toasts().join(" ")).toContain("Phone numbers must be 10 digits"));
    expect(step()).toBeInTheDocument();
    expect(within(step()!).getByLabelText("Phone number")).toHaveValue("919-555-0100");
    expect(within(step()!).getByLabelText("Voice / instrument")).toHaveValue("Veena");
    expect(flag()).toBeNull();
    expect(within(step()!).getByRole("button", { name: "Save profile" })).toBeEnabled();
    fireEvent.click(within(step()!).getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(step()).not.toBeInTheDocument());
    expect(saves()).toHaveLength(2);
    expect(flag()).toBe("done");
  });

  it("without a name the form is not sent (the field is required)", async () => {
    await openWith();
    const dialog = await screen.findByRole("dialog", { name: "Complete your profile" });
    expect(within(dialog).getByLabelText("Preferred name")).toBeRequired();
  });
});

describe("as a dialog", () => {
  it("is named by its heading and the first field has the focus", async () => {
    await openWith();
    const dialog = await screen.findByRole("dialog", { name: "Complete your profile" });
    expect(dialog).toHaveAccessibleName("Complete your profile");
    await waitFor(() => expect(within(dialog).getByLabelText("Preferred name")).toHaveFocus());
  });

  it("Tab stays inside it and wraps, Shift+Tab too; the page behind is out of reach", async () => {
    await openWith();
    await screen.findByRole("dialog", { name: "Complete your profile" });
    const user = keyboardUser();
    const seen: string[] = [];
    for (let press = 0; press < 8; press += 1) { await user.tab(); seen.push(focusLabel()); }
    expect(new Set(seen)).toEqual(new Set(["Preferred name", "Phone number", "Class year", "Voice / instrument", "Save profile", "Skip for now", "Close"]));
    // Eight presses went round a ring of seven: the eighth is where the first was.
    expect(seen[7]).toBe(seen[0]);
    await user.tab({ shift: true });
    expect(focusLabel()).toBe(seen[6]);
  });

  it("is a dialog the page is inert behind", async () => {
    await openWith();
    await screen.findByRole("dialog", { name: "Complete your profile" });
    expect(document.querySelector("header.topbar")!.closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Complete your profile" }).closest("[inert]")).toBeNull();
  });

  it("has no serious accessibility violation (axe; contrast is not computed in jsdom)", async () => {
    const view = await openWith();
    await screen.findByRole("dialog", { name: "Complete your profile" });
    await expectNoSeriousViolations(view.container);
  });
});
