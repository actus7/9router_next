#!/usr/bin/env node
// Writes the config files a ModelHub dashboard generated for a CLI tool.
//
// It carries no knowledge of any tool. The dashboard already builds the exact
// file contents (endpoint, API key, model mapping) for every tool it supports;
// this only decodes that payload and puts the files on the machine where the
// CLI actually runs — which the ModelHub server cannot do when it is deployed
// on Vercel, in Docker, or on any box that is not the operator's workstation.
//
// ponytail: no per-tool table here on purpose. Adding a tool to the dashboard
// must not require publishing a new version of this package.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import process from "node:process";

const USAGE = `@model-hub/setup — apply a ModelHub CLI config to this machine

  npx @model-hub/setup <payload>
  echo <payload> | npx @model-hub/setup

Copy <payload> from the ModelHub dashboard: CLI Tools -> your tool -> Get config.

  --dry-run   show what would be written, write nothing
  --help      this text
`;

function fail(message, hint) {
  console.error(`@model-hub/setup: ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

function decodePayload(token) {
  let json;
  try {
    json = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    json = "";
  }
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    // The overwhelmingly likely cause is a shell argument cap (cmd.exe stops at
    // 8191 characters) silently truncating a long config, not a corrupt copy.
    return fail(
      "the payload is not valid — it was probably truncated",
      "Pipe it on stdin instead: echo <payload> | npx @model-hub/setup",
    );
  }
  if (!data || !Array.isArray(data.files) || data.files.length === 0) {
    return fail("the payload contains no files");
  }
  return data;
}

function expandHome(filePath) {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return join(homedir(), filePath.slice(2));
  }
  return filePath;
}

// Everything the dashboard emits lives under the operator's home directory.
// Keeping the writes inside it bounds the damage a pasted payload can do.
function resolveInsideHome(filePath) {
  const home = resolve(homedir());
  const target = resolve(expandHome(filePath));
  if (target !== home && !target.startsWith(home + sep)) {
    fail(`refusing to write outside the home directory: ${filePath}`);
  }
  return target;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Arrays are replaced rather than concatenated: a config array (models,
// providers) is a declaration of the desired set, and appending would leave
// stale entries behind on every re-run.
function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

// These files carry a live API key, so they must not inherit the umask (0644 on
// most Linux distributions leaves them readable by every account on the box).
// `mode` is honoured only when the file is created, hence the explicit chmod for
// the merge case. Both are no-ops on Windows, where the ACL governs instead.
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIR = 0o700;

function writeOwnerOnly(target, data) {
  writeFileSync(target, data, { mode: OWNER_ONLY_FILE });
  chmodSync(target, OWNER_ONLY_FILE);
}

function backupPath(target) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  return `${target}.modelhub-bak-${stamp}`;
}

function applyFile(file, dryRun) {
  const declaredPath = String(file.path ?? file.filename ?? "");
  const content = String(file.content ?? "");
  if (!declaredPath) return { path: "(unnamed)", action: "skipped", note: "no path" };
  // A few dashboard cards emit a path with a placeholder segment the operator
  // has to fill in (Cowork's applied-config id). Writing it literally would
  // create a file the tool never reads.
  if (declaredPath.includes("<") || declaredPath.includes(">")) {
    return { path: declaredPath, action: "skipped", note: "path has a placeholder — write it by hand" };
  }

  const target = resolveInsideHome(declaredPath);
  const exists = existsSync(target);
  const isJson = target.toLowerCase().endsWith(".json");

  let next = content;
  if (exists && isJson) {
    try {
      const current = JSON.parse(readFileSync(target, "utf8"));
      next = `${JSON.stringify(deepMerge(current, JSON.parse(content)), null, 2)}\n`;
    } catch {
      // Unparseable existing file (or payload): fall through to a full write.
      // The backup below is what makes that recoverable.
      next = content;
    }
  }

  const action = exists ? (isJson ? "merged" : "replaced") : "created";
  if (dryRun) return { path: target, action: `would be ${action}` };

  mkdirSync(dirname(target), { recursive: true, mode: OWNER_ONLY_DIR });
  let backup;
  if (exists) {
    backup = backupPath(target);
    // Copied through a fresh owner-only write rather than a plain file copy,
    // which would clone the source mode and leave the key world-readable for
    // as long as it took to chmod it afterwards.
    writeOwnerOnly(backup, readFileSync(target));
  }
  writeOwnerOnly(target, next);
  return { path: target, action, backup };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const dryRun = args.includes("--dry-run");
  const token = args.find((arg) => !arg.startsWith("-")) || readStdin();
  if (!token) {
    console.error(USAGE);
    process.exit(1);
  }

  const payload = decodePayload(token);
  if (payload.tool) console.log(`Configuring ${payload.tool}`);

  for (const file of payload.files) {
    const result = applyFile(file, dryRun);
    console.log(`  ${result.action.padEnd(16)} ${result.path}`);
    if (result.note) console.log(`  ${" ".repeat(16)} ${result.note}`);
    if (result.backup) console.log(`  ${" ".repeat(16)} backup: ${result.backup}`);
  }

  if (!dryRun) console.log("\nRestart the tool to pick up the new config.");
}

main();
