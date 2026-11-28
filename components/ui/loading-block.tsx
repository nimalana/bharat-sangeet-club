import type { ReactNode } from "react";

// The line a screen shows while its first read is on the way. `role="status"` is for the placeholder of a lazily loaded screen.
export function LoadingBlock({ children, role }: { children: ReactNode; role?: "status" }) {
  return <div className="inline-loading" role={role}>{children}</div>;
}
