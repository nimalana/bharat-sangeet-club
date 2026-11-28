// lib/api/settle.ts: a read handled on its own next to others. A failed read becomes { data: null, error } and a good one
// { data, error: null }, so Promise.all of several reads answers all of them; anything that is not a database answer is thrown on.
import { describe, expect, it } from "vitest";
import { settle } from "../../lib/api/settle";
import { ApiError } from "../../lib/errors";
import { listOrKeep } from "../../lib/refresh";

describe("settle", () => {
  it("a good read is { data, error: null }, null and empty lists included", async () => {
    expect(await settle(Promise.resolve([{ id: 1 }]))).toEqual({ data: [{ id: 1 }], error: null });
    expect(await settle(Promise.resolve([]))).toEqual({ data: [], error: null });
    expect(await settle(Promise.resolve(null))).toEqual({ data: null, error: null });
  });

  it("a read that throws an ApiError is { data: null, error }, the same error", async () => {
    const error = new ApiError("Only executives can do that", { code: "P0001" });
    expect(await settle(Promise.reject(error))).toEqual({ data: null, error });
    expect((await settle(Promise.reject(error))).error).toBe(error);
  });

  it("anything that is not an ApiError is thrown on, as an unexpected failure must be", async () => {
    const bug = new TypeError("x is not a function");
    await expect(settle(Promise.reject(bug))).rejects.toBe(bug);
  });

  it("answers every read of a batch, so one failure does not hide the others", async () => {
    const [good, bad] = await Promise.all([settle(Promise.resolve(["a"])), settle<string[]>(Promise.reject(new ApiError("boom")))]);
    expect(good.data).toEqual(["a"]);
    expect(bad.error?.message).toBe("boom");
  });

  it("its answer is what listOrKeep reads: a failed list keeps what is shown", async () => {
    const shown = [{ id: 1 }];
    expect(listOrKeep(shown, await settle(Promise.reject(new ApiError("boom"))))).toBe(shown);
    expect(listOrKeep(shown, await settle(Promise.resolve([{ id: 2 }])))).toEqual([{ id: 2 }]);
  });
});
