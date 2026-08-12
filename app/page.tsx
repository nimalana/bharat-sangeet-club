"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Section = "home" | "groups" | "calendar" | "members" | "attendance" | "recordings" | "documents" | "gallery" | "finances" | "admin";
type ClubRole = "member" | "executive" | "admin";
type ArchiveType = "recording" | "document" | "photo";
type ArchiveItem = {
  id: number; title: string; description: string; type: ArchiveType;
  storage_path: string; visibility: "members" | "executives";
  event_date: string | null; raga: string | null; tala: string | null; created_at: string;
  signedUrl?: string;
  is_public?: boolean;
  subgroup_id?: number | null;
};
type Transaction = {
  id: number; description: string; amount: number; category: string;
  transaction_date: string; created_at: string;
};
type ClubEvent = { id: number; title: string; description: string; starts_at: string; location: string; created_at: string };
type EnrollmentMode = "open" | "approval" | "invite";
type MembershipStatus = "active" | "pending" | "waitlisted" | "inactive";
type Subgroup = { id: number; name: string; description: string; enrollment_mode: EnrollmentMode };
type SubgroupMembership = { subgroup_id: number; member_id: string; status: MembershipStatus; membership_role: "member" | "leader" | "manager" };
type AttendanceSession = { id: number; subgroup_id: number; title: string; session_date: string };
type AttendanceRecord = { session_id: number; member_id: string; status: "present" | "absent" | "excused" };
type MemberProfile = { id: string; full_name: string; email: string; role: ClubRole; phone?: string; class_year?: string; specialty?: string; joined_at?: string };

