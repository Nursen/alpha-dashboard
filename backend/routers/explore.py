"""
Explore endpoints — signals, sector heatmap, factor returns, screener,
and the pair investigation ("Research This") endpoint.
"""

from fastapi import APIRouter, Depends, Query, HTTPException
import yfinance as yf
import numpy as np
import pandas as pd
import logging

from auth import get_current_user
from db import get_db
from services.signals import run_signal_scan
from services.screener import screen_stocks
from services.market_data import get_prices, get_current_prices
from services.analytics import (
    calculate_pair_returns,
    calculate_spread_stats,
    calculate_beta_to_spy,
)
from services.fundamentals import compare_pair
from services.risk import check_with_proposed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/explore", tags=["explore"])


# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------

@router.get("/signals")
async def get_signals(user_id: str = Depends(get_current_user)):
    """
    Auto-generated pair trade suggestions from cointegration,
    valuation divergence, and correlation breakdown scanners.
    Cached for 1 hour (the scan is CPU-intensive).
    """
    try:
        signals = run_signal_scan()
        return {"signals": signals, "count": len(signals)}
    except Exception as e:
        logger.error(f"Signal scan failed: {e}")
        return {"signals": [], "count": 0, "error": str(e)}


# ---------------------------------------------------------------------------
# Sector Heatmap
# ---------------------------------------------------------------------------

SECTOR_ETFS = {
    "Technology": "XLK",
    "Financials": "XLF",
    "Energy": "XLE",
    "Healthcare": "XLV",
    "Industrials": "XLI",
    "Communication": "XLC",
    "Consumer Discretionary": "XLY",
    "Consumer Staples": "XLP",
    "Utilities": "XLU",
    "Materials": "XLB",
    "Real Estate": "XLRE",
}


@router.get("/sector-heatmap")
async def sector_heatmap(user_id: str = Depends(get_current_user)):
    """
    1-day, 1-week, and 1-month returns for all 11 SPDR sector ETFs.
    Useful for spotting sector rotation and relative strength.
    """
    etf_tickers = list(SECTOR_ETFS.values())
    results = []

    try:
        prices = get_prices(etf_tickers, period="3mo")
        if prices.empty:
            return {"sectors": [], "error": "Could not fetch sector ETF data"}

        for sector_name, etf in SECTOR_ETFS.items():
            if etf not in prices.columns:
                continue

            series = prices[etf].dropna()
            if len(series) < 2:
                continue

            current = float(series.iloc[-1])

            # Daily return
            daily_ret = float((series.iloc[-1] / series.iloc[-2] - 1) * 100) if len(series) >= 2 else None

            # Weekly return (5 trading days)
            weekly_ret = float((series.iloc[-1] / series.iloc[-6] - 1) * 100) if len(series) >= 6 else None

            # Monthly return (~21 trading days)
            monthly_ret = float((series.iloc[-1] / series.iloc[-22] - 1) * 100) if len(series) >= 22 else None

            results.append({
                "sector_name": sector_name,
                "etf": etf,
                "price": round(current, 2),
                "daily_return_pct": round(daily_ret, 2) if daily_ret is not None else None,
                "weekly_return_pct": round(weekly_ret, 2) if weekly_ret is not None else None,
                "monthly_return_pct": round(monthly_ret, 2) if monthly_ret is not None else None,
            })

    except Exception as e:
        logger.error(f"Sector heatmap failed: {e}")
        return {"sectors": [], "error": str(e)}

    return {"sectors": results}


# ---------------------------------------------------------------------------
# Factor Returns
# ---------------------------------------------------------------------------

FACTOR_ETFS = {
    "Momentum": "MTUM",
    "Value": "VLUE",
    "Quality": "QUAL",
    "Low Volatility": "USMV",
    "Size": "SIZE",
}


