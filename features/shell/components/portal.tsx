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
import { useCalendarPage } from "../../calendar/hooks/use-calendar-page";
import { ClubDashboard } from "../../dashboard/components/club-dashboard";
import { SubgroupSpaces } from "../../groups/components/subgroup-spaces";
import { LoginScreen } from "../../public/components/login-screen";
import { PublicSite } from "../../public/components/public-site";
import { ArchiveModal } from "../../recordings/components/archive-modal";
import { usePortalData } from "../hooks/use-portal-data";
import { attendanceTabFromUrl, usePortalNavigation } from "../hooks/use-portal-navigation";
import { usePortalSession } from "../hooks/use-portal-session";
import { useProfilePrompt } from "../hooks/use-profile-prompt";
import { SignupRequestsPage } from "../../admin/components/signup-requests-page";
import { BootstrapFailedScreen } from "./bootstrap-failed-screen";
import { AttendancePage, CalendarDialogs, CalendarPage, ClubArchiveManager, CompleteProfileDialog, FinancePage, MembersPage, OwnProfileDialog, RecordingWorkspace, ResourceLibrary } from "./lazy-screens";
import { LoadingScreen } from "./loading-screen";
import { PendingScreen, RejectedScreen } from "./membership-screens";
import { PortalFooter } from "./portal-footer";
import { PortalHeader } from "./portal-header";
import { SectionRefused } from "./section-refused";
import { SetupScreen } from "./setup-screen";

export function Portal({ publicConcerts = null }: { publicConcerts?: PublicConcert[] | null }) {
  // A failure is shown as one: no tick, and screen readers get an alert (components/ui/toast.tsx).
  const { notify } = useToast();
  const data = usePortalData();
  const { archive, events, announcements, groups, memberships, resourceCount, dataLoading, setResourceCount, loadData } = data;
  const { savedSession, authLoading, user, shellState, role, name, setName, pendingSignups, setPendingSignups, retry, loadWorkspaces, signOutQuietly } = usePortalSession(data);
  const nav = usePortalNavigation({ user, loadData });
  const { section, navigate } = nav;
  const calendar = useCalendarPage({ onChanged: loadData });
  const [showUpload, setShowUpload] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // "Complete your profile", once, on the home page, for an approved member who has not filled in any contact detail (the pending and rejected screens come first).
  const profileStep = useProfilePrompt(user, shellState === "ready", section === "home");

  const canManage = canManageClub(role);
  const activeGroupIds = new Set(memberships.filter((item) => item.status === "active").map((item) => item.subgroup_id));
  const availableGroups = canManage ? groups : groups.filter((group) => activeGroupIds.has(group.id));

  // With a server-rendered concert list and no saved sign-in, show the public
  // page straight away instead of a loading screen.
  if (authLoading) return publicConcerts && !savedSession && isSupabaseConfigured() ? <PublicSite onSignIn={nav.openLogin} initialRecordings={publicConcerts} /> : <LoadingScreen />;
  if (!isSupabaseConfigured()) return <SetupScreen />;
  if (!user) return nav.showLogin ? <LoginScreen onBack={nav.closeLogin} /> : <PublicSite onSignIn={nav.openLogin} initialRecordings={publicConcerts} />;
  if (shellState === "deactivated") return <DeactivatedScreen onSignOut={signOutQuietly} />;
  if (shellState === "pending") return <PendingScreen onCheckAgain={retry} onSignOut={signOutQuietly} />;
  if (shellState === "rejected") return <RejectedScreen onSignOut={signOutQuietly} />;
  if (shellState === "failed") return <BootstrapFailedScreen onRetry={retry} onSignOut={signOutQuietly} />;
  if (shellState === "loading") return <LoadingScreen />;

  const outcome = resolveSection(section, role);
  const shown = outcome.kind === "render" ? outcome.section : null;

  return (
    <main className="portal-shell">
      <PortalHeader section={section} role={role} name={name} pendingSignups={pendingSignups} onNavigate={navigate} onSignOut={signOutQuietly} onOpenProfile={() => setShowProfile(true)} />

      <SectionBoundary key={section}>
        {shown === "home" && <ClubDashboard name={name} role={role} events={events} resourceCount={resourceCount} announcements={announcements} onNavigate={navigate} manage={canManage ? { user, groups, onChanged: loadData } : undefined} />}

        {shown === "groups" && <SubgroupSpaces user={user} role={role} onGroupsChanged={loadWorkspaces} onOpenAttendance={nav.openAttendanceFor} onOpenRecordings={nav.openRecordingsFor} onOpenResources={nav.openResourcesFor} />}

        {shown === "signups" && <SignupRequestsPage onCount={setPendingSignups} />}

        {shown === "admin" && <AdminPage user={user} groups={groups} onPendingSignups={setPendingSignups} />}

        {shown === "recordings" && <><RecordingWorkspace user={user} groups={availableGroups} memberships={memberships} canManage={canManage} initialScope={nav.recordingScope === "club" ? "all" : nav.recordingScope} onDataChanged={loadData} />{canManage && <ClubArchiveManager items={archive} groups={groups} onAdd={() => setShowUpload(true)} onChanged={loadData} />}</>}

        {shown === "calendar" && <CalendarPage events={events} groups={groups} availableGroups={availableGroups} canManage={canManage} loading={dataLoading} scope={calendar.scope} onScopeChange={calendar.setScope} onAdd={() => calendar.setAdding(true)} onEdit={calendar.setEditing} onDelete={calendar.remove} />}

        {shown === "attendance" && <AttendancePage key={`${nav.attendanceInitialScope}-${attendanceTabFromUrl()}`} user={user} role={role} groups={availableGroups} initialScope={nav.attendanceInitialScope} initialTab={attendanceTabFromUrl()} />}

        {shown === "members" && <MembersPage user={user} />}

        {shown === "documents" && <ResourceLibrary user={user} role={role} groups={availableGroups} memberships={memberships} events={events} onResourceCountChange={setResourceCount} initialScope={nav.resourceInitialScope} />}

        {shown === "finances" && <FinancePage user={user} role={role} groups={availableGroups} events={events} />}

        {outcome.kind === "refused" && <SectionRefused label={SECTION_LABELS[outcome.section]} onHome={() => navigate("home")} />}
      </SectionBoundary>

      <PortalFooter />
      {showUpload && <ArchiveModal user={user} onClose={() => setShowUpload(false)} onSaved={() => { setShowUpload(false); loadData(); notify("Saved to the club archive"); }} />}
      {profileStep.profile && <SectionBoundary key="profile-step"><CompleteProfileDialog user={user} profile={profileStep.profile} onSkip={profileStep.skip} onSaved={(fullName) => { if (fullName) setName(fullName); profileStep.saved(); }} /></SectionBoundary>}
      {showProfile && <SectionBoundary key="own-profile"><OwnProfileDialog user={user} onClose={() => setShowProfile(false)} onSaved={(fullName) => { if (fullName) setName(fullName); }} /></SectionBoundary>}
      {(calendar.adding || calendar.editing) && <SectionBoundary key="calendar-dialogs"><CalendarDialogs user={user} groups={groups} calendar={calendar} onChanged={loadData} /></SectionBoundary>}
      <ToastViewport />
    </main>
  );
}
