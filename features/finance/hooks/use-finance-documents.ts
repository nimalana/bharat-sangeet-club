"use client";

// Putting a document into the private finance bucket and opening one from it.
import { useCallback } from "react";
import { createFinanceDocumentUrl, financeAvailable, uploadFinanceDocument, type DocumentLinks, type FinanceDocument } from "../../../lib/api/finance";
import { prepareFinanceUpload } from "../../../lib/finance-upload";
import { useToast } from "../../../components/ui/toast";
import { answered } from "../refusal";

export function useFinanceDocuments({ userId, documentById }: { userId: string; documentById: Map<number, FinanceDocument> }) {
  const { notify } = useToast();

  /**
   * Checks the file, stores it, registers it and links it (one call: register_finance_document), and answers the document's id. It THROWS an
   * Error whose message is what the person reads (after "Request saved; ..."): a file that fails the checks, or the database's own sentence
   * when the registration is refused.
   */
  const uploadDocument = useCallback(async (file: File, documentType: string, title: string, links: DocumentLinks, last4?: string) => {
    if (!financeAvailable()) throw new Error("Finance storage is unavailable");
    const { mimeType, storagePath } = prepareFinanceUpload(file, documentType, userId);
    return uploadFinanceDocument({ file, storagePath, mimeType, documentType, title, cardLast4: last4 || null, links });
  }, [userId]);

  // Opens a stored document in a new tab through a link that lasts 90 seconds.
  const openDocument = useCallback(async (documentId: number) => {
    if (!financeAvailable()) return;
    const document = documentById.get(documentId);
    if (!document) return;
    const link = await answered(createFinanceDocumentUrl(document.storage_path));
    if (!link.ok) notify("This finance document could not be opened", "error");
    else window.open(link.value, "_blank", "noopener,noreferrer");
  }, [documentById, notify]);

  return { uploadDocument, openDocument };
}
