// Initial schema bootstrap. For fresh DB this creates all tables/indexes.
// For existing DB at version 0 (legacy unstamped), it's idempotent (IF NOT EXISTS).
import { TABLES, buildCreateTableSql } from "../schema";

interface DbAdapter {
  exec(sql: string): void;
}

interface Migration {
  version: number;
  name: string;
  up(db: DbAdapter): void;
}

export default {
  version: 1,
  name: "initial",
  up(db: DbAdapter): void {
    for (const [name, def] of Object.entries(TABLES)) {
      db.exec(buildCreateTableSql(name, def));
      for (const idx of def.indexes || []) db.exec(idx);
    }
  },
} as Migration;
