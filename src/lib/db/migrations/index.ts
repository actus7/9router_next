// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial";
import m002 from "./002-smart-routing";
import m003 from "./003-harness-conversations";

interface Migration {
  version: number;
  name: string;
  up(db: unknown): void;
}

export const MIGRATIONS: Migration[] = [m001 as Migration, m002 as Migration, m003 as Migration].sort((a: Migration, b: Migration) => a.version - b.version);

export function latestVersion(): number {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
