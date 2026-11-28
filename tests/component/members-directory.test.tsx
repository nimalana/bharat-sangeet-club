// The member directory (Members page), read through the shell. Pins what the page does with its three reads
// (profiles, groups, group memberships): the loading line, what is shown at once on a second visit, what a failed first read and a
// failed refresh show, what a good read after a failure clears, and what is remembered for the next visit.
// The race of two overlapping reloads and the toast of the contact form are in shell-races.test.tsx and shell-feedback.test.tsx.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const member = (id: string, name: string, role = "member") => ({ id, full_name: name, email: `${id}@x.test`, role, status: "active", phone: "", class_year: "", specialty: "", joined_at: "2025-08-01" });
const nav = (name: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name }));
const profileReads = () => fake.from("profiles", "select");
const toasts = () => Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent);

describe("the member directory", () => {
  it("shows the loading line until the first read has answered, then the members", async () => {
    const slow = deferred();
    profileReads().reply(slow.reply);
    openPortal({ page: "members" });
    const line = await screen.findByText("Loading the archive…");
    expect(line.className).toBe("inline-loading");
    expect(screen.queryByRole("heading", { level: 1, name: "Member roster" })).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok([member("u-me", "Asha Rao"), member("u-2", "Bala Menon")])); });
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    expect(screen.queryByText("Loading the archive…")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Member roster" })).toBeInTheDocument();
  });

  it("asks for the three lists once, with the limits it has always used", async () => {
    profileReads().reply(ok([member("u-me", "Asha Rao")]));
    openPortal({ page: "members" });
    await screen.findByText("Member roster");
    await waitFor(() => expect(profileReads().count).toBe(1));
    expect(profileReads().calls[0].used("eq", "status", "active")).toBe(true);
    expect(profileReads().calls[0].used("order", "full_name")).toBe(true);
    expect(profileReads().calls[0].used("limit", 2000)).toBe(true);
    expect(fake.from("subgroups", "select").count).toBe(1);
    expect(fake.from("subgroup_memberships", "select").count).toBe(1);
    expect(fake.from("subgroup_memberships", "select").calls[0].used("limit", 5000)).toBe(true);
  });

  it("on a second visit shows the last directory at once, with no loading line, and replaces it when the new read arrives", async () => {
    const second = deferred();
    profileReads().replyOnce(ok([member("u-me", "Asha Rao"), member("u-2", "Bala Menon")])).replyOnce(second.reply);
    openPortal({ page: "members" });
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    nav("Calendar");
    expect(await screen.findByRole("heading", { level: 1, name: "Important dates" })).toBeInTheDocument();
    nav("Members");
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
    expect(screen.queryByText("Loading the archive…")).not.toBeInTheDocument();
    await waitFor(() => expect(profileReads().count).toBe(2));
    await act(async () => { second.resolve(ok([member("u-me", "Asha Rao"), member("u-5", "Newest Member")])); });
    expect(await screen.findByText("Newest Member")).toBeInTheDocument();
    expect(screen.queryByText("Bala Menon")).not.toBeInTheDocument();
  });

  it("a first read that fails shows the banner with Try again and no members, no empty-list message, and an error toast", async () => {
    profileReads().replyOnce(fail("boom")).reply(ok([member("u-me", "Asha Rao"), member("u-2", "Bala Menon")]));
    openPortal({ page: "members" });
    expect(await screen.findByText("The member directory could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("Loading the archive…")).not.toBeInTheDocument();
    expect(screen.queryByText("No members found")).not.toBeInTheDocument();
    const toast = await screen.findByText(/The member directory could not be loaded$/, { selector: ".toast" });
    expect(toast).toHaveAttribute("role", "alert");
    expect(toast).toHaveClass("error");
    expect(fake.rpc("get_portal_bootstrap").count).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    expect(screen.queryByText("The member directory could not be loaded.")).not.toBeInTheDocument();
  });

  it("any one of the three reads failing counts as a failed read, and nothing from the other two is shown", async () => {
    profileReads().reply(ok([member("u-me", "Asha Rao"), member("u-2", "Bala Menon")]));
    fake.from("subgroups", "select").reply(fail("boom"));
    openPortal({ page: "members" });
    expect(await screen.findByText("The member directory could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("Bala Menon")).not.toBeInTheDocument();
  });

  it("a refresh that fails keeps the members on screen and says they may be out of date; a good read after it clears that", async () => {
    profileReads().replyOnce(ok([member("u-me", "Asha Rao"), member("u-2", "Bala Menon")])).replyOnce(fail("boom")).reply(ok([member("u-me", "Asha Rao"), member("u-2", "Bala Menon"), member("u-3", "Chitra Iyer")]));
    openPortal({ page: "members" });
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit my contact info" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Contact information" }).closest("form")!);
    expect(await screen.findByText("The directory could not be refreshed, so it may be out of date.")).toBeInTheDocument();
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
    expect(toasts().some((text) => text?.includes("The member directory could not be loaded"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Chitra Iyer")).toBeInTheDocument();
    expect(screen.queryByText("The directory could not be refreshed, so it may be out of date.")).not.toBeInTheDocument();
  });

  it("a failed refresh is remembered as what was last good: the next visit shows the good members, not nothing", async () => {
    profileReads().replyOnce(ok([member("u-me", "Asha Rao"), member("u-2", "Bala Menon")])).replyOnce(fail("boom")).reply(fail("boom"));
    openPortal({ page: "members" });
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit my contact info" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Contact information" }).closest("form")!);
    await screen.findByText("The directory could not be refreshed, so it may be out of date.");
    nav("Calendar");
    await screen.findByRole("heading", { level: 1, name: "Important dates" });
    nav("Members");
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
    expect(screen.queryByText("Loading the archive…")).not.toBeInTheDocument();
  });

  it("saving the contact form reads the directory again once, and the new read replaces what is shown", async () => {
    fake.from("profiles", "update").reply(ok(null));
    profileReads().replyOnce(ok([member("u-me", "Asha Rao")])).reply(ok([member("u-me", "Asha Rao Menon")]));
    openPortal({ page: "members" });
    await screen.findByText("Asha Rao", {}, { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Edit my contact info" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Contact information" }).closest("form")!);
    expect(await screen.findAllByText("Asha Rao Menon", {}, { timeout: 4000 })).not.toHaveLength(0);
    expect(profileReads().count).toBe(2);
  });
});
