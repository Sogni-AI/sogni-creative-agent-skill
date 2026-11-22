/**
 * SSRF Guard (ESM) — URL validator + guarded fetch to prevent Server-Side Request Forgery.
 *
 * `assertSafeUrl` blocks non-http(s) schemes, credentials in URLs, and every
 * address that is not public unicast: loopback, RFC1918, link-local (cloud
 * metadata), CGNAT, multicast, reserved and documentation ranges, and the IPv6
 * forms that carry such an IPv4 address (mapped, translated, NAT64, 6to4). It
 * validates every A/AAAA record a hostname resolves to.
 *
 * `fetchSafeUrl` connects only to addresses it has checked. Its connection
 * resolves the name through `guardedLookup`, which refuses the connection when
 * any answer is blocked, so a name that answers a public address to the check
 * and a private one to the connection (DNS rebinding) cannot reach the private
 * one. It follows redirects itself and checks every hop the same way. A hop
 * that Node's fetch() would or might send through a proxy from the environment
 * (`fetchUsesEnvProxy`) still goes through fetch(): a proxy resolves the name,
 * so no connection can be pinned, and `assertSafeUrl`'s own check of the name
 * is the only one.
 *
 * `assertSafeUrl` alone constrains nothing a later request does: a caller that
 * fetches with its own client must pin that client's connection itself.
 *
 * This module imports only Node built-ins: the desktop extension bundle ships
 * it without the rest of the package.
 */

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable, pipeline } from 'node:stream';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

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

