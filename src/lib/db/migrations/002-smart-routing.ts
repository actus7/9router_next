import { TABLES, buildCreateTableSql } from "../schema";

interface DbAdapter {
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  exec(sql: string): void;
}

const migration = {
  version: 2,
  name: "smart-routing",
  up(db: DbAdapter): void {
    const columns = db.all("PRAGMA table_info(combos)");
    if (!columns.some((column) => column.name === "routing")) {
      db.exec("ALTER TABLE combos ADD COLUMN routing TEXT");
    }

    const profiles = TABLES.smartModelProfiles;
    db.exec(buildCreateTableSql("smartModelProfiles", profiles));
    for (const index of profiles.indexes || []) db.exec(index);
  },
};

export default migration;
