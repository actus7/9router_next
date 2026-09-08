# @model-hub/setup

Writes the CLI tool config a [ModelHub](../../README.md) dashboard generated for
you, on the machine where the CLI actually runs.

```bash
npx @model-hub/setup <payload>          # payload comes from CLI Tools → Get config
echo <payload> | npx @model-hub/setup   # if your shell caps argument length
npx @model-hub/setup <payload> --dry-run
```

- Merges into existing `.json` configs; other formats are replaced.
- Backs up anything it overwrites to `<file>.modelhub-bak-<timestamp>`.
- Refuses to write outside your home directory.
- Skips paths that still contain a `<placeholder>`.

It contains no per-tool knowledge on purpose: the dashboard builds the file
contents, this only puts them on disk. Adding a tool upstream never requires a
release here.

## Publishing

The dashboard renders `npx @model-hub/setup …` by default, matching the scope
the rest of the project publishes under:

```bash
cd packages/modelhub-setup
npm publish            # publishConfig.access is already public; add --otp=<code> if 2FA is on
```

Publishing under a different name is fine — set `NEXT_PUBLIC_SETUP_CLI_PACKAGE`
to it and the rendered command follows. Until the package exists on the
registry, the command in the dashboard fails and operators fall back to copying
the files listed under it, which always works.

Full context: [docs/CLI-TOOLS.md](../../docs/CLI-TOOLS.md).
