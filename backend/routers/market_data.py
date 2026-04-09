from fastapi import APIRouter, Depends, Query

from auth import get_current_user
from services.market_data import get_prices, get_current_prices, get_ticker_info
from services.analytics import calculate_correlation_matrix

router = APIRouter(prefix="/api/market", tags=["market_data"])


@router.get("/prices")
async def price_history(
    tickers: str = Query(..., description="Comma-separated tickers"),
    period: str = Query("1y", description="yfinance period string"),
    user_id: str = Depends(get_current_user),
):
    """Cached historical close prices."""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return {"error": "No tickers provided"}

    df = get_prices(ticker_list, period=period)
    if df.empty:
        return {"tickers": ticker_list, "data": [], "error": "No data available"}

    # Convert to JSON-friendly format: list of {date, ticker1, ticker2, ...}
    df.index = df.index.strftime("%Y-%m-%d")
    records = df.reset_index().rename(columns={"index": "date"}).to_dict(orient="records")

    return {"tickers": list(df.columns), "count": len(records), "data": records}


@router.get("/quote")
async def current_quotes(
    tickers: str = Query(..., description="Comma-separated tickers"),
    user_id: str = Depends(get_current_user),
):
    """Current prices for given tickers."""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return {"error": "No tickers provided"}

    prices = get_current_prices(ticker_list)
    return {"prices": prices}


@router.get("/correlation")
async def correlation_matrix(
    tickers: str = Query(..., description="Comma-separated tickers"),
    period: str = Query("1y"),
    user_id: str = Depends(get_current_user),
):
    """Correlation matrix of daily returns."""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if len(ticker_list) < 2:
        return {"error": "Need at least 2 tickers"}

    corr = calculate_correlation_matrix(ticker_list, period=period)
    if corr.empty:
        return {"error": "Could not calculate correlations"}

    # Return as nested dict for easy frontend consumption
    return {
        "tickers": list(corr.columns),
        "matrix": corr.round(4).to_dict(),
    }


@router.get("/info/{ticker}")
async def ticker_info(
    ticker: str,
    user_id: str = Depends(get_current_user),
):
    """Ticker metadata (name, sector, volume)."""
    return get_ticker_info(ticker.upper())
