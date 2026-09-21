"""Lottery bias dashboard.  Run:  .venv\\Scripts\\streamlit run app.py"""
from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from lottery import db
from lottery import stats as S
from lottery.games import GAMES

st.set_page_config(page_title="Lottery Bias Lab", page_icon="🎱", layout="wide")

BLUE, RED, GRAY = "#2a78d6", "#e34948", "#898781"
DIVERGING = [[0, "#0d366b"], [0.25, "#3987e5"], [0.5, "#f0efec"], [0.75, "#e66767"], [1, "#a32424"]]
SEQUENTIAL = [[0, "#cde2fb"], [0.5, "#3987e5"], [1, "#0d366b"]]


def style(fig: go.Figure, height: int = 380) -> go.Figure:
    fig.update_layout(height=height, margin=dict(l=10, r=10, t=30, b=10), hovermode="closest",
                      plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)")
    fig.update_xaxes(showgrid=False, zeroline=False)
    fig.update_yaxes(gridcolor="rgba(137,135,129,0.25)", zeroline=False)
    return fig


def verdict(p: float) -> str:
    if p < 0.01:
        return "🔴 **Strong evidence of bias** (p < 0.01)"
    if p < 0.05:
        return "🟠 **Weak evidence of bias** (p < 0.05). One result like this among many tests is expected by chance."
    return "🟢 **Consistent with fair draws**"


# ------------------------------------------------------------------ sidebar
st.sidebar.title("🎱 Lottery Bias Lab")
game = GAMES[st.sidebar.selectbox("Game", list(GAMES), format_func=lambda k: GAMES[k].name)]
raw = db.load(game.key)
if raw.empty:
    st.warning("No data yet. Run `.venv\\Scripts\\python -m lottery.fetch` to download the draw history.")
    st.stop()

current = raw[raw["draw_date"] >= pd.Timestamp(game.format_start)].copy()
current = current[current["main"].map(lambda m: len(m) == game.main and max(m) <= game.pool)]
if game.supp:
    current = current[current["supp"].map(len) == game.supp]

use_supp = False
if game.supp:
    use_supp = st.sidebar.checkbox(f"Include {game.supp_label}", value=True,
                                   help=f"The {game.supp_label} come out of the same machine, so they're extra "
                                        "evidence about the balls.")
k = game.main + (game.supp if use_supp else 0)

window = st.sidebar.radio("Draws to analyse", ["All (current format)", "Most recent N", "Date range"])
if window == "Most recent N":
    n = st.sidebar.slider("N", 50, len(current), min(500, len(current)), step=50)
    sel = current.tail(n)
elif window == "Date range":
    lo, hi = current["draw_date"].min().date(), current["draw_date"].max().date()
    rng = st.sidebar.date_input("Range", (lo, hi), min_value=lo, max_value=hi)
    if len(rng) == 2:
        sel = current[(current["draw_date"].dt.date >= rng[0]) & (current["draw_date"].dt.date <= rng[1])]
    else:
        sel = current
else:
    sel = current

sims = st.sidebar.select_slider("Simulations per test", [200, 500, 1000, 2000], 500,
                                help="More simulations give more precise p-values but take longer.")
st.sidebar.caption(f"{len(raw):,} draws stored · {len(current):,} in current format "
                   f"(since {game.format_start}) · {len(sel):,} selected")

if len(sel) < 30:
    st.error("Select at least 30 draws.")
    st.stop()

draw_lists = [m + (s if use_supp else []) for m, s in zip(sel["main"], sel["supp"])]


