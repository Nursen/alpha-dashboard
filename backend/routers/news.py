"""
News endpoints — fetch news for portfolio tickers.
"""
from fastapi import APIRouter, Depends, Query

from auth import get_current_user
from db import get_db
from services.news import get_news_for_tickers, get_news_for_ticker

router = APIRouter(prefix="/api/news", tags=["news"])


@router.get("")
async def get_portfolio_news(
    user_id: str = Depends(get_current_user),
):
    """Get news for all tickers in active spreads."""
    db = get_db()
    cursor = db.spreads.find({})
    tickers = set()
    async for doc in cursor:
        if doc.get("status") != "closed":
            for t in doc.get("long_leg", {}).get("tickers", []):
                tickers.add(t)
            for t in doc.get("short_leg", {}).get("tickers", []):
                tickers.add(t)

    if not tickers:
        return []

    return get_news_for_tickers(list(tickers), max_per_ticker=3)


@router.get("/ticker/{ticker}")
async def get_ticker_news(
    ticker: str,
    max_items: int = Query(default=10, le=20),
    user_id: str = Depends(get_current_user),
):
    """Get news for a specific ticker."""
    return get_news_for_ticker(ticker.upper(), max_items=max_items)


@router.get("/spread/{spread_id}")
async def get_spread_news(
    spread_id: str,
    user_id: str = Depends(get_current_user),
):
    """Get news for all tickers in a specific spread."""
    db = get_db()

    try:
        from bson import ObjectId
        doc = await db.spreads.find_one({"_id": ObjectId(spread_id)})
    except Exception:
        doc = await db.spreads.find_one({"_id": spread_id})

    if not doc:
        return []

    tickers = []
    tickers.extend(doc.get("long_leg", {}).get("tickers", []))
    tickers.extend(doc.get("short_leg", {}).get("tickers", []))

    return get_news_for_tickers(tickers, max_per_ticker=5)
