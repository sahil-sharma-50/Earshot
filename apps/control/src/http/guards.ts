import { createHash, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { isPrivate } from '@earshot/shared';

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

/**
 * Pre-check for any-URL targets (the egress proxy enforces the real rule after DNS):
 * http(s) only, no credentials, no IP literals in private/loopback/link-local ranges.
 */
export function checkTargetUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'invalid URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'only http and https URLs are allowed' };
  if (url.username || url.password) return { ok: false, reason: 'URLs with credentials are not allowed' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (PRIVATE_HOST.test(host)) return { ok: false, reason: 'private host' };
  if (net.isIP(host)) {
    if (isPrivate(host)) return { ok: false, reason: 'private address' };
  } else if (!host.includes('.')) {
    // single-label names (store, proxy, control) resolve inside the Docker network
    return { ok: false, reason: 'use a public hostname' };
  }
  return { ok: true, url };
}
