import { GAMES, STRATEGIES, generate, evaluate, lineOdds, randomSetChance, checkLines } from "./engine.js";

const $ = (id) => document.getElementById(id);
const STORE = "lotto-lab:v1";
const COUNT_CHIPS = [6, 12, 18, 24, 36, 50];
const DRAW_DAY = { tattslotto: 6, powerball: 4, setforlife: null }; // 0 = Sunday; null = daily
const DRAW_TEXT = { tattslotto: "Saturday", powerball: "Thursday", setforlife: "Every day" };

// ------------------------------------------------------------------ state

const defaults = { game: "tattslotto", counts: {}, strategy: {}, price: {}, trust: 0.3, sets: {} };
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
const strategy = () => state.strategy[state.game] ?? "spread";

// ------------------------------------------------------------------ formatting

const pct = (p) => (p >= 0.1 ? (p * 100).toFixed(1) : (p * 100).toFixed(2)) + "%";
const oneIn = (p) => "1 in " + Math.round(1 / p).toLocaleString("en-AU");
const fmtDate = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-AU", opts);
const money = (v) => v.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

function nextDraw(key) {
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
  $("count").textContent = count();
  $("countChips").innerHTML = COUNT_CHIPS.map((n) =>
    `<button type="button" data-count="${n}" aria-pressed="${n === count()}">${n}</button>`).join("");
  $("strategyChips").innerHTML = Object.entries(STRATEGIES).map(([k, s]) =>
    `<button type="button" role="radio" data-strategy="${k}" aria-checked="${k === strategy()}">${s.label}</button>`).join("");
  $("strategyBlurb").textContent = STRATEGIES[strategy()].blurb;
  $("price").value = state.price[state.game] ?? "";
  $("trust").value = state.trust;
}

function renderResults() {
  const set = state.sets[state.game];
  const g = game();
  if (!set) { $("results").hidden = true; return; }
  $("results").hidden = false;
  const odds = lineOdds(g);
  const n = set.lines.length;
  const base = randomSetChance(g, n);
  const ours = set.eval?.anyPrize ?? base;
  const price = parseFloat(state.price[state.game]);
  const gain = ours - base;
  $("summary").innerHTML = `
    <div class="big">${pct(ours)} <small>chance at least one game wins a prize ${nextDraw(g.key) === "tonight" ? "tonight" : "on " + nextDraw(g.key)}</small></div>
    <div class="bar" role="img" aria-label="Your games ${pct(ours)} versus Quick Pick ${pct(base)}">
      <i class="base" style="width:${(base * 100).toFixed(2)}%"></i><i class="ours" style="width:${(ours * 100).toFixed(2)}%"></i>
    </div>
    <div class="legend"><span><b style="background:var(--accent)"></b>These ${n} games</span><span><b style="background:var(--muted);opacity:.6"></b>${n} Quick Picks: ${pct(base)}</span></div>
    ${set.strategy !== "random" && gain > 0.001 ? `<div class="row"><span>Better than Quick Pick by</span><span>+${(gain * 100).toFixed(1)} points</span></div>` : ""}
    <div class="row"><span>Each game wins a prize</span><span>${oneIn(odds[0])}</span></div>
    <div class="row"><span>Each game wins Division 1</span><span>${oneIn(odds[1])}</span></div>
    <div class="row"><span>Average prizes per draw</span><span>${(n * odds[0]).toFixed(2)} (same for any ${n} games)</span></div>
    ${price > 0 ? `<div class="row"><span>Ticket cost (${n} × ${money(price)})</span><span>${money(n * price)}</span></div>` : ""}
    <div class="row"><span>Picked</span><span>${new Date(set.createdAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · ${STRATEGIES[set.strategy].label}</span></div>`;
  $("lines").innerHTML = set.lines.map((l, i) =>
    `<li data-i="${i}" class="${set.entered?.[i] ? "done" : ""}" aria-pressed="${!!set.entered?.[i]}">
       <span class="idx">${i + 1}</span>${ballsHTML(l, g)}<span class="tick" aria-hidden="true"></span></li>`).join("");
}

