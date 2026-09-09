# ModelHub operations

## Database changes

The schema is declarative. `syncSchema()` runs on boot and is additive only: it
creates missing tables, adds missing columns and creates missing indexes. There
is no versioned migration chain and no local backup step — that pair belonged to
the file-backed SQLite database, and Neon's branching covers the "undo a bad
change" case they existed for. A destructive change (drop, rename, retype) is
run by hand against the branch and then reflected in `src/lib/db/schema.ts`.

Export/import (`GET`/`POST /api/settings/database`) is scoped to the calling
account and covers provider connections and model availability. Never delete or
rewrite the database as a deployment shortcut.

`modelAvailability` is disposable operational state: expired rows are cleaned automatically. Connection test status is durable diagnostic state and must be changed only by an explicit connection test or user action.

## Upgrading to credential encryption at rest

Provider credentials (`apiKey`, `accessToken`, `refreshToken`, `idToken` inside
`providerConnections.data`) are encrypted with AES-256-GCM when `CREDENTIAL_KEY`
is set. Three states, chosen by configuration rather than by code:

| Configuration | Behaviour |
|---|---|
| `CREDENTIAL_KEY` unset | Plaintext. Boots, warns on every boot, and reports `credentialEncryptionEnabled: false` from `GET /api/settings`. |
| `CREDENTIAL_KEY` set | Encrypted. Rows written from then on are encrypted; plaintext rows already stored are read as-is and re-encrypted when next written. |
| `CREDENTIAL_ENCRYPTION_REQUIRED=true` with no key | **Refuses to start**, naming both variables in the error. |

Plaintext is the default on purpose: an upgrade must not stop an install that
never opted in. Turn on `CREDENTIAL_ENCRYPTION_REQUIRED` where that trade is not
acceptable — it then fails at boot instead of degrading quietly, and it is
checked before the legacy JSON import writes any credential.

**Losing the key makes encrypted credentials unrecoverable.** They are dropped
on read with an error in the log, and every affected provider has to be
reconnected. Keep it wherever you keep secrets, not beside the connection
string.

Encrypted and plaintext rows coexist — a value without the `v1:` prefix is read
as-is — so introducing the key needs no flag day.

One thing turning the key on cannot fix: an export taken *before* it was set
contains plaintext credentials, and `GET /api/settings/database` hands that file
to whoever downloaded it. Delete any such export you still have.

## Rotating a gateway API key

Every key carries the destination it was issued for. `apiKeys.sink` is one of
`manual`, `dashboard`, `cli:<toolId>` or `cloud:<provider>`, and `sinkRef`
locates it (a config file path, or the deployed resource name). That is what
makes rotation a procedure instead of an investigation: revoking one
destination's key cannot break another, because they never share one.

1. `GET /api/keys/inventory` — lists every key by destination, with a masked
   prefix. It never returns the key itself.
2. Revoke the compromised destination's key: `DELETE /api/keys/<id>`.
3. Re-issue and rewrite that destination:
   - cloud: delete and recreate the deployment. `POST /api/cloud/deployments`
     mints its own key (`cloud:<provider>`) and the teardown path revokes it, so
     the key never has to be handled by hand.
   - CLI tool: reconfigure it from the CLI Tools screen. When ModelHub does
     not run on the same machine as the CLI, that screen hands you a
     `npx @model-hub/setup` command instead of writing the file — see
     [CLI-TOOLS.md](CLI-TOOLS.md).
4. No other destination needs touching. Verify with the inventory.

`revokedAt` is an audit timestamp; `isActive = 0` is what actually stops the key
authenticating (`validateApiKey` reads that column and nothing else). Revoked
rows are kept, not deleted, so `usageHistory` can still resolve which key spent
what — deleting the row would rewrite the past.

### The untraced residue

`untracedCount` in the inventory counts active keys whose sink is `manual`:
operator-created keys, and rows written before the sink columns existed. Nothing
knows where those went, so rotating them means reconfiguring every client by
hand. They are the residue of the old one-key-everywhere behaviour — prefer
issuing a per-destination key over reusing one of these.

## Provider smoke test (manual and opt-in)

Use an authenticated local session and only connections authorized for testing. Verify one Naga connection, an OpenRouter connection without credit, one model in cooldown, catalog refresh, and the limited diagnostic action. Do not run bulk tests against paid providers as part of CI or deployment.

## Release checks

Run `npm run check`, inspect `git diff --check`, and confirm no imports use `@/lib/open-sse` or `@/sse`. A green local build is not a provider-production smoke test.
