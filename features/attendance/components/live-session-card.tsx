"use client";

import { Button } from "../../../components/ui/button";
import type { AttendanceSession } from "../model";

// The meeting whose check-in is open: how many have checked in, the code to share (shown only on the device that opened or
// rotated it) and the three things an executive can do with it.
export function LiveSessionCard({ session, liveCode, saving, rotating = false, onRotate, onClose, onCancel }: {
  session: AttendanceSession;
  liveCode: string;
  /** Some write is running (the three buttons are off). */
  saving: boolean;
  /** The code is being rotated (that button is busy). */
  rotating?: boolean;
  onRotate: () => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  return <div className="attendance-live"><div><p className="eyebrow">LIVE NOW</p><h2>{session.title}</h2><p>{session.live?.checked_in_count ?? 0} of {session.live?.roster_count ?? 0} checked in</p></div><div className="attendance-live-code"><small>CHECK-IN CODE</small><strong>{liveCode || "Hidden after reload"}</strong><span>{liveCode ? "Share this with members" : "Rotate the code to display a new one"}</span></div><div className="attendance-live-actions"><Button variant="secondary" onClick={() => onRotate()} disabled={saving} pending={rotating}>Rotate code</Button><Button onClick={onClose} disabled={saving}>Close attendance</Button><Button variant="danger" onClick={onCancel} disabled={saving}>Cancel meeting</Button></div></div>;
}
