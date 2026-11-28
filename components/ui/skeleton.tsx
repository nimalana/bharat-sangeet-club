import { cn } from "../../lib/utils";

// What a screen shows while its first read is on the way, in the shape of what is coming (a list of rows), instead of a line of text.
// Pure CSS (ui.css): a slow sweep of light that stops for a person who asks for less motion (prefers-reduced-motion).
//
//   if (loading) return <SkeletonRows rows={4} label="Loading the members" />;
//
// The bars are hidden from assistive technology; what it hears instead is one polite status, `label` (default "Loading").

/** One bar. Size it with `className` (a height and a width); it is aria-hidden. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("skeleton", className)} />;
}

export function SkeletonRows({ rows = 3, label = "Loading", className }: { rows?: number; label?: string; className?: string }) {
  return <div className={className}>
    <span className="sr-only" role="status">{label}</span>
    <div aria-hidden="true">{Array.from({ length: rows }, (_, row) => <Skeleton key={row} className="skeleton-row" />)}</div>
  </div>;
}
