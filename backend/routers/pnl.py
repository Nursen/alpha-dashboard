from __future__ import annotations

"""
PnL router — upload StockTrak CSVs, compute P&L, return breakdowns.
"""

import json
import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Form

from auth import get_current_user
from db import get_db
from services.stocktrak_parser import parse_open_positions, parse_portfolio_summary, parse_trade_notes, extract_spreads
from services.pnl_calculator import (
    compute_pnl_from_snapshot,
    compute_period_pnl,
    build_nav_series,
    INITIAL_PORTFOLIO_VALUE,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pnl", tags=["pnl"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_all_snapshots() -> list[dict]:
    """Fetch all snapshots from DB, sorted by upload_date."""
    db = get_db()
    if not hasattr(db, "pnl_snapshots"):
        return []
    cursor = db.pnl_snapshots.find({})
    snapshots = []
    async for doc in cursor:
        doc["id"] = str(doc.pop("_id", ""))
        snapshots.append(doc)
    snapshots.sort(key=lambda s: s.get("upload_date", ""))
    return snapshots


async def _get_latest_snapshot() -> dict | None:
    """Get the most recent snapshot."""
    snapshots = await _get_all_snapshots()
    return snapshots[-1] if snapshots else None


# ---------------------------------------------------------------------------
# POST /api/pnl/upload — upload StockTrak CSV(s)
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_csv(
    positions_file: UploadFile = File(...),
    summary_file: UploadFile | None = File(None),
    snapshot_date: str | None = Form(None),
    user_id: str = Depends(get_current_user),
):
    """
    Upload StockTrak CSV files, parse them, and store as a dated snapshot.

    - positions_file: OpenPosition CSV (required)
    - summary_file: PortfolioSummary CSV (optional)
    - snapshot_date: Override date (YYYY-MM-DD). Defaults to today.
    """
    # Parse positions
    try:
        positions_text = (await positions_file.read()).decode("utf-8-sig")
        positions = parse_open_positions(positions_text)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse positions CSV: {e}")

    if not positions:
        raise HTTPException(status_code=400, detail="No positions found in CSV")

    # Parse summary (optional)
    summary = {}
    if summary_file:
        try:
            summary_text = (await summary_file.read()).decode("utf-8-sig")
            summary = parse_portfolio_summary(summary_text)
        except Exception as e:
            logger.warning(f"Failed to parse summary CSV: {e}")

    # Determine snapshot date
    upload_date = snapshot_date or date.today().isoformat()

    # Calculate portfolio value from positions if no summary
    total_market_value = sum(p.get("market_value", 0) for p in positions)
    portfolio_value = summary.get("portfolio_value") or total_market_value
    cash_balance = summary.get("cash_balance", 0)

    # Build snapshot document
    snapshot = {
        "upload_date": upload_date,
        "portfolio_value": portfolio_value,
        "cash_balance": cash_balance,
        "num_positions": len(positions),
        "positions": positions,
        "summary": summary,
        "uploaded_by": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # Store in DB
    db = get_db()
    # Ensure the collection exists
    if not hasattr(db, "pnl_snapshots"):
        from db import JsonCollection
        from pathlib import Path
        db.pnl_snapshots = JsonCollection(Path(db.data_dir) / "pnl_snapshots.json")

    result = await db.pnl_snapshots.insert_one(snapshot)

    # Compute P&L for immediate response
    pnl = compute_pnl_from_snapshot(snapshot)

    return {
        "status": "ok",
        "snapshot_id": str(result.inserted_id),
        "upload_date": upload_date,
        "num_positions": len(positions),
        "portfolio_value": portfolio_value,
        **pnl,
    }


# ---------------------------------------------------------------------------
# GET /api/pnl/latest — latest snapshot with P&L
# ---------------------------------------------------------------------------

@router.get("/latest")
async def get_latest_pnl(user_id: str = Depends(get_current_user)):
    """Get latest snapshot with full P&L breakdown."""
    snapshot = await _get_latest_snapshot()
    if not snapshot:
        return {
            "has_data": False,
            "message": "No snapshots uploaded yet. Upload a StockTrak CSV to get started.",
        }

    pnl = compute_pnl_from_snapshot(snapshot)

    # Period P&L from all snapshots
    all_snapshots = await _get_all_snapshots()
    periods = compute_period_pnl(all_snapshots)

    return {
        "has_data": True,
        "upload_date": snapshot.get("upload_date"),
        "num_positions": snapshot.get("num_positions", 0),
        "positions": snapshot.get("positions", []),
        **pnl,
        "periods": periods,
    }


# ---------------------------------------------------------------------------
# GET /api/pnl/history — NAV time series
# ---------------------------------------------------------------------------

@router.get("/history")
async def get_pnl_history(user_id: str = Depends(get_current_user)):
    """NAV time series from all uploaded snapshots."""
    snapshots = await _get_all_snapshots()
    nav = build_nav_series(snapshots)

    return {
        "num_snapshots": len(snapshots),
        "nav_series": nav,
        "initial_value": INITIAL_PORTFOLIO_VALUE,
    }


# ---------------------------------------------------------------------------
# GET /api/pnl/by-theme — P&L grouped by theme
# ---------------------------------------------------------------------------

@router.get("/by-theme")
async def get_pnl_by_theme(user_id: str = Depends(get_current_user)):
    """P&L breakdown by investment theme from latest snapshot."""
    snapshot = await _get_latest_snapshot()
    if not snapshot:
        return {"themes": []}

    pnl = compute_pnl_from_snapshot(snapshot)
    return {"themes": pnl.get("pnl_by_theme", [])}


# ---------------------------------------------------------------------------
# GET /api/pnl/by-asset-class — P&L grouped by asset class
# ---------------------------------------------------------------------------

@router.get("/by-asset-class")
async def get_pnl_by_asset_class(user_id: str = Depends(get_current_user)):
    """P&L breakdown by asset class from latest snapshot."""
    snapshot = await _get_latest_snapshot()
    if not snapshot:
        return {"asset_classes": []}

    pnl = compute_pnl_from_snapshot(snapshot)
    return {"asset_classes": pnl.get("pnl_by_asset_class", [])}


# ---------------------------------------------------------------------------
# POST /api/pnl/upload-notes — upload TradeNotes CSV
# ---------------------------------------------------------------------------

@router.post("/upload-notes")
async def upload_trade_notes(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    """
    Upload StockTrak TradeNotes CSV, parse trades, extract pairs.
    Replaces any previously uploaded trade notes.
    """
    try:
        text = (await file.read()).decode("utf-8-sig")
        trades = parse_trade_notes(text)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse TradeNotes CSV: {e}")

    if not trades:
        raise HTTPException(status_code=400, detail="No trades found in CSV")

    spreads = extract_spreads(trades)

    # Count IC rejections and corrections
    ic_rejections = sum(1 for t in trades if t.get("ic_rejected"))
    corrections = sum(1 for t in trades if t.get("is_correction"))

    # Store in DB — replace previous upload
    db = get_db()
    if not hasattr(db, "trade_notes"):
        from db import JsonCollection
        from pathlib import Path
        db.trade_notes = JsonCollection(Path(db.data_dir) / "trade_notes.json")

    doc = {
        "trades": trades,
        "spreads": spreads,
        "num_trades": len(trades),
        "num_spreads": len(spreads),
        "ic_rejections": ic_rejections,
        "corrections": corrections,
        "uploaded_by": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # Wipe old data and store fresh
    db.trade_notes._data = []
    result = await db.trade_notes.insert_one(doc)

    return {
        "status": "ok",
        "id": str(result.inserted_id),
        "num_trades": len(trades),
        "num_spreads": len(spreads),
        "ic_rejections": ic_rejections,
        "corrections": corrections,
    }


# ---------------------------------------------------------------------------
# GET /api/pnl/trades — all parsed trades with notes
# ---------------------------------------------------------------------------

@router.get("/trades")
async def get_trades(user_id: str = Depends(get_current_user)):
    """Get all parsed trades sorted by date."""
    db = get_db()
    if not hasattr(db, "trade_notes"):
        return {"trades": [], "has_data": False}

    cursor = db.trade_notes.find({})
    docs = []
    async for doc in cursor:
        docs.append(doc)

    if not docs:
        return {"trades": [], "has_data": False}

    # Use latest upload
    latest = docs[-1]
    trades = latest.get("trades", [])
    # Already sorted by date from parsing order, but ensure it
    trades.sort(key=lambda t: t.get("trade_date", ""))

    return {
        "has_data": True,
        "trades": trades,
        "num_trades": latest.get("num_trades", 0),
        "ic_rejections": latest.get("ic_rejections", 0),
        "corrections": latest.get("corrections", 0),
    }


# ---------------------------------------------------------------------------
# GET /api/pnl/spreads-extracted — extracted spread/pair relationships
# ---------------------------------------------------------------------------

@router.get("/spreads-extracted")
async def get_extracted_spreads(user_id: str = Depends(get_current_user)):
    """Get extracted spread/pair relationships from trade notes."""
    db = get_db()
    if not hasattr(db, "trade_notes"):
        return {"spreads": [], "has_data": False}

    cursor = db.trade_notes.find({})
    docs = []
    async for doc in cursor:
        docs.append(doc)

    if not docs:
        return {"spreads": [], "has_data": False}

    latest = docs[-1]
    return {
        "has_data": True,
        "spreads": latest.get("spreads", []),
        "num_spreads": latest.get("num_spreads", 0),
    }
