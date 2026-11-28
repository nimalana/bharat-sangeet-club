"use client";

import { Button } from "../../../components/ui/button";

// What a person sees who signed in but is not a member yet. Neither screen asks the database for anything: the shell
// learned the status from get_portal_bootstrap, and until an executive approves the sign-up every other request would be refused.

/** A new sign-up waits here until a club executive approves it. "Check again" asks get_portal_bootstrap once more. */
export function PendingScreen({ onCheckAgain, onSignOut }: { onCheckAgain: () => void; onSignOut: () => void }) {
  return <main className="loading-screen">
    <h2>Welcome to Bharat Sangeet</h2>
    <p>Your sign-up is waiting for approval by a club executive.</p>
    <p>You can open the member portal as soon as it is approved. Check again after an executive has told you it is done.</p>
    <div className="flex flex-wrap justify-center gap-2"><Button onClick={onCheckAgain}>Check again</Button><Button variant="secondary" onClick={onSignOut}>Sign out</Button></div>
  </main>;
}

/** A sign-up an executive declined. It can be approved again later, so nothing here is final for the person either. */
export function RejectedScreen({ onSignOut }: { onSignOut: () => void }) {
  return <main className="loading-screen">
    <h2>Your sign-up was not approved</h2>
    <p>A club executive did not approve this sign-up, so this account cannot open the member portal. If you think this is a mistake, contact a club executive.</p>
    <Button variant="secondary" onClick={onSignOut}>Sign out</Button>
  </main>;
}
