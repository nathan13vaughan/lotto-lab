// Line picking and prize-odds engine. Pure functions, no DOM, so the same code
// runs in the browser and under `node --test`.

export const GAMES = {
  tattslotto: {
    key: "tattslotto", name: "Saturday Lotto", short: "Sat Lotto",
    pool: 45, pick: 6, drawMain: 6, drawSupp: 2, suppLabel: "supps", pbPool: 0,
    // [division, main matches, needs supp (null = either), needs PB]
    divisions: [[1, 6, null], [2, 5, true], [3, 5, false], [4, 4, null], [5, 3, true], [6, 3, false]],
  },
  powerball: {
    key: "powerball", name: "Powerball", short: "Powerball",
    pool: 35, pick: 7, drawMain: 7, drawSupp: 0, suppLabel: "", pbPool: 20,
    divisions: [[1, 7, null, true], [2, 7, null, false], [3, 6, null, true], [4, 6, null, false],
                [5, 5, null, true], [6, 4, null, true], [7, 5, null, false], [8, 3, null, true], [9, 2, null, true]],
  },
  setforlife: {
    key: "setforlife", name: "Set for Life", short: "Set for Life",
    pool: 44, pick: 7, drawMain: 7, drawSupp: 2, suppLabel: "bonus", pbPool: 0,
    divisions: [[1, 7, null], [2, 6, true], [3, 6, false], [4, 5, true], [5, 5, false],
                [6, 4, true], [7, 4, false], [8, 3, true]],
  },
};

