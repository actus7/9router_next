import fs from "node:fs";
import path from "node:path";

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, acc);
    else if (/route\.ts$|page\.tsx$/.test(entry.name)) acc.push(fullPath);
  }
  return acc;
}

const patterns = [
  /^export const dynamic = "force-dynamic";\r?\n/m,
  /^export const revalidate = 0;\r?\n/m,
  /^export const runtime = "nodejs";\r?\n/m,
];

let updated = 0;
for (const file of walk("src")) {
  const source = fs.readFileSync(file, "utf8");
  const next = patterns.reduce((value, pattern) => value.replace(pattern, ""), source);
  if (next !== source) {
    fs.writeFileSync(file, next);
    updated += 1;
  }
}

console.log(`updated ${updated} files`);
