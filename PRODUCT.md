# ModelHub product contract

ModelHub is an AI infrastructure dashboard and OpenAI-compatible gateway. It lets operators connect providers, normalize models, route requests, inspect usage, and expose selected media and web capabilities through one endpoint. The gateway and dashboard run on any host; persistent state lives in Neon Postgres (`DATABASE_URL`), and anything that has to touch the operator's own filesystem is handed to the operator rather than performed by the server.

## Primary users and jobs

- Operators connect credentials and verify that a provider produces a real response.
- Developers point existing OpenAI-compatible clients at ModelHub and keep stable public payloads.
- Teams inspect quota, usage, failures and routing without mistaking infrastructure errors for empty data.
- Local users may expose the gateway through an explicitly enabled tunnel; remote input must never gain implicit access to loopback or private networks.

## Critical journeys

1. Sign in through Neon Auth and land on the dashboard of the active organization.
2. Add a provider connection, validate it, refresh its models and execute a model test.
3. Send a Basic Chat request, stream the response, render markdown safely and inspect failures.
4. Review usage and quota without persistence failures appearing as legitimate empty states.

## Product invariants

- Success payloads for public HTTP endpoints remain backward compatible.
- Provider tests distinguish connectivity from a real accepted model response.
- Destructive cloud and configuration operations require an explicit named confirmation.
- Local data, secrets and private network targets are never exposed through arbitrary remote URLs.
- The public landing identity remains stable; remediation work is consolidation, not redesign.

## Release evidence

A release candidate must pass lint, TypeScript, contract emission, tests with coverage ratchets, architecture gates, production build and whitespace checks on the same commit. Authenticated browser checks (desktop/mobile, light/dark, the critical journeys above) are performed manually; the CI has no browser runner. A build or Git push alone is not deployment acceptance.
