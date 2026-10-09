import { describe, expect, it, vi } from "vitest";

// O pool fechava conexões ociosas em 10s (padrão do pg-pool), então a primeira
// query depois de uma pausa pagava WebSocket + TLS + auth de novo (100-400ms).
// E uma conexão ociosa que o servidor derruba emite 'error' no pool: sem
// listener, o EventEmitter derruba o processo.

const pool = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  on: vi.fn(),
}));

vi.mock("@neondatabase/serverless", () => ({
  Pool: class {
    constructor(options: Record<string, unknown>) {
      pool.options = options;
    }
    on = pool.on;
  },
  types: { setTypeParser: vi.fn() },
}));

const { createPostgresAdapter } = await import("@/lib/db/adapters/postgresAdapter");

describe("pool do Neon", () => {
  it("mantém conexões ociosas por pelo menos 60s", () => {
    createPostgresAdapter("postgres://u:p@host/db");
    expect(pool.options?.idleTimeoutMillis).toBeGreaterThanOrEqual(60_000);
    expect(pool.options?.connectionString).toBe("postgres://u:p@host/db");
  });

  it("escuta 'error' do pool para uma conexão ociosa derrubada não matar o processo", () => {
    createPostgresAdapter("postgres://u:p@host/db");
    expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
