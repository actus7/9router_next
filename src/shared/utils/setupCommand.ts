// Published from packages/modelhub-setup. Overridable because whoever deploys
// this ModelHub has to publish that package under a name they own.
const SETUP_PACKAGE = process.env.NEXT_PUBLIC_SETUP_CLI_PACKAGE || "@model-hub/setup";

export interface SetupConfigFile {
  filename: string;
  content: string;
}

/**
 * Builds the one-liner that writes a tool's config on the machine running the
 * CLI.
 *
 * The files are assembled in the browser from the endpoint, key and model the
 * operator just picked. The server cannot write them itself: on any remote
 * deploy (Vercel, Docker, a LAN box) its home directory belongs to the server,
 * not to the operator. So the payload travels inside the command.
 *
 * base64url, because `+` and `/` from plain base64 survive a shell unquoted but
 * do not survive every copy path, and the padding `=` reads as an assignment in
 * some of them.
 */
export function buildSetupCommand(configs: SetupConfigFile[]): string {
  const json = JSON.stringify({
    v: 1,
    files: configs.map((config) => ({ path: config.filename, content: config.content })),
  });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const payload = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `npx ${SETUP_PACKAGE} ${payload}`;
}
