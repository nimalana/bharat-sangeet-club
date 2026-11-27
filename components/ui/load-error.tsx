import { Button } from "./button";

// Shown when a refresh failed. The data already on screen is kept; this says it
// may be out of date and offers a retry.
export function LoadErrorBanner({ message, onRetry, busy = false }: { message: string; onRetry: () => void; busy?: boolean }) {
  return <div className="action-feedback error flex flex-wrap items-center justify-between gap-3" role="alert">
    <span>{message}</span>
    <Button variant="secondary" size="sm" onClick={onRetry} disabled={busy}>{busy ? "Trying…" : "Try again"}</Button>
  </div>;
}
