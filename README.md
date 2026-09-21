# Lotto Lab

Picks games for **Saturday Lotto, Powerball and Set for Life**, and tests the full draw history for signs of worn or biased balls.

**Phone app:** https://nathan13vaughan.github.io/lotto-lab/. On iPhone, open it in Safari and tap Share → Add to Home Screen. On Android, open it in Chrome and choose Install app.

## What the app does

1. Choose a game and how many games to play (1–50).
2. Tap **Pick my numbers**.
3. Enter the games in the Lott app, ticking each one off as you go.

There are three ways to pick:

| Strategy | What it does |
|---|---|
| **Frequent pairs** (default) | Builds each game around pairs of numbers that have come out together more often than chance, while keeping games spread out. A slider sets how hard it leans on the pair stats. Each game shows the pair it's built on. |
| **Best coverage** | Spreads numbers so your games share as few numbers as possible, and avoids patterns lots of people play, like birthdays and runs. |
| **Hot numbers** | Leans towards numbers and pairs that have come up more than expected. |
| **Quick Pick** | Plain random, the same as the Lott app's Quick Pick. |

You can also pick a **System** entry, like System 8 (every 6-number combination of 8 numbers, which is 28 games), or **PowerHit** for Powerball (every Powerball). The app works out a system's odds exactly and compares it with the same number of spread-out standard games. A system wins the same amount on average, but much less often. For example, a Saturday Lotto System 8 has a 5.9% chance of any prize in a draw, against 55% for 28 spread-out games. When a system does win, several of its games usually win together. PowerHit is the exception: it's nearly as good as spread-out games, at 43% against 44%.

After the draw, the app checks your saved games against the results and shows any winning divisions, with prize amounts. It also shows your chance of each division, the average prize for each, and roughly how much a set of games wins back per draw.

## What it can and can't do

- **Every game has the same odds of winning Division 1.** For Saturday Lotto that's 1 in 8,145,060, whichever numbers you choose. No strategy changes that.
- **Coverage raises the chance that at least one of your games wins a prize.** Here's the chance of at least one prize in a draw:

  | Game | 18 Quick Picks | 18 Best coverage | 50 Quick Picks | 50 Best coverage |
  |---|---|---|---|---|
  | Saturday Lotto | 35.2% | 38.9% | 70.1% | 81.8% |
  | Powerball | 33.9% | 40.2% | 68.3% | 82.2% |
  | Set for Life | 30.5% | 33.5% | 63.5% | 72.0% |

  The optimiser minimises the exact chance that two of your games win in the same draw. That depends on how many numbers they share and, for Powerball, whether they share a Powerball.

  The average number of prizes stays the same. Coverage means more draws where you win something, but you win several prizes in one draw less often.
- **Avoiding popular numbers doesn't change your odds.** If you do win, fewer people share the prize with you.
- **The bias tests have found no reliable worn balls so far.** Saturday Lotto and Powerball look fair. Set for Life has a weak hint that some numbers stay hot, but it isn't statistically significant. The app's "Are the balls biased?" panel shows the latest results.

Gambling Help: 1800 858 858 · [gamblinghelponline.org.au](https://www.gamblinghelponline.org.au)

## How it works

| Path | What it is |
|---|---|
| `data/draws/*.csv` | Every draw since 1986 (Saturday Lotto), 1996 (Powerball) and 2015 (Set for Life). |
| `lottery/fetch.py` | Downloads new draws from thelott.com's results API, or the australia.national-lottery.com archive if the official site refuses the request. |
| `lottery/stats.py` | The bias tests. Frequencies are compared with simulated fair draws, with false-discovery correction for testing all 990+ pairs, and a backtest checks whether hot numbers stay hot in later draws. |
| `lottery/export.py` | Writes `docs/data/stats.json` for the phone app. |
| `docs/` | The phone app, static and hosted on GitHub Pages. `docs/js/engine.js` does the line picking and the exact prize odds. |
| `app.py` | A Streamlit dashboard for deeper analysis on a PC. |

A GitHub Action (`.github/workflows/update.yml`) downloads new draws twice a day and republishes the stats.

### Run locally

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements-dashboard.txt
.venv\Scripts\python -m lottery.fetch      # get new draws
.venv\Scripts\python -m lottery.export     # rebuild stats for the phone app
.venv\Scripts\streamlit run app.py         # analysis dashboard
node --test tests/engine.test.mjs          # engine tests
```

This project is not affiliated with The Lott or Tabcorp. Check official results before claiming a prize.
