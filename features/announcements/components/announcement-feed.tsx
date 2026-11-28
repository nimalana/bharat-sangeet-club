"use client";

import type { User } from "@supabase/supabase-js";
import { useState } from "react";
import { formatDate } from "../../../lib/format";
import type { Announcement, Subgroup } from "../../../lib/db";
import { Button } from "../../../components/ui/button";
import { AnnouncementActions, AnnouncementEditor } from "./announcement-actions";

export type AnnouncementManage = { user: User; groups: Subgroup[]; onChanged: () => void | Promise<void> };

export function AnnouncementFeed({ announcements, manage }: { announcements: Announcement[]; manage?: AnnouncementManage }) {
  const [composing, setComposing] = useState(false);
  return <section className="announcement-feed" aria-labelledby="announcement-heading"><div className="announcement-feed-heading"><div><p className="eyebrow">CLUB & GROUP UPDATES</p><h2 id="announcement-heading">Announcements</h2></div>{manage ? <Button size="sm" onClick={() => setComposing(true)}>＋ Post announcement</Button> : <span>{announcements.length} recent</span>}</div>{announcements.length ? <div className="announcement-list">{announcements.map((item) => <article className={item.is_pinned ? "pinned" : ""} key={item.id}>{item.is_pinned && <span className="announcement-pin">Pinned</span>}<div><h3>{item.title}</h3><p>{item.body}</p>{manage && <AnnouncementActions user={manage.user} groups={manage.groups} announcement={item} onChanged={manage.onChanged} />}</div><time>{formatDate(item.published_at)}</time></article>)}</div> : <p className="workspace-empty">No announcements yet.</p>}{composing && manage && <AnnouncementEditor user={manage.user} groups={manage.groups} onClose={() => setComposing(false)} onSaved={manage.onChanged} />}</section>;
}
