import { describe, it, expect } from "vitest";
import { toPositionalParams, remapRow, stripNulParams } from "@/lib/db/adapters/postgresAdapter";

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

// Postgres cannot store a NUL in text ("invalid byte sequence for encoding UTF8:
// 0x00"), and a JSON document carrying the NUL escape cannot be cast to jsonb
// ("unsupported Unicode escape sequence") — the latter would make every
// `data::jsonb` read fail for as long as the row exists.
describe("stripNulParams", () => {
  const NUL = String.fromCharCode(0);
  // The six characters backslash, u, 0, 0, 0, 0: what JSON.stringify writes for a NUL.
  const ESCAPE = "\\" + "u0000";

  it("removes a real NUL from a text parameter", () => {
    expect(stripNulParams([`a${NUL}b${NUL}`, "x"])).toEqual(["ab", "x"]);
  });

  it("removes the NUL escape from a JSON document", () => {
    expect(stripNulParams([`{"text":"a${ESCAPE}b"}`])).toEqual(['{"text":"ab"}']);
    expect(stripNulParams([`["${ESCAPE}"]`])).toEqual(['[""]']);
    // JSON.stringify is what the repos use, so prove it against the real thing.
    expect(stripNulParams([JSON.stringify({ text: `a${NUL}b` })])).toEqual(['{"text":"ab"}']);
  });

  it("keeps an escaped backslash followed by the digits (not a NUL escape)", () => {
    const doc = JSON.stringify({ path: "C:\\u0000" });
    expect(doc).toContain("\\\\u0000");
    expect(stripNulParams([doc])).toEqual([doc]);
  });

  it("leaves plain text that merely mentions the escape alone", () => {
    const text = `use ${ESCAPE} as a separator`;
    expect(stripNulParams([text])).toEqual([text]);
  });

  it("cleans strings inside array parameters and leaves other types alone", () => {
    const buffer = Buffer.from([0, 1, 2]);
    const out = stripNulParams([[`a${NUL}`, "b"], 3, null, true, buffer]);
    expect(out).toEqual([["a", "b"], 3, null, true, buffer]);
    expect(out?.[4]).toBe(buffer);
  });

  it("returns the same array when there is nothing to clean", () => {
    const params = ["a", 1];
    expect(stripNulParams(params)).toBe(params);
    expect(stripNulParams(undefined)).toBeUndefined();
  });
});
