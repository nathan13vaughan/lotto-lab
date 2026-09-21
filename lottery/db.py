"""SQLite storage for draw results."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pandas as pd

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "lottery.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS draws (
    game      TEXT    NOT NULL,
    draw_no   INTEGER NOT NULL,
    draw_date TEXT    NOT NULL,          -- ISO yyyy-mm-dd
    main      TEXT    NOT NULL,          -- JSON list of main numbers, sorted
    supp      TEXT    NOT NULL,          -- JSON list of supplementary / bonus numbers
    powerball TEXT    NOT NULL DEFAULT '[]',  -- JSON list (Powerball only)
    source    TEXT,
    PRIMARY KEY (game, draw_no)
);
"""


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    return con


def upsert(con: sqlite3.Connection, game: str, rows: list[dict], source: str) -> int:
    # Only rewrite a stored draw when its numbers differ, so re-fetching the same
    # draw from another source doesn't churn the CSVs kept in git.
    con.executemany(
        "INSERT INTO draws VALUES (?,?,?,?,?,?,?) ON CONFLICT(game, draw_no) DO UPDATE SET "
        "draw_date=excluded.draw_date, main=excluded.main, supp=excluded.supp, "
        "powerball=excluded.powerball, source=excluded.source "
        "WHERE draws.main != excluded.main OR draws.supp != excluded.supp "
        "OR draws.powerball != excluded.powerball OR draws.draw_date != excluded.draw_date",
        [(game, r["draw_no"], r["date"], json.dumps(sorted(r["main"])), json.dumps(sorted(r.get("supp", []))),
          json.dumps(r.get("powerball", [])), source) for r in rows],
    )
    con.commit()
    return len(rows)


def load(game: str, path: Path = DB_PATH) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["draw_no", "draw_date", "main", "supp", "powerball"])
    with connect(path) as con:
        df = pd.read_sql("SELECT draw_no, draw_date, main, supp, powerball FROM draws WHERE game=? ORDER BY draw_no",
                         con, params=(game,))
    for c in ("main", "supp", "powerball"):
        df[c] = df[c].map(json.loads)
    df["draw_date"] = pd.to_datetime(df["draw_date"])
    return df


CSV_DIR = DB_PATH.parent / "draws"


def _nums(v: str) -> list[int]:
    return [int(n) for n in str(v).split()] if isinstance(v, str) and v.strip() else []


def write_csv(path: Path = DB_PATH) -> None:
    """Write one CSV per game (the copy kept in git; the .db is a local cache)."""
    CSV_DIR.mkdir(parents=True, exist_ok=True)
    with connect(path) as con:
        games = [r[0] for r in con.execute("SELECT DISTINCT game FROM draws")]
        for g in games:
            df = pd.read_sql("SELECT draw_no, draw_date, main, supp, powerball, source FROM draws "
                             "WHERE game=? ORDER BY draw_no", con, params=(g,))
            for c in ("main", "supp", "powerball"):
                df[c] = df[c].map(lambda s: " ".join(map(str, json.loads(s))))
            df.to_csv(CSV_DIR / f"{g}.csv", index=False, lineterminator="\n")


def load_csv_if_empty(path: Path = DB_PATH) -> None:
    """Rebuild the database from the CSVs (fresh checkout, e.g. on GitHub Actions)."""
    with connect(path) as con:
        if con.execute("SELECT COUNT(*) FROM draws").fetchone()[0]:
            return
        for f in sorted(CSV_DIR.glob("*.csv")):
            df = pd.read_csv(f, dtype=str, keep_default_na=False)
            rows = [{"draw_no": int(r.draw_no), "date": r.draw_date, "main": _nums(r.main),
                     "supp": _nums(r.supp), "powerball": _nums(r.powerball)} for r in df.itertuples()]
            for src, part in df.groupby("source"):
                idx = set(part.index)
                upsert(con, f.stem, [r for i, r in enumerate(rows) if i in idx], src)


def summary(path: Path = DB_PATH) -> pd.DataFrame:
    with connect(path) as con:
        return pd.read_sql("SELECT game, COUNT(*) draws, MIN(draw_date) first, MAX(draw_date) last "
                           "FROM draws GROUP BY game", con)
