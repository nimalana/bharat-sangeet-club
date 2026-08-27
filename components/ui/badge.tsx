import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type BadgeVariant = "subgroup" | "muted";

const variants: Record<BadgeVariant, string> = {
  subgroup: "border-[#9fc3da] bg-[var(--carolina-pale)] text-[#235b7f]",
  muted: "border-[var(--line)] bg-transparent text-[#70818c]",
};

export function Badge({ className, variant = "subgroup", ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return <span className={cn("inline-flex max-w-full min-w-0 items-center rounded-none border px-2 py-1 text-[0.66rem] font-semibold leading-tight tracking-[0.02em] whitespace-normal break-words", variants[variant], className)} {...props} />;
}
