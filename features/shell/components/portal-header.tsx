"use client";

import type { ClubRole } from "../../../lib/db";
import type { Section } from "../../../lib/sections";
import { AccountMenu } from "./account-menu";
import { PortalPageMenu } from "./portal-page-menu";

/** The top bar of the signed-in portal: the club mark (back to the overview), the page menu and the account menu (My profile, Sign out). */
export function PortalHeader({ section, role, name, pendingSignups = 0, onNavigate, onSignOut, onOpenProfile }: { section: Section; role: ClubRole; name: string; pendingSignups?: number; onNavigate: (section: Section) => void; onSignOut: () => void; onOpenProfile?: () => void }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("home")} aria-label="Bharat Sangeet at UNC Chapel Hill home"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><span><b>Bharat Sangeet</b><small>UNC Chapel Hill</small></span></button>
      <PortalPageMenu section={section} role={role} pendingSignups={pendingSignups} onNavigate={onNavigate} />
      <div className="account"><AccountMenu role={role} name={name} onSignOut={onSignOut} onOpenProfile={onOpenProfile} /></div>
    </header>
  );
}
