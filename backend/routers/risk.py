"""
Risk management API endpoints.

Serves position-level risk data computed from StockTrak positions.
All heavy computation is done in risk_calculator and cached here for 5 min.
"""

from fastapi import APIRouter, Depends
from cachetools import TTLCache
import logging

from auth import get_current_user
from services.risk_calculator import (
    compute_full_risk,
    get_positions,
    compute_exposures,
    compute_beta_adjusted_exposure,
    compute_var,
    compute_theme_correlation,
    compute_scenarios,
    compute_flags,
    fetch_betas,
    compute_factor_exposures,
    compute_liquidity,
    compute_optimization,
)
from services.market_data import get_prices
import pandas as pd

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/risk", tags=["risk"])

# Cache the full risk computation for 5 minutes
_risk_cache: TTLCache = TTLCache(maxsize=1, ttl=300)
# Separate caches for expensive one-off computations
_factor_cache: TTLCache = TTLCache(maxsize=1, ttl=600)
_liquidity_cache: TTLCache = TTLCache(maxsize=1, ttl=600)
_optimize_cache: TTLCache = TTLCache(maxsize=1, ttl=600)


def _get_cached_risk() -> dict:
    """Return cached risk data, computing if stale."""
    cache_key = "full_risk"
    if cache_key in _risk_cache:
        return _risk_cache[cache_key]

    result = compute_full_risk()
    _risk_cache[cache_key] = result
    return result


@router.get("/summary")
async def risk_summary(user_id: str = Depends(get_current_user)):
    """
    Full risk dashboard data — exposures, VaR, drawdown, scenarios, flags.
    Cached for 5 minutes.
    """
    return _get_cached_risk()


@router.get("/var")
async def risk_var(user_id: str = Depends(get_current_user)):
    """VaR details — parametric + historical, 95% + 99%."""
    data = _get_cached_risk()
    return data.get("var", {})


@router.get("/correlation")
async def risk_correlation(user_id: str = Depends(get_current_user)):
    """Theme correlation matrix."""
    data = _get_cached_risk()
    return data.get("correlation", {})


@router.get("/scenarios")
async def risk_scenarios(user_id: str = Depends(get_current_user)):
    """Scenario analysis results."""
    data = _get_cached_risk()
    return {"scenarios": data.get("scenarios", [])}


@router.get("/flags")
async def risk_flags(user_id: str = Depends(get_current_user)):
    """Flagged positions (winners >+20%, losers <-15%)."""
    data = _get_cached_risk()
    return {"flags": data.get("flags", [])}


@router.get("/factors")
async def risk_factors(user_id: str = Depends(get_current_user)):
    """Factor exposure by position and theme (FF5 + Momentum)."""
    cache_key = "factors"
    if cache_key in _factor_cache:
        return _factor_cache[cache_key]

    positions = get_positions()
    tickers = list(set(p.ticker for p in positions))
    prices_df = get_prices(tickers, period="2y")
    returns_df = prices_df.pct_change().dropna() if not prices_df.empty else pd.DataFrame()

    result = compute_factor_exposures(positions, returns_df)
    _factor_cache[cache_key] = result
    return result


@router.get("/liquidity")
async def risk_liquidity(user_id: str = Depends(get_current_user)):
    """Days to liquidate each position at 15% VWAP participation."""
    cache_key = "liquidity"
    if cache_key in _liquidity_cache:
        return _liquidity_cache[cache_key]

    positions = get_positions()
    result = {"positions": compute_liquidity(positions)}
    _liquidity_cache[cache_key] = result
    return result


@router.get("/optimize")
async def risk_optimize(user_id: str = Depends(get_current_user)):
    """Mean-variance optimizer suggesting theme-level weight adjustments."""
    cache_key = "optimize"
    if cache_key in _optimize_cache:
        return _optimize_cache[cache_key]

    positions = get_positions()
    tickers = list(set(p.ticker for p in positions))
    prices_df = get_prices(tickers, period="1y")
    returns_df = prices_df.pct_change().dropna() if not prices_df.empty else pd.DataFrame()

    result = compute_optimization(positions, returns_df)
    _optimize_cache[cache_key] = result
    return result
