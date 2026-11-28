import type { KeyboardEvent, ReactNode } from "react";
import type { FinanceView } from "../types";

// The tabs of the screen, as the WAI-ARIA tabs pattern has them: only the open tab is in the Tab order (the others are reached with the arrow
// keys, Home and End), the arrow keys open the tab they land on, and the open tab names the panel it controls.
// A shared Tabs component does not exist yet (it is listed under "needs:" in the Phase 3 finance report); this one is the screen's own.

const TAB_LABELS: Record<FinanceView, string> = { overview: "overview", expenses: "expenses", reimbursements: "reimbursements", claims: "Funding claims" };
const tabId = (view: FinanceView) => `finance-tab-${view}`;
const panelId = (view: FinanceView) => `finance-panel-${view}`;

export function FinanceTabs({ views, value, onChange }: { views: readonly FinanceView[]; value: FinanceView; onChange: (view: FinanceView) => void }) {
  function move(event: KeyboardEvent<HTMLButtonElement>, from: number) {
    const last = views.length - 1;
    const to = event.key === "ArrowRight" ? (from === last ? 0 : from + 1)
      : event.key === "ArrowLeft" ? (from === 0 ? last : from - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : -1;
    if (to < 0) return;
    event.preventDefault();
    document.getElementById(tabId(views[to]))?.focus();
    onChange(views[to]);
  }
  return <div className="finance-tabs" role="tablist" aria-label="Finance sections">
    {views.map((view, index) => <button
      key={view} id={tabId(view)} type="button" role="tab" aria-selected={view === value} aria-controls={view === value ? panelId(view) : undefined}
      tabIndex={view === value ? 0 : -1} className={view === value ? "active" : ""} onClick={() => onChange(view)} onKeyDown={(event) => move(event, index)}
    >{TAB_LABELS[view]}</button>)}
  </div>;
}

/** The open tab's panel: named by its tab. */
export function FinancePanel({ view, children }: { view: FinanceView; children: ReactNode }) {
  return <div role="tabpanel" id={panelId(view)} aria-labelledby={tabId(view)}>{children}</div>;
}
