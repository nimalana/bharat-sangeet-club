"use client";

// One figure of the summary rows: a small label over a large value, optionally tinted.
export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warning" | "critical" }) {
  return <div className={tone || ""}><small>{label}</small><strong>{value}</strong></div>;
}
