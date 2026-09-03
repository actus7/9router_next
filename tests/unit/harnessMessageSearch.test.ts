import { describe, expect, it } from "vitest";
import { searchPastSessionMessages } from "@/lib/db/repos/harnessMessageIndexRepo";

describe("searchPastSessionMessages", () => {
  it("returns empty for blank query", async () => {
    await expect(searchPastSessionMessages({ query: "  " })).resolves.toEqual([]);
  });
});
