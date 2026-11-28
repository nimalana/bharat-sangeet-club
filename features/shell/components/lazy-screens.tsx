"use client";

import dynamic from "next/dynamic";
import { LoadingBlock } from "../../../components/ui/loading-block";

// Each heavy screen is its own bundle, loaded when it is first opened, so the
// audio libraries and finance code are not downloaded to read the calendar.
// A screen whose file cannot be fetched is caught by SectionBoundary in the shell.
const SectionLoading = () => <LoadingBlock role="status">Loading…</LoadingBlock>;
export const AttendancePage = dynamic(() => import("../../attendance/components/attendance-page").then((module) => module.AttendancePage), { ssr: false, loading: SectionLoading });
export const MembersPage = dynamic(() => import("../../members/components/members-page").then((module) => module.MembersPage), { ssr: false, loading: SectionLoading });
export const CalendarPage = dynamic(() => import("../../calendar/components/calendar-page").then((module) => module.CalendarPage), { ssr: false, loading: SectionLoading });
export const FinancePage = dynamic(() => import("../../finance/components/finance-page").then((module) => module.FinancePage), { ssr: false, loading: SectionLoading });
export const ResourceLibrary = dynamic(() => import("../../resources/components/resource-library").then((module) => module.ResourceLibrary), { ssr: false, loading: SectionLoading });
export const RecordingWorkspace = dynamic(() => import("../../recordings/components/recording-workspace").then((module) => module.RecordingWorkspace), { ssr: false, loading: SectionLoading });
export const ClubArchiveManager = dynamic(() => import("../../recordings/components/club-archive-manager").then((module) => module.ClubArchiveManager), { ssr: false, loading: SectionLoading });
// "My profile" of the account menu: its own bundle, fetched the first time it is opened (and on idle, see use-idle-prefetch), so it is not in the first load.
// It draws nothing while its file arrives: the person pressed a menu item, and the dialog follows at once.
export const OwnProfileDialog = dynamic(() => import("../../members/components/own-profile-dialog").then((module) => module.OwnProfileDialog), { ssr: false, loading: () => null });
// "Complete your profile": the step after a first sign-in. Also its own bundle: most sign-ins never show it.
export const CompleteProfileDialog = dynamic(() => import("../../members/components/complete-profile-dialog").then((module) => module.CompleteProfileDialog), { ssr: false, loading: () => null });
// The calendar's forms (add a date, edit a date), fetched when the first one is opened.
export const CalendarDialogs = dynamic(() => import("../../calendar/components/calendar-dialogs").then((module) => module.CalendarDialogs), { ssr: false, loading: () => null });
