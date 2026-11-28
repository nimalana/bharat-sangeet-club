"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabSpec<T extends string> = { id: T; label: string };

/** The id a TabList gives its tab `id`: the tabpanel it controls names itself by it (`aria-labelledby`). */
const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;

/**
 * A row of tabs for a keyboard: only the selected tab is in the Tab order, the arrow keys (Home and End too) move to the previous or next tab
 * and select it, and each tab names the panel it controls. Wrap the content in a `<TabPanel>` with the same `prefix`.
 * The look is the screen's own (`className` on the row, `active` on the selected tab). `locked`: the selection cannot change now (the other
 * tabs are disabled and the arrows do nothing), as while something is being recorded.
 */
export function TabList<T extends string>({ tabs, value, onChange, label, prefix, className, locked = false }: { tabs: readonly TabSpec<T>[]; value: T; onChange: (id: T) => void; label: string; prefix: string; className?: string; locked?: boolean }) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  function move(event: KeyboardEvent<HTMLButtonElement>) {
    const at = tabs.findIndex((tab) => tab.id === value);
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (at >= last ? 0 : at + 1) : event.key === "ArrowLeft" ? (at <= 0 ? last : at - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (next < 0 || locked) return;
    event.preventDefault();
    onChange(tabs[next].id);
    buttons.current.get(tabs[next].id)?.focus();
  }
  return <div role="tablist" aria-label={label} className={className}>
    {tabs.map((tab) => <button key={tab.id} ref={(node) => { if (node) buttons.current.set(tab.id, node); else buttons.current.delete(tab.id); }} type="button" role="tab" id={tabId(prefix, tab.id)}
      aria-selected={value === tab.id} disabled={locked && value !== tab.id} aria-controls={`${prefix}-panel`} tabIndex={value === tab.id ? 0 : -1} className={value === tab.id ? "active" : ""}
      onClick={() => onChange(tab.id)} onKeyDown={move}>{tab.label}</button>)}
  </div>;
}

/** What the selected tab shows. */
export function TabPanel({ prefix, value, children, className }: { prefix: string; value: string; children: ReactNode; className?: string }) {
  return <div role="tabpanel" id={`${prefix}-panel`} aria-labelledby={tabId(prefix, value)} className={className}>{children}</div>;
}
