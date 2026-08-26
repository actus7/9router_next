// Ambient module declarations for optional/native SQLite drivers.
// This file is a "script" (no top-level import/export) so declare module works.

declare module "better-sqlite3" {
  interface Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | null };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  }
  class Database {
    constructor(filename: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    pragma(pragma: string): unknown;
    close(): void;
    transaction<T>(fn: () => T): () => T;
  }
  namespace Database {
    export { Statement };
  }
  export = Database;
}

declare module "sql.js" {
  function initSqlJs(): Promise<initSqlJs.SqlJsStatic>;
  namespace initSqlJs {
    interface Statement {
      bind(params?: unknown[] | null): void;
      step(): boolean;
      getAsObject(): Record<string, unknown>;
      free(): void;
    }
    interface Database {
      exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
      prepare(sql: string): Statement;
      export(): Uint8Array;
      getRowsModified(): number;
      close(): void;
    }
    interface SqlJsStatic {
      new (data?: ArrayLike<number> | Buffer | null): Database;
      Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
    }
  }
  export = initSqlJs;
}

declare module "bun:sqlite" {
  class Database {
    constructor(filename: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    transaction(fn: () => void): () => void;
    close(): void;
  }
  interface Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | null };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  }
  export { Database };
}

declare module "node:sqlite" {
  class DatabaseSync {
    constructor(filename: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
  interface StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | null };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  }
  export { DatabaseSync };
}
