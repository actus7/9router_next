import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/config";
import { getLocaleFlagSrc, getLocaleName } from "@/shared/constants/locales";

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

  /**
   * The runtime strip in src/i18n/server.ts stays as defence, but it should
   * never have anything to strip. Tolerating the BOM in the test as well left
   * the repository holding 34 files that only work because of a workaround —
   * so the next file added by hand reintroduces the bug and nothing fails.
   */
  it.each(files)("%s carries no UTF-8 BOM", (name) => {
    const bytes = readFileSync(join(literalsDir, name));
    expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it.each(files)("%s parses the way the server reads it", (name) => {
    const raw = readFileSync(join(literalsDir, name), "utf-8");
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    expect(parsed).toBeTypeOf("object");
    expect(Object.keys(parsed as Record<string, string>).length).toBeGreaterThan(0);
  });
});

/**
 * Flags are files, not emoji: Windows has no glyph for the regional-indicator
 * pairs, so Chrome and Edge there render \uD83C\uDDE7\uD83C\uDDF7 as the letters "BR". A locale whose
 * SVG is missing shows a broken image in the header, which nothing else catches.
 */
describe("locale flags", () => {
  it.each(LOCALES)("%s has a flag file and a display name", (locale) => {
    const src = getLocaleFlagSrc(locale);
    expect(src).not.toBeNull();
    expect(existsSync(join(process.cwd(), "public", src!))).toBe(true);
    expect(getLocaleName(locale)).not.toBe(locale);
  });
});
