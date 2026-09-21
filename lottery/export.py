"""Write docs/data/stats.json for the phone app.

    python -m lottery.export
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import db
from . import stats as S
from .games import GAMES

OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "stats.json"


def _r(a, nd=3):
    return [round(float(v), nd) for v in a]


def _draw(row) -> dict:
    return {"draw_no": int(row.draw_no), "date": row.draw_date.strftime("%Y-%m-%d"),
            "main": list(row.main), "supp": list(row.supp), "powerball": list(row.powerball)}


def game_stats(game) -> dict:
    df = db.load(game.key)
    cur = df[df["draw_date"] >= pd.Timestamp(game.format_start)]
    cur = cur[cur["main"].map(lambda m: len(m) == game.main and max(m) <= game.pool)]
    k = game.main + game.supp
    x = S.incidence([m + s for m, s in zip(cur["main"], cur["supp"])], game.pool)
    nums = S.number_stats(x, k, sims=1000)
    pairs = S.pair_stats(x, k, sims=500)

    backtests = {}
    for kind, top in (("numbers", 5), ("pairs", 20)):
        runs = [S.backtest(x[: int(len(x) * s)], x[int(len(x) * s):], k, kind, top, sims=200)
                for s in np.arange(0.3, 0.91, 0.1)]
        backtests[kind] = {
            "splits_passed": int(sum(b.test_z > 1.96 for b in runs)),
            "splits": len(runs),
            "mean_excess_z": round(float(np.mean([b.test_z for b in runs])), 2),
        }

    pb_z = []
    if game.pb_pool:
        pbs = pd.Series([p[0] for p in cur["powerball"] if p])
        counts = pbs.value_counts().reindex(range(1, game.pb_pool + 1), fill_value=0).to_numpy()
        exp = len(pbs) / game.pb_pool
        pb_z = _r((counts - exp) / np.sqrt(exp * (1 - 1 / game.pb_pool)), 2)

    return {
        "key": game.key,
        "draws": int(len(cur)),
        "format_start": game.format_start,
        "first_date": cur["draw_date"].min().strftime("%Y-%m-%d"),
        "last_date": cur["draw_date"].max().strftime("%Y-%m-%d"),
        "latest": _draw(cur.iloc[-1]),
        "recent": [_draw(r) for r in cur.iloc[::-1].head(30).itertuples()],
        "number_count": [int(v) for v in nums.table["count"]],
        "number_expected": round(float(nums.table["expected"].iloc[0]), 2),
        "number_z": _r(nums.table["z"], 2),
        "pair_z": _r(pairs.table["z"], 2),
        "pb_z": pb_z,
        "tests": {
            "numbers_p": round(nums.chi2_p, 3),
            "pairs_p": round(pairs.chi2_p, 3),
            "pairs_flagged": pairs.n_significant,
            "numbers_flagged": int((nums.table["q"] < 0.05).sum()),
            "backtest": backtests,
        },
    }


def main():
    db.load_csv_if_empty()
    out = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "games": {g.key: game_stats(g) for g in GAMES.values()}}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
