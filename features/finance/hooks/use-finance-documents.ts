"use client";

// Putting a document into the private finance bucket and getting the link to show one from it.
import { useCallback } from "react";
import { createFinanceDocumentUrl, financeAvailable, uploadFinanceDocument, type DocumentLinks, type FinanceDocument } from "../../../lib/api/finance";
import type { UploadProgress } from "../../../lib/api/_core";
import { prepareFinanceUpload } from "../../../lib/finance-upload";
import type { PreviewFile } from "../../../components/ui/preview-dialog";

export function useFinanceDocuments({ userId, documentById }: { userId: string; documentById: Map<number, FinanceDocument> }) {
  /**
   * Checks the file, stores it, registers it and links it (one call: register_finance_document), and answers the document's id. It THROWS an
   * Error whose message is what the person reads (after "Request saved; ..."): a file that fails the checks, or the database's own sentence
   * when the registration is refused. `onProgress` hears the bytes of the file as they go up.
   */
  const uploadDocument = useCallback(async (file: File, documentType: string, title: string, links: DocumentLinks, last4?: string, onProgress?: (progress: UploadProgress) => void) => {
    if (!financeAvailable()) throw new Error("Finance storage is unavailable");
    const { mimeType, storagePath } = prepareFinanceUpload(file, documentType, userId);
    return uploadFinanceDocument({ file, storagePath, mimeType, documentType, title, cardLast4: last4 || null, links }, onProgress);
  }, [userId]);

  // What a preview needs to show a stored document: a link that lasts 90 seconds (made when the preview opens, and again on Try again, so an
  // old link is never shown), the type the checks stored it with, and its title. A failure is thrown for the preview to word.
  const loadPreview = useCallback(async (documentId: number): Promise<PreviewFile> => {
    if (!financeAvailable()) throw new Error("Finance storage is unavailable");
    const document = documentById.get(documentId);
    if (!document) throw new Error("This document could not be found. Refresh the page and try again.");
    const url = await createFinanceDocumentUrl(document.storage_path);
    return { url, mime: document.mime_type ?? "", name: document.title };
  }, [documentById]);

  return { uploadDocument, loadPreview };
}
