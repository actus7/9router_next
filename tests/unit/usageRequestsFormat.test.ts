import { describe, expect, it } from "vitest";
import {
  buildRequestsQuery,
  formatClock,
  formatCostCell,
  formatShortDate,
  hasActiveFilters,
  modelJump,
  normalizeRequestDetail,
  totalTokens,
} from "@/app/(dashboard)/dashboard/usage/components/requests/requestFormat";
import { EMPTY_FILTERS } from "@/app/(dashboard)/dashboard/usage/components/requests/types";

const local = new Date(2026, 8, 7, 14, 32, 8).toISOString();

describe("request list formatters", () => {
  it("renders the compact clock and short date in local time", () => {
    expect(formatClock(local)).toBe("14:32:08");
    expect(formatShortDate(local)).toBe("07/09");
  });

  it("falls back to an em dash on missing or invalid timestamps", () => {
    expect(formatClock(undefined)).toBe("—");
    expect(formatShortDate("not-a-date")).toBe("—");
  });

  it("shows sub-cent costs with six decimals and the full value on hover", () => {
    const cell = formatCostCell(0.0000421234567);
    expect(cell.text).toBe("$0.000042");
    expect(cell.title).toBe("$0.0000421234567");
  });

  it("formats bigger costs with two decimals and shows nothing for null", () => {
    expect(formatCostCell(0.5)).toEqual({ text: "$0.50" });
    expect(formatCostCell(1.25)).toEqual({ text: "$1.25" });
    expect(formatCostCell(null)).toEqual({ text: "—" });
    expect(formatCostCell(undefined)).toEqual({ text: "—" });
  });

  it("totals prompt and completion tokens, null when neither is known", () => {
    expect(totalTokens({ id: 1, timestamp: local, promptTokens: 2, completionTokens: 3 })).toBe(5);
    expect(totalTokens({ id: 1, timestamp: local, promptTokens: 2 })).toBe(2);
    expect(totalTokens({ id: 1, timestamp: local })).toBeNull();
  });
});

describe("model jumps", () => {
  it("reports a jump only when selected differs from requested", () => {
    expect(modelJump({ requested: "a", selected: "a" })).toBeNull();
    expect(modelJump({ selected: "b" })).toBeNull();
    expect(modelJump(undefined)).toBeNull();
    expect(modelJump({ requested: "a", selected: "b" })).toEqual({ from: "a", to: "b" });
  });
});

describe("requests query", () => {
  it("always asks for paging and the filter options", () => {
    expect(buildRequestsQuery(EMPTY_FILTERS, 2, 20)).toBe("page=2&pageSize=20&includeFilterOptions=1");
  });

  it("sends only the active filters, per the fixed contract", () => {
    const query = buildRequestsQuery(
      { status: "failed", model: "m1", provider: "openai", apiKey: "", range: "7d", fallback: true, hasFailed: true },
      1,
      50,
    );
    expect(query).toBe(
      "page=1&pageSize=50&includeFilterOptions=1&status=failed&model=m1&provider=openai&range=7d&fallback=true&hasFailed=true",
    );
  });

  it("knows when a filter is active", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, hasFailed: true })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, range: "24h" })).toBe(true);
  });
});

describe("request detail normalization", () => {
  const detail = { id: "d1", timestamp: local, model: "m", provider: "p" };

  it("accepts a bare record, { detail } and { details: [...] }", () => {
    expect(normalizeRequestDetail(detail)).toBe(detail);
    expect(normalizeRequestDetail({ detail })).toBe(detail);
    expect(normalizeRequestDetail({ details: [detail] })).toBe(detail);
  });

  it("returns null when no body was recorded", () => {
    expect(normalizeRequestDetail(null)).toBeNull();
    expect(normalizeRequestDetail({})).toBeNull();
    expect(normalizeRequestDetail({ details: [] })).toBeNull();
  });
});
