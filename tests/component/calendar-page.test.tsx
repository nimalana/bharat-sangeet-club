// The pieces of features/calendar, one by one (calendar-flows.test.tsx drives them together through the shell):
// matchesScope / eventsInScope (model.ts), CalendarPage, CalendarView, useCalendarPage and CalendarDialogs.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../components/ui/confirm";
import { ToastProvider, ToastViewport } from "../../components/ui/toast";
import { CalendarDialogs } from "../../features/calendar/components/calendar-dialogs";
import { CalendarPage } from "../../features/calendar/components/calendar-page";
import { CalendarView } from "../../features/calendar/components/calendar-view";
import { useCalendarPage } from "../../features/calendar/hooks/use-calendar-page";
import { eventsInScope, matchesScope, scopeName } from "../../features/calendar/model";
import type { ClubEvent, Subgroup } from "../../lib/db";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { userOf } from "../support/helpers";
import type { ReactNode } from "react";

const now = new Date();
const inThisMonth = (day: number, hour = 18) => new Date(now.getFullYear(), now.getMonth(), day, hour, 0).toISOString();
const event = (id: number, title: string, subgroupId: number | null = null, over: Partial<ClubEvent> = {}): ClubEvent =>
  ({ id, title, description: "", starts_at: inThisMonth(10), location: "", created_at: "2026-01-01T00:00:00Z", subgroup_id: subgroupId, ...over });
const group = (id: number, name: string): Subgroup => ({ id, name, description: "", enrollment_mode: "open", archived_at: null });
const vocal = group(7, "Hindustani Vocal");
const violin = group(8, "Carnatic Violin");

describe("matchesScope and eventsInScope", () => {
  it("all shows everything; club only what has no group; a number only that group", () => {
    expect([null, undefined, 0, 7, 8].map((id) => matchesScope(id, "all"))).toEqual([true, true, true, true, true]);
    expect([null, undefined, 0, 7, 8].map((id) => matchesScope(id, "club"))).toEqual([true, true, true, false, false]);
    expect([null, undefined, 7, 8].map((id) => matchesScope(id, 7))).toEqual([false, false, true, false]);
  });

  it("keeps the order it was given and does not change the list", () => {
    const events = [event(1, "Picnic"), event(2, "Vocal", 7), event(3, "Violin", 8), event(4, "Vocal again", 7)];
    expect(eventsInScope(events, "all")).toEqual(events);
    expect(eventsInScope(events, "club").map((item) => item.id)).toEqual([1]);
    expect(eventsInScope(events, 7).map((item) => item.id)).toEqual([2, 4]);
    expect(eventsInScope(events, 9)).toEqual([]);
    expect(events).toHaveLength(4);
  });
});

describe("scopeName", () => {
  it("is Club-wide with no group (null, undefined or 0), the group's name, and 'Group' when the group is not in the list", () => {
    expect([null, undefined, 0].map((id) => scopeName(id, [vocal]))).toEqual(["Club-wide", "Club-wide", "Club-wide"]);
    expect(scopeName(7, [vocal, violin])).toBe("Hindustani Vocal");
    expect(scopeName(9, [vocal, violin])).toBe("Group");
    expect(scopeName(7, [])).toBe("Group");
  });
});

