"use client";

import type { User } from "@supabase/supabase-js";
import type { ClubRole, GroupRole } from "../../../lib/db";
import { formatDate } from "../../../lib/format";
import { canManageClub, canPostToGroup } from "../../../lib/permissions";
import type { Announcement, Subgroup } from "../../../lib/portal-types";
import { Button } from "../../../components/ui/button";
import { useToast } from "../../../components/ui/toast";
import { AnnouncementActions } from "../../announcements/components/announcement-actions";
import { GroupPeople } from "./group-people";

/**
 * One open group: the buttons that lead to its resources, recordings and attendance, its announcements, and its people.
 * `groups` is every group (the announcement editor offers them as audiences); `announcements` are this group's own.
 */
export function GroupDetail({ user, role, group, groups, announcements, myRole, isMember, onBack, onOpenAttendance, onOpenRecordings, onOpenResources, onPostUpdate, onAnnouncementsChanged, onGroupChanged, onLeft }: {
  user: User; role: ClubRole; group: Subgroup; groups: Subgroup[]; announcements: Announcement[]; myRole: GroupRole | null; isMember: boolean;
  onBack: () => void; onOpenAttendance: (groupId: number) => void; onOpenRecordings: (groupId: number) => void; onOpenResources: (groupId: number) => void;
  onPostUpdate: () => void; onAnnouncementsChanged: () => void | Promise<void>; onGroupChanged: () => void | Promise<void>; onLeft: () => void;
}) {
  const { notify } = useToast();
  return <>
    <div className="group-detail-actions"><Button variant="secondary" onClick={onBack}>← All groups</Button><Button variant="secondary" onClick={() => onOpenResources(group.id)}>Open resources</Button><Button variant="secondary" onClick={() => onOpenRecordings(group.id)}>Open recordings</Button><Button variant="secondary" onClick={() => onOpenAttendance(group.id)}>View attendance</Button>{canPostToGroup(role) && <><Button variant="secondary" onClick={onPostUpdate}>Post update</Button><Button onClick={() => onOpenRecordings(group.id)}>Add recording</Button></>}</div>
    <div className="group-detail-grid">
      <section className="group-feed"><div className="dashboard-section-title"><h2>Announcements</h2><span>{announcements.length}</span></div>{announcements.length ? announcements.map((item) => <article key={item.id}><b>{item.title}</b><p>{item.body}</p><small>{item.is_pinned ? "Pinned · " : ""}{formatDate(item.published_at)}</small>{canManageClub(role) && <AnnouncementActions user={user} groups={groups} announcement={item} onChanged={onAnnouncementsChanged} notify={notify} />}</article>) : <p className="workspace-empty">No announcements for this group yet.</p>}</section>
      <section><div className="dashboard-section-title"><h2>Resources</h2><span>Library</span></div><p className="workspace-empty">Documents, links, and photos live in the shared resource library.</p><Button variant="secondary" onClick={() => onOpenResources(group.id)}>Open resources</Button></section>
      <section><div className="dashboard-section-title"><h2>Recordings</h2><span>Room</span></div><p className="workspace-empty">Capture rehearsals, lessons, and takes in the subgroup recording room.</p><Button variant="secondary" onClick={() => onOpenRecordings(group.id)}>Open recording room →</Button></section>
    </div>
    <GroupPeople key={group.id} user={user} role={role} group={group} myRole={myRole} isMember={isMember} onGroupChanged={onGroupChanged} onLeft={onLeft} />
  </>;
}