const pendingSignupNameKey = "bharat-sangeet-pending-signup-name";

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
  const [showLogin, setShowLogin] = useState(false);
  const [groups, setGroups] = useState<Subgroup[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [workspaceId, setWorkspaceId] = useState<number | "club">("club");

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const loadProfile = useCallback(async (currentUser: User) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("profiles").select("full_name, role").eq("id", currentUser.id).single();
    if (error) { notify("We could not load your club profile"); return; }
    let profileName = data.full_name;
    const pendingSignupName = window.sessionStorage.getItem(pendingSignupNameKey)?.trim();
    if (pendingSignupName) {
      const { error: updateError } = await supabase.from("profiles").update({ full_name: pendingSignupName }).eq("id", currentUser.id);
      if (updateError) notify("Your account was created, but your preferred name could not be saved");
      else {
        profileName = pendingSignupName;
        window.sessionStorage.removeItem(pendingSignupNameKey);
      }
    }
    setRole(data.role as ClubRole);
    setName(profileName || currentUser.email?.split("@")[0] || "Club member");
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
    if (currentRole !== "member") {
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

  const loadWorkspaces = useCallback(async () => {
    if (!supabase || !user) return;
    const [groupResult, membershipResult] = await Promise.all([
      supabase.from("subgroups").select("id,name,description,enrollment_mode").order("name"),
      supabase.from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").eq("member_id", user.id),
    ]);
    if (groupResult.error || membershipResult.error) { notify("Your subgroup workspaces could not be loaded"); return; }
    setGroups((groupResult.data || []) as Subgroup[]);
    setMemberships((membershipResult.data || []) as SubgroupMembership[]);
  }, [notify, user]);
  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  const recordings = useMemo(() => archive.filter((item) => item.type === "recording" && `${item.title} ${item.description} ${item.raga || ""}`.toLowerCase().includes(query.toLowerCase())), [archive, query]);
  const documents = archive.filter((item) => item.type === "document");
  const photos = archive.filter((item) => item.type === "photo");
  const balance = transactions.reduce((sum, item) => sum + Number(item.amount), 0);
  const income = transactions.filter((item) => Number(item.amount) > 0).reduce((sum, item) => sum + Number(item.amount), 0);
  const expenses = transactions.filter((item) => Number(item.amount) < 0).reduce((sum, item) => sum + Number(item.amount), 0);
  const canManage = role !== "member";
  const activeGroupIds = new Set(memberships.filter((item) => item.status === "active").map((item) => item.subgroup_id));
  const availableWorkspaces = canManage ? groups : groups.filter((group) => activeGroupIds.has(group.id));

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
  if (!user) return showLogin ? <LoginScreen onBack={() => setShowLogin(false)} /> : <PublicSite onSignIn={() => setShowLogin(true)} />;

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")} aria-label="Bharat Sangeet at UNC Chapel Hill home"><span className="brand-mark">sa</span><span><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></span></button>
        <WorkspaceSwitcher groups={availableWorkspaces} selected={workspaceId} role={role} onSelect={(next) => { setWorkspaceId(next); navigate(next === "club" ? "home" : "groups"); }} onDiscover={() => navigate("groups")} onManage={() => navigate("attendance")} />
        <PortalPageMenu section={section} role={role} onNavigate={navigate} />
        <div className="account"><button className="role-button" onClick={() => supabase?.auth.signOut()} title="Sign out"><span className="avatar">{role === "admin" ? "AD" : role === "executive" ? "EX" : "MB"}</span><span><b>{name}</b><small>{role === "admin" ? "Admin · Sign out" : role === "executive" ? "Executive · Sign out" : "Member · Sign out"}</small></span></button></div>
      </header>

      {section === "home" && <ClubDashboard name={name} role={role} events={events} archive={archive} onNavigate={navigate} />}

      {false && section === "home" && <>
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

      {section === "groups" && <SubgroupSpaces user={user} role={role} selectedWorkspace={workspaceId} onWorkspaceChange={setWorkspaceId} onWorkspacesChanged={loadWorkspaces} notify={notify} />}

      {section === "admin" && role === "admin" && <AdminPage user={user} notify={notify} />}

      {section === "recordings" && <section className="section-shell page-section"><PageTitle eyebrow="LISTENING ROOM" title="Recordings archive" text="Concerts, rehearsals, workshops, and musical moments from every season." /><div className="toolbar"><label className="search">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, raga, or description" /></label>{role === "executive" && <button className="primary" onClick={() => setShowUpload(true)}>＋ Upload recording</button>}</div>{dataLoading ? <InlineLoading /> : recordings.length ? <div className="recording-list">{recordings.map((item, index) => <article className="recording-row" key={item.id}><button className="play" onClick={() => openFile(item)}>▶</button><div className="track-no">{String(index + 1).padStart(2, "0")}</div><div className="track-main"><h3>{item.title}</h3><p>{[item.raga, item.tala, item.description].filter(Boolean).join(" · ") || "Club recording"}</p></div><span className="pill">Recording</span><time>{formatDate(item.created_at)}</time><button className="more" onClick={() => openFile(item)}>•••</button></article>)}</div> : <EmptyState title="No recordings yet" text={role === "executive" ? "Upload the first rehearsal or concert recording." : "The executives have not added a recording yet."} />}</section>}

      {section === "calendar" && <section className="section-shell page-section"><PageTitle eyebrow="CLUB CALENDAR" title="Important dates" text="Rehearsals, performances, meetings, deadlines, and everything the club needs to remember." /><div className="toolbar"><p className="access-note">✓ Dates are shared with every approved club member</p>{canManage && <button className="primary" onClick={() => setShowEvent(true)}>＋ Add important date</button>}</div>{dataLoading ? <InlineLoading /> : <CalendarView events={events} canManage={canManage} onDelete={deleteEvent} />}</section>}

      {section === "attendance" && <AttendancePage user={user} role={role} selectedWorkspace={workspaceId} onWorkspaceChange={setWorkspaceId} onWorkspacesChanged={loadWorkspaces} notify={notify} />}

      {section === "members" && <MembersPage user={user} notify={notify} />}

      {section === "documents" && <section className="section-shell page-section"><PageTitle eyebrow="SHARED LIBRARY" title="Club documents" text="The practical side of our community—easy for every member to find and use." /><div className="toolbar"><p className="access-note">✓ All members can view and download shared files</p>{role === "executive" && <button className="primary" onClick={() => setShowUpload(true)}>＋ Add document</button>}</div>{documents.length ? <div className="document-grid">{documents.map((item) => <article className="document-card" key={item.id}><div className="file-top"><span className="file-icon">▤</span><span className="pill">{item.visibility}</span></div><h3>{item.title}</h3><p>{item.description || `Added ${formatDate(item.created_at)}`}</p><button onClick={() => openFile(item)}>Download <span>↓</span></button></article>)}</div> : <EmptyState title="No documents yet" text={role === "executive" ? "Add the constitution, repertoire, or member guide." : "Shared club documents will appear here."} />}</section>}

      {section === "gallery" && <section className="section-shell page-section"><PageTitle eyebrow="CLUB MEMORIES" title="Photo archive" text="The rehearsals, stages, and friendships that shape Bharat Sangeet." />{photos.length ? <div className="gallery-grid">{photos.map((item, index) => <figure key={item.id} className={index === 0 ? "wide" : ""}><img src={item.signedUrl} alt={item.title} /><figcaption><b>{item.title}</b><span>{formatDate(item.created_at)}</span></figcaption></figure>)}</div> : <EmptyState title="No club photos yet" text={role === "executive" ? "Upload the first memory from a rehearsal or concert." : "Club photos will appear here."} />}</section>}

      {section === "finances" && canManage && <section className="section-shell page-section"><PageTitle eyebrow="EXECUTIVE ACCESS" title="Club finances" text="A private, clear record of the funds that support our music." /><div className="finance-summary"><div><small>AVAILABLE BALANCE</small><strong>{money(balance)}</strong><span>Live club ledger</span></div><div><small>TOTAL INCOME</small><b className="income">{money(income)}</b><span>Recorded funds</span></div><div><small>TOTAL EXPENSES</small><b>{money(expenses)}</b><span>Recorded spending</span></div><button className="primary" onClick={() => setShowUpload(true)}>＋ Add transaction</button></div>{transactions.length ? <div className="ledger"><div className="ledger-head"><b>Recent activity</b><span>Club ledger</span></div>{transactions.map((item) => <div className="ledger-row" key={item.id}><span className={`money-mark ${Number(item.amount) > 0 ? "income" : "expense"}`}>{Number(item.amount) > 0 ? "+" : "−"}</span><b>{item.description}</b><span>{formatDate(item.transaction_date)}</span><strong className={Number(item.amount) > 0 ? "income" : "expense"}>{money(Number(item.amount))}</strong></div>)}</div> : <EmptyState title="No transactions yet" text="Add the first allocation, donation, or expense." />}</section>}

      <footer><div className="footer-brand"><span className="brand-mark">sa</span><div><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></div></div><p>Carnatic music at the University of North Carolina at Chapel Hill.</p><p>2026–27 Season</p></footer>
      {showUpload && <ArchiveModal user={user} onClose={() => setShowUpload(false)} onSaved={() => { setShowUpload(false); loadData(role); notify("Saved to the club archive"); }} notify={notify} />}
      {showEvent && <EventModal user={user} onClose={() => setShowEvent(false)} onSaved={() => { setShowEvent(false); loadData(role); notify("Important date added"); }} notify={notify} />}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function AdminPage({ user, notify }: { user: User; notify: (message: string) => void }) {
  const [members, setMembers] = useState<MemberProfile[]>([]); const [announcements, setAnnouncements] = useState<Array<{ id: number; title: string; body: string; is_pinned: boolean; published_at: string }>>([]); const [audit, setAudit] = useState<Array<{ id: number; action: string; actor_email: string; target_email: string; details: Record<string, string>; created_at: string }>>([]); const [query, setQuery] = useState(""); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { if (!supabase) return; const [m, a, l] = await Promise.all([supabase.from("profiles").select("id,full_name,email,role,phone,class_year,specialty,joined_at").order("full_name"), supabase.from("announcements").select("id,title,body,is_pinned,published_at").order("is_pinned", { ascending: false }).order("published_at", { ascending: false }), supabase.from("admin_audit_log").select("id,action,actor_email,target_email,details,created_at").order("created_at", { ascending: false }).limit(20)]); if (m.error || a.error || l.error) notify("Some admin data could not be loaded"); setMembers((m.data || []) as MemberProfile[]); setAnnouncements(a.data || []); setAudit(l.data || []); setLoading(false); }, [notify]);
  useEffect(() => { load(); }, [load]);
  async function changeRole(member: MemberProfile, nextRole: ClubRole) { if (!supabase || member.role === nextRole) return; const { error } = await supabase.rpc("admin_change_member_role", { p_target_id: member.id, p_new_role: nextRole }); if (error) notify(error.message); else { notify(`${member.full_name || member.email} is now ${nextRole}`); load(); } }
  async function deleteMember(member: MemberProfile) { if (!supabase || !window.confirm(`Permanently remove ${member.full_name || member.email}? Their login, subgroup memberships, and attendance will be deleted.`)) return; const { error } = await supabase.rpc("admin_delete_member", { p_target_id: member.id }); if (error) notify(error.message); else { notify("Member removed"); load(); } }
  async function createAnnouncement(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!supabase) return; const form = new FormData(event.currentTarget); const { error } = await supabase.from("announcements").insert({ title: String(form.get("title")), body: String(form.get("body")), is_pinned: form.get("is_pinned") === "on", created_by: user.id }); if (error) notify(error.message); else { event.currentTarget.reset(); notify("Announcement published"); load(); } }
  async function removeAnnouncement(id: number) { if (!supabase) return; const { error } = await supabase.from("announcements").delete().eq("id", id); if (error) notify(error.message); else load(); }
  const filtered = members.filter((member) => `${member.full_name} ${member.email} ${member.role}`.toLowerCase().includes(query.toLowerCase()));
  if (loading) return <section className="section-shell page-section"><InlineLoading /></section>;
  return <section className="section-shell page-section"><PageTitle eyebrow="ADMINISTRATION" title="Club control center" text="Manage identities, permissions, communications, and the health of the club workspace." /><div className="admin-stats"><div><strong>{members.length}</strong><span>Total members</span></div><div><strong>{members.filter((member) => member.role === "executive").length}</strong><span>Executives</span></div><div><strong>{members.filter((member) => member.role === "admin").length}</strong><span>Administrators</span></div><div><strong>{members.filter((member) => !member.phone || !member.specialty).length}</strong><span>Incomplete profiles</span></div></div><div className="admin-grid"><section className="admin-panel admin-members"><div className="admin-panel-heading"><div><p className="eyebrow">ACCESS & IDENTITIES</p><h2>Manage members</h2></div><label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members" /></label></div><div className="admin-member-head"><span>Member</span><span>Permission</span><span>Action</span></div>{filtered.map((member) => <div className="admin-member-row" key={member.id}><div><b>{member.full_name || member.email}</b><small>{member.email}</small></div><select value={member.role} disabled={member.id === user.id} onChange={(event) => changeRole(member, event.target.value as ClubRole)}><option value="member">Member</option><option value="executive">Executive</option><option value="admin">Admin</option></select><button className="danger-button" disabled={member.id === user.id} onClick={() => deleteMember(member)}>Remove</button></div>)}</section><aside><form className="admin-panel announcement-form" onSubmit={createAnnouncement}><p className="eyebrow">CLUB-WIDE</p><h2>Post announcement</h2><label>Title<input name="title" required maxLength={140} /></label><label>Message<textarea name="body" required rows={5} /></label><label className="check-label"><input name="is_pinned" type="checkbox" /> Pin to dashboard</label><button className="primary">Publish announcement</button></form><section className="admin-panel"><div className="admin-panel-heading"><h2>Announcements</h2><span>{announcements.length}</span></div>{announcements.slice(0, 5).map((item) => <article className="admin-announcement" key={item.id}><div><b>{item.is_pinned ? "◆ " : ""}{item.title}</b><small>{formatDate(item.published_at)}</small></div><button onClick={() => removeAnnouncement(item.id)}>×</button></article>)}</section></aside></div><section className="admin-panel audit-panel"><div className="admin-panel-heading"><div><p className="eyebrow">SECURITY</p><h2>Recent admin activity</h2></div><span>Last 20 actions</span></div>{audit.length ? audit.map((entry) => <div className="audit-row" key={entry.id}><span>{entry.action === "role_changed" ? "Permission changed" : "Member removed"}</span><b>{entry.target_email}</b><small>by {entry.actor_email} · {formatDate(entry.created_at)}</small></div>) : <p className="workspace-empty">No administrative changes recorded yet.</p>}</section></section>;
}

function ClubDashboard({ name, role, events, archive, onNavigate }: { name: string; role: ClubRole; events: ClubEvent[]; archive: ArchiveItem[]; onNavigate: (section: Section) => void }) {
  const upcoming = events.filter((event) => new Date(event.starts_at) >= new Date()).slice(0, 4);
  const clubItems = archive.filter((item) => !item.subgroup_id);
  return <section className="portal-dashboard"><div className="dashboard-welcome"><p className="eyebrow">UNC BHARAT SANGEET</p><h1>Welcome back, {name}.</h1><p>Your club announcements, upcoming dates, resources, and subgroup spaces—all in one place.</p></div><div className="dashboard-layout"><div><div className="dashboard-section-title"><h2>My club</h2><span>{role === "executive" ? "Executive view" : "Member view"}</span></div><div className="course-grid"><button onClick={() => onNavigate("groups")}><span>♫</span><small>ENROLLED SPACES</small><h3>My subgroups</h3><p>Open your ensemble spaces, files, recordings, and attendance.</p><b>Enter subgroups →</b></button><button onClick={() => onNavigate("documents")}><span>▤</span><small>CLUB-WIDE</small><h3>Shared resources</h3><p>{clubItems.filter((item) => item.type === "document").length} documents available to the whole club.</p><b>Browse resources →</b></button><button onClick={() => onNavigate("members")}><span>◎</span><small>COMMUNITY</small><h3>Member directory</h3><p>Find and connect with fellow Bharat Sangeet members.</p><b>View members →</b></button></div></div><aside className="dashboard-sidebar"><h2>Coming up</h2>{upcoming.length ? upcoming.map((event) => <article key={event.id}><time>{new Date(event.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time><div><b>{event.title}</b><span>{event.location || "Details in calendar"}</span></div></article>) : <p>No upcoming dates yet.</p>}<button className="secondary" onClick={() => onNavigate("calendar")}>Open full calendar</button></aside></div></section>;
}

function WorkspaceSwitcher({ groups, selected, role, onSelect, onDiscover, onManage }: { groups: Subgroup[]; selected: number | "club"; role: ClubRole; onSelect: (workspace: number | "club") => void; onDiscover: () => void; onManage: () => void }) {
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const active = groups.find((group) => group.id === selected);
  useEffect(() => {
    function close(event: MouseEvent) { if (!shell.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); shell.current?.querySelector<HTMLButtonElement>(".workspace-trigger")?.focus(); } }
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);
  function choose(next: number | "club") { onSelect(next); setOpen(false); }
  return <div className="workspace-switcher" ref={shell}><button className="workspace-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className="workspace-seal">{selected === "club" ? "BS" : initials(active?.name || "SG")}</span><span><small>Current workspace</small><b>{selected === "club" ? "Bharat Sangeet" : active?.name || "Subgroup"}</b></span><i aria-hidden="true">⌄</i></button>{open && <div className="workspace-menu" role="menu"><p>CLUB-WIDE</p><button role="menuitem" className={selected === "club" ? "selected" : ""} onClick={() => choose("club")}><span className="workspace-seal">BS</span><span><b>Bharat Sangeet</b><small>Shared club workspace</small></span>{selected === "club" && <i>✓</i>}</button><p>{role === "member" ? "MY SUBGROUPS" : "ALL SUBGROUPS"}</p>{groups.map((group) => <button role="menuitem" className={selected === group.id ? "selected" : ""} key={group.id} onClick={() => choose(group.id)}><span className="workspace-seal subgroup">{initials(group.name)}</span><span><b>{group.name}</b><small>{group.enrollment_mode === "invite" ? "Invitation only" : group.enrollment_mode === "approval" ? "Approval required" : "Open enrollment"}</small></span>{selected === group.id && <i>✓</i>}</button>)}{groups.length === 0 && <span className="workspace-menu-empty">No subgroup workspaces yet</span>}<button role="menuitem" className="workspace-discover-link" onClick={() => { setOpen(false); onDiscover(); }}>＋ Discover subgroups</button>{role !== "member" && <button role="menuitem" className="workspace-discover-link" onClick={() => { setOpen(false); onManage(); }}>＋ Create or manage subgroups</button>}</div>}</div>;
}

function PortalPageMenu({ section, role, onNavigate }: { section: Section; role: ClubRole; onNavigate: (section: Section) => void }) {
  const [open, setOpen] = useState(false); const shell = useRef<HTMLDivElement>(null);
  const labels: Record<Section, string> = { home: "Overview", groups: "Subgroups", calendar: "Calendar", members: "Members", attendance: "Attendance", recordings: "Recordings", documents: "Resources", gallery: "Photos", finances: "Finances", admin: "Admin" };
  const pages: Section[] = ["home", "groups", "calendar", "members", "attendance", "recordings", "documents", "gallery", ...(role !== "member" ? ["finances" as Section] : []), ...(role === "admin" ? ["admin" as Section] : [])];
  useEffect(() => { function close(event: MouseEvent) { if (!shell.current?.contains(event.target as Node)) setOpen(false); } function escape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); } document.addEventListener("mousedown", close); document.addEventListener("keydown", escape); return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); }; }, []);
  return <div className="page-menu-shell" ref={shell}><button className="page-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span><small>Page</small><b>{labels[section]}</b></span><i>⌄</i></button>{open && <div className="page-menu" role="menu">{pages.map((page) => <button role="menuitem" className={page === section ? "selected" : ""} key={page} onClick={() => { onNavigate(page); setOpen(false); }}><span>{labels[page]}</span>{page === section && <i>✓</i>}</button>)}</div>}</div>;
}

function SubgroupSpaces({ user, role, selectedWorkspace, onWorkspaceChange, onWorkspacesChanged, notify }: { user: User; role: ClubRole; selectedWorkspace: number | "club"; onWorkspaceChange: (workspace: number | "club") => void; onWorkspacesChanged: () => void; notify: (message: string) => void }) {
  const [groups, setGroups] = useState<Subgroup[]>([]); const [memberships, setMemberships] = useState<SubgroupMembership[]>([]); const [items, setItems] = useState<ArchiveItem[]>([]); const [showUpload, setShowUpload] = useState(false); const [loading, setLoading] = useState(true); const [joining, setJoining] = useState<number | null>(null); const [inlineMessage, setInlineMessage] = useState("");
  const load = useCallback(async () => { if (!supabase) return; const [g, m, a] = await Promise.all([supabase.from("subgroups").select("id,name,description,enrollment_mode").order("name"), supabase.from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").eq("member_id", user.id), supabase.from("archive_items").select("*").not("subgroup_id", "is", null).order("created_at", { ascending: false })]); if (g.error || m.error || a.error) notify("Subgroup spaces could not be loaded"); setGroups((g.data || []) as Subgroup[]); setMemberships((m.data || []) as SubgroupMembership[]); setItems((a.data || []) as ArchiveItem[]); setLoading(false); }, [notify, user.id]);
  useEffect(() => { load(); }, [load]);
  async function open(item: ArchiveItem) { if (!supabase) return; const { data, error } = await supabase.storage.from("club-archive").createSignedUrl(item.storage_path, 300); if (error || !data) notify("This file could not be opened"); else window.open(data.signedUrl, "_blank", "noopener,noreferrer"); }
  async function requestEnrollment(group: Subgroup) { if (!supabase) return; setJoining(group.id); setInlineMessage(""); const { data, error } = await supabase.rpc("request_subgroup_enrollment", { target_subgroup_id: group.id }); setJoining(null); if (error) { setInlineMessage(error.message); return; } const membership = data as SubgroupMembership; setMemberships((current) => [...current.filter((item) => item.subgroup_id !== group.id), membership]); onWorkspacesChanged(); if (membership.status === "active") { onWorkspaceChange(group.id); notify(`Welcome to ${group.name}`); } else setInlineMessage(`Your request to join ${group.name} was sent.`); }
  const selected = typeof selectedWorkspace === "number" ? selectedWorkspace : null; const active = groups.find((group) => group.id === selected); const groupItems = items.filter((item) => item.subgroup_id === selected); const docs = groupItems.filter((item) => item.type === "document"); const recordings = groupItems.filter((item) => item.type === "recording"); const membershipFor = (id: number) => memberships.find((item) => item.subgroup_id === id); const canEnter = (id: number) => role !== "member" || membershipFor(id)?.status === "active";
  if (loading) return <section className="section-shell page-section"><InlineLoading /></section>;
  return <section className="section-shell page-section"><PageTitle eyebrow="SUBGROUP WORKSPACES" title={active && canEnter(active.id) ? active.name : "Discover subgroups"} text={active && canEnter(active.id) ? active.description || "Resources, rehearsal recordings, and attendance for this subgroup." : "Find an ensemble, request access, or enter one of your current subgroup spaces."} />{inlineMessage && <p className="action-feedback" role="status">{inlineMessage}</p>}{active && canEnter(active.id) ? <div className="workspace-main standalone"><div className="workspace-banner"><div><p className="eyebrow">ACTIVE WORKSPACE</p><h2>{active.name}</h2><p>{active.description || "Rehearsal materials and recordings for this subgroup."}</p></div>{role !== "member" && <button className="primary" onClick={() => setShowUpload(true)}>＋ Add material</button>}</div><div className="workspace-columns"><section><div className="dashboard-section-title"><h3>Documents</h3><span>{docs.length}</span></div>{docs.length ? docs.map((item) => <button className="workspace-file" key={item.id} onClick={() => open(item)}><span>▤</span><div><b>{item.title}</b><small>{item.description || formatDate(item.created_at)}</small></div><i>↓</i></button>) : <p className="workspace-empty">No subgroup documents yet.</p>}</section><section><div className="dashboard-section-title"><h3>Recordings</h3><span>{recordings.length}</span></div>{recordings.length ? recordings.map((item) => <button className="workspace-file" key={item.id} onClick={() => open(item)}><span>▶</span><div><b>{item.title}</b><small>{[item.raga, item.tala, item.description].filter(Boolean).join(" · ") || formatDate(item.created_at)}</small></div><i>→</i></button>) : <p className="workspace-empty">No subgroup recordings yet.</p>}</section></div></div> : <div className="discover-grid">{groups.map((group) => { const membership = membershipFor(group.id); return <article className="discover-card" key={group.id}><span className="workspace-seal subgroup">{initials(group.name)}</span><p className="eyebrow">{group.enrollment_mode === "open" ? "OPEN ENROLLMENT" : group.enrollment_mode === "approval" ? "REQUEST TO JOIN" : "INVITATION ONLY"}</p><h2>{group.name}</h2><p>{group.description || "A Bharat Sangeet subgroup at UNC Chapel Hill."}</p>{canEnter(group.id) ? <button className="primary" onClick={() => onWorkspaceChange(group.id)}>Open workspace →</button> : membership?.status === "pending" ? <span className="enrollment-status">Request pending</span> : membership?.status === "waitlisted" ? <span className="enrollment-status">Waitlisted</span> : group.enrollment_mode === "invite" ? <span className="enrollment-status muted">Ask an executive for an invitation</span> : <button className="secondary" disabled={joining === group.id} onClick={() => requestEnrollment(group)}>{joining === group.id ? "Sending…" : group.enrollment_mode === "open" ? "Join subgroup" : "Request to join"}</button>}</article>; })}</div>}{showUpload && selected && <SubgroupUploadModal user={user} subgroupId={selected} onClose={() => setShowUpload(false)} onSaved={() => { setShowUpload(false); load(); notify("Added to subgroup space"); }} notify={notify} />}</section>;
}
function SubgroupUploadModal({ user, subgroupId, onClose, onSaved, notify }: { user: User; subgroupId: number; onClose: () => void; onSaved: () => void; notify: (message: string) => void }) {
  const [saving, setSaving] = useState(false); const [type, setType] = useState<"document" | "recording">("document");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!supabase) return; setSaving(true); const form = new FormData(event.currentTarget); const file = form.get("file") as File; const path = `${user.id}/subgroups/${subgroupId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`; const upload = await supabase.storage.from("club-archive").upload(path, file); if (upload.error) { notify(upload.error.message); setSaving(false); return; } const result = await supabase.from("archive_items").insert({ title: String(form.get("title")), description: String(form.get("description") || ""), type, storage_path: path, visibility: "members", subgroup_id: subgroupId, raga: type === "recording" ? String(form.get("raga") || "") || null : null, uploaded_by: user.id }); if (result.error) { await supabase.storage.from("club-archive").remove([path]); notify(result.error.message); setSaving(false); } else onSaved(); }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">SUBGROUP MATERIAL</p><h2>Add a resource</h2><label>Type<select value={type} onChange={(event) => setType(event.target.value as "document" | "recording")}><option value="document">Document</option><option value="recording">Recording</option></select></label><label>Title<input name="title" required /></label><label>Description<input name="description" /></label>{type === "recording" && <label>Raga<input name="raga" /></label>}<label>File<input name="file" type="file" required accept={type === "recording" ? "audio/*,video/*" : undefined} /></label><button className="primary" disabled={saving}>{saving ? "Uploading…" : "Add to subgroup"}</button></form></div>;
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

function MembersPage({ user, notify }: { user: User; notify: (message: string) => void }) {
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadMembers = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("profiles").select("id,full_name,email,role,phone,class_year,specialty,joined_at").order("full_name");
    if (error) notify("The member directory could not be loaded");
    setMembers((data || []) as MemberProfile[]); setLoading(false);
  }, [notify]);
  useEffect(() => { loadMembers(); }, [loadMembers]);
  const ownProfile = members.find((member) => member.id === user.id);
  const filtered = members.filter((member) => `${member.full_name} ${member.email} ${member.specialty || ""} ${member.class_year || ""}`.toLowerCase().includes(query.toLowerCase()));
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setSaving(true);
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("profiles").update({ full_name: String(form.get("full_name") || ""), phone: String(form.get("phone") || ""), class_year: String(form.get("class_year") || ""), specialty: String(form.get("specialty") || "") }).eq("id", user.id);
    setSaving(false); if (error) notify(error.message); else { notify("Your contact information was updated"); setEditing(false); loadMembers(); }
  }
  if (loading) return <section className="section-shell page-section"><InlineLoading /></section>;
  return <section className="section-shell page-section"><PageTitle eyebrow="CLUB COMMUNITY" title="Members directory" text="Contact information for the people who make music with Bharat Sangeet at UNC Chapel Hill." /><div className="toolbar"><label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, year, or musical interest" /></label><button className="primary" onClick={() => setEditing(true)}>Edit my contact info</button></div><p className="directory-note">This directory is visible only to signed-in club members.</p>{filtered.length ? <div className="member-grid">{filtered.map((member) => <article className="member-card" key={member.id}><div className="member-initials">{initials(member.full_name || member.email)}</div><div className="member-card-heading"><h3>{member.full_name || member.email.split("@")[0]}</h3><span className={`member-role ${member.role}`}>{member.role}</span></div><p>{member.specialty || "Musical interests not added yet"}</p><dl><div><dt>Email</dt><dd><a href={`mailto:${member.email}`}>{member.email}</a></dd></div>{member.phone && <div><dt>Phone</dt><dd><a href={`tel:${member.phone}`}>{member.phone}</a></dd></div>}{member.class_year && <div><dt>Class year</dt><dd>{member.class_year}</dd></div>}</dl></article>)}</div> : <EmptyState title="No members found" text="Try another search." />}{editing && <div className="modal-backdrop" onMouseDown={() => setEditing(false)}><form className="modal" onSubmit={saveProfile} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setEditing(false)}>×</button><p className="eyebrow">MY MEMBER PROFILE</p><h2>Contact information</h2><label>Preferred name<input name="full_name" required defaultValue={ownProfile?.full_name || ""} /></label><label>Email<input value={ownProfile?.email || user.email || ""} disabled /></label><label>Phone number<input name="phone" type="tel" defaultValue={ownProfile?.phone || ""} placeholder="Optional" /></label><div className="form-pair"><label>Class year<input name="class_year" defaultValue={ownProfile?.class_year || ""} placeholder="2028" /></label><label>Voice / instrument<input name="specialty" defaultValue={ownProfile?.specialty || ""} placeholder="Vocal, violin, mridangam…" /></label></div><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button></form></div>}</section>;
}

function AttendancePage({ user, role, selectedWorkspace, onWorkspaceChange, onWorkspacesChanged, notify }: { user: User; role: ClubRole; selectedWorkspace: number | "club"; onWorkspaceChange: (workspace: number | "club") => void; onWorkspacesChanged: () => void; notify: (message: string) => void }) {
  const [groups, setGroups] = useState<Subgroup[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [profiles, setProfiles] = useState<MemberProfile[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [newGroupId, setNewGroupId] = useState<number | null>(null);

  const loadAttendance = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [groupResult, membershipResult, sessionResult, recordResult, profileResult] = await Promise.all([
      supabase.from("subgroups").select("id, name, description, enrollment_mode").order("name"),
      supabase.from("subgroup_memberships").select("subgroup_id, member_id, status, membership_role"),
      supabase.from("attendance_sessions").select("id, subgroup_id, title, session_date").order("session_date", { ascending: false }),
      supabase.from("attendance_records").select("session_id, member_id, status"),
      role !== "member" ? supabase.from("profiles").select("id, full_name, email, role").order("full_name") : Promise.resolve({ data: [], error: null }),
    ]);
    const error = groupResult.error || membershipResult.error || sessionResult.error || recordResult.error || profileResult.error;
    if (error) notify("Attendance records could not be loaded");
    const allGroups = (groupResult.data || []) as Subgroup[];
    const nextMemberships = (membershipResult.data || []) as SubgroupMembership[];
    const nextGroups = role !== "member" ? allGroups : allGroups.filter((group) => nextMemberships.some((membership) => membership.subgroup_id === group.id && membership.status === "active"));
    setGroups(nextGroups); setMemberships(nextMemberships); setSessions((sessionResult.data || []) as AttendanceSession[]); setRecords((recordResult.data || []) as AttendanceRecord[]); setProfiles((profileResult.data || []) as MemberProfile[]);
    setSelectedGroup((current) => current && nextGroups.some((group) => group.id === current) ? current : nextGroups[0]?.id ?? null);
    setLoading(false);
  }, [notify, role]);

  useEffect(() => { loadAttendance(); }, [loadAttendance]);
  useEffect(() => { if (typeof selectedWorkspace === "number") { setSelectedGroup(selectedWorkspace); setSelectedSession(null); } }, [selectedWorkspace]);

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; const formElement = event.currentTarget; const form = new FormData(formElement); setCreatingGroup(true); setCreateMessage("");
    const { data, error } = await supabase.rpc("create_subgroup", { subgroup_name: String(form.get("name") || ""), subgroup_description: String(form.get("description") || ""), subgroup_mode: String(form.get("enrollment_mode") || "invite") });
    setCreatingGroup(false);
    if (error) { setCreateMessage(error.message); return; }
    const created = data as Subgroup; setGroups((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name))); setMemberships((current) => [...current, { subgroup_id: created.id, member_id: user.id, status: "active", membership_role: "manager" }]); setSelectedGroup(created.id); setSelectedSession(null); setNewGroupId(created.id); onWorkspaceChange(created.id); onWorkspacesChanged(); formElement.reset(); setCreateMessage(`${created.name} was created and opened.`); notify("Subgroup created"); window.setTimeout(() => setNewGroupId(null), 2600);
  }
  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !selectedGroup) return; const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("subgroup_memberships").upsert({ subgroup_id: selectedGroup, member_id: String(form.get("member_id")), added_by: user.id, reviewed_by: user.id, status: "active", membership_role: "member" }, { onConflict: "subgroup_id,member_id" });
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
  const groupMemberships = memberships.filter((membership) => membership.subgroup_id === selectedGroup && membership.status === "active");
  const groupSessions = sessions.filter((session) => session.subgroup_id === selectedGroup);
  const availableProfiles = profiles.filter((profile) => !groupMemberships.some((membership) => membership.member_id === profile.id));
  if (loading) return <section className="section-shell page-section"><InlineLoading /></section>;

  return <section className="section-shell page-section"><PageTitle eyebrow="SUBGROUPS" title="Attendance" text={role !== "member" ? "Create ensembles, organize rosters, and manage attendance inside each subgroup workspace." : "See your subgroups and personal attendance history."} />{role !== "member" && <><form className="create-group-bar" onSubmit={createGroup} aria-busy={creatingGroup}><input name="name" required disabled={creatingGroup} placeholder="New subgroup name" /><input name="description" disabled={creatingGroup} placeholder="Short description" /><select name="enrollment_mode" defaultValue="invite" disabled={creatingGroup} aria-label="Enrollment type"><option value="open">Open enrollment</option><option value="approval">Approval required</option><option value="invite">Invite only</option></select><button className="primary" disabled={creatingGroup}>{creatingGroup ? "Creating…" : "＋ Create subgroup"}</button></form>{createMessage && <p className={`action-feedback ${createMessage.includes("created") ? "success" : "error"}`} role="status">{createMessage}</p>}</>}{groups.length === 0 ? <EmptyState title="No subgroups yet" text={role !== "member" ? "Create the first subgroup above." : "An executive has not assigned you to a subgroup yet."} /> : <div className="attendance-layout"><aside className="subgroup-list"><small>SUBGROUPS</small>{groups.map((group) => <button key={group.id} className={`${selectedGroup === group.id ? "active" : ""} ${newGroupId === group.id ? "is-new" : ""}`} onClick={() => { setSelectedGroup(group.id); onWorkspaceChange(group.id); setSelectedSession(null); }}><b>{group.name}</b><span>{memberships.filter((membership) => membership.subgroup_id === group.id && membership.status === "active").length} members</span></button>)}</aside><div className="attendance-workspace"><div className="subgroup-heading"><div><h2>{activeGroup?.name}</h2><p>{activeGroup?.description || "UNC Chapel Hill Bharat Sangeet subgroup"}</p></div><span>{groupMemberships.length} members · {groupSessions.length} meetings</span></div>{role !== "member" && <><form className="roster-add" onSubmit={addMember}><select name="member_id" required defaultValue=""><option value="" disabled>Add a club member…</option>{availableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email} ({profile.email})</option>)}</select><button>Add to subgroup</button></form><div className="roster-chips">{groupMemberships.map((membership) => { const profile = profiles.find((item) => item.id === membership.member_id); return <span key={membership.member_id}>{profile?.full_name || profile?.email || "Member"}<button onClick={() => removeMember(membership.member_id)} aria-label="Remove member">×</button></span>; })}</div><form className="session-create" onSubmit={createSession}><input name="title" required placeholder="Meeting or rehearsal name" /><input name="session_date" type="date" required /><button className="primary">Create attendance date</button></form></>}<div className="session-tabs">{groupSessions.map((session) => <button key={session.id} className={selectedSession === session.id ? "active" : ""} onClick={() => setSelectedSession(session.id)}><b>{formatDate(session.session_date)}</b><span>{session.title}</span></button>)}</div>{selectedSession ? <div className="attendance-table"><div className="attendance-table-head"><b>Member</b><span>Status</span></div>{groupMemberships.map((membership) => { const profile = profiles.find((item) => item.id === membership.member_id); const record = records.find((item) => item.session_id === selectedSession && item.member_id === membership.member_id); return <div className="attendance-row" key={membership.member_id}><div><b>{profile?.full_name || (membership.member_id === user.id ? user.email : "Member")}</b><small>{profile?.email || (membership.member_id === user.id ? user.email : "")}</small></div>{role !== "member" ? <select value={record?.status || ""} onChange={(event) => markAttendance(membership.member_id, event.target.value as AttendanceRecord["status"])}><option value="" disabled>Not marked</option><option value="present">Present</option><option value="absent">Absent</option><option value="excused">Excused</option></select> : <span className={`attendance-status ${record?.status || "unmarked"}`}>{record?.status || "Not marked"}</span>}</div>; })}</div> : <div className="attendance-prompt">Choose an attendance date to view or mark attendance.</div>}</div></div>}</section>;
}

function PublicSite({ onSignIn }: { onSignIn: () => void }) {
  const [recordings, setRecordings] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("archive_items").select("id,title,description,type,storage_path,event_date,raga,tala,created_at,is_public").eq("type", "recording").eq("is_public", true).order("event_date", { ascending: false }).then(({ data }) => { setRecordings((data || []) as ArchiveItem[]); setLoading(false); });
  }, []);
  async function watch(item: ArchiveItem) {
    if (!supabase) return;
    const { data } = await supabase.storage.from("club-archive").createSignedUrl(item.storage_path, 600);
    if (data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  return <main className="public-site"><header className="public-header"><button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span className="brand-mark">sa</span><span><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></span></button><nav><a href="#about">About</a><a href="#concerts">Concerts</a></nav><button className="primary small" onClick={onSignIn}>Member sign in →</button></header><section className="public-hero"><div><p className="eyebrow">UNIVERSITY OF NORTH CAROLINA AT CHAPEL HILL</p><h1>Carnatic music.<br /><em>Carolina community.</em></h1><p className="lede">Bharat Sangeet brings students together to learn, perform, and celebrate the rich tradition of Carnatic music at UNC Chapel Hill.</p><div className="hero-actions"><a className="primary public-link" href="#concerts">Watch our concerts <span>→</span></a><button className="secondary" onClick={onSignIn}>Join or sign in</button></div></div><div className="hero-image"><img src={heroPhotos[0].src} alt={heroPhotos[0].alt} /><div className="image-caption"><span>Music at Carolina</span><b>Tradition in conversation</b></div></div></section><section className="public-about" id="about"><div><p className="eyebrow">ABOUT THE CLUB</p><h2>A home for Carnatic music at UNC</h2></div><p>We are a student community for vocalists, instrumentalists, percussionists, listeners, and anyone curious about South Indian classical music. Through rehearsals, subgroups, workshops, and concerts, members make music and build lasting friendships.</p></section><section className="section-shell public-concerts" id="concerts"><PageTitle eyebrow="FROM THE STAGE" title="Concert recordings" text="Public performances shared by Bharat Sangeet. Rehearsals and other club materials remain private to members." />{loading ? <InlineLoading /> : recordings.length ? <div className="public-recording-grid">{recordings.map((item) => <article key={item.id}><span className="line-icon">▶</span><p className="eyebrow">CONCERT RECORDING</p><h3>{item.title}</h3><p>{[item.raga, item.tala, item.description].filter(Boolean).join(" · ")}</p><button className="secondary" onClick={() => watch(item)}>Watch or listen →</button></article>)}</div> : <EmptyState title="Concert archive coming soon" text="Public concert recordings selected by club executives will appear here." />}</section><section className="public-join"><p className="eyebrow">UNC STUDENTS</p><h2>Make music with us.</h2><p>Sign up with Google to join as a club member. Executive access is assigned separately.</p><button className="primary" onClick={onSignIn}>Join Bharat Sangeet →</button></section><footer><div className="footer-brand"><span className="brand-mark">sa</span><div><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></div></div><p>Carnatic music at the University of North Carolina at Chapel Hill.</p><p>2026–27 Season</p></footer></main>;
}

function LoginScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [preferredName, setPreferredName] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function signInWithGoogle() {
    if (!supabase) return;
    const signupName = preferredName.trim();
    if (mode === "signup" && !signupName) {
      setErrorMessage("Please enter the name you would like the club to call you.");
      return;
    }
    if (mode === "signup") window.sessionStorage.setItem(pendingSignupNameKey, signupName);
    else window.sessionStorage.removeItem(pendingSignupNameKey);
    setSending(true);
    setErrorMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      window.sessionStorage.removeItem(pendingSignupNameKey);
      setErrorMessage(error.message);
      setSending(false);
    }
  }

  return <main className="login-page"><div className="login-art"><img src={heroPhotos[0].src} alt={heroPhotos[0].alt} /><div><span className="brand-mark">sa</span><h1>Music remembered.<br /><em>Community connected.</em></h1></div></div><section className="login-panel"><div className="login-box"><p className="eyebrow">UNC CHAPEL HILL MEMBER PORTAL</p><div className="auth-tabs"><button className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setErrorMessage(""); window.sessionStorage.removeItem(pendingSignupNameKey); }}>Member sign in</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setErrorMessage(""); }}>Join the club</button></div><h2>{mode === "signup" ? "Join Bharat Sangeet" : "Welcome to Bharat Sangeet"}</h2><p>{mode === "signup" ? "Sign up with Google to join the UNC Chapel Hill club. Every new account begins as a regular member." : "Use the Google account connected to your UNC Chapel Hill club membership. No password is required."}</p>{mode === "signup" && <label className="signup-name">Preferred name<input autoComplete="name" value={preferredName} onChange={(event) => setPreferredName(event.target.value)} placeholder="What should we call you?" required /></label>}<button className="google-button" type="button" onClick={signInWithGoogle} disabled={sending}><span aria-hidden="true">G</span>{sending ? "Opening Google…" : mode === "signup" ? "Sign up with Google" : "Continue with Google"}</button>{errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}<small>{mode === "signup" ? "Executive access is assigned separately by current club executives." : "Access your recordings, documents, calendar, subgroups, and attendance."}</small></div></section></main>;
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
    const access = String(form.get("visibility") || "members");
    const saved = await supabase.from("archive_items").insert({ title, description: String(form.get("description") || ""), type, storage_path: storagePath, visibility: access === "public" ? "members" : access, is_public: type === "recording" && access === "public", raga: type === "recording" ? String(form.get("raga") || "") || null : null, tala: type === "recording" ? String(form.get("tala") || "") || null : null, uploaded_by: user.id });
    if (saved.error) { await supabase.storage.from("club-archive").remove([storagePath]); setSaving(false); notify(saved.error.message); return; }
    setSaving(false); onSaved();
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">EXECUTIVE TOOL</p><h2>Add to club records</h2><label>Item type<select value={type} onChange={(e) => setType(e.target.value as ArchiveType | "financial")}><option value="recording">Recording</option><option value="document">Document</option><option value="photo">Photo</option><option value="financial">Financial transaction</option></select></label><label>{type === "financial" ? "Description" : "Title"}<input name="title" required placeholder="Give this item a clear name" /></label>{type === "financial" ? <><label>Amount<input name="amount" type="number" step="0.01" required placeholder="Use a negative number for expenses" /></label><label>Category<input name="category" required placeholder="Venue, donation, equipment…" /></label></> : <><label>Description<input name="description" placeholder="Optional context for members" /></label>{type === "recording" && <div className="form-pair"><label>Raga<input name="raga" /></label><label>Tala<input name="tala" /></label></div>}<label>Choose file<input name="file" type="file" required accept={type === "recording" ? "audio/*,video/*" : type === "photo" ? "image/*" : undefined} /></label><label>Who can access this?<select name="visibility"><option value="members">All club members</option><option value="executives">Executives only</option>{type === "recording" && <option value="public">Everyone (public concert)</option>}</select></label></>}<button className="primary" disabled={saving}>{saving ? "Saving…" : "Save to archive"}</button></form></div>;
}

function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span>sa</span><h3>{title}</h3><p>{text}</p></div>; }
function LoadingScreen() { return <main className="loading-screen"><span className="brand-mark">sa</span><p>Opening the club archive…</p></main>; }
function InlineLoading() { return <div className="inline-loading">Loading the archive…</div>; }
function SetupScreen() { return <main className="loading-screen"><span className="brand-mark">sa</span><h2>Supabase connection needed</h2><p>Add the project URL and publishable key to the hosting environment.</p></main>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function initials(value: string) { return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BS"; }
