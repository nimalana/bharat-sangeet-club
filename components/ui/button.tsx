import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "default" | "sm";

const variants: Record<ButtonVariant, string> = {
  primary: "border border-[var(--ink)] bg-[var(--ink)] !text-white shadow-[0_6px_18px_rgba(19,41,75,.14)] hover:border-[var(--carolina)] hover:bg-[var(--carolina)] hover:!text-[var(--ink)]",
  secondary: "border border-[var(--ink)] bg-transparent !text-[var(--ink)] hover:border-[var(--carolina)] hover:bg-[var(--carolina-pale)]",
  danger: "border border-[#bd777d] bg-transparent !text-[#8b2832] hover:bg-[#f5e5e6]",
  ghost: "border border-transparent bg-transparent !text-[var(--ink)] hover:border-[var(--line)] hover:bg-[var(--carolina-pale)]",
};

const sizes: Record<ButtonSize, string> = {
  default: "min-h-11 px-5 text-xs",
  sm: "min-h-9 px-3 text-[0.68rem]",
};

export function Button({ className, variant = "primary", size = "default", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={cn("inline-flex max-w-full items-center justify-center gap-2 rounded-none font-bold tracking-[0.02em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--carolina)] disabled:cursor-not-allowed disabled:opacity-50", variants[variant], sizes[size], className)} {...props} />;
}
