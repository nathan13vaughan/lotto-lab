"""Statistical tests for number bias and pair co-occurrence.

Every "is this unusual?" question is answered against simulated fair draws with
the same shape (same number of draws, same pool, same numbers per draw), so the
tests are exact for draw-without-replacement and need no approximations.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats


def incidence(draws: list[list[int]], pool: int) -> np.ndarray:
    """D x pool 0/1 matrix: row d has a 1 in column n-1 if number n was drawn."""
    x = np.zeros((len(draws), pool), dtype=np.int32)
    for i, nums in enumerate(draws):
        x[i, np.asarray(nums) - 1] = 1
    return x


def simulate_incidence(n_draws: int, pool: int, k: int, rng: np.random.Generator) -> np.ndarray:
    """Fair draws: k distinct numbers out of pool, n_draws times."""
    picks = np.argsort(rng.random((n_draws, pool)), axis=1)[:, :k]
    x = np.zeros((n_draws, pool), dtype=np.int32)
    np.put_along_axis(x, picks, 1, axis=1)
    return x


def _pair_counts(x: np.ndarray) -> np.ndarray:
    c = x.T @ x
    iu = np.triu_indices(x.shape[1], 1)
    return c[iu]


def _chi2(obs: np.ndarray, exp: float) -> float:
    return float(((obs - exp) ** 2 / exp).sum())


@dataclass
class NumberResult:
    table: pd.DataFrame          # per-number counts, expected, z, p, q
    chi2: float
    chi2_p: float                # Monte Carlo p-value for "all numbers equally likely"


@dataclass
class PairResult:
    table: pd.DataFrame          # per-pair counts, expected, z, p, q
    chi2: float
    chi2_p: float                # Monte Carlo p-value for "all pairs equally likely"
    n_significant: int           # pairs with q < 0.05 after FDR correction


def bh_fdr(p: np.ndarray) -> np.ndarray:
    """Benjamini-Hochberg adjusted p-values (q-values)."""
    p = np.asarray(p, dtype=float)
    n = len(p)
    order = np.argsort(p)
    ranked = p[order] * n / np.arange(1, n + 1)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(n)
    out[order] = np.clip(q, 0, 1)
    return out


def _binom_two_sided(counts: np.ndarray, n: int, prob: float) -> np.ndarray:
    lo = stats.binom.cdf(counts, n, prob)
    hi = stats.binom.sf(counts - 1, n, prob)
    return np.clip(2 * np.minimum(lo, hi), 0, 1)


def number_stats(x: np.ndarray, k: int, sims: int = 1000, seed: int = 0) -> NumberResult:
    d, pool = x.shape
    obs = x.sum(axis=0)
    p = k / pool
    exp = d * p
    sd = np.sqrt(d * p * (1 - p))
    pvals = _binom_two_sided(obs, d, p)
    chi = _chi2(obs, exp)
    rng = np.random.default_rng(seed)
    null = np.array([_chi2(simulate_incidence(d, pool, k, rng).sum(axis=0), exp) for _ in range(sims)])
    table = pd.DataFrame({
        "number": np.arange(1, pool + 1),
        "count": obs,
        "expected": exp,
        "z": (obs - exp) / sd,
        "p": pvals,
        "q": bh_fdr(pvals),
    })
    return NumberResult(table, chi, float((null >= chi).mean()))


def pair_stats(x: np.ndarray, k: int, sims: int = 500, seed: int = 0) -> PairResult:
    d, pool = x.shape
    obs = _pair_counts(x)
    q_pair = k * (k - 1) / (pool * (pool - 1))
    exp = d * q_pair
    sd = np.sqrt(d * q_pair * (1 - q_pair))
    pvals = _binom_two_sided(obs, d, q_pair)
    chi = _chi2(obs, exp)
    rng = np.random.default_rng(seed)
    null = np.array([_chi2(_pair_counts(simulate_incidence(d, pool, k, rng)), exp) for _ in range(sims)])
    a, b = np.triu_indices(pool, 1)
    qv = bh_fdr(pvals)
    table = pd.DataFrame({
        "a": a + 1, "b": b + 1, "count": obs, "expected": exp,
        "z": (obs - exp) / sd, "p": pvals, "q": qv,
    })
    return PairResult(table, chi, float((null >= chi).mean()), int((qv < 0.05).sum()))


def triple_index(pool: int) -> np.ndarray:
    """Lookup (pool+1)^3 -> position of triple a<b<c in lexicographic order (-1 if invalid)."""
    idx = np.full((pool + 1, pool + 1, pool + 1), -1, dtype=np.int64)
    n = 0
    for a in range(1, pool + 1):
        for b in range(a + 1, pool + 1):
            for c in range(b + 1, pool + 1):
                idx[a, b, c] = n
                n += 1
    return idx


def _triple_counts(x: np.ndarray, idx: np.ndarray, n_triples: int) -> np.ndarray:
    d, pool = x.shape
    k = int(x[0].sum())
    nums = np.sort(np.nonzero(x)[1].reshape(d, k) + 1, axis=1)   # every row has k numbers
    a, b, c = (np.array(v) for v in zip(*combinations(range(k), 3)))
    t = idx[nums[:, a], nums[:, b], nums[:, c]].ravel()
    return np.bincount(t, minlength=n_triples)


@dataclass
class TripleResult:
    counts: np.ndarray           # per triple, lexicographic a<b<c
    expected: float
    z: np.ndarray
    chi2_p: float                # Monte Carlo p-value for "all triples equally likely"
    n_significant: int           # triples with q < 0.05 after FDR correction


def triple_stats(x: np.ndarray, k: int, sims: int = 200, seed: int = 0) -> TripleResult:
    d, pool = x.shape
    idx = triple_index(pool)
    n_t = pool * (pool - 1) * (pool - 2) // 6
    obs = _triple_counts(x, idx, n_t)
    q_t = k * (k - 1) * (k - 2) / (pool * (pool - 1) * (pool - 2))
    exp = d * q_t
    sd = np.sqrt(d * q_t * (1 - q_t))
    chi = _chi2(obs, exp)
    rng = np.random.default_rng(seed)
    null = np.array([_chi2(_triple_counts(simulate_incidence(d, pool, k, rng), idx, n_t), exp) for _ in range(sims)])
    qv = bh_fdr(stats.binom.sf(obs - 1, d, q_t))   # one-sided: triples drawn together MORE than chance
    return TripleResult(obs, exp, (obs - exp) / sd, float((null >= chi).mean()), int((qv < 0.05).sum()))


def pair_matrix(pairs: pd.DataFrame, pool: int, value: str = "z") -> np.ndarray:
    m = np.full((pool, pool), np.nan)
    m[pairs["a"] - 1, pairs["b"] - 1] = pairs[value]
    m[pairs["b"] - 1, pairs["a"] - 1] = pairs[value]
    return m


@dataclass
class BacktestResult:
    kind: str                    # "numbers" or "pairs"
    train_draws: int
    test_draws: int
    top: pd.DataFrame            # the "hot" items picked in training and how they did in testing
    test_hits: int
    test_expected: float
    test_z: float
    correlation: float           # Spearman correlation of train vs test z-scores over all items
    correlation_p: float         # Monte Carlo p-value for that correlation


def backtest(x_train: np.ndarray, x_test: np.ndarray, k: int, kind: str = "pairs",
             top_n: int = 20, sims: int = 300, seed: int = 0) -> BacktestResult:
    """Did the items that looked hot in the training draws stay hot in later draws?

    If ball wear causes a persistent bias, hot items should keep beating chance
    out-of-sample and train/test z-scores should be positively correlated.
    If the "hotness" was just noise, both effects vanish.
    """
    pool = x_train.shape[1]
    if kind == "triples":
        tidx = triple_index(pool)
        n_t = pool * (pool - 1) * (pool - 2) // 6
        count = lambda m: _triple_counts(m, tidx, n_t)  # noqa: E731
        prob = k * (k - 1) * (k - 2) / (pool * (pool - 1) * (pool - 2))
        labels = [f"{a}-{b}-{c}" for a, b, c in combinations(range(1, pool + 1), 3)]
    elif kind == "pairs":
        count = _pair_counts
        prob = k * (k - 1) / (pool * (pool - 1))
        a, b = np.triu_indices(pool, 1)
        labels = [f"{i + 1}-{j + 1}" for i, j in zip(a, b)]
    else:
        count = lambda m: m.sum(axis=0)  # noqa: E731
        prob = k / pool
        labels = [str(i) for i in range(1, pool + 1)]

    def z(c, n):
        return (c - n * prob) / np.sqrt(n * prob * (1 - prob))

    dtr, dte = len(x_train), len(x_test)
    tr, te = count(x_train), count(x_test)
    ztr, zte = z(tr, dtr), z(te, dte)
    top_idx = np.argsort(-ztr, kind="stable")[:top_n]
    hits = int(te[top_idx].sum())
    exp = top_n * dte * prob
    sd = np.sqrt(top_n * dte * prob * (1 - prob))

    rho = float(stats.spearmanr(ztr, zte).statistic)
    rng = np.random.default_rng(seed)
    null = []
    for _ in range(sims):
        sim_te = count(simulate_incidence(dte, pool, k, rng))
        null.append(stats.spearmanr(ztr, z(sim_te, dte)).statistic)
    rho_p = float((np.asarray(null) >= rho).mean())

    top = pd.DataFrame({
        "item": [labels[i] for i in top_idx],
        "train_count": tr[top_idx], "train_expected": dtr * prob, "train_z": ztr[top_idx],
        "test_count": te[top_idx], "test_expected": dte * prob, "test_z": zte[top_idx],
    })
    return BacktestResult(kind, dtr, dte, top, hits, exp, (hits - exp) / sd, rho, rho_p)
