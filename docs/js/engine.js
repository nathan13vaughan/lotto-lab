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
                [5, 5, null, true], [6, 5, null, false], [7, 4, null, true], [8, 3, null, true], [9, 2, null, true]],
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
  spread:  { label: "Best coverage", spread: 1.0, pop: 1.0, bias: 0.0,
             blurb: "Spreads numbers so your games overlap as little as possible, which gives the best chance that at least one game wins a prize. Also avoids number patterns that lots of other people pick." },
  hot:     { label: "Hot numbers", spread: 0.6, pop: 0.6, bias: 1.0,
             blurb: "Leans towards numbers and pairs that have come up more often. The backtests don't show this working, so it's here if you want to test the idea." },
  random:  { label: "Quick Pick", spread: 0, pop: 0, bias: 0,
             blurb: "Plain random games, the same as a Quick Pick in the Lott app." },
};

/**
 * Pick n lines. Starts from random lines and improves them by swapping one
 * number at a time (simulated annealing), minimising:
 *   spread * sum over line pairs of overlap^2   (keep games different)
 * + pop    * popularity of each line           (avoid shared prizes)
 * - bias   * shrunk z-scores of numbers / pairs (hot numbers)
 */
export function generate(game, n, opts = {}) {
  const st = STRATEGIES[opts.strategy || "spread"];
  const rand = opts.rand || Math.random;
  const { pool, pick } = game;
  const stats = opts.stats;
  const trust = opts.trust ?? 0.3;
  const lastDraw = opts.lastDraw || [];

  let lines = Array.from({ length: n }, () => sample(pool, pick, rand));
  if (opts.strategy === "random" || !st.spread && !st.pop && !st.bias) {
    return finish(game, lines, rand, opts);
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
  const lineBias = (l) => {
    if (!st.bias) return 0;
    let s = 0;
    for (let i = 0; i < l.length; i++) {
      s += nz[l[i]];
      for (let j = i + 1; j < l.length; j++) s += pz[l[i] * (pool + 1) + l[j]] / (pick - 1);
    }
    return s;
  };
  const lineOwn = (l) => st.pop * popularity(l, game, lastDraw) - st.bias * lineBias(l);

  // membership matrix and pairwise overlaps
  const has = lines.map((l) => { const h = new Uint8Array(pool + 1); l.forEach((v) => (h[v] = 1)); return h; });
  const ov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) =>
    i === j ? 0 : lines[i].reduce((c, v) => c + has[j][v], 0)));
  const own = lines.map(lineOwn);

  const iters = opts.iters ?? Math.min(60000, 4000 + n * pick * 250);
  let temp = 2.0;
  const cool = Math.pow(0.002 / temp, 1 / iters);
  for (let it = 0; it < iters; it++, temp *= cool) {
    const i = Math.floor(rand() * n);
    const pos = Math.floor(rand() * pick);
    const a = lines[i][pos];
    let b = 1 + Math.floor(rand() * pool);
    if (has[i][b]) continue;
    let dSpread = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const o = ov[i][j], o2 = o - has[j][a] + has[j][b];
      dSpread += o2 * o2 - o * o;
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
  return finish(game, lines, rand, opts);
}

function finish(game, lines, rand, opts) {
  const out = lines.map((l) => ({ numbers: [...l].sort((a, b) => a - b) }));
  if (game.pbPool) {
    // Powerballs: spread evenly across 1..pbPool, in random order
    const pbs = [];
    while (pbs.length < out.length) {
      const round = sample(game.pbPool, game.pbPool, rand);
      if (opts.strategy === "hot" && opts.stats?.pb_z) {
        round.sort((x, y) => opts.stats.pb_z[y - 1] - opts.stats.pb_z[x - 1]);
      }
      pbs.push(...round);
    }
    out.forEach((l, i) => (l.powerball = opts.strategy === "random" ? 1 + Math.floor(rand() * game.pbPool) : pbs[i]));
  }
  return out;
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
