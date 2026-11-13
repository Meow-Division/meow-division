// server/fairqueue.mjs — whose replay is played next, and how much replaying one sender may ask for. The replay workers
// are few (one on the game's host) and a run's replay takes seconds of a core, so a plain first-in-first-out queue lets
// one sender's pile of long runs hold up everybody behind it. makeFairQueue: a queue per sender (an account, or a
// guest's network: ipnet.mjs), served in turns, one job each, so a backlog only delays its own sender. makeBudget: a sum
// per sender over a rolling window (the steps of the runs it sent this hour), refused past its limit.

// push(key, item) adds to the sender's own line; shift() takes the next item of the sender whose turn it is (undefined:
// empty); size: every item waiting. A sender new to the queue joins the end of the round
export function makeFairQueue() {
  const lines = new Map(); // sender → its items, oldest first
  const turns = []; // the senders with something waiting, the next one first
  let size = 0;
  return {
    push(key, item) {
      let line = lines.get(key);
      if (!line) {
        lines.set(key, (line = []));
        turns.push(key);
      }
      line.push(item);
      size++;
    },
    shift() {
      const key = turns.shift();
      if (key === undefined) return undefined;
      const line = lines.get(key),
        item = line.shift();
      if (line.length) turns.push(key);
      else lines.delete(key);
      size--;
      return item;
    },
    get size() {
      return size;
    },
  };
}

// spend(key, n, now) counts n against the sender's window: false (and nothing counted) when it would pass the limit.
// sweep(now) forgets the senders whose window has emptied (called now and then, so the table follows the traffic)
export function makeBudget(limit, windowMs) {
  const spent = new Map(); // sender → [[t, n], …], oldest first
  const fresh = (list, now) => {
    while (list.length && now - list[0][0] >= windowMs) list.shift();
    return list;
  };
  return {
    spend(key, n, now = Date.now()) {
      const list = fresh(spent.get(key) || [], now);
      let sum = n;
      for (const e of list) sum += e[1];
      if (sum > limit) return false;
      list.push([now, n]);
      spent.set(key, list);
      return true;
    },
    sweep(now = Date.now()) {
      for (const [key, list] of spent) if (!fresh(list, now).length) spent.delete(key);
    },
  };
}
