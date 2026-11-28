"use client";

import { PageTitle } from "../../../components/ui/page-title";
import { SkeletonRows } from "../../../components/ui/skeleton";
import type { ClubEvent, ScopeFilter, Subgroup } from "../../../lib/db";
import { ScopeFilterBar } from "./scope-filter-bar";
import { eventsInScope } from "../model";
import { CalendarView } from "./calendar-view";

type CalendarPageProps = {
  events: ClubEvent[];
  /** Every group, to name the audience of a date. */
  groups: Subgroup[];
  /** The groups the person may filter by: all of them for a manager, their own otherwise. */
  availableGroups: Subgroup[];
  canManage: boolean;
  /** The shell is reading the club's lists: show a line instead of the month. */
  loading: boolean;
  scope: ScopeFilter;
  onScopeChange: (scope: ScopeFilter) => void;
  onAdd: () => void;
  onEdit: (event: ClubEvent) => void;
  /** Removes a date after asking (the title is for the question). May answer true when it was removed: the date's detail then closes. */
  onDelete: (eventId: number, title?: string) => void | boolean | Promise<void | boolean>;
};

/** The Calendar page: its title, the audience filter, "Add important date" for managers, and the month with its agenda. */
export function CalendarPage({ events, groups, availableGroups, canManage, loading, scope, onScopeChange, onAdd, onEdit, onDelete }: CalendarPageProps) {
  return (
    <section className="section-shell page-section">
      <PageTitle eyebrow="CLUB CALENDAR" title="Important dates" text="Club and subgroup rehearsals, performances, meetings, and deadlines in one calendar." />
      <div className="toolbar">
        <p className="access-note">Every date shows who it is for</p>
        <ScopeFilterBar value={scope} onChange={onScopeChange} groups={availableGroups} />
        {canManage && <button className="primary" onClick={onAdd}>＋ Add important date</button>}
      </div>
      {loading ? <SkeletonRows rows={5} label="Loading the calendar" className="calendar-skeleton" /> : <CalendarView events={eventsInScope(events, scope)} groups={groups} canManage={canManage} onEdit={onEdit} onDelete={onDelete} />}
    </section>
  );
}
