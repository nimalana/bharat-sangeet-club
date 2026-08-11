"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Section = "home" | "calendar" | "attendance" | "recordings" | "documents" | "gallery" | "finances";
type ClubRole = "member" | "executive";
type ArchiveType = "recording" | "document" | "photo";
type ArchiveItem = {
  id: number; title: string; description: string; type: ArchiveType;
  storage_path: string; visibility: "members" | "executives";
  event_date: string | null; raga: string | null; tala: string | null; created_at: string;
  signedUrl?: string;
};
type Transaction = {
  id: number; description: string; amount: number; category: string;
  transaction_date: string; created_at: string;
};
type ClubEvent = { id: number; title: string; description: string; starts_at: string; location: string; created_at: string };
type Subgroup = { id: number; name: string; description: string };
type SubgroupMembership = { subgroup_id: number; member_id: string };
type AttendanceSession = { id: number; subgroup_id: number; title: string; session_date: string };
type AttendanceRecord = { session_id: number; member_id: string; status: "present" | "absent" | "excused" };
type MemberProfile = { id: string; full_name: string; email: string; role: ClubRole };

const heroPhotos = [
  { src: "https://asianartsagency.co.uk/wp-content/uploads/2021/08/Trio-WP.jpg", alt: "Carnatic trio performing with veena and percussion" },
  { src: "https://static.wixstatic.com/media/08d671_184493ea312d46e89a838c34d1097f42~mv2.jpg/v1/fill/w_2500,h_1203,al_c/08d671_184493ea312d46e89a838c34d1097f42~mv2.jpg", alt: "Carnatic ensemble recital" },
];

