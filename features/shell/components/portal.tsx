"use client";

import { useState } from "react";
import { SectionBoundary } from "../../../components/ui/section-boundary";
import { ToastViewport, useToast } from "../../../components/ui/toast";
import { isSupabaseConfigured } from "../../../lib/api/auth";
import { canManageClub } from "../../../lib/permissions";
import type { PublicConcert } from "../../../lib/public-concerts";
import { SECTION_LABELS, resolveSection } from "../../../lib/sections";
import { AdminPage } from "../../admin/components/admin-page";
import { DeactivatedScreen } from "../../admin/components/member-access";
import { CalendarDialogs } from "../../calendar/components/calendar-dialogs";
import { CalendarPage } from "../../calendar/components/calendar-page";
import { useCalendarPage } from "../../calendar/hooks/use-calendar-page";
import { ClubDashboard } from "../../dashboard/components/club-dashboard";
import { SubgroupSpaces } from "../../groups/components/subgroup-spaces";
import { MembersPage } from "../../members/components/members-page";
import { LoginScreen } from "../../public/components/login-screen";
import { PublicSite } from "../../public/components/public-site";
import { ArchiveModal } from "../../recordings/components/archive-modal";
import { usePortalData } from "../hooks/use-portal-data";
import { attendanceTabFromUrl, usePortalNavigation } from "../hooks/use-portal-navigation";
import { usePortalSession } from "../hooks/use-portal-session";
import { BootstrapFailedScreen } from "./bootstrap-failed-screen";
import { AttendancePage, ClubArchiveManager, FinancePage, RecordingWorkspace, ResourceLibrary } from "./lazy-screens";
import { LoadingScreen } from "./loading-screen";
import { PortalFooter } from "./portal-footer";
import { PortalHeader } from "./portal-header";
import { SectionRefused } from "./section-refused";
import { SetupScreen } from "./setup-screen";

export function Portal({ publicConcerts = null }: { publicConcerts?: PublicConcert[] | null }) {
  // A failure is shown as one: no tick, and screen readers get an alert (components/ui/toast.tsx).
  // Screens that have not moved to useToast() yet are still given `notify` as a prop.
  const { notify } = useToast();
  const data = usePortalData(notify);
  const { archive, events, announcements, groups, memberships, resourceCount, dataLoading, setResourceCount, loadData } = data;
  const { savedSession, authLoading, user, shellState, role, name, retry, loadWorkspaces, signOutQuietly } = usePortalSession(data, notify);
  const nav = usePortalNavigation({ user, loadData });
  const { section, navigate } = nav;
  const calendar = useCalendarPage({ onChanged: loadData });
  const [showUpload, setShowUpload] = useState(false);

  const canManage = canManageClub(role);
  const activeGroupIds = new Set(memberships.filter((item) => item.status === "active").map((item) => item.subgroup_id));
  const availableGroups = canManage ? groups : groups.filter((group) => activeGroupIds.has(group.id));

  // With a server-rendered concert list and no saved sign-in, show the public
  // page straight away instead of a loading screen.
  if (authLoading) return publicConcerts && !savedSession && isSupabaseConfigured() ? <PublicSite onSignIn={nav.openLogin} initialRecordings={publicConcerts} /> : <LoadingScreen />;
  if (!isSupabaseConfigured()) return <SetupScreen />;
  if (!user) return nav.showLogin ? <LoginScreen onBack={nav.closeLogin} /> : <PublicSite onSignIn={nav.openLogin} initialRecordings={publicConcerts} />;
  if (shellState === "deactivated") return <DeactivatedScreen onSignOut={signOutQuietly} />;
  if (shellState === "failed") return <BootstrapFailedScreen onRetry={retry} onSignOut={signOutQuietly} />;
  if (shellState === "loading") return <LoadingScreen />;

  const outcome = resolveSection(section, role);
  const shown = outcome.kind === "render" ? outcome.section : null;

  return (
    <main className="portal-shell">
      <PortalHeader section={section} role={role} name={name} onNavigate={navigate} onSignOut={signOutQuietly} />

      <SectionBoundary key={section}>
        {shown === "home" && <ClubDashboard name={name} role={role} events={events} resourceCount={resourceCount} announcements={announcements} onNavigate={navigate} manage={canManage ? { user, groups, onChanged: loadData, notify } : undefined} />}

        {shown === "groups" && <SubgroupSpaces user={user} role={role} onGroupsChanged={loadWorkspaces} onOpenAttendance={nav.openAttendanceFor} onOpenRecordings={nav.openRecordingsFor} onOpenResources={nav.openResourcesFor} notify={notify} />}

        {shown === "admin" && <AdminPage user={user} groups={groups} notify={notify} />}

        {shown === "recordings" && <><RecordingWorkspace user={user} groups={availableGroups} memberships={memberships} canManage={canManage} initialScope={nav.recordingScope === "club" ? "all" : nav.recordingScope} notify={notify} onDataChanged={loadData} />{canManage && <ClubArchiveManager items={archive} groups={groups} onAdd={() => setShowUpload(true)} onChanged={loadData} notify={notify} />}</>}

        {shown === "calendar" && <CalendarPage events={events} groups={groups} availableGroups={availableGroups} canManage={canManage} loading={dataLoading} scope={calendar.scope} onScopeChange={calendar.setScope} onAdd={() => calendar.setAdding(true)} onEdit={calendar.setEditing} onDelete={calendar.remove} />}

        {shown === "attendance" && <AttendancePage key={`${nav.attendanceInitialScope}-${attendanceTabFromUrl()}`} user={user} role={role} groups={availableGroups} initialScope={nav.attendanceInitialScope} initialTab={attendanceTabFromUrl()} notify={notify} />}

        {shown === "members" && <MembersPage user={user} notify={notify} />}

        {shown === "documents" && <ResourceLibrary user={user} role={role} groups={availableGroups} memberships={memberships} events={events} notify={notify} onResourceCountChange={setResourceCount} initialScope={nav.resourceInitialScope} />}

        {shown === "finances" && <FinancePage user={user} role={role} groups={availableGroups} events={events} notify={notify} />}

        {outcome.kind === "refused" && <SectionRefused label={SECTION_LABELS[outcome.section]} onHome={() => navigate("home")} />}
      </SectionBoundary>

      <PortalFooter />
      {showUpload && <ArchiveModal user={user} onClose={() => setShowUpload(false)} onSaved={() => { setShowUpload(false); loadData(); notify("Saved to the club archive"); }} notify={notify} />}
      <CalendarDialogs user={user} groups={groups} calendar={calendar} onChanged={loadData} />
      <ToastViewport />
    </main>
  );
}
