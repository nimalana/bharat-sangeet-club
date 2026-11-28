"use client";

import type { User } from "@supabase/supabase-js";
import type { FormEvent } from "react";
import { formatDate } from "../../../lib/format";
import type { Announcement, Subgroup } from "../../../lib/db";
import { ContentScopeLabel } from "../../../components/ui/content-scope-label";
import { AnnouncementActions } from "../../announcements/components/announcement-actions";

/**
 * The Admin page's side column: the form that publishes an announcement (to the whole club or one group) and the five latest
 * announcements with their pin, edit and delete controls. (features/announcements has its own editor; this form is separate.)
 */
export function AdminAnnouncementsPanel({ user, groups, announcements, onSubmit, onChanged }: {
  user: User; groups: Subgroup[]; announcements: Announcement[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onChanged: () => void | Promise<void>;
}) {
  return <aside><form className="admin-panel announcement-form" onSubmit={onSubmit}><p className="eyebrow">COMMUNICATIONS</p><h2>Post announcement</h2><label>Audience<select name="subgroup_id"><option value="">Whole club</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Title<input name="title" required maxLength={140} /></label><label>Message<textarea name="body" required rows={5} /></label><label className="check-label"><input name="is_pinned" type="checkbox" /> Pin to dashboard</label><button className="primary">Publish announcement</button></form><section className="admin-panel"><div className="admin-panel-heading"><h2>Announcements</h2><span>{announcements.length}</span></div>{announcements.slice(0, 5).map((item) => <article className="admin-announcement" key={item.id}><div><b>{item.is_pinned ? "◆ " : ""}{item.title}</b><small><ContentScopeLabel subgroupId={item.subgroup_id} groups={groups} />{formatDate(item.published_at)}</small></div><AnnouncementActions user={user} groups={groups} announcement={item} onChanged={onChanged} /></article>)}</section></aside>;
}