@router.get("/factors")
async def factor_returns(user_id: str = Depends(get_current_user)):
    """
    Returns for common factor ETFs. Shows which factors are working right now
    (momentum, value, quality, low-vol, size).
    """
    etf_tickers = list(FACTOR_ETFS.values())
    results = []

    try:
        prices = get_prices(etf_tickers, period="1y")
        if prices.empty:
            return {"factors": [], "error": "Could not fetch factor ETF data"}

        for factor_name, etf in FACTOR_ETFS.items():
            if etf not in prices.columns:
                continue

            series = prices[etf].dropna()
            if len(series) < 2:
                continue

            # Daily
            daily_ret = float((series.iloc[-1] / series.iloc[-2] - 1) * 100) if len(series) >= 2 else None

            # Weekly
            weekly_ret = float((series.iloc[-1] / series.iloc[-6] - 1) * 100) if len(series) >= 6 else None

            # Monthly
            monthly_ret = float((series.iloc[-1] / series.iloc[-22] - 1) * 100) if len(series) >= 22 else None

            # YTD: find first trading day of the year
            ytd_ret = None
            current_year = series.index[-1].year
            year_data = series[series.index.year == current_year]
            if len(year_data) >= 2:
                ytd_ret = float((year_data.iloc[-1] / year_data.iloc[0] - 1) * 100)

            results.append({
                "factor_name": factor_name,
                "etf": etf,
                "daily_return": round(daily_ret, 2) if daily_ret is not None else None,
                "weekly_return": round(weekly_ret, 2) if weekly_ret is not None else None,
                "monthly_return": round(monthly_ret, 2) if monthly_ret is not None else None,
                "ytd_return": round(ytd_ret, 2) if ytd_ret is not None else None,
            })

    except Exception as e:
        logger.error(f"Factor returns failed: {e}")
        return {"factors": [], "error": str(e)}

    return {"factors": results}


# ---------------------------------------------------------------------------
# Stock Screener
# ---------------------------------------------------------------------------

@router.get("/screen")
async def stock_screen(
    sector: str | None = Query(None, description="Filter by sector name (partial match)"),
    min_market_cap: float | None = Query(None, description="Minimum market cap in billions"),
    max_pe: float | None = Query(None, description="Maximum trailing P/E ratio"),
    min_volume: float | None = Query(None, description="Minimum average daily volume"),
    user_id: str = Depends(get_current_user),
):
    """
    Screen ~100 liquid US stocks by sector, market cap, P/E, and volume.
    First call loads the universe (slow); subsequent calls filter in memory (fast).
    """
    try:
        stocks = screen_stocks(
            sector=sector,
            min_market_cap=min_market_cap,
            max_pe=max_pe,
            min_volume=min_volume,
        )
        return {"stocks": stocks, "count": len(stocks)}
    except Exception as e:
        logger.error(f"Screener failed: {e}")
        return {"stocks": [], "count": 0, "error": str(e)}


# ---------------------------------------------------------------------------
# Investigate Pair ("Research This")
# ---------------------------------------------------------------------------

