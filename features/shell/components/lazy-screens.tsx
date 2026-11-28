"use client";

import dynamic from "next/dynamic";
import { LoadingBlock } from "../../../components/ui/loading-block";

// Each heavy screen is its own bundle, loaded when it is first opened, so the
// audio libraries and finance code are not downloaded to read the calendar.
// A screen whose file cannot be fetched is caught by SectionBoundary in the shell.
const SectionLoading = () => <LoadingBlock role="status">Loading…</LoadingBlock>;
export const AttendancePage = dynamic(() => import("../../attendance/components/attendance-page").then((module) => module.AttendancePage), { ssr: false, loading: SectionLoading });
export const FinancePage = dynamic(() => import("../../finance/components/finance-page").then((module) => module.FinancePage), { ssr: false, loading: SectionLoading });
export const ResourceLibrary = dynamic(() => import("../../resources/components/resource-library").then((module) => module.ResourceLibrary), { ssr: false, loading: SectionLoading });
export const RecordingWorkspace = dynamic(() => import("../../recordings/components/recording-workspace").then((module) => module.RecordingWorkspace), { ssr: false, loading: SectionLoading });
export const ClubArchiveManager = dynamic(() => import("../../recordings/components/club-archive-manager").then((module) => module.ClubArchiveManager), { ssr: false, loading: SectionLoading });