export default function Home() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<ClubRole>("member");
  const [name, setName] = useState("");
  const [section, setSection] = useState<Section>("home");
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const loadProfile = useCallback(async (currentUser: User) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("profiles").select("full_name, role").eq("id", currentUser.id).single();
    if (error) { notify("We could not load your club profile"); return; }
    setRole(data.role as ClubRole);
    setName(data.full_name || currentUser.email?.split("@")[0] || "Club member");
  }, [notify]);

  const loadData = useCallback(async (currentRole: ClubRole) => {
    const client = supabase;
    if (!client) return;
    setDataLoading(true);
    const archiveResult = await client.from("archive_items").select("*").order("created_at", { ascending: false });
    if (archiveResult.error) notify("The club archive could not be loaded");
    const items = (archiveResult.data || []) as ArchiveItem[];
    const photos = items.filter((item) => item.type === "photo");
    await Promise.all(photos.map(async (item) => {
      const { data } = await client.storage.from("club-archive").createSignedUrl(item.storage_path, 3600);
      item.signedUrl = data?.signedUrl;
    }));
    setArchive(items);
    const eventsResult = await client.from("events").select("*").order("starts_at", { ascending: true });
    if (eventsResult.error) notify("The club calendar could not be loaded");
    setEvents((eventsResult.data || []) as ClubEvent[]);
    if (currentRole === "executive") {
      const result = await client.from("transactions").select("*").order("transaction_date", { ascending: false });
      if (result.error) notify("Financial records could not be loaded");
      setTransactions((result.data || []) as Transaction[]);
    } else setTransactions([]);
    setDataLoading(false);
  }, [notify]);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) loadProfile(data.user);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) window.setTimeout(() => loadProfile(session.user), 0);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadProfile]);

  useEffect(() => { if (user) loadData(role); }, [user, role, loadData]);

  const recordings = useMemo(() => archive.filter((item) => item.type === "recording" && `${item.title} ${item.description} ${item.raga || ""}`.toLowerCase().includes(query.toLowerCase())), [archive, query]);
  const documents = archive.filter((item) => item.type === "document");
  const photos = archive.filter((item) => item.type === "photo");
  const balance = transactions.reduce((sum, item) => sum + Number(item.amount), 0);
  const income = transactions.filter((item) => Number(item.amount) > 0).reduce((sum, item) => sum + Number(item.amount), 0);
  const expenses = transactions.filter((item) => Number(item.amount) < 0).reduce((sum, item) => sum + Number(item.amount), 0);

  const navigate = (next: Section) => { setSection(next); window.scrollTo({ top: 0, behavior: "smooth" }); };

  async function openFile(item: ArchiveItem) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("club-archive").createSignedUrl(item.storage_path, 300);
    if (error || !data) { notify("This file could not be opened"); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteEvent(eventId: number) {
    if (!supabase || !window.confirm("Remove this date from the club calendar?")) return;
    const { error } = await supabase.from("events").delete().eq("id", eventId);
    if (error) notify(error.message); else { notify("Calendar date removed"); loadData(role); }
  }

  if (authLoading) return <LoadingScreen />;
  if (!supabase) return <SetupScreen />;
  if (!user) return <LoginScreen />;

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")} aria-label="Bharat Sangeet at UNC Chapel Hill home"><span className="brand-mark">sa</span><span><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></span></button>
        <nav aria-label="Main navigation">
          {(["home", "calendar", "attendance", "recordings", "documents", "gallery"] as Section[]).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => navigate(item)}>{item === "home" ? "Club Home" : item}</button>)}
          {role === "executive" && <button className={section === "finances" ? "active" : ""} onClick={() => navigate("finances")}>Finances</button>}
        </nav>
        <div className="account"><button className="role-button" onClick={() => supabase?.auth.signOut()} title="Sign out"><span className="avatar">{role === "executive" ? "EX" : "MB"}</span><span><b>{name}</b><small>{role === "executive" ? "Executive · Sign out" : "Member · Sign out"}</small></span></button></div>
      </header>

      {section === "home" && <>
        <section className="hero"><div className="hero-copy"><p className="eyebrow">UNC CHAPEL HILL · 2026–27 SEASON</p><h1>Music remembered.<br /><em>Community connected.</em></h1><p className="lede">The shared home for UNC Chapel Hill's Carnatic music community—our recordings, repertoire, club resources, concert memories, and people.</p><div className="hero-actions"><button className="primary" onClick={() => navigate("recordings")}>Listen to the archive <span>→</span></button><button className="secondary" onClick={() => navigate("documents")}>Browse club resources</button></div></div><div className="hero-image"><img src={photos[0]?.signedUrl || heroPhotos[0].src} alt={photos[0]?.title || heroPhotos[0].alt} /><div className="image-caption"><span>UNC club archive</span><b>{photos[0]?.title || "Bharat Sangeet in concert"}</b></div></div></section>
        <section className="welcome-strip"><p><span className="dot" /> Welcome back, {name}</p><p className="quote">“Where melody becomes memory.”</p><p><b>{role === "executive" ? "Executive access" : "Member access"}</b></p></section>
        <section className="section-shell overview"><div className="section-heading"><div><p className="eyebrow">YOUR CLUB SPACE</p><h2>Everything in its place</h2></div>{role === "executive" && <button className="primary small" onClick={() => setShowUpload(true)}>＋ Add to archive</button>}</div><div className="feature-grid">
          <button className="feature-card large" onClick={() => navigate("recordings")}><span className="line-icon">◉</span><span className="count">{recordings.length} recordings</span><h3>Listen & revisit</h3><p>Concerts, rehearsals, and workshops—organized for the whole club.</p><b>Open recordings →</b></button>
          <button className="feature-card" onClick={() => navigate("documents")}><span className="line-icon">▤</span><span className="count">{documents.length} files</span><h3>Club library</h3><p>Constitution, repertoire, event plans, and member resources.</p><b>Browse documents →</b></button>
          <button className="feature-card photo-card" onClick={() => navigate("gallery")}><img src={photos[1]?.signedUrl || heroPhotos[1].src} alt={photos[1]?.title || heroPhotos[1].alt} /><span><small>PHOTO ARCHIVE</small><b>Moments from the stage</b></span></button>
          <div className="feature-card next-card"><p className="eyebrow">LIVE & SECURE</p><div className="calendar-date"><b>{archive.length}</b><span>ITEMS</span></div><div><h3>Shared club archive</h3><p>Protected by member and executive permissions.</p></div></div>
        </div></section>
        <section className="raga-banner"><div><p className="eyebrow">RAGA OF THE MONTH</p><h2>Kalyani</h2><p>Expansive, luminous, and full of possibility—a raga that invites both discipline and imagination.</p></div><div className="swara"><small>AROHANAM</small><b>Sa Ri₂ Ga₃ Ma₂ Pa Da₂ Ni₃ Sa</b><small>AVAROHANAM</small><b>Sa Ni₃ Da₂ Pa Ma₂ Ga₃ Ri₂ Sa</b></div></section>
      </>}

      {section === "recordings" && <section className="section-shell page-section"><PageTitle eyebrow="LISTENING ROOM" title="Recordings archive" text="Concerts, rehearsals, workshops, and musical moments from every season." /><div className="toolbar"><label className="search">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, raga, or description" /></label>{role === "executive" && <button className="primary" onClick={() => setShowUpload(true)}>＋ Upload recording</button>}</div>{dataLoading ? <InlineLoading /> : recordings.length ? <div className="recording-list">{recordings.map((item, index) => <article className="recording-row" key={item.id}><button className="play" onClick={() => openFile(item)}>▶</button><div className="track-no">{String(index + 1).padStart(2, "0")}</div><div className="track-main"><h3>{item.title}</h3><p>{[item.raga, item.tala, item.description].filter(Boolean).join(" · ") || "Club recording"}</p></div><span className="pill">Recording</span><time>{formatDate(item.created_at)}</time><button className="more" onClick={() => openFile(item)}>•••</button></article>)}</div> : <EmptyState title="No recordings yet" text={role === "executive" ? "Upload the first rehearsal or concert recording." : "The executives have not added a recording yet."} />}</section>}

      {section === "calendar" && <section className="section-shell page-section"><PageTitle eyebrow="CLUB CALENDAR" title="Important dates" text="Rehearsals, performances, meetings, deadlines, and everything the club needs to remember." /><div className="toolbar"><p className="access-note">✓ Dates are shared with every approved club member</p>{role === "executive" && <button className="primary" onClick={() => setShowEvent(true)}>＋ Add important date</button>}</div>{dataLoading ? <InlineLoading /> : <CalendarView events={events} canManage={role === "executive"} onDelete={deleteEvent} />}</section>}

      {section === "attendance" && <AttendancePage user={user} role={role} notify={notify} />}

      {section === "documents" && <section className="section-shell page-section"><PageTitle eyebrow="SHARED LIBRARY" title="Club documents" text="The practical side of our community—easy for every member to find and use." /><div className="toolbar"><p className="access-note">✓ All members can view and download shared files</p>{role === "executive" && <button className="primary" onClick={() => setShowUpload(true)}>＋ Add document</button>}</div>{documents.length ? <div className="document-grid">{documents.map((item) => <article className="document-card" key={item.id}><div className="file-top"><span className="file-icon">▤</span><span className="pill">{item.visibility}</span></div><h3>{item.title}</h3><p>{item.description || `Added ${formatDate(item.created_at)}`}</p><button onClick={() => openFile(item)}>Download <span>↓</span></button></article>)}</div> : <EmptyState title="No documents yet" text={role === "executive" ? "Add the constitution, repertoire, or member guide." : "Shared club documents will appear here."} />}</section>}

      {section === "gallery" && <section className="section-shell page-section"><PageTitle eyebrow="CLUB MEMORIES" title="Photo archive" text="The rehearsals, stages, and friendships that shape Bharat Sangeet." />{photos.length ? <div className="gallery-grid">{photos.map((item, index) => <figure key={item.id} className={index === 0 ? "wide" : ""}><img src={item.signedUrl} alt={item.title} /><figcaption><b>{item.title}</b><span>{formatDate(item.created_at)}</span></figcaption></figure>)}</div> : <EmptyState title="No club photos yet" text={role === "executive" ? "Upload the first memory from a rehearsal or concert." : "Club photos will appear here."} />}</section>}

      {section === "finances" && role === "executive" && <section className="section-shell page-section"><PageTitle eyebrow="EXECUTIVE ACCESS" title="Club finances" text="A private, clear record of the funds that support our music." /><div className="finance-summary"><div><small>AVAILABLE BALANCE</small><strong>{money(balance)}</strong><span>Live club ledger</span></div><div><small>TOTAL INCOME</small><b className="income">{money(income)}</b><span>Recorded funds</span></div><div><small>TOTAL EXPENSES</small><b>{money(expenses)}</b><span>Recorded spending</span></div><button className="primary" onClick={() => setShowUpload(true)}>＋ Add transaction</button></div>{transactions.length ? <div className="ledger"><div className="ledger-head"><b>Recent activity</b><span>Club ledger</span></div>{transactions.map((item) => <div className="ledger-row" key={item.id}><span className={`money-mark ${Number(item.amount) > 0 ? "income" : "expense"}`}>{Number(item.amount) > 0 ? "+" : "−"}</span><b>{item.description}</b><span>{formatDate(item.transaction_date)}</span><strong className={Number(item.amount) > 0 ? "income" : "expense"}>{money(Number(item.amount))}</strong></div>)}</div> : <EmptyState title="No transactions yet" text="Add the first allocation, donation, or expense." />}</section>}

      <footer><div className="footer-brand"><span className="brand-mark">sa</span><div><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></div></div><p>Carnatic music at the University of North Carolina at Chapel Hill.</p><p>2026–27 Season</p></footer>
      {showUpload && <ArchiveModal user={user} onClose={() => setShowUpload(false)} onSaved={() => { setShowUpload(false); loadData(role); notify("Saved to the club archive"); }} notify={notify} />}
      {showEvent && <EventModal user={user} onClose={() => setShowEvent(false)} onSaved={() => { setShowEvent(false); loadData(role); notify("Important date added"); }} notify={notify} />}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function EventModal({ user, onClose, onSaved, notify }: { user: User; onClose: () => void; onSaved: () => void; notify: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setSaving(true);
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("events").insert({ title: String(form.get("title") || ""), description: String(form.get("description") || ""), starts_at: new Date(String(form.get("starts_at") || "")).toISOString(), location: String(form.get("location") || ""), created_by: user.id });
    setSaving(false); if (error) notify(error.message); else onSaved();
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">EXECUTIVE TOOL</p><h2>Add an important date</h2><label>Title<input name="title" required placeholder="Concert, rehearsal, meeting…" /></label><label>Date and time<input name="starts_at" type="datetime-local" required /></label><label>Location<input name="location" placeholder="Room, venue, or online" /></label><label>Details<input name="description" placeholder="Anything members should know" /></label><button className="primary" disabled={saving}>{saving ? "Adding…" : "Add to calendar"}</button></form></div>;
}

function CalendarView({ events, canManage, onDelete }: { events: ClubEvent[]; canManage: boolean; onDelete: (eventId: number) => void }) {
  const [cursor, setCursor] = useState(() => { const today = new Date(); return new Date(today.getFullYear(), today.getMonth(), 1); });
  const year = cursor.getFullYear(); const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const calendarStart = new Date(year, month, 1 - firstDay);
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(calendarStart); day.setDate(calendarStart.getDate() + index); return day; });
  const today = new Date();
  const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  return <div className="month-calendar"><div className="calendar-controls"><button onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Previous month">←</button><h2>{cursor.toLocaleString("en-US", { month: "long", year: "numeric" })}</h2><div><button className="today-button" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button><button onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Next month">→</button></div></div><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((day) => { const dayEvents = events.filter((item) => sameDay(new Date(item.starts_at), day)); return <div className={`calendar-cell ${day.getMonth() !== month ? "outside" : ""} ${sameDay(day, today) ? "today" : ""}`} key={day.toISOString()}><span className="day-number">{day.getDate()}</span><div className="day-events">{dayEvents.map((item) => <div className="calendar-event" key={item.id} title={[item.description, item.location].filter(Boolean).join(" · ")}><time>{new Date(item.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time><b>{item.title}</b>{item.location && <small>{item.location}</small>}{canManage && <button onClick={() => onDelete(item.id)} aria-label={`Delete ${item.title}`}>×</button>}</div>)}</div></div>; })}</div>{events.length === 0 && <p className="calendar-empty">No dates have been added yet.</p>}</div>;
}

function AttendancePage({ user, role, notify }: { user: User; role: ClubRole; notify: (message: string) => void }) {
  const [groups, setGroups] = useState<Subgroup[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [profiles, setProfiles] = useState<MemberProfile[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAttendance = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [groupResult, membershipResult, sessionResult, recordResult, profileResult] = await Promise.all([
      supabase.from("subgroups").select("id, name, description").order("name"),
      supabase.from("subgroup_memberships").select("subgroup_id, member_id"),
      supabase.from("attendance_sessions").select("id, subgroup_id, title, session_date").order("session_date", { ascending: false }),
      supabase.from("attendance_records").select("session_id, member_id, status"),
      role === "executive" ? supabase.from("profiles").select("id, full_name, email, role").order("full_name") : Promise.resolve({ data: [], error: null }),
    ]);
    const error = groupResult.error || membershipResult.error || sessionResult.error || recordResult.error || profileResult.error;
    if (error) notify("Attendance records could not be loaded");
    const nextGroups = (groupResult.data || []) as Subgroup[];
    setGroups(nextGroups); setMemberships((membershipResult.data || []) as SubgroupMembership[]); setSessions((sessionResult.data || []) as AttendanceSession[]); setRecords((recordResult.data || []) as AttendanceRecord[]); setProfiles((profileResult.data || []) as MemberProfile[]);
    setSelectedGroup((current) => current && nextGroups.some((group) => group.id === current) ? current : nextGroups[0]?.id ?? null);
    setLoading(false);
  }, [notify, role]);

  useEffect(() => { loadAttendance(); }, [loadAttendance]);

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("subgroups").insert({ name: String(form.get("name") || ""), description: String(form.get("description") || ""), created_by: user.id });
    if (error) notify(error.message); else { event.currentTarget.reset(); notify("Subgroup created"); loadAttendance(); }
  }
  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !selectedGroup) return; const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("subgroup_memberships").insert({ subgroup_id: selectedGroup, member_id: String(form.get("member_id")), added_by: user.id });
    if (error) notify(error.message); else { notify("Member added to subgroup"); loadAttendance(); }
  }
  async function removeMember(memberId: string) {
    if (!supabase || !selectedGroup) return;
    const { error } = await supabase.from("subgroup_memberships").delete().eq("subgroup_id", selectedGroup).eq("member_id", memberId);
    if (error) notify(error.message); else loadAttendance();
  }
  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !selectedGroup) return; const form = new FormData(event.currentTarget);
    const { data, error } = await supabase.from("attendance_sessions").insert({ subgroup_id: selectedGroup, title: String(form.get("title") || "Meeting"), session_date: String(form.get("session_date")), created_by: user.id }).select("id").single();
    if (error) notify(error.message); else { event.currentTarget.reset(); setSelectedSession(data.id); notify("Attendance date created"); loadAttendance(); }
  }
  async function markAttendance(memberId: string, status: AttendanceRecord["status"]) {
    if (!supabase || !selectedSession) return;
    const { error } = await supabase.from("attendance_records").upsert({ session_id: selectedSession, member_id: memberId, status, marked_by: user.id, marked_at: new Date().toISOString() }, { onConflict: "session_id,member_id" });
    if (error) notify(error.message); else setRecords((current) => [...current.filter((record) => !(record.session_id === selectedSession && record.member_id === memberId)), { session_id: selectedSession, member_id: memberId, status }]);
  }

  const activeGroup = groups.find((group) => group.id === selectedGroup);
  const groupMemberships = memberships.filter((membership) => membership.subgroup_id === selectedGroup);
  const groupSessions = sessions.filter((session) => session.subgroup_id === selectedGroup);
  const availableProfiles = profiles.filter((profile) => !groupMemberships.some((membership) => membership.member_id === profile.id));
  if (loading) return <section className="section-shell page-section"><InlineLoading /></section>;

  return <section className="section-shell page-section"><PageTitle eyebrow="SUBGROUPS" title="Attendance" text={role === "executive" ? "Create ensembles and teams, organize their rosters, and keep a clear record of participation." : "See your subgroups and personal attendance history."} />{role === "executive" && <form className="create-group-bar" onSubmit={createGroup}><input name="name" required placeholder="New subgroup name" /><input name="description" placeholder="Short description" /><button className="primary">＋ Create subgroup</button></form>}{groups.length === 0 ? <EmptyState title="No subgroups yet" text={role === "executive" ? "Create the first subgroup above." : "An executive has not assigned you to a subgroup yet."} /> : <div className="attendance-layout"><aside className="subgroup-list"><small>SUBGROUPS</small>{groups.map((group) => <button key={group.id} className={selectedGroup === group.id ? "active" : ""} onClick={() => { setSelectedGroup(group.id); setSelectedSession(null); }}><b>{group.name}</b><span>{memberships.filter((membership) => membership.subgroup_id === group.id).length} members</span></button>)}</aside><div className="attendance-workspace"><div className="subgroup-heading"><div><h2>{activeGroup?.name}</h2><p>{activeGroup?.description || "UNC Chapel Hill Bharat Sangeet subgroup"}</p></div><span>{groupMemberships.length} members · {groupSessions.length} meetings</span></div>{role === "executive" && <><form className="roster-add" onSubmit={addMember}><select name="member_id" required defaultValue=""><option value="" disabled>Add a club member…</option>{availableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email} ({profile.email})</option>)}</select><button>Add to subgroup</button></form><div className="roster-chips">{groupMemberships.map((membership) => { const profile = profiles.find((item) => item.id === membership.member_id); return <span key={membership.member_id}>{profile?.full_name || profile?.email || "Member"}<button onClick={() => removeMember(membership.member_id)} aria-label="Remove member">×</button></span>; })}</div><form className="session-create" onSubmit={createSession}><input name="title" required placeholder="Meeting or rehearsal name" /><input name="session_date" type="date" required /><button className="primary">Create attendance date</button></form></>}<div className="session-tabs">{groupSessions.map((session) => <button key={session.id} className={selectedSession === session.id ? "active" : ""} onClick={() => setSelectedSession(session.id)}><b>{formatDate(session.session_date)}</b><span>{session.title}</span></button>)}</div>{selectedSession ? <div className="attendance-table"><div className="attendance-table-head"><b>Member</b><span>Status</span></div>{groupMemberships.map((membership) => { const profile = profiles.find((item) => item.id === membership.member_id); const record = records.find((item) => item.session_id === selectedSession && item.member_id === membership.member_id); return <div className="attendance-row" key={membership.member_id}><div><b>{profile?.full_name || (membership.member_id === user.id ? user.email : "Member")}</b><small>{profile?.email || (membership.member_id === user.id ? user.email : "")}</small></div>{role === "executive" ? <select value={record?.status || ""} onChange={(event) => markAttendance(membership.member_id, event.target.value as AttendanceRecord["status"])}><option value="" disabled>Not marked</option><option value="present">Present</option><option value="absent">Absent</option><option value="excused">Excused</option></select> : <span className={`attendance-status ${record?.status || "unmarked"}`}>{record?.status || "Not marked"}</span>}</div>; })}</div> : <div className="attendance-prompt">Choose an attendance date to view or mark attendance.</div>}</div></div>}</section>;
}

function LoginScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function signInWithGoogle() {
    if (!supabase) return;
    setSending(true);
    setErrorMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setErrorMessage(error.message);
      setSending(false);
    }
  }

  return <main className="login-page"><div className="login-art"><img src={heroPhotos[0].src} alt={heroPhotos[0].alt} /><div><span className="brand-mark">sa</span><h1>Music remembered.<br /><em>Community connected.</em></h1></div></div><section className="login-panel"><div className="login-box"><p className="eyebrow">UNC CHAPEL HILL MEMBER PORTAL</p><div className="auth-tabs"><button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Member sign in</button><button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Join the club</button></div><h2>{mode === "signup" ? "Join Bharat Sangeet" : "Welcome to Bharat Sangeet"}</h2><p>{mode === "signup" ? "Sign up with Google to join the UNC Chapel Hill club. Every new account begins as a regular member." : "Use the Google account connected to your UNC Chapel Hill club membership. No password is required."}</p><button className="google-button" type="button" onClick={signInWithGoogle} disabled={sending}><span aria-hidden="true">G</span>{sending ? "Opening Google…" : mode === "signup" ? "Sign up with Google" : "Continue with Google"}</button>{errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}<small>{mode === "signup" ? "Executive access is assigned separately by current club executives." : "Access your recordings, documents, calendar, subgroups, and attendance."}</small></div></section></main>;
}

