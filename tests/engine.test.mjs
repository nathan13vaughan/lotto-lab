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
