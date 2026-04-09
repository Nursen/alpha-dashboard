"""
Signal scanner — auto-discovers pair trade opportunities using three approaches:
cointegration, valuation divergence, and correlation breakdown.

Heavy on yfinance calls so caches aggressively (1h TTL on the full scan result).
"""

import numpy as np
import pandas as pd
import yfinance as yf
from cachetools import TTLCache
from statsmodels.tsa.stattools import adfuller
import logging

from services.market_data import get_prices, get_ticker_info

logger = logging.getLogger(__name__)

# Cache the full scan result for 1 hour
_scan_cache: TTLCache = TTLCache(maxsize=1, ttl=3600)

# Liquid US universe grouped by sector
SECTOR_UNIVERSE = {
    "Technology": ["AAPL", "MSFT", "GOOG", "META", "NVDA", "AMD", "CRM", "ADBE", "INTC", "ORCL"],
    "Healthcare": ["JNJ", "UNH", "PFE", "ABBV", "MRK", "LLY", "TMO", "ABT"],
    "Financials": ["JPM", "BAC", "GS", "MS", "WFC", "BRK-B", "C", "AXP"],
    "Consumer Discretionary": ["AMZN", "TSLA", "HD", "NKE", "MCD", "SBUX", "TGT", "LOW"],
    "Consumer Staples": ["PG", "KO", "PEP", "WMT", "COST", "CL", "PM"],
    "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "PSX"],
    "Industrials": ["CAT", "HON", "UPS", "GE", "RTX", "DE", "LMT"],
    "Materials": ["LIN", "APD", "ECL", "NEM", "FCX"],
}


def _all_tickers() -> list[str]:
    """Flat list of every ticker in the universe."""
    tickers = []
    for sector_tickers in SECTOR_UNIVERSE.values():
        tickers.extend(sector_tickers)
    return tickers


def _calc_half_life(spread: pd.Series) -> float | None:
    """Ornstein-Uhlenbeck half-life estimation."""
    try:
        lagged = spread.shift(1).dropna()
        delta = spread.diff().dropna()
        common = lagged.index.intersection(delta.index)
        if len(common) < 20:
            return None
        slope = np.polyfit(lagged.loc[common].values, delta.loc[common].values, 1)[0]
        if slope < 0:
            return round(-np.log(2) / slope, 1)
    except Exception:
        pass
    return None


def scan_cointegration(sector_tickers: dict[str, list[str]]) -> list[dict]:
    """
    Test all intra-sector pairs for cointegration using ADF test.
    Returns pairs where the spread is stationary (p < 0.05) AND
    current z-score is extended (|z| > 1.5), suggesting an entry opportunity.
    """
    signals = []

    for sector, tickers in sector_tickers.items():
        if len(tickers) < 2:
            continue

        # Batch-fetch prices for the whole sector
        prices = get_prices(tickers, period="1y")
        if prices.empty or len(prices.columns) < 2:
            continue

        available = [t for t in tickers if t in prices.columns]

        for i in range(len(available)):
            for j in range(i + 1, len(available)):
                t1, t2 = available[i], available[j]
                try:
                    p1 = prices[t1].dropna()
                    p2 = prices[t2].dropna()
                    common = p1.index.intersection(p2.index)
                    if len(common) < 60:
                        continue

                    p1c = p1.loc[common]
                    p2c = p2.loc[common]

                    # OLS hedge ratio
                    slope = np.polyfit(p2c.values, p1c.values, 1)[0]
                    spread = p1c - slope * p2c

                    # ADF test for stationarity
                    adf_result = adfuller(spread.values, maxlag=10, autolag="AIC")
                    p_value = adf_result[1]

                    if p_value >= 0.05:
                        continue

                    # Z-score of current spread
                    zscore = float((spread.iloc[-1] - spread.mean()) / spread.std()) if spread.std() > 0 else 0.0

                    if abs(zscore) < 1.5:
                        continue

                    half_life = _calc_half_life(spread)

                    # Determine direction: long the undervalued, short the overvalued
                    if zscore < 0:
                        long_tk, short_tk = t1, t2
                    else:
                        long_tk, short_tk = t2, t1

                    # Strength: combines statistical confidence, extension, and speed
                    # 1. Statistical confidence (0-0.4): lower p-value = more confident
                    stat_score = (1 - p_value) * 0.4
                    # 2. Extension from mean (0-0.35): higher |z| = bigger opportunity
                    z_score_component = min(abs(zscore) / 3, 1.0) * 0.35
                    # 3. Mean-reversion speed (0-0.25): shorter half-life = faster payoff
                    if half_life and half_life > 0:
                        speed_score = max(0, 1 - half_life / 120) * 0.25  # <30 days = great, >120 = 0
                    else:
                        speed_score = 0.1  # unknown half-life gets partial credit
                    strength = round(min(1.0, stat_score + z_score_component + speed_score), 2)

                    signals.append({
                        "long": long_tk,
                        "short": short_tk,
                        "sector": sector,
                        "signal_type": "cointegration",
                        "p_value": round(p_value, 4),
                        "zscore": round(zscore, 2),
                        "half_life": half_life,
                        "strength": strength,
                        "rationale": (
                            f"{t1} and {t2} prices move together over the long run "
                            f"(cointegrated, p={p_value:.3f}), but right now the spread is "
                            f"extended at z={zscore:.1f}. This suggests the cheaper one "
                            f"should catch up — a mean-reversion trade."
                            + (f" Estimated mean-reversion time: ~{half_life:.0f} trading days"
                               f" ({'fast' if half_life < 30 else 'moderate' if half_life < 60 else 'slow'})."
                               if half_life else "")
                        ),
                    })

                except Exception as e:
                    logger.debug(f"Coint test failed for {t1}/{t2}: {e}")
                    continue

    return signals