function ArchiveModal({ user, onClose, onSaved, notify }: { user: User; onClose: () => void; onSaved: () => void; notify: (message: string) => void }) {
  const [type, setType] = useState<ArchiveType | "financial">("recording");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setSaving(true);
    const form = new FormData(event.currentTarget); const title = String(form.get("title") || "");
    if (type === "financial") {
      const amount = Number(form.get("amount"));
      const { error } = await supabase.from("transactions").insert({ description: title, amount, category: String(form.get("category") || "General"), created_by: user.id });
      setSaving(false); if (error) notify(error.message); else onSaved(); return;
    }
    const file = form.get("file") as File; if (!file?.size) { setSaving(false); notify("Choose a file to upload"); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-"); const storagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from("club-archive").upload(storagePath, file, { upsert: false });
    if (upload.error) { setSaving(false); notify(upload.error.message); return; }
    const saved = await supabase.from("archive_items").insert({ title, description: String(form.get("description") || ""), type, storage_path: storagePath, visibility: form.get("visibility"), raga: type === "recording" ? String(form.get("raga") || "") || null : null, tala: type === "recording" ? String(form.get("tala") || "") || null : null, uploaded_by: user.id });
    if (saved.error) { await supabase.storage.from("club-archive").remove([storagePath]); setSaving(false); notify(saved.error.message); return; }
    setSaving(false); onSaved();
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">EXECUTIVE TOOL</p><h2>Add to club records</h2><label>Item type<select value={type} onChange={(e) => setType(e.target.value as ArchiveType | "financial")}><option value="recording">Recording</option><option value="document">Document</option><option value="photo">Photo</option><option value="financial">Financial transaction</option></select></label><label>{type === "financial" ? "Description" : "Title"}<input name="title" required placeholder="Give this item a clear name" /></label>{type === "financial" ? <><label>Amount<input name="amount" type="number" step="0.01" required placeholder="Use a negative number for expenses" /></label><label>Category<input name="category" required placeholder="Venue, donation, equipment…" /></label></> : <><label>Description<input name="description" placeholder="Optional context for members" /></label>{type === "recording" && <div className="form-pair"><label>Raga<input name="raga" /></label><label>Tala<input name="tala" /></label></div>}<label>Choose file<input name="file" type="file" required accept={type === "recording" ? "audio/*,video/*" : type === "photo" ? "image/*" : undefined} /></label><label>Who can access this?<select name="visibility"><option value="members">All club members</option><option value="executives">Executives only</option></select></label></>}<button className="primary" disabled={saving}>{saving ? "Saving…" : "Save to archive"}</button></form></div>;
}

function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span>sa</span><h3>{title}</h3><p>{text}</p></div>; }
function LoadingScreen() { return <main className="loading-screen"><span className="brand-mark">sa</span><p>Opening the club archive…</p></main>; }
function InlineLoading() { return <div className="inline-loading">Loading the archive…</div>; }
function SetupScreen() { return <main className="loading-screen"><span className="brand-mark">sa</span><h2>Supabase connection needed</h2><p>Add the project URL and publishable key to the hosting environment.</p></main>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
