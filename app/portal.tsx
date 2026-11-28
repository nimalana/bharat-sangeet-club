"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AdminPage } from "../features/admin/components/admin-page";
import { DeactivatedScreen } from "../features/admin/components/member-access";
import { setCacheOwner } from "../lib/cache";
import { runBootstrap, type ShellState } from "../lib/bootstrap";
import { friendlyError } from "../lib/errors";
import { canManageClub } from "../lib/permissions";
import type { ArchiveVisibility, ClubRole } from "../lib/db";
import { removeStoredFile } from "../lib/storage";
import type { Notify } from "../lib/toast";
import type { AccountStatus, Announcement, ArchiveItem, ClubEvent, ScopeFilter, Subgroup, SubgroupMembership } from "../lib/portal-types";
import type { PublicConcert } from "../lib/public-concerts";
import { countOrKeep, listOrKeep } from "../lib/refresh";
import { createRequestGate } from "../lib/request-gate";
import { SECTION_LABELS, menuGroups, menuPages, resolveSection, sectionFromSearch, sectionUrl, type Section } from "../lib/sections";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { LoadingBlock } from "../components/ui/loading-block";
import { PageTitle } from "../components/ui/page-title";
import { SectionBoundary } from "../components/ui/section-boundary";
import { ToastProvider, ToastViewport, useToast } from "../components/ui/toast";
import { AnnouncementFeed, type AnnouncementManage } from "../features/announcements/components/announcement-feed";
import { ScopeFilterBar } from "../features/announcements/components/scope-filter-bar";
import dynamic from "next/dynamic";
import { SubgroupSpaces } from "../features/groups/components/subgroup-spaces";
import { MembersPage } from "../features/members/components/members-page";

// Each heavy screen is its own bundle, loaded when it is first opened, so the
// audio libraries and finance code are not downloaded to read the calendar.
// A screen whose file cannot be fetched is caught by SectionBoundary in the shell.
const SectionLoading = () => <LoadingBlock role="status">Loading…</LoadingBlock>;
const AttendancePage = dynamic(() => import("./attendance").then((module) => module.AttendancePage), { ssr: false, loading: SectionLoading });
const FinancePage = dynamic(() => import("./finance").then((module) => module.FinancePage), { ssr: false, loading: SectionLoading });
const ResourceLibrary = dynamic(() => import("./resources").then((module) => module.ResourceLibrary), { ssr: false, loading: SectionLoading });
const RecordingWorkspace = dynamic(() => import("../components/recordings/recording-workspace").then((module) => module.RecordingWorkspace), { ssr: false, loading: SectionLoading });
const ClubArchiveManager = dynamic(() => import("../components/recordings/club-archive-manager").then((module) => module.ClubArchiveManager), { ssr: false, loading: SectionLoading });

type PortalBootstrap = { profile: { full_name: string; role: ClubRole; status: AccountStatus } | null; groups: Subgroup[]; memberships: SubgroupMembership[]; announcements: Announcement[]; events: ClubEvent[]; archive: ArchiveItem[]; resource_count: number };
type TalamPattern = { name: string; tradition: "Hindustani" | "Carnatic"; beats: number; divisions: number[] };

function sectionFromUrl(): Section {
  if (typeof window === "undefined") return "home";
  return sectionFromSearch(window.location.search);
}

function attendanceTabFromUrl(): "overview" | "meetings" | "excuses" {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  return params.get("page") === "meetings" || params.get("tab") === "meetings" ? "meetings" : "overview";
}

const pendingSignupNameKey = "bharat-sangeet-pending-signup-name";
const talamPatterns: TalamPattern[] = [
  { name: "Teentaal", tradition: "Hindustani", beats: 16, divisions: [4, 4, 4, 4] },
  { name: "Dadra", tradition: "Hindustani", beats: 6, divisions: [3, 3] },
  { name: "Keharwa", tradition: "Hindustani", beats: 8, divisions: [4, 4] },
  { name: "Adi Talam", tradition: "Carnatic", beats: 8, divisions: [4, 2, 2] },
  { name: "Misra Chapu", tradition: "Carnatic", beats: 7, divisions: [3, 2, 2] },
  { name: "Khanda Chapu", tradition: "Carnatic", beats: 5, divisions: [2, 3] },
];
const heroPhotos = [
  { src: "https://asianartsagency.co.uk/wp-content/uploads/2021/08/Trio-WP.jpg", alt: "Indian classical musicians performing together" },
  { src: "https://static.wixstatic.com/media/08d671_184493ea312d46e89a838c34d1097f42~mv2.jpg/v1/fill/w_2500,h_1203,al_c/08d671_184493ea312d46e89a838c34d1097f42~mv2.jpg", alt: "Indian classical ensemble in concert" },
];

// True when this browser holds a saved sign-in. The server render cannot know,
// so it reports false and the first client render agrees; the value is read
// right after hydration.
const subscribeNothing = () => () => {};
function hasSavedSession() {
  try { return Object.keys(window.localStorage).some((key) => /^sb-.+-auth-token$/.test(key)); } catch { return false; }
}

