import { describe, it, expect } from "vitest";
import { toPositionalParams, remapRow } from "@/lib/db/adapters/postgresAdapter";

describe("toPositionalParams", () => {
  it("numbers placeholders left to right", () => {
    expect(toPositionalParams(`SELECT * FROM apiKeys WHERE id = ? AND sink = ?`))
      .toBe(`SELECT * FROM apiKeys WHERE id = $1 AND sink = $2`);
  });

  it("leaves SQL without placeholders untouched", () => {
    const sql = `SELECT COUNT(*) as c FROM _meta`;
    expect(toPositionalParams(sql)).toBe(sql);
  });

  it("does not renumber a question mark inside a string literal", () => {
    expect(toPositionalParams(`UPDATE kv SET value = 'why?' WHERE key = ?`))
      .toBe(`UPDATE kv SET value = 'why?' WHERE key = $1`);
  });

  it("keeps counting after a doubled quote inside a literal", () => {
    expect(toPositionalParams(`SELECT 'it''s ?' , ? FROM kv WHERE key = ?`))
      .toBe(`SELECT 'it''s ?' , $1 FROM kv WHERE key = $2`);
  });

  it("ignores a question mark in a line comment", () => {
    expect(toPositionalParams(`SELECT 1 -- really?\nWHERE id = ?`))
      .toBe(`SELECT 1 -- really?\nWHERE id = $1`);
  });

  it("leaves quoted identifiers alone", () => {
    expect(toPositionalParams(`SELECT "weird?col" FROM kv WHERE key = ?`))
      .toBe(`SELECT "weird?col" FROM kv WHERE key = $1`);
  });
});

describe("remapRow", () => {
  it("restores camelCase on columns Postgres folded to lowercase", () => {
    expect(remapRow({ id: "k1", machineid: "m1", isactive: 1, createdat: "2026-01-01" }))
      .toEqual({ id: "k1", machineId: "m1", isActive: 1, createdAt: "2026-01-01" });
  });

  it("returns the same object when nothing needs remapping", () => {
    const row = { id: "k1", key: "sk-1", name: "n" };
    expect(remapRow(row)).toBe(row);
  });

  it("leaves aggregate aliases that are not columns alone", () => {
    expect(remapRow({ c: 3, count: 7 })).toEqual({ c: 3, count: 7 });
  });

  it("restores the one camelCase SQL alias in the codebase", () => {
    expect(remapRow({ nextseq: 4 })).toEqual({ nextSeq: 4 });
  });
});
