// What a finance upload must pass before anything is sent, and where its file is stored. Pure: no Supabase, no React.
//
// The sentences are the ones the person reads (the screen shows `error.message` after "Request saved; ..."), so they are
// written here once and not reworded. The order of the checks is the order the person meets them.

export const MAX_FINANCE_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type PreparedUpload = { mimeType: string; storagePath: string };

/**
 * Checks a file chosen for the finance bucket and says what to send: its type (the browser's, or application/pdf for a
 * name ending .pdf, or application/octet-stream) and the path it is stored under: `<user id>/<random id>-<safe name>`.
 * Throws an Error with the sentence to show when the file is empty, over 10 MB, or a statement that is not a PDF.
 * The random id is taken only after the file has passed, as it always was.
 */
export function prepareFinanceUpload(file: File, documentType: string, userId: string): PreparedUpload {
  if (!file.size) throw new Error("Choose a document to upload");
  if (file.size > MAX_FINANCE_DOCUMENT_BYTES) throw new Error("Finance documents must be 10 MB or smaller");
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
  if (["bank_statement", "card_statement"].includes(documentType) && mimeType !== "application/pdf") {
    throw new Error("Statements must be uploaded as PDF documents, not screenshots");
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  return { mimeType, storagePath: `${userId}/${crypto.randomUUID()}-${safeName}` };
}
