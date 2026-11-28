"use client";

import type { ClubEvent, GroupOption } from "../../../lib/db";
import { positiveInteger, useUrlState } from "../../../lib/hooks/use-url-state";
import { scopeName } from "../model";
import { EventDetailDialog } from "./event-detail-dialog";

// The month on show is the address: ?month=2026-11 (absent: this month), and the date whose detail is open is ?event=12. A link or a reload opens
// them, Back steps back through the months, and a value that is not one (?month=soon, ?event=0) is the usual view. The month is a history
// entry of its own ("push"); opening a date only rewrites the entry ("replace"), so that Close does not leave a step that Back would reopen.
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const parseMonth = (raw: string): string | undefined => { const hit = MONTH_PATTERN.exec(raw); return hit && Number(hit[1]) >= 1970 && Number(hit[1]) <= 2200 ? raw : undefined; };
const MONTH = { parse: parseMonth, defaultValue: null, serialize: (value: string | null) => value ?? "", history: "push" } as const;
const EVENT = { parse: positiveInteger, defaultValue: null, history: "replace" } as const;
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The month grid (the agenda list takes its place under 700px: calendar.css) with every date of it as a button that opens its detail.
 * `onDelete` may answer true when the date was removed, which closes the detail that asked for it.
 */
export function CalendarView({ events, groups, canManage, onEdit, onDelete }: {
  events: ClubEvent[]; groups: GroupOption[]; canManage: boolean; onEdit: (event: ClubEvent) => void; onDelete: (eventId: number, title?: string) => void | boolean | Promise<void | boolean>;
}) {
  const [monthText, setMonthText] = useUrlState<string | null>("month", MONTH);
  const [selectedId, setSelectedId] = useUrlState<number | null>("event", EVENT);
  const today = new Date();
  const cursor = monthText ? new Date(Number(monthText.slice(0, 4)), Number(monthText.slice(5)) - 1, 1) : new Date(today.getFullYear(), today.getMonth(), 1);
  const year = cursor.getFullYear(); const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const calendarStart = new Date(year, month, 1 - firstDay);
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(calendarStart); day.setDate(calendarStart.getDate() + index); return day; });
  const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  const agendaEvents = events.filter((event) => {
    const date = new Date(event.starts_at);
    return date.getFullYear() === year && date.getMonth() === month;
  }).sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const agendaDays = agendaEvents.reduce<Array<{ key: string; date: Date; events: ClubEvent[] }>>((daysForAgenda, event) => {
    const date = new Date(event.starts_at);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const existingDay = daysForAgenda.find((day) => day.key === key);
    if (existingDay) existingDay.events.push(event);
    else daysForAgenda.push({ key, date, events: [event] });
    return daysForAgenda;
  }, []);
  const selected = selectedId === null ? null : events.find((item) => item.id === selectedId) ?? null;

  const open = (item: ClubEvent) => <button type="button" className="calendar-event-open" aria-haspopup="dialog" onClick={() => setSelectedId(item.id)}>
    <time dateTime={item.starts_at}>{timeOf(item.starts_at)}</time>{" "}<b>{item.title}</b>{" "}<small className="calendar-scope">{scopeName(item.subgroup_id, groups)}</small>{item.location && <>{" "}<small>{item.location}</small></>}
  </button>;
  const actions = (item: ClubEvent) => canManage && <>
    <button type="button" className="calendar-edit" onClick={() => onEdit(item)} aria-label={`Edit ${item.title}`}>✎</button>
    <button type="button" onClick={() => onDelete(item.id, item.title)} aria-label={`Delete ${item.title}`}>×</button>
  </>;

  return <div className="month-calendar"><div className="calendar-controls"><button type="button" onClick={() => setMonthText(monthKey(new Date(year, month - 1, 1)))} aria-label="Previous month">←</button><h2>{cursor.toLocaleString("en-US", { month: "long", year: "numeric" })}</h2><div><button type="button" className="today-button" onClick={() => setMonthText(null)}>Today</button><button type="button" onClick={() => setMonthText(monthKey(new Date(year, month + 1, 1)))} aria-label="Next month">→</button></div></div><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((day) => { const dayEvents = events.filter((item) => sameDay(new Date(item.starts_at), day)); return <div className={`calendar-cell ${day.getMonth() !== month ? "outside" : ""} ${sameDay(day, today) ? "today" : ""}`} key={day.toISOString()}><span className="day-number">{day.getDate()}</span><div className="day-events">{dayEvents.map((item) => <div className="calendar-event" key={item.id} title={[item.description, item.location].filter(Boolean).join(" · ")}>{open(item)}{actions(item)}</div>)}</div></div>; })}</div><div className="calendar-agenda">{agendaDays.length ? agendaDays.map((day) => <section className="calendar-agenda-day" key={day.key}><h3><time dateTime={day.date.toISOString()}>{day.date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</time></h3><div>{day.events.map((item) => <article className={`calendar-agenda-event${canManage ? " has-actions" : ""}`} key={item.id}>{open(item)}{item.description && <p>{item.description}</p>}{actions(item)}</article>)}</div></section>) : <p className="calendar-agenda-empty">No dates in this view.</p>}</div>{events.length === 0 && <p className="calendar-empty">No dates in this view.</p>}
    {selected && <EventDetailDialog key={selected.id} event={selected} groups={groups} canManage={canManage} onClose={() => setSelectedId(null)} onEdit={onEdit}
      onRemove={async (item) => { if (await onDelete(item.id, item.title) === true) setSelectedId(null); }} />}
  </div>;
}
