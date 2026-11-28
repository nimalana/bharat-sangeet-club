"use client";

import { useState } from "react";
import type { ClubEvent, Subgroup } from "../../../lib/portal-types";

export function CalendarView({ events, groups, canManage, onEdit, onDelete }: { events: ClubEvent[]; groups: Subgroup[]; canManage: boolean; onEdit: (event: ClubEvent) => void; onDelete: (eventId: number) => void }) {
  const [cursor, setCursor] = useState(() => { const today = new Date(); return new Date(today.getFullYear(), today.getMonth(), 1); });
  const year = cursor.getFullYear(); const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const calendarStart = new Date(year, month, 1 - firstDay);
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(calendarStart); day.setDate(calendarStart.getDate() + index); return day; });
  const today = new Date();
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

  return <div className="month-calendar"><div className="calendar-controls"><button onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Previous month">←</button><h2>{cursor.toLocaleString("en-US", { month: "long", year: "numeric" })}</h2><div><button className="today-button" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button><button onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Next month">→</button></div></div><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((day) => { const dayEvents = events.filter((item) => sameDay(new Date(item.starts_at), day)); return <div className={`calendar-cell ${day.getMonth() !== month ? "outside" : ""} ${sameDay(day, today) ? "today" : ""}`} key={day.toISOString()}><span className="day-number">{day.getDate()}</span><div className="day-events">{dayEvents.map((item) => <div className="calendar-event" key={item.id} title={[item.description, item.location].filter(Boolean).join(" · ")}><time>{new Date(item.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time><b>{item.title}</b><small className="calendar-scope">{item.subgroup_id ? groups.find((group) => group.id === item.subgroup_id)?.name || "Group" : "Club-wide"}</small>{item.location && <small>{item.location}</small>}{canManage && <><button className="calendar-edit" onClick={() => onEdit(item)} aria-label={`Edit ${item.title}`}>✎</button><button onClick={() => onDelete(item.id)} aria-label={`Delete ${item.title}`}>×</button></>}</div>)}</div></div>; })}</div><div className="calendar-agenda">{agendaDays.length ? agendaDays.map((day) => <section className="calendar-agenda-day" key={day.key}><h3><time dateTime={day.date.toISOString()}>{day.date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</time></h3><div>{day.events.map((item) => <article className="calendar-agenda-event" key={item.id}><time dateTime={item.starts_at}>{new Date(item.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time><b>{item.title}</b><small className="calendar-scope">{item.subgroup_id ? groups.find((group) => group.id === item.subgroup_id)?.name || "Group" : "Club-wide"}</small>{item.location && <small>{item.location}</small>}{item.description && <p>{item.description}</p>}{canManage && <><button className="calendar-edit" onClick={() => onEdit(item)} aria-label={`Edit ${item.title}`}>✎</button><button onClick={() => onDelete(item.id)} aria-label={`Delete ${item.title}`}>×</button></>}</article>)}</div></section>) : <p className="calendar-agenda-empty">No dates in this view.</p>}</div>{events.length === 0 && <p className="calendar-empty">No dates in this view.</p>}</div>;
}
