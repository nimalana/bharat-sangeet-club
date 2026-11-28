// The Calendar page as a person uses it, through the whole shell: add, change and remove a date, the audience filter, and
// who may do what.
//
// toast-tone.test.tsx already covers the three ways these can FAIL (a database sentence is shown as a failure, the form
// stays open, a change that matches no row is a failure). This file covers what happens when they work, and what the page
// remembers. It pins the behaviour of the code that sat inline in the Portal, so that moving it into
// features/calendar/{components/calendar-page,components/calendar-dialogs,hooks/use-calendar-page}.tsx cannot change it.

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const pad = (value: number) => String(value).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
/** A date today at 19:30 in the person's own time zone: always inside the month the calendar opens on. */
const at1930 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 30).toISOString();

const row = (id: number, title: string, subgroupId: number | null = null, over: Record<string, unknown> = {}) =>
  ({ id, title, description: "Bring a song", starts_at: at1930, location: "Hill Hall", created_at: "2026-01-01T00:00:00Z", subgroup_id: subgroupId, ...over });
const vocal = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open", archived_at: null };
const violin = { id: 8, name: "Carnatic Violin", description: "", enrollment_mode: "open", archived_at: null };
const inVocal = { subgroup_id: 7, member_id: "u-me", status: "active", membership_role: "member" };

const toast = () => document.querySelector(".toast") as HTMLElement | null;
const nav = (name: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name }));
const calendarOpen = () => screen.findByRole("heading", { level: 1, name: "Important dates" });
/** The month grid and the agenda below it both list a date: the grid is the first. */
const gridEvents = () => document.querySelectorAll<HTMLElement>(".calendar-grid .calendar-event");
const gridTitles = () => Array.from(gridEvents()).map((item) => item.querySelector("b")!.textContent);
/** The form opens a moment after the press: its code is fetched the first time it is needed. */
const form = async (heading: string) => (await screen.findByRole("heading", { name: heading })).closest("form")!;

