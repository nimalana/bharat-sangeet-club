"use client";

// The modal dialog every dialog of the portal is built on (ConfirmDialog, FormDialog, the area dialogs, PreviewDialog).
//
//   <Dialog open={open} onClose={() => setOpen(false)} labelledBy="edit-title" describedBy="edit-help" className="max-w-[520px]">
//     <h2 id="edit-title">Edit the date</h2> ...the content, with its own buttons...
//   </Dialog>
//
// What it does for you, so that no dialog has to:
// - the panel is role="dialog" aria-modal="true" with an accessible name: `label` (aria-label), `labelledBy` (an id), or, when neither
//   is given, the first heading (h1, h2, h3 or [data-dialog-title]) inside it; `describedBy` is an id of the text that explains it;
// - focus moves into the dialog when it opens (`initialFocus` ref, else the first control, else the panel itself), Tab and Shift+Tab
//   stay inside it (they wrap), and when it closes focus goes back to the element that had it before, if that element still exists;
// - Escape and a click on the backdrop call `onClose`, unless `dismissible={false}` (a dialog that must be answered, or one that is busy:
//   neither closes it). `closeOnBackdrop={false}` keeps Escape but ignores the backdrop (a form: a stray click must not lose what was typed);
// - the page behind it cannot scroll, and the rest of the page is `inert` (not focusable, not read by a screen reader) while it is open,
//   except a live region (the toasts), which a screen reader must still announce;
// - with several open, only the topmost answers Tab and Escape.
//
// It renders where it is written (no portal), so a dialog inside a form or a list keeps its place in the tree, and nothing is rendered
// while `open` is false: the hooks live in the inner component, which is mounted exactly while the dialog is open.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "../../lib/utils";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** aria-label, for a dialog with no visible title. */
  label?: string;
  /** The id of the element that names the dialog. Without `label` and `labelledBy` the first heading inside it names it. */
  labelledBy?: string;
  /** The id of the element that describes it. */
  describedBy?: string;
  /** false: neither Escape nor the backdrop closes it. Default true. */
  dismissible?: boolean;
  /** false: the backdrop does not close it (Escape still does). Default: the value of `dismissible`. */
  closeOnBackdrop?: boolean;
  /** The element to focus when it opens (its ref's current). Default: the first control. */
  initialFocus?: RefObject<HTMLElement | null>;
};

// ---------------------------------------------------------------- what is open, and who answers the keyboard

type Entry = { root: HTMLElement; panel: HTMLElement; dismissible: () => boolean; close: () => void };
const openDialogs: Entry[] = [];

const TABBABLE = 'a[href],area[href],button,input:not([type="hidden"]),select,textarea,summary,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[tabindex]';
const tabbables = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE)).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[hidden],[inert]"));

// Focus can be refused (an element that is not displayed): take the first one that accepts it.
function focusFirst(candidates: HTMLElement[]) {
  for (const element of candidates) { element.focus(); if (document.activeElement === element) return true; }
  return false;
}

function onKeyDown(event: KeyboardEvent) {
  const top = openDialogs[openDialogs.length - 1];
  if (!top || event.defaultPrevented || event.isComposing) return;
  if (event.key === "Escape") { if (top.dismissible()) top.close(); return; }
  if (event.key !== "Tab") return;
  const controls = tabbables(top.panel);
  const at = controls.indexOf(document.activeElement as HTMLElement);
  const outside = !top.panel.contains(document.activeElement);
  // Wrap at the ends (the panel itself counts as before the first control), and pull a focus that got outside back in.
  const wrap = controls.length === 0 || outside || (event.shiftKey ? at <= 0 : at === controls.length - 1);
  if (!wrap) return;
  event.preventDefault();
  focusFirst(controls.length === 0 ? [top.panel] : event.shiftKey ? controls.slice().reverse() : controls);
}

// ---------------------------------------------------------------- the page behind: no scrolling, not reachable

function lockScroll() {
  const page = document.documentElement;
  const before = { overflow: page.style.overflow, paddingRight: page.style.paddingRight };
  const scrollbar = window.innerWidth - page.clientWidth; // the page must not jump sideways when its scrollbar goes
  page.style.overflow = "hidden";
  if (scrollbar > 0 && page.clientWidth > 0) page.style.paddingRight = `${scrollbar}px`;
  return () => { page.style.overflow = before.overflow; page.style.paddingRight = before.paddingRight; };
}

