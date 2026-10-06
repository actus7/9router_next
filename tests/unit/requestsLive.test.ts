import { describe, expect, it } from "vitest";
import { findNewRequestIds, shouldPollRequests } from "@/app/(dashboard)/dashboard/usage/components/requests/requestLive";

describe("findNewRequestIds", () => {
  it("returns nothing on the first load so the whole list does not flash", () => {
    expect(findNewRequestIds(null, [{ id: 5 }, { id: 4 }]).size).toBe(0);
  });

  it("returns only ids above the last seen id", () => {
    const ids = findNewRequestIds(4, [{ id: 7 }, { id: 6 }, { id: 4 }, { id: 3 }]);
    expect([...ids].sort()).toEqual([6, 7]);
  });

  it("returns nothing when no row is newer", () => {
    expect(findNewRequestIds(9, [{ id: 9 }, { id: 8 }]).size).toBe(0);
  });
});

describe("shouldPollRequests", () => {
  const base = { live: true, page: 1, drawerOpen: false };

  it("polls on page 1 with live on and no drawer", () => {
    expect(shouldPollRequests(base)).toBe(true);
  });

  it.each([
    { ...base, live: false },
    { ...base, page: 2 },
    { ...base, drawerOpen: true },
  ])("does not poll when %o", (state) => {
    expect(shouldPollRequests(state)).toBe(false);
  });
});
