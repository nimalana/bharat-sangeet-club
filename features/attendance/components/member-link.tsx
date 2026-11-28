"use client";

import type { SummaryMember } from "./member-summary-dialog";

// A member's name in a roster or a list: a button that opens their attendance summary when the screen can show one (an executive's),
// else the plain name as it always was. The name stays in the <b> so the line looks as it did; the button's name says what it opens
// and contains the visible name.
export function MemberLink({ member, onSummary }: { member: SummaryMember; onSummary?: (member: SummaryMember) => void }) {
  if (!onSummary) return <b>{member.name}</b>;
  return <button type="button" className="attendance-member-link" aria-label={`Attendance summary for ${member.name}`} onClick={() => onSummary(member)}><b>{member.name}</b></button>;
}
