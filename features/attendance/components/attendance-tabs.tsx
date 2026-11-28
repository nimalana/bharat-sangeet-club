"use client";

import type { AttendanceTab } from "../model";

// Overview, Meetings and Absence forms (with the number waiting for review).
export function AttendanceTabs({ tab, onTab, pendingExcuseCount }: { tab: AttendanceTab; onTab: (tab: AttendanceTab) => void; pendingExcuseCount: number }) {
  return <div className="attendance-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onTab("overview"); }}>Overview</button><button type="button" role="tab" aria-selected={tab === "meetings"} className={tab === "meetings" ? "active" : ""} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onTab("meetings"); }}>Meetings</button><button type="button" role="tab" aria-selected={tab === "excuses"} className={tab === "excuses" ? "active" : ""} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onTab("excuses"); }}>Absence forms {pendingExcuseCount ? `(${pendingExcuseCount})` : ""}</button></div>;
}
