// What an open attendance dialog is asking about, and what each one shows. Nothing is sent until its form is submitted.
// Pure, so the wording of every dialog can be checked under `node --test`.

// Type-only imports: this file is loaded by node's test runner, so it imports nothing at run time.
import type { AttendanceStatus, EligibilityStatus } from "../../lib/db";
import type { FormField } from "../../components/ui/form-dialog";
import type { Excuse, Remediation } from "./model";

export type ActionDialog =
  | { kind: "status"; sessionId: number; memberId: string; memberName: string; status: AttendanceStatus }
  | { kind: "review"; excuse: Excuse; memberName: string; decision: "approved" | "denied" }
  | { kind: "remediation"; item: Remediation; memberName: string }
  | { kind: "eligibility"; memberId: string; memberName: string; status: EligibilityStatus }
  | { kind: "session"; sessionId: number; title: string; action: "close" | "cancel" };
export type FormAction = Exclude<ActionDialog, { kind: "session" }>;

export function formConfig(dialog: FormAction): { title: string; description?: string; fields: FormField[]; submitLabel: string; danger?: boolean } {
  if (dialog.kind === "status") {
    const note: FormField = { name: "note", label: "Correction note (optional)", type: "textarea", maxLength: 500 };
    return {
      title: `Mark ${dialog.memberName} ${dialog.status}`,
      fields: dialog.status === "tardy"
        ? [{ name: "minutes", label: "Minutes late", type: "number", defaultValue: "10", required: true, min: 0, max: 1440, step: 1 }, note]
        : [note],
      submitLabel: "Save mark",
    };
  }
  if (dialog.kind === "review") {
    return dialog.decision === "approved"
      ? { title: "Approve this absence form?", description: `${dialog.memberName} will be marked excused for this meeting.`, fields: [{ name: "note", label: "Approval note (optional)", type: "textarea", maxLength: 500 }], submitLabel: "Approve" }
      : { title: "Deny this absence form?", description: `${dialog.memberName} will be marked absent for this meeting.`, fields: [{ name: "note", label: "Why is this being denied?", type: "textarea", required: true, minLength: 3, maxLength: 500 }], submitLabel: "Deny form", danger: true };
  }
  if (dialog.kind === "remediation") {
    return { title: "Complete this follow-up?", description: dialog.memberName, fields: [{ name: "assignment", label: "Remediation instruction", type: "textarea", defaultValue: dialog.item.assignment, required: true, maxLength: 500 }], submitLabel: "Mark complete" };
  }
  return dialog.status === "restricted"
    ? { title: `Restrict ${dialog.memberName}?`, description: "They will not be eligible to perform this term.", fields: [{ name: "reason", label: "Reason for restricting performance eligibility", type: "textarea", required: true, minLength: 3, maxLength: 500 }], submitLabel: "Restrict", danger: true }
    : { title: dialog.status === "reinstated" ? `Reinstate ${dialog.memberName}?` : `Put ${dialog.memberName} under review?`, fields: [{ name: "reason", label: "Eligibility note (optional)", type: "textarea", maxLength: 500 }], submitLabel: dialog.status === "reinstated" ? "Reinstate" : "Mark under review" };
}