def scan_valuation_divergence(sector_tickers: dict[str, list[str]]) -> list[dict]:
    """
    Flag same-sector pairs with valuation divergence using multiple metrics:
    trailing P/E, forward P/E, PEG ratio, and EV/EBITDA.

    Growth-adjusted: a stock trading at 40x P/E with 40% growth (PEG=1.0)
    is fairly valued vs. one at 20x P/E with 5% growth (PEG=4.0).
    """
    signals = []

    for sector, tickers in sector_tickers.items():
        fundamentals = {}
        for ticker in tickers:
            try:
                info = yf.Ticker(ticker).info
                trailing_pe = info.get("trailingPE")
                forward_pe = info.get("forwardPE")
                peg = info.get("pegRatio")
                ev_ebitda = info.get("enterpriseToEbitda")
                revenue_growth = info.get("revenueGrowth")  # decimal, e.g. 0.25 = 25%
                earnings_growth = info.get("earningsGrowth")  # decimal

                # Need at least trailing P/E
                if trailing_pe is None or trailing_pe <= 0:
                    continue

                fundamentals[ticker] = {
                    "trailing_pe": float(trailing_pe),
                    "forward_pe": float(forward_pe) if forward_pe and forward_pe > 0 else None,
                    "peg": float(peg) if peg and peg > 0 else None,
                    "ev_ebitda": float(ev_ebitda) if ev_ebitda and ev_ebitda > 0 else None,
                    "revenue_growth": float(revenue_growth) if revenue_growth else None,
                    "earnings_growth": float(earnings_growth) if earnings_growth else None,
                }
            except Exception:
                continue

        available = list(fundamentals.keys())
        for i in range(len(available)):
            for j in range(i + 1, len(available)):
                t1, t2 = available[i], available[j]
                f1, f2 = fundamentals[t1], fundamentals[t2]

                # Score each ticker: lower = cheaper/better value
                # Composite valuation score (0-100, lower = cheaper)
                score1 = _valuation_score(f1)
                score2 = _valuation_score(f2)

                if score1 is None or score2 is None:
                    continue

                # Need meaningful gap
                score_gap = abs(score1 - score2)
                if score_gap < 20:
                    continue

                if score1 < score2:
                    cheap, expensive = t1, t2
                    f_cheap, f_expensive = f1, f2
                    score_cheap, score_expensive = score1, score2
                else:
                    cheap, expensive = t2, t1
                    f_cheap, f_expensive = f2, f1
                    score_cheap, score_expensive = score2, score1

                # Strength based on composite gap (20-80 range mapped to 0-1)
                strength = round(min(1.0, (score_gap - 20) / 60), 2)

                # Build detailed rationale
                rationale_parts = [
                    f"In {sector}, {cheap} looks cheaper than {expensive} "
                    f"on a growth-adjusted basis (composite score {score_cheap:.0f} vs {score_expensive:.0f})."
                ]

                pe_cheap = f_cheap["trailing_pe"]
                pe_expensive = f_expensive["trailing_pe"]
                rationale_parts.append(
                    f"Trailing P/E: {cheap} at {pe_cheap:.1f}x vs {expensive} at {pe_expensive:.1f}x."
                )

                if f_cheap.get("peg") and f_expensive.get("peg"):
                    rationale_parts.append(
                        f"PEG ratio (growth-adjusted): {cheap} at {f_cheap['peg']:.1f}x vs "
                        f"{expensive} at {f_expensive['peg']:.1f}x — "
                        f"{'cheap stock also grows faster' if f_cheap['peg'] < f_expensive['peg'] else 'expensive stock grows faster, partially justifying premium'}."
                    )

                if f_cheap.get("revenue_growth") is not None and f_expensive.get("revenue_growth") is not None:
                    rg_c = f_cheap["revenue_growth"] * 100
                    rg_e = f_expensive["revenue_growth"] * 100
                    rationale_parts.append(
                        f"Revenue growth: {cheap} at {rg_c:+.1f}% vs {expensive} at {rg_e:+.1f}%."
                    )

                signals.append({
                    "long": cheap,
                    "short": expensive,
                    "sector": sector,
                    "signal_type": "valuation",
                    "pe_long": round(pe_cheap, 1),
                    "pe_short": round(pe_expensive, 1),
                    "pe_ratio": round(pe_expensive / pe_cheap, 2) if pe_cheap > 0 else None,
                    "peg_long": f_cheap.get("peg"),
                    "peg_short": f_expensive.get("peg"),
                    "ev_ebitda_long": f_cheap.get("ev_ebitda"),
                    "ev_ebitda_short": f_expensive.get("ev_ebitda"),
                    "revenue_growth_long": f_cheap.get("revenue_growth"),
                    "revenue_growth_short": f_expensive.get("revenue_growth"),
                    "score_long": round(score_cheap, 1),
                    "score_short": round(score_expensive, 1),
                    "strength": strength,
                    "rationale": " ".join(rationale_parts),
                })

    return signals


