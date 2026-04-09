from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
import numpy as np
import pandas as pd
import logging

from auth import get_current_user
from db import get_db

import db as _db_module

def _to_id(s):
    if _db_module.MONGODB_AVAILABLE:
        from bson import ObjectId
        return ObjectId(s)
    return s
from models.spread import SpreadCreate, SpreadResponse, NoteCreate
from services.market_data import get_current_prices, get_prices
from services.analytics import (
    calculate_pair_returns,
    calculate_spread_stats,
    calculate_beta_to_spy,
    TRADING_DAYS,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/spreads", tags=["spreads"])


def _spread_to_response(doc: dict) -> dict:
    """Convert MongoDB document to response dict."""
    doc["id"] = str(doc.pop("_id"))
    return doc


def _all_tickers(spread: dict) -> list[str]:
    """Extract all tickers from a spread dict."""
    tickers = []
    tickers.extend(spread.get("long_leg", {}).get("tickers", []))
    tickers.extend(spread.get("short_leg", {}).get("tickers", []))
    return tickers


@router.post("", response_model=SpreadResponse)
async def create_spread(
    spread: SpreadCreate,
    user_id: str = Depends(get_current_user),
):
    """Create a new spread. Fetches entry prices from yfinance."""
    db = get_db()

    all_tickers = spread.long_leg.tickers + spread.short_leg.tickers
    entry_prices = get_current_prices(all_tickers)

    # Warn if any tickers missing prices (but don't block)
    missing = [t for t in all_tickers if t not in entry_prices]

    doc = spread.model_dump()
    doc.update({
        "status": "proposed",
        "created_by": user_id,
        "created_at": datetime.now(timezone.utc),
        "entry_prices": entry_prices,
        "current_prices": None,
        "pnl_pct": None,
        "notes": [],
    })

    if missing:
        doc["notes"].append({
            "text": f"Warning: could not fetch prices for {missing}",
            "author": "system",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    result = await db.spreads.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _spread_to_response(doc)


@router.get("")
async def list_spreads(
    status: str | None = Query(None),
    asset_class: str | None = Query(None),
    user_id: str = Depends(get_current_user),
):
    """List spreads with optional filters."""
    db = get_db()
    query = {}
    if status:
        query["status"] = status
    if asset_class:
        query["asset_class"] = asset_class.lower()

    cursor = db.spreads.find(query).sort("created_at", -1)
    spreads = []
    async for doc in cursor:
        spreads.append(_spread_to_response(doc))
    return spreads


@router.get("/{spread_id}", response_model=SpreadResponse)
async def get_spread(
    spread_id: str,
    user_id: str = Depends(get_current_user),
):
    """Get one spread with live current prices and P&L."""
    db = get_db()

    try:
        doc = await db.spreads.find_one({"_id": _to_id(spread_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid spread ID")

    if not doc:
        raise HTTPException(status_code=404, detail="Spread not found")

    # Fetch live prices
    tickers = _all_tickers(doc)
    current_prices = get_current_prices(tickers)

    if current_prices and doc.get("entry_prices"):
        pnl = _calculate_pnl(doc, current_prices)
        doc["current_prices"] = current_prices
        doc["pnl_pct"] = pnl

    return _spread_to_response(doc)


@router.put("/{spread_id}")
async def update_spread(
    spread_id: str,
    updates: dict,
    user_id: str = Depends(get_current_user),
):
    """Update spread fields (allocation, status, etc)."""
    db = get_db()

    # Only allow certain fields to be updated
    allowed = {"status", "long_leg", "short_leg", "thesis", "stop_loss_pct", "theme"}
    filtered = {k: v for k, v in updates.items() if k in allowed}

    if not filtered:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    try:
        result = await db.spreads.update_one(
            {"_id": _to_id(spread_id)},
            {"$set": filtered},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid spread ID")

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Spread not found")

    doc = await db.spreads.find_one({"_id": _to_id(spread_id)})
    return _spread_to_response(doc)


@router.delete("/{spread_id}")
async def close_spread(
    spread_id: str,
    user_id: str = Depends(get_current_user),
):
    """Close a spread — records exit prices and sets status=closed."""
    db = get_db()

    try:
        doc = await db.spreads.find_one({"_id": _to_id(spread_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid spread ID")

    if not doc:
        raise HTTPException(status_code=404, detail="Spread not found")

    # Get exit prices
    tickers = _all_tickers(doc)
    exit_prices = get_current_prices(tickers)
    pnl = _calculate_pnl(doc, exit_prices) if exit_prices else None

    await db.spreads.update_one(
        {"_id": _to_id(spread_id)},
        {
            "$set": {
                "status": "closed",
                "exit_prices": exit_prices,
                "exit_date": datetime.now(timezone.utc).isoformat(),
                "final_pnl_pct": pnl,
            }
        },
    )

    doc = await db.spreads.find_one({"_id": _to_id(spread_id)})
    return _spread_to_response(doc)


@router.post("/{spread_id}/notes")
async def add_note(
    spread_id: str,
    note: NoteCreate,
    user_id: str = Depends(get_current_user),
):
    """Add a note to a spread."""
    db = get_db()

    note_doc = {
        "text": note.text,
        "author": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        result = await db.spreads.update_one(
            {"_id": _to_id(spread_id)},
            {"$push": {"notes": note_doc}},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid spread ID")

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Spread not found")

    return {"status": "ok", "note": note_doc}


@router.get("/{spread_id}/analytics")
async def spread_analytics(
    spread_id: str,
    user_id: str = Depends(get_current_user),
):
    """
    Pair-level analytics for a spread: normalized prices, spread series,
    z-score, rolling correlation, betas, Sharpe.
    """
    db = get_db()

    try:
        doc = await db.spreads.find_one({"_id": _to_id(spread_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid spread ID")
    if not doc:
        raise HTTPException(status_code=404, detail="Spread not found")

    long_leg = doc.get("long_leg", {})
    short_leg = doc.get("short_leg", {})
    long_tickers = long_leg.get("tickers", [])
    short_tickers = short_leg.get("tickers", [])
    long_weights = long_leg.get("weights", [1.0 / max(len(long_tickers), 1)] * len(long_tickers))
    short_weights = short_leg.get("weights", [1.0 / max(len(short_tickers), 1)] * len(short_tickers))
    all_tickers = long_tickers + short_tickers

    if not all_tickers:
        raise HTTPException(status_code=400, detail="Spread has no tickers")

    # Fetch 1Y price history (includes SPY for beta)
    try:
        prices_df = get_prices(all_tickers + ["SPY"], period="1y")
    except Exception as e:
        logger.error(f"Price fetch failed for analytics: {e}")
        raise HTTPException(status_code=502, detail="Could not fetch price data")

    if prices_df.empty:
        return {"error": "No price data available", "partial": True}

    # --- Compute weighted composite legs ---
    returns = prices_df.pct_change().dropna()

    long_ret = pd.Series(0.0, index=returns.index)
    for t, w in zip(long_tickers, long_weights):
        if t in returns.columns:
            long_ret += returns[t] * w

    short_ret = pd.Series(0.0, index=returns.index)
    for t, w in zip(short_tickers, short_weights):
        if t in returns.columns:
            short_ret += returns[t] * w

    spread_ret = long_ret - short_ret

    # --- Normalized prices (rebased to 100) ---
    long_cumul = (1 + long_ret).cumprod() * 100
    short_cumul = (1 + short_ret).cumprod() * 100
    spread_cumul = long_cumul - short_cumul  # spread in normalized terms

    dates = [d.strftime("%Y-%m-%d") for d in long_cumul.index]

    # --- Z-score series (rolling 60-day) ---
    window = 60
    spread_cum_raw = spread_ret.cumsum()
    roll_mean = spread_cum_raw.rolling(window=window, min_periods=20).mean()
    roll_std = spread_cum_raw.rolling(window=window, min_periods=20).std()
    zscore_series = ((spread_cum_raw - roll_mean) / roll_std.replace(0, np.nan)).fillna(0)

    # --- Rolling correlation (60-day) ---
    rolling_corr = long_ret.rolling(window=window, min_periods=20).corr(short_ret).dropna()
    rc_dates = [d.strftime("%Y-%m-%d") for d in rolling_corr.index]

    # --- Overall correlation ---
    if len(long_ret) > 20:
        overall_corr = float(long_ret.corr(short_ret))
    else:
        overall_corr = None

    # --- Betas to SPY ---
    beta_long = None
    beta_short = None
    net_beta = None
    if "SPY" in returns.columns:
        spy_ret = returns["SPY"]
        common = long_ret.index.intersection(spy_ret.index)
        if len(common) > 20:
            lr = long_ret.loc[common].values
            sr_spy = spy_ret.loc[common].values
            cov_l = np.cov(lr, sr_spy)
            beta_long = round(float(cov_l[0, 1] / cov_l[1, 1]), 3) if cov_l[1, 1] > 0 else 0.0

            shr = short_ret.loc[common].values
            cov_s = np.cov(shr, sr_spy)
            beta_short = round(float(cov_s[0, 1] / cov_s[1, 1]), 3) if cov_s[1, 1] > 0 else 0.0

            net_beta = round(beta_long - beta_short, 3)

    # --- Spread stats ---
    stats = calculate_spread_stats(spread_ret)

    # --- Half life (Ornstein-Uhlenbeck approximation) ---
    half_life = None
    try:
        spread_cum = spread_ret.cumsum()
        lagged = spread_cum.shift(1).dropna()
        delta = spread_cum.diff().dropna()
        common_idx = lagged.index.intersection(delta.index)
        if len(common_idx) > 20:
            y = delta.loc[common_idx].values
            x = lagged.loc[common_idx].values
            slope = np.polyfit(x, y, 1)[0]
            if slope < 0:
                half_life = round(-np.log(2) / slope, 1)
    except Exception:
        pass

    # --- Max drawdown ---
    cum = (1 + spread_ret).cumprod()
    running_max = cum.cummax()
    drawdown = (cum - running_max) / running_max
    max_drawdown = round(float(drawdown.min()) * 100, 2) if len(drawdown) > 0 else None

    return {
        "correlation": round(overall_corr, 4) if overall_corr is not None else None,
        "beta_long": beta_long,
        "beta_short": beta_short,
        "net_beta": net_beta,
        "spread_sharpe": stats.get("sharpe"),
        "spread_ann_return": stats.get("ann_return"),
        "spread_ann_vol": stats.get("ann_vol"),
        "current_zscore": stats.get("current_zscore"),
        "half_life_days": half_life,
        "max_drawdown_pct": max_drawdown,
        "price_data": {
            "dates": dates,
            "long_normalized": [round(float(v), 2) for v in long_cumul.values],
            "short_normalized": [round(float(v), 2) for v in short_cumul.values],
            "spread": [round(float(v), 4) for v in spread_cum_raw.values],
            "zscore_series": [round(float(v), 2) for v in zscore_series.values],
        },
        "rolling_correlation": {
            "dates": rc_dates,
            "values": [round(float(v), 4) for v in rolling_corr.values],
        },
    }


def _calculate_pnl(spread: dict, current_prices: dict[str, float]) -> float | None:
    """
    Calculate P&L percentage for a spread.
    P&L = (sum of long returns * weights) - (sum of short returns * weights)
    """
    entry = spread.get("entry_prices", {})
    if not entry or not current_prices:
        return None

    long_leg = spread.get("long_leg", {})
    short_leg = spread.get("short_leg", {})

    long_pnl = 0.0
    for ticker, weight in zip(long_leg.get("tickers", []), long_leg.get("weights", [])):
        if ticker in entry and ticker in current_prices and entry[ticker] > 0:
            ret = (current_prices[ticker] - entry[ticker]) / entry[ticker]
            long_pnl += ret * weight

    short_pnl = 0.0
    for ticker, weight in zip(short_leg.get("tickers", []), short_leg.get("weights", [])):
        if ticker in entry and ticker in current_prices and entry[ticker] > 0:
            ret = (current_prices[ticker] - entry[ticker]) / entry[ticker]
            short_pnl += ret * weight

    # Long profits when prices go up, short profits when prices go down
    total_pnl = long_pnl - short_pnl
    return round(total_pnl * 100, 2)
