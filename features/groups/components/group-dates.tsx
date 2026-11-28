"use client";

import { listGroupEvents } from "../../../lib/api/groups";
import type { ClubEvent } from "../../../lib/db";
import { formatDate } from "../../../lib/format";
import { useQuery } from "../../../lib/hooks/use-query";
import { ErrorBlock } from "../../../components/ui/error-block";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { SkeletonRows } from "../../../components/ui/skeleton";

const timeOf = (value: string) => new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const startOfToday = () => { const day = new Date(); day.setHours(0, 0, 0, 0); return day.toISOString(); };

/**
 * The Dates tab: this group's upcoming dates (from the start of today, soonest first), read when the tab is opened and remembered for the
 * next visit (key "group-dates:<id>"). It lists them; adding, changing and removing a date stays on the Calendar.
 */
export function GroupDates({ userId, group }: { userId: string; group: { id: number; name: string } }) {
  const { data, loading, failed, retry } = useQuery<ClubEvent[]>({ userId, key: `group-dates:${group.id}`, load: () => listGroupEvents(group.id, startOfToday()) });
  return <section className="group-dates">
    <div className="dashboard-section-title"><h2>Dates</h2><span>Upcoming</span></div>
    {loading ? <SkeletonRows rows={3} label="Loading the dates" /> : failed && data === undefined ? <ErrorBlock message="The dates could not be loaded." onRetry={() => void retry()} role="alert" /> : <>
      {failed && <LoadErrorBanner message="The dates could not be refreshed, so they may be out of date." onRetry={() => void retry()} />}
      {data?.length ? <ul className="group-date-list">{data.map((item) => <li key={item.id}>
        <span className="group-date-when">{formatDate(item.starts_at)} · {timeOf(item.starts_at)}</span>
        <b>{item.title}</b>
        {item.location && <small>{item.location}</small>}
        {item.description && <p>{item.description}</p>}
      </li>)}</ul> : <p className="workspace-empty">No upcoming dates for {group.name} yet.</p>}
    </>}
  </section>;
}
