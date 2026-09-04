// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial";
import m002 from "./002-smart-routing";
import m003 from "./003-harness-conversations";
import m004 from "./004-model-availability";
import m005 from "./005-harness-message-fts";
import m006 from "./006-agent-skill-files";
import m007 from "./007-harness-pending-decisions";
import m008 from "./008-connection-test-status";

interface Migration {
  version: number;
  name: string;
  up(db: unknown): void;
}

export const MIGRATIONS: Migration[] = [m001 as Migration, m002 as Migration, m003 as Migration, m004 as Migration, m005 as Migration, m006 as Migration, m007 as Migration, m008 as Migration].sort((a: Migration, b: Migration) => a.version - b.version);

export function latestVersion(): number {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