describe("CalendarPage", () => {
  const props = (over: Partial<Parameters<typeof CalendarPage>[0]> = {}): Parameters<typeof CalendarPage>[0] => ({
    events: [event(1, "Picnic"), event(2, "Vocal class", 7)], groups: [vocal, violin], availableGroups: [vocal], canManage: false, loading: false,
    scope: "all", onScopeChange: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), ...over,
  });
  const titles = () => Array.from(document.querySelectorAll(".calendar-grid .calendar-event b")).map((item) => item.textContent);

  it("has its title, what the page is for and the audience filter", () => {
    render(<CalendarPage {...props()} />);
    expect(screen.getByText("CLUB CALENDAR")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Important dates" })).toBeInTheDocument();
    expect(screen.getByText("Club and subgroup rehearsals, performances, meetings, and deadlines in one calendar.")).toBeInTheDocument();
    expect(screen.getByText("Every date shows who it is for")).toBeInTheDocument();
    // The filter lists the groups it was given (the ones the person may filter by), not every group.
    expect(within(screen.getByLabelText("Filter by audience")).getAllByRole("option").map((option) => option.textContent)).toEqual(["All activity", "Club-wide", "Hindustani Vocal"]);
  });

  it("draws the dates the scope lets through, with every group named for who the date is for", () => {
    const { rerender } = render(<CalendarPage {...props()} />);
    expect(titles()).toEqual(["Picnic", "Vocal class"]);
    // The audience of each date is named from `groups` (all of them), whatever the filter offers.
    expect(Array.from(document.querySelectorAll(".calendar-grid .calendar-scope")).map((item) => item.textContent)).toEqual(["Club-wide", "Hindustani Vocal"]);
    rerender(<CalendarPage {...props({ scope: "club" })} />);
    expect(titles()).toEqual(["Picnic"]);
    rerender(<CalendarPage {...props({ scope: 7 })} />);
    expect(titles()).toEqual(["Vocal class"]);
    expect(screen.getByLabelText("Filter by audience")).toHaveValue("group:7");
  });

  it("tells the caller which audience was chosen: a number for a group, the word for the others", () => {
    const onScopeChange = vi.fn();
    render(<CalendarPage {...props({ onScopeChange })} />);
    fireEvent.change(screen.getByLabelText("Filter by audience"), { target: { value: "group:7" } });
    fireEvent.change(screen.getByLabelText("Filter by audience"), { target: { value: "club" } });
    expect(onScopeChange.mock.calls).toEqual([[7], ["club"]]);
  });

  it("offers Add important date only to a manager, and the date's own controls with it", () => {
    const onAdd = vi.fn(); const onEdit = vi.fn(); const onDelete = vi.fn();
    const { rerender } = render(<CalendarPage {...props({ onAdd, onEdit, onDelete })} />);
    expect(screen.queryByRole("button", { name: "＋ Add important date" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    rerender(<CalendarPage {...props({ onAdd, onEdit, onDelete, canManage: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ Add important date" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Vocal class" })[0]);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 2, title: "Vocal class" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Vocal class" })[0]);
    expect(onDelete).toHaveBeenCalledWith(2, "Vocal class");
  });

  it("shows a placeholder instead of the month while it is loading (announced as Loading the calendar), and keeps the title and the filter", () => {
    const { rerender } = render(<CalendarPage {...props({ loading: true, canManage: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the calendar");
    expect(document.querySelector(".calendar-skeleton .skeleton")).not.toBeNull();
    expect(document.querySelector(".month-calendar")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Important dates" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by audience")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ Add important date" })).toBeInTheDocument();
    rerender(<CalendarPage {...props()} />);
    expect(screen.queryByText("Loading the calendar")).not.toBeInTheDocument();
    expect(document.querySelector(".month-calendar")).not.toBeNull();
  });
});

describe("CalendarView", () => {
  const monthName = (date: Date) => date.toLocaleString("en-US", { month: "long", year: "numeric" });
  const view = (events: ClubEvent[] = [], extra: Partial<Parameters<typeof CalendarView>[0]> = {}) =>
    render(<CalendarView events={events} groups={[vocal]} canManage={false} onEdit={vi.fn()} onDelete={vi.fn()} {...extra} />);

  // The month is the address now (?month=, calendar-detail.test.tsx), which the page writes a moment after the press: the heading follows it.
  it("opens on this month, and the arrows and Today move between months", async () => {
    view();
    expect(screen.getByRole("heading", { level: 2, name: monthName(now) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByRole("heading", { level: 2, name: monthName(new Date(now.getFullYear(), now.getMonth() + 1, 1)) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByRole("heading", { level: 2, name: monthName(now) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByRole("heading", { level: 2, name: monthName(new Date(now.getFullYear(), now.getMonth() - 1, 1)) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByRole("heading", { level: 2, name: monthName(now) })).toBeInTheDocument();
  });

  it("draws six weeks of days, and puts a date in its day and in the agenda of the month", () => {
    view([event(1, "Rehearsal", 7, { location: "Hill Hall", description: "Bring a shawl", starts_at: inThisMonth(10, 18) })]);
    expect(document.querySelectorAll(".calendar-grid .calendar-cell")).toHaveLength(42);
    const cell = Array.from(document.querySelectorAll(".calendar-cell:not(.outside)")).find((item) => item.querySelector(".calendar-event"))!;
    expect(cell.querySelector(".day-number")).toHaveTextContent("10");
    expect(within(cell as HTMLElement).getByText("Rehearsal")).toBeInTheDocument();
    expect(cell.querySelector(".calendar-scope")).toHaveTextContent("Hindustani Vocal");
    expect(cell.querySelector("small:not(.calendar-scope)")).toHaveTextContent("Hill Hall");
    const agenda = document.querySelector(".calendar-agenda-event")!;
    expect(agenda).toHaveTextContent("Rehearsal");
    expect(agenda).toHaveTextContent("Bring a shawl");
    expect(agenda.querySelector("time")).toHaveTextContent("6:00 PM");
  });

  it("names a date of a group that is not in the list 'Group', and a date with no group 'Club-wide'", () => {
    view([event(1, "Gone group", 99), event(2, "Whole club", null)]);
    expect(Array.from(document.querySelectorAll(".calendar-agenda-event .calendar-scope")).map((item) => item.textContent)).toEqual(["Group", "Club-wide"]);
  });

  it("says there are no dates when the list is empty (under the agenda and under the grid)", () => {
    view([]);
    expect(screen.getAllByText("No dates in this view.")).toHaveLength(2);
  });

  it("says so in the agenda only, when other months have dates but the one shown has none", async () => {
    view([event(1, "Rehearsal")]);
    expect(screen.queryByText("No dates in this view.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findAllByText("No dates in this view.")).toHaveLength(1);
    expect(document.querySelector(".calendar-agenda")).toHaveTextContent("No dates in this view.");
    // The grid still has its six weeks.
    expect(document.querySelectorAll(".calendar-grid .calendar-cell")).toHaveLength(42);
  });

  it("orders the agenda by time and groups dates on the same day", () => {
    view([event(1, "Late", null, { starts_at: inThisMonth(12, 20) }), event(2, "Early", null, { starts_at: inThisMonth(12, 9) }), event(3, "Other day", null, { starts_at: inThisMonth(11, 12) })]);
    const days = Array.from(document.querySelectorAll(".calendar-agenda-day"));
    expect(days.map((day) => Array.from(day.querySelectorAll("article b")).map((item) => item.textContent))).toEqual([["Other day"], ["Early", "Late"]]);
  });
});

describe("useCalendarPage", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider><ConfirmProvider>{children}</ConfirmProvider><ToastViewport /></ToastProvider>;
  const toast = () => document.querySelector(".toast") as HTMLElement | null;

  it("starts with every audience, the forms closed", () => {
    const { result } = renderHook(() => useCalendarPage({ onChanged: vi.fn() }), { wrapper });
    expect(result.current).toMatchObject({ scope: "all", adding: false, editing: null });
  });

  it("keeps the audience, and which date is open for editing, until they are changed", () => {
    const { result } = renderHook(() => useCalendarPage({ onChanged: vi.fn() }), { wrapper });
    act(() => { result.current.setScope(7); result.current.setAdding(true); result.current.setEditing(event(5, "Rehearsal")); });
    expect(result.current).toMatchObject({ scope: 7, adding: true, editing: { id: 5 } });
  });

  // Phase 3.4: the question is the shared confirmation dialog (window.confirm was the only one in the portal), and says which date.
  it("remove: asks first, naming the date, and does nothing when the person says no (Cancel, or Escape)", async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useCalendarPage({ onChanged }), { wrapper });
    let answer!: Promise<boolean>;
    act(() => { answer = result.current.remove(3, "Diwali concert"); });
    const question = await screen.findByRole("dialog", { name: "Remove this date from the calendar?" });
    expect(question).toHaveTextContent("\"Diwali concert\" disappears from the calendar for everyone. Nothing else is changed.");
    // Destructive: Remove date is the danger button, and Enter on the opening focus (Cancel) never removes by accident.
    expect(within(question).getByRole("button", { name: "Remove date" }).className).toMatch(/8b2832/);
    expect(within(question).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(await answer).toBe(false);
    act(() => { answer = result.current.remove(3); });
    await screen.findByRole("dialog", { name: "Remove this date from the calendar?" });
    expect(screen.getByRole("dialog")).toHaveTextContent("It disappears from the calendar for everyone.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await answer).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
    expect(onChanged).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
  });

  it("remove: deletes that row, says so, asks the shell to read the lists again, and answers true", async () => {
    fake.from("events", "delete").reply(ok(null));
    const onChanged = vi.fn();
    const { result } = renderHook(() => useCalendarPage({ onChanged }), { wrapper });
    let answer!: Promise<boolean>;
    act(() => { answer = result.current.remove(3, "Diwali concert"); });
    fireEvent.click(await screen.findByRole("button", { name: "Remove date" }));
    expect(await answer).toBe(true);
    expect(fake.from("events", "delete").calls[0].used("eq", "id", 3)).toBe(true);
    await waitFor(() => expect(toast()).toHaveTextContent("Calendar date removed"));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("remove: a failure shows the database's own sentence as an error, reads nothing again and answers false", async () => {
    fake.from("events", "delete").reply(fail("Only executives can remove dates"));
    const onChanged = vi.fn();
    const { result } = renderHook(() => useCalendarPage({ onChanged }), { wrapper });
    let answer!: Promise<boolean>;
    act(() => { answer = result.current.remove(3); });
    fireEvent.click(await screen.findByRole("button", { name: "Remove date" }));
    expect(await answer).toBe(false);
    await waitFor(() => expect(toast()).toHaveTextContent("Only executives can remove dates"));
    expect(toast()).toHaveClass("error");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("remove: a raw database sentence is not shown, the one the screen wrote is", async () => {
    fake.from("events", "delete").reply(fail('update or delete on table "events" violates foreign key constraint', "23503"));
    const { result } = renderHook(() => useCalendarPage({ onChanged: vi.fn() }), { wrapper });
    act(() => { void result.current.remove(3); });
    fireEvent.click(await screen.findByRole("button", { name: "Remove date" }));
    await waitFor(() => expect(toast()).toHaveClass("error"));
    expect(toast()?.textContent).not.toMatch(/foreign key|violates/);
  });

  it("remove: pressed again while the first is asking or running, it does nothing: one question, one request", async () => {
    const slow = deferred();
    fake.from("events", "delete").reply(slow.reply);
    const { result } = renderHook(() => useCalendarPage({ onChanged: vi.fn() }), { wrapper });
    let first!: Promise<boolean>; let second!: Promise<boolean>; let third!: Promise<boolean>;
    act(() => { first = result.current.remove(3); second = result.current.remove(3); });
    expect(await second).toBe(false);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: "Remove date" }));
    await waitFor(() => expect(fake.from("events", "delete").calls).toHaveLength(1));
    act(() => { third = result.current.remove(3); });
    expect(await third).toBe(false);
    await act(async () => { slow.resolve(ok(null)); });
    expect(await first).toBe(true);
    expect(fake.from("events", "delete").calls).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("CalendarDialogs", () => {
  const user = userOf("u-me");
  const state = (over: Partial<Parameters<typeof CalendarDialogs>[0]["calendar"]> = {}) =>
    ({ adding: false, setAdding: vi.fn(), editing: null, setEditing: vi.fn(), ...over });
  const dialogs = (calendar: ReturnType<typeof state>, onChanged = vi.fn()) =>
    render(<ToastProvider><CalendarDialogs user={user} groups={[vocal]} calendar={calendar} onChanged={onChanged} /><ToastViewport /></ToastProvider>);

  it("draws nothing while both are closed", () => {
    const { container } = dialogs(state());
    expect(container.querySelector(".modal-backdrop")).toBeNull();
  });

  it("the add form closes itself, reads the lists again and says the date was added once the date is saved", async () => {
    fake.from("events", "insert").reply(ok([{ id: 9 }]));
    const calendar = state({ adding: true });
    const onChanged = vi.fn();
    dialogs(calendar, onChanged);
    const add = screen.getByRole("heading", { name: "Add an important date" }).closest("form")!;
    fireEvent.change(within(add).getByLabelText("Title"), { target: { value: "Open mic" } });
    fireEvent.change(within(add).getByLabelText("Date and time"), { target: { value: "2026-12-01T19:00" } });
    fireEvent.submit(add);
    await waitFor(() => expect(calendar.setAdding).toHaveBeenCalledWith(false));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".toast")).toHaveTextContent("Important date added");
  });

  it("the edit form is for the date it was given, and says the date was updated", async () => {
    fake.from("events", "update").reply(ok([{ id: 5 }]));
    const calendar = state({ editing: event(5, "Rehearsal") });
    const onChanged = vi.fn();
    dialogs(calendar, onChanged);
    const edit = screen.getByRole("heading", { name: "Edit this date" }).closest("form")!;
    expect(within(edit).getByLabelText("Title")).toHaveValue("Rehearsal");
    fireEvent.submit(edit);
    await waitFor(() => expect(calendar.setEditing).toHaveBeenCalledWith(null));
    expect(fake.from("events", "update").calls[0].used("eq", "id", 5)).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".toast")).toHaveTextContent("Calendar date updated");
  });

  it("a different date given to the edit form starts the form over with that date's values", () => {
    const render1 = (calendar: ReturnType<typeof state>) => <ToastProvider><CalendarDialogs user={user} groups={[vocal]} calendar={calendar} onChanged={vi.fn()} /></ToastProvider>;
    const { rerender } = render(render1(state({ editing: event(5, "Rehearsal") })));
    expect(screen.getByLabelText("Title")).toHaveValue("Rehearsal");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Typed over" } });
    rerender(render1(state({ editing: event(6, "Concert") })));
    expect(screen.getByLabelText("Title")).toHaveValue("Concert");
  });

  it("both can be open at once, in this order, each closing only itself", () => {
    const calendar = state({ adding: true, editing: event(5, "Rehearsal") });
    dialogs(calendar);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((item) => item.textContent);
    expect(headings).toEqual(["Add an important date", "Edit this date"]);
    fireEvent.click(document.querySelectorAll(".modal-close")[1]);
    expect(calendar.setEditing).toHaveBeenCalledWith(null);
    expect(calendar.setAdding).not.toHaveBeenCalled();
  });
});
