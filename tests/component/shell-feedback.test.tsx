// What the shell tells the person: the toast, and what a screen that fails shows instead of a blank page.
//
// Replaces, from the old text tests:
//  shell-wiring "the portal shows the tick by tone and announces failures as alerts"
//    -> "a toast wears the tick only when it succeeded ..." (mark, role, class by tone; a database sentence with no
//       failure words in it still reads as a failure when the caller says "error"; a fixed failure sentence is read as one).
//       Also toast.test.mjs's "failures stay on screen longer" end to end -> "failures stay longer".
//  shell-resilience "the screens sit inside an error boundary that is reset when the screen changes" and
//    "the boundary offers Try again, and a reload for a chunk that cannot be fetched" and
//    "anything left over lands on an error page with a retry, not a blank page"
//    -> "a screen that fails to render ...", "a screen whose file cannot be fetched ...", "the error page ...".
//    (Dropped: the check that app/error.tsx starts with "use client": next build refuses an error page that uses
//     hooks without it. The loading fallback of each code-split screen is in shell-code-split.test.tsx.)

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import RootError from "../../app/error";
import { SectionBoundary } from "../../components/ui/section-boundary";
import { advance } from "../support/helpers";
import { fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const member = (id: string, name: string) => ({ id, full_name: name, email: `${id}@x.test`, role: "member", status: "active", phone: "", class_year: "", specialty: "", joined_at: "2025-08-01" });
const toast = () => document.querySelector(".toast") as HTMLElement | null;

async function saveMyProfile() {
  fireEvent.click(await screen.findByRole("button", { name: "Edit my contact info" }));
  fireEvent.submit(screen.getByRole("heading", { name: "Contact information" }).closest("form")!);
}

describe("a toast wears the tick only when it succeeded", () => {
  beforeEach(() => { fake.from("profiles", "select").reply(ok([member("u-me", "Asha Rao")])); });

  it("a success: tick, class success, announced politely (status)", async () => {
    fake.from("profiles", "update").reply(ok(null));
    openPortal({ page: "members" });
    await saveMyProfile();
    const shown = await screen.findByText(/Your contact information was updated/);
    expect(shown).toHaveAttribute("role", "status");
    expect(shown).toHaveTextContent(/^✓ /);
    expect(shown).toHaveClass("toast", "success");
  });

  it("a database sentence with no failure words in it is still shown as a failure: no tick, announced as an alert", async () => {
    // Text from the database: its words say nothing about whether it failed, so the call says "error".
    fake.from("profiles", "update").reply(fail("Only administrators can change member roles"));
    openPortal({ page: "members" });
    await saveMyProfile();
    const shown = await screen.findByText(/Only administrators can change member roles/);
    expect(shown).toHaveAttribute("role", "alert");
    expect(shown).not.toHaveTextContent(/^✓/);
    expect(shown).toHaveClass("toast", "error");
  });

  it("a fixed failure sentence written in the screen is read as a failure even with no tone", async () => {
    fake.from("announcements", "select").reply(fail("boom"));
    openPortal({ boot: { announcements: [] } });
    await screen.findByText(/Welcome back/);
    fireEvent.click(screen.getByRole("button", { name: "Bharat Sangeet at UNC Chapel Hill home" }));
    const shown = await screen.findByText(/could not be loaded/);
    expect(shown).toHaveAttribute("role", "alert");
    expect(shown).toHaveClass("error");
  });

  it("a fixed confirmation keeps its tick", async () => {
    fake.from("profiles", "update").reply(ok(null));
    openPortal({ page: "members" });
    await saveMyProfile();
    expect(await screen.findByText(/Your contact information was updated/)).toHaveClass("success");
  });
});

// Phase 3.1: was "failures stay longer than confirmations, and a newer toast takes over the timer" (a failure faded after 6 s and a newer
// toast replaced the older). Now a failure stays until it is dismissed or the next failure replaces it, and toasts stack.
describe("a confirmation fades, a failure stays until dismissed, and toasts stack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake.from("profiles", "select").reply(ok([member("u-me", "Asha Rao")]));
  });

  async function openMembers() {
    openPortal({ page: "members" });
    await advance(1); await advance(1); await advance(1);
    expect(screen.getByRole("heading", { level: 1, name: "Member roster" })).toBeInTheDocument();
  }
  async function save() {
    fireEvent.click(screen.getByRole("button", { name: "Edit my contact info" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Contact information" }).closest("form")!);
    await advance(1);
  }
  const shownToasts = () => Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent);

  it("a confirmation goes after 2.8 s; a failure is still there a minute later and goes when it is dismissed", async () => {
    fake.from("profiles", "update").replyOnce(ok(null)).reply(fail("Phone numbers must be 10 digits"));
    await openMembers();
    await save();
    expect(toast()).toHaveTextContent("Your contact information was updated");
    await advance(2700);
    expect(toast()).not.toBeNull();
    await advance(200);
    expect(toast()).toBeNull();
    await save();
    expect(toast()).toHaveTextContent("Phone numbers must be 10 digits");
    await advance(60_000);
    expect(toast()).toHaveTextContent("Phone numbers must be 10 digits");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(toast()).toBeNull();
  });

  it("a failure that arrives while a confirmation is showing stacks with it; the confirmation goes at its own time and the failure stays", async () => {
    fake.from("profiles", "update").replyOnce(ok(null)).reply(fail("Phone numbers must be 10 digits"));
    await openMembers();
    await save();
    await advance(2000);
    // The first toast would go in 0.8 s. A failure arrives now.
    await save();
    expect(shownToasts()).toEqual(["✓ Your contact information was updated", "! Phone numbers must be 10 digits"]);
    await advance(900);
    expect(shownToasts()).toEqual(["! Phone numbers must be 10 digits"]);
    await advance(60_000);
    expect(shownToasts()).toEqual(["! Phone numbers must be 10 digits"]);
  });
});

