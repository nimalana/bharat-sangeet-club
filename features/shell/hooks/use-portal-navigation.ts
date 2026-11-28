"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { ScopeFilter } from "../../../lib/db";
import { sectionFromSearch, sectionUrl, type Section } from "../../../lib/sections";

export type AttendanceTab = "overview" | "meetings" | "excuses";

function sectionFromUrl(): Section {
  if (typeof window === "undefined") return "home";
  return sectionFromSearch(window.location.search);
}

/** The attendance tab the address asks for: ?page=meetings and ?tab=meetings (an older link) open the meetings. */
export function attendanceTabFromUrl(): AttendanceTab {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  return params.get("page") === "meetings" || params.get("tab") === "meetings" ? "meetings" : "overview";
}

/**
 * Which page is open and which address shows it. The address is the truth: a page is opened by pushing ?page=<name>, the
 * browser's back and forward buttons put the page (and the sign-in screen of the public site, ?signin=1) back, and a
 * link made before pages were folded together (?page=gallery) still opens the right one (lib/sections.ts).
 *
 * The three `...Scope` values are the group a page was opened for ("Open attendance" on a group): they outlive the
 * page, as the shell always kept them, and the page reads its own as the scope it starts with.
 */
export function usePortalNavigation({ user, loadData }: { user: User | null; loadData: () => void | Promise<void> }) {
  const [section, setSection] = useState<Section>(sectionFromUrl);
  const [showLogin, setShowLogin] = useState(false);
  const [recordingScope, setRecordingScope] = useState<ScopeFilter>("all");
  const [attendanceInitialScope, setAttendanceInitialScope] = useState<ScopeFilter>("all");
  const [resourceInitialScope, setResourceInitialScope] = useState<ScopeFilter>("all");

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

  // Opening the overview reads the lists again: they may have changed since it was last shown.
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

  const openAttendanceFor = (groupId: ScopeFilter) => { setAttendanceInitialScope(groupId); navigate("attendance"); };
  const openRecordingsFor = (groupId: ScopeFilter) => { setRecordingScope(groupId); navigate("recordings"); };
  const openResourcesFor = (groupId: ScopeFilter) => { setResourceInitialScope(groupId); navigate("documents"); };

  return {
    section, showLogin, navigate, openLogin, closeLogin,
    recordingScope, attendanceInitialScope, resourceInitialScope,
    openAttendanceFor, openRecordingsFor, openResourcesFor,
  };
}
