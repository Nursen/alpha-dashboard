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
)
from services.market_data import get_prices
import pandas as pd

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/risk", tags=["risk"])

# Cache the full risk computation for 5 minutes
_risk_cache: TTLCache = TTLCache(maxsize=1, ttl=300)


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
