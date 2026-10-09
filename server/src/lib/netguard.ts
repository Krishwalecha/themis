import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../config";

// Stops users from pointing the server at its own network: loopback, private ranges, link-local (including the
// cloud metadata address 169.254.169.254) and other reserved space. Checked before every request, redirect and webhook.

export class BlockedAddress extends Error {
  constructor(host: string) {
    super(`${host} is a private or reserved address, which this server doesn't send requests to`);
  }
}

const v4 = (ip: string): number[] => ip.split(".").map(Number);

const privateV4 = (ip: string): boolean => {
  const [a, b] = v4(ip);
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
};

const privateV6 = (ip: string): boolean => {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  // IPv4 written as IPv6 (::ffff:10.0.0.1)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return privateV4(mapped[1]);
  return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s); // unique-local, link-local, multicast
};

export const isPrivateAddress = (ip: string): boolean => (isIP(ip) === 4 ? privateV4(ip) : isIP(ip) === 6 ? privateV6(ip) : false);

// Throws BlockedAddress when the URL's host is, or resolves to, a private address. Off when private networks are
// allowed, except for `always` (guest requests, which are never trusted with the server's own network).
export const assertPublicUrl = async (url: string, opts: { always?: boolean } = {}): Promise<void> => {
  if (config.request.allowPrivateNetworks && !opts.always) return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new BlockedAddress(host);
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addresses.some(isPrivateAddress)) throw new BlockedAddress(host);
};
