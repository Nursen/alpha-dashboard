"""
Pair analytics — spread stats, correlation, beta.
Reuses logic from optimize_allocation.py.
"""

import pandas as pd
import numpy as np
from services.market_data import get_prices
import logging

logger = logging.getLogger(__name__)

TRADING_DAYS = 252


def calculate_pair_returns(
    prices_df: pd.DataFrame,
    long_tickers: list[str],
    long_weights: list[float],
    short_tickers: list[str],
    short_weights: list[float],
) -> pd.Series:
    """
    Calculate the daily return series of a long/short spread.
    Returns = weighted_long_returns - weighted_short_returns
    """
    returns = prices_df.pct_change().dropna()

    # Long leg weighted return
    long_ret = pd.Series(0.0, index=returns.index)
    for ticker, weight in zip(long_tickers, long_weights):
        if ticker in returns.columns:
            long_ret += returns[ticker] * weight

    # Short leg weighted return
    short_ret = pd.Series(0.0, index=returns.index)
    for ticker, weight in zip(short_tickers, short_weights):
        if ticker in returns.columns:
            short_ret += returns[ticker] * weight

    return long_ret - short_ret


def calculate_spread_stats(
    pair_returns: pd.Series, risk_free: float = 0.043
) -> dict:
    """
    Calculate annualized stats for a pair return series.
    Returns dict with: ann_return, ann_vol, sharpe, current_zscore,
    correlation, beta_to_spy
    """
    clean = pair_returns.dropna()
    if len(clean) < 20:
        return {
            "ann_return": None,
            "ann_vol": None,
            "sharpe": None,
            "current_zscore": None,
            "error": "Insufficient data",
        }

    ann_return = float(clean.mean() * TRADING_DAYS)
    ann_vol = float(clean.std() * np.sqrt(TRADING_DAYS))
    sharpe = float((ann_return - risk_free) / ann_vol) if ann_vol > 0 else 0.0

    # Z-score: how far is the cumulative spread from its mean?
    cumulative = clean.cumsum()
    zscore = float((cumulative.iloc[-1] - cumulative.mean()) / cumulative.std()) if cumulative.std() > 0 else 0.0

    return {
        "ann_return": round(ann_return, 4),
        "ann_vol": round(ann_vol, 4),
        "sharpe": round(sharpe, 2),
        "current_zscore": round(zscore, 2),
    }


def calculate_beta_to_spy(pair_returns: pd.Series) -> float | None:
    """Calculate beta of the spread to SPY (market proxy)."""
    try:
        spy_prices = get_prices(["SPY"], period="1y")
        if spy_prices.empty:
            return None
        spy_ret = spy_prices["SPY"].pct_change().dropna()

        # Align dates
        common = pair_returns.index.intersection(spy_ret.index)
        if len(common) < 20:
            return None

        pr = pair_returns.loc[common]
        sr = spy_ret.loc[common]

        cov = np.cov(pr, sr)
        beta = float(cov[0, 1] / cov[1, 1]) if cov[1, 1] > 0 else 0.0
        return round(beta, 3)
    except Exception as e:
        logger.error(f"Beta calc failed: {e}")
        return None


def calculate_correlation_matrix(
    tickers: list[str], period: str = "1y"
) -> pd.DataFrame:
    """Return correlation matrix of daily returns for given tickers."""
    prices = get_prices(tickers, period=period)
    if prices.empty:
        return pd.DataFrame()
    returns = prices.pct_change().dropna()
    return returns.corr()
