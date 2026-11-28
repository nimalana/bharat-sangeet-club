"use client";

import type { ClubRole } from "../../../lib/db";
import type { Section } from "../../../lib/sections";
import { PortalPageMenu } from "./portal-page-menu";

/** The top bar of the signed-in portal: the club mark (back to the overview), the page menu and the account button (sign out). */
export function PortalHeader({ section, role, name, onNavigate, onSignOut }: { section: Section; role: ClubRole; name: string; onNavigate: (section: Section) => void; onSignOut: () => void }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("home")} aria-label="Bharat Sangeet at UNC Chapel Hill home"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><span><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></span></button>
      <PortalPageMenu section={section} role={role} onNavigate={onNavigate} />
      <div className="account"><button className="role-button" onClick={onSignOut} title="Sign out"><span className="avatar">{role === "admin" ? "AD" : role === "executive" ? "EX" : "MB"}</span><span><b>{name}</b><small>{role === "admin" ? "Admin · Sign out" : role === "executive" ? "Executive · Sign out" : "Member · Sign out"}</small></span></button></div>
    </header>
  );
}
