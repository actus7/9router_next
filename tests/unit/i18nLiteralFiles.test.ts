import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/config";

const literalsDir = join(process.cwd(), "public", "i18n", "literals");

/**
 * The server loads these files with `readFile` + `JSON.parse`, while the client
 * loads them with `Response.json()`. Only the browser tolerates a UTF-8 BOM, so
 * a file the server cannot parse silently falls back to English and breaks
 * hydration on every translated attribute.
 */
describe("i18n literal files", () => {
  const files = readdirSync(literalsDir).filter((name) => name.endsWith(".json"));

  it("covers every supported locale except the default one", () => {
    const available = new Set(files.map((name) => name.replace(/\.json$/, "")));
    const missing = LOCALES.filter(
      (locale) => locale !== "en" && !available.has(locale),
    );
    expect(missing).toEqual([]);
  });

  it.each(files)("%s parses the way the server reads it", (name) => {
    const raw = readFileSync(join(literalsDir, name), "utf-8");
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    expect(parsed).toBeTypeOf("object");
    expect(Object.keys(parsed as Record<string, string>).length).toBeGreaterThan(0);
  });
});