// ------------------------------------------------------------------ helpers

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function sample(pool, k, rand) {
  const a = Array.from({ length: pool }, (_, i) => i + 1);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (pool - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/** Which division (1 = top) a line wins, or 0 for no prize. */
export function division(game, mainHits, suppHits, pbHit) {
  for (const [div, m, supp, pb] of game.divisions) {
    if (mainHits !== m) continue;
    if (supp === true && suppHits < 1) continue;
    if (supp === false && suppHits > 0) continue;
    if (pb === true && !pbHit) continue;
    if (pb === false && pbHit) continue;
    return div;
  }
  return 0;
}

// ------------------------------------------------------------------ exact odds

/** Exact probability that ONE line wins each division (index = division). */
export function lineOdds(game) {
  const { pool, pick, drawMain, drawSupp, pbPool } = game;
  const total = choose(pool, pick);
  const probs = new Array(game.divisions.length + 1).fill(0);
  const pbOptions = pbPool ? [[true, 1 / pbPool], [false, 1 - 1 / pbPool]] : [[false, 1]];
  for (let m = 0; m <= pick; m++) {
    for (let s = 0; s <= Math.min(drawSupp, pick - m); s++) {
      const rest = pool - drawMain - drawSupp;
      const p = (choose(drawMain, m) * choose(drawSupp, s) * choose(rest, pick - m - s)) / total;
      if (!p) continue;
      for (const [pbHit, pp] of pbOptions) {
        const d = division(game, m, s, pbHit);
        if (d) probs[d] += p * pp;
      }
    }
  }
  probs[0] = probs.slice(1).reduce((a, b) => a + b, 0); // any prize
  return probs;
}

/** Chance that at least one of n independent random quick picks wins a prize. */
export function randomSetChance(game, n) {
  return 1 - (1 - lineOdds(game)[0]) ** n;
}

// ------------------------------------------------------------------ popularity

/**
 * Rough "how many other people pick this" score. Doesn't change the chance of
 * winning, only how many people you'd share a prize with.
 */
export function popularity(line, game, lastDraw = []) {
  const s = [...line].sort((a, b) => a - b);
  const k = s.length;
  let pen = 0;
  const birthday = s.filter((n) => n <= 31).length / k;
  pen += Math.max(0, birthday - 31 / game.pool) * 4;          // birthdays and anniversaries
  let runs = 0;
  for (let i = 1; i < k; i++) if (s[i] - s[i - 1] === 1) runs++;
  pen += runs * 0.6;                                          // 12 13 14 ...
  const diffs = new Set(s.slice(1).map((v, i) => v - s[i]));
  if (diffs.size === 1) pen += 3;                             // 5 10 15 20 ...
  pen += (k - new Set(s.map((n) => n % 10)).size) * 0.3;      // same last digit
  const decades = new Set(s.map((n) => Math.floor(n / 10))).size;
  if (decades <= 2) pen += (k - decades) * 0.15;              // bunched together
  pen += s.filter((n) => n % 7 === 0 || n % 5 === 0).length > k / 2 ? 0.5 : 0; // lucky 7s, round numbers
  const replay = s.filter((n) => lastDraw.includes(n)).length;
  pen += replay >= 3 ? replay * 0.4 : 0;                      // re-playing last draw's numbers
  return pen;
}

// ------------------------------------------------------------------ generator

export const STRATEGIES = {
  pairs:   { label: "Pairs & triples", spread: 0.35, pop: 0.3, bias: 1.0, numberWeight: 0, pairWeight: 1.0, tripleWeight: 0.5,
             blurb: "Builds each game around pairs and groups of three numbers that have come out together more often than chance. Also keeps games reasonably spread. The backtests haven't shown frequent pairs or triples staying frequent, so treat this as testing the idea." },
  spread:  { label: "Best coverage", spread: 1.0, pop: 1.0, bias: 0.0,
             blurb: "Spreads numbers so your games overlap as little as possible, which gives the best chance that at least one game wins a prize. Also avoids number patterns that lots of other people pick." },
  hot:     { label: "Hot numbers", spread: 0.6, pop: 0.6, bias: 1.0,
             blurb: "Leans towards numbers and pairs that have come up more often. The backtests don't show this working, so it's here if you want to test the idea." },
  random:  { label: "Quick Pick", spread: 0, pop: 0, bias: 0,
             blurb: "Plain random games, the same as a Quick Pick in the Lott app." },
};

/**
 * Exact chance that two lines sharing `o` main numbers BOTH win a prize in the
 * same draw (and, for Powerball, whether they carry the same Powerball).
 * Enumerates how the drawn balls fall across the four regions: shared, only A,
 * only B, neither.
 */
export function jointOdds(game, o, samePB = false) {
  const { pool, pick: k, drawMain: D, drawSupp: S, pbPool } = game;
  const sizes = [o, k - o, k - o, pool - 2 * k + o];
  const totMain = choose(pool, D), totSupp = choose(pool - D, S);
  const pbCases = !pbPool ? [[false, false, 1]]
    : samePB ? [[true, true, 1 / pbPool], [false, false, 1 - 1 / pbPool]]
    : [[true, false, 1 / pbPool], [false, true, 1 / pbPool], [false, false, 1 - 2 / pbPool]];
  let p = 0;
  const m = [0, 0, 0, 0], sp = [0, 0, 0, 0];
  for (m[0] = 0; m[0] <= Math.min(sizes[0], D); m[0]++)
  for (m[1] = 0; m[1] <= Math.min(sizes[1], D - m[0]); m[1]++)
  for (m[2] = 0; m[2] <= Math.min(sizes[2], D - m[0] - m[1]); m[2]++) {
    m[3] = D - m[0] - m[1] - m[2];
    if (m[3] > sizes[3]) continue;
    const pm = sizes.reduce((acc, sz, i) => acc * choose(sz, m[i]), 1) / totMain;
    if (!pm) continue;
    for (sp[0] = 0; sp[0] <= Math.min(sizes[0] - m[0], S); sp[0]++)
    for (sp[1] = 0; sp[1] <= Math.min(sizes[1] - m[1], S - sp[0]); sp[1]++)
    for (sp[2] = 0; sp[2] <= Math.min(sizes[2] - m[2], S - sp[0] - sp[1]); sp[2]++) {
      sp[3] = S - sp[0] - sp[1] - sp[2];
      if (sp[3] > sizes[3] - m[3]) continue;
      const ps = sizes.reduce((acc, sz, i) => acc * choose(sz - m[i], sp[i]), 1) / totSupp;
      if (!ps) continue;
      for (const [ha, hb, pp] of pbCases) {
        if (division(game, m[0] + m[1], sp[0] + sp[1], ha) && division(game, m[0] + m[2], sp[0] + sp[2], hb)) p += pm * ps * pp;
      }
    }
  }
  return p;
}

const costCache = {};
/** cost[same][o]: joint-win chance, in units of "two lines sharing one number". */
function pairCosts(game) {
  if (costCache[game.key]) return costCache[game.key];
  const unit = jointOdds(game, 1, false);
  const row = (same) => Array.from({ length: game.pick + 1 }, (_, o) => jointOdds(game, o, same) / unit);
  return (costCache[game.key] = [row(false), game.pbPool ? row(true) : row(false)]);
}

/**
 * Pick n lines. Starts from random lines and improves them by swapping one
 * number (or Powerball) at a time with simulated annealing, minimising:
 *   spread * sum over pairs of lines of their chance of winning together
 *            (the overlap that stops more of your games winning in one draw)
 * + pop    * popularity of each line           (avoid shared prizes)
 * - bias   * shrunk z-scores of numbers / pairs (hot numbers)
 * Keeping joint wins low maximises the chance that at least one line wins.
 */
export function generate(game, n, opts = {}) {
  const st = STRATEGIES[opts.strategy || "spread"];
  const rand = opts.rand || Math.random;
  const { pool, pick, pbPool } = game;
  const stats = opts.stats;
  const trust = opts.trust ?? 0.3;
  const lastDraw = opts.lastDraw || [];

  const lines = Array.from({ length: n }, () => sample(pool, pick, rand));
  let pbs = pbPool ? balancedPowerballs(game, n, rand, opts) : null;
  if (opts.strategy === "random") {
    pbs = pbPool ? lines.map(() => 1 + Math.floor(rand() * pbPool)) : null;
    return finish(lines, pbs);
  }

  const nz = new Float64Array(pool + 1);
  const pz = new Float64Array((pool + 1) * (pool + 1));
  if (stats && st.bias) {
    stats.number_z.forEach((z, i) => (nz[i + 1] = z * trust));
    const pairs = stats.pair_z; // upper triangle, row-major, a<b
    let idx = 0;
    for (let a = 1; a <= pool; a++)
      for (let b = a + 1; b <= pool; b++, idx++) pz[a * (pool + 1) + b] = pz[b * (pool + 1) + a] = pairs[idx] * trust;
  }
  const wNum = st.numberWeight ?? 1, wPair = st.pairWeight ?? 1 / (pick - 1), wTri = st.tripleWeight ?? 0;
  const tz = wTri && stats && st.bias ? tripleZ(game, stats, trust) : null;
  const P1 = pool + 1;
  const lineBias = (l) => {
    if (!st.bias) return 0;
    let s = 0;
    for (let i = 0; i < l.length; i++) {
      s += wNum * nz[l[i]];
      for (let j = i + 1; j < l.length; j++) {
        s += wPair * pz[l[i] * P1 + l[j]];
        if (tz) for (let m = j + 1; m < l.length; m++) s += wTri * tz[(l[i] * P1 + l[j]) * P1 + l[m]];
      }
    }
    return s;
  };
  const lineOwn = (l) => st.pop * popularity(l, game, lastDraw) - st.bias * lineBias(l);

  const legacy = opts.costModel === "overlap2";
  const [costDiff, costSame] = pairCosts(game);
  const cost = (o, same) => (legacy ? o * o : same ? costSame[o] : costDiff[o]);
  const sameAt = (i, j) => (pbs ? pbs[i] === pbs[j] : false);

  // membership matrix and pairwise overlaps
  const has = lines.map((l) => { const h = new Uint8Array(pool + 1); l.forEach((v) => (h[v] = 1)); return h; });
  const ov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) =>
    i === j ? 0 : lines[i].reduce((c, v) => c + has[j][v], 0)));
  const own = lines.map(lineOwn);

  const iters = opts.iters ?? Math.min(160000, 5000 + n * pick * 300);
  let temp = 2.0;
  const cool = Math.pow(0.002 / temp, 1 / iters);
  for (let it = 0; it < iters; it++, temp *= cool) {
    const i = Math.floor(rand() * n);
    if (pbs && !legacy && rand() < 0.15) {
      // move: give line i a different Powerball
      const nb = 1 + Math.floor(rand() * pbPool);
      if (nb === pbs[i]) continue;
      let d = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        d += cost(ov[i][j], pbs[j] === nb) - cost(ov[i][j], pbs[j] === pbs[i]);
      }
      d *= st.spread;
      if (d <= 0 || rand() < Math.exp(-d / temp)) pbs[i] = nb;
      continue;
    }
    const pos = Math.floor(rand() * pick);
    const a = lines[i][pos];
    const b = 1 + Math.floor(rand() * pool);
    if (has[i][b]) continue;
    let dSpread = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const o = ov[i][j], o2 = o - has[j][a] + has[j][b];
      if (o2 !== o) { const same = sameAt(i, j); dSpread += cost(o2, same) - cost(o, same); }
    }
    const cand = lines[i].slice(); cand[pos] = b;
    const newOwn = lineOwn(cand);
    const delta = st.spread * dSpread + newOwn - own[i];
    if (delta <= 0 || rand() < Math.exp(-delta / temp)) {
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o2 = ov[i][j] - has[j][a] + has[j][b];
        ov[i][j] = ov[j][i] = o2;
      }
      has[i][a] = 0; has[i][b] = 1;
      lines[i] = cand; own[i] = newOwn;
    }
  }
  return finish(lines, pbs);
}

