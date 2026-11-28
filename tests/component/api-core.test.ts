// must() and safeFileName() in lib/api/_core.ts: the one place a Supabase answer becomes its data or an ApiError, and the one rule for a
// file's name inside a storage path (recordings, attendance proofs and finance documents all use it).
// (Here and not under node --test because _core.ts imports ../errors without an extension, as the app's code does.)
import { describe, expect, it } from "vitest";
import { must, safeFileName } from "../../lib/api/_core";
import { ApiError } from "../../lib/errors";

const postgrest = (fields: { message: string; code?: string; details?: string; hint?: string }) =>
  Object.assign(new Error(fields.message), { name: "PostgrestError", details: "", hint: "", code: "", ...fields });

const ok = <T,>(data: T, extra: Record<string, unknown> = {}) => ({ data, error: null, status: 200, statusText: "OK", ...extra }) as never;
const failed = (error: unknown, status = 400, data: unknown = null) => ({ data, error, status, statusText: "" }) as never;

describe("must", () => {
  it("returns the data of a successful answer, null and zero included", () => {
    expect(must(ok([{ id: 1 }]))).toEqual([{ id: 1 }]);
    expect(must(ok(null))).toBeNull();
    expect(must(ok(0))).toBe(0);
    expect(must(ok([], { count: 0 }))).toEqual([]);
  });

  it("throws an ApiError for an answer with an error, keeping what the answer said", () => {
    const raw = postgrest({ message: "Only administrators can change member roles", code: "P0001", details: "d", hint: "h" });
    let thrown: unknown;
    try {
      must(failed(raw, 400));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    const error = thrown as ApiError;
    expect(error.message).toBe("Only administrators can change member roles");
    expect(error.code).toBe("P0001");
    expect(error.details).toBe("d");
    expect(error.hint).toBe("h");
    expect(error.status).toBe(400);
    expect(error.cause).toBe(raw);
  });

  it("throws even when the failed answer also carries data", () => {
    expect(() => must(failed({ message: "x" }, 500, [{ id: 1 }]))).toThrow(ApiError);
  });
});

describe("safeFileName", () => {
  it("keeps letters, digits, dot, underscore and hyphen and turns every other character into a hyphen, one for one", () => {
    expect(safeFileName({ name: "Raga Bhairavi (take 2).mp3" })).toBe("Raga-Bhairavi--take-2-.mp3");
    expect(safeFileName({ name: "plain_name-1.PDF" })).toBe("plain_name-1.PDF");
    expect(safeFileName({ name: "résumé ñ 日本.png" })).toBe("r-sum------.png");
    expect(safeFileName({ name: "a/b\\c:d.txt" })).toBe("a-b-c-d.txt");
    expect(safeFileName({ name: "" })).toBe("");
  });
});