export default function Home(props: { publicConcerts?: PublicConcert[] | null }) {
  return <ToastProvider><Portal {...props} /></ToastProvider>;
}

function Portal({ publicConcerts = null }: { publicConcerts?: PublicConcert[] | null }) {
  const savedSession = useSyncExternalStore(subscribeNothing, hasSavedSession, () => false);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<ClubRole>("member");
  // The signed-in screens wait for get_portal_bootstrap: the role and the
  // deactivated flag both come from it, so nothing is shown on a guess.
  const [shellState, setShellState] = useState<ShellState>("loading");
  const [name, setName] = useState("");
  const [section, setSection] = useState<Section>(sectionFromUrl);
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [query, setQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ClubEvent | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [groups, setGroups] = useState<Subgroup[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [recordingScope, setRecordingScope] = useState<ScopeFilter>("all");
  const [calendarScope, setCalendarScope] = useState<ScopeFilter>("all");
  const [attendanceInitialScope, setAttendanceInitialScope] = useState<ScopeFilter>("all");
  const [resourceInitialScope, setResourceInitialScope] = useState<ScopeFilter>("all");
  const [resourceCount, setResourceCount] = useState(0);
  // Overlapping loads: only the newest may change the screen, and none may once the account has changed.
  const [dataGate] = useState(createRequestGate);
  const [workspaceGate] = useState(createRequestGate);

  // A failure is shown as one: no tick, and screen readers get an alert (components/ui/toast.tsx).
  // Screens that have not moved to useToast() yet are still given `notify` as a prop.
  const { notify } = useToast();

  // Supabase hands back a new user object on every token refresh. Keeping the
  // old one while the id is unchanged stops every screen from reloading.
  const adoptUser = useCallback((next: User | null) => { setUser((current) => (current?.id === next?.id ? current : next)); }, []);

  // One request loads everything the shell needs. A response that arrives
  // after the signed-in account has changed is thrown away (P1-07). If it does
  // not arrive, the shell shows an error with Retry, never the member screens.
  const activeUserId = useRef<string | null>(null);
  const bootstrap = useCallback(async (currentUser: User) => {
    if (!supabase) return;
    const client = supabase;
    setShellState("loading");
    setDataLoading(true);
    const outcome = await runBootstrap<PortalBootstrap>(() => client.rpc("get_portal_bootstrap"));
    if (activeUserId.current !== currentUser.id) return;
    setDataLoading(false);
    if (outcome.kind !== "ready") { setShellState(outcome.kind); return; }
    const boot = outcome.boot;
    setRole(boot.profile.role);
    setGroups(boot.groups);
    setMemberships(boot.memberships);
    setAnnouncements(boot.announcements);
    setEvents(boot.events);
    setArchive(boot.archive);
    setResourceCount(Number(boot.resource_count) || 0);
    setName(boot.profile.full_name || currentUser.email?.split("@")[0] || "Club member");
    setShellState("ready");
    const pendingSignupName = window.sessionStorage.getItem(pendingSignupNameKey)?.trim();
    if (pendingSignupName) {
      const { error: updateError } = await client.from("profiles").update({ full_name: pendingSignupName }).eq("id", currentUser.id);
      if (updateError) notify("Your account was created, but your preferred name could not be saved");
      else {
        window.sessionStorage.removeItem(pendingSignupNameKey);
        if (activeUserId.current === currentUser.id) setName(pendingSignupName);
      }
    }
  }, [notify]);

  const loadData = useCallback(async () => {
    const client = supabase;
    if (!client) return;
    const owner = activeUserId.current;
    const isCurrent = dataGate.begin();
    setDataLoading(true);
    try {
      const [archiveResult, eventsResult, announcementResult, resourceCountResult] = await Promise.all([
        client.from("archive_items").select("*").eq("type", "recording").order("created_at", { ascending: false }),
        client.from("events").select("*").gte("starts_at", new Date(Date.now() - 365 * 86400000).toISOString()).order("starts_at", { ascending: true }),
        client.from("announcements").select("*").order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(12),
        client.from("resources").select("id", { count: "exact", head: true }).neq("status", "archived"),
      ]);
      if (!isCurrent() || activeUserId.current !== owner) return;
      if (archiveResult.error) notify("The club archive could not be loaded");
      if (eventsResult.error) notify("The calendar could not be loaded");
      if (announcementResult.error) notify("Announcements could not be loaded");
      if (resourceCountResult.error) notify("The resource count could not be loaded");
      // A list that failed to load keeps what is shown; it is not replaced by an empty one.
      setArchive((current) => listOrKeep(current, archiveResult as { data: ArchiveItem[] | null; error?: unknown }));
      setEvents((current) => listOrKeep(current, eventsResult as { data: ClubEvent[] | null; error?: unknown }));
      setAnnouncements((current) => listOrKeep(current, announcementResult as { data: Announcement[] | null; error?: unknown }));
      setResourceCount((current) => countOrKeep(current, resourceCountResult));
    } catch {
      if (isCurrent()) notify("The club data could not be loaded. Check your connection and try again.");
    } finally {
      if (isCurrent()) setDataLoading(false);
    }
  }, [dataGate, notify]);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    const client = supabase;
    let cancelled = false;
    const loadingTimeouts = new Set<number>();
    const hydrateAuth = async () => {
      const loadingTimeout = window.setTimeout(() => { if (!cancelled) setAuthLoading(false); }, 7000);
      loadingTimeouts.add(loadingTimeout);
      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (cancelled) return;
        adoptUser(data.session?.user ?? null);
      } catch {
        if (!cancelled) adoptUser(null);
      } finally {
        window.clearTimeout(loadingTimeout);
        loadingTimeouts.delete(loadingTimeout);
        if (!cancelled) setAuthLoading(false);
      }
    };
    void hydrateAuth();
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      adoptUser(session?.user ?? null);
    });
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { setAuthLoading(true); void hydrateAuth(); } };
    window.addEventListener("pageshow", restore);
    return () => { cancelled = true; loadingTimeouts.forEach((timeout) => window.clearTimeout(timeout)); window.removeEventListener("pageshow", restore); listener.subscription.unsubscribe(); };
  }, [adoptUser]);

  const resetShell = useCallback(() => {
    setRole("member"); setName(""); setShellState("loading"); setGroups([]); setMemberships([]);
    setAnnouncements([]); setEvents([]); setArchive([]); setResourceCount(0); setDataLoading(false);
  }, []);

  // Runs once per signed-in account, not on every token refresh.
  useEffect(() => {
    activeUserId.current = user?.id ?? null;
    dataGate.cancel(); workspaceGate.cancel();
    setCacheOwner(user?.id ?? null);
    // This effect synchronizes the shell with the signed-in account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void bootstrap(user); else resetShell();
  }, [user, bootstrap, resetShell, dataGate, workspaceGate]);

  useEffect(() => {
    const restoreLocation = () => {
      const params = new URLSearchParams(window.location.search);
      setShowLogin(params.has("signin"));
      setSection(sectionFromUrl());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, []);


  const loadWorkspaces = useCallback(async () => {
    if (!supabase || !user || shellState !== "ready") return;
    const isCurrent = workspaceGate.begin();
    const [groupResult, membershipResult] = await Promise.all([
      supabase.from("subgroups").select("id,name,description,enrollment_mode,archived_at").is("archived_at", null).order("name"),
      supabase.from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").eq("member_id", user.id),
    ]);
    if (!isCurrent() || activeUserId.current !== user.id) return;
    if (groupResult.error || membershipResult.error) { notify("Your groups could not be loaded"); return; }
    setGroups((groupResult.data || []) as Subgroup[]);
    setMemberships((membershipResult.data || []) as SubgroupMembership[]);
  }, [notify, user, shellState, workspaceGate]);

  const canManage = canManageClub(role);
  const activeGroupIds = new Set(memberships.filter((item) => item.status === "active").map((item) => item.subgroup_id));
  const availableGroups = canManage ? groups : groups.filter((group) => activeGroupIds.has(group.id));
  const matchesScope = (subgroupId: number | null | undefined, scope: ScopeFilter) => scope === "all" || (scope === "club" ? !subgroupId : subgroupId === scope);
  const recordings = useMemo(() => archive.filter((item) => item.type === "recording" && matchesScope(item.subgroup_id, recordingScope) && `${item.title} ${item.description} ${item.raga || ""}`.toLowerCase().includes(query.toLowerCase())), [archive, query, recordingScope]);
  const visibleEvents = events.filter((item) => matchesScope(item.subgroup_id, calendarScope));

  const navigate = (next: Section) => {
    if (next === "home" && user) loadData();
    setSection(next);
    const nextUrl = sectionUrl(window.location.pathname, next);
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState({ section: next }, "", nextUrl);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openLogin = () => {
    setShowLogin(true);
    if (!new URLSearchParams(window.location.search).has("signin")) window.history.pushState({ signin: true }, "", `${window.location.pathname}?signin=1`);
  };

  const closeLogin = () => {
    setShowLogin(false);
    window.history.replaceState({}, "", window.location.pathname);
  };

  async function openFile(item: ArchiveItem) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("club-archive").createSignedUrl(item.storage_path, 300);
    if (error || !data) { notify("This file could not be opened"); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteEvent(eventId: number) {
    if (!supabase || !window.confirm("Remove this date from the calendar?")) return;
    const { error } = await supabase.from("events").delete().eq("id", eventId);
    if (error) notify(error.message, "error"); else { notify("Calendar date removed"); loadData(); }
  }

  // With a server-rendered concert list and no saved sign-in, show the public
  // page straight away instead of a loading screen.
  if (authLoading) return publicConcerts && !savedSession && supabase ? <PublicSite onSignIn={openLogin} initialRecordings={publicConcerts} /> : <LoadingScreen />;
  if (!supabase) return <SetupScreen />;
  if (!user) return showLogin ? <LoginScreen onBack={closeLogin} /> : <PublicSite onSignIn={openLogin} initialRecordings={publicConcerts} />;
  if (shellState === "deactivated") return <DeactivatedScreen onSignOut={() => { void supabase?.auth.signOut(); }} />;
  if (shellState === "failed") return <BootstrapFailedScreen onRetry={() => void bootstrap(user)} onSignOut={() => { void supabase?.auth.signOut(); }} />;
  if (shellState === "loading") return <LoadingScreen />;

  const outcome = resolveSection(section, role);

  return (
    <main className="portal-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")} aria-label="Bharat Sangeet at UNC Chapel Hill home"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><span><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></span></button>
        <PortalPageMenu section={section} role={role} onNavigate={navigate} />
        <div className="account"><button className="role-button" onClick={() => supabase?.auth.signOut()} title="Sign out"><span className="avatar">{role === "admin" ? "AD" : role === "executive" ? "EX" : "MB"}</span><span><b>{name}</b><small>{role === "admin" ? "Admin · Sign out" : role === "executive" ? "Executive · Sign out" : "Member · Sign out"}</small></span></button></div>
      </header>

      <SectionBoundary key={section}>
        {outcome.kind === "render" && outcome.section === "home" && <ClubDashboard name={name} role={role} events={events} resourceCount={resourceCount} announcements={announcements} onNavigate={navigate} manage={canManage ? { user, groups, onChanged: loadData, notify } : undefined} />}

        {outcome.kind === "render" && outcome.section === "groups" && <SubgroupSpaces user={user} role={role} onGroupsChanged={loadWorkspaces} onOpenAttendance={(groupId) => { setAttendanceInitialScope(groupId); navigate("attendance"); }} onOpenRecordings={(groupId) => { setRecordingScope(groupId); navigate("recordings"); }} onOpenResources={(groupId) => { setResourceInitialScope(groupId); navigate("documents"); }} notify={notify} />}

        {outcome.kind === "render" && outcome.section === "admin" && <AdminPage user={user} groups={groups} notify={notify} />}

        {outcome.kind === "render" && outcome.section === "recordings" && <><RecordingWorkspace user={user} groups={availableGroups} memberships={memberships} canManage={canManage} initialScope={recordingScope === "club" ? "all" : recordingScope} notify={notify} onDataChanged={loadData} />{canManage && <ClubArchiveManager items={archive} groups={groups} onAdd={() => setShowUpload(true)} onChanged={loadData} notify={notify} />}</>}

        {outcome.kind === "render" && outcome.section === "calendar" && <section className="section-shell page-section"><PageTitle eyebrow="CLUB CALENDAR" title="Important dates" text="Club and subgroup rehearsals, performances, meetings, and deadlines in one calendar." /><div className="toolbar"><p className="access-note">Every date shows who it is for</p><ScopeFilterBar value={calendarScope} onChange={setCalendarScope} groups={availableGroups} />{canManage && <button className="primary" onClick={() => setShowEvent(true)}>＋ Add important date</button>}</div>{dataLoading ? <LoadingBlock>Loading the archive…</LoadingBlock> : <CalendarView events={visibleEvents} groups={groups} canManage={canManage} onEdit={setEditingEvent} onDelete={deleteEvent} />}</section>}

        {outcome.kind === "render" && outcome.section === "attendance" && <AttendancePage key={`${attendanceInitialScope}-${attendanceTabFromUrl()}`} user={user} role={role} groups={availableGroups} initialScope={attendanceInitialScope} initialTab={attendanceTabFromUrl()} notify={notify} />}

        {outcome.kind === "render" && outcome.section === "members" && <MembersPage user={user} notify={notify} />}

        {outcome.kind === "render" && outcome.section === "documents" && <ResourceLibrary user={user} role={role} groups={availableGroups} memberships={memberships} events={events} notify={notify} onResourceCountChange={setResourceCount} initialScope={resourceInitialScope} />}

        {outcome.kind === "render" && outcome.section === "finances" && <FinancePage user={user} role={role} groups={availableGroups} events={events} notify={notify} />}

        {outcome.kind === "refused" && <SectionRefused label={SECTION_LABELS[outcome.section]} onHome={() => navigate("home")} />}
      </SectionBoundary>

      <footer><div className="footer-brand"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><div><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></div></div><p>Carnatic and Hindustani music at UNC Chapel Hill.</p><p>2026–27 Season</p></footer>
      {showUpload && <ArchiveModal user={user} onClose={() => setShowUpload(false)} onSaved={() => { setShowUpload(false); loadData(); notify("Saved to the club archive"); }} notify={notify} />}
      {showEvent && <EventModal user={user} groups={groups} onClose={() => setShowEvent(false)} onSaved={() => { setShowEvent(false); loadData(); notify("Important date added"); }} notify={notify} />}
      {editingEvent && <EventModal key={editingEvent.id} editing={editingEvent} user={user} groups={groups} onClose={() => setEditingEvent(null)} onSaved={() => { setEditingEvent(null); loadData(); notify("Calendar date updated"); }} notify={notify} />}
      <ToastViewport />
    </main>
  );
}

function TalamMeasure({ next, nextWhen, onNavigate }: { next?: ClubEvent; nextWhen: string; onNavigate: (section: Section) => void }) {
  const [pattern, setPattern] = useState<TalamPattern | null>(null);
  const [beat, setBeat] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const measureRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setPattern(talamPatterns[Math.floor(Math.random() * talamPatterns.length)]);
  }, []);

  useEffect(() => {
    const node = measureRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setIsActive(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function handleVisibility() { setIsActive(document.visibilityState === "visible"); }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (!pattern || reduceMotion || !isActive) return;
    const interval = window.setInterval(() => setBeat((current) => (current + 1) % pattern.beats), 700);
    return () => window.clearInterval(interval);
  }, [isActive, pattern, reduceMotion]);

  const beatMarkers = pattern ? pattern.divisions.map((size, divisionIndex) => {
    const offset = pattern.divisions.slice(0, divisionIndex).reduce((total, count) => total + count, 0);
    return <span className="talam-division" key={`${pattern.name}-${divisionIndex}`}>{Array.from({ length: size }, (_, localIndex) => {
      const markerIndex = offset + localIndex;
      const isCurrent = markerIndex === beat;
      return <motion.span className={`talam-track-beat ${markerIndex === 0 ? "downbeat" : ""}`} key={markerIndex} animate={reduceMotion ? { opacity: markerIndex === 0 ? 0.7 : 0.35, scaleY: 1 } : { opacity: isCurrent ? 1 : 0.28, scaleY: isCurrent ? 1.45 : 1 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }} />;
    })}</span>;
  }) : <span className="talam-division"><span className="talam-track-beat downbeat" /></span>;
  const beatLabel = pattern ? `Beat ${beat + 1} of ${pattern.beats}` : "Finding a talam";

  return <section ref={measureRef} className="dashboard-measure" aria-labelledby="next-event-heading"><div className="measure-index"><span>TALA / TAAL</span><strong>{pattern?.beats ?? "—"}</strong><small>{pattern?.name ?? "Rhythm cycle"}</small><span>{pattern?.tradition ?? "Visual study"}</span></div><div className="measure-main"><span id="next-event-heading">Next on the calendar</span><h2>{next?.title || "The next gathering starts here"}</h2><p>{nextWhen}{next?.location ? ` · ${next.location}` : ""}</p><div className="measure-actions"><button type="button" onClick={() => onNavigate("calendar")}>View calendar</button><button type="button" onClick={() => onNavigate("groups")}>Open a group</button></div><div className="measure-track" aria-hidden="true"><div className="talam-track-beats">{beatMarkers}</div><motion.b animate={{ opacity: pattern ? 1 : 0.7 }} transition={{ duration: 0.25 }}>{beatLabel}</motion.b></div></div></section>;
}

