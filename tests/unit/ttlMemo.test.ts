import { describe, expect, it } from "vitest";
import { TtlMemo } from "@/lib/ttlMemo";

describe("TtlMemo", () => {
  it("does not store a value read before an invalidation that landed while it was in flight", () => {
    const memo = new TtlMemo<string>(1_000);

    const generation = memo.generation; // the reader starts its SELECT here
    memo.delete("k"); // a write commits and invalidates meanwhile
    memo.set("k", "stale", generation); // the reader finishes with the old row

    expect(memo.get("k")).toBeUndefined();
  });

  it("stores the value when nothing was invalidated meanwhile", () => {
    const memo = new TtlMemo<string>(1_000);

    memo.set("k", "fresh", memo.generation);

    expect(memo.get("k")).toBe("fresh");
  });

  it("treats clear() as an invalidation too", () => {
    const memo = new TtlMemo<string>(1_000);

    const generation = memo.generation;
    memo.clear();
    memo.set("k", "stale", generation);

    expect(memo.get("k")).toBeUndefined();
  });

  it("keeps the old unconditional set working", () => {
    const memo = new TtlMemo<string>(1_000);

    memo.set("k", "v");

    expect(memo.get("k")).toBe("v");
  });
});
