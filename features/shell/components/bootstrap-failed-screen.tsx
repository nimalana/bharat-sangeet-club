"use client";

import { Button } from "../../../components/ui/button";

export function BootstrapFailedScreen({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return <main className="loading-screen" role="alert">
    <h2>We could not load your club profile</h2>
    <p>Check your connection and try again. Nothing has been changed.</p>
    <div className="flex flex-wrap justify-center gap-2"><Button onClick={onRetry}>Try again</Button><Button variant="secondary" onClick={onSignOut}>Sign out</Button></div>
  </main>;
}
