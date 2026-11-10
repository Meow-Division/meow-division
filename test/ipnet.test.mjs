// server/ipnet.mjs: the per-address limits count an IPv6 client by its /64 and an IPv4-mapped address as the IPv4
// address it is, so stepping through one's own /64 (or writing one's IPv4 address the mapped way) gets no fresh limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netOf } from '../server/ipnet.mjs';

test('IPv4 stays as it is; an IPv4-mapped address is that IPv4 address', () => {
  assert.equal(netOf('203.0.113.7'), '203.0.113.7');
  assert.equal(netOf('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(netOf('::FFFF:203.0.113.7'), '203.0.113.7');
  assert.equal(netOf('::ffff:cb00:7107'), '203.0.113.7');
  assert.equal(netOf('0:0:0:0:0:ffff:203.0.113.7'), '203.0.113.7');
});

test('every address of one /64 is one key, the next /64 another', () => {
  const k = netOf('2001:db8:1:2::1');
  assert.equal(k, '2001:db8:1:2::/64');
  for (const a of [
    '2001:db8:1:2:ffff:ffff:ffff:ffff',
    '2001:0db8:0001:0002:0000:0000:0000:0042',
    '2001:DB8:1:2:abcd::9',
    '[2001:db8:1:2::77]',
    '2001:db8:1:2::1.2.3.4',
  ])
    assert.equal(netOf(a), k, a);
  assert.notEqual(netOf('2001:db8:1:3::1'), k);
  assert.equal(netOf('::1'), '0:0:0:0::/64');
  assert.equal(netOf('fe80::1%eth0'), 'fe80:0:0:0::/64');
});

test('what is no address comes back as its own key', () => {
  assert.equal(netOf(''), '?');
  assert.equal(netOf(undefined), '?');
  assert.equal(netOf('not-an-ip'), 'not-an-ip');
});
