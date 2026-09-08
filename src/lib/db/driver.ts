import { createPostgresAdapter, type PostgresAdapter } from "./adapters/postgresAdapter";

export type DbAdapter = PostgresAdapter;

interface DbAdapterState {
  instance: DbAdapter | null;
  initPromise: Promise<DbAdapter> | null;
}

declare global {
  var _dbAdapter: DbAdapterState | undefined;
}

// Use global to survive Next.js dev hot-reload (module state resets on reload).
// It also keeps one connection pool per process instead of one per reload.
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null };
const state: DbAdapterState = global._dbAdapter!;

async function initAdapter(): Promise<DbAdapter> {
  const connectionString: string | undefined = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "[DB] DATABASE_URL is not set. The app stores everything in Neon Postgres — " +
      "copy the pooled connection string from the Neon console into DATABASE_URL.",
    );
  }

  const adapter: DbAdapter = createPostgresAdapter(connectionString);
  const { runMigrationOnce } = await import("./migrate");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter(): Promise<DbAdapter> {
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = initAdapter().then((a: DbAdapter) => {
      state.instance = a;
      return a;
    }).catch((err: unknown) => {
      // Let the next call retry instead of caching a rejected promise forever —
      // a cold Neon compute or a transient network blip should not brick the
      // process until it is restarted.
      state.initPromise = null;
      throw err;
    });
  }
  return state.initPromise;
}
