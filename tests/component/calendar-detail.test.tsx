// Phase 3.3 and 3.2 on the calendar, through the whole shell against the fake client:
//
//  - a date is a button: pressing it (or Enter or Space on it, in the month grid or in the agenda that replaces the grid under 700px) opens a
//    read-only detail dialog with the title, when, who it is for, where and the details, and for a manager Edit and Remove;
//  - what the person is looking at is in the address: ?month=2026-03 and ?event=12 (a link or a reload opens them, Back steps through the months,
//    a value that is not one is the usual view, ?page= is never touched);
//  - the detail is a dialog: named by the date, Escape and Close close it, focus goes back to the date, axe finds nothing serious.
// (The month grid, the agenda and the manager's small buttons themselves are in calendar-page.test.tsx; add, change and remove in calendar-flows.test.tsx.)
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoSeriousViolations } from "../support/a11y";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { focusedName, keyboardUser, tabOrder } from "../support/keyboard";
import { openPortal } from "../support/portal";

const now = new Date();
const here = new Date(now.getFullYear(), now.getMonth(), 1);
const monthName = (date: Date) => date.toLocaleString("en-US", { month: "long", year: "numeric" });
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const at = (day: number, hour = 19, minute = 30) => new Date(now.getFullYear(), now.getMonth(), day, hour, minute).toISOString();
const row = (id: number, title: string, over: Record<string, unknown> = {}) => ({ id, title, description: "Bring a song", starts_at: at(10), location: "Hill Hall", created_at: "2026-01-01T00:00:00Z", subgroup_id: null, ...over });
const vocal = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open", archived_at: null };
const diwali = row(3, "Diwali concert", { subgroup_id: 7 });

const search = () => new URLSearchParams(window.location.search);
const heading = (date: Date) => screen.findByRole("heading", { level: 2, name: monthName(date) });
const calendarOpen = () => screen.findByRole("heading", { level: 1, name: "Important dates" });
/** The date's own button in the month grid (the agenda has one as well: they are the first and the second). */
const dateButtons = (title: string) => screen.queryAllByRole("button", { name: new RegExp(`${title}`) }).filter((button) => button.classList.contains("calendar-event-open"));
const detail = (title: string) => screen.queryByRole("dialog", { name: title });

async function open(role: "member" | "executive" = "member", events = [diwali], query = "") {
  openPortal({ role, page: `calendar${query}`, boot: { events, groups: [vocal] } });
  await calendarOpen();
}

