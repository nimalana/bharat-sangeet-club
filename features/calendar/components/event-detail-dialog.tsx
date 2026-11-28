"use client";

import { useId } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import type { ClubEvent, GroupOption } from "../../../lib/db";
import { scopeName } from "../model";

/**
 * One date of the calendar, read-only: its title, when, where, who it is for and the details, in the portal's Dialog (named by the title,
 * Escape and Close close it, focus goes back to the date that was pressed). A manager also gets Edit and Remove, the two things the
 * date's own small buttons already do: Edit opens the form on top of this dialog (and returns here), Remove asks first.
 */
export function EventDetailDialog({ event, groups, canManage, onClose, onEdit, onRemove }: {
  event: ClubEvent; groups: GroupOption[]; canManage: boolean; onClose: () => void; onEdit: (event: ClubEvent) => void; onRemove: (event: ClubEvent) => void;
}) {
  const titleId = useId();
  const start = new Date(event.starts_at);
  return <Dialog open onClose={onClose} labelledBy={titleId} className="modal event-detail">
    <IconButton aria-label="Close" className="modal-close" onClick={onClose}>×</IconButton>
    <p className="eyebrow">CLUB CALENDAR</p>
    <h2 id={titleId}>{event.title}</h2>
    <dl className="event-facts">
      <div><dt>When</dt><dd><time dateTime={event.starts_at}>{start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} at {start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time></dd></div>
      <div><dt>For</dt><dd>{scopeName(event.subgroup_id, groups)}</dd></div>
      {event.location && <div><dt>Where</dt><dd>{event.location}</dd></div>}
      {event.description && <div><dt>Details</dt><dd className="event-details">{event.description}</dd></div>}
    </dl>
    {canManage && <div className="event-actions">
      <Button variant="secondary" onClick={() => onEdit(event)}>Edit this date</Button>
      <Button variant="danger" onClick={() => onRemove(event)}>Remove this date</Button>
    </div>}
  </Dialog>;
}
