import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../../lib/utils";

// A button that is only an icon or a glyph (×, ✎, a chevron): it has no words of its own, so it MUST be given its name. `aria-label` is required by the
// type, and a call without one does not compile.
//
//   <IconButton aria-label="Close the editor" onClick={onClose}>×</IconButton>
//   <IconButton aria-label={`Edit ${member.name}`} onClick={() => edit(member)}><PencilIcon /></IconButton>
//
// The name says what the button does, in words ("Close the editor", not "×" or "close"); when the screen has several of them, it says which ("Edit Asha", "Edit Ravi").
// The icon itself is not read (give an <svg> `aria-hidden="true"`). It is a 36px square, 44px on a screen narrower than 700px, with the portal's focus ring.
type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  "aria-label": string;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function IconButton({ className, type = "button", ref, ...props }: IconButtonProps) {
  return <button ref={ref} type={type} className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-none border border-transparent bg-transparent text-lg leading-none text-[var(--ink)] transition-colors hover:border-[var(--line)] hover:bg-[var(--carolina-pale)] disabled:cursor-not-allowed disabled:opacity-50 max-[700px]:size-11", className)} {...props} />;
}
