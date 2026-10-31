// Regenerates tests/contracts/route-manifest.json from src/app/api/**/route.ts.
// The contract test compares the manifest to the filesystem, so a route added
// or removed without running this fails the suite instead of going stale.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API_ROOT = "src/app/api";
const OUT = "tests/contracts/route-manifest.json";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

function routeFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

export function routePath(file) {
  const dir = relative("src/app", file).split(sep).slice(0, -1).join("/");
  return `//${dir}`;
}

export function routeMethods(source) {
  const declared = new Set();
  for (const m of METHODS) {
    if (new RegExp(`export\\s+(const|async\\s+function|function)\\s+${m}\\b`).test(source)) declared.add(m);
  }
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (METHODS.includes(name)) declared.add(name);
    }
  }
  return METHODS.filter((m) => declared.has(m));
}

export function buildRoutes() {
  return routeFiles(API_ROOT)
    .map((file) => {
      const source = readFileSync(file, "utf8");
      const runtime = /export\s+const\s+runtime\s*=\s*["'](\w+)["']/.exec(source)?.[1] || "nodejs";
      return { path: routePath(file), methods: routeMethods(source), runtime };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

if (process.argv[1]?.endsWith("gen-route-manifest.mjs")) {
  const previous = JSON.parse(readFileSync(OUT, "utf8").replace(/^﻿/, ""));
  const routes = buildRoutes();
  writeFileSync(OUT, `${JSON.stringify({ rewrites: previous.rewrites, totalRoutes: routes.length, routes }, null, 2)}\n`);
  console.log(`route-manifest: ${routes.length} routes`);
}
