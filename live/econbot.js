// live/econbot.js — the economy model behind the economy page's Progress tab (live/econ.html) and gen/econsim.mjs. Its
// bots do not play the game: they take finished runs (real runs played headless by the balance lab, gen/econruns.json —
// when the hero would have died, kills over time, when each boss fell) and live the economy around them: evacuate or
// die, open containers on the map's loot table, keep or lose the bag, sell to Walt, build, upgrade, craft kits, buy
// guns. Many bots → how many raids each purchase takes. A team tool: never shipped (gen/build.mjs leaves it out).
(function (root) {
  'use strict';
  const M = {};

  // what the model assumes about players and about the parts of the game that are not built yet (the page lists them)
  M.ASSUME = {
    raidMin: 6, // the loot tables' `boxes` are the containers a raid of this many minutes opens; longer raids open more
    careful: [0, 60], // half the bots leave within a minute after the evacuation opens (E.EVAC_FROM) ...
    brave: [60, 360], // ... the other half 1 to 6 minutes after it (past 9:00 of the run: they stay for the final boss)
    missionAt: 300, // a story mission's boss comes at 5:00; surviving 30 s after it completes the mission
    kitBoost: 0.1, // each kit taken into a raid makes the hero live 10 % longer
    waltCommon: 3, // Walt has up to this many of each common (rarity 1) item to sell at a base visit; rarer: none
    runs: 150, // raids each bot plays
    bots: 200,
  };

  // a seeded random source (the same inputs give the same report)
  const rng = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // one sampled run, cut at time t: kills, coins, level, the bosses dead by then. Kills and coins are summed per 30 s
  // (run.k, run.cc) and read between bins; samples without the coin curve (an older balance file) spread the run's
  // coins like its kills, which overstates early coins (they come late: boss chests, gold cards).
  function cut(run, t) {
    const B = 30,
      i = Math.min(run.k.length - 1, Math.floor(t / B)),
      f = Math.min(1, t / B - Math.floor(t / B));
    const at = (arr) => {
      const a0 = i > 0 ? arr[i - 1] : 0;
      return a0 + (arr[i] - a0) * f;
    };
    const kills = Math.round(at(run.k));
    const kEnd = run.k[run.k.length - 1] || 1;
    return {
      kills,
      coins: Math.round(run.cc ? at(run.cc) : (run.c * kills) / kEnd),
      lvl: run.l[i] || 1,
      bosses: run.b.filter(([, when]) => when <= t + 0.5).map(([k]) => k), // (kill times are rounded to the second)
    };
  }

  // E: ECONOMY (live/economy.js, the page may pass its edited tables over it); D: DATA (live/data.js); runs: the samples
  M.simulate = (E, D, runs, opts = {}) => {
    const A = { ...M.ASSUME, ...opts };
    const item = {};
    for (const it of E.ITEMS) item[it.id] = it;
    const value = (id) => (item[id] ? item[id].base || 0 : 0);
    const loot = {};
    for (const l of E.LOOT) loot[l.map] = l;
    const keys = []; // every purchase, in a stable order (the report's rows)
    const stats = {}; // key → [raid index of the purchase per bot (or null)]
    const flows = {}; // item → { got, lost, used, sold, bought }
    const per = []; // raid index → { n, coins, died, t, items }
    const waits = {}; // purchase → raids it was the next one and could not be bought: for coins, for items (which)
    const flow = (id) => (flows[id] = flows[id] || { got: 0, lost: 0, used: 0, sold: 0, bought: 0 });

    for (let b = 0; b < A.bots; b++) {
      const rand = rng(1000 + b);
      const brave = b % 2 === 1;
      const P = {
        coins: 0,
        rxp: 0,
        inv: {},
        bld: Object.fromEntries(E.BUILDINGS.map((x) => [x.id, 0])),
        meta: Object.fromEntries(Object.keys(D.META).map((k) => [k, 0])),
        owned: { pistol: true },
        gun: 'pistol',
        wup: { pistol: { dmg: 0, rate: 0, mag: 0 } },
        mast: { pistol: 0 },
        seen: {},
        kits: 0,
        mission: 0,
      };
      const rank = () => D.rankOf(P.rxp).r;
      const has = (id) => P.inv[id] || 0;
      const add = (id, n) => (P.inv[id] = has(id) + n);
      const mastLvl = (g) => {
        let l = 0;
        while (l < D.MASTERY.length && (P.mast[g] || 0) >= D.MASTERY[l]) l++;
        return l;
      };
      const mark = (key, raid) => {
        if (!stats[key]) {
          stats[key] = Array(A.bots).fill(null);
          keys.push(key);
        }
        if (stats[key][b] === null) stats[key][b] = raid;
      };

      // what can be bought now: [key, coins, items, apply]
      const goals = () => {
        const out = [];
        for (const B of E.BUILDINGS) {
          const n = P.bld[B.id];
          if (n >= B.levels.length) continue;
          const lv = B.levels[n];
          if (lv.power && P.bld.generator < lv.power) continue;
          if (B.lockedBy && !P.seen[B.lockedBy]) continue;
          out.push([`b:${B.id}:${n + 1}`, lv.coins, lv.items, () => P.bld[B.id]++]);
        }
        for (const m in D.META) {
          const n = P.meta[m];
          if (n >= D.META[m].price.length) continue;
          out.push([`m:${m}:${n + 1}`, D.META[m].price[n], E.UPGRADES.meta[m][n] || [], () => P.meta[m]++]);
        }
        for (const g of D.MAIN_ORDER) {
          const G = D.MAIN[g];
          if (P.owned[g] || G.locked || rank() < G.rank) continue;
          out.push([
            `g:${g}`,
            G.price,
            [],
            () => {
              P.owned[g] = true;
              P.gun = g; // (plays the newest gun)
              P.wup[g] = { dmg: 0, rate: 0, mag: 0 };
              P.mast[g] = P.mast[g] || 0;
            },
          ]);
        }
        const w = P.wup[P.gun],
          ml = mastLvl(P.gun);
        for (const s in D.WEAPON_UP) {
          const n = w[s];
          if (n >= D.WEAPON_UP[s].price.length || n >= ml) continue;
          out.push([`w:${s}:${n + 1}`, D.WEAPON_UP[s].price[n], E.UPGRADES.weapon[s][n] || [], () => w[s]++]);
        }
        // cheapest first; the workbench's repair comes first of all (Walt and Nova point the player to it after mission 1)
        const worth = (g) => (g[0] === 'b:workbench:1' ? -1 : g[1] + g[2].reduce((s, [id, k]) => s + value(id) * k, 0));
        return out.sort((x, y) => worth(x) - worth(y));
      };
      const need = (list) => {
        const n = {};
        for (const g of list) for (const [id, k] of g[2]) n[id] = (n[id] || 0) + k;
        return n;
      };
      // buy everything affordable, cheapest first; a few missing commons come from Walt
      const shop = (raid) => {
        let first = true; // the cheapest purchase left after shopping: what holds it back is written down
        const fromWalt = {}; // what Walt has sold this visit (his shelf: waltCommon of each common)
        for (let guard = 0; guard < 50; guard++) {
          let bought = false;
          for (const g of goals()) {
            let coins = g[1];
            const buy = [];
            const short = [];
            for (const [id, k] of g[2]) {
              const miss = k - has(id);
              if (miss <= 0) continue;
              if (item[id].rarity === 1 && miss <= A.waltCommon - (fromWalt[id] || 0)) {
                buy.push([id, miss]);
                coins += Math.round(value(id) * E.SELL_MARKUP) * miss;
              } else short.push(id);
            }
            if (short.length || P.coins < coins) {
              if (first) {
                const w = (waits[g[0]] = waits[g[0]] || { coins: 0, items: 0, by: {} });
                if (short.length) {
                  w.items++;
                  for (const id of short) w.by[id] = (w.by[id] || 0) + 1;
                } else w.coins++;
                first = false;
              }
              continue;
            }
            P.coins -= coins;
            for (const [id, k] of buy) {
              add(id, k);
              flow(id).bought += k;
              fromWalt[id] = (fromWalt[id] || 0) + k;
            }
            for (const [id, k] of g[2]) {
              add(id, -k);
              flow(id).used += k;
            }
            g[3]();
            mark(g[0], raid);
            bought = true;
            break;
          }
          if (!bought) return;
        }
      };
      // everything any later level still needs: the buildings', the hero's upgrades', the played gun's upgrades'
      const reserve = () => {
        const all = {};
        const want = (list) => {
          for (const [id, k] of list) all[id] = (all[id] || 0) + k;
        };
        for (const B of E.BUILDINGS) for (let n = P.bld[B.id]; n < B.levels.length; n++) want(B.levels[n].items);
        for (const m in D.META)
          for (let n = P.meta[m]; n < D.META[m].price.length; n++) want(E.UPGRADES.meta[m][n] || []);
        for (const s in D.WEAPON_UP)
          for (let n = P.wup[P.gun][s]; n < D.WEAPON_UP[s].price.length; n++) want(E.UPGRADES.weapon[s][n] || []);
        return all;
      };
      // sell what no purchase needs any more (trophies once brought home: their lock is open)
      const sell = () => {
        const all = reserve();
        for (const id in P.inv) {
          const extra = has(id) - (all[id] || 0) - (id === 'bandages' || id === 'antiseptic' ? 6 : 0);
          if (extra <= 0 || !item[id] || !value(id)) continue;
          P.inv[id] -= extra;
          P.coins += value(id) * extra;
          flow(id).sold += extra;
        }
      };
      // kits for the next raid from what is not set aside: commons kept for the next three purchases, anything rarer
      // for every later level (a vaccine sample saved for health 5 is not spent on a vaccine kit)
      const craft = () => {
        const soon = need(goals().slice(0, 3)),
          later = reserve();
        const keep = {};
        for (const id in item) keep[id] = item[id].rarity >= 2 ? later[id] || 0 : soon[id] || 0;
        let made = 0;
        for (const r of E.RECIPES) {
          if (made >= E.KITS_PER_RUN - P.kits) break;
          if (P.bld[r.at] < r.level || P.coins < r.coins) continue;
          if (!r.inputs.every(([id, k]) => has(id) - (keep[id] || 0) >= k)) continue;
          P.coins -= r.coins;
          for (const [id, k] of r.inputs) {
            add(id, -k);
            flow(id).used += k;
          }
          made++;
        }
        P.kits += made;
      };

      // one raid on a map: the run's outcome, the containers, the bag
      const raid = (i, map, mission, tutorial) => {
        const run = runs[Math.floor(rand() * runs.length)];
        const [lo, hi] = tutorial
          ? [180, 180]
          : mission
            ? [A.missionAt + 30, A.missionAt + 30] // (the mission boss down and 30 s more: the mission is done)
            : (brave ? A.brave : A.careful).map((x) => E.EVAC_FROM + x);
        let leave = lo + rand() * (hi - lo);
        const death = tutorial ? Infinity : run.d === null ? Infinity : run.d * (1 + A.kitBoost * P.kits);
        let win = false;
        if (!mission && leave >= 540 && run.w && death > run.w) {
          leave = run.w;
          win = true;
        }
        const died = death < leave,
          t = Math.min(leave, death);
        P.kits = 0;
        const o = cut(run, t);
        const bag = {};
        const L = loot[map];
        if (L) {
          const total = L.table.reduce((s, e) => s + e[1], 0);
          const boxes = (L.boxes * t) / 60 / A.raidMin;
          const n = Math.floor(boxes) + (rand() < boxes % 1 ? 1 : 0);
          for (let c = 0; c < n * L.rolls; c++) {
            let pick = rand() * total,
              e = L.table[L.table.length - 1];
            for (const x of L.table)
              if (pick < x[1]) {
                e = x;
                break;
              } else pick -= x[1];
            bag[e[0]] = (bag[e[0]] || 0) + e[2] + Math.floor(rand() * (e[3] - e[2] + 1));
          }
        }
        for (const k of tutorial ? [] : o.bosses) {
          const tr = E.ITEMS.find((it) => it.boss === k);
          if (tr) bag[tr.id] = 1;
        }
        // the bag holds BAG_SLOTS slots (stacks of STACK; a trophy a slot): when it is full, what a later level needs is
        // kept first, then the most worth (one unit of the least wanted item is left behind at a time)
        const cap = P.bld.stash >= 3 ? E.BAG_SLOTS_STASH3 : E.BAG_SLOTS;
        const slots = () =>
          Object.entries(bag).reduce((s, [id, k]) => s + (item[id].kind === 'trophy' ? k : Math.ceil(k / E.STACK)), 0);
        if (slots() > cap) {
          const wanted = reserve();
          const score = (id) => value(id) * ((wanted[id] || 0) > has(id) ? 4 : 1);
          while (slots() > cap) {
            const low = Object.keys(bag).sort((x, y) => score(x) - score(y))[0];
            if (--bag[low] <= 0) delete bag[low];
          }
        }
        let got = 0;
        for (const id in bag) flow(id).got += bag[id];
        if (died) {
          // the safe keeps its slots (the most worth per slot); the rest is lost
          const keep = E.SAFE_SLOTS[P.bld.stash] || 0;
          const order = Object.keys(bag).sort(
            (x, y) => value(y) * Math.min(bag[y], E.STACK) - value(x) * Math.min(bag[x], E.STACK),
          );
          order.forEach((id, j) => {
            const k = j < keep ? Math.min(bag[id], item[id].kind === 'trophy' ? 1 : E.STACK) : 0;
            flow(id).lost += bag[id] - k;
            bag[id] = k;
          });
        }
        for (const id in bag)
          if (bag[id] > 0) {
            add(id, bag[id]);
            P.seen[id] = true;
            got += bag[id];
          }
        const xp = Object.values(D.runXp({ t, kills: o.kills, bosses: o.bosses.length, win, lvl: o.lvl })).reduce(
          (a, c) => a + c,
          0,
        );
        const r0 = rank();
        P.rxp += xp;
        let coins = o.coins + (win ? (A.winBonus ?? 500) : 0);
        for (let r = r0 + 1; r <= rank(); r++) coins += D.RANK_COINS(r);
        P.coins += coins;
        P.mast[P.gun] = (P.mast[P.gun] || 0) + o.kills;
        const s = (per[i] = per[i] || { n: 0, coins: 0, died: 0, t: 0, items: 0, rank: 0 });
        s.n++;
        s.coins += coins;
        s.died += died ? 1 : 0;
        s.t += t;
        s.items += got;
        s.rank += rank();
        return !died;
      };

      for (let i = 0; i < A.runs; i++) {
        const ms = E.MISSIONS.filter((m) => !m.soon);
        if (P.mission < ms.length) {
          const m = ms[P.mission];
          // mission 1 is the scripted tutorial at the office (its map has no containers); the others are raids
          const ok = raid(i, P.mission === 0 ? 'office' : m.map, true, P.mission === 0);
          if (ok || P.mission === 0) {
            const r0 = rank();
            P.coins += m.reward.coins;
            P.rxp += m.reward.xp;
            for (let r = r0 + 1; r <= rank(); r++) P.coins += D.RANK_COINS(r); // (every rank passed pays, as in a run)
            for (const [id, k] of m.reward.items) {
              add(id, k);
              P.seen[id] = true;
              flow(id).got += k;
            }
            mark('q:' + m.id, i);
            P.mission++;
          }
        } else {
          // the map whose loot covers more of what the next purchases need
          const want = need(goals().slice(0, 4));
          let best = null,
            bestV = -1;
          for (const l of E.LOOT) {
            if (l.map === 'office') continue;
            const tot = l.table.reduce((s, e) => s + e[1], 0);
            const v = l.table.reduce((s, e) => s + (want[e[0]] ? (e[1] / tot) * value(e[0]) : 0), 0);
            if (v > bestV) {
              bestV = v;
              best = l.map;
            }
          }
          raid(i, best || 'suburb', false);
        }
        sell();
        shop(i);
        craft();
      }
    }
    return { A, keys, stats, flows, per, waits, bots: A.bots, runs: A.runs };
  };

  // the report's rows: a purchase and the raids it took (median, quarter of the bots sooner, quarter later, share that got it)
  M.summary = (res) => {
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    return res.keys.map((key) => {
      const got = res.stats[key].filter((x) => x !== null).sort((a, b) => a - b);
      const all = res.stats[key].map((x) => (x === null ? Infinity : x)).sort((a, b) => a - b);
      return {
        key,
        share: got.length / res.bots,
        p25: q(all, 0.25) + 1,
        med: q(all, 0.5) + 1,
        p75: q(all, 0.75) + 1,
      };
    });
  };

  root.ECONBOT = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
