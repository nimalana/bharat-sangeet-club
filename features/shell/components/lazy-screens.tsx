"use client";

import dynamic from "next/dynamic";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { screenLoaders } from "../screen-loaders";

// Each heavy screen is its own bundle, loaded when it is first opened, so the
// audio libraries and finance code are not downloaded to read the calendar.
// A screen whose file cannot be fetched is caught by SectionBoundary in the shell. The files are named in ../screen-loaders.ts, which the idle prefetch shares.
const SectionLoading = () => <LoadingBlock role="status">Loading…</LoadingBlock>;
export const AttendancePage = dynamic(() => screenLoaders.attendance().then((module) => module.AttendancePage), { ssr: false, loading: SectionLoading });
export const MembersPage = dynamic(() => screenLoaders.members().then((module) => module.MembersPage), { ssr: false, loading: SectionLoading });
export const CalendarPage = dynamic(() => screenLoaders.calendar().then((module) => module.CalendarPage), { ssr: false, loading: SectionLoading });
export const FinancePage = dynamic(() => screenLoaders.finance().then((module) => module.FinancePage), { ssr: false, loading: SectionLoading });
export const ResourceLibrary = dynamic(() => screenLoaders.resources().then((module) => module.ResourceLibrary), { ssr: false, loading: SectionLoading });
export const RecordingWorkspace = dynamic(() => screenLoaders.recordings().then((module) => module.RecordingWorkspace), { ssr: false, loading: SectionLoading });
export const ClubArchiveManager = dynamic(() => screenLoaders.clubArchive().then((module) => module.ClubArchiveManager), { ssr: false, loading: SectionLoading });
// "My profile" of the account menu: its own bundle, fetched the first time it is opened (and on idle, see use-idle-prefetch), so it is not in the first load.
// It draws nothing while its file arrives: the person pressed a menu item, and the dialog follows at once.
export const OwnProfileDialog = dynamic(() => screenLoaders.ownProfile().then((module) => module.OwnProfileDialog), { ssr: false, loading: () => null });
// "Complete your profile": the step after a first sign-in. Also its own bundle: most sign-ins never show it.
export const CompleteProfileDialog = dynamic(() => screenLoaders.completeProfile().then((module) => module.CompleteProfileDialog), { ssr: false, loading: () => null });
// The calendar's forms (add a date, edit a date), fetched when the first one is opened.
export const CalendarDialogs = dynamic(() => screenLoaders.calendarDialogs().then((module) => module.CalendarDialogs), { ssr: false, loading: () => null });
