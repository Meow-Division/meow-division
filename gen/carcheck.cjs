// Cars on the map: node gen/carcheck.cjs [seed...]  — how many, where (edge band / centre), and the closest pair of identical cars
const S = require('../live/sim.js');
const CAR = /^iso_(car_|van|bus|suv)/;
let bad = 0;
for (const seed of process.argv.slice(2).map(Number).length ? process.argv.slice(2).map(Number) : [1, 7, 42, 1234]) {
  const LV = S.level(seed),
    G = S.G,
    cars = LV.props.filter((p) => CAR.test(p.n));
  const edge = cars.filter((p) => Math.min(p.gx, p.gy, G - p.gx, G - p.gy) < 900),
    by = {};
  for (const p of cars) by[p.n] = (by[p.n] || 0) + 1;
  let near = Infinity,
    pair = null;
  for (let i = 0; i < cars.length; i++)
    for (let j = i + 1; j < cars.length; j++)
      if (cars[i].n === cars[j].n) {
        const d = Math.hypot(cars[i].gx - cars[j].gx, cars[i].gy - cars[j].gy);
        if (d < near) {
          near = d;
          pair = [
            cars[i].n,
            Math.round(cars[i].gx),
            Math.round(cars[i].gy),
            Math.round(cars[j].gx),
            Math.round(cars[j].gy),
          ];
        }
      }
  if (near < 700) bad++;
  console.log(
    JSON.stringify({
      seed,
      cars: cars.length,
      edge: edge.length,
      centre: cars.length - edge.length,
      nearestSame: Math.round(near),
      pair,
      by,
    }),
  );
}
process.exit(bad ? 1 : 0);
