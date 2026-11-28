"use client";

import { PageTitle } from "../../../components/ui/page-title";
import { SignupRequestsPanel } from "./signup-requests-panel";

/** The Sign-up requests screen for executives (administrators have the same list on the Admin page). */
export function SignupRequestsPage({ onCount }: { onCount?: (waiting: number) => void }) {
  return <section className="section-shell page-section">
    <PageTitle eyebrow="MEMBERSHIP" title="Sign-up requests" text="Approve the people who sign in for the first time, or decline them." />
    <SignupRequestsPanel onCount={onCount} />
  </section>;
}
