"use client";

import type { User } from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import type { ClubRole, GroupRole, Announcement, Subgroup } from "../../../lib/db";
import { formatDate } from "../../../lib/format";
import { canManageClub, canPostToGroup, groupCapabilities } from "../../../lib/permissions";
import { Button } from "../../../components/ui/button";
import { SkeletonRows } from "../../../components/ui/skeleton";
import { AnnouncementActions } from "../../announcements/components/announcement-actions";
import { DEFAULT_GROUP_TAB, useGroupTabParam, type GroupTabId } from "../hooks/use-group-selection";
import type { GroupTabRenderer } from "../model";
import { GROUP_PANEL_ID, GroupTabs, tabButtonId, type GroupTabItem } from "./group-tabs";

// The Dates tab and the people tabs (roster, requests: with the dialogs that change them) are their own bundles, fetched when their tab is
// first opened, so that the group page does not carry code for tabs nobody has opened. (A tab that cannot be fetched is caught by the shell.)
const DatesLoading = () => <SkeletonRows rows={3} label="Loading the dates" />;
const PeopleLoading = () => <SkeletonRows rows={3} label="Loading the people" />;
const GroupDates = dynamic(() => import("./group-dates").then((module) => module.GroupDates), { ssr: false, loading: DatesLoading });
const GroupPeople = dynamic(() => import("./group-people").then((module) => module.GroupPeople), { ssr: false, loading: PeopleLoading });

const TAB_LABELS: Record<GroupTabId, string> = { announcements: "Announcements", dates: "Dates", resources: "Resources", recordings: "Recordings", attendance: "Attendance", roster: "Roster", requests: "Requests" };

/**
 * One open group: the buttons that lead to its resources, recordings and attendance, and under them its tabs: Announcements, Dates,
 * Resources, Recordings, Attendance, Roster and (for those who may review them) Requests. The open tab is in the address (`?tab=`, the
 * first when it is missing or not one the person may open) and only the open tab is drawn, so a tab's data is read when it is opened,
 * not before. `groups` is every group (the announcement editor offers them as audiences); `announcements` are this group's own;
 * `requestCount` is how many requests wait (shown on the Requests tab); `renderTab` lets the shell fill a tab with another area's screen.
 */
export function GroupDetail({ user, role, group, groups, announcements, myRole, isMember, requestCount = 0, renderTab, onBack, onOpenAttendance, onOpenRecordings, onOpenResources, onPostUpdate, onAnnouncementsChanged, onGroupChanged, onLeft }: {
  user: User; role: ClubRole; group: Subgroup; groups: Subgroup[]; announcements: Announcement[]; myRole: GroupRole | null; isMember: boolean;
  requestCount?: number; renderTab?: GroupTabRenderer;
  onBack: () => void; onOpenAttendance: (groupId: number) => void; onOpenRecordings: (groupId: number) => void; onOpenResources: (groupId: number) => void;
  onPostUpdate: () => void; onAnnouncementsChanged: () => void | Promise<void>; onGroupChanged: () => void | Promise<void>; onLeft: () => void;
}) {
  const canReview = groupCapabilities(role, myRole).canReviewRequests;
  const tabs: GroupTabItem[] = (Object.keys(TAB_LABELS) as GroupTabId[])
    .filter((id) => id !== "requests" || canReview)
    .map((id) => ({ id, label: TAB_LABELS[id], count: id === "requests" ? requestCount : undefined }));
  const [requested, setTab] = useGroupTabParam();
  // A tab the person may not open (Requests, for an ordinary member) is the first tab, as a missing or mistyped one is.
  const tab: GroupTabId = tabs.some((item) => item.id === requested) ? requested : DEFAULT_GROUP_TAB;

  return <>
    <div className="group-detail-actions"><Button variant="secondary" onClick={onBack}>← All groups</Button><Button variant="secondary" onClick={() => onOpenResources(group.id)}>Open resources</Button><Button variant="secondary" onClick={() => onOpenRecordings(group.id)}>Open recordings</Button><Button variant="secondary" onClick={() => onOpenAttendance(group.id)}>View attendance</Button>{canPostToGroup(role) && <><Button variant="secondary" onClick={onPostUpdate}>Post update</Button><Button onClick={() => onOpenRecordings(group.id)}>Add recording</Button></>}</div>
    {group.archived_at && <p className="action-feedback" role="status">This group is archived. It is hidden from members and cannot accept new requests.</p>}
    <GroupTabs tabs={tabs} selected={tab} onSelect={(id) => setTab(id as GroupTabId)} />
    <div className="group-tab-panel" role="tabpanel" id={GROUP_PANEL_ID} aria-labelledby={tabButtonId(tab)} tabIndex={0}>
      {tab === "announcements" && <section className="group-feed"><div className="dashboard-section-title"><h2>Announcements</h2><span>{announcements.length}</span></div>{announcements.length ? announcements.map((item) => <article key={item.id}><b>{item.title}</b><p>{item.body}</p><small>{item.is_pinned ? "Pinned · " : ""}{formatDate(item.published_at)}</small>{canManageClub(role) && <AnnouncementActions user={user} groups={groups} announcement={item} onChanged={onAnnouncementsChanged} />}</article>) : <p className="workspace-empty">No announcements for this group yet.</p>}</section>}
      {tab === "dates" && (renderTab?.("dates", group) ?? <GroupDates userId={user.id} group={group} />)}
      {tab === "resources" && (renderTab?.("resources", group) ?? <section><div className="dashboard-section-title"><h2>Resources</h2><span>Library</span></div><p className="workspace-empty">Documents, links, and photos live in the shared resource library.</p><Button variant="secondary" onClick={() => onOpenResources(group.id)}>Open resources</Button></section>)}
      {tab === "recordings" && (renderTab?.("recordings", group) ?? <section><div className="dashboard-section-title"><h2>Recordings</h2><span>Room</span></div><p className="workspace-empty">Capture rehearsals, lessons, and takes in the subgroup recording room.</p><Button variant="secondary" onClick={() => onOpenRecordings(group.id)}>Open recording room →</Button></section>)}
      {tab === "attendance" && (renderTab?.("attendance", group) ?? <section><div className="dashboard-section-title"><h2>Attendance</h2><span>Meetings</span></div><p className="workspace-empty">Meetings, check-in and absence forms for this group are on the Attendance page.</p><Button variant="secondary" onClick={() => onOpenAttendance(group.id)}>View attendance</Button></section>)}
      {(tab === "roster" || tab === "requests") && <GroupPeople key={group.id} user={user} role={role} group={group} myRole={myRole} isMember={isMember} view={tab} onGroupChanged={onGroupChanged} onLeft={onLeft} />}
    </div>
  </>;
}
