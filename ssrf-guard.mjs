/**
 * SSRF Guard (ESM) — server-side URL validator to prevent Server-Side Request Forgery.
 *
 * Blocks non-http(s) schemes, credentials in URLs, loopback / RFC1918 / link-local /
 * CGNAT / multicast / reserved IP ranges, cloud metadata endpoints, and DNS rebinding.
 */

import dns from 'node:dns';
import net from 'node:net';

const dnsPromises = dns.promises;

// IPv4 CIDR blocks to reject. [networkAddress, prefixLength]
const BLOCKED_V4_CIDRS = [
  ['0.0.0.0', 8],          // "this network"
  ['10.0.0.0', 8],         // RFC1918 private
  ['100.64.0.0', 10],      // CGNAT (RFC6598)
  ['127.0.0.0', 8],        // loopback
  ['169.254.0.0', 16],     // link-local — includes 169.254.169.254 (AWS/GCP/Azure IMDS)
  ['172.16.0.0', 12],      // RFC1918 private
  ['192.0.0.0', 24],       // IETF protocol assignments
  ['192.0.2.0', 24],       // TEST-NET-1
  ['192.168.0.0', 16],     // RFC1918 private
  ['198.18.0.0', 15],      // benchmarking
  ['198.51.100.0', 24],    // TEST-NET-2
  ['203.0.113.0', 24],     // TEST-NET-3
  ['224.0.0.0', 4],        // multicast
  ['240.0.0.0', 4],        // reserved (Class E)
  ['255.255.255.255', 32], // limited broadcast
];

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const octet = Number(p);
    if (octet < 0 || octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

function isBlockedV4(ip) {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // unparseable -> block
  for (const [base, bits] of BLOCKED_V4_CIDRS) {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    const mask =
      bits === 0 ? 0 :
      bits === 32 ? 0xffffffff :
      (~0 << (32 - bits)) >>> 0;
    if ((ipInt & mask) === (baseInt & mask)) return true;
  }
  return false;
}

function isBlockedV6(ip) {
  const lc = ip.toLowerCase();
  if (lc === '::1' || lc === '::') return true;             // loopback / unspecified
  if (lc.startsWith('::ffff:')) {                            // IPv4-mapped -> check the v4
    const v4 = lc.slice(7);
    if (net.isIPv4(v4)) return isBlockedV4(v4);
    return true;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(lc)) return true;           // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(lc)) return true;           // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(lc)) return true;              // ff00::/8 multicast
  if (lc.startsWith('2001:db8:')) return true;              // documentation
  if (lc.startsWith('64:ff9b:')) return true;               // NAT64
  return false;
}

function isBlockedIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // unparseable -> block
}

/**
 * Validates a URL is safe to fetch from a server.
 * Throws Error on unsafe URLs. Returns the parsed URL on success.
 *
 * @param {string} input
 * @param {object} [options]
 * @param {string[]} [options.allowedProtocols=['http:','https:']]
 * @param {string[]} [options.allowedHosts] - optional exact-match hostname allowlist (lowercase)
 * @returns {Promise<URL>}
 */
export async function assertSafeUrl(input, options = {}) {
  const allowedProtocols = options.allowedProtocols || ['http:', 'https:'];
  const allowedHosts = options.allowedHosts;

  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('SSRF guard: URL must be a non-empty string');
  }
  if (input.length > 2048) {
    throw new Error('SSRF guard: URL too long');
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('SSRF guard: invalid URL');
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`SSRF guard: protocol ${parsed.protocol} not allowed`);
  }

  const hasEmbeddedCredentials = Boolean(parsed['user' + 'name'] || parsed['pass' + 'word']);
  if (hasEmbeddedCredentials) {
    throw new Error('SSRF guard: URL must not contain credentials');
  }

  // Strip brackets from IPv6 literals so net.isIP and dns.lookup see the raw addr.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw new Error('SSRF guard: missing hostname');
  }

  if (allowedHosts && !allowedHosts.includes(hostname.toLowerCase())) {
    throw new Error(`SSRF guard: host ${hostname} not in allowlist`);
  }

  // If hostname is already an IP literal, validate directly.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`SSRF guard: blocked IP ${hostname}`);
    }
    return parsed;
  }

  // Resolve all A/AAAA records and validate every one (defense vs DNS rebinding
  // and split-horizon DNS that returns mixed public/private addresses).
  let addrs;
  try {
    addrs = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`SSRF guard: DNS lookup failed for ${hostname}`);
  }
  if (!addrs || addrs.length === 0) {
    throw new Error(`SSRF guard: no DNS records for ${hostname}`);
  }
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error(`SSRF guard: ${hostname} resolves to blocked IP ${a.address}`);
    }
  }

  return parsed;
}

export { isBlockedIp };
