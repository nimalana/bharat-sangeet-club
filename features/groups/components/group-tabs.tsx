"use client";

import { useRef, type KeyboardEvent } from "react";

export type GroupTabItem = { id: string; label: string; /** A number shown on the tab (the requests waiting); read out as "(n waiting)". */ count?: number };

/** The id of the tab button for a tab, and of the one panel that the open tab controls. */
export const tabButtonId = (id: string) => `group-tab-${id}`;
export const GROUP_PANEL_ID = "group-tabpanel";

/**
 * The tab strip of a group's page (WAI-ARIA tabs): role=tablist, one role=tab button per tab, the open tab `aria-selected` and the only
 * one in the Tab order (roving tabindex); Left and Right move to the previous and next tab and open it (wrapping), Home and End go to
 * the first and last. Opening a tab is `onSelect(id)`; the page draws the panel (role=tabpanel, labelled by the open tab's button).
 * Only the open tab says what it controls: the other panels are not in the page (they load when their tab is opened).
 */
export function GroupTabs({ tabs, selected, onSelect, label = "Group sections" }: { tabs: GroupTabItem[]; selected: string; onSelect: (id: string) => void; label?: string }) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const focused = tabs.findIndex((tab) => buttons.current.get(tab.id) === document.activeElement);
    const at = focused >= 0 ? focused : Math.max(0, tabs.findIndex((tab) => tab.id === selected));
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (at === last ? 0 : at + 1) : event.key === "ArrowLeft" ? (at === 0 ? last : at - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(tabs[next].id);
    buttons.current.get(tabs[next].id)?.focus();
  }

  return <div className="group-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab) => {
      const open = tab.id === selected;
      return <button key={tab.id} type="button" role="tab" id={tabButtonId(tab.id)} aria-selected={open} aria-controls={open ? GROUP_PANEL_ID : undefined} tabIndex={open ? 0 : -1}
        className={open ? "group-tab active" : "group-tab"} onKeyDown={onKeyDown} ref={(element) => { if (element) buttons.current.set(tab.id, element); else buttons.current.delete(tab.id); }} onClick={() => onSelect(tab.id)}>
        {tab.label}
        {tab.count ? <>{" "}<span className="sr-only">({tab.count} waiting)</span><span className="group-tab-count" aria-hidden="true">{tab.count}</span></> : null}
      </button>;
    })}
  </div>;
}