@st.cache_data(show_spinner="Crunching numbers…")
def analyse(draws: tuple, pool: int, k: int, sims: int):
    x = S.incidence([list(d) for d in draws], pool)
    return x, S.number_stats(x, k, sims), S.pair_stats(x, k, max(200, sims // 2))


@st.cache_data(show_spinner="Running backtest…")
def run_backtest(draws: tuple, pool: int, k: int, share: float, kind: str, top_n: int, sims: int):
    x = S.incidence([list(d) for d in draws], pool)
    cut = int(len(x) * share)
    return S.backtest(x[:cut], x[cut:], k, kind, top_n, sims=sims)


key = tuple(tuple(d) for d in draw_lists)
x, nums, pairs = analyse(key, game.pool, k, sims)

st.title(game.name)
st.caption(f"{game.main} from 1–{game.pool}"
           + (f" + {game.supp} {game.supp_label}" if game.supp else "")
           + (f" + Powerball 1–{game.pb_pool}" if game.pb_pool else "")
           + f" · {len(sel):,} draws, {sel['draw_date'].min():%d %b %Y} – {sel['draw_date'].max():%d %b %Y}")

tabs = st.tabs(["Overview", "Numbers", "Pairs", "Backtest", "Ticket picker", "Draws"])

# ------------------------------------------------------------------ overview
with tabs[0]:
    c1, c2, c3 = st.columns(3)
    c1.metric("Draws analysed", f"{len(sel):,}")
    c2.metric("Numbers test p-value", f"{nums.chi2_p:.3f}")
    c3.metric("Pairs test p-value", f"{pairs.chi2_p:.3f}")
    st.markdown(f"**Are some numbers drawn more than others?** {verdict(nums.chi2_p)}")
    st.markdown(f"**Do some pairs turn up together more than others?** {verdict(pairs.chi2_p)}")
    st.markdown(f"**Individual pairs flagged after correcting for testing {len(pairs.table):,} pairs:** "
                f"{pairs.n_significant}")
    st.info(
        "**How to read this.** Each p-value compares the real draws with thousands of simulated fair draws of the "
        "same size. A small p-value (below 0.05) means fair draws rarely look this uneven. A large one means the "
        "unevenness you see is what luck alone produces. The **Backtest** tab is the real test: if a bias is real, "
        "numbers that looked hot in earlier draws should stay hot in later ones.")

# ------------------------------------------------------------------ numbers
with tabs[1]:
    t = nums.table
    st.subheader("How far each number is from its expected count")
    colors = np.where(t["z"] >= 0, RED, BLUE)
    fig = go.Figure(go.Bar(
        x=t["number"], y=t["count"] - t["expected"], marker_color=colors, marker_line_width=0,
        customdata=np.c_[t["count"], t["expected"], t["z"], t["q"]],
        hovertemplate="Number %{x}<br>Drawn %{customdata[0]} times (expected %{customdata[1]:.1f})"
                      "<br>z = %{customdata[2]:.2f}, FDR q = %{customdata[3]:.3f}<extra></extra>"))
    sd = float((t["expected"].iloc[0] * (1 - k / game.pool)) ** 0.5)
    for s in (1.96, -1.96):
        fig.add_hline(y=s * sd, line_dash="dot", line_color=GRAY, line_width=1)
    fig.update_xaxes(dtick=1, title="Number")
    fig.update_yaxes(title="Drawn minus expected")
    st.plotly_chart(style(fig), width="stretch", theme="streamlit")
    st.caption("Red = drawn more than expected, blue = less. Dotted lines mark the range 95% of numbers "
               "fall in by chance. With this many numbers, a couple outside the lines is normal.")

    st.subheader("Running count for chosen numbers")
    picks = st.multiselect("Numbers", list(range(1, game.pool + 1)),
                           default=t.nlargest(2, "z")["number"].tolist() + t.nsmallest(1, "z")["number"].tolist())
    if picks:
        dates = sel["draw_date"].to_numpy()
        steps = np.arange(1, len(sel) + 1) * k / game.pool
        fig = go.Figure()
        palette = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
        for i, n in enumerate(picks[:8]):
            fig.add_scatter(x=dates, y=np.cumsum(x[:, n - 1]) - steps, mode="lines", name=str(n),
                            line=dict(width=2, color=palette[i]),
                            hovertemplate=f"Number {n}<br>%{{x|%d %b %Y}}<br>%{{y:+.1f}} vs expected<extra></extra>")
        fig.add_hline(y=0, line_color=GRAY, line_width=1)
        fig.update_yaxes(title="Cumulative drawn minus expected")
        fig.update_layout(legend=dict(orientation="h", y=1.1), hovermode="x unified")
        st.plotly_chart(style(fig), width="stretch", theme="streamlit")
        st.caption("Ball wear would show up as a line that trends steadily up or down. A fair ball's line "
                   "wanders randomly around zero.")
        if len(picks) > 8:
            st.caption("Showing the first 8 selected numbers.")
    with st.expander("Table"):
        st.dataframe(t.sort_values("z", ascending=False).round(3), hide_index=True, width="stretch")

# ------------------------------------------------------------------ pairs
with tabs[2]:
    st.subheader("Pair map: how often each pair turns up together")
    m = S.pair_matrix(pairs.table, game.pool, "z")
    cm = S.pair_matrix(pairs.table, game.pool, "count")
    lim = float(np.nanmax(np.abs(m)))
    labels = list(range(1, game.pool + 1))
    fig = go.Figure(go.Heatmap(
        z=m, x=labels, y=labels, colorscale=DIVERGING, zmin=-lim, zmax=lim, zmid=0,
        customdata=cm, xgap=1, ygap=1, colorbar=dict(title="z"),
        hovertemplate="%{y} & %{x}<br>Together %{customdata:.0f} times<br>z = %{z:.2f}<extra></extra>"))
    fig.update_xaxes(dtick=1, side="top")
    fig.update_yaxes(dtick=1, autorange="reversed", showgrid=False)
    st.plotly_chart(style(fig, 720), width="stretch", theme="streamlit")
    exp_pair = pairs.table["expected"].iloc[0]
    st.caption(f"Each pair is expected to turn up together about {exp_pair:.1f} times in these draws. "
               "Red = more often than that, blue = less often.")

    c1, c2 = st.columns(2)
    cols = ["a", "b", "count", "expected", "z", "q"]
    c1.markdown("**Most frequent pairs**")
    c1.dataframe(pairs.table.nlargest(25, "z")[cols].round(3), hide_index=True, width="stretch")
    c2.markdown("**Least frequent pairs**")
    c2.dataframe(pairs.table.nsmallest(25, "z")[cols].round(3), hide_index=True, width="stretch")
    st.caption("q is the p-value corrected for testing every pair at once (Benjamini–Hochberg). "
               "Only q < 0.05 counts as a real signal. Plain p-values would flag about 5% of pairs by chance.")

    st.subheader("Pairs with a chosen number")
    anchor = st.selectbox("Number", labels, index=int(nums.table["z"].idxmax()))
    row = pd.DataFrame({"number": labels, "together": cm[anchor - 1], "z": m[anchor - 1]}).dropna()
    fig = go.Figure(go.Bar(x=row["number"], y=row["together"] - exp_pair,
                           marker_color=np.where(row["z"] >= 0, RED, BLUE), marker_line_width=0,
                           customdata=np.c_[row["together"], row["z"]],
                           hovertemplate=f"{anchor} & %{{x}}<br>Together %{{customdata[0]:.0f}} times"
                                         "<br>z = %{customdata[1]:.2f}<extra></extra>"))
    fig.update_xaxes(dtick=1, title="Partner number")
    fig.update_yaxes(title="Together minus expected")
    st.plotly_chart(style(fig, 300), width="stretch", theme="streamlit")

# ------------------------------------------------------------------ backtest
with tabs[3]:
    st.subheader("Do hot numbers and pairs stay hot?")
    st.markdown("Split the draws in two. Find the hottest numbers or pairs in the **earlier** draws, then check "
                "whether they kept beating chance in the **later** draws, which they weren't picked from. "
                "A real, lasting bias passes this test. Noise doesn't.")
    c1, c2, c3 = st.columns(3)
    split = c1.slider("Share of draws used to find hot items", 0.3, 0.9, 0.7, 0.05)
    kind = c2.radio("Test", ["pairs", "numbers"], horizontal=True)
    top_n = c3.slider("How many hot items to follow", 1, 50, 20 if kind == "pairs" else 5)
    cut = int(len(x) * split)
    bt = run_backtest(key, game.pool, k, split, kind, top_n, min(sims, 500))
    cut_date = sel["draw_date"].iloc[cut]
    st.caption(f"Earlier draws: {bt.train_draws:,} (to {cut_date:%d %b %Y}) · later draws: {bt.test_draws:,}")

    m1, m2, m3 = st.columns(3)
    m1.metric("Hits in later draws", f"{bt.test_hits}", f"{bt.test_hits - bt.test_expected:+.1f} vs chance")
    m2.metric("Excess z-score", f"{bt.test_z:.2f}")
    m3.metric("Earlier-vs-later correlation", f"{bt.correlation:+.3f}", f"p = {bt.correlation_p:.3f}",
              delta_color="off")
    if bt.test_z > 1.96 and bt.correlation_p < 0.05:
        st.success("The hot items kept beating chance, and hotness carried over across the board. "
                   "That's the signature of a real bias.")
    elif bt.test_z > 1.96 or bt.correlation_p < 0.05:
        st.warning("Mixed result: one of the two checks passed. Try other splits before trusting it.")
    else:
        st.info("The hot items didn't stay hot. Their earlier streak looks like luck, and picking them "
                "gives no edge.")
    st.dataframe(bt.top.round(2), hide_index=True, width="stretch")

    st.markdown("**Stability across splits.** One split can mislead, so here's the same test at every split point.")
    rows = []
    for s in np.arange(0.3, 0.91, 0.1):
        c = int(len(x) * s)
        b = run_backtest(key, game.pool, k, round(float(s), 2), kind, top_n, 100)
        rows.append({"split": f"{s:.0%}", "excess_z": b.test_z, "correlation": b.correlation})
    rs = pd.DataFrame(rows)
    fig = go.Figure(go.Bar(x=rs["split"], y=rs["excess_z"], marker_color=BLUE, marker_line_width=0,
                           hovertemplate="Split %{x}<br>Excess z %{y:.2f}<extra></extra>"))
    fig.add_hline(y=1.96, line_dash="dot", line_color=GRAY, line_width=1,
                  annotation_text="significance line", annotation_position="top left")
    fig.add_hline(y=0, line_color=GRAY, line_width=1)
    fig.update_yaxes(title="Excess z in later draws")
    fig.update_xaxes(title="Share of draws used to find hot items")
    st.plotly_chart(style(fig, 300), width="stretch", theme="streamlit")

# ------------------------------------------------------------------ tickets
with tabs[4]:
    st.subheader("Ticket picker")
    st.markdown("Scores many random tickets and keeps the best. The score mixes two things:\n"
                "- **Bias score:** favours numbers and pairs that have come up more often. Only useful if the "
                "Backtest tab shows the bias is real.\n"
                "- **Popularity penalty:** avoids combinations lots of other players pick (birthdays 1–31, runs, "
                "patterns). It doesn't change your odds, but if you win you share the prize with fewer people.")
    c1, c2, c3, c4 = st.columns(4)
    n_t = c1.number_input("Tickets", 1, 50, 10)
    bw = c2.slider("Bias weight", 0.0, 2.0, 1.0, 0.1)
    pw = c3.slider("Popularity weight", 0.0, 2.0, 1.0, 0.1)
    shrink = c4.slider("Trust in the stats", 0.0, 1.0, 0.3, 0.05,
                       help="Scales the z-scores down. Most of what looks like bias is noise, so a low value is "
                            "the sensible default.")
    settings = (game.key, key, int(n_t), bw, pw, shrink)
    if st.button("Generate tickets", type="primary") or st.session_state.get("ticket_settings") != settings:
        st.session_state.ticket_settings = settings
        st.session_state.tickets = S.pick_tickets(nums.table, pairs.table, game.pool, game.main, int(n_t),
                                                  bw, pw, shrink)
    tk = st.session_state.tickets
    if game.pb_pool:
        pbs = [p[0] for p in sel["powerball"] if p]
        if pbs:
            pc = pd.Series(pbs).value_counts().reindex(range(1, game.pb_pool + 1), fill_value=0)
            exp_pb = len(pbs) / game.pb_pool
            z_pb = (pc - exp_pb) / np.sqrt(exp_pb * (1 - 1 / game.pb_pool))
            order = (bw * shrink * z_pb + np.random.default_rng().normal(0, 1, len(z_pb))).sort_values(ascending=False)
            tk = tk.copy()
            tk.insert(1, "powerball", [int(order.index[i % len(order)]) for i in range(len(tk))])
    st.dataframe(tk, hide_index=True, width="stretch")
    odds = {"tattslotto": "8,145,060", "powerball": "134,490,400", "setforlife": "38,320,568"}[game.key]
    st.caption(f"Every ticket, including these, has the same 1 in {odds} chance of winning division 1 "
               "unless the machine is genuinely biased.")

# ------------------------------------------------------------------ data
with tabs[5]:
    show = sel.copy()
    show["main"] = show["main"].map(lambda v: " ".join(map(str, v)))
    show["supp"] = show["supp"].map(lambda v: " ".join(map(str, v)))
    show["powerball"] = show["powerball"].map(lambda v: " ".join(map(str, v)))
    if not game.supp:
        show = show.drop(columns="supp")
    if not game.pb_pool:
        show = show.drop(columns="powerball")
    show = show.sort_values("draw_no", ascending=False)
    st.dataframe(show, hide_index=True, width="stretch",
                 column_config={"draw_date": st.column_config.DateColumn("date", format="DD MMM YYYY")})
    st.download_button("Download CSV", show.to_csv(index=False), f"{game.key}_draws.csv", "text/csv")