/** Powerballs spread evenly over 1..pbPool (hot strategy: hottest first). */
function balancedPowerballs(game, n, rand, opts) {
  const pbs = [];
  while (pbs.length < n) {
    const round = sample(game.pbPool, game.pbPool, rand);
    if (opts.strategy === "hot" && opts.stats?.pb_z) round.sort((x, y) => opts.stats.pb_z[y - 1] - opts.stats.pb_z[x - 1]);
    pbs.push(...round);
  }
  return pbs.slice(0, n);
}

function finish(lines, pbs) {
  return lines.map((l, i) => {
    const out = { numbers: [...l].sort((a, b) => a - b) };
    if (pbs) out.powerball = pbs[i];
    return out;
  });
}

// ------------------------------------------------------------------ evaluation

/**
 * Simulate `sims` random draws and count how often the set wins something.
 * Returns the chance of at least one prize, the chance of each division, and
 * the average number of prizes per draw.
 */
export function evaluate(game, lines, sims = 50000, rand = Math.random) {
  const { pool, drawMain, drawSupp, pbPool } = game;
  const mark = new Uint8Array(pool + 1);
  const anyDiv = new Float64Array(game.divisions.length + 1);
  let anyPrize = 0, prizes = 0;
  const seen = new Uint8Array(game.divisions.length + 1);
  const balls = Array.from({ length: pool }, (_, i) => i + 1);
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < drawMain + drawSupp; i++) {
      const j = i + Math.floor(rand() * (pool - i));
      [balls[i], balls[j]] = [balls[j], balls[i]];
      mark[balls[i]] = i < drawMain ? 1 : 2;
    }
    const pb = pbPool ? 1 + Math.floor(rand() * pbPool) : 0;
    seen.fill(0);
    let won = false;
    for (const l of lines) {
      let m = 0, sp = 0;
      for (const v of l.numbers) { const t = mark[v]; if (t === 1) m++; else if (t === 2) sp++; }
      const d = division(game, m, sp, pbPool ? l.powerball === pb : false);
      if (d) { won = true; prizes++; seen[d] = 1; }
    }
    if (won) anyPrize++;
    for (let d = 1; d < seen.length; d++) anyDiv[d] += seen[d];
    for (let i = 0; i < drawMain + drawSupp; i++) mark[balls[i]] = 0;
  }
  return {
    sims,
    anyPrize: anyPrize / sims,
    perDivision: Array.from(anyDiv, (v) => v / sims),
    expectedPrizes: prizes / sims,
  };
}

