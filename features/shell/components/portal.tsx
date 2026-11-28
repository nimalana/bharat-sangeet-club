"use client";

import type { User } from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSessionUser, hasSavedSession, isSupabaseConfigured, onAuthChange, signOut } from "../../../lib/api/auth";
import { deleteEvent as deleteEventRow } from "../../../lib/api/events";
import { getPortalBootstrap, loadPortalLists, loadWorkspaceLists, updateOwnFullName } from "../../../lib/api/portal";
import { setCacheOwner } from "../../../lib/cache";
import { runBootstrap, type ShellState } from "../../../lib/bootstrap";
import { canManageClub } from "../../../lib/permissions";
import type { ClubRole } from "../../../lib/db";
import type { AccountStatus, Announcement, ArchiveItem, ClubEvent, ScopeFilter, Subgroup, SubgroupMembership } from "../../../lib/portal-types";
import type { PublicConcert } from "../../../lib/public-concerts";
import { countOrKeep, listOrKeep } from "../../../lib/refresh";
import { createRequestGate } from "../../../lib/request-gate";
import { SECTION_LABELS, resolveSection, sectionFromSearch, sectionUrl, type Section } from "../../../lib/sections";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { PageTitle } from "../../../components/ui/page-title";
import { SectionBoundary } from "../../../components/ui/section-boundary";
import { ToastViewport, useToast } from "../../../components/ui/toast";
import { AdminPage } from "../../admin/components/admin-page";
import { DeactivatedScreen } from "../../admin/components/member-access";
import { ScopeFilterBar } from "../../announcements/components/scope-filter-bar";
import { CalendarView } from "../../calendar/components/calendar-view";
import { EventModal } from "../../calendar/components/event-modal";
import { ClubDashboard } from "../../dashboard/components/club-dashboard";
import { SubgroupSpaces } from "../../groups/components/subgroup-spaces";
import { MembersPage } from "../../members/components/members-page";
import { LoginScreen, pendingSignupNameKey } from "../../public/components/login-screen";
import { PublicSite } from "../../public/components/public-site";
import { ArchiveModal } from "../../recordings/components/archive-modal";
import { BootstrapFailedScreen } from "./bootstrap-failed-screen";
import { LoadingScreen } from "./loading-screen";
import { PortalPageMenu } from "./portal-page-menu";
import { SectionRefused } from "./section-refused";
import { SetupScreen } from "./setup-screen";

// Each heavy screen is its own bundle, loaded when it is first opened, so the
// audio libraries and finance code are not downloaded to read the calendar.
// A screen whose file cannot be fetched is caught by SectionBoundary in the shell.
const SectionLoading = () => <LoadingBlock role="status">Loading…</LoadingBlock>;
const AttendancePage = dynamic(() => import("../../attendance/components/attendance-page").then((module) => module.AttendancePage), { ssr: false, loading: SectionLoading });
const FinancePage = dynamic(() => import("../../finance/components/finance-page").then((module) => module.FinancePage), { ssr: false, loading: SectionLoading });
const ResourceLibrary = dynamic(() => import("../../resources/components/resource-library").then((module) => module.ResourceLibrary), { ssr: false, loading: SectionLoading });
const RecordingWorkspace = dynamic(() => import("../../recordings/components/recording-workspace").then((module) => module.RecordingWorkspace), { ssr: false, loading: SectionLoading });
const ClubArchiveManager = dynamic(() => import("../../recordings/components/club-archive-manager").then((module) => module.ClubArchiveManager), { ssr: false, loading: SectionLoading });

type PortalBootstrap = { profile: { full_name: string; role: ClubRole; status: AccountStatus } | null; groups: Subgroup[]; memberships: SubgroupMembership[]; announcements: Announcement[]; events: ClubEvent[]; archive: ArchiveItem[]; resource_count: number };

function sectionFromUrl(): Section {
  if (typeof window === "undefined") return "home";
  return sectionFromSearch(window.location.search);
}

function attendanceTabFromUrl(): "overview" | "meetings" | "excuses" {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  return params.get("page") === "meetings" || params.get("tab") === "meetings" ? "meetings" : "overview";
}

// The server render cannot know whether this browser holds a saved sign-in, so it
// reports false and the first client render agrees; the value is read right after hydration.
const subscribeNothing = () => () => {};

