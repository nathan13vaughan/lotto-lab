import {
  GAMES, STRATEGIES, generate, evaluate, lineOdds, randomSetChance, checkLines,
  systemOdds, systemGames, pickSystem, checkSystem, linePairs, lineTriples,
} from "./engine.js";

const $ = (id) => document.getElementById(id);
const STORE = "lotto-lab:v1";
const COUNT_CHIPS = [6, 12, 18, 24, 36, 50];
const DRAW_DAY = { tattslotto: 6, powerball: 4, setforlife: null }; // 0 = Sunday; null = daily
const DRAW_TEXT = { tattslotto: "Saturday", powerball: "Thursday", setforlife: "Every day" };

// ------------------------------------------------------------------ state

const defaults = { game: "tattslotto", counts: {}, strategy: {}, price: {}, trust: 0.3, sets: {}, mode: {}, sys: {}, powerhit: {} };
let state = load();
let stats = null;

function load() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE) || "{}") }; }
  catch { return { ...defaults }; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode: keep in memory */ }
}

const game = () => GAMES[state.game];
const count = () => state.counts[state.game] ?? 18;
const strategy = () => state.strategy[state.game] ?? "pairs";
const isSystem = () => state.mode[state.game] === "system";
const powerhit = () => !!game().pbPool && !!state.powerhit[state.game];
const sysMin = () => (powerhit() ? game().pick : game().pick + 1);
const sysSize = () => Math.max(sysMin(), Math.min(20, state.sys[state.game] ?? game().pick + 2));

// In System mode the strategies mean something slightly different: a system
// covers every combination of its numbers, so there's nothing to spread.
const SYSTEM_STRATEGY = {
  pairs: { label: "Pairs & triples", blurb: "Picks numbers that have often come out together in pairs and threes, so the system is full of frequent groups. Also avoids popular patterns." },
  spread: { label: "Least popular", blurb: "Picks numbers other players are less likely to choose (fewer birthdays, runs and patterns), so any prize is shared with fewer people." },
  hot: { label: "Hot numbers", blurb: "Leans towards numbers that have come up more often. The backtests don't show this working." },
  random: { label: "Random", blurb: "Plain random numbers, like a Quick Pick system." },
};
const strategyInfo = (k) => (isSystem() ? SYSTEM_STRATEGY[k] : STRATEGIES[k]);

// ------------------------------------------------------------------ formatting

const pct = (p) => (p >= 0.1 ? (p * 100).toFixed(1) : (p * 100).toFixed(2)) + "%";
const oneIn = (p) => "1 in " + Math.round(1 / p).toLocaleString("en-AU");
const fmtDate = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-AU", opts);
const money = (v) => v.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const DRAW_STEP = { tattslotto: 2, powerball: 1, setforlife: 1 }; // draw numbers go up by this

/** The draw a ticket bought now would be in: {no, date} or null if unknown. */
function upcomingDraw(key) {
  const up = stats?.games[key]?.upcoming;
  if (!up?.draw_number || !up.draw_close) return null;
  let no = up.draw_number, when = new Date(up.draw_close);
  const days = DRAW_DAY[key] == null ? 1 : 7;
  while (Date.now() > when.getTime()) { no += DRAW_STEP[key]; when = new Date(when.getTime() + days * 864e5); }
  return { no, when };
}

