# Spike: can a plugin stored in the database run sandboxed?

Date: 2026-09-02. Probe code was throwaway and lives outside the repository.

## Question

Can a plugin whose source is a database row execute with no access to
`process.env`, raw `fetch`, or the filesystem, and still contribute a tool the
chat can call?

Answer: yes, with QuickJS compiled to WebAssembly.

## `node:vm` is not a boundary

The obvious candidate fails in one line. Evaluating
`this.constructor.constructor("return process")()` in a fresh `vm` context
returns the host's real `process` object, which carries `process.env` and every
Node binding. Node's own documentation says `vm` is not a security mechanism;
this confirms it concretely for our case.

## QuickJS-WASM results

The guest realm has no ambient capability at all. Probing each name reports it
absent or throwing:

| Name | Guest sees |
|---|---|
| `process`, `require`, `fetch` | not defined |
| `setTimeout`, `WebAssembly`, `Buffer`, `Deno` | not defined |
| `globalThis.process` | `undefined` |

The `node:vm` escape above fails here with `'process' is not defined`, because
there is no host realm to reach.

A plugin source read from a string registered a tool through a host-provided
`registerTool`, and the host called it and received a real minesweeper board.
Guest exceptions surface as structured errors instead of crashing the host.

| Measure | Result |
|---|---|
| Tool call, 9x9 board, 200 calls | 0.165 ms |
| Cold plugin load | 0.8 ms |
| Infinite loop in a tool | interrupted at deadline |
| Memory bomb in a tool | contained, "out of memory" |

Both timings are negligible beside an LLM round trip.

## Bundling

The default `quickjs-emscripten` package pulls four variants carrying separate
`.wasm` files, 9.2 MB in total. A separate `.wasm` asset is exactly what breaks
in a bundled serverless function, which the comment in
`src/server/plugin-core/plugins/registry.ts` already warns about.

The `@jitl/quickjs-singlefile-cjs-release-sync` variant embeds the wasm in the
JavaScript, ships 3.1 MB, contains no `.wasm` file, and was verified to give
identical isolation running the same plugin.

## Consequences for the design

- The sandbox boundary is serializable, so the plugin contribution surface must
  be data-first: JSON in, JSON out. A design handing plugins live JS references
  would not survive.
- Per-conversation plugin state cannot live in memory. Under serverless the
  process dies between requests, so state must be a host-provided persisted
  service.

## Limits of this spike

Isolation of the language runtime is proven; a security review is not. Anything
the host explicitly binds becomes a capability, so the real security work is
deciding what gets bound.

The probe used the synchronous variant. A plugin that must await something needs
either the asyncify variant or a host-mediated request/response protocol. Not
tested.
