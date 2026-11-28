"use client";

import type { KeyboardEvent } from "react";
import type { AttendanceTab } from "../model";

// The tabs, in the order they are drawn, and the ids that tie each tab to the panel under them (the page wraps the open tab's content
// in a tabpanel with ATTENDANCE_PANEL_ID, named by the tab that is open).
const ORDER: AttendanceTab[] = ["overview", "meetings", "excuses"];
export const ATTENDANCE_PANEL_ID = "attendance-tabpanel";
export const attendanceTabId = (tab: AttendanceTab) => `attendance-tab-${tab}`;

// Overview, Meetings and Absence forms (with the number waiting for review). Tab reaches the open tab only; the arrow keys, Home and End
// move to another one and open it (the pattern of a tablist, so a keyboard user does not tab through all three to reach the content).
export function AttendanceTabs({ tab, onTab, pendingExcuseCount }: { tab: AttendanceTab; onTab: (tab: AttendanceTab) => void; pendingExcuseCount: number }) {
  function choose(next: AttendanceTab) {
    onTab(next);
    document.getElementById(attendanceTabId(next))?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const at = ORDER.indexOf(tab);
    const next = event.key === "ArrowRight" ? ORDER[(at + 1) % ORDER.length]
      : event.key === "ArrowLeft" ? ORDER[(at + ORDER.length - 1) % ORDER.length]
      : event.key === "Home" ? ORDER[0]
      : event.key === "End" ? ORDER[ORDER.length - 1]
      : null;
    if (!next) return;
    event.preventDefault();
    choose(next);
  }
  const props = (name: AttendanceTab) => ({
    type: "button" as const, role: "tab", id: attendanceTabId(name), "aria-selected": tab === name, "aria-controls": ATTENDANCE_PANEL_ID, tabIndex: tab === name ? 0 : -1,
    className: tab === name ? "active" : "", onKeyDown,
    onClick: (event: { preventDefault: () => void; stopPropagation: () => void }) => { event.preventDefault(); event.stopPropagation(); onTab(name); },
  });
  return <div className="attendance-tabs" role="tablist" aria-label="Attendance sections"><button {...props("overview")}>Overview</button><button {...props("meetings")}>Meetings</button><button {...props("excuses")}>Absence forms {pendingExcuseCount ? `(${pendingExcuseCount})` : ""}</button></div>;
}