@router.get("/investigate")
async def investigate_pair(
    long: str = Query(..., description="Long ticker"),
    short: str = Query(..., description="Short ticker"),
    allocation: float = Query(5.0, description="Proposed allocation % per leg"),
    user_id: str = Depends(get_current_user),
):
    """
    One-stop pair research endpoint. Combines:
    - Pair analytics (correlation, beta, z-score, spread chart data)
    - Fundamentals comparison (scores, divergences)
    - Constraint pre-flight check (what happens if we add this?)

    This powers the "Research This" view on the frontend so it only
    needs a single API call.
    """
    long = long.upper()
    short = short.upper()

    result = {
        "long": long,
        "short": short,
        "allocation_pct": allocation,
        "analytics": None,
        "fundamentals": None,
        "constraint_check": None,
        "errors": [],
    }

    # --- 1. Analytics ---
    try:
        all_tickers = [long, short, "SPY"]
        prices_df = get_prices(all_tickers, period="1y")

        if prices_df.empty or long not in prices_df.columns or short not in prices_df.columns:
            result["errors"].append(f"Could not fetch prices for {long} and/or {short}")
        else:
            returns = prices_df.pct_change().dropna()
            long_ret = returns[long] if long in returns.columns else pd.Series(dtype=float)
            short_ret = returns[short] if short in returns.columns else pd.Series(dtype=float)
            spread_ret = long_ret - short_ret

            # Normalized prices
            long_cumul = (1 + long_ret).cumprod() * 100
            short_cumul = (1 + short_ret).cumprod() * 100
            dates = [d.strftime("%Y-%m-%d") for d in long_cumul.index]

            # Z-score series
            spread_cum = spread_ret.cumsum()
            window = 60
            roll_mean = spread_cum.rolling(window=window, min_periods=20).mean()
            roll_std = spread_cum.rolling(window=window, min_periods=20).std()
            zscore_series = ((spread_cum - roll_mean) / roll_std.replace(0, np.nan)).fillna(0)

            # Rolling correlation
            rolling_corr = long_ret.rolling(window=60, min_periods=20).corr(short_ret).dropna()

            # Overall correlation
            overall_corr = float(long_ret.corr(short_ret)) if len(long_ret) > 20 else None

            # Betas to SPY
            beta_long = beta_short = net_beta = None
            if "SPY" in returns.columns:
                spy_ret = returns["SPY"]
                common = long_ret.index.intersection(spy_ret.index)
                if len(common) > 20:
                    cov_l = np.cov(long_ret.loc[common].values, spy_ret.loc[common].values)
                    beta_long = round(float(cov_l[0, 1] / cov_l[1, 1]), 3) if cov_l[1, 1] > 0 else 0.0

                    cov_s = np.cov(short_ret.loc[common].values, spy_ret.loc[common].values)
                    beta_short = round(float(cov_s[0, 1] / cov_s[1, 1]), 3) if cov_s[1, 1] > 0 else 0.0

                    net_beta = round(beta_long - beta_short, 3)

            # Spread stats
            stats = calculate_spread_stats(spread_ret)

            # Half life
            half_life = None
            try:
                lagged = spread_cum.shift(1).dropna()
                delta = spread_cum.diff().dropna()
                common_idx = lagged.index.intersection(delta.index)
                if len(common_idx) > 20:
                    slope = np.polyfit(lagged.loc[common_idx].values, delta.loc[common_idx].values, 1)[0]
                    if slope < 0:
                        half_life = round(-np.log(2) / slope, 1)
            except Exception:
                pass

            # Max drawdown
            cum = (1 + spread_ret).cumprod()
            running_max = cum.cummax()
            drawdown = (cum - running_max) / running_max
            max_dd = round(float(drawdown.min()) * 100, 2) if len(drawdown) > 0 else None

            result["analytics"] = {
                "correlation": round(overall_corr, 4) if overall_corr is not None else None,
                "beta_long": beta_long,
                "beta_short": beta_short,
                "net_beta": net_beta,
                "spread_sharpe": stats.get("sharpe"),
                "spread_ann_return": stats.get("ann_return"),
                "spread_ann_vol": stats.get("ann_vol"),
                "current_zscore": stats.get("current_zscore"),
                "half_life_days": half_life,
                "max_drawdown_pct": max_dd,
                "price_data": {
                    "dates": dates,
                    "long_normalized": [round(float(v), 2) for v in long_cumul.values],
                    "short_normalized": [round(float(v), 2) for v in short_cumul.values],
                    "spread": [round(float(v), 4) for v in spread_cum.values],
                    "zscore_series": [round(float(v), 2) for v in zscore_series.values],
                },
                "rolling_correlation": {
                    "dates": [d.strftime("%Y-%m-%d") for d in rolling_corr.index],
                    "values": [round(float(v), 4) for v in rolling_corr.values],
                },
            }

    except Exception as e:
        logger.error(f"Investigate analytics failed: {e}")
        result["errors"].append(f"Analytics error: {e}")

    # --- 2. Fundamentals comparison ---
    try:
        result["fundamentals"] = compare_pair(long, short)
    except Exception as e:
        logger.error(f"Investigate fundamentals failed: {e}")
        result["errors"].append(f"Fundamentals error: {e}")

    # --- 3. Constraint pre-flight ---
    try:
        db = get_db()
        cursor = db.spreads.find({})
        existing = []
        async for doc in cursor:
            if doc.get("status") != "closed":
                doc["id"] = str(doc.pop("_id"))
                existing.append(doc)

        proposed = {
            "asset_class": "equities",
            "long_leg": {
                "tickers": [long],
                "weights": [1.0],
                "allocation_pct": allocation,
            },
            "short_leg": {
                "tickers": [short],
                "weights": [1.0],
                "allocation_pct": allocation,
            },
            "status": "proposed",
        }

        constraints = check_with_proposed(existing, proposed)
        has_violations = any(c.status == "violation" for c in constraints)
        result["constraint_check"] = {
            "constraints": [c.model_dump() for c in constraints],
            "has_violations": has_violations,
        }

    except Exception as e:
        logger.error(f"Investigate constraint check failed: {e}")
        result["errors"].append(f"Constraint check error: {e}")

    return result
