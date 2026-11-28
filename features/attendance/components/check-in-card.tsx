"use client";

import type { FormEvent } from "react";
import { Button } from "../../../components/ui/button";

// Every signed-in person can check in: type the code an executive shows while check-in is open.
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
  return <form className="attendance-checkin" onSubmit={onSubmit}><div><p className="eyebrow">MEMBER CHECK-IN</p><h2>Enter the meeting code</h2><p>Use the code shown by an executive while check-in is open.</p></div><div><input value={code} onChange={(event) => onCodeChange(event.target.value)} required minLength={6} maxLength={8} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="Attendance code" /><Button type="submit" disabled={saving} pending={pending} className="shrink-0 bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--carolina-pale)]">{pending ? "Checking…" : "Check in"}</Button></div>{feedback && <p className={`attendance-feedback ${feedback.includes("confirmed") ? "success" : "error"}`} role="status">{feedback}</p>}</form>;
}
