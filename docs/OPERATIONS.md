# ModelHub operations

## Database changes

Run the normal application startup or migration workflow; schema changes trigger a local backup before versioned migrations. Export/import includes provider connections and model availability. Never delete or rewrite the database as a deployment shortcut.

`modelAvailability` is disposable operational state: expired rows are cleaned automatically. Connection test status is durable diagnostic state and must be changed only by an explicit connection test or user action.

## Provider smoke test (manual and opt-in)

Use an authenticated local session and only connections authorized for testing. Verify one Naga connection, an OpenRouter connection without credit, one model in cooldown, catalog refresh, and the limited diagnostic action. Do not run bulk tests against paid providers as part of CI or deployment.

## Release checks

Run `npm run check`, inspect `git diff --check`, and confirm no imports use `@/lib/open-sse` or `@/sse`. A green local build is not a provider-production smoke test.
