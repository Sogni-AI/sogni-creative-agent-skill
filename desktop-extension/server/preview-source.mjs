import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isBlockedIp } from '../../ssrf-guard.mjs';

// Only preview ingestion is bounded here. Full-resolution outputs remain in
// the text result, including images too large to process as inline previews.
export const PREVIEW_SOURCE_MAX_BYTES = 128 * 1024 * 1024;

function tooLarge() {
  return Object.assign(new Error('Preview source is too large'), { code: 'PREVIEW_SOURCE_TOO_LARGE' });
}

// Validate the addresses returned for the actual socket connection, rather
// than checking one DNS result and allowing a second lookup during fetch.
export function publicPreviewLookup(hostname, options, callback, resolve = lookup) {
  resolve(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses?.length || addresses.some(({ address }) => isBlockedIp(address))) {
      return callback(new Error('Preview address is unavailable'));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function previewUrl(value) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || !hostname || (isIP(hostname) && isBlockedIp(hostname))) {
    throw new Error('Preview URL is unavailable');
  }
  return url;
}

export async function readPreviewUrl(value, {
  signal, maxBytes = PREVIEW_SOURCE_MAX_BYTES,
  requestImpl = (url, options, callback) => (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, callback),
} = {}) {
  let url = previewUrl(value);
  for (let hop = 0; hop <= 5; hop += 1) {
    signal?.throwIfAborted();
    const response = await new Promise((resolve, reject) => {
      const req = requestImpl(url, { method: 'GET', signal, lookup: publicPreviewLookup }, resolve);
      req.on('error', reject);
      req.end();
    });
    try {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        url = previewUrl(new URL(response.headers.location, url));
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('Preview download failed');
      if (Number(response.headers['content-length']) > maxBytes) throw tooLarge();
      const chunks = [];
      let length = 0;
      for await (const chunk of response) {
        length += chunk.length;
        if (length > maxBytes) throw tooLarge();
        chunks.push(chunk);
      }
      return {
        data: Buffer.concat(chunks, length),
        mime: String(response.headers['content-type'] ?? '').split(';')[0].trim(),
      };
    } finally {
      // Also cancel redirect/error bodies; never drain an unbounded response.
      response.destroy();
    }
  }
  throw new Error('Preview download redirected too many times');
}

export async function readPreviewFile(path, maxBytes = PREVIEW_SOURCE_MAX_BYTES) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Preview source is not a regular file');
    if (stat.size > maxBytes) throw tooLarge();
    const chunks = [];
    let length = 0;
    while (true) {
      // Read at most one byte past the budget, including if the file grows
      // between stat and read. The handle keeps the same file across renames.
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - length + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) return Buffer.concat(chunks, length);
      length += bytesRead;
      if (length > maxBytes) throw tooLarge();
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
}