function ClubDashboard({ name, role, events, resourceCount, announcements, onNavigate, manage }: { name: string; role: ClubRole; events: ClubEvent[]; resourceCount: number; announcements: Announcement[]; manage?: AnnouncementManage; onNavigate: (section: Section) => void }) {
  const upcoming = events.filter((event) => new Date(event.starts_at) >= new Date()).slice(0, 4);
  const next = upcoming[0];
  const latest = announcements[0];
  const nextWhen = next ? new Date(next.starts_at).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "No upcoming date scheduled";
  return <>{(announcements.length > 0 || manage) && <AnnouncementFeed announcements={announcements} manage={manage} />}<section className="portal-dashboard"><div className="dashboard-intro"><div><h1>Welcome back, {name}.</h1><p>Carnatic and Hindustani musicians, one shared club home.</p></div><span>{role === "executive" ? "Executive view" : role === "admin" ? "Admin view" : "Member view"}</span></div><TalamMeasure next={next} nextWhen={nextWhen} onNavigate={onNavigate} /><div className="dashboard-beats"><article><span className="beat-number">1</span><h2>Announcements</h2><h3>{latest?.title || "Nothing new to review"}</h3><p>{latest?.body || "Club and group updates will appear here when an executive posts one."}</p><button type="button" onClick={() => onNavigate("home")}>{latest ? "Read update" : "Refresh overview"}</button></article><article><span className="beat-number">2</span><h2>Attendance</h2><h3>Ready for the next meeting</h3><p>Check in with a meeting code, review your history, or submit an absence excuse.</p><button type="button" onClick={() => onNavigate("attendance")}>Open attendance</button></article><article><span className="beat-number">3</span><h2>Resources</h2><h3>{resourceCount} available {resourceCount === 1 ? "resource" : "resources"}</h3><p>Repertoire, planning documents, shared links, and references for every tradition and group.</p><button type="button" onClick={() => onNavigate("documents")}>Open library</button></article></div></section></>;
}

