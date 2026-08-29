import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("block h-11 w-full min-w-0 border border-[var(--line)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[#7b8993] focus:border-[var(--carolina)] focus:ring-2 focus:ring-[rgba(75,156,211,.2)] disabled:cursor-not-allowed disabled:bg-[#edf2f5] disabled:opacity-70", className)} {...props} />;
}