/** Check saved lines against an actual draw. */
export function checkLines(game, lines, draw) {
  const main = new Set(draw.main), supp = new Set(draw.supp || []);
  const pb = (draw.powerball || [])[0];
  return lines.map((l) => {
    const m = l.numbers.filter((v) => main.has(v)).length;
    const s = l.numbers.filter((v) => supp.has(v)).length;
    const pbHit = game.pbPool ? l.powerball === pb : false;
    return { mainHits: m, suppHits: s, pbHit, division: division(game, m, s, pbHit) };
  });
}

// ------------------------------------------------------------------ systems

/** Number of standard games in a System m (every k-number combination of m numbers). */
export function systemGames(game, m, powerhit = false) {
  return choose(m, game.pick) * (powerhit ? game.pbPool : 1);
}

/**
 * Exact odds for a System entry of m numbers (plus, for Powerball, either one
 * Powerball on every game or PowerHit = every Powerball).
 * Returns perDivision[d] = chance at least one game in the system wins division d,
 * anyPrize, and expectedPrizes[d] = average number of winning games in division d.
 */
export function systemOdds(game, m, powerhit = false) {
  const { pool, pick: k, drawMain: D, drawSupp: S, pbPool } = game;
  const nd = game.divisions.length;
  const per = new Array(nd + 1).fill(0), expd = new Array(nd + 1).fill(0);
  let any = 0;
  const totMain = choose(pool, D), totSupp = choose(pool - D, S);
  // each case: [probability, [[pbHit, how many copies of each main combination], ...]]
  const pbCases = !pbPool ? [[1, [[false, 1]]]]
    : powerhit ? [[1, [[true, 1], [false, pbPool - 1]]]]   // one copy has the drawn Powerball, the rest don't
    : [[1 / pbPool, [[true, 1]]], [1 - 1 / pbPool, [[false, 1]]]];
  for (let h = 0; h <= Math.min(m, D); h++) {
    const ph = (choose(m, h) * choose(pool - m, D - h)) / totMain;
    if (!ph) continue;
    for (let s = 0; s <= Math.min(m - h, S); s++) {
      const ps = (choose(m - h, s) * choose(pool - D - (m - h), S - s)) / totSupp;
      if (!ps) continue;
      const rest = m - h - s;
      for (const [pp, copies] of pbCases) {
        const won = new Array(nd + 1).fill(0);
        // every game in the system: a main hits, b supp hits, the rest drawn from non-hits
        for (let a = 0; a <= Math.min(h, k); a++) for (let b = 0; b <= Math.min(s, k - a); b++) {
          const c = k - a - b;
          if (c > rest) continue;
          const count = choose(h, a) * choose(s, b) * choose(rest, c);
          for (const [pbHit, mult] of copies) {
            const d = division(game, a, b, pbHit);
            if (d) won[d] += count * mult;
          }
        }
        const p = ph * ps * pp;
        let anyHere = false;
        for (let d = 1; d <= nd; d++) if (won[d]) { per[d] += p; expd[d] += p * won[d]; anyHere = true; }
        if (anyHere) any += p;
      }
    }
  }
  per[0] = any;
  return { games: systemGames(game, m, powerhit), anyPrize: any, perDivision: per, expectedPrizes: expd };
}

