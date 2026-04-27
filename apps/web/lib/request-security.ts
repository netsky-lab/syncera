import { lookup } from "dns/promises";
import { isIP } from "net";

const PRIVATE_V4_RANGES: Array<[number, number]> = [
  [ip4("0.0.0.0"), ip4("0.255.255.255")],
  [ip4("10.0.0.0"), ip4("10.255.255.255")],
  [ip4("127.0.0.0"), ip4("127.255.255.255")],
  [ip4("169.254.0.0"), ip4("169.254.255.255")],
  [ip4("172.16.0.0"), ip4("172.31.255.255")],
  [ip4("192.168.0.0"), ip4("192.168.255.255")],
  [ip4("224.0.0.0"), ip4("255.255.255.255")],
];

function ip4(value: string): number {
  return value
    .split(".")
    .reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(address: string): boolean {
  const n = ip4(address);
  return PRIVATE_V4_RANGES.some(([start, end]) => n >= start && n <= end);
}

function isUnsafeIpv6(address: string): boolean {
  const v = address.toLowerCase();
  return (
    v === "::1" ||
    v === "::" ||
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    v.startsWith("fe80:") ||
    v.startsWith("ff")
  );
}

function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return (
    h === "localhost" ||
    h === "localhost.localdomain" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan")
  );
}

export async function assertPublicHttpUrl(
  raw: string,
  opts: { requireHttps?: boolean } = {}
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL is invalid");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("URL must use http(s)");
  }
  if (opts.requireHttps && url.protocol !== "https:") {
    throw new Error("URL must use https");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (isLocalHostname(url.hostname)) {
    throw new Error("URL must not point to a local/private host");
  }

  const literal = isIP(url.hostname);
  const addresses = literal
    ? [{ address: url.hostname, family: literal }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("URL host does not resolve");

  for (const entry of addresses) {
    const family = entry.family;
    const address = entry.address;
    if (family === 4 && isPrivateIpv4(address)) {
      throw new Error("URL resolves to a private IPv4 address");
    }
    if (family === 6 && isUnsafeIpv6(address)) {
      throw new Error("URL resolves to a private IPv6 address");
    }
  }

  return url;
}
