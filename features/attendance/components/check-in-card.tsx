"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";

// Every signed-in person can check in: type the code an executive shows while check-in is open.
//
// For a keyboard and a screen reader: the box has a label of its own (the visible heading cannot be one), says what it wants (a code of
// digits, so a phone shows the number pad) and points at the sentence under the heading; the answer ("You are checked in" or the
// database's refusal) is spoken from a live region that is in the page before there is anything to say, and a refusal marks the box
// invalid. The region wears the visible look only while it has a message, so the card has no empty strip.
export function CheckInCard({ code, onCodeChange, saving, pending = saving, feedback, onSubmit }: {
  code: string;
  onCodeChange: (value: string) => void;
  /** Some write is running (this button is off). */
  saving: boolean;
  /** THIS check-in is the write that is running (the button says so and is busy). Default: any write. */
  pending?: boolean;
  feedback: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const wasSaving = useRef(false);
  // A button that turns itself off while its request runs can drop the focus in some browsers: the keyboard user who pressed it would
  // be back at the top of the page. When that happened, the focus goes to the box, where a refused code is fixed.
  useEffect(() => {
    if (wasSaving.current && !saving && (!document.activeElement || document.activeElement === document.body)) input.current?.focus();
    wasSaving.current = saving;
  }, [saving]);
  const confirmed = feedback.includes("confirmed");
  return <form className="attendance-checkin" onSubmit={onSubmit}>
    <div><p className="eyebrow">MEMBER CHECK-IN</p><h2>Enter the meeting code</h2><p id="attendance-code-help">Use the code shown by an executive while check-in is open.</p></div>
    <div>
      <label htmlFor="attendance-code" className="sr-only">Attendance code</label>
      <input id="attendance-code" ref={input} value={code} onChange={(event) => onCodeChange(event.target.value)} required minLength={6} maxLength={8} inputMode="numeric" enterKeyHint="go" autoComplete="one-time-code" placeholder="000000" aria-describedby="attendance-code-help attendance-code-result" aria-invalid={feedback && !confirmed ? true : undefined} />
      <Button type="submit" disabled={saving} pending={pending} className="shrink-0 bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--carolina-pale)]">{pending ? "Checking…" : "Check in"}</Button>
    </div>
    <p id="attendance-code-result" role="status" className={feedback ? `attendance-feedback ${confirmed ? "success" : "error"}` : "sr-only"}>{feedback}</p>
  </form>;
}
