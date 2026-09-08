# Pointing a CLI tool at ModelHub

Every coding CLI in the dashboard's **CLI Tools** section speaks either the
OpenAI or the Anthropic wire protocol. ModelHub serves both, so configuring one
is always the same three values:

| Value | Where it comes from |
|---|---|
| Base URL | your ModelHub origin plus `/v1` — e.g. `https://hub.example.com/v1` |
| API key | **CLI Tools → your tool** issues one scoped to that tool (`sk_…`) |
| Model | `provider/model-id`, e.g. `cc/claude-sonnet-5` — the model picker lists what your connected providers expose |

The dashboard renders those three into the tool's real config file for you.
Open the tool, pick endpoint, key and models, then hit **Get config**.

## Applying the config

There are three ways, in descending order of convenience.

### 1. `npx @model-hub/setup` (any deployment)

The **Get config** modal shows a one-liner. Run it on the machine where the CLI
runs:

```bash
npx @model-hub/setup <payload>
```

It merges into existing JSON configs rather than replacing them (your Claude
Code `permissions` and `hooks` survive), backs up whatever it does replace to
`<file>.modelhub-bak-<timestamp>`, and refuses to write outside your home
directory. `--dry-run` shows the plan without touching anything.

If your shell rejects the command's length — `cmd.exe` truncates arguments at
8191 characters — pipe it instead:

```bash
echo <payload> | npx @model-hub/setup
```

The package lives in [`packages/modelhub-setup`](../packages/modelhub-setup).
It ships no per-tool knowledge: the dashboard produces the files, the package
only writes them. Adding a tool to the dashboard therefore never requires a new
release of it. Publish it under a name you own and set
`NEXT_PUBLIC_SETUP_CLI_PACKAGE` so the rendered command points at yours.

### 2. Copy the files by hand

The same modal lists every file with its full path and content. Copy, paste,
restart the tool. Nothing else is needed — this is the fallback that always
works.

### 3. **Apply** (only when ModelHub runs on your own machine)

The **Apply** and **Reset** buttons write the config file directly, and they
appear only when ModelHub found that CLI on the machine running the server. On
Vercel, in Docker, or on a LAN box they are hidden, because there they would
write into the server's home directory and never reach you. That is not a
degraded mode to fix — see [DEPLOYMENT.md](DEPLOYMENT.md) for why serverless is
supported for the gateway and demo-only for state.

## Tools with no config file

Cursor, Roo, Continue, Amp, Qwen and others are configured through their own UI.
Their cards render step-by-step instructions with the endpoint and key already
filled in; there is nothing to apply.

Some of them — Cursor in particular — route requests through their own servers
and cannot reach `localhost`. Those cards say so and require a Tunnel or a
public deployment.

## Rotating a key

Each tool gets its own key (`sink: cli:<toolId>`), so revoking one tool's key
does not disturb the others. Resetting a tool from the dashboard revokes its key
in the same operation. Details in [OPERATIONS.md](OPERATIONS.md).