def _valuation_score(f: dict) -> float | None:
    """
    Composite valuation score (0-100). Lower = cheaper.

    Combines multiple metrics with growth adjustment:
    - Trailing P/E (30% weight)
    - Forward P/E (20% weight, if available)
    - PEG ratio (30% weight, if available — this is the growth-adjusted metric)
    - EV/EBITDA (20% weight, if available)

    Each metric is scored 0-100 based on percentile-like thresholds:
    - P/E: <10 = 0, 10-15 = 20, 15-25 = 40, 25-40 = 60, 40-60 = 80, >60 = 100
    - PEG: <0.5 = 0, 0.5-1.0 = 20, 1.0-1.5 = 40, 1.5-2.5 = 60, 2.5-4 = 80, >4 = 100
    - EV/EBITDA: <8 = 0, 8-12 = 20, 12-18 = 40, 18-25 = 60, 25-35 = 80, >35 = 100
    """
    scores = []
    weights = []

    # Trailing P/E (always available)
    pe = f["trailing_pe"]
    pe_score = _bucket_score(pe, [10, 15, 25, 40, 60])
    scores.append(pe_score)
    weights.append(0.3)

    # Forward P/E
    if f.get("forward_pe"):
        fpe_score = _bucket_score(f["forward_pe"], [10, 15, 25, 40, 60])
        scores.append(fpe_score)
        weights.append(0.2)

    # PEG (growth-adjusted — most important)
    if f.get("peg"):
        peg_score = _bucket_score(f["peg"], [0.5, 1.0, 1.5, 2.5, 4.0])
        scores.append(peg_score)
        weights.append(0.3)

    # EV/EBITDA
    if f.get("ev_ebitda"):
        ev_score = _bucket_score(f["ev_ebitda"], [8, 12, 18, 25, 35])
        scores.append(ev_score)
        weights.append(0.2)

    if not scores:
        return None

    # Weighted average
    total_weight = sum(weights)
    return sum(s * w for s, w in zip(scores, weights)) / total_weight