function nextDraw(key) {
  const up = upcomingDraw(key);
  if (up) {
    const same = up.when.toDateString() === new Date().toDateString();
    return same ? "tonight" : up.when.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  }
  const d = new Date();
  const day = DRAW_DAY[key];
  if (day == null) return "tonight";
  const diff = (day - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return diff === 0 ? "tonight" : d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function ballsHTML(line, g, draw) {
  const main = draw ? new Set(draw.main) : null;
  const supp = draw ? new Set(draw.supp || []) : null;
  let h = line.numbers.map((n) => {
    const cls = !draw ? "" : main.has(n) ? " hit" : supp.has(n) ? " hit supp" : " miss";
    return `<span class="ball${cls}">${n}</span>`;
  }).join("");
  if (g.pbPool && line.powerball) {
    const cls = draw ? ((draw.powerball || [])[0] === line.powerball ? " hit" : " miss") : "";
    h += `<span class="ball sep"></span><span class="ball pb${cls}" title="Powerball">${line.powerball}</span>`;
  }
  return `<div class="balls">${h}</div>`;
}

function drawBallsHTML(draw, g) {
  let h = draw.main.map((n) => `<span class="ball">${n}</span>`).join("");
  if (draw.supp?.length) h += `<span class="ball sep"></span>` + draw.supp.map((n) => `<span class="ball supp">${n}</span>`).join("");
  if (g.pbPool && draw.powerball?.length) h += `<span class="ball sep"></span><span class="ball pb">${draw.powerball[0]}</span>`;
  return `<div class="balls">${h}</div>`;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 1800);
}

// ------------------------------------------------------------------ render

function renderTabs() {
  $("gameTabs").innerHTML = Object.values(GAMES).map((g) =>
    `<button type="button" role="tab" data-game="${g.key}" aria-selected="${g.key === state.game}">
       ${g.short}<small>${DRAW_TEXT[g.key]}</small></button>`).join("");
}

function renderControls() {
  const g = game();
  const sys = isSystem();
  document.querySelectorAll("#modeSeg [data-mode]").forEach((b) =>
    b.setAttribute("aria-checked", String((b.dataset.mode === "system") === sys)));
  $("h-games").textContent = sys ? "System size" : "How many games?";
  if (sys) {
    const m = sysSize(), n = systemGames(g, m, powerhit());
    $("count").textContent = m;
    $("countNote").textContent = `System ${m}${powerhit() ? " PowerHit" : ""} = ${n.toLocaleString("en-AU")} games`;
    const sizes = [];
    for (let v = sysMin(); v <= Math.min(20, sysMin() + 5); v++) sizes.push(v);
    $("countChips").innerHTML = sizes.map((v) =>
      `<button type="button" data-count="${v}" aria-pressed="${v === m}">${v}</button>`).join("")
      + (g.pbPool ? `<button type="button" data-powerhit="1" aria-pressed="${powerhit()}">PowerHit</button>` : "");
  } else {
    $("count").textContent = count();
    $("countNote").textContent = "";
    $("countChips").innerHTML = COUNT_CHIPS.map((n) =>
      `<button type="button" data-count="${n}" aria-pressed="${n === count()}">${n}</button>`).join("");
  }
  $("strategyChips").innerHTML = Object.keys(STRATEGIES).map((k) =>
    `<button type="button" role="radio" data-strategy="${k}" aria-checked="${k === strategy()}">${strategyInfo(k).label}</button>`).join("");
  $("strategyBlurb").textContent = strategyInfo(strategy()).blurb;
  $("leanField").hidden = !["pairs", "hot"].includes(strategy());
  $("price").value = state.price[state.game] ?? "";
  $("trust").value = state.trust;
}

/** "tonight" / "on Sat, 26 Sept" for the upcoming draw, or "in draw 4713" for a past one. */
function setDrawText(key, set) {
  const up = upcomingDraw(key);
  if (set.forDraw && up && set.forDraw < up.no) return `in draw ${set.forDraw}`;
  const nd = nextDraw(key);
  return nd === "tonight" ? "tonight" : "on " + nd;
}

/** Average prize per division over the recent draws we have dividends for. */
function avgDividends(key) {
  const out = {};
  for (const d of stats?.games[key]?.dividends || []) {
    for (const [div, v] of Object.entries(d.divisions)) {
      if (!v.winners || !v.each) continue;
      (out[div] ||= []).push(v.each);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
}

function prizeBreakdown(g, set) {
  const odds = lineOdds(g);
  const n = set.type === "system" ? set.system.games : set.lines.length;
  const avg = avgDividends(g.key);
  const per = set.eval?.perDivision;
  const exact = !!set.eval?.exact;
  const jackpot = stats?.games[g.key]?.upcoming?.jackpot_text;
  let back = 0;
  const rows = g.divisions.map(([d, m, supp, pb]) => {
    const need = `${m}${supp === true ? ` + ${g.suppLabel === "bonus" ? "bonus" : "supp"}` : ""}${pb === true ? " + PB" : ""}`;
    // rare divisions: the simulation barely sees them, so use the exact single-game odds
    const chance = exact ? per[d] : per && n * odds[d] > 0.02 ? per[d] : 1 - (1 - odds[d]) ** n;
    const prize = d === 1 ? (jackpot || "Jackpot") : avg[d] ? money(avg[d]) : "–";
    if (d !== 1 && avg[d]) back += n * odds[d] * avg[d];
    return `<tr><td>Div ${d}</td><td>${need}</td><td>${chance < 0.001 ? oneIn(chance) : pct(chance)}</td><td>${prize}</td></tr>`;
  }).join("");
  const price = parseFloat(state.price[g.key]);
  return `<details class="breakdown"><summary>Chance of each prize</summary>
    <table><thead><tr><th></th><th>Match</th><th>Your chance</th><th>Avg prize</th></tr></thead><tbody>${rows}</tbody></table>
    <p>Your chance: at least one of your ${n} games wins that division this draw. Average prizes are from the last ${stats?.games[g.key]?.dividends?.length || 0} draws.</p>
    ${back ? `<p>On average these ${n} games win back about <b>${money(back)}</b> a draw, not counting Division 1${price > 0 ? `, against a ticket cost of ${money(n * price)}` : ""}. That's the same for any ${n} games.</p>` : ""}
  </details>`;
}

function renderResults() {
  const set = state.sets[state.game];
  const g = game();
  if (!set) { $("results").hidden = true; return; }
  $("results").hidden = false;
  if (set.type === "system") return renderSystemResults(g, set);
  const odds = lineOdds(g);
  const n = set.lines.length;
  const base = randomSetChance(g, n);
  const ours = set.strategy === "random" ? base : (set.eval?.anyPrize ?? base);
  const price = parseFloat(state.price[state.game]);
  const gain = ours - base;
  $("summary").innerHTML = `
    <div class="big">${pct(ours)} <small>chance at least one game wins a prize ${setDrawText(g.key, set)}</small></div>
    <div class="bar" role="img" aria-label="Your games ${pct(ours)} versus Quick Pick ${pct(base)}">
      <i class="base" style="width:${(base * 100).toFixed(2)}%"></i><i class="ours" style="width:${(ours * 100).toFixed(2)}%"></i>
    </div>
    <div class="legend"><span><b style="background:var(--accent)"></b>These ${n} games</span><span><b style="background:var(--muted);opacity:.6"></b>${n} Quick Picks: ${pct(base)}</span></div>
    ${set.strategy !== "random" && gain > 0.001 ? `<div class="row"><span>Better than Quick Pick by</span><span>+${(gain * 100).toFixed(1)} points</span></div>` : ""}
    <div class="row"><span>Each game wins a prize</span><span>${oneIn(odds[0])}</span></div>
    <div class="row"><span>Each game wins Division 1</span><span>${oneIn(odds[1])}</span></div>
    <div class="row"><span>Average prizes per draw</span><span>${(n * odds[0]).toFixed(2)} (same for any ${n} games)</span></div>
    ${price > 0 ? `<div class="row"><span>Ticket cost (${n} × ${money(price)})</span><span>${money(n * price)}</span></div>` : ""}
    ${prizeBreakdown(g, set)}
    <div class="row"><span>Picked</span><span>${new Date(set.createdAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · ${STRATEGIES[set.strategy].label}</span></div>`;
  const s = stats?.games[g.key];
  const caption = (l) => {
    if (set.strategy !== "pairs" || !s?.pair_count) return "";
    const tri = lineTriples(g, l.numbers, s)[0];
    const pair = linePairs(g, l.numbers, s)[0];
    const bits = [];
    if (tri && tri.z > 0) bits.push(`<b>${tri.nums.join(", ")}</b> together ${tri.count}× (usual ${fmtUsual(tri.expected)})`);
    if (pair && pair.z > 0) bits.push(`<b>${pair.a} & ${pair.b}</b> ${pair.count}× (usual ${fmtUsual(pair.expected)})`);
    return bits.length ? `<div class="pairnote">${bits.join(" · ")}</div>` : "";
  };
  $("lines").innerHTML = set.lines.map((l, i) =>
    `<li data-i="${i}" class="${set.entered?.[i] ? "done" : ""}" aria-pressed="${!!set.entered?.[i]}">
       <span class="idx">${i + 1}</span><div class="linebody">${ballsHTML(l, g)}${caption(l)}</div><span class="tick" aria-hidden="true"></span></li>`).join("");
}

function renderSystemResults(g, set) {
  const sy = set.system;
  const odds = lineOdds(g);
  const ours = set.eval.anyPrize;
  const cmp = set.compare?.coverage ?? set.compare?.quick;
  const cmpLabel = set.compare?.coverage != null ? `${sy.games} spread-out games` : `${sy.games} Quick Picks`;
  const price = parseFloat(state.price[g.key]);
  const name = `System ${sy.m}${sy.powerhit ? " PowerHit" : ""}`;
  $("summary").innerHTML = `
    <div class="big">${pct(ours)} <small>chance your ${name} wins a prize ${setDrawText(g.key, set)}</small></div>
    <div class="bar" role="img" aria-label="${name} ${pct(ours)} versus ${cmpLabel} ${pct(cmp)}">
      <i class="base" style="width:${(cmp * 100).toFixed(2)}%"></i><i class="ours" style="width:${(ours * 100).toFixed(2)}%"></i>
    </div>
    <div class="legend"><span><b style="background:var(--accent)"></b>${name}</span><span><b style="background:var(--muted);opacity:.6"></b>${cmpLabel}: ${pct(cmp)}</span></div>
    <p class="note" style="margin-top:12px">A ${name} is ${sy.games.toLocaleString("en-AU")} games, and wins the same amount on average as any ${sy.games.toLocaleString("en-AU")} games. ${ours < cmp
      ? `But it wins less often: when it does win, several of its games usually win together. For the most frequent wins, use Standard games instead.`
      : `It wins about as often as spread-out games.`}</p>
    <div class="row"><span>Games in this system</span><span>${sy.games.toLocaleString("en-AU")}</span></div>
    <div class="row"><span>Division 1 chance</span><span>${oneIn(set.eval.perDivision[1])}</span></div>
    ${price > 0 ? `<div class="row"><span>Ticket cost (${sy.games} × ${money(price)})</span><span>${money(sy.games * price)}</span></div>` : ""}
    ${prizeBreakdown(g, set)}
    <div class="row"><span>Picked</span><span>${new Date(set.createdAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · ${SYSTEM_STRATEGY[set.strategy].label}</span></div>`;
  const l = set.lines[0];
  const pbHtml = g.pbPool ? (sy.powerhit ? `<span class="pill">PowerHit</span>` : `<span class="ball sep"></span><span class="ball pb">${l.powerball}</span>`) : "";
  $("lines").innerHTML = `<li data-i="0" class="system${set.entered?.[0] ? " done" : ""}" aria-pressed="${!!set.entered?.[0]}">
    <span class="idx">S${sy.m}</span><div class="balls">${l.numbers.map((n) => `<span class="ball">${n}</span>`).join("")}${pbHtml}</div>
    <span class="tick" aria-hidden="true"></span></li>`;
}

function renderLatest() {
  const g = game();
  const s = stats?.games[g.key];
  if (!s) { $("latest").innerHTML = `<p class="nowin">Loading results…</p>`; $("checkResult").innerHTML = ""; return; }
  const latest = s.latest;
  $("latest").innerHTML = `<div class="draw-meta">Draw ${latest.draw_no} · ${fmtDate(latest.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>${drawBallsHTML(latest, g)}`;

  const set = state.sets[g.key];
  if (!set) { $("checkResult").innerHTML = ""; return; }
  const draws = set.forDraw
    ? s.recent.filter((d) => d.draw_no === set.forDraw)
    : s.recent.filter((d) => d.draw_no > set.afterDraw && d.date >= localISO(new Date(set.createdAt))).reverse();
  if (!draws.length) {
    const up = upcomingDraw(g.key);
    const which = set.forDraw && up && set.forDraw !== up.no && set.forDraw < up.no
      ? `draw ${set.forDraw}. Its results aren't in yet`
      : `draw ${set.forDraw ?? ""} (${nextDraw(g.key)}). Results show up here the morning after`;
    $("checkResult").innerHTML = `<p class="nowin">Your games are for ${which}.</p>`;
    return;
  }
  let html = "";
  if (set.type === "system") {
    const sy = set.system;
    for (const d of draws.slice(-7)) {
      const r = checkSystem(g, set.lines[0].numbers, d, { powerhit: sy.powerhit, powerball: sy.powerball });
      const divs = s.dividends?.find((x) => x.draw_no === d.draw_no)?.divisions;
      const parts = [];
      let total = 0;
      r.won.forEach((cnt, div) => {
        if (!cnt) return;
        const each = divs?.[div]?.each;
        if (each) total += cnt * each;
        parts.push(`Division ${div} × ${cnt}${each ? ` (${money(cnt * each)})` : ""}`);
      });
      const hits = `${r.mainHits} number${r.mainHits === 1 ? "" : "s"}${r.suppHits ? ` + ${r.suppHits} ${g.suppLabel === "supps" ? (r.suppHits === 1 ? "supp" : "supps") : "bonus"}` : ""}${g.pbPool && r.pbHit ? " + Powerball" : ""}`;
      html += parts.length
        ? `<div class="win">Draw ${d.draw_no} (${fmtDate(d.date)}): your System ${sy.m} matched ${hits}${total ? `, about ${money(total)}` : ""}.<br>${parts.join("<br>")}<br><small>Check the official results before claiming.</small></div>`
        : `<p class="nowin">Draw ${d.draw_no} (${fmtDate(d.date)}): matched ${hits}, no prizes this time.</p>`;
    }
    const last = draws[draws.length - 1];
    html += `<div class="checklist"><div class="l system"><span class="idx">S${sy.m}</span>${ballsHTML({ numbers: set.lines[0].numbers, powerball: sy.powerhit ? null : sy.powerball }, g, last)}</div></div>`;
    $("checkResult").innerHTML = html;
    return;
  }
  for (const d of draws.slice(-7)) {
    const res = checkLines(g, set.lines, d);
    const wins = res.map((r, i) => ({ ...r, i })).filter((r) => r.division);
    const divs = s.dividends?.find((x) => x.draw_no === d.draw_no)?.divisions;
    const prize = (w) => divs?.[w.division]?.each;
    const total = wins.reduce((t, w) => t + (prize(w) || 0), 0);
    html += wins.length
      ? `<div class="win">Draw ${d.draw_no} (${fmtDate(d.date)}): ${wins.length} winning game${wins.length > 1 ? "s" : ""}${total ? `, about ${money(total)}` : ""}.<br>${wins.map((w) => `Game ${w.i + 1}: Division ${w.division}${prize(w) ? ` (${money(prize(w))})` : ""}`).join("<br>")}<br><small>Check the official results before claiming.</small></div>`
      : `<p class="nowin">Draw ${d.draw_no} (${fmtDate(d.date)}): no prizes this time.</p>`;
  }
  const last = draws[draws.length - 1];
  const res = checkLines(g, set.lines, last);
  html += `<div class="checklist">` + set.lines.map((l, i) => {
    const r = res[i];
    const txt = r.division ? `Div ${r.division}` : `${r.mainHits}${r.suppHits ? ` + ${r.suppHits}${g.suppLabel === "bonus" ? "B" : "S"}` : ""}${g.pbPool && r.pbHit ? " + PB" : ""}`;
    return `<div class="l"><span class="idx">${i + 1}</span>${ballsHTML(l, g, last)}<span class="res${r.division ? " won" : ""}">${txt}</span></div>`;
  }).join("") + `</div>`;
  $("checkResult").innerHTML = html;
}

function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function verdictRow(p, title) {
  const [cls, word] = p < 0.01 ? ["bad", "Strong sign of bias"] : p < 0.05 ? ["watch", "Weak sign of bias"] : ["ok", "Looks fair"];
  return `<div class="verdict"><span class="dot ${cls}"></span><div><b>${title}: ${word}</b><span>p = ${p.toFixed(3)}. Below 0.05 would mean fair balls rarely look this uneven.</span></div></div>`;
}

const fmtUsual = (e) => (e < 10 ? e.toFixed(1) : String(Math.round(e)));

function topTriplesHTML(g, s) {
  if (!s.triple_count) return "";
  const all = [];
  let k = 0;
  for (let a = 1; a <= g.pool; a++) for (let b = a + 1; b <= g.pool; b++) for (let c = b + 1; c <= g.pool; c++, k++) all.push([a, b, c, s.triple_count[k]]);
  const top = all.sort((x, y) => y[3] - x[3]).slice(0, 8);
  return `<div class="toppairs"><h3>Most often drawn in threes</h3>
    ${top.map(([a, b, c, n]) => `<div class="tp"><span class="ball">${a}</span><span class="ball">${b}</span><span class="ball">${c}</span><span>${n} times <small>(usual ${fmtUsual(s.triple_expected)})</small></span></div>`).join("")}
    <p>Out of ${all.length.toLocaleString("en-AU")} possible triples, some always come up several times more than usual by luck alone. ${s.tests.triples_flagged ? `${s.tests.triples_flagged} stand out after allowing for that.` : "None stand out after allowing for that."}</p></div>`;
}

function topPairsHTML(g, s) {
  if (!s.pair_count) return "";
  const idx = [];
  let k = 0;
  for (let a = 1; a <= g.pool; a++) for (let b = a + 1; b <= g.pool; b++, k++) idx.push([a, b, s.pair_count[k], s.pair_z[k]]);
  const top = idx.sort((x, y) => y[3] - x[3]).slice(0, 8);
  return `<div class="toppairs"><h3>Most often drawn together</h3>
    ${top.map(([a, b, c]) => `<div class="tp"><span class="ball">${a}</span><span class="ball">${b}</span><span>${c} times <small>(usual ${fmtUsual(s.pair_expected)})</small></span></div>`).join("")}
    <p>Usual = how often a pair comes up together by chance over these draws. None of these are unusual enough to count as significant once you allow for testing all ${idx.length.toLocaleString("en-AU")} pairs.</p></div>`;
}

function renderStats() {
  const g = game();
  const s = stats?.games[g.key];
  if (!s) { $("stats").innerHTML = ""; return; }
  const bt = s.tests.backtest;
  const order = s.number_z.map((z, i) => [i + 1, z]).sort((a, b) => b[1] - a[1]);
  const hot = order.slice(0, 6), cold = order.slice(-6).reverse();
  const btWord = bt.numbers.splits_passed >= 4
    ? ["watch", "Hot numbers mostly stayed hot"]
    : ["ok", "Hot numbers didn't stay hot"];
  $("stats").innerHTML = `
    ${verdictRow(s.tests.numbers_p, "Single numbers")}
    ${verdictRow(s.tests.pairs_p, "Pairs of numbers")}
    ${s.tests.triples_p != null ? verdictRow(s.tests.triples_p, "Numbers in threes") : ""}
    ${s.tests.recent ? verdictRow(Math.min(s.tests.recent.numbers_p, s.tests.recent.pairs_p),
      `Recent draws only (${s.tests.recent.draws} since ${fmtDate(s.tests.recent.since, { month: "short", year: "numeric" })})`)
      .replace("Below 0.05 would mean fair balls rarely look this uneven.", "Worn balls would show up here first.") : ""}
    <div class="verdict"><span class="dot ${btWord[0]}"></span><div><b>${btWord[1]}</b><span>Numbers that were hot in earlier draws beat chance in later draws in ${bt.numbers.splits_passed} of ${bt.numbers.splits} tests. Pairs did in ${bt.pairs.splits_passed} of ${bt.pairs.splits}${bt.triples ? `, and triples in ${bt.triples.splits_passed} of ${bt.triples.splits}` : ""}. A worn ball would pass most of them.</span></div></div>
    <div class="verdict"><span class="dot ok" style="visibility:hidden"></span><div><span>Based on ${s.draws.toLocaleString("en-AU")} draws in the current format (${fmtDate(s.first_date, { month: "short", year: "numeric" })} – ${fmtDate(s.last_date, { day: "numeric", month: "short", year: "numeric" })}), ${g.pbPool ? "main numbers only (the Powerball comes from a separate barrel)" : `counting the ${g.suppLabel === "bonus" ? "bonus numbers" : "supplementaries"} too, since they come out of the same machine`}.</span></div></div>
    ${topPairsHTML(g, s)}
    ${topTriplesHTML(g, s)}
    <div class="hotcold">
      <div><h3>Drawn most</h3><div class="balls">${hot.map(([n]) => `<span class="ball">${n}</span>`).join("")}</div></div>
      <div class="cold"><h3>Drawn least</h3><div class="balls">${cold.map(([n]) => `<span class="ball">${n}</span>`).join("")}</div></div>
    </div>`;
}

function renderNextDraw() {
  const g = game();
  const up = upcomingDraw(g.key);
  const jp = stats?.games[g.key]?.upcoming?.jackpot_text;
  $("nextDraw").innerHTML = up
    ? `Next draw <b>${nextDraw(g.key) === "tonight" ? "tonight" : nextDraw(g.key)}</b> · Draw ${up.no}${jp ? ` · <b>${jp}</b>` : ""}`
    : "";
}

function renderAll() {
  renderTabs(); renderNextDraw(); renderControls(); renderResults(); renderLatest(); renderStats();
}

// ------------------------------------------------------------------ actions

function pick() {
  const g = game();
  const btn = $("generate");
  btn.disabled = true;
  btn.textContent = "Picking…";
  setTimeout(() => {
    const s = stats?.games[g.key];
    const opts = { strategy: strategy(), stats: s, trust: state.trust, lastDraw: s?.latest.main || [] };
    const base = {
      createdAt: new Date().toISOString(), afterDraw: s?.latest.draw_no ?? 0,
      forDraw: upcomingDraw(g.key)?.no ?? null, strategy: strategy(),
    };
    if (isSystem()) {
      const m = sysSize(), ph = powerhit();
      const numbers = pickSystem(g, m, opts);
      let pb = null;
      if (g.pbPool && !ph) {
        pb = strategy() === "hot" && s?.pb_z?.length
          ? s.pb_z.indexOf(Math.max(...s.pb_z)) + 1
          : 1 + Math.floor(Math.random() * g.pbPool);
      }
      const so = systemOdds(g, m, ph);
      // the same money spent on spread-out standard games, for comparison
      const coverage = so.games <= 60 ? evaluate(g, generate(g, so.games, { strategy: "spread" }), 40000).anyPrize : null;
      state.sets[g.key] = {
        ...base, type: "system", system: { m, powerhit: ph, powerball: pb, games: so.games },
        lines: [{ numbers, powerball: pb }], entered: [false],
        eval: { anyPrize: so.anyPrize, perDivision: so.perDivision, exact: true },
        compare: { coverage, quick: randomSetChance(g, so.games) },
      };
    } else {
      const lines = generate(g, count(), opts);
      const ev = evaluate(g, lines, 60000);
      state.sets[g.key] = {
        ...base, lines, entered: lines.map(() => false),
        eval: { anyPrize: ev.anyPrize, perDivision: ev.perDivision },
      };
    }
    save();
    renderResults(); renderLatest();
    btn.disabled = false;
    btn.textContent = "Pick again";
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 30);
}

function asText() {
  const g = game();
  const set = state.sets[g.key];
  if (!set) return "";
  if (set.type === "system") {
    const sy = set.system;
    const pb = g.pbPool ? (sy.powerhit ? "  PowerHit (all Powerballs)" : `  PB ${sy.powerball}`) : "";
    return `${g.name} System ${sy.m} (${sy.games.toLocaleString("en-AU")} games)\n${set.lines[0].numbers.join(" ")}${pb}`;
  }
  const rows = set.lines.map((l, i) => `${String(i + 1).padStart(2)}) ${l.numbers.join(" ")}${l.powerball ? `  PB ${l.powerball}` : ""}`);
  return `${g.name}, ${set.lines.length} games (${STRATEGIES[set.strategy].label})\n${rows.join("\n")}`;
}

async function copy() {
  try { await navigator.clipboard.writeText(asText()); toast("Copied"); }
  catch { toast("Couldn't copy"); }
}

async function share() {
  const text = asText();
  if (navigator.share) {
    try { await navigator.share({ title: "My lotto games", text }); } catch { /* cancelled */ }
  } else copy();
}

// ------------------------------------------------------------------ events

$("gameTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-game]");
  if (!b) return;
  state.game = b.dataset.game; save();
  $("generate").textContent = state.sets[state.game] ? "Pick again" : "Pick my numbers";
  renderAll();
});
document.querySelector(".stepper").addEventListener("click", (e) => {
  const b = e.target.closest("[data-step]");
  if (!b) return;
  if (isSystem()) state.sys[state.game] = Math.min(20, Math.max(sysMin(), sysSize() + Number(b.dataset.step)));
  else state.counts[state.game] = Math.min(50, Math.max(1, count() + Number(b.dataset.step)));
  save(); renderControls();
});
$("countChips").addEventListener("click", (e) => {
  if (e.target.closest("[data-powerhit]")) {
    state.powerhit[state.game] = !powerhit(); save(); renderControls(); return;
  }
  const b = e.target.closest("[data-count]");
  if (!b) return;
  if (isSystem()) state.sys[state.game] = Number(b.dataset.count);
  else state.counts[state.game] = Number(b.dataset.count);
  save(); renderControls();
});
$("modeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  state.mode[state.game] = b.dataset.mode; save(); renderControls();
});
$("strategyChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-strategy]");
  if (!b) return;
  state.strategy[state.game] = b.dataset.strategy; save(); renderControls();
});
$("generate").addEventListener("click", pick);
$("copyBtn").addEventListener("click", copy);
$("shareBtn").addEventListener("click", share);
$("clearEntered").addEventListener("click", () => {
  const set = state.sets[state.game];
  if (set) { set.entered = set.lines.map(() => false); save(); renderResults(); }
});
$("lines").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-i]");
  if (!li) return;
  const set = state.sets[state.game];
  const i = Number(li.dataset.i);
  set.entered[i] = !set.entered[i];
  save();
  li.classList.toggle("done", set.entered[i]);
  li.setAttribute("aria-pressed", set.entered[i]);
  if (set.entered.every(Boolean)) toast("All games ticked off. Good luck!");
});
$("price").addEventListener("input", (e) => { state.price[state.game] = e.target.value; save(); renderResults(); });
$("trust").addEventListener("change", (e) => { state.trust = Number(e.target.value); save(); });

// ------------------------------------------------------------------ boot

renderAll();
if (state.sets[state.game]) $("generate").textContent = "Pick again";

fetch("data/stats.json", { cache: "no-cache" })
  .then((r) => r.json())
  .then((d) => {
    stats = d;
    const up = new Date(d.updated);
    $("updated").textContent = "Results to " + fmtDate(
      Object.values(d.games).map((g) => g.last_date).sort().pop(), { day: "numeric", month: "short" });
    $("updated").title = "Data updated " + up.toLocaleString("en-AU");
    renderNextDraw(); renderResults(); renderLatest(); renderStats();
  })
  .catch(() => { $("latest").innerHTML = `<p class="nowin">Couldn't load results. You can still pick numbers.</p>`; });

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