/** Pick m numbers for a system: least-popular (or hottest) of many random candidates. */
export function pickSystem(game, m, opts = {}) {
  const rand = opts.rand || Math.random;
  const st = opts.strategy || "spread";
  if (st === "random") return sample(game.pool, m, rand).sort((a, b) => a - b);
  const trust = opts.trust ?? 0.3, nz = opts.stats?.number_z;
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 4000; t++) {
    const c = sample(game.pool, m, rand);
    let score = popularity(c, game, opts.lastDraw || []);
    if (st === "hot" && nz) score -= c.reduce((acc, v) => acc + nz[v - 1] * trust, 0);
    if (st === "pairs" && opts.stats?.pair_z) {
      score -= linePairs(game, c, opts.stats).reduce((acc, x) => acc + x.z, 0) * trust * 4 / (m - 1);
      score -= lineTriples(game, c, opts.stats).reduce((acc, x) => acc + x.z, 0) * trust * 4 / ((m - 1) * (m - 2) / 2);
    }
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best.sort((a, b) => a - b);
}

/** Winning games per division for a System entry against an actual draw. */
export function checkSystem(game, numbers, draw, { powerhit = false, powerball = null } = {}) {
  const main = new Set(draw.main), supp = new Set(draw.supp || []);
  const k = game.pick;
  const h = numbers.filter((v) => main.has(v)).length;
  const s = numbers.filter((v) => supp.has(v)).length;
  const rest = numbers.length - h - s;
  const drawnPB = (draw.powerball || [])[0];
  const copies = !game.pbPool ? [[false, 1]]
    : powerhit ? [[true, 1], [false, game.pbPool - 1]]
    : [[powerball === drawnPB, 1]];
  const won = new Array(game.divisions.length + 1).fill(0);
  for (let a = 0; a <= Math.min(h, k); a++) for (let b = 0; b <= Math.min(s, k - a); b++) {
    const c = k - a - b;
    if (c > rest) continue;
    const count = choose(h, a) * choose(s, b) * choose(rest, c);
    for (const [pbHit, mult] of copies) {
      const d = division(game, a, b, pbHit);
      if (d) won[d] += count * mult;
    }
  }
  return { mainHits: h, suppHits: s, pbHit: game.pbPool ? (powerhit || powerball === drawnPB) : false, won };
}

