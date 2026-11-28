"use client";

import { Button } from "../../../components/ui/button";

// Says a list is capped and, when a larger cap exists, offers the next one.
export function QueueNote({ note, onShowMore, busy }: { note: string; onShowMore: (() => void) | null; busy: boolean }) {
  if (!note) return null;
  return <p className="attendance-help">{note} {onShowMore && <Button size="sm" variant="secondary" disabled={busy} onClick={onShowMore}>{busy ? "Loading…" : "Show more"}</Button>}</p>;
}
