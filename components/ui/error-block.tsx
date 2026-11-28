import { Button } from "./button";

// A first read that failed, in the place of the content: what happened, and Try again. (A refresh that failed while data is on
// screen uses LoadErrorBanner instead.) `className` is the look of the surrounding block: a loading line by default.
//
//   if (failed && data === undefined) return <ErrorBlock message="The members could not be loaded." onRetry={retry} role="alert" busy={loading} />;
//
// `role="alert"` makes a screen reader announce it when it replaces the content (like LoadingBlock's `role="status"`); `busy` is the retry in
// flight: the button is disabled and says so. With neither it is the markup the screens wrote by hand.
export function ErrorBlock({ message, onRetry, className = "inline-loading", role, busy = false }: { message: string; onRetry: () => void; className?: string; role?: "alert"; busy?: boolean }) {
  return <div className={className} role={role}>{message} <Button size="sm" variant="secondary" onClick={onRetry} pending={busy}>Try again</Button></div>;
}
