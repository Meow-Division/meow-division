// server/ipnet.mjs — the network a request comes from, as the per-address limits count it (server.mjs limited, the
// nonces, wallets.mjs's day cap per address, rooms.mjs's sockets per address). An IPv4 address is its own; an IPv6
// address counts as its /64, the block one home or phone is handed (a client can step through a /64's 2^64 addresses
// at will, so a limit per address would never bite); an IPv4 address mapped into IPv6 (::ffff:1.2.3.4, as a dual-stack
// socket shows it) is that IPv4 address. Anything else comes back as it was (one key of its own).
import net from 'node:net';

// the eight 16-bit groups of an IPv6 address (null: not one)
function groups(a) {
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const part = (s) => {
    if (!s) return [];
    const g = s.split(':'),
      last = g[g.length - 1];
    if (last.includes('.')) {
      if (!net.isIPv4(last)) return null;
      const b = last.split('.').map(Number);
      g.splice(g.length - 1, 1, ((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16));
    }
    return g;
  };
  const head = part(halves[0]),
    tail = halves.length === 2 ? part(halves[1]) : [];
  if (!head || !tail) return null;
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const all = [...head, ...new Array(fill).fill('0'), ...tail].map((x) => parseInt(x, 16));
  return all.length === 8 && all.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? all : null;
}

export function netOf(ip) {
  let a = String(ip || '').trim();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%'); // (a link-local address's zone: fe80::1%eth0)
  if (zone >= 0) a = a.slice(0, zone);
  if (net.isIPv4(a)) return a;
  if (!net.isIPv6(a)) return a || '?';
  const g = groups(a.toLowerCase());
  if (!g) return a;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.'); // (IPv4-mapped)
  return g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(':')
    .concat('::/64');
}
