"""Download draw history into data/lottery.db.

    python -m lottery.fetch                  # update all games (incremental)
    python -m lottery.fetch --full           # re-download everything
    python -m lottery.fetch --source archive # skip the official API

Sources
  official  data.api.thelott.com (the API thelott.com uses). TattsLotto from 1997,
            Powerball from 1996, Set for Life (7/44) from March 2020. Max 90 days
            per request, and it blocks clients that request too fast, so requests
            are spaced out.
  archive   australia.national-lottery.com yearly archive pages. Used for the draws
            the official API lacks (TattsLotto 1986-1996, Set for Life 2015-2020)
            and as a fallback if the official API refuses us.
  lotterywest  api.lotterywest.wa.gov.au (WA's official lottery). Only the last 10
            draws per game, but it works from anywhere (thelott.com blocks
            non-Australian IPs such as GitHub Actions), and it includes prize
            amounts, jackpots and the next draw. Tried first for routine updates.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from datetime import date, datetime, timedelta

import requests

from . import db

API = "https://data.api.thelott.com/sales/vmax/web/data/lotto/results/search/daterange"
ARCHIVE = "https://australia.national-lottery.com/{slug}/results-archive-{year}"
LOTTERYWEST = "https://api.lotterywest.wa.gov.au/api/v1/games"
LW_IDS = {"tattslotto": "5127", "powerball": "5132", "setforlife": "5237"}
LW_OUT = db.DB_PATH.parent / "lotterywest.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
DELAY = 3.0  # seconds between requests

# game -> official product ids with the first date to ask for, archive slug, first archive year
PLAN = {
    "tattslotto": {"official": [("TattsLotto", date(1997, 1, 1))], "slug": "saturday-lotto",
                   "archive_from": 1986, "archive_until": date(1997, 1, 1)},
    "powerball": {"official": [("Powerball", date(1996, 5, 1))], "slug": "powerball",
                  "archive_from": 1996, "archive_until": date(1996, 5, 1)},
    "setforlife": {"official": [("SetForLife744", date(2020, 3, 20))], "slug": "set-for-life",
                   "archive_from": 2015, "archive_until": date(2020, 3, 23)},
}


class Blocked(Exception):
    pass


session = requests.Session()
session.headers.update({"User-Agent": UA})
_last = 0.0


def _throttle():
    global _last
    wait = DELAY - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def _request(method: str, url: str, retries: int = 4, **kw) -> requests.Response:
    for attempt in range(retries):
        _throttle()
        try:
            r = session.request(method, url, timeout=30, **kw)
        except requests.RequestException as e:
            print(f"    network error ({e}), retrying", flush=True)
            time.sleep(10 * (attempt + 1))
            continue
        if r.status_code == 403:
            if attempt == retries - 1:
                raise Blocked(url)
            print(f"    403 from server, backing off {60 * (attempt + 1)}s", flush=True)
            time.sleep(60 * (attempt + 1))
            continue
        r.raise_for_status()
        return r
    raise Blocked(url)


# ------------------------------------------------------------------ official API

def fetch_official(product: str, start: date, end: date, retries: int = 4) -> list[dict]:
    rows, cur = [], start
    while cur <= end:
        stop = min(cur + timedelta(days=89), end)
        r = _request("POST", API, retries=retries, json={
            "DateStart": f"{cur}T00:00:00", "DateEnd": f"{stop}T00:00:00",
            "ProductFilter": [product], "CompanyFilter": ["Tattersalls"]})
        body = r.json()
        if not body.get("Success", True):
            raise RuntimeError(f"API error for {product} {cur}..{stop}: {body.get('ErrorInfo')}")
        for d in body.get("Draws") or []:
            main, sec = d.get("PrimaryNumbers") or [], d.get("SecondaryNumbers") or []
            if not main:
                continue
            row = {"draw_no": d["DrawNumber"], "date": d["DrawDate"][:10], "main": main}
            if product == "Powerball":
                row["powerball"], row["supp"] = sec, []
            else:
                row["supp"] = sec
            rows.append(row)
        print(f"    {product} {cur} .. {stop}: {len(body.get('Draws') or [])} draws", flush=True)
        cur = stop + timedelta(days=1)
    return rows


# ------------------------------------------------------------------ archive site

_ROW = re.compile(r'Draw (\d+)</strong><br>([^<]+)</a>(.*?)</ul>', re.S)
_BALL = re.compile(r'<li class="result medium [^"]*? ball dark ([\w-]+)">\s*(\d+)\s*</li>')


def fetch_archive_year(slug: str, year: int) -> list[dict]:
    try:
        r = _request("GET", ARCHIVE.format(slug=slug, year=year))
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            return []  # e.g. next year's page on 31 December
        raise
    rows = []
    for no, when, balls in _ROW.findall(r.text):
        main, supp, pb = [], [], []
        for cls, n in _BALL.findall(balls):
            {"ball": main, "supplementary": supp, "bonus-ball": supp, "powerball": pb}.get(cls, main).append(int(n))
        d = datetime.strptime(html.unescape(when).strip(), "%d %B, %Y").date()
        rows.append({"draw_no": int(no), "date": d.isoformat(), "main": main, "supp": supp, "powerball": pb})
    return rows


# ------------------------------------------------------------------ lotterywest

def fetch_lotterywest() -> dict:
    """Last 10 draws, prize amounts and next draw for each game, keyed by our game key."""
    data = _request("GET", LOTTERYWEST, retries=2).json()["data"]
    out = {}
    for game, gid in LW_IDS.items():
        g = data.get(gid)
        if not g:
            continue
        draws, dividends = [], []
        for r in g.get("results") or []:
            main = [int(v) for _, v in sorted(r["winning_numbers"].items(), key=lambda kv: int(kv[0]))]
            sec = [int(v) for _, v in sorted((r.get("supplementary_numbers") or {}).items(), key=lambda kv: int(kv[0]))]
            row = {"draw_no": int(r["draw_num"]), "date": r["draw_date"], "main": main}
            if game == "powerball":
                row["powerball"], row["supp"] = sec, []
            else:
                row["supp"] = sec
            draws.append(row)
            dividends.append({"draw_no": row["draw_no"], "date": row["date"],
                              "divisions": {d: {"each": float(v["each"]), "winners": int(v["winners"])}
                                            for d, v in (r.get("divisions") or {}).items()}})
        up = g.get("upcoming_draw") or {}
        out[game] = {
            "draws": draws,
            "dividends": dividends,
            "upcoming": {k: up.get(k) for k in ("draw_number", "draw_close", "sales_close", "jackpot", "jackpot_text")},
        }
    return out


# ------------------------------------------------------------------ driver

def last_date(con, game: str) -> date | None:
    v = con.execute("SELECT MAX(draw_date) FROM draws WHERE game=?", (game,)).fetchone()[0]
    return date.fromisoformat(v) if v else None


def update(game: str, full: bool, source: str, lw: dict | None = None) -> None:
    plan = PLAN[game]
    today = date.today() + timedelta(days=1)  # runners are on UTC, a day behind Australia
    con = db.connect()
    have = None if full else last_date(con, game)
    print(f"\n== {game}: " + (f"updating from {have}" if have else "full download"), flush=True)

    # Routine update: Lotterywest's last 10 draws, if they reach back to what we have.
    if have and lw and game in lw and lw[game]["draws"]:
        rows = lw[game]["draws"]
        oldest = min(date.fromisoformat(r["date"]) for r in rows)
        db.upsert(con, game, rows, "lotterywest")
        print(f"    lotterywest: {len(rows)} draws, {oldest} .. {max(r['date'] for r in rows)}", flush=True)
        if oldest <= have:
            con.close()
            return
        print("    gap before Lotterywest's oldest draw; filling from other sources", flush=True)

    # Early history only the archive has (skipped once we've already got past it).
    if have is None or have < plan["archive_until"]:
        for y in range(plan["archive_from"], plan["archive_until"].year + 1):
            rows = [r for r in fetch_archive_year(plan["slug"], y)
                    if date.fromisoformat(r["date"]) < plan["archive_until"]]
            db.upsert(con, game, rows, "archive")
            print(f"    archive {y}: {len(rows)} draws", flush=True)

    use_official = source in ("auto", "official")
    if use_official:
        try:
            for product, first in plan["official"]:
                start = max(first, have - timedelta(days=7)) if have else first
                # in auto mode give up quickly: the archive has the same draws
                rows = fetch_official(product, start, today, retries=1 if source == "auto" else 4)
                db.upsert(con, game, rows, "official")
        except Blocked:
            if source == "official":
                raise
            print("    official API is refusing requests; falling back to the archive site", flush=True)
            use_official = False

    if not use_official:
        start_year = max(plan["archive_until"].year, (have or plan["archive_until"]).year)
        for y in range(start_year, today.year + 1):
            rows = [r for r in fetch_archive_year(plan["slug"], y)
                    if date.fromisoformat(r["date"]) >= plan["archive_until"]]
            db.upsert(con, game, rows, "archive")
            print(f"    archive {y}: {len(rows)} draws", flush=True)
    con.close()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("games", nargs="*", default=list(PLAN))
    ap.add_argument("--full", action="store_true", help="re-download everything")
    ap.add_argument("--source", choices=["auto", "official", "archive"], default="auto")
    a = ap.parse_args(argv)
    db.load_csv_if_empty()
    lw = None
    if a.source == "auto":
        try:
            lw = fetch_lotterywest()
            LW_OUT.write_text(json.dumps(lw, indent=1))
        except Exception as e:  # noqa: BLE001 - any failure just means we use the other sources
            print(f"Lotterywest unavailable ({e}); using other sources", flush=True)
    failed = []
    for g in a.games:
        try:
            update(g, a.full, a.source, lw)
        except Exception as e:  # noqa: BLE001 - keep going so the other games still update
            print(f"    {g} failed: {e}", flush=True)
            failed.append(g)
    db.write_csv()
    print()
    print(db.summary().to_string(index=False))
    if failed:
        print(f"\nFailed: {', '.join(failed)}")
        return 1 if len(failed) == len(a.games) else 0


if __name__ == "__main__":
    sys.exit(main())