describe("a screen that fails to render does not take the portal with it", () => {
  let errors: MockInstance<typeof console.error>;
  beforeEach(() => { errors = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => errors.mockRestore());

  // A row with neither a name nor an email: the roster cannot draw its initials.
  const broken = { id: "u-x", role: "member", status: "active" };

  it("shows Try again inside the page and keeps the header and navigation; Try again mounts the screen again", async () => {
    fake.from("profiles", "select").reply(ok([member("u-me", "Asha Rao"), broken]));
    openPortal({ page: "members" });
    expect(await screen.findByText("Something went wrong on this page")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing has been changed");
    // The shell around the screen is intact.
    expect(screen.getByRole("navigation", { name: "Portal navigation" })).toBeInTheDocument();
    expect(screen.getByText("Member · Account")).toBeInTheDocument();
    const reported = errors.mock.calls.filter(([message]) => message === "A portal screen failed").length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    // The screen was drawn again; this data still cannot be drawn, so it fails again, in place (and is reported again).
    expect(errors.mock.calls.filter(([message]) => message === "A portal screen failed").length).toBeGreaterThan(reported);
    expect(await screen.findByText("Something went wrong on this page")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Portal navigation" })).toBeInTheDocument();
  });

  it("moving to another page clears the failure", async () => {
    fake.from("profiles", "select").reply(ok([member("u-me", "Asha Rao"), broken]));
    openPortal({ page: "members" });
    await screen.findByText("Something went wrong on this page");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name: "Calendar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Important dates" })).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong on this page")).not.toBeInTheDocument();
  });

  it("a screen whose file cannot be fetched says so and offers a reload, not a retry that cannot work", () => {
    let renders = 0;
    function Gone(): never { renders += 1; throw Object.assign(new Error("Loading chunk 412 failed."), { name: "ChunkLoadError" }); }
    render(<SectionBoundary><Gone /></SectionBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("This page could not be loaded");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const before = renders;
    fireEvent.click(screen.getByRole("button", { name: "Reload the page" }));
    expect(reload).toHaveBeenCalledTimes(1);
    // It did not try to draw the missing screen again.
    expect(renders).toBe(before);
  });
});

describe("the error page (anything left over)", () => {
  let errors: MockInstance<typeof console.error>;
  beforeEach(() => { errors = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => errors.mockRestore());

  it("offers Try again, which asks Next to render the page again", () => {
    const reset = vi.fn();
    render(<RootError error={new Error("boom")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("after a deploy it asks for a reload instead", () => {
    const reset = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<RootError error={Object.assign(new Error("x"), { name: "ChunkLoadError" })} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The portal was updated");
    fireEvent.click(screen.getByRole("button", { name: "Reload the page" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });
});