// Only the topmost dialog is reachable: every sibling of it and of its ancestors becomes inert, which includes a dialog under it. A live
// region (aria-live) stays reachable, because the toast that says the dialog's action failed must still be announced: a part of the page
// that holds one is not made inert as a whole, only what is around the region is. What was inert before the dialog opened is not touched
// (and stays inert after).
const NOT_CONTENT = /^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/;
let inerted: Element[] = [];
function inertAround(parent: Element, keep: Element | null) {
  for (const child of Array.from(parent.children)) {
    if (child === keep || NOT_CONTENT.test(child.tagName) || child.hasAttribute("inert") || child.hasAttribute("aria-live")) continue;
    if (child.querySelector("[aria-live]")) { inertAround(child, null); continue; }
    child.setAttribute("inert", "");
    inerted.push(child);
  }
}
function refreshIsolation() {
  for (const element of inerted) element.removeAttribute("inert");
  inerted = [];
  const top = openDialogs[openDialogs.length - 1];
  for (let node: HTMLElement | null = top?.root ?? null; node && node !== document.body; node = node.parentElement) {
    if (node.parentElement) inertAround(node.parentElement, node);
  }
}

let unlockScroll: (() => void) | null = null;
function register(entry: Entry) {
  openDialogs.push(entry);
  if (openDialogs.length === 1) { document.addEventListener("keydown", onKeyDown); unlockScroll = lockScroll(); }
  refreshIsolation();
  return () => {
    openDialogs.splice(openDialogs.indexOf(entry), 1);
    refreshIsolation();
    if (openDialogs.length === 0) { document.removeEventListener("keydown", onKeyDown); unlockScroll?.(); unlockScroll = null; }
  };
}

// ---------------------------------------------------------------- the component

export function Dialog(props: DialogProps) {
  return props.open ? <OpenDialog {...props} /> : null;
}

function OpenDialog({ onClose, children, className, label, labelledBy, describedBy, dismissible = true, closeOnBackdrop = dismissible, initialFocus }: DialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const generated = useId();
  // Read while rendering, before anything in the dialog (an autoFocus field) has taken the focus: this is where it goes back to.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  const latest = useRef({ onClose, dismissible });
  useEffect(() => { latest.current = { onClose, dismissible }; });
  // A drag that starts in the panel and ends on the backdrop is not a click on the backdrop.
  const startedInPanel = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    const unregister = register({ root, panel, dismissible: () => latest.current.dismissible, close: () => latest.current.onClose() });
    if (!panel.contains(document.activeElement)) {
      const wanted = initialFocus?.current;
      if (!wanted || !panel.contains(wanted) || !focusFirst([wanted])) focusFirst([...tabbables(panel), panel]);
    }
    return () => {
      unregister();
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
    // Runs once per opening: the callbacks it keeps are read through `latest`, `initialFocus` only matters at the start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No label and no labelledBy: the first heading names the dialog (checked after every render, a heading can appear later).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || label || labelledBy) return;
    const heading = panel.querySelector<HTMLElement>("[data-dialog-title],h1,h2,h3");
    if (!heading) return;
    if (!heading.id) heading.id = `${generated}-title`;
    panel.setAttribute("aria-labelledby", heading.id);
  });

  return <div
    ref={rootRef}
    role="presentation"
    className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(23,37,47,.72)] p-4"
    onMouseDown={(event) => { startedInPanel.current = event.target !== event.currentTarget; }}
    onClick={(event) => {
      const dragged = startedInPanel.current;
      startedInPanel.current = false;
      if (event.target === event.currentTarget && !dragged && closeOnBackdrop && dismissible) onClose();
    }}
  >
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy} tabIndex={-1}
      className={cn("max-h-[calc(100vh-2rem)] w-full max-w-[700px] overflow-y-auto border border-[var(--ink)] bg-[var(--ivory)] p-6 text-[var(--ink)] shadow-[14px_18px_40px_rgba(23,37,47,.2)] sm:p-9", className)}>
      {children}
    </div>
  </div>;
}
