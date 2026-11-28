"use client";

import { ErrorBlock } from "../../../components/ui/error-block";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import type { AdminListStatus } from "../hooks/use-admin-data";

/**
 * What a list of the Admin page says when its last read failed: nothing was ever read ("failed": an error with Try again, to be drawn
 * IN PLACE of the list, never an empty list) or the list shown is from an earlier read ("stale": a banner above it). A list that was read
 * says nothing. `busy` is the Try again in flight.
 */
export function ListFailure({ status, failed, stale, onRetry, busy = false }: { status: AdminListStatus; failed: string; stale: string; onRetry: () => void; busy?: boolean }) {
  if (status === "failed") return <ErrorBlock message={failed} onRetry={onRetry} role="alert" busy={busy} />;
  if (status === "stale") return <LoadErrorBanner message={stale} onRetry={onRetry} busy={busy} />;
  return null;
}
