"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ClubRole } from "../../../lib/db";

const ROLE_BADGE: Record<ClubRole, string> = { admin: "AD", executive: "EX", member: "MB" };
const ROLE_WORD: Record<ClubRole, string> = { admin: "Admin", executive: "Executive", member: "Member" };

/**
 * The person's name in the top bar, as a menu button: it opens "My profile" (when the shell can open it) and "Sign out", where the whole button
 * used to sign out at once. The same look as the page menu (shell.css).
 *
 * Keyboard (the menu button pattern): Enter, Space or the Down arrow opens it with the first item focused (Up: the last); Down and Up move
 * through the items and wrap, Home and End jump; Escape closes it and puts focus back on the button; Tab closes it and carries on from the
 * button. A press outside closes it. Choosing an item closes it and puts focus back on the button first, so a dialog that the item opens
 * returns focus there when it closes.
 */
export function AccountMenu({ role, name, onSignOut, onOpenProfile }: { role: ClubRole; name: string; onSignOut: () => void; onOpenProfile?: () => void }) {
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  // Which item gets the focus when the menu has just opened: the first (click, Enter, Space, Down) or the last (Up).
  const first = useRef<"first" | "last">("first");
  const menuId = useId();
  const choices = [...(onOpenProfile ? [{ label: "My profile", run: onOpenProfile }] : []), { label: "Sign out", run: onSignOut }];

  useEffect(() => {
    if (!open) return;
    const stop = (event: MouseEvent) => { if (!shell.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", stop);
    return () => document.removeEventListener("mousedown", stop);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    (first.current === "last" ? list[list.length - 1] : list[0])?.focus();
  }, [open]);

  function openMenu(start: "first" | "last") { first.current = start; setOpen(true); }
  function close() { setOpen(false); trigger.current?.focus(); }

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(event.key === "ArrowUp" ? "last" : "first"); }
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => { event.preventDefault(); list[(to + list.length) % list.length]?.focus(); };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") { trigger.current?.focus(); setOpen(false); }
  }

  function choose(run: () => void) {
    close();
    run();
  }

  const word = ROLE_WORD[role];
  return <div className="account-menu-shell" ref={shell}>
    <button ref={trigger} className="role-button" type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={`Account menu for ${name}`}
      onClick={() => (open ? setOpen(false) : openMenu("first"))} onKeyDown={onTriggerKey}>
      <span className="avatar" aria-hidden="true">{ROLE_BADGE[role]}</span><span><b>{name}</b><small>{word} · Account</small></span>
    </button>
    {open && <div className="account-menu" id={menuId} role="menu" aria-label="Account" tabIndex={-1} onKeyDown={onMenuKey}>
      {choices.map((choice, index) => <button key={choice.label} ref={(node) => { items.current[index] = node; }} type="button" role="menuitem" onClick={() => choose(choice.run)}>{choice.label}</button>)}
    </div>}
  </div>;
}