function PortalPageMenu({ section, role, onNavigate }: { section: Section; role: ClubRole; onNavigate: (section: Section) => void }) {
  const [open, setOpen] = useState(false); const shell = useRef<HTMLDivElement>(null);
  const groups = menuGroups(role);
  const pages = menuPages(role);
  useEffect(() => {
    function close(event: MouseEvent) { if (!shell.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); shell.current?.querySelector<HTMLButtonElement>(".page-menu-trigger")?.focus(); } }
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);
  function go(page: Section) { onNavigate(page); setOpen(false); }
  return <div className="portal-navigation" ref={shell}><nav className="primary-navigation" aria-label="Portal navigation">{pages.map((page) => <button className={page === section ? "active" : ""} aria-current={page === section ? "page" : undefined} key={page} onClick={() => go(page)}>{SECTION_LABELS[page]}</button>)}</nav><div className="page-menu-shell"><button className="page-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span><small>Navigate</small><b>{SECTION_LABELS[section]}</b></span><i aria-hidden="true">⌄</i></button>{open && <div className="page-menu" role="menu" aria-label="All pages">{groups.map((group) => <div className="page-menu-group" key={group.title}><p>{group.title}</p>{group.pages.map((page) => <button role="menuitem" className={page === section ? "selected" : ""} key={page} onClick={() => go(page)}><span>{SECTION_LABELS[page]}</span>{group.clubWide && <small>Club-wide</small>}{page === section && <i>✓</i>}</button>)}</div>)}<span className="menu-count">{pages.length} destinations</span></div>}</div></div>;
}

