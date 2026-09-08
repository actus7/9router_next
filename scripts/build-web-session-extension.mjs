import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// Deterministic ZIP (stored entries). Explicit allowlist excludes local state and secrets.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["manifest.json", "providers.js", "background.js", "captureStoredCredential.js", "bridge.js", "capture.js", "popup.html", "popup.css", "popup.js", "README.md"];
const table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (data) => {
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const local = [];
const central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(`modelhub-web-sessions/${file}`);
  const data = readFileSync(resolve(root, "packages/modelhub-web-sessions", file));
  const crc = crc32(data);
  const entry = Buffer.alloc(30);
  entry.writeUInt32LE(0x04034b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(33, 12); // 1980-01-01, reproducible across builds.
  entry.writeUInt32LE(crc, 14);
  entry.writeUInt32LE(data.length, 18);
  entry.writeUInt32LE(data.length, 22);
  entry.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(33, 14);
  directory.writeUInt32LE(crc, 16);
  directory.writeUInt32LE(data.length, 20);
  directory.writeUInt32LE(data.length, 24);
  directory.writeUInt16LE(name.length, 28);
  directory.writeUInt32LE(offset, 42);
  local.push(entry, name, data);
  central.push(directory, name);
  offset += entry.length + name.length + data.length;
}
const directoryData = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directoryData.length, 12);
end.writeUInt32LE(offset, 16);
mkdirSync(resolve(root, "public/extensions"), { recursive: true });
writeFileSync(resolve(root, "public/extensions/modelhub-web-sessions.zip"), Buffer.concat([...local, directoryData, end]));
console.log(`Web Sessions extension packaged: ${files.length} files.`);
