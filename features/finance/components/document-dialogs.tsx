import type { FormEvent } from "react";
import { ModalShell } from "./modal-shell";

type UploadDialogProps = { saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void };

// A document for a funding claim: a statement, the event flyer, the funding approval, proof of payment.
export function ClaimDocumentDialog({ saving, onSubmit, onClose }: UploadDialogProps) {
  return <ModalShell title="Add claim document" eyebrow="SECURE FINANCE FILE" onClose={onClose}><form onSubmit={onSubmit}><label>Document type<select name="document_type" required><option value="bank_statement">Bank statement PDF</option><option value="card_statement">Credit card statement PDF</option><option value="event_support">Event flyer or agenda</option><option value="funding_approval">Funding approval</option><option value="heellife_submission">HeelLife submission</option><option value="proof_of_payment">Proof of payment</option><option value="other">Other supporting document</option></select></label><label>Title<input name="title" required placeholder="March bank statement" /></label><label>File<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><p className="finance-privacy-note">Statements must be PDFs. Sensitive files are stored separately from the club archive and are visible only to their uploader and executives.</p><button className="primary modal-submit" disabled={saving}>{saving ? "Uploading…" : "Add document"}</button></form></ModalShell>;
}

// A receipt added to a request that is still being reviewed.
export function ReceiptDialog({ saving, onSubmit, onClose }: UploadDialogProps) {
  return <ModalShell title="Add a receipt" eyebrow="SECURE FINANCE FILE" onClose={onClose}><form onSubmit={onSubmit}><label>Title<input name="title" required defaultValue="Receipt" /></label><label>File<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><button className="primary modal-submit" disabled={saving}>{saving ? "Uploading…" : "Add receipt"}</button></form></ModalShell>;
}