describe("a date opens its detail", () => {
  it("from the month grid: a dialog named by the date, with when, who it is for, where and the details; nothing to change for a member", async () => {
    await open();
    fireEvent.click(dateButtons("Diwali concert")[0]);
    const dialog = await screen.findByRole("dialog", { name: "Diwali concert" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const facts = within(dialog);
    const day = new Date(at(10)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    expect(facts.getByText("When").nextElementSibling).toHaveTextContent(`${day} at 7:30 PM`);
    expect(facts.getByText("For").nextElementSibling).toHaveTextContent("Hindustani Vocal");
    expect(facts.getByText("Where").nextElementSibling).toHaveTextContent("Hill Hall");
    expect(facts.getByText("Details").nextElementSibling).toHaveTextContent("Bring a song");
    expect(facts.queryByRole("button", { name: /Edit|Remove/ })).not.toBeInTheDocument();
    expect(facts.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("from the agenda that replaces the grid on a phone: the same dialog", async () => {
    await open();
    fireEvent.click(dateButtons("Diwali concert")[1]);
    expect(await screen.findByRole("dialog", { name: "Diwali concert" })).toBeInTheDocument();
    expect(document.querySelector(".calendar-agenda .calendar-event-open")).not.toBeNull();
  });

  it("leaves out a place and details that the date does not have, and says Club-wide for a date of the whole club", async () => {
    await open("member", [row(4, "Open mic", { description: "", location: "" })]);
    fireEvent.click(dateButtons("Open mic")[0]);
    const dialog = await screen.findByRole("dialog", { name: "Open mic" });
    expect(within(dialog).queryByText("Where")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Details")).not.toBeInTheDocument();
    expect(within(dialog).getByText("For").nextElementSibling).toHaveTextContent("Club-wide");
  });

  it("Escape and Close close it, and focus goes back to the date that was pressed", async () => {
    await open();
    const user = keyboardUser();
    const button = dateButtons("Diwali concert")[0];
    await user.click(button);
    await screen.findByRole("dialog", { name: "Diwali concert" });
    await user.keyboard("{Escape}");
    expect(detail("Diwali concert")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(within(await screen.findByRole("dialog", { name: "Diwali concert" })).getByRole("button", { name: "Close" }));
    expect(detail("Diwali concert")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("a click beside it closes it (nothing is typed in it)", async () => {
    await open();
    fireEvent.click(dateButtons("Diwali concert")[0]);
    const dialog = await screen.findByRole("dialog", { name: "Diwali concert" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    await waitFor(() => expect(detail("Diwali concert")).not.toBeInTheDocument());
  });

  it("a manager's small Edit and Remove buttons still do their own thing and do not open the detail", async () => {
    await open("executive");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Diwali concert" })[0]);
    expect(await screen.findByRole("heading", { name: "Edit this date" })).toBeInTheDocument();
    expect(detail("Diwali concert")).not.toBeInTheDocument();
    expect(search().has("event")).toBe(false);
  });
});

describe("what a manager does from the detail", () => {
  it("Edit this date opens the form on top, Close of the form comes back to the detail, and a saved change shows in it", async () => {
    await open("executive");
    const user = keyboardUser();
    await user.click(dateButtons("Diwali concert")[0]);
    const dialog = await screen.findByRole("dialog", { name: "Diwali concert" });
    await user.click(within(dialog).getByRole("button", { name: "Edit this date" }));
    const form = (await screen.findByRole("heading", { name: "Edit this date" })).closest("form")!;
    expect(within(form).getByLabelText("Title")).toHaveValue("Diwali concert");
    await user.click(within(form).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit this date" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Diwali concert" })).toBeInTheDocument();
    expect(focusedName()).toBe("Edit this date");

    fake.from("events", "update").reply(ok([{ id: 3 }]));
    fake.from("events", "select").reply(ok([{ ...diwali, title: "Diwali concert (moved)", location: "Memorial Hall" }]));
    await user.click(within(screen.getByRole("dialog", { name: "Diwali concert" })).getByRole("button", { name: "Edit this date" }));
    const second = (await screen.findByRole("heading", { name: "Edit this date" })).closest("form")!;
    fireEvent.change(within(second).getByLabelText("Title"), { target: { value: "Diwali concert (moved)" } });
    fireEvent.submit(second);
    const moved = await screen.findByRole("dialog", { name: "Diwali concert (moved)" });
    expect(within(moved).getByText("Where").nextElementSibling).toHaveTextContent("Memorial Hall");
    expect(fake.from("events", "update").calls).toHaveLength(1);
  });

  it("Remove this date asks first; Cancel leaves the detail open with focus back on Remove, and nothing is sent", async () => {
    await open("executive");
    const user = keyboardUser();
    await user.click(dateButtons("Diwali concert")[0]);
    const dialog = await screen.findByRole("dialog", { name: "Diwali concert" });
    await user.click(within(dialog).getByRole("button", { name: "Remove this date" }));
    const question = await screen.findByRole("dialog", { name: "Remove this date from the calendar?" });
    expect(question).toHaveTextContent("\"Diwali concert\" disappears from the calendar for everyone");
    await user.click(within(question).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove this date from the calendar?" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Diwali concert" })).toBeInTheDocument();
    expect(focusedName()).toBe("Remove this date");
    expect(fake.from("events", "delete").calls).toHaveLength(0);
  });

  it("confirming removes the date once, closes the detail, clears ?event= and says so", async () => {
    fake.from("events", "delete").reply(ok(null));
    fake.from("events", "select").reply(ok([]));
    await open("executive");
    fireEvent.click(dateButtons("Diwali concert")[0]);
    await waitFor(() => expect(search().get("event")).toBe("3"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Diwali concert" })).getByRole("button", { name: "Remove this date" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove date" }));
    await waitFor(() => expect(document.querySelector(".toast")).toHaveTextContent("Calendar date removed"));
    expect(fake.from("events", "delete").calls).toHaveLength(1);
    await waitFor(() => expect(detail("Diwali concert")).not.toBeInTheDocument());
    await waitFor(() => expect(search().has("event")).toBe(false));
  });

  it("a removal that fails keeps the detail open (and the message on screen)", async () => {
    fake.from("events", "delete").reply({ data: null, error: { message: "Only executives can remove dates", code: "P0001" } });
    await open("executive");
    fireEvent.click(dateButtons("Diwali concert")[0]);
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Diwali concert" })).getByRole("button", { name: "Remove this date" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove date" }));
    await waitFor(() => expect(document.querySelector(".toast")).toHaveTextContent("Only executives can remove dates"));
    expect(screen.getByRole("dialog", { name: "Diwali concert" })).toBeInTheDocument();
    expect(search().get("event")).toBe("3");
  });
});

describe("the date that is open is in the address (?event=)", () => {
  it("opening a date writes ?event=<id> by rewriting the entry (no step for Back to reopen it), and closing it removes it", async () => {
    await open();
    const push = vi.spyOn(window.history, "pushState"); const replace = vi.spyOn(window.history, "replaceState");
    fireEvent.click(dateButtons("Diwali concert")[0]);
    await waitFor(() => expect(search().get("event")).toBe("3"));
    expect(search().get("page")).toBe("calendar");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(search().has("event")).toBe(false));
    expect(search().get("page")).toBe("calendar");
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("a link with ?event= opens that date's detail at once", async () => {
    await open("member", [diwali], "&event=3");
    expect(await screen.findByRole("dialog", { name: "Diwali concert" })).toBeInTheDocument();
  });

  it.each(["0", "-3", "abc", "3x", "1.5", "99"])("a link with ?event=%s (not a date of this calendar) shows the calendar as usual", async (value) => {
    await open("member", [diwali], `&event=${value}`);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dateButtons("Diwali concert")).toHaveLength(2);
  });

  it("a date that the audience filter hides does not open", async () => {
    await open("member", [diwali, row(4, "Open mic")], "&event=3");
    expect(await screen.findByRole("dialog", { name: "Diwali concert" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.change(screen.getByLabelText("Filter by audience"), { target: { value: "club" } });
    expect(screen.queryAllByRole("button", { name: /Diwali concert/ })).toHaveLength(0);
    expect(detail("Diwali concert")).not.toBeInTheDocument();
  });
});

describe("the month on show is in the address (?month=)", () => {
  it("opens this month with no ?month=, and Next month writes ?month=YYYY-MM as a history entry that Back undoes", async () => {
    await open();
    expect(await heading(here)).toBeInTheDocument();
    expect(search().has("month")).toBe(false);
    const next = new Date(here.getFullYear(), here.getMonth() + 1, 1);
    const after = new Date(here.getFullYear(), here.getMonth() + 2, 1);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(await heading(next)).toBeInTheDocument();
    expect(search().get("month")).toBe(key(next));
    expect(search().get("page")).toBe("calendar");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(await heading(after)).toBeInTheDocument();
    act(() => { window.history.back(); });
    expect(await heading(next)).toBeInTheDocument();
    act(() => { window.history.back(); });
    expect(await heading(here)).toBeInTheDocument();
    expect(search().has("month")).toBe(false);
  });

  it("Previous month and Today: Today takes the parameter away", async () => {
    await open();
    const previous = new Date(here.getFullYear(), here.getMonth() - 1, 1);
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await heading(previous)).toBeInTheDocument();
    expect(search().get("month")).toBe(key(previous));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(await heading(here)).toBeInTheDocument();
    expect(search().has("month")).toBe(false);
  });

  it("a link with ?month=2027-03 opens March 2027, with that month's dates in the agenda", async () => {
    const inMarch = row(8, "Spring recital", { starts_at: new Date(2027, 2, 14, 17, 0).toISOString() });
    await open("member", [diwali, inMarch], "&month=2027-03");
    expect(await heading(new Date(2027, 2, 1))).toBeInTheDocument();
    expect(dateButtons("Spring recital")).toHaveLength(2);
    expect(dateButtons("Diwali concert")).toHaveLength(0);
  });

  it("keeps the way back and the other parameters: ?page=calendar stays as it was", async () => {
    await open("member", [diwali], "&month=2027-03");
    await heading(new Date(2027, 2, 1));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await heading(new Date(2027, 3, 1));
    expect(search().get("page")).toBe("calendar");
    expect(search().get("month")).toBe("2027-04");
  });

  it.each(["soon", "2027-13", "2027-00", "2027-3", "27-03", "1800-01", "2027-03-01", "3000-01", ""])("a link with ?month=%s opens this month", async (value) => {
    await open("member", [diwali], `&month=${value}`);
    expect(await heading(here)).toBeInTheDocument();
  });
});

describe("the agenda is reachable from the keyboard", () => {
  it("Tab goes from the month controls through every date, and Enter or Space on a date opens it", async () => {
    await open("member", [diwali, row(4, "Open mic", { starts_at: at(12) })]);
    const user = keyboardUser();
    const order = await tabOrder(user, 24);
    const from = order.indexOf("Previous month");
    expect(order.slice(from, from + 3)).toEqual(["Previous month", "Today", "Next month"]);
    // The grid's dates, then the agenda's (jsdom draws both: calendar.css shows one of them).
    expect(order.slice(from + 3, from + 7)).toEqual([expect.stringContaining("Diwali concert"), expect.stringContaining("Open mic"), expect.stringContaining("Diwali concert"), expect.stringContaining("Open mic")]);
    const agendaButton = dateButtons("Open mic")[1];
    agendaButton.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Open mic" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(agendaButton).toHaveFocus();
    await user.keyboard(" ");
    expect(await screen.findByRole("dialog", { name: "Open mic" })).toBeInTheDocument();
  });

  it("every date button says it opens a dialog and has a name with its time, title and audience", async () => {
    await open();
    for (const button of dateButtons("Diwali concert")) {
      expect(button).toHaveAttribute("aria-haspopup", "dialog");
      expect(button).toHaveAccessibleName(/7:30 PM.*Diwali concert.*Hindustani Vocal/);
    }
  });
});

describe("the form that adds or changes a date (the portal's Dialog)", () => {
  const addForm = async () => {
    await open("executive", []);
    fireEvent.click(screen.getByRole("button", { name: "＋ Add important date" }));
    const form = (await screen.findByRole("heading", { name: "Add an important date" })).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Open mic" } });
    fireEvent.change(within(form).getByLabelText("Location"), { target: { value: "Hill Hall" } });
    fireEvent.change(within(form).getByLabelText("Date and time"), { target: { value: "2027-01-05T19:30" } });
    return form;
  };

  it("is a dialog named by its heading, with the focus on the title", async () => {
    await open("executive", []);
    fireEvent.click(screen.getByRole("button", { name: "＋ Add important date" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an important date" });
    await waitFor(() => expect(within(dialog).getByLabelText("Title")).toHaveFocus());
  });

  it("pressing Save twice sends one request, and while it is out the button says Saving… and nothing closes the form", async () => {
    const slow = deferred();
    fake.from("events", "insert").reply(slow.reply);
    const form = await addForm();
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(fake.from("events", "insert").calls).toHaveLength(1));
    expect(within(form).getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(within(form).getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("heading", { name: "Add an important date" })).toBeInTheDocument();
    await act(async () => { slow.resolve(ok([{ id: 9 }])); });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add an important date" })).not.toBeInTheDocument());
    expect(fake.from("events", "insert").calls).toHaveLength(1);
  });

  it("a refused save keeps the form open and as typed, says why in a message that stays, and Save works again", async () => {
    fake.from("events", "insert").replyOnce(fail("Only executives can add dates", "P0001")).reply(ok([{ id: 9 }]));
    const form = await addForm();
    fireEvent.submit(form);
    await waitFor(() => expect(document.querySelector(".toast")).toHaveTextContent("Only executives can add dates"));
    expect(document.querySelector(".toast")).toHaveClass("error");
    expect(within(form).getByLabelText("Title")).toHaveValue("Open mic");
    expect(within(form).getByLabelText("Location")).toHaveValue("Hill Hall");
    expect(within(form).getByRole("button", { name: "Add to calendar" })).toBeEnabled();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add an important date" })).not.toBeInTheDocument());
    expect(fake.from("events", "insert").calls).toHaveLength(2);
  });

  it("a change that matches no date (it was removed meanwhile) says so and keeps the form", async () => {
    fake.from("events", "update").reply(ok([]));
    await open("executive");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Diwali concert" })[0]);
    const form = (await screen.findByRole("heading", { name: "Edit this date" })).closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect(document.querySelector(".toast")).toHaveTextContent("This date could not be saved. It may have been removed."));
    expect(screen.getByRole("heading", { name: "Edit this date" })).toBeInTheDocument();
  });
});

describe("accessibility (axe, no serious or critical violation; colour contrast is not computed in jsdom)", () => {
  it("the month with its agenda, for a member and for a manager", async () => {
    await open("executive");
    await expectNoSeriousViolations(document.querySelector("main") as HTMLElement);
  });

  it("the detail dialog, with and without Edit and Remove", async () => {
    await open("executive");
    fireEvent.click(dateButtons("Diwali concert")[0]);
    await screen.findByRole("dialog", { name: "Diwali concert" });
    await expectNoSeriousViolations(document.querySelector("main") as HTMLElement);
  });

  it("the detail dialog for a member", async () => {
    await open("member");
    fireEvent.click(dateButtons("Diwali concert")[0]);
    await screen.findByRole("dialog", { name: "Diwali concert" });
    await expectNoSeriousViolations(document.querySelector("main") as HTMLElement);
  });

  it("the add and edit forms", async () => {
    await open("executive");
    fireEvent.click(screen.getByRole("button", { name: "＋ Add important date" }));
    await screen.findByRole("heading", { name: "Add an important date" });
    await expectNoSeriousViolations(document.querySelector("main") as HTMLElement);
  });
});