function renderLatest() {
  const g = game();
  const s = stats?.games[g.key];
  if (!s) { $("latest").innerHTML = `<p class="nowin">Loading results…</p>`; $("checkResult").innerHTML = ""; return; }
  const latest = s.latest;
  $("latest").innerHTML = `<div class="draw-meta">Draw ${latest.draw_no} · ${fmtDate(latest.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>${drawBallsHTML(latest, g)}`;

  const set = state.sets[g.key];
  if (!set) { $("checkResult").innerHTML = ""; return; }
  const draws = s.recent.filter((d) => d.draw_no > set.afterDraw && d.date >= localISO(new Date(set.createdAt))).reverse();
  if (!draws.length) {
    $("checkResult").innerHTML = `<p class="nowin">Your games are for the next draw (${nextDraw(g.key)}). Results show up here the morning after.</p>`;
    return;
  }
  let html = "";
  for (const d of draws.slice(-7)) {
    const res = checkLines(g, set.lines, d);
    const wins = res.map((r, i) => ({ ...r, i })).filter((r) => r.division);
    html += wins.length
      ? `<div class="win">Draw ${d.draw_no} (${fmtDate(d.date)}): ${wins.length} winning game${wins.length > 1 ? "s" : ""}, ${wins.map((w) => `game ${w.i + 1} Division ${w.division}`).join(", ")}. Check the official results before claiming.</div>`
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
    <div class="verdict"><span class="dot ${btWord[0]}"></span><div><b>${btWord[1]}</b><span>Numbers that were hot in earlier draws beat chance in later draws in ${bt.numbers.splits_passed} of ${bt.numbers.splits} tests. Pairs did in ${bt.pairs.splits_passed} of ${bt.pairs.splits}. A worn ball would pass most of them.</span></div></div>
    <div class="verdict"><span class="dot ok" style="visibility:hidden"></span><div><span>Based on ${s.draws.toLocaleString("en-AU")} draws in the current format (${fmtDate(s.first_date, { month: "short", year: "numeric" })} – ${fmtDate(s.last_date, { day: "numeric", month: "short", year: "numeric" })}), counting ${g.suppLabel || "main numbers"} too since they come out of the same machine.</span></div></div>
    <div class="hotcold">
      <div><h3>Drawn most</h3><div class="balls">${hot.map(([n]) => `<span class="ball">${n}</span>`).join("")}</div></div>
      <div class="cold"><h3>Drawn least</h3><div class="balls">${cold.map(([n]) => `<span class="ball">${n}</span>`).join("")}</div></div>
    </div>`;
}

function renderAll() {
  renderTabs(); renderControls(); renderResults(); renderLatest(); renderStats();
}

// ------------------------------------------------------------------ actions

function pick() {
  const g = game();
  const btn = $("generate");
  btn.disabled = true;
  btn.textContent = "Picking…";
  setTimeout(() => {
    const s = stats?.games[g.key];
    const lines = generate(g, count(), {
      strategy: strategy(), stats: s, trust: state.trust, lastDraw: s?.latest.main || [],
    });
    const ev = strategy() === "random" ? null : evaluate(g, lines, 60000);
    state.sets[g.key] = {
      createdAt: new Date().toISOString(), afterDraw: s?.latest.draw_no ?? 0, strategy: strategy(),
      lines, entered: lines.map(() => false), eval: ev && { anyPrize: ev.anyPrize },
    };
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
  state.counts[state.game] = Math.min(50, Math.max(1, count() + Number(b.dataset.step)));
  save(); renderControls();
});
$("countChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-count]");
  if (!b) return;
  state.counts[state.game] = Number(b.dataset.count); save(); renderControls();
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
    renderLatest(); renderStats();
  })
  .catch(() => { $("latest").innerHTML = `<p class="nowin">Couldn't load results. You can still pick numbers.</p>`; });

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
