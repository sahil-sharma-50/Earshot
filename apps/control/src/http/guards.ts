import { createHash, timingSafeEqual } from 'node:crypto';
import net from 'node:net';

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
    const v4 = host.startsWith('::ffff:') ? host.slice(7) : host;
    if (net.isIPv4(v4)) {
      const [a, b] = v4.split('.').map(Number) as [number, number];
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224)
        return { ok: false, reason: 'private address' };
    } else if (/^(::1?$|f[cd]|fe[89ab])/i.test(host)) {
      return { ok: false, reason: 'private address' };
    }
  }
  return { ok: true, url };
}
