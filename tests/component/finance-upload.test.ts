// lib/finance-upload.ts: the checks a finance upload passes before anything is sent, and the path its file is stored under.
// The sentences are what the person reads after "Request saved; ", so each is pinned word for word.
import { describe, expect, it, vi } from "vitest";
import { MAX_FINANCE_DOCUMENT_BYTES, prepareFinanceUpload } from "../../lib/finance-upload";

const file = (size: number, name: string, type: string) => new File([new Uint8Array(size)], name, { type });

describe("finance uploads: what is refused, in the order the person meets it", () => {
  it("an empty file", () => {
    expect(() => prepareFinanceUpload(file(0, "a.pdf", "application/pdf"), "receipt", "u1")).toThrow(new Error("Choose a document to upload"));
  });

  it("a file over 10 MB (exactly 10 MB is fine)", () => {
    expect(MAX_FINANCE_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
    expect(() => prepareFinanceUpload(file(MAX_FINANCE_DOCUMENT_BYTES + 1, "a.pdf", "application/pdf"), "receipt", "u1")).toThrow(new Error("Finance documents must be 10 MB or smaller"));
    expect(prepareFinanceUpload(file(MAX_FINANCE_DOCUMENT_BYTES, "a.pdf", "application/pdf"), "receipt", "u1").mimeType).toBe("application/pdf");
  });

  it("a bank or card statement that is not a PDF, but a receipt may be a picture", () => {
    for (const kind of ["bank_statement", "card_statement"]) {
      expect(() => prepareFinanceUpload(file(5, "scan.png", "image/png"), kind, "u1")).toThrow(new Error("Statements must be uploaded as PDF documents, not screenshots"));
      expect(prepareFinanceUpload(file(5, "s.pdf", "application/pdf"), kind, "u1").mimeType).toBe("application/pdf");
    }
    expect(prepareFinanceUpload(file(5, "scan.png", "image/png"), "receipt", "u1").mimeType).toBe("image/png");
  });

  it("the size is checked before the type", () => {
    expect(() => prepareFinanceUpload(file(MAX_FINANCE_DOCUMENT_BYTES + 1, "scan.png", "image/png"), "bank_statement", "u1")).toThrow("10 MB or smaller");
  });

  it("a refused file takes no random id", () => {
    const random = vi.spyOn(crypto, "randomUUID");
    expect(() => prepareFinanceUpload(file(0, "a.pdf", "application/pdf"), "receipt", "u1")).toThrow();
    expect(random).not.toHaveBeenCalled();
  });
});

describe("finance uploads: the type and the path", () => {
  it("a file the browser gave no type for is a PDF when its name ends .pdf (any case), otherwise a plain download", () => {
    expect(prepareFinanceUpload(file(5, "Statement.PDF", ""), "bank_statement", "u1").mimeType).toBe("application/pdf");
    expect(prepareFinanceUpload(file(5, "notes.txt", ""), "receipt", "u1").mimeType).toBe("application/octet-stream");
    expect(() => prepareFinanceUpload(file(5, "notes.txt", ""), "card_statement", "u1")).toThrow("Statements must be uploaded as PDF");
  });

  it("the file is stored under the person's id, a random id and the name with anything unusual replaced by a dash", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-2222-3333-4444-555555555555");
    expect(prepareFinanceUpload(file(5, "taxi receipt (1).pdf", "application/pdf"), "receipt", "member-9").storagePath).toBe("member-9/11111111-2222-3333-4444-555555555555-taxi-receipt--1-.pdf");
    expect(prepareFinanceUpload(file(5, "a_b-c.d.pdf", "application/pdf"), "receipt", "u").storagePath).toBe("u/11111111-2222-3333-4444-555555555555-a_b-c.d.pdf");
  });
});
