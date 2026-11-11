// The sim's muzzles (data.js D.HERO3D) made again from live/hero.js as the character editor's save makes them (server/herofile.mjs
// dataWithMuzzles), without the editor: after the hero's clips, the stance (herobake.js) or the tune changed some other way (the
// export, art/hero3d/tactical.py game, rewrites the block from its own fit: put data.js back first). A rules change: raise SIM.REV.
//   node gen/heromuzzles.mjs [--check]   (--check: only print what would change)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dataWithMuzzles, checkTune } from '../server/herofile.mjs';
const f = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'live', 'data.js'),
  T = createRequire(import.meta.url)('../live/hero.js'),
  bad = checkTune(T);
if (bad) {
  console.error('live/hero.js: ' + bad);
  process.exit(1);
}
const text = fs.readFileSync(f, 'utf8'),
  out = dataWithMuzzles(text, T),
  mz = (s) => JSON.parse(/D\.HERO3D = (.*);\r?$/m.exec(s)[1]).mz,
  a = mz(text),
  b = mz(out);
for (const g in b) console.log(g.padEnd(8), JSON.stringify(a[g]), '→', JSON.stringify(b[g]));
if (out === text) console.log('data.js: as it was');
else if (process.argv.includes('--check')) console.log('data.js: would change (--check: not written)');
else {
  fs.writeFileSync(f, out);
  console.log('data.js: written (a rules change: raise SIM.REV)');
}
