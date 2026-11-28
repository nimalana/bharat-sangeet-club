import { Button } from "./button";

// A first read that failed, in the place of the content: what happened, and Try again. (A refresh that failed while data is on
// screen uses LoadErrorBanner instead.) `className` is the look of the surrounding block: a loading line by default.
export function ErrorBlock({ message, onRetry, className = "inline-loading" }: { message: string; onRetry: () => void; className?: string }) {
  return <div className={className}>{message} <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button></div>;
}
