"""
Market data service — wraps yfinance with TTL caching.
Reuses download pattern from optimize_allocation.py to handle
the multi-index column issue in newer yfinance versions.
"""

import yfinance as yf
import pandas as pd
from cachetools import TTLCache
import logging

logger = logging.getLogger(__name__)

# 15-minute cache for price data, 1-hour for ticker info
_price_cache: TTLCache = TTLCache(maxsize=200, ttl=900)
_info_cache: TTLCache = TTLCache(maxsize=100, ttl=3600)


def _download_single_ticker(ticker: str, period: str = "1y") -> pd.Series | None:
    """Download close prices for one ticker, handling multi-index columns."""
    try:
        df = yf.download(ticker, period=period, auto_adjust=True, progress=False)
        if len(df) == 0:
            logger.warning(f"No data for {ticker}")
            return None
        close = df["Close"]
        # Handle multi-index columns from newer yfinance
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]
        return close
    except Exception as e:
        logger.error(f"Failed to download {ticker}: {e}")
        return None


def get_prices(tickers: list[str], period: str = "1y") -> pd.DataFrame:
    """
    Get historical close prices for a list of tickers.
    Returns DataFrame with tickers as columns, dates as index.
    Uses per-ticker caching.
    """
    prices = {}
    for ticker in tickers:
        cache_key = f"{ticker}_{period}"
        if cache_key in _price_cache:
            prices[ticker] = _price_cache[cache_key]
        else:
            series = _download_single_ticker(ticker, period)
            if series is not None:
                _price_cache[cache_key] = series
                prices[ticker] = series

    if not prices:
        return pd.DataFrame()

    return pd.DataFrame(prices).dropna(how="all")


def get_current_prices(tickers: list[str]) -> dict[str, float]:
    """
    Get the most recent close price for each ticker.
    Falls back to cached data if live fetch fails.
    """
    result = {}
    for ticker in tickers:
        # Try to get from short-period download (faster)
        cache_key = f"{ticker}_current"
        if cache_key in _price_cache:
            result[ticker] = _price_cache[cache_key]
            continue

        try:
            df = yf.download(ticker, period="5d", auto_adjust=True, progress=False)
            if len(df) > 0:
                close = df["Close"]
                if isinstance(close, pd.DataFrame):
                    close = close.iloc[:, 0]
                price = float(close.iloc[-1])
                _price_cache[cache_key] = price
                result[ticker] = price
            else:
                # Fall back to longer-period cache
                fallback_key = f"{ticker}_1y"
                if fallback_key in _price_cache:
                    result[ticker] = float(_price_cache[fallback_key].iloc[-1])
                    logger.warning(f"Using cached price for {ticker}")
        except Exception as e:
            logger.error(f"Failed to get current price for {ticker}: {e}")
            # Try any cached version
            fallback_key = f"{ticker}_1y"
            if fallback_key in _price_cache:
                result[ticker] = float(_price_cache[fallback_key].iloc[-1])

    return result


def get_ticker_info(ticker: str) -> dict:
    """Get ticker metadata (name, sector, etc). Cached 1 hour."""
    if ticker in _info_cache:
        return _info_cache[ticker]

    try:
        info = yf.Ticker(ticker).info
        # Keep only useful fields
        kept = {
            k: info.get(k)
            for k in [
                "shortName",
                "longName",
                "sector",
                "industry",
                "country",
                "marketCap",
                "averageVolume",
                "currency",
            ]
            if info.get(k) is not None
        }
        _info_cache[ticker] = kept
        return kept
    except Exception as e:
        logger.error(f"Failed to get info for {ticker}: {e}")
        return {"shortName": ticker, "error": str(e)}