/** Pairs within a line ranked by how much more often they've been drawn together than chance. */
export function linePairs(game, numbers, stats) {
  if (!stats?.pair_z) return [];
  const idx = (a, b) => (a - 1) * game.pool - ((a - 1) * a) / 2 + (b - a - 1); // upper-triangle index, a<b
  const out = [];
  for (let i = 0; i < numbers.length; i++) for (let j = i + 1; j < numbers.length; j++) {
    const [a, b] = numbers[i] < numbers[j] ? [numbers[i], numbers[j]] : [numbers[j], numbers[i]];
    const k = idx(a, b);
    out.push({ a, b, z: stats.pair_z[k], count: stats.pair_count?.[k], expected: stats.pair_expected });
  }
  return out.sort((x, y) => y.z - x.z);
}

const tripleCache = new WeakMap();
/**
 * Symmetric lookup [a][b][c] (flattened, size (pool+1)^3) of each triple's z-score:
 * how far above or below chance those three numbers have come out in the same draw.
 */
function tripleTable(game, stats) {
  if (tripleCache.has(stats)) return tripleCache.get(stats);
  const P1 = game.pool + 1, e = stats.triple_expected, n = stats.draws || 1;
  const sd = Math.sqrt(e * (1 - e / n));
  const t = new Float32Array(P1 * P1 * P1), cnt = new Int32Array(P1 * P1 * P1);
  let k = 0;
  for (let a = 1; a <= game.pool; a++) for (let b = a + 1; b <= game.pool; b++) for (let c = b + 1; c <= game.pool; c++, k++) {
    const z = (stats.triple_count[k] - e) / sd, v = stats.triple_count[k];
    for (const [x, y, w] of [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]) {
      t[(x * P1 + y) * P1 + w] = z; cnt[(x * P1 + y) * P1 + w] = v;
    }
  }
  const out = { z: t, count: cnt };
  tripleCache.set(stats, out);
  return out;
}

function tripleZ(game, stats, trust) {
  if (!stats?.triple_count) return null;
  const { z } = tripleTable(game, stats);
  return trust === 1 ? z : z.map((v) => v * trust);
}

/** Triples within a line ranked by how much more often they've come out together than chance. */
export function lineTriples(game, numbers, stats) {
  if (!stats?.triple_count) return [];
  const { z, count } = tripleTable(game, stats);
  const P1 = game.pool + 1, s = [...numbers].sort((x, y) => x - y), out = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) for (let m = j + 1; m < s.length; m++) {
    const k = (s[i] * P1 + s[j]) * P1 + s[m];
    out.push({ nums: [s[i], s[j], s[m]], z: z[k], count: count[k], expected: stats.triple_expected });
  }
  return out.sort((x, y) => y.z - x.z);
}
