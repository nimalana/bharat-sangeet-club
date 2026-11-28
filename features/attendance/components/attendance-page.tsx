"use client";

import type { User } from "@supabase/supabase-js";
import { useMemo, useState } from "react";
import type { GroupOption, ScopeFilter } from "../../../lib/db";
import { canManageClub } from "../../../lib/permissions";
import { ErrorBlock } from "../../../components/ui/error-block";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { SkeletonRows } from "../../../components/ui/skeleton";
import { useAttendanceActions } from "../hooks/use-attendance-actions";
import { useAttendanceData } from "../hooks/use-attendance-data";
import { flaggedSummaries, overallRate, termChoices, termLabel, type AttendanceTab, type ClubRole } from "../model";
import { AbsenceFormDialog } from "./absence-form-dialog";
import { ActionDialogs } from "./action-dialogs";
import { AttendanceHeader } from "./attendance-header";
import { AttendanceSummary } from "./attendance-summary";
import { ATTENDANCE_PANEL_ID, AttendanceTabs, attendanceTabId } from "./attendance-tabs";
import { CheckInCard } from "./check-in-card";
import { ExcusesTab } from "./excuses-tab";
import { LiveSessionCard } from "./live-session-card";
import { MeetingsTab } from "./meetings-tab";
import { MemberView } from "./member-view";
import { NewMeetingDialog } from "./new-meeting-dialog";
import { OverviewTab } from "./overview-tab";

