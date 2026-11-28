"use client";

import type { MemberSummary } from "../model";
import { Stat } from "./stat";

// The four figures an executive sees above the tabs: closed meetings, the attendance rate and how many members are flagged.
export function AttendanceSummary({ closedCount, overall, flagged }: { closedCount: number; overall: number; flagged: MemberSummary[] }) {
  return <div className="attendance-summary-grid"><Stat label="Closed meetings" value={closedCount} /><Stat label="Attendance rate" value={`${overall}%`} /><Stat label="At policy limit" value={flagged.filter((item) => item.flag === "warning").length} tone="warning" /><Stat label="Needs review" value={flagged.filter((item) => item.flag === "critical").length} tone="critical" /></div>;
}
