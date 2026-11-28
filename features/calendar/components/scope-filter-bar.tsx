"use client";

import type { ScopeFilter, Subgroup } from "../../../lib/db";

export function ScopeFilterBar({ value, onChange, groups }: { value: ScopeFilter; onChange: (scope: ScopeFilter) => void; groups: Subgroup[] }) {
  const selectedValue = typeof value === "number" ? `group:${value}` : value;
  return <label className="scope-picker"><span>View</span><select aria-label="Filter by audience" value={selectedValue} onChange={(event) => { const next = event.target.value; onChange(next.startsWith("group:") ? Number(next.slice(6)) : next as "all" | "club"); }}><option value="all">All activity</option><option value="club">Club-wide</option>{groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name}</option>)}</select></label>;
}