export function AttendancePage({ user, role, groups, initialScope = "all", initialTab = "overview" }: {
  user: User;
  role: ClubRole;
  groups: GroupOption[];
  initialScope?: ScopeFilter;
  initialTab?: AttendanceTab;
}) {
  const canManage = canManageClub(role);
  const [tab, setTab] = useState<AttendanceTab>(initialTab || "overview");
  // What is read and kept fresh (overview, roster, poll), and what the person does (check in, open, mark, review).
  const attendance = useAttendanceData({ user, canManage, initialScope, tab });
  const { scopeFilter, termFilter, data, view, failedKey, cacheKey, load, loadingMore, showMore, roster, rosterFailed, loadRoster, selectedSessionId, setSelectedSessionId } = attendance;
  const actions = useAttendanceActions({ user, groups, summaryTerm: view.summary_term, load, rereadRoster: attendance.rereadRoster, setTab });
  const { saving, active, dialog, setDialog } = actions;
  const sessions = view.sessions;

  const termOptions = useMemo(() => termChoices(view.terms, termFilter), [view.terms, termFilter]);
  const openSession = sessions.find((session) => session.status === "open");
  const closedSessions = useMemo(() => sessions.filter((session) => session.status === "closed" && session.counts_toward_metrics), [sessions]);
  const warningLevel = view.settings?.warning_absences ?? 2;
  const criticalLevel = view.settings?.critical_absences ?? 3;
  const summaries = useMemo(
    () => flaggedSummaries(view.flagged, view.profiles, { warning: warningLevel, critical: criticalLevel }),
    [view.flagged, view.profiles, warningLevel, criticalLevel],
  );
  const knownGroupName = (id: number) => groups.find((group) => group.id === id)?.name || sessions.find((session) => session.subgroup_id === id)?.subgroup_name || "Subgroup";
  const scopeLabel = scopeFilter === "all" ? "All activity" : scopeFilter === "club" ? "Club-wide" : knownGroupName(scopeFilter);
  // The absence forms, their count and the open follow-up items all follow the
  // View and Term filters (the screen once showed every one whatever the term),
  // so the panels say which view they are listing.
  const viewLabel = `${scopeLabel} · ${termFilter === "all" ? "All terms" : termLabel(termFilter)}`;
  const scopeInGroups = typeof scopeFilter !== "number" || groups.some((group) => group.id === scopeFilter);
  const profileName = (memberId: string) => { const profile = view.profiles.find((item) => item.id === memberId); return profile?.full_name || profile?.email || "Member"; };

  function changeScope(value: ScopeFilter) {
    attendance.chooseScope(value);
    setTab("overview");
    actions.resetLive();
  }

  function changeTerm(value: string) {
    attendance.chooseTerm(value);
    setTab("overview");
    actions.resetLive();
  }

  // The title and the two pickers stay on screen while the first read of a view is on the way or has failed: the person can pick another
  // audience or term (and a keyboard user keeps their place in the picker they just used), and the page does not jump when the data comes.
  if (!data) {
    return <section className="section-shell page-section attendance-page">
      <AttendanceHeader scopeFilter={scopeFilter} termFilter={termFilter} groups={groups} scopeLabel={scopeLabel} scopeInGroups={scopeInGroups} termOptions={termOptions} canManage={false} onScope={changeScope} onTerm={changeTerm} onNewMeeting={() => {}} />
      {failedKey === cacheKey
        ? <ErrorBlock message="Attendance could not be loaded." onRetry={() => load()} role="alert" />
        : <SkeletonRows rows={6} label="Loading attendance…" />}
    </section>;
  }

  return <section className="section-shell page-section attendance-page">
    <AttendanceHeader scopeFilter={scopeFilter} termFilter={termFilter} groups={groups} scopeLabel={scopeLabel} scopeInGroups={scopeInGroups} termOptions={termOptions} canManage={canManage} onScope={changeScope} onTerm={changeTerm} onNewMeeting={() => actions.setShowNewSession(true)} />
    {failedKey === cacheKey && <LoadErrorBanner message="Attendance could not be refreshed. What you see may be out of date." onRetry={() => load()} />}

    <CheckInCard code={actions.checkInCode} onCodeChange={actions.setCheckInCode} saving={saving} pending={active === "check-in"} feedback={actions.feedback} onSubmit={actions.checkIn} />

    {canManage ? <>
      <AttendanceSummary closedCount={closedSessions.length} overall={overallRate(view.attended_total, view.absent_total)} flagged={summaries} />
      {openSession && <LiveSessionCard session={openSession} liveCode={actions.liveCode} saving={saving} rotating={active === "rotate"} onRotate={() => actions.rotateCode(openSession.id)}
        onClose={() => setDialog({ kind: "session", sessionId: openSession.id, title: openSession.title, action: "close" })}
        onCancel={() => setDialog({ kind: "session", sessionId: openSession.id, title: openSession.title, action: "cancel" })} />}
      <AttendanceTabs tab={tab} onTab={setTab} pendingExcuseCount={view.excuses_pending} />
      <div role="tabpanel" id={ATTENDANCE_PANEL_ID} aria-labelledby={attendanceTabId(tab)}>
        {tab === "overview" && <OverviewTab view={view} sessions={sessions} flagged={summaries} warningLevel={warningLevel} criticalLevel={criticalLevel} viewLabel={viewLabel} saving={saving} profileName={profileName}
          onDialog={setDialog} onThresholdsChanged={() => load(true)} showMore={showMore} loadingMore={loadingMore} />}
        {tab === "meetings" && <MeetingsTab sessions={sessions} groups={groups} selectedSessionId={selectedSessionId} onSelect={setSelectedSessionId} roster={roster} rosterFailed={rosterFailed} saving={saving} openingSessionId={active?.startsWith("open:") ? Number(active.slice(5)) : null}
          onOpenAttendance={actions.openAttendance} onDialog={setDialog} onSessionChanged={() => load()} onRefresh={actions.refresh} onRetryRoster={loadRoster} />}
        {tab === "excuses" && <ExcusesTab view={view} sessions={sessions} viewLabel={viewLabel} saving={saving} profileName={profileName} onDialog={setDialog} onOpenProof={actions.openProof} openingProofId={actions.openingProofId} showMore={showMore} loadingMore={loadingMore} />}
      </div>
    </> : <MemberView view={view} sessions={sessions} user={user} scopeLabel={scopeLabel} termFilter={termFilter} onSubmitExcuse={() => actions.setShowExcuse(true)} onWithdrawn={() => load(true)} />}

    {actions.showNewSession && <NewMeetingDialog scopeFilter={scopeFilter} scopeInGroups={scopeInGroups} groups={groups} saving={saving} onSubmit={actions.createSession} onClose={() => actions.setShowNewSession(false)} />}
    {actions.showExcuse && <AbsenceFormDialog sessions={sessions} saving={saving} onSubmit={actions.submitExcuse} onClose={() => actions.setShowExcuse(false)} />}

    <ActionDialogs dialog={dialog} saving={saving} onSubmit={actions.submitDialog} onConfirm={actions.confirmSession} onCancel={() => setDialog(null)} />
  </section>;
}
