import type { ButtonHTMLAttributes, Ref } from "react";
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

// `pending`: the button's action is running. It is disabled (so a second click cannot send the action twice, and it looks as a disabled
// button does) and says so to assistive technology (aria-busy). Pair it with the pending flag of useAsyncAction:
//   <Button pending={save.pending} onClick={() => save.run(...)}>Save</Button>
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; pending?: boolean; ref?: Ref<HTMLButtonElement> };

export function Button({ className, variant = "primary", size = "default", type = "button", ref, pending = false, disabled, ...props }: ButtonProps) {
  return <button ref={ref} type={type} disabled={disabled || pending} aria-busy={pending || undefined} className={cn("inline-flex max-w-full items-center justify-center gap-2 rounded-none font-bold tracking-[0.02em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--carolina)] disabled:cursor-not-allowed disabled:opacity-50", variants[variant], sizes[size], className)} {...props} />;
}
