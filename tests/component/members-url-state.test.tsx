// Phase 3.2 and 3.1 on the Members page, through the whole shell against the fake client:
//
//  - the search and the group filter are in the address (?q=veena, ?group=7): a link or a reload opens the same view, a value that is not one is
//    the usual view, Back leaves the page after a search (the entry is rewritten) and returns to the previous group (a choice is an entry),
//    ?page= and every other parameter stay; typing is never interrupted by the address;
//  - while the first read is on its way the page is a placeholder of itself (announced as Loading the members); a first read that fails is the
//    error with Try again (an alert), never "No members found"; the form button is off when the person's own row is not there to fill it from;
//  - axe finds nothing serious on the roster, its placeholder, its error and the contact form.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousViolations } from "../support/a11y";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const member = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, full_name: name, email: `${id}@x.test`, role: "member", phone: "", class_year: "", specialty: "", joined_at: "2025-08-01", ...over });
const GROUPS = [{ id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open" }, { id: 8, name: "Carnatic Violin", description: "", enrollment_mode: "open" }];
const MEMBERSHIPS = [{ subgroup_id: 7, member_id: "u-2", status: "active", membership_role: "member" }, { subgroup_id: 8, member_id: "u-3", status: "active", membership_role: "member" }];
const PEOPLE = [member("u-me", "Asha Rao", { specialty: "Veena" }), member("u-2", "Bala Menon", { specialty: "Vocal" }), member("u-3", "Chitra Iyer", { specialty: "Violin" })];

const search = () => new URLSearchParams(window.location.search);
const names = () => screen.queryAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
const box = () => screen.getByLabelText("Search members") as HTMLInputElement;
const filter = () => screen.getByLabelText("Filter roster by subgroup") as HTMLSelectElement;

async function open(query = "", people: unknown[] = PEOPLE) {
  fake.from("profiles", "select").reply(ok(people));
  fake.from("subgroups", "select").reply(ok(GROUPS));
  fake.from("subgroup_memberships", "select").reply(ok(MEMBERSHIPS));
  const view = openPortal({ page: `members${query}` });
  await screen.findByRole("heading", { level: 1, name: "Member roster" });
  return view;
}

describe("the search is in the address (?q=)", () => {
  it("typing filters at once and writes ?q= (one rewritten entry, so Back leaves the page), clearing it removes the parameter", async () => {
    await open();
    // (history.length is not a measure here: an earlier test's Back leaves forward entries that a push cuts off.)
    const push = vi.spyOn(window.history, "pushState"); const replace = vi.spyOn(window.history, "replaceState");
    fireEvent.change(box(), { target: { value: "veena" } });
    expect(names()).toEqual(["Asha Rao"]);
    expect(box()).toHaveValue("veena");
    await waitFor(() => expect(search().get("q")).toBe("veena"));
    expect(search().get("page")).toBe("members");
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    fireEvent.change(box(), { target: { value: "" } });
    await waitFor(() => expect(search().has("q")).toBe(false));
    expect(names()).toHaveLength(3);
    expect(search().get("page")).toBe("members");
  });

  it("a link with ?q=violin opens the roster filtered, with the word in the field", async () => {
    await open("&q=violin");
    expect(box()).toHaveValue("violin");
    expect(names()).toEqual(["Chitra Iyer"]);
  });

  it("the field keeps what is typed while the address catches up (a letter typed in the middle stays in the middle)", async () => {
    await open();
    box().focus();
    fireEvent.change(box(), { target: { value: "ab" } });
    fireEvent.change(box(), { target: { value: "axb" } });
    expect(box()).toHaveValue("axb");
    await waitFor(() => expect(search().get("q")).toBe("axb"));
    expect(box()).toHaveValue("axb");
  });

  it("Back and Forward put an earlier address into the field", async () => {
    await open("&q=violin");
    act(() => { window.history.pushState({}, "", "/?page=members&q=vocal"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(box()).toHaveValue("vocal"));
    expect(names()).toEqual(["Bala Menon"]);
    act(() => { window.history.back(); });
    await waitFor(() => expect(box()).toHaveValue("violin"));
    expect(names()).toEqual(["Chitra Iyer"]);
  });
});

describe("the group is in the address (?group=)", () => {
  it("choosing a group writes ?group=<id> as an entry that Back undoes, and Everyone removes it", async () => {
    await open();
    const push = vi.spyOn(window.history, "pushState");
    fireEvent.change(filter(), { target: { value: "7" } });
    await waitFor(() => expect(search().get("group")).toBe("7"));
    expect(search().get("page")).toBe("members");
    expect(push).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(["Bala Menon"]);
    expect(filter()).toHaveValue("7");
    act(() => { window.history.back(); });
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(filter()).toHaveValue("all");
    fireEvent.change(filter(), { target: { value: "8" } });
    await waitFor(() => expect(names()).toEqual(["Chitra Iyer"]));
    fireEvent.change(filter(), { target: { value: "all" } });
    await waitFor(() => expect(search().has("group")).toBe(false));
    await waitFor(() => expect(names()).toHaveLength(3));
  });

  it("a link with ?group=8 and ?q= together opens both", async () => {
    await open("&group=8&q=iyer");
    expect(filter()).toHaveValue("8");
    expect(box()).toHaveValue("iyer");
    expect(names()).toEqual(["Chitra Iyer"]);
    expect(search().get("page")).toBe("members");
  });

  it.each(["0", "-1", "abc", "7x", "1.5", ""])("a link with ?group=%s shows everyone", async (value) => {
    await open(`&group=${value}`);
    expect(filter()).toHaveValue("all");
    expect(names()).toHaveLength(3);
  });

  it("a group that does not exist (any more) shows everyone, and leaves the address alone", async () => {
    await open("&group=99");
    expect(filter()).toHaveValue("all");
    expect(names()).toHaveLength(3);
    expect(search().get("group")).toBe("99");
  });

  it("the empty group says so, with the group's own sentence", async () => {
    await open("&group=7&q=violin");
    expect(screen.getByText("No members found")).toBeInTheDocument();
    expect(screen.getByText("No members are active in this subgroup.")).toBeInTheDocument();
  });
});

describe("while it loads and when it cannot", () => {
  it("the placeholder has the heights of the page and is announced once; the real page replaces it", async () => {
    const slow = deferred();
    fake.from("profiles", "select").reply(slow.reply);
    const view = openPortal({ page: "members" });
    const status = await screen.findByText("Loading the members");
    expect(status).toHaveAttribute("role", "status");
    expect(view.container.querySelector(".roster-skeleton-title")).not.toBeNull();
    expect(view.container.querySelector(".roster-skeleton-toolbar")).not.toBeNull();
    expect(view.container.querySelectorAll(".member-grid .member-skeleton")).toHaveLength(6);
    await expectNoSeriousViolations(view.container);
    await act(async () => { slow.resolve(ok(PEOPLE)); });
    expect(await screen.findByRole("heading", { level: 1, name: "Member roster" })).toBeInTheDocument();
    expect(view.container.querySelector(".member-skeleton")).toBeNull();
  });

  it("a first read that fails is the error with Try again, announced as an alert, not No members found; Try again reads again", async () => {
    fake.from("profiles", "select").replyOnce(fail("boom")).reply(ok(PEOPLE));
    fake.from("subgroups", "select").reply(ok(GROUPS));
    fake.from("subgroup_memberships", "select").reply(ok(MEMBERSHIPS));
    const view = openPortal({ page: "members" });
    const alert = await screen.findByText("The member directory could not be loaded.", { selector: "[role=alert]" });
    expect(screen.queryByText("No members found")).not.toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await expectNoSeriousViolations(view.container);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Bala Menon")).toBeInTheDocument();
    expect(screen.queryByText("The member directory could not be loaded.", { selector: "[role=alert]" })).not.toBeInTheDocument();
  });

  it("with no directory the contact form cannot be opened from a blank (it would save blanks over the person's details)", async () => {
    fake.from("profiles", "select").reply(fail("boom"));
    openPortal({ page: "members" });
    await screen.findByText("The member directory could not be loaded.", { selector: "[role=alert]" });
    expect(screen.getByRole("button", { name: "Edit my contact info" })).toBeDisabled();
  });
});

describe("accessibility (axe; colour contrast is not computed in jsdom)", () => {
  it("the roster, with a search and a group chosen, and with the contact form open", async () => {
    const view = await open("&group=7");
    await expectNoSeriousViolations(view.container);
    fireEvent.click(screen.getByRole("button", { name: "Edit my contact info" }));
    await screen.findByRole("dialog", { name: "Contact information" });
    await expectNoSeriousViolations(view.container);
  });

  it("the empty list", async () => {
    const view = await open("&q=zzz");
    expect(screen.getByText("No members found")).toBeInTheDocument();
    await expectNoSeriousViolations(view.container);
  });
});