describe("adding a date", () => {
  it("sends the form's fields with the person who added it, closes the form, says so and reads the calendar again", async () => {
    fake.from("events", "insert").reply(ok([{ id: 9 }]));
    fake.from("events", "select").reply(ok([row(9, "Open mic", 7, { description: "Bring a song" })]));
    openPortal({ role: "executive", page: "calendar", boot: { groups: [vocal, violin], events: [] } });
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add important date" }));
    const add = await form("Add an important date");
    fireEvent.change(within(add).getByLabelText("Audience"), { target: { value: "7" } });
    fireEvent.change(within(add).getByLabelText("Title"), { target: { value: "Open mic" } });
    fireEvent.change(within(add).getByLabelText("Date and time"), { target: { value: `${today}T19:30` } });
    fireEvent.change(within(add).getByLabelText("Location"), { target: { value: "Hill Hall" } });
    fireEvent.change(within(add).getByLabelText("Details"), { target: { value: "Bring a song" } });
    fireEvent.submit(add);

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add an important date" })).not.toBeInTheDocument());
    expect(fake.from("events", "insert").calls).toHaveLength(1);
    expect(fake.from("events", "insert").calls[0].payload).toEqual({ title: "Open mic", description: "Bring a song", starts_at: at1930, location: "Hill Hall", subgroup_id: 7, created_by: "u-me" });
    expect(toast()).toHaveTextContent("Important date added");
    expect(toast()).toHaveClass("success");
    // The new date is on the calendar: the shell read the dates again.
    await waitFor(() => expect(gridTitles()).toEqual(["Open mic"]));
    expect(fake.from("events", "select").count).toBe(1);
  });

  it("a whole-club date is sent with no group", async () => {
    fake.from("events", "insert").reply(ok([{ id: 9 }]));
    openPortal({ role: "executive", page: "calendar", boot: { groups: [vocal], events: [] } });
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add important date" }));
    const add = await form("Add an important date");
    expect(within(add).getByLabelText("Audience")).toHaveValue("");
    fireEvent.change(within(add).getByLabelText("Title"), { target: { value: "Open mic" } });
    fireEvent.change(within(add).getByLabelText("Date and time"), { target: { value: `${today}T19:30` } });
    fireEvent.submit(add);
    await waitFor(() => expect(fake.from("events", "insert").calls).toHaveLength(1));
    expect(fake.from("events", "insert").calls[0].payload).toMatchObject({ subgroup_id: null, description: "", location: "", created_by: "u-me" });
  });

  it("offers every group as an audience", async () => {
    openPortal({ role: "executive", page: "calendar", boot: { groups: [vocal, violin], events: [] } });
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add important date" }));
    const options = within(within(await form("Add an important date")).getByLabelText("Audience")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Whole club", "Hindustani Vocal", "Carnatic Violin"]);
  });

  // Phase 3.4: the form is the portal's Dialog: Close is named (it was a bare ×), Escape closes it, and a click beside it does not (a stray click
  // lost what was typed: it used to close the form).
  it("the form is closed by Close and by Escape, not by a press inside it or beside it", async () => {
    openPortal({ role: "executive", page: "calendar", boot: { events: [] } });
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add important date" }));
    const modal = await form("Add an important date");
    fireEvent.mouseDown(within(modal).getByLabelText("Title"));
    fireEvent.change(within(modal).getByLabelText("Title"), { target: { value: "Open mic" } });
    fireEvent.click(document.querySelector('[role="presentation"]')!);
    expect(screen.getByRole("heading", { name: "Add an important date" })).toBeInTheDocument();
    expect(within(await form("Add an important date")).getByLabelText("Title")).toHaveValue("Open mic");
    fireEvent.click(within(modal).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Add an important date" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "＋ Add important date" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("heading", { name: "Add an important date" })).not.toBeInTheDocument();
    expect(fake.from("events", "insert").calls).toHaveLength(0);
  });

  it("the Save button says Saving… while the request is out, and cannot be pressed again", async () => {
    const slow = deferred();
    fake.from("events", "insert").reply(slow.reply);
    openPortal({ role: "executive", page: "calendar", boot: { events: [] } });
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add important date" }));
    const add = await form("Add an important date");
    fireEvent.change(within(add).getByLabelText("Title"), { target: { value: "Open mic" } });
    fireEvent.change(within(add).getByLabelText("Date and time"), { target: { value: `${today}T19:30` } });
    fireEvent.submit(add);
    const saving = await screen.findByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    slow.resolve(ok([{ id: 9 }]));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add an important date" })).not.toBeInTheDocument());
  });
});

describe("changing a date", () => {
  it("opens with the date's own values, sends them all with the row's id, and says so", async () => {
    fake.from("events", "update").reply(ok([{ id: 4 }]));
    fake.from("events", "select").reply(ok([row(4, "Diwali concert, moved", 7)]));
    openPortal({ role: "executive", page: "calendar", boot: { groups: [vocal, violin], events: [row(4, "Diwali concert", 7)] } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit Diwali concert" }))[0]);
    const edit = await form("Edit this date");
    expect(within(edit).getByLabelText("Audience")).toHaveValue("7");
    expect(within(edit).getByLabelText("Title")).toHaveValue("Diwali concert");
    expect(within(edit).getByLabelText("Date and time")).toHaveValue(`${today}T19:30`);
    expect(within(edit).getByLabelText("Location")).toHaveValue("Hill Hall");
    expect(within(edit).getByLabelText("Details")).toHaveValue("Bring a song");
    expect(within(edit).getByRole("button", { name: "Save changes" })).toBeInTheDocument();

    fireEvent.change(within(edit).getByLabelText("Title"), { target: { value: "Diwali concert, moved" } });
    fireEvent.submit(edit);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit this date" })).not.toBeInTheDocument());
    const [update] = fake.from("events", "update").calls;
    expect(update.payload).toEqual({ title: "Diwali concert, moved", description: "Bring a song", starts_at: at1930, location: "Hill Hall", subgroup_id: 7 });
    expect(update.used("eq", "id", 4)).toBe(true);
    expect(toast()).toHaveTextContent("Calendar date updated");
    await waitFor(() => expect(gridTitles()).toEqual(["Diwali concert, moved"]));
  });

  it("editing another date starts from that date's values, not the last one's", async () => {
    fake.from("events", "select").reply(ok([row(4, "First", 7), row(5, "Second", null, { location: "Online" })]));
    openPortal({ role: "executive", page: "calendar", boot: { groups: [vocal], events: [row(4, "First", 7), row(5, "Second", null, { location: "Online" })] } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit First" }))[0]);
    expect(within(await form("Edit this date")).getByLabelText("Title")).toHaveValue("First");
    fireEvent.click(document.querySelector(".modal-close")!);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit Second" }))[0]);
    const edit = await form("Edit this date");
    expect(within(edit).getByLabelText("Title")).toHaveValue("Second");
    expect(within(edit).getByLabelText("Location")).toHaveValue("Online");
    expect(within(edit).getByLabelText("Audience")).toHaveValue("");
  });
});

describe("removing a date", () => {
  // Phase 3.4 (the only window.confirm in the portal): the question is the shared confirmation dialog, which names the date and the action.
  it("asks first, in a dialog that names the date; if the person declines, nothing is sent", async () => {
    openPortal({ role: "executive", page: "calendar", boot: { events: [row(3, "Diwali concert")] } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Delete Diwali concert" }))[0]);
    const question = await screen.findByRole("dialog", { name: "Remove this date from the calendar?" });
    expect(question).toHaveTextContent("\"Diwali concert\" disappears from the calendar for everyone");
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.from("events", "delete").calls).toHaveLength(0);
    expect(toast()).toBeNull();
    expect(gridTitles()).toEqual(["Diwali concert"]);
  });

  it("removes that row, says so and reads the calendar again", async () => {
    fake.from("events", "delete").reply(ok(null));
    fake.from("events", "select").reply(ok([]));
    openPortal({ role: "executive", page: "calendar", boot: { events: [row(3, "Diwali concert"), row(4, "Rehearsal")] } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Delete Diwali concert" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Remove date" }));
    await waitFor(() => expect(toast()).toHaveTextContent("Calendar date removed"));
    expect(toast()).toHaveClass("success");
    expect(fake.from("events", "delete").calls).toHaveLength(1);
    expect(fake.from("events", "delete").calls[0].used("eq", "id", 3)).toBe(true);
    await waitFor(() => expect(fake.from("events", "select").count).toBe(1));
    await waitFor(() => expect(gridEvents()).toHaveLength(0));
  });
});

describe("who may do what on the calendar", () => {
  it("a member sees the dates and none of the controls to change them", async () => {
    openPortal({ role: "member", page: "calendar", boot: { events: [row(3, "Diwali concert")] } });
    await calendarOpen();
    expect(gridTitles()).toEqual(["Diwali concert"]);
    expect(screen.queryByRole("button", { name: "＋ Add important date" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
  });

  it.each(["executive", "admin"] as const)("%s sees the controls on every date", async (role) => {
    openPortal({ role, page: "calendar", boot: { events: [row(3, "Diwali concert")] } });
    await calendarOpen();
    expect(screen.getByRole("button", { name: "＋ Add important date" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit Diwali concert" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete Diwali concert" })).toHaveLength(2);
  });
});

describe("the audience filter", () => {
  const boot = { groups: [vocal, violin], memberships: [inVocal], events: [row(1, "Club picnic"), row(2, "Vocal class", 7), row(3, "Violin class", 8)] };
  const filter = () => screen.getByLabelText("Filter by audience") as HTMLSelectElement;
  const choose = (value: string) => fireEvent.change(filter(), { target: { value } });

  it("a manager can filter by every group; a member only by the groups they belong to", async () => {
    const executive = openPortal({ role: "executive", page: "calendar", boot });
    await calendarOpen();
    expect(within(filter()).getAllByRole("option").map((option) => option.textContent)).toEqual(["All activity", "Club-wide", "Hindustani Vocal", "Carnatic Violin"]);
    executive.unmount();
    openPortal({ role: "member", page: "calendar", boot });
    await calendarOpen();
    expect(within(filter()).getAllByRole("option").map((option) => option.textContent)).toEqual(["All activity", "Club-wide", "Hindustani Vocal"]);
  });

  it("shows everything, only what is club-wide, or only one group's dates", async () => {
    openPortal({ role: "executive", page: "calendar", boot });
    await calendarOpen();
    expect(gridTitles()).toEqual(["Club picnic", "Vocal class", "Violin class"]);
    choose("club");
    expect(gridTitles()).toEqual(["Club picnic"]);
    choose("group:7");
    expect(gridTitles()).toEqual(["Vocal class"]);
    choose("group:8");
    expect(gridTitles()).toEqual(["Violin class"]);
    choose("all");
    expect(gridTitles()).toEqual(["Club picnic", "Vocal class", "Violin class"]);
  });

  it("is still set when the person goes to another page and comes back", async () => {
    // Opening the overview reads the dates again.
    fake.from("events", "select").reply(ok(boot.events));
    openPortal({ role: "executive", page: "calendar", boot });
    await calendarOpen();
    choose("group:7");
    nav("Overview");
    await screen.findByText(/Welcome back/);
    nav("Calendar");
    await calendarOpen();
    expect(filter()).toHaveValue("group:7");
    expect(gridTitles()).toEqual(["Vocal class"]);
  });
});

describe("while the shell reads the calendar again", () => {
  it("the page shows a placeholder of the month (announced as Loading the calendar) in place of the month, then the month", async () => {
    openPortal({ role: "member", page: "calendar", boot: { events: [row(3, "Diwali concert")] } });
    await calendarOpen();
    const slow = deferred();
    fake.from("events", "select").reply(slow.reply);
    // Opening the overview reads the lists again; the calendar opened straight after waits for them.
    nav("Overview");
    await screen.findByText(/Welcome back/);
    nav("Calendar");
    expect(await screen.findByRole("status")).toHaveTextContent("Loading the calendar");
    expect(document.querySelector(".calendar-skeleton .skeleton")).not.toBeNull();
    expect(document.querySelector(".month-calendar")).toBeNull();
    // The page's own title and filter stay while it waits.
    expect(screen.getByRole("heading", { level: 1, name: "Important dates" })).toBeInTheDocument();
    slow.resolve(ok([row(3, "Diwali concert"), row(6, "Rehearsal")]));
    await waitFor(() => expect(screen.queryByText("Loading the calendar")).not.toBeInTheDocument());
    expect(gridTitles()).toEqual(["Diwali concert", "Rehearsal"]);
  });
});