function SectionRefused({ label, onHome }: { label: string; onHome: () => void }) {
  return <section className="section-shell page-section"><EmptyState title={`${label} is not available to your account`} text="Ask a club administrator if you think you should have access." /><div className="mt-4 flex justify-center"><Button variant="secondary" onClick={onHome}>Back to Overview</Button></div></section>;
}

function EventModal({ user, groups, editing, onClose, onSaved, notify }: { user: User; groups: Subgroup[]; editing?: ClubEvent; onClose: () => void; onSaved: () => void; notify: Notify }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setSaving(true);
    const form = new FormData(event.currentTarget);
    const subgroupId = String(form.get("subgroup_id") || "");
    const fields = { title: String(form.get("title") || ""), description: String(form.get("description") || ""), starts_at: new Date(String(form.get("starts_at") || "")).toISOString(), location: String(form.get("location") || ""), subgroup_id: subgroupId ? Number(subgroupId) : null };
    const result = editing
      ? await supabase.from("events").update(fields).eq("id", editing.id).select("id")
      : await supabase.from("events").insert({ ...fields, created_by: user.id }).select("id");
    setSaving(false);
    // An update that matches no row returns no error, so check that something was written.
    if (result.error || !result.data?.length) notify(friendlyError(result.error, "This date could not be saved. It may have been removed."), "error"); else onSaved();
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">EXECUTIVE TOOL</p><h2>{editing ? "Edit this date" : "Add an important date"}</h2><label>Audience<select name="subgroup_id" defaultValue={editing?.subgroup_id ?? ""}><option value="">Whole club</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Title<input name="title" required defaultValue={editing?.title ?? ""} placeholder="Concert, rehearsal, meeting…" /></label><label>Date and time<input name="starts_at" type="datetime-local" required defaultValue={editing ? toLocalInputValue(editing.starts_at) : undefined} /></label><label>Location<input name="location" defaultValue={editing?.location ?? ""} placeholder="Room, venue, or online" /></label><label>Details<input name="description" defaultValue={editing?.description ?? ""} placeholder="Anything members should know" /></label><Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add to calendar"}</Button></form></div>;
}

