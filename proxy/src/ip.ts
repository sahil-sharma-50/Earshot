import net from 'node:net';

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8],        // "this" network
  ['10.0.0.0', 8],       // RFC1918
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],    // RFC1918 (Docker bridge networks live here)
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.168.0.0', 16],   // RFC1918
  ['198.18.0.0', 15],    // benchmarking
  ['224.0.0.0', 3],      // multicast + reserved + broadcast
];

function v4Private(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Expands an IPv6 address to 8 hextets. Handles :: and an embedded dotted IPv4 tail. */
function v6Hextets(ip: string): number[] {
  let s = ip.toLowerCase().split('%')[0]!;
  const v4tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4tail) {
    const n = v4ToInt(v4tail[1]!);
    s = s.slice(0, -v4tail[1]!.length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16));
  }
  const [head, tail] = s.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
}

/**
 * True for every address a sandbox must never reach in any-url mode:
 * RFC1918, loopback, link-local/metadata, CGNAT, ULA, multicast, unspecified,
 * and IPv4-mapped forms of those. Anything unparseable counts as private.
 */
export function isPrivate(ip: string): boolean {
  const fam = net.isIP(ip.split('%')[0]!);
  if (fam === 4) return v4Private(ip);
  if (fam !== 6) return true;
  const h = v6Hextets(ip);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    if (h[5] === 0 && h[6] === 0 && (h[7] === 0 || h[7] === 1)) return true; // :: and ::1
    const v4 = `${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`;
    return v4Private(v4);
  }
  const first = h[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x0064 && h[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 can embed private v4
  if (first === 0x2002) return true; // 6to4 can embed private v4
  return false;
}