def _bucket_score(value: float, thresholds: list[float]) -> float:
    """Map a value into 0-100 based on bucket thresholds."""
    if value <= thresholds[0]:
        return 0
    for i, t in enumerate(thresholds):
        if value <= t:
            # Linear interpolation within bucket
            prev = thresholds[i - 1] if i > 0 else 0
            bucket_start = i * 20
            bucket_end = (i + 1) * 20
            frac = (value - prev) / (t - prev) if t > prev else 0
            return bucket_start + frac * 20
    return 100


def scan_correlation_breakdown(tickers: list[str]) -> list[dict]:
    """
    Find historically correlated pairs where recent correlation has collapsed.
    If 1Y correlation > 0.5 but 60-day correlation < 0.2, flag as convergence trade.
    """
    signals = []

    prices = get_prices(tickers, period="1y")
    if prices.empty or len(prices.columns) < 2:
        return signals

    returns = prices.pct_change().dropna()
    if len(returns) < 90:
        return signals

    available = list(returns.columns)

    # Full-period correlation matrix
    full_corr = returns.corr()

    # Recent 60-day correlation
    recent_returns = returns.iloc[-60:]
    recent_corr = recent_returns.corr()

    for i in range(len(available)):
        for j in range(i + 1, len(available)):
            t1, t2 = available[i], available[j]
            hist_c = full_corr.loc[t1, t2]
            rec_c = recent_corr.loc[t1, t2]

            if hist_c > 0.5 and rec_c < 0.2:
                # Determine which one underperformed recently (long that one)
                ret_60d_1 = float(returns[t1].iloc[-60:].sum())
                ret_60d_2 = float(returns[t2].iloc[-60:].sum())

                if ret_60d_1 < ret_60d_2:
                    long_tk, short_tk = t1, t2
                else:
                    long_tk, short_tk = t2, t1

                strength = round(min(1.0, (hist_c - rec_c) / 0.5), 2)

                signals.append({
                    "long": long_tk,
                    "short": short_tk,
                    "signal_type": "correlation_breakdown",
                    "historical_corr": round(float(hist_c), 3),
                    "recent_corr": round(float(rec_c), 3),
                    "strength": strength,
                    "rationale": (
                        f"{t1} and {t2} have been moving together historically "
                        f"(correlation {hist_c:.2f}), but over the last 60 days their "
                        f"correlation dropped to {rec_c:.2f}. This divergence often "
                        f"reverts -- the laggard catches up to the leader."
                    ),
                })

    return signals


def run_signal_scan() -> list[dict]:
    """
    Master scan: run all three scanners, merge, dedupe, sort by strength.
    Returns top 20 signals. Cached for 1 hour.
    """
    cache_key = "full_scan"
    if cache_key in _scan_cache:
        return _scan_cache[cache_key]

    logger.info("Starting full signal scan (~50+ tickers, may take a minute)")

    all_signals = []

    # 1. Cointegration (intra-sector)
    try:
        coint = scan_cointegration(SECTOR_UNIVERSE)
        all_signals.extend(coint)
        logger.info(f"Cointegration scanner found {len(coint)} signals")
    except Exception as e:
        logger.error(f"Cointegration scan failed: {e}")

    # 2. Valuation divergence (intra-sector)
    try:
        val = scan_valuation_divergence(SECTOR_UNIVERSE)
        all_signals.extend(val)
        logger.info(f"Valuation scanner found {len(val)} signals")
    except Exception as e:
        logger.error(f"Valuation scan failed: {e}")

    # 3. Correlation breakdown (cross-sector)
    try:
        corr = scan_correlation_breakdown(_all_tickers())
        all_signals.extend(corr)
        logger.info(f"Correlation scanner found {len(corr)} signals")
    except Exception as e:
        logger.error(f"Correlation scan failed: {e}")

    # Deduplicate: same pair (regardless of order) keeps the stronger signal
    seen = {}
    for sig in all_signals:
        pair_key = tuple(sorted([sig.get("long", ""), sig.get("short", "")]))
        existing = seen.get(pair_key)
        if existing is None or sig.get("strength", 0) > existing.get("strength", 0):
            seen[pair_key] = sig

    deduped = list(seen.values())
    deduped.sort(key=lambda s: s.get("strength", 0), reverse=True)

    result = deduped[:20]
    _scan_cache[cache_key] = result
    logger.info(f"Signal scan complete: {len(result)} signals returned")
    return result
