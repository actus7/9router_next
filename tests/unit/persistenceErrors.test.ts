import { describe, expect, it } from "vitest";
import { PersistenceError, persistenceNotFound, toPersistenceError } from "@/lib/db/errors";

describe("persistence errors", () => {
  it("classifies availability and corruption failures", () => {
    expect(toPersistenceError("read", Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" })).kind).toBe("unavailable");
    expect(toPersistenceError("read", Object.assign(new Error("malformed database"), { code: "SQLITE_CORRUPT" })).kind).toBe("corruption");
    expect(toPersistenceError("read", new Error("ETIMEDOUT while reading")).kind).toBe("unavailable");
    expect(toPersistenceError("read", new Error("database is CORRUPT")).kind).toBe("corruption");
  });

  it("preserves an existing typed error", () => {
    const original = new PersistenceError("unexpected", "write", new Error("boom"));
    expect(toPersistenceError("other", original)).toBe(original);
  });

  it("models an expected absence separately from infrastructure failures", () => {
    const error = persistenceNotFound("connections.get", "connection-123");
    expect(error).toMatchObject({ kind: "not_found", operation: "connections.get" });
  });

  it("classifies unknown values as unexpected without losing their diagnostic", () => {
    expect(toPersistenceError("write", "plain failure")).toMatchObject({ kind: "unexpected", operation: "write" });
    expect(toPersistenceError("write", { code: "CUSTOM", detail: true }).kind).toBe("unexpected");
  });
});
