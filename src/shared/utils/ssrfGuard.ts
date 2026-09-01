// SSRF guard: block internal/private/metadata targets for server-side fetch.

const BLOCKED_HOSTNAMES = new Set<string>(["localhost", "ip6-localhost", "ip6-loopback"]);
const BLOCKED_SUFFIXES: string[] = [".internal", ".local", ".localhost"];

// Parse dotted IPv4 to 32-bit integer, or null if not a valid IPv4 literal.
function ipv4ToInt(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

// Private/reserved IPv4 ranges as [startInt, maskBits].
const BLOCKED_V4_RANGES: [number, number][] = [
  [ipv4ToInt("0.0.0.0")!, 8],
  [ipv4ToInt("10.0.0.0")!, 8],
  [ipv4ToInt("100.64.0.0")!, 10],
  [ipv4ToInt("127.0.0.0")!, 8],
  [ipv4ToInt("169.254.0.0")!, 16],
  [ipv4ToInt("172.16.0.0")!, 12],
  [ipv4ToInt("192.0.0.0")!, 24],
  [ipv4ToInt("192.0.2.0")!, 24],
  [ipv4ToInt("192.88.99.0")!, 24],
  [ipv4ToInt("192.168.0.0")!, 16],
  [ipv4ToInt("198.18.0.0")!, 15],
  [ipv4ToInt("198.51.100.0")!, 24],
  [ipv4ToInt("203.0.113.0")!, 24],
  [ipv4ToInt("224.0.0.0")!, 4],
  [ipv4ToInt("240.0.0.0")!, 4],
];

function isBlockedIpv4(host: string): boolean {
  const ip = ipv4ToInt(host);
  if (ip === null) return false;
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (base & mask);
  });
}

function isBlockedIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  const v4Mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isBlockedIpv4(v4Mapped[1]);
  // WHATWG URL normalizes v4-mapped IPv6 to hex form (::ffff:7f00:1).
  // Decode the embedded IPv4 and run the same range checks.
  const v4MappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4MappedHex) {
    const hi = parseInt(v4MappedHex[1], 16);
    const lo = parseInt(v4MappedHex[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(v4);
  }
  if (h.startsWith("::ffff:")) return true;
  if (h === "::1" || h === "::") return true;
  return (
    h.startsWith("fe8") ||
    h.startsWith("fe9") ||
    h.startsWith("fea") ||
    h.startsWith("feb") ||
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    h.startsWith("ff") ||
    h.startsWith("2001:db8:")
  );
}

/** Return whether an already-resolved IP belongs to a non-public range. */
export function isBlockedIpAddress(address: string): boolean {
  return isBlockedIpv4(address) || (address.includes(":") && isBlockedIpv6(address));
}

// Throw if URL targets a non-public host. Caller should map to 400.
export function assertPublicUrl(rawUrl: string): void {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Blocked URL: unsupported protocol");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Blocked URL: embedded credentials");
  }

  if (BLOCKED_HOSTNAMES.has(host)) throw new Error("Blocked URL: internal host");
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new Error("Blocked URL: internal host");
  if (isBlockedIpAddress(host)) throw new Error("Blocked URL: private IP");
}
