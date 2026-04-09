"""
Stock screener — filters a predefined universe of ~100 liquid stocks
by sector, market cap, P/E, and volume.

Caches all ticker info in memory (1h TTL) so filtering is instant.
"""

import yfinance as yf
from cachetools import TTLCache
import logging

logger = logging.getLogger(__name__)

# 1-hour cache for screener data (one entry = whole universe snapshot)
_screener_cache: TTLCache = TTLCache(maxsize=1, ttl=3600)

# Universe: ~100 liquid US large-caps
SCREENER_UNIVERSE = [
    # Tech
    "AAPL", "MSFT", "GOOG", "META", "NVDA", "AMD", "CRM", "ADBE", "INTC", "ORCL",
    "AVGO", "CSCO", "TXN", "QCOM",
    # Healthcare
    "JNJ", "UNH", "PFE", "ABBV", "MRK", "LLY", "TMO", "ABT", "BMY", "AMGN",
    # Financials
    "JPM", "BAC", "GS", "MS", "WFC", "BRK-B", "C", "AXP", "BLK", "SCHW",
    # Consumer Disc
    "AMZN", "TSLA", "HD", "NKE", "MCD", "SBUX", "TGT", "LOW", "BKNG", "CMG",
    # Consumer Staples
    "PG", "KO", "PEP", "WMT", "COST", "CL", "PM", "MO", "KHC", "GIS",
    # Energy
    "XOM", "CVX", "COP", "SLB", "EOG", "PSX", "MPC", "VLO",
    # Industrials
    "CAT", "HON", "UPS", "GE", "RTX", "DE", "LMT", "UNP", "BA", "MMM",
    # Materials
    "LIN", "APD", "ECL", "NEM", "FCX", "DOW", "DD",
    # Communication
    "DIS", "NFLX", "CMCSA", "T", "VZ",
    # Utilities
    "NEE", "DUK", "SO", "D",
    # Real Estate
    "PLD", "AMT", "SPG", "O",
]


def _load_universe() -> list[dict]:
    """
    Fetch info for every ticker in the universe.
    Returns a list of dicts, one per ticker. Cached for 1 hour.
    """
    cache_key = "universe"
    if cache_key in _screener_cache:
        return _screener_cache[cache_key]

    logger.info(f"Loading screener universe ({len(SCREENER_UNIVERSE)} tickers)...")
    results = []

    for ticker in SCREENER_UNIVERSE:
        try:
            info = yf.Ticker(ticker).info
            if not info or not info.get("shortName"):
                continue

            results.append({
                "ticker": ticker,
                "name": info.get("shortName", ticker),
                "sector": info.get("sector"),
                "market_cap": info.get("marketCap"),
                "pe_ratio": info.get("trailingPE"),
                "volume": info.get("averageVolume"),
                "price": info.get("currentPrice") or info.get("regularMarketPrice"),
                "52w_high": info.get("fiftyTwoWeekHigh"),
                "52w_low": info.get("fiftyTwoWeekLow"),
            })
        except Exception as e:
            logger.debug(f"Screener: skipping {ticker}: {e}")
            continue

    _screener_cache[cache_key] = results
    logger.info(f"Screener universe loaded: {len(results)} tickers")
    return results


def screen_stocks(
    sector: str | None = None,
    min_market_cap: float | None = None,
    max_pe: float | None = None,
    min_volume: float | None = None,
) -> list[dict]:
    """
    Filter the cached universe by the given criteria.
    min_market_cap is in billions (e.g., 10 = $10B+).
    """
    universe = _load_universe()
    results = []

    for stock in universe:
        # Sector filter (case-insensitive partial match)
        if sector:
            stock_sector = stock.get("sector") or ""
            if sector.lower() not in stock_sector.lower():
                continue

        # Market cap filter (input in billions, data in raw dollars)
        if min_market_cap is not None:
            mc = stock.get("market_cap")
            if mc is None or mc < min_market_cap * 1e9:
                continue

        # P/E filter
        if max_pe is not None:
            pe = stock.get("pe_ratio")
            if pe is None or pe > max_pe or pe <= 0:
                continue

        # Volume filter
        if min_volume is not None:
            vol = stock.get("volume")
            if vol is None or vol < min_volume:
                continue

        results.append(stock)

    return results
