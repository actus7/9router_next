# ModelHub product contract

ModelHub is a local-first AI infrastructure dashboard and OpenAI-compatible gateway. It lets operators connect providers, normalize models, route requests, inspect usage, configure CLI tools, and expose selected media and web capabilities through one endpoint.

## Primary users and jobs

- Operators connect credentials and verify that a provider produces a real response.
- Developers point existing OpenAI-compatible clients at ModelHub and keep stable public payloads.
- Teams inspect quota, usage, failures and routing without mistaking infrastructure errors for empty data.
- Local users may expose the gateway through an explicitly enabled tunnel; remote input must never gain implicit access to loopback or private networks.

## Critical journeys

1. Authenticate, open the dashboard and recover from an expired or default password.
2. Add a provider connection, validate it, refresh its models and execute a model test.
3. Select models and capabilities for a CLI tool, apply settings and restore the prior configuration.
4. Send a Basic Chat request, stream the response, render markdown safely and inspect failures.
5. Review usage and quota without persistence failures appearing as legitimate empty states.

## Product invariants

- Success payloads for public HTTP endpoints remain backward compatible.
- Provider tests distinguish connectivity from a real accepted model response.
- Destructive cloud and configuration operations require an explicit named confirmation.
- Local data, secrets and private network targets are never exposed through arbitrary remote URLs.
- The public landing identity remains stable; remediation work is consolidation, not redesign.

## Release evidence

A release candidate must pass lint, TypeScript, contract emission, tests with coverage ratchets, architecture gates, production build and whitespace checks on the same commit. Authenticated browser checks cover desktop/mobile, light/dark and the critical journeys above. A build or Git push alone is not deployment acceptance.