export function Portal({ publicConcerts = null }: { publicConcerts?: PublicConcert[] | null }) {
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
    if (!isSupabaseConfigured()) return;
    setShellState("loading");
    setDataLoading(true);
    const outcome = await runBootstrap<PortalBootstrap>(getPortalBootstrap);
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
      const { error: updateError } = await updateOwnFullName(currentUser.id, pendingSignupName);
      if (updateError) notify("Your account was created, but your preferred name could not be saved");
      else {
        window.sessionStorage.removeItem(pendingSignupNameKey);
        if (activeUserId.current === currentUser.id) setName(pendingSignupName);
      }
    }
  }, [notify]);

  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const owner = activeUserId.current;
    const isCurrent = dataGate.begin();
    setDataLoading(true);
    try {
      const { archive: archiveResult, events: eventsResult, announcements: announcementResult, resourceCount: resourceCountResult } = await loadPortalLists();
      if (!isCurrent() || activeUserId.current !== owner) return;
      if (archiveResult.error) notify("The club archive could not be loaded");
      if (eventsResult.error) notify("The calendar could not be loaded");
      if (announcementResult.error) notify("Announcements could not be loaded");
      if (resourceCountResult.error) notify("The resource count could not be loaded");
      // A list that failed to load keeps what is shown; it is not replaced by an empty one.
      setArchive((current) => listOrKeep(current, archiveResult));
      setEvents((current) => listOrKeep(current, eventsResult));
      setAnnouncements((current) => listOrKeep(current, announcementResult));
      setResourceCount((current) => countOrKeep(current, resourceCountResult));
    } catch {
      if (isCurrent()) notify("The club data could not be loaded. Check your connection and try again.");
    } finally {
      if (isCurrent()) setDataLoading(false);
    }
  }, [dataGate, notify]);

  useEffect(() => {
    if (!isSupabaseConfigured()) { setAuthLoading(false); return; }
    let cancelled = false;
    const loadingTimeouts = new Set<number>();
    const hydrateAuth = async () => {
      const loadingTimeout = window.setTimeout(() => { if (!cancelled) setAuthLoading(false); }, 7000);
      loadingTimeouts.add(loadingTimeout);
      try {
        const sessionUser = await getSessionUser();
        if (cancelled) return;
        adoptUser(sessionUser);
      } catch {
        if (!cancelled) adoptUser(null);
      } finally {
        window.clearTimeout(loadingTimeout);
        loadingTimeouts.delete(loadingTimeout);
        if (!cancelled) setAuthLoading(false);
      }
    };
    void hydrateAuth();
    const stopListening = onAuthChange((nextUser) => {
      if (cancelled) return;
      adoptUser(nextUser);
    });
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { setAuthLoading(true); void hydrateAuth(); } };
    window.addEventListener("pageshow", restore);
    return () => { cancelled = true; loadingTimeouts.forEach((timeout) => window.clearTimeout(timeout)); window.removeEventListener("pageshow", restore); stopListening(); };
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
    if (!isSupabaseConfigured() || !user || shellState !== "ready") return;
    const isCurrent = workspaceGate.begin();
    const { groups: groupResult, memberships: membershipResult } = await loadWorkspaceLists(user.id);
    if (!isCurrent() || activeUserId.current !== user.id) return;
    if (groupResult.error || membershipResult.error) { notify("Your groups could not be loaded"); return; }
    setGroups(groupResult.data || []);
    setMemberships(membershipResult.data || []);
  }, [notify, user, shellState, workspaceGate]);

  const canManage = canManageClub(role);
  const activeGroupIds = new Set(memberships.filter((item) => item.status === "active").map((item) => item.subgroup_id));
  const availableGroups = canManage ? groups : groups.filter((group) => activeGroupIds.has(group.id));
  const matchesScope = (subgroupId: number | null | undefined, scope: ScopeFilter) => scope === "all" || (scope === "club" ? !subgroupId : subgroupId === scope);
  const visibleEvents = events.filter((item) => matchesScope(item.subgroup_id, calendarScope));

  const navigate = (next: Section) => {
    if (next === "home" && user) loadData();
    setSection(next);
    const nextUrl = sectionUrl(window.location.pathname, next);
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState({ section: next }, "", nextUrl);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // A failed sign-out is silent, as it always was: the person is still signed in and presses it again.
  const leave = () => { if (isSupabaseConfigured()) void signOut().catch(() => {}); };

  const openLogin = () => {
    setShowLogin(true);
    if (!new URLSearchParams(window.location.search).has("signin")) window.history.pushState({ signin: true }, "", `${window.location.pathname}?signin=1`);
  };

  const closeLogin = () => {
    setShowLogin(false);
    window.history.replaceState({}, "", window.location.pathname);
  };

  async function deleteEvent(eventId: number) {
    if (!isSupabaseConfigured() || !window.confirm("Remove this date from the calendar?")) return;
    const { error } = await deleteEventRow(eventId);
    if (error) notify(error.message, "error"); else { notify("Calendar date removed"); loadData(); }
  }

  // With a server-rendered concert list and no saved sign-in, show the public
  // page straight away instead of a loading screen.
  if (authLoading) return publicConcerts && !savedSession && isSupabaseConfigured() ? <PublicSite onSignIn={openLogin} initialRecordings={publicConcerts} /> : <LoadingScreen />;
  if (!isSupabaseConfigured()) return <SetupScreen />;
  if (!user) return showLogin ? <LoginScreen onBack={closeLogin} /> : <PublicSite onSignIn={openLogin} initialRecordings={publicConcerts} />;
  if (shellState === "deactivated") return <DeactivatedScreen onSignOut={leave} />;
  if (shellState === "failed") return <BootstrapFailedScreen onRetry={() => void bootstrap(user)} onSignOut={leave} />;
  if (shellState === "loading") return <LoadingScreen />;

  const outcome = resolveSection(section, role);

  return (
    <main className="portal-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")} aria-label="Bharat Sangeet at UNC Chapel Hill home"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><span><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></span></button>
        <PortalPageMenu section={section} role={role} onNavigate={navigate} />
        <div className="account"><button className="role-button" onClick={leave} title="Sign out"><span className="avatar">{role === "admin" ? "AD" : role === "executive" ? "EX" : "MB"}</span><span><b>{name}</b><small>{role === "admin" ? "Admin · Sign out" : role === "executive" ? "Executive · Sign out" : "Member · Sign out"}</small></span></button></div>
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
