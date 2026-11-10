// test/kit.test.mjs — the office's wall kit (gen/m1art.py kit=): its pieces' exact footprints, and a doorway through a
// piece (PROP gap): the wall either side of an open door stops a body, the doorway lets it through, turned or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  MAP_IN = require('../live/map_office_in.js');

test('kit pieces have exact footprints: a wall 250 x 30, a half 125 x 30, a pillar and a rack 50 x 50', () => {
  const P = SIM.PROP;
  for (const n of Object.keys(P).filter((k) => /^m1_wk_/.test(k))) {
    const d = P[n],
      f = [d.fw, d.fh].sort((a, b) => a - b).join('x');
    assert.ok(d.kit, n + ' is a kit piece');
    assert.ok(['30x250', '30x125', '50x50'].includes(f), n + ' ' + f);
  }
});

test('an open door lets a body through its doorway; the wall either side stops it', () => {
  const doors = Object.keys(SIM.PROP).filter((n) => /^m1_wk_.*open/.test(n) && SIM.PROP[n].gap);
  assert.ok(doors.length >= 6, 'the open doors: ' + doors.join());
  try {
    for (const n of doors)
      for (const dir of [0, 1]) {
        const m = JSON.parse(JSON.stringify(MAP_IN)),
          gx = 2400,
          gy = 2400;
        m.props = [[n, gx, gy, dir]];
        SIM.setMap(m, 'office_in');
        const S = SIM.create({ seed: SIM.OFFICE_IN, rs: 1 }),
          d = SIM.PROP[n],
          along = (dir & 1 ? d.fh : d.fw) >= (dir & 1 ? d.fw : d.fh),
          len = Math.max(d.fw, d.fh),
          at = (u) => SIM.toS(along ? gx - len / 2 + len * u : gx, along ? gy : gy - len / 2 + len * u);
        const [dx, dy] = at(0.5),
          [wx, wy] = at(d.gap[0] / 2);
        assert.ok(!SIM.blockedAt(S, dx, dy, 18), n + ' turned ' + dir + ': its doorway lets through');
        assert.ok(SIM.blockedAt(S, wx, wy, 18), n + ' turned ' + dir + ': the wall beside its door stops');
      }
  } finally {
    SIM.setMap(MAP_IN, 'office_in');
  }
});
