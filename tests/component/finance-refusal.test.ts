// features/finance/refusal.ts: telling "the database said no" (an ApiError) from "could not reach it" (anything else thrown).
import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/errors";
import { answered, refusal } from "../../features/finance/refusal";

describe("answering an api call", () => {
  it("a call that went through gives its value", async () => {
    expect(await answered(Promise.resolve(7))).toEqual({ ok: true, value: 7 });
    expect(await refusal(Promise.resolve(undefined))).toBeNull();
  });

  it("a refusal (an ApiError) is handed back, not thrown", async () => {
    const error = new ApiError("Already paid", { code: "P0001" });
    expect(await answered(Promise.reject(error))).toEqual({ ok: false, error });
    expect(await refusal(Promise.reject(error))).toBe(error);
  });

  it("a call that rejects with anything else still throws (no network is not a refusal)", async () => {
    await expect(answered(Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow("Failed to fetch");
    await expect(refusal(Promise.reject("boom"))).rejects.toBe("boom");
  });
});
