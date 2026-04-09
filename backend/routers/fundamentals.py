from fastapi import APIRouter, Depends, Query

from auth import get_current_user
from models.fundamentals import FundamentalScore, PairComparison
from services.fundamentals import get_financials, score_ticker, compare_pair

router = APIRouter(prefix="/api/fundamentals", tags=["fundamentals"])


@router.get("/compare")
async def compare_tickers(
    long: str = Query(..., description="Long leg ticker"),
    short: str = Query(..., description="Short leg ticker"),
    user_id: str = Depends(get_current_user),
) -> PairComparison:
    """Side-by-side fundamental comparison with directional validation."""
    return compare_pair(long.strip().upper(), short.strip().upper())


@router.get("/score")
async def batch_score(
    tickers: str = Query(..., description="Comma-separated tickers"),
    user_id: str = Depends(get_current_user),
) -> list[FundamentalScore]:
    """Score multiple tickers at once."""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return []
    return [score_ticker(t) for t in ticker_list]


@router.get("/{ticker}")
async def get_ticker_fundamentals(
    ticker: str,
    user_id: str = Depends(get_current_user),
) -> dict:
    """Full financial statements + fundamental score for one ticker."""
    t = ticker.strip().upper()
    financials = get_financials(t)
    score = score_ticker(t)
    return {
        "financials": financials,
        "score": score,
    }
