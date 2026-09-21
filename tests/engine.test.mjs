import test from "node:test";
import assert from "node:assert/strict";
import { GAMES, lineOdds, randomSetChance, generate, evaluate, mulberry32, division, checkLines } from "../docs/js/engine.js";

test("division 1 odds match the official odds", () => {
  const expect = { tattslotto: 8145060, powerball: 134490400, setforlife: 38320568 };
  for (const [k, n] of Object.entries(expect)) {
    assert.ok(Math.abs(1 / lineOdds(GAMES[k])[1] - n) < 1, `${k}: ${1 / lineOdds(GAMES[k])[1]}`);
  }
});

test("every division's odds match the official odds (Lotterywest)", () => {
  const official = {
    tattslotto: [8145060, 678755, 36690, 733, 298, 52],
    powerball: [134490400, 7078442, 686176, 36115, 16943, 1173, 892, 188, 65],
    setforlife: [38320568, 2737183, 156411, 25701, 3067, 894, 167, 80],
  };
  for (const [k, odds] of Object.entries(official)) {
    const ours = lineOdds(GAMES[k]).slice(1).map((p) => 1 / p);
    assert.equal(ours.length, odds.length, k);
    ours.forEach((v, i) => assert.ok(Math.abs(v - odds[i]) <= 1, `${k} div ${i + 1}: ${v} vs ${odds[i]}`));
  }
});

test("division rules", () => {
  const t = GAMES.tattslotto;
  assert.equal(division(t, 6, 0), 1);
  assert.equal(division(t, 5, 1), 2);
  assert.equal(division(t, 5, 0), 3);
  assert.equal(division(t, 4, 2), 4);
  assert.equal(division(t, 3, 1), 5);
  assert.equal(division(t, 3, 0), 6);
  assert.equal(division(t, 2, 2), 0);
  const p = GAMES.powerball;
  assert.equal(division(p, 2, 0, true), 9);
  assert.equal(division(p, 3, 0, false), 0);
  assert.equal(division(p, 7, 0, false), 2);
});

test("lines are valid for every game and strategy", () => {
  for (const g of Object.values(GAMES)) for (const strategy of ["spread", "hot", "random"]) {
    const stats = { number_z: Array(g.pool).fill(0).map((_, i) => (i % 5) - 2),
                    pair_z: Array(g.pool * (g.pool - 1) / 2).fill(0.1), pb_z: Array(20).fill(0) };
    const lines = generate(g, 18, { strategy, stats, rand: mulberry32(1) });
    assert.equal(lines.length, 18);
    for (const l of lines) {
      assert.equal(new Set(l.numbers).size, g.pick);
      assert.ok(l.numbers.every((v) => v >= 1 && v <= g.pool));
      if (g.pbPool) assert.ok(l.powerball >= 1 && l.powerball <= g.pbPool);
    }
  }
});

test("coverage strategy beats random quick picks for the chance of any prize", () => {
  for (const g of Object.values(GAMES)) {
    const lines = generate(g, 18, { strategy: "spread", rand: mulberry32(7) });
    const ev = evaluate(g, lines, 200000, mulberry32(99));
    const base = randomSetChance(g, 18);
    const exp = 18 * lineOdds(g)[0];
    console.log(`${g.key}: per-line ${(lineOdds(g)[0] * 100).toFixed(2)}%  random x18 ${(base * 100).toFixed(2)}%  spread x18 ${(ev.anyPrize * 100).toFixed(2)}%  expected prizes ${exp.toFixed(3)} vs ${ev.expectedPrizes.toFixed(3)}`);
    assert.ok(ev.anyPrize > base, g.key);
    assert.ok(Math.abs(ev.expectedPrizes - exp) < 0.01, "expected prizes should not change");
  }
});

test("checkLines", () => {
  const r = checkLines(GAMES.powerball, [{ numbers: [1, 2, 3, 4, 5, 6, 7], powerball: 9 }],
                       { main: [1, 2, 10, 11, 12, 13, 14], powerball: [9] });
  assert.deepEqual(r[0], { mainHits: 2, suppHits: 0, pbHit: true, division: 9 });
});

import { systemOdds, systemGames } from "../docs/js/engine.js";

test("a System of k numbers is just one game", () => {
  for (const g of Object.values(GAMES)) {
    const so = systemOdds(g, g.pick);
    const lo = lineOdds(g);
    assert.equal(so.games, 1);
    lo.forEach((p, d) => assert.ok(Math.abs(so.perDivision[d] - p) < 1e-12, `${g.key} div ${d}`));
  }
});

test("system odds match a simulation of its expanded games", () => {
  const combos = (arr, k) => k === 0 ? [[]] : arr.flatMap((v, i) => combos(arr.slice(i + 1), k - 1).map((c) => [v, ...c]));
  for (const [key, m, powerhit] of [["tattslotto", 8, false], ["setforlife", 9, false], ["powerball", 8, false], ["powerball", 7, true]]) {
    const g = GAMES[key];
    const nums = Array.from({ length: m }, (_, i) => i * 3 + 2);
    const lines = [];
    for (const c of combos(nums, g.pick)) {
      if (g.pbPool) for (const pb of powerhit ? Array.from({ length: g.pbPool }, (_, i) => i + 1) : [7]) lines.push({ numbers: c, powerball: pb });
      else lines.push({ numbers: c });
    }
    assert.equal(lines.length, systemGames(g, m, powerhit));
    const exact = systemOdds(g, m, powerhit);
    const sim = evaluate(g, lines, 200000, mulberry32(5));
    assert.ok(Math.abs(exact.anyPrize - sim.anyPrize) < 0.004, `${key} S${m}${powerhit ? " PowerHit" : ""}: ${exact.anyPrize} vs ${sim.anyPrize}`);
    const expTotal = exact.expectedPrizes.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(expTotal - sim.expectedPrizes) < 0.02 * Math.max(1, expTotal), `${key} expected prizes ${expTotal} vs ${sim.expectedPrizes}`);
  }
});

import { checkSystem } from "../docs/js/engine.js";

test("checkSystem counts winning games like checking every expanded game", () => {
  const g = GAMES.tattslotto;
  const nums = [1, 10, 27, 32, 13, 26, 40, 41]; // System 8
  const draw = { main: [1, 10, 27, 32, 33, 39], supp: [13, 26] };
  const r = checkSystem(g, nums, draw);
  const combos = (arr, k) => k === 0 ? [[]] : arr.flatMap((v, i) => combos(arr.slice(i + 1), k - 1).map((c) => [v, ...c]));
  const brute = new Array(7).fill(0);
  checkLines(g, combos(nums, 6).map((c) => ({ numbers: c })), draw).forEach((x) => x.division && brute[x.division]++);
  assert.deepEqual(r.won, brute);
});
