# ModelHub operations

## Database changes

Run the normal application startup or migration workflow; schema changes trigger a local backup before versioned migrations. Export/import includes provider connections and model availability. Never delete or rewrite the database as a deployment shortcut.

`modelAvailability` is disposable operational state: expired rows are cleaned automatically. Connection test status is durable diagnostic state and must be changed only by an explicit connection test or user action.

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
   - CLI tool: reconfigure it from the CLI Tools screen.
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