function isBlockedV4Int(ipInt) {
  for (const [base, bits] of BLOCKED_V4_CIDRS) {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    const mask =
      bits === 0 ? 0 :
      bits === 32 ? 0xffffffff :
      (~0 << (32 - bits)) >>> 0;
    if (((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0)) return true;
  }
  return false;
}

function isBlockedV4(ip) {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // unparseable -> block
  return isBlockedV4Int(ipInt);
}

/**
 * The 128-bit value of an IPv6 address in any textual form (compressed, full,
 * dotted IPv4 tail, zone suffix), or null when it does not parse.
 */
function ipv6ToBigInt(ip) {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  let tail = [];
  const lastColon = text.lastIndexOf(':');
  if (lastColon === -1) return null;
  if (text.slice(lastColon + 1).includes('.')) {
    const v4 = ipv4ToInt(text.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [v4 >>> 16, v4 & 0xffff];
    text = text.slice(0, lastColon);
    if (text.endsWith(':')) text += ':';
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (part) => (part === ''
    ? []
    : part.split(':').map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN)));
  const head = groupsOf(halves[0]);
  const rest = halves.length === 2 ? groupsOf(halves[1]) : [];
  const missing = 8 - head.length - rest.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill(0), ...rest, ...tail];
  if (groups.some(Number.isNaN)) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function v6Cidr(base, bits) {
  return { base: ipv6ToBigInt(base), shift: BigInt(128 - bits) };
}

function inV6Cidr(addr, { base, shift }) {
  return (addr >> shift) === (base >> shift);
}

// IPv6 forms whose connection reaches an embedded IPv4 host, so that host's
// address decides: [range, bit offset of the IPv4 address].
const EMBEDDED_V4_V6_CIDRS = [
  [v6Cidr('::ffff:0:0', 96), 0n],   // IPv4-mapped
  [v6Cidr('::ffff:0:0:0', 96), 0n], // IPv4-translated (RFC 6145)
  [v6Cidr('64:ff9b::', 96), 0n],    // NAT64 well-known prefix (RFC 6052)
  [v6Cidr('2002::', 16), 80n],      // 6to4 (RFC 3056): 2002:AABB:CCDD::/48
];

// Every public IPv6 host is in 2000::/3. Outside it lie the unspecified and
// loopback addresses, IPv4-compatible ::/96, the 100::/64 discard prefix,
// local-use NAT64 64:ff9b:1::/48, unique-local fc00::/7, link-local fe80::/10,
// site-local fec0::/10 and multicast ff00::/8.
const V6_GLOBAL_UNICAST = v6Cidr('2000::', 3);

// Inside 2000::/3 but never a public web host.
const BLOCKED_V6_CIDRS = [
  v6Cidr('2001::', 32),     // Teredo (RFC 4380): tunnels to an IPv4 client
  v6Cidr('2001:2::', 48),   // benchmarking (RFC 5180)
  v6Cidr('2001:db8::', 32), // documentation (RFC 3849)
  v6Cidr('3fff::', 20),     // documentation (RFC 9637)
];

function isBlockedV6(ip) {
  const addr = ipv6ToBigInt(ip);
  if (addr === null) return true; // unparseable -> block
  for (const [cidr, offset] of EMBEDDED_V4_V6_CIDRS) {
    if (inV6Cidr(addr, cidr)) return isBlockedV4Int(Number((addr >> offset) & 0xffffffffn));
  }
  if (!inV6Cidr(addr, V6_GLOBAL_UNICAST)) return true;
  return BLOCKED_V6_CIDRS.some((cidr) => inV6Cidr(addr, cidr));
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
 * @param {Function} [options.lookup=dns.lookup] - dns.lookup-compatible resolver
 * @returns {Promise<URL>}
 */
export async function assertSafeUrl(input, options = {}) {
  const allowedProtocols = options.allowedProtocols || ['http:', 'https:'];
  const allowedHosts = options.allowedHosts;
  const lookup = options.lookup || dns.lookup;

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

  // Resolve all A/AAAA records and validate every one (split-horizon DNS can
  // return mixed public/private addresses).
  let addrs;
  try {
    addrs = await promisify(lookup)(hostname, { all: true, verbatim: true });
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

/**
 * Wraps a dns.lookup-compatible resolver for a socket's `lookup` option: the
 * connection gets the resolver's answers only when every one of them is
 * allowed, and fails with the SSRF guard error otherwise. A socket that
 * resolves through it can reach no blocked address, however the name's
 * answers change between lookups.
 *
 * @param {Function} [resolve=dns.lookup]
 * @returns {Function} lookup(hostname, options, callback) for net/http/https
 */
export function guardedLookup(resolve = dns.lookup) {
  return function lookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const settings = typeof options === 'number' ? { family: options } : (options || {});
    const query = { all: true, verbatim: true };
    if (settings.family) query.family = settings.family;
    if (settings.hints) query.hints = settings.hints;
    resolve(hostname, query, (error, addresses) => {
      if (error) {
        callback(error);
        return;
      }
      const answers = Array.isArray(addresses) ? addresses : [];
      if (answers.length === 0) {
        callback(Object.assign(new Error(`SSRF guard: no DNS records for ${hostname}`), { code: 'ENOTFOUND' }));
        return;
      }
      const blocked = answers.find(({ address }) => isBlockedIp(address));
      if (blocked) {
        callback(Object.assign(
          new Error(`SSRF guard: ${hostname} resolves to blocked IP ${blocked.address}`),
          { code: 'SSRF_BLOCKED' },
        ));
        return;
      }
      if (settings.all) callback(null, answers);
      else callback(null, answers[0].address, answers[0].family);
    });
  };
}

// The request headers Node's own fetch() adds, so servers answer this client
// as they answered the fetch() it replaces.
function defaultRequestHeaders(url) {
  return {
    accept: '*/*',
    'accept-language': '*',
    'sec-fetch-mode': 'cors',
    'user-agent': 'node',
    'accept-encoding': url.protocol === 'https:' ? 'br, gzip, deflate' : 'gzip, deflate',
  };
}

const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Undo the content codings Node's fetch() undoes; a body with any other
// coding stays as sent, as fetch() leaves it.
function decodedBody(res) {
  const codings = String(res.headers['content-encoding'] || '')
    .toLowerCase().split(',').map((coding) => coding.trim()).filter(Boolean);
  const decoders = [];
  for (const coding of codings.reverse()) {
    if (coding === 'gzip' || coding === 'x-gzip') {
      decoders.push(zlib.createGunzip({ flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH }));
    } else if (coding === 'deflate') {
      decoders.push(zlib.createInflate({ flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH }));
    } else if (coding === 'br') {
      decoders.push(zlib.createBrotliDecompress({
        flush: zlib.constants.BROTLI_OPERATION_FLUSH,
        finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
      }));
    } else {
      return res;
    }
  }
  if (decoders.length === 0) return res;
  // pipeline destroys every stream when one fails or closes early, so a
  // cancelled body closes the socket and a socket error reaches the body.
  return pipeline(res, ...decoders, () => {});
}

// How Node's fetch() turns on the proxy from the environment, as observed on
// Node 22.11.0, 22.21.0, 22.23.4, 24.0.0, 24.4.1, 24.5.0, 24.22.3 and 26.6.0:
// 'none' never (before 22.21); 'env' any non-empty NODE_USE_ENV_PROXY (24.0 to
// 24.4); 'flag' the last --use-env-proxy or --no-use-env-proxy in NODE_OPTIONS
// then the command line, else NODE_USE_ENV_PROXY=1 (22.21+, 24.5+, 26). Null:
// a version whose rule is not known (23, 25, 27 and later).
function envProxyRule(nodeVersion) {
  const [major, minor] = String(nodeVersion).split('.').map(Number);
  if (major < 22) return 'none';
  if (major === 22) return minor >= 21 ? 'flag' : 'none';
  if (major === 24) return minor >= 5 ? 'flag' : 'env';
  if (major === 26) return 'flag';
  return null;
}

function envProxyEnabled(rule, env, execArgv) {
  if (rule === 'none') return false;
  if (rule === 'env') return Boolean(env.NODE_USE_ENV_PROXY);
  let flag;
  for (const token of [...String(env.NODE_OPTIONS || '').split(/\s+/), ...execArgv]) {
    if (token === '--use-env-proxy') flag = true;
    else if (token === '--no-use-env-proxy') flag = false;
  }
  return flag ?? env.NODE_USE_ENV_PROXY === '1';
}

// Whether NO_PROXY sends `hostname` direct under both NO_PROXY rules of the
// undici versions Node bundles. Older ones (Node 22, early 24) match a plain
// entry exactly and an entry starting with "." or "*" as a suffix; newer ones
// match an entry, without its leading "*." or ".", exactly or as a parent domain.
function noProxySendsDirect(hostname, port, noProxy) {
  const entries = noProxy.split(/[,\s]/).filter(Boolean).map((entry) => {
    const withPort = entry.match(/^(.+):(\d+)$/);
    return { hostname: (withPort ? withPort[1] : entry).toLowerCase(), port: withPort ? Number.parseInt(withPort[2], 10) : 0 };
  });
  if (entries.length === 0) return false;
  if (noProxy === '*') return true;
  const onPort = entries.filter((entry) => !entry.port || entry.port === port);
  const older = onPort.some((entry) => (/^[.*]/.test(entry.hostname)
    ? hostname.endsWith(entry.hostname.replace(/^\*/, ''))
    : hostname === entry.hostname));
  const newer = onPort.some((entry) => {
    const domain = entry.hostname.replace(/^\*?\./, '');
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
  return older && newer;
}

const DEFAULT_PORTS = { 'http:': 80, 'https:': 443 };

/**
 * Whether `fetchSafeUrl` leaves a request for `input` to Node's own fetch():
 * true when fetch() would, or might, send it through a proxy from the
 * environment. Node does that when HTTP_PROXY, HTTPS_PROXY, http_proxy or
 * https_proxy is set and --use-env-proxy or NODE_USE_ENV_PROXY turns it on
 * (`envProxyRule` gives each version's rule), through undici's
 * EnvHttpProxyAgent: http_proxy before HTTP_PROXY; for https, https_proxy, then
 * HTTPS_PROXY, then the http proxy; no proxy for a host NO_PROXY exempts, or
 * for every host when it is "*". Where versions differ, so a request might
 * still use the proxy, it is left to fetch(), as it is on a Node version whose
 * rule is not known whenever a proxy variable is set. The `context` defaults
 * are this process's.
 *
 * @param {string|URL} input
 * @param {{env?: object, execArgv?: string[], nodeVersion?: string}} [context]
 * @returns {boolean}
 */
export function fetchUsesEnvProxy(input, {
  env = process.env,
  execArgv = process.execArgv,
  nodeVersion = process.versions.node,
} = {}) {
  if (!env.HTTP_PROXY && !env.HTTPS_PROXY && !env.http_proxy && !env.https_proxy) return false;
  const rule = envProxyRule(nodeVersion);
  if (rule === null) return true;
  if (!envProxyEnabled(rule, env, execArgv)) return false;
  const url = new URL(input);
  const httpProxy = env.http_proxy ?? env.HTTP_PROXY;
  const httpsProxy = (env.https_proxy ?? env.HTTPS_PROXY) || httpProxy;
  if (!(url.protocol === 'https:' ? httpsProxy : httpProxy)) return false;
  // Brackets stay on an IPv6 host, as NO_PROXY writes it.
  const hostname = url.host.replace(/:\d*$/, '').toLowerCase();
  const port = Number.parseInt(url.port, 10) || DEFAULT_PORTS[url.protocol] || 0;
  return !noProxySendsDirect(hostname, port, env.no_proxy ?? env.NO_PROXY ?? '');
}

/**
 * One GET or HEAD over node:http(s), resolving the host with `lookup` and
 * never following a redirect, answered as a WHATWG Response. A fresh socket
 * per request (no pooling) keeps every connection on the lookup's answer.
 * Cancelling the Response body closes the socket.
 *
 * @param {string|URL} input
 * @param {{method?: string, headers?: HeadersInit, signal?: AbortSignal}} [init]
 * @param {Function} lookup - socket lookup, as `guardedLookup` returns
 * @returns {Promise<Response>}
 */
export function requestWithLookup(input, init = {}, lookup) {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`requestWithLookup: protocol ${url.protocol} is not http or https`);
  }
  const method = String(init.method || 'GET').toUpperCase();
  if ((method !== 'GET' && method !== 'HEAD') || init.body != null) {
    throw new TypeError('requestWithLookup sends only GET and HEAD requests without a body');
  }
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(defaultRequestHeaders(url))) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers: Object.fromEntries(headers),
      lookup,
      agent: false,
      signal: init.signal,
    }, (res) => {
      const status = res.statusCode;
      if (!(status >= 200 && status <= 599)) {
        res.destroy();
        reject(new Error(`Server answered an invalid HTTP status (${status})`));
        return;
      }
      const responseHeaders = new Headers();
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
        responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
      }
      const responseInit = { status, statusText: res.statusMessage || '', headers: responseHeaders };
      if (method === 'HEAD' || NULL_BODY_STATUSES.has(status)) {
        res.destroy();
        resolve(new Response(null, responseInit));
        return;
      }
      const body = REDIRECT_STATUSES.has(status) ? res : decodedBody(res);
      resolve(new Response(Readable.toWeb(body), responseInit));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * fetch() a validated URL without trusting redirects: every hop is re-run
 * through `assertSafeUrl` before it is followed, so a public host cannot
 * bounce the request to a private/metadata address. Without `fetchImpl`, each
 * request connects through `guardedLookup`, so DNS rebinding cannot reach a
 * blocked address either, except a hop `fetchUsesEnvProxy` leaves to Node's
 * fetch() and its environment proxy, which resolves the name itself. A
 * `fetchImpl` replaces both: tests and callers that pin their own connections
 * pass one.
 *
 * Intended for GET-style media downloads (redirect responses are followed as
 * GETs, matching standard fetch semantics for 301/302/303 on bodyless
 * requests).
 *
 * @param {string} input
 * @param {RequestInit} [init]
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - fetch-compatible request function
 * @param {Function} [options.lookup=dns.lookup] - dns.lookup-compatible resolver
 * @param {number} [options.maxRedirects=5]
 * @param {string[]} [options.allowedProtocols]
 * @param {string[]} [options.allowedHosts]
 * @returns {Promise<Response>}
 */
export async function fetchSafeUrl(input, init = {}, options = {}) {
  const {
    fetchImpl = null,
    lookup = dns.lookup,
    maxRedirects = 5,
    allowedProtocols,
    allowedHosts,
  } = options;
  const guardOptions = { lookup };
  if (allowedProtocols) guardOptions.allowedProtocols = allowedProtocols;
  if (allowedHosts) guardOptions.allowedHosts = allowedHosts;
  const pinnedLookup = guardedLookup(lookup);
  const request = fetchImpl || ((url, requestInit) => (fetchUsesEnvProxy(url)
    ? fetch(url, requestInit)
    : requestWithLookup(url, requestInit, pinnedLookup)));

  let current = (await assertSafeUrl(input, guardOptions)).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await request(current, { ...init, redirect: 'manual' });
    const status = response.status;
    if (status < 300 || status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    // Close the redirect's connection before the next hop opens another.
    await response.body?.cancel?.().catch(() => {});
    let nextUrl;
    try {
      nextUrl = new URL(location, current).toString();
    } catch {
      throw new Error('SSRF guard: redirect to an invalid URL');
    }
    await assertSafeUrl(nextUrl, guardOptions);
    current = nextUrl;
  }
  throw new Error(`SSRF guard: too many redirects (more than ${maxRedirects})`);
}

/**
 * Read a Response body into one Buffer, refusing a body longer than
 * `maxBytes` (`code: 'BODY_TOO_LARGE'`, before any byte is read when
 * Content-Length already says so) and one that sends no bytes for `stallMs`
 * (`code: 'BODY_STALLED'`). Either refusal cancels the body, which closes a
 * `requestWithLookup` connection.
 *
 * @param {Response} response
 * @param {{maxBytes?: number, stallMs?: number}} [limits] - stallMs 0 waits forever
 * @returns {Promise<Buffer>}
 */
export async function readResponseBody(response, { maxBytes = Infinity, stallMs = 0 } = {}) {
  const tooLarge = () => Object.assign(
    new Error(`Response body is larger than ${maxBytes} bytes`),
    { code: 'BODY_TOO_LARGE', maxBytes },
  );
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (!response.headers.get('content-encoding') && Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let stalled = false;
  let timer = null;
  const stalledError = () => Object.assign(
    new Error(`Response body sent no data for ${stallMs} ms`),
    { code: 'BODY_STALLED', stallMs },
  );
  const armStallTimer = () => {
    if (!(stallMs > 0)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      reader.cancel().catch(() => {});
    }, stallMs);
  };
  try {
    armStallTimer();
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (stalled) throw stalledError();
        throw error;
      }
      if (stalled) throw stalledError();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(chunk.value);
      armStallTimer();
    }
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks, length);
}

export { isBlockedIp };
