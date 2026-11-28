"use client";

import { useEffect, useRef, useState } from "react";
import type { ClubRole } from "../../../lib/db";
import { SECTION_LABELS, menuGroups, menuPages, type Section } from "../../../lib/sections";

export function PortalPageMenu({ section, role, onNavigate }: { section: Section; role: ClubRole; onNavigate: (section: Section) => void }) {
  const [open, setOpen] = useState(false); const shell = useRef<HTMLDivElement>(null);
  const groups = menuGroups(role);
  const pages = menuPages(role);
  useEffect(() => {
    function close(event: MouseEvent) { if (!shell.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); shell.current?.querySelector<HTMLButtonElement>(".page-menu-trigger")?.focus(); } }
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);
  function go(page: Section) { onNavigate(page); setOpen(false); }
  return <div className="portal-navigation" ref={shell}><nav className="primary-navigation" aria-label="Portal navigation">{pages.map((page) => <button className={page === section ? "active" : ""} aria-current={page === section ? "page" : undefined} key={page} onClick={() => go(page)}>{SECTION_LABELS[page]}</button>)}</nav><div className="page-menu-shell"><button className="page-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span><small>Navigate</small><b>{SECTION_LABELS[section]}</b></span><i aria-hidden="true">⌄</i></button>{open && <div className="page-menu" role="menu" aria-label="All pages">{groups.map((group) => <div className="page-menu-group" key={group.title}><p>{group.title}</p>{group.pages.map((page) => <button role="menuitem" className={page === section ? "selected" : ""} key={page} onClick={() => go(page)}><span>{SECTION_LABELS[page]}</span>{group.clubWide && <small>Club-wide</small>}{page === section && <i>✓</i>}</button>)}</div>)}<span className="menu-count">{pages.length} destinations</span></div>}</div></div>;
}
