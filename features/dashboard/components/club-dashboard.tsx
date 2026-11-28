"use client";

import type { ClubRole, Announcement, ClubEvent } from "../../../lib/db";
import type { Section } from "../../../lib/sections";
import { AnnouncementFeed, type AnnouncementManage } from "../../announcements/components/announcement-feed";
import { TalamMeasure } from "./talam-measure";

export function ClubDashboard({ name, role, events, resourceCount, announcements, onNavigate, manage }: { name: string; role: ClubRole; events: ClubEvent[]; resourceCount: number; announcements: Announcement[]; manage?: AnnouncementManage; onNavigate: (section: Section) => void }) {
  const upcoming = events.filter((event) => new Date(event.starts_at) >= new Date()).slice(0, 4);
  const next = upcoming[0];
  const latest = announcements[0];
  const nextWhen = next ? new Date(next.starts_at).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "No upcoming date scheduled";
  return <>{(announcements.length > 0 || manage) && <AnnouncementFeed announcements={announcements} manage={manage} />}<section className="portal-dashboard"><div className="dashboard-intro"><div><h1>Welcome back, {name}.</h1><p>Carnatic and Hindustani musicians, one shared club home.</p></div><span>{role === "executive" ? "Executive view" : role === "admin" ? "Admin view" : "Member view"}</span></div><TalamMeasure next={next} nextWhen={nextWhen} onNavigate={onNavigate} /><div className="dashboard-beats"><article><span className="beat-number">1</span><h2>Announcements</h2><h3>{latest?.title || "Nothing new to review"}</h3><p>{latest?.body || "Club and group updates will appear here when an executive posts one."}</p><button type="button" onClick={() => onNavigate("home")}>{latest ? "Read update" : "Refresh overview"}</button></article><article><span className="beat-number">2</span><h2>Attendance</h2><h3>Ready for the next meeting</h3><p>Check in with a meeting code, review your history, or submit an absence excuse.</p><button type="button" onClick={() => onNavigate("attendance")}>Open attendance</button></article><article><span className="beat-number">3</span><h2>Resources</h2><h3>{resourceCount} available {resourceCount === 1 ? "resource" : "resources"}</h3><p>Repertoire, planning documents, shared links, and references for every tradition and group.</p><button type="button" onClick={() => onNavigate("documents")}>Open library</button></article></div></section></>;
}
