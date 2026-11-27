"use client";

import { useEffect } from "react";
import { Button } from "../components/ui/button";
import { isChunkLoadError } from "../lib/chunk-errors";

// The last line of defence: anything the portal's own boundaries do not catch
// lands here instead of a blank page.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("The portal failed", error); }, [error]);
  const stale = isChunkLoadError(error);
  return <main className="loading-screen" role="alert">
    <img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="Bharat Sangeet" />
    <h2>{stale ? "The portal was updated" : "Something went wrong"}</h2>
    <p>{stale ? "Reload to get the latest version." : "Nothing has been changed. Try again, or reload the page."}</p>
    <Button onClick={() => (stale ? window.location.reload() : reset())}>{stale ? "Reload the page" : "Try again"}</Button>
  </main>;
}