function CalendarView({ events, groups, canManage, onEdit, onDelete }: { events: ClubEvent[]; groups: Subgroup[]; canManage: boolean; onEdit: (event: ClubEvent) => void; onDelete: (eventId: number) => void }) {
  const [cursor, setCursor] = useState(() => { const today = new Date(); return new Date(today.getFullYear(), today.getMonth(), 1); });
  const year = cursor.getFullYear(); const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const calendarStart = new Date(year, month, 1 - firstDay);
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(calendarStart); day.setDate(calendarStart.getDate() + index); return day; });
  const today = new Date();
  const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  const agendaEvents = events.filter((event) => {
    const date = new Date(event.starts_at);
    return date.getFullYear() === year && date.getMonth() === month;
  }).sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const agendaDays = agendaEvents.reduce<Array<{ key: string; date: Date; events: ClubEvent[] }>>((daysForAgenda, event) => {
    const date = new Date(event.starts_at);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const existingDay = daysForAgenda.find((day) => day.key === key);
    if (existingDay) existingDay.events.push(event);
    else daysForAgenda.push({ key, date, events: [event] });
    return daysForAgenda;
  }, []);

  return <div className="month-calendar"><div className="calendar-controls"><button onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Previous month">←</button><h2>{cursor.toLocaleString("en-US", { month: "long", year: "numeric" })}</h2><div><button className="today-button" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button><button onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Next month">→</button></div></div><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((day) => { const dayEvents = events.filter((item) => sameDay(new Date(item.starts_at), day)); return <div className={`calendar-cell ${day.getMonth() !== month ? "outside" : ""} ${sameDay(day, today) ? "today" : ""}`} key={day.toISOString()}><span className="day-number">{day.getDate()}</span><div className="day-events">{dayEvents.map((item) => <div className="calendar-event" key={item.id} title={[item.description, item.location].filter(Boolean).join(" · ")}><time>{new Date(item.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time><b>{item.title}</b><small className="calendar-scope">{item.subgroup_id ? groups.find((group) => group.id === item.subgroup_id)?.name || "Group" : "Club-wide"}</small>{item.location && <small>{item.location}</small>}{canManage && <><button className="calendar-edit" onClick={() => onEdit(item)} aria-label={`Edit ${item.title}`}>✎</button><button onClick={() => onDelete(item.id)} aria-label={`Delete ${item.title}`}>×</button></>}</div>)}</div></div>; })}</div><div className="calendar-agenda">{agendaDays.length ? agendaDays.map((day) => <section className="calendar-agenda-day" key={day.key}><h3><time dateTime={day.date.toISOString()}>{day.date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</time></h3><div>{day.events.map((item) => <article className="calendar-agenda-event" key={item.id}><time dateTime={item.starts_at}>{new Date(item.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time><b>{item.title}</b><small className="calendar-scope">{item.subgroup_id ? groups.find((group) => group.id === item.subgroup_id)?.name || "Group" : "Club-wide"}</small>{item.location && <small>{item.location}</small>}{item.description && <p>{item.description}</p>}{canManage && <><button className="calendar-edit" onClick={() => onEdit(item)} aria-label={`Edit ${item.title}`}>✎</button><button onClick={() => onDelete(item.id)} aria-label={`Delete ${item.title}`}>×</button></>}</article>)}</div></section>) : <p className="calendar-agenda-empty">No dates in this view.</p>}</div>{events.length === 0 && <p className="calendar-empty">No dates in this view.</p>}</div>;
}

function PublicSite({ onSignIn, initialRecordings }: { onSignIn: () => void; initialRecordings: PublicConcert[] | null }) {
  // The list comes from the server (cached five minutes). Only when the server
  // could not read it does the browser load it, as it always did.
  const [recordings, setRecordings] = useState<ArchiveItem[]>(() => (initialRecordings || []) as ArchiveItem[]);
  const [loading, setLoading] = useState(initialRecordings === null);
  useEffect(() => {
    if (!supabase || initialRecordings !== null) return;
    const client = supabase;
    let cancelled = false;
    const timeout = window.setTimeout(() => { if (!cancelled) setLoading(false); }, 7000);
    const loadPublicRecordings = async () => {
      try {
        const { data } = await client.from("archive_items").select("id,title,description,type,storage_path,event_date,raga,tala,created_at,is_public").eq("type", "recording").eq("is_public", true).order("event_date", { ascending: false });
        if (!cancelled) setRecordings((data || []) as ArchiveItem[]);
      } catch {
        if (!cancelled) setRecordings([]);
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    };
    void loadPublicRecordings();
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [initialRecordings]);
  async function watch(item: ArchiveItem) {
    if (!supabase) return;
    const { data } = await supabase.storage.from("club-archive").createSignedUrl(item.storage_path, 600);
    if (data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  return <main className="public-site"><header className="public-header"><button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><span><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></span></button><nav><a href="#about">About</a><a href="#concerts">Concerts</a></nav><button className="primary small" onClick={onSignIn}>Member sign in →</button></header><section className="public-hero"><div><span className="public-season">UNC CHAPEL HILL · CARNATIC + HINDUSTANI</span><h1>Indian classical music.<br /><em>Carolina community.</em></h1><p className="lede">Bharat Sangeet brings students together across Carnatic and Hindustani traditions to learn, rehearse, perform, and listen at UNC Chapel Hill.</p><div className="hero-actions"><a className="primary public-link" href="#concerts">Watch our concerts <span>→</span></a><button className="secondary" onClick={onSignIn}>Join or sign in</button></div></div><div className="hero-image"><img src={heroPhotos[0].src} alt={heroPhotos[0].alt} /><div className="image-caption"><span>Music at Carolina</span><b>Many traditions, one community</b></div></div></section><section className="public-about" id="about"><div><h2>A home for Indian classical music at UNC</h2></div><p>We are a student community for vocalists, instrumentalists, percussionists, listeners, and anyone curious about Carnatic or Hindustani music. Through rehearsals, subgroups, workshops, and concerts, members learn from both traditions and build lasting friendships.</p></section><section className="section-shell public-concerts" id="concerts"><PageTitle eyebrow="FROM THE STAGE" title="Concert recordings" text="Public performances shared by Bharat Sangeet. Rehearsals and other club materials remain private to members." />{loading ? <LoadingBlock>Loading the archive…</LoadingBlock> : recordings.length ? <div className="public-recording-grid">{recordings.map((item) => <article key={item.id}><p className="recording-kind">Concert recording</p><h3>{item.title}</h3><p>{[item.raga, item.tala, item.description].filter(Boolean).join(" · ")}</p><button className="secondary" onClick={() => watch(item)}>Watch or listen →</button></article>)}</div> : <EmptyState title="Concert archive coming soon" text="Public concert recordings selected by club executives will appear here." />}</section><section className="public-join"><h2>Make music with us.</h2><p>Whether your practice is Carnatic, Hindustani, both, or completely new, there is a place for you here.</p><button className="primary" onClick={onSignIn}>Join Bharat Sangeet →</button></section><footer><div className="footer-brand"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><div><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></div></div><p>Carnatic and Hindustani music at UNC Chapel Hill.</p><p>2026–27 Season</p></footer></main>;
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

  return <main className="login-page"><div className="login-art"><img src={heroPhotos[0].src} alt={heroPhotos[0].alt} /><div><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="Bharat Sangeet" /><h1>Many traditions.<br /><em>One place to make music.</em></h1></div></div><section className="login-panel"><button className="login-back" type="button" onClick={onBack}>← Back to public site</button><div className="login-box"><span className="login-context">UNC CHAPEL HILL MEMBER PORTAL</span><div className="auth-tabs"><button className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setErrorMessage(""); window.sessionStorage.removeItem(pendingSignupNameKey); }}>Member sign in</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setErrorMessage(""); }}>Join the club</button></div><h2>{mode === "signup" ? "Join Bharat Sangeet" : "Welcome to Bharat Sangeet"}</h2><p>{mode === "signup" ? "Sign up with Google to join UNC's Carnatic and Hindustani music community. Every new account begins as a regular member." : "Use the Google account connected to your UNC Chapel Hill club membership. No password is required."}</p>{mode === "signup" && <label className="signup-name">Preferred name<input autoComplete="name" value={preferredName} onChange={(event) => setPreferredName(event.target.value)} placeholder="What should we call you?" required /></label>}<button className="google-button" type="button" onClick={signInWithGoogle} disabled={sending}><span aria-hidden="true">G</span>{sending ? "Opening Google…" : mode === "signup" ? "Sign up with Google" : "Continue with Google"}</button>{errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}<small>{mode === "signup" ? "Executive access is assigned separately by current club executives." : "Access your recordings, documents, calendar, groups, and attendance."}</small></div></section></main>;
}

function ArchiveModal({ user, onClose, onSaved, notify }: { user: User; onClose: () => void; onSaved: () => void; notify: Notify }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setSaving(true);
    const form = new FormData(event.currentTarget); const title = String(form.get("title") || "");
    const file = form.get("file") as File; if (!file?.size) { setSaving(false); notify("Choose a file to upload"); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-"); const storagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from("club-archive").upload(storagePath, file, { upsert: false });
    if (upload.error) { setSaving(false); notify(friendlyError(upload.error, "The file could not be uploaded."), "error"); return; }
    const access = String(form.get("visibility") || "members");
    const saved = await supabase.from("archive_items").insert({ title, description: String(form.get("description") || ""), type: "recording", storage_path: storagePath, visibility: (access === "public" ? "members" : access) as ArchiveVisibility, is_public: access === "public", raga: String(form.get("raga") || "") || null, tala: String(form.get("tala") || "") || null, uploaded_by: user.id });
    if (saved.error) {
      // The row was not saved, so the file just uploaded is an orphan: remove it, and say so if it stays.
      const leftover = await removeStoredFile("club-archive", storagePath, { refusedMessage: "The recording could not be saved, and its uploaded file could not be removed. Ask an administrator to delete it." });
      setSaving(false); notify(leftover ?? friendlyError(saved.error, "The recording could not be saved."), "error"); return;
    }
    setSaving(false); onSaved();
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">EXECUTIVE TOOL</p><h2>Add a club recording</h2><label>Title<input name="title" required placeholder="Give this recording a clear name" /></label><label>Description<input name="description" placeholder="Optional context for members" /></label><div className="form-pair"><label>Raga / raag<input name="raga" /></label><label>Tala / taal<input name="tala" /></label></div><label>Choose file<input name="file" type="file" required accept="audio/*,video/*" /></label><label>Who can access this?<select name="visibility"><option value="members">All club members</option><option value="executives">Executives only</option><option value="public">Everyone (public concert)</option></select></label><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save recording"}</button></form></div>;
}

function BootstrapFailedScreen({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return <main className="loading-screen" role="alert">
    <h2>We could not load your club profile</h2>
    <p>Check your connection and try again. Nothing has been changed.</p>
    <div className="flex flex-wrap justify-center gap-2"><Button onClick={onRetry}>Try again</Button><Button variant="secondary" onClick={onSignOut}>Sign out</Button></div>
  </main>;
}
function LoadingScreen() { return <main className="loading-screen"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="Bharat Sangeet" /><p>Opening the club archive…</p></main>; }
function SetupScreen() { return <main className="loading-screen"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="Bharat Sangeet" /><h2>Supabase connection needed</h2><p>Add the project URL and publishable key to the hosting environment.</p></main>; }
function toLocalInputValue(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
