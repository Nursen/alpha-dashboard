"""
Risk calculator for StockTrak position-level risk analysis.

Computes exposure metrics, VaR, drawdown, correlation, scenarios, and position flags
from actual StockTrak positions (not spread-level data).

Design decisions:
- Hardcoded fallback positions from StockTrak 4/20/2026 snapshot
- yfinance data cached via the existing market_data service
- Graceful degradation for ADRs/tickers yfinance can't find
- All heavy computation in one pass, cached at the router level
"""

import logging
import numpy as np
import pandas as pd
from dataclasses import dataclass
from services.market_data import get_prices, _price_cache

logger = logging.getLogger(__name__)

TRADING_DAYS = 252
PORTFOLIO_VALUE = 1_000_000  # StockTrak starting capital


# ---------------------------------------------------------------------------
# Hardcoded positions fallback (StockTrak 4/20/2026)
# Format: (ticker, shares, entry_price, current_price, side)
# shares is always positive; side indicates long/short
# ---------------------------------------------------------------------------

FALLBACK_POSITIONS = [
    ("AIQUY", 1050, 43.86, 43.76, "long"),
    ("AMGN", 86.15, 350.16, 349.61, "long"),
    ("APD", 100, 296.15, 296.73, "long"),
    ("BASFY", 3000, 15.59, 15.59, "short"),
    ("BBWI", 4459.31, 20.9, 17.99, "short"),
    ("BILL", 1074.11, 39.63, 38.1, "long"),
    ("BX", 570, 128.99, 132.18, "long"),
    ("DELL", 327.31, 204.24, 162.52, "long"),
    ("EADSF", 370, 207, 189.45, "short"),
    ("ELF", 715.72, 68.42, 70.47, "long"),
    ("EUAD", 1668.33, 44.02, 40.76, "long"),
    ("EVKIY", 2300, 10.005, 9.964, "short"),
    ("FDX", 219.49, 393.76, 362.65, "long"),
    ("G", 1068.09, 36.64, 37.01, "short"),
    ("HPE", 2000, 27.81, 23.95, "long"),
    ("HPQ", 5200, 19.59, 18.89, "short"),
    ("INDA", 600.24, 50.53, 49.77, "long"),
    ("INMD", 2105.26, 14.57, 14.4, "long"),
    ("LIN", 61, 498.15, 499.19, "long"),
    ("LLY", 33.15, 919.9, 910.6, "long"),
    ("MCHI", 357, 59.3, 55.88, "short"),
    ("OBDC", 650, 11.78, 11.68, "short"),
    ("ROBO", 654.28, 79.56, 77.15, "long"),
    ("SLVYY", 7000, 3.22, 3.22, "short"),
    ("TIP", 950, 111.41, 110.64, "long"),
    ("TLT", 1150, 87.05, 86.68, "short"),
    ("TSLA", 220, 392.5, 366.7, "short"),
    ("UPS", 809.33, 107.11, 97.31, "short"),
    ("VNM", 3751.34, 19.07, 18.75, "long"),
    ("VWO", 1721.47, 58.91, 58.21, "short"),
    ("WW", 5545.29, 10, 10.9, "short"),
    ("XLI", 292.09, 173.9, 171.12, "short"),
    ("XOM", 105, 147.68, 147.98, "long"),
    ("XPEV", 5650, 17.8, 17.57, "long"),
]

# Theme assignments for correlation analysis
# Grouped by investment thesis / sector
TICKER_THEMES = {
    "AIQUY": "AI / Robotics",
    "ROBO": "AI / Robotics",
    "XPEV": "EV / China Tech",
    "MCHI": "EV / China Tech",
    "VNM": "EM Asia",
    "INDA": "EM Asia",
    "VWO": "EM Asia",
    "AMGN": "Healthcare",
    "LLY": "Healthcare",
    "INMD": "Healthcare",
    "ELF": "Consumer",
    "BBWI": "Consumer",
    "WW": "Consumer",
    "DELL": "Tech Hardware",
    "HPE": "Tech Hardware",
    "HPQ": "Tech Hardware",
    "BILL": "Fintech / Services",
    "BX": "Fintech / Services",
    "OBDC": "Fintech / Services",
    "G": "Fintech / Services",
    "APD": "Industrials / Materials",
    "LIN": "Industrials / Materials",
    "BASFY": "Industrials / Materials",
    "EVKIY": "Industrials / Materials",
    "SLVYY": "Industrials / Materials",
    "EADSF": "Industrials / Materials",
    "XLI": "Industrials / Materials",
    "FDX": "Transport / Logistics",
    "UPS": "Transport / Logistics",
    "TSLA": "EV / Auto",
    "XOM": "Energy",
    "EUAD": "EM / Frontier",
    "TIP": "Fixed Income",
    "TLT": "Fixed Income",
}


@dataclass
class Position:
    ticker: str
    shares: float
    entry_price: float
    current_price: float
    side: str  # "long" or "short"

    @property
    def market_value(self) -> float:
        return self.shares * self.current_price

    @property
    def cost_basis(self) -> float:
        return self.shares * self.entry_price

    @property
    def pnl_pct(self) -> float:
        if self.entry_price == 0:
            return 0.0
        raw = (self.current_price - self.entry_price) / self.entry_price * 100
        # Short positions profit when price drops
        return -raw if self.side == "short" else raw

    @property
    def pnl_dollar(self) -> float:
        raw = (self.current_price - self.entry_price) * self.shares
        return -raw if self.side == "short" else raw

    @property
    def theme(self) -> str:
        return TICKER_THEMES.get(self.ticker, "Other")


def get_positions() -> list[Position]:
    """Get positions from fallback data. Extend later to read from DB/upload."""
    return [
        Position(ticker=t, shares=s, entry_price=ep, current_price=cp, side=side)
        for t, s, ep, cp, side in FALLBACK_POSITIONS
    ]


# ---------------------------------------------------------------------------
# Exposure Metrics
# ---------------------------------------------------------------------------

def compute_exposures(positions: list[Position]) -> dict:
    long_mv = sum(p.market_value for p in positions if p.side == "long")
    short_mv = sum(p.market_value for p in positions if p.side == "short")
    gross = long_mv + short_mv
    net = long_mv - short_mv

    return {
        "gross_exposure": round(gross, 2),
        "net_exposure": round(net, 2),
        "long_exposure": round(long_mv, 2),
        "short_exposure": round(short_mv, 2),
        "gross_exposure_pct": round(gross / PORTFOLIO_VALUE * 100, 2),
        "net_exposure_pct": round(net / PORTFOLIO_VALUE * 100, 2),
        "long_short_ratio": round(long_mv / short_mv, 2) if short_mv > 0 else None,
    }


def compute_beta_adjusted_exposure(positions: list[Position], betas: dict[str, float]) -> dict:
    """Beta-adjusted net exposure: sum(beta_i * signed_mv_i) / portfolio_value."""
    beta_adj_mv = 0.0
    missing = []
    for p in positions:
        b = betas.get(p.ticker)
        if b is None:
            missing.append(p.ticker)
            continue
        sign = 1.0 if p.side == "long" else -1.0
        beta_adj_mv += b * sign * p.market_value

    return {
        "beta_adjusted_net_exposure": round(beta_adj_mv, 2),
        "beta_adjusted_net_pct": round(beta_adj_mv / PORTFOLIO_VALUE * 100, 2),
        "missing_beta_tickers": missing,
    }


def fetch_betas(tickers: list[str]) -> dict[str, float]:
    """Get beta for each ticker from yfinance .info. Uses existing cache."""
    import yfinance as yf
    betas = {}
    for ticker in tickers:
        cache_key = f"beta_{ticker}"
        if cache_key in _price_cache:
            betas[ticker] = _price_cache[cache_key]
            continue
        try:
            info = yf.Ticker(ticker).info
            b = info.get("beta")
            if b is not None:
                betas[ticker] = float(b)
                _price_cache[cache_key] = float(b)
        except Exception as e:
            logger.warning(f"Beta fetch failed for {ticker}: {e}")
    return betas


# ---------------------------------------------------------------------------
# VaR (Value at Risk)
# ---------------------------------------------------------------------------

def compute_var(positions: list[Position], returns_df: pd.DataFrame) -> dict:
    """
    Compute parametric and historical VaR at 95% and 99% confidence.
    returns_df: DataFrame of daily returns, columns = tickers.
    """
    # Build portfolio weight vector (signed)
    total_mv = sum(p.market_value for p in positions)
    if total_mv == 0:
        return {"error": "No market value"}

    available = [p for p in positions if p.ticker in returns_df.columns]
    if not available:
        return {"error": "No return data for any position"}

    # Weight vector aligned to available tickers
    tickers = [p.ticker for p in available]
    weights = []
    for p in available:
        sign = 1.0 if p.side == "long" else -1.0
        w = sign * p.market_value / total_mv
        weights.append(w)

    weights = np.array(weights)
    ret_matrix = returns_df[tickers].dropna()

    if len(ret_matrix) < 30:
        return {"error": "Insufficient return data for VaR"}

    # Portfolio daily returns
    port_returns = ret_matrix.values @ weights

    # --- Parametric VaR (assume normal) ---
    mu = np.mean(port_returns)
    sigma = np.std(port_returns)

    from scipy.stats import norm
    z_95 = norm.ppf(0.05)
    z_99 = norm.ppf(0.01)

    parametric_var_95_pct = round(float(mu + z_95 * sigma) * 100, 4)
    parametric_var_99_pct = round(float(mu + z_99 * sigma) * 100, 4)

    # --- Historical VaR ---
    historical_var_95_pct = round(float(np.percentile(port_returns, 5)) * 100, 4)
    historical_var_99_pct = round(float(np.percentile(port_returns, 1)) * 100, 4)

    return {
        "parametric": {
            "var_95_pct": parametric_var_95_pct,
            "var_99_pct": parametric_var_99_pct,
            "var_95_dollar": round(parametric_var_95_pct / 100 * total_mv, 2),
            "var_99_dollar": round(parametric_var_99_pct / 100 * total_mv, 2),
        },
        "historical": {
            "var_95_pct": historical_var_95_pct,
            "var_99_pct": historical_var_99_pct,
            "var_95_dollar": round(historical_var_95_pct / 100 * total_mv, 2),
            "var_99_dollar": round(historical_var_99_pct / 100 * total_mv, 2),
        },
        "portfolio_daily_vol_pct": round(float(sigma) * 100, 4),
        "num_observations": len(ret_matrix),
    }


# ---------------------------------------------------------------------------
# Drawdown
# ---------------------------------------------------------------------------

def compute_drawdown(positions: list[Position], returns_df: pd.DataFrame) -> dict:
    """Simulate portfolio NAV and compute drawdown metrics."""
    total_mv = sum(p.market_value for p in positions)
    if total_mv == 0:
        return {"error": "No market value"}

    available = [p for p in positions if p.ticker in returns_df.columns]
    if not available:
        return {"error": "No data"}

    tickers = [p.ticker for p in available]
    weights = []
    for p in available:
        sign = 1.0 if p.side == "long" else -1.0
        w = sign * p.market_value / total_mv
        weights.append(w)
    weights = np.array(weights)

    ret_matrix = returns_df[tickers].dropna()
    if len(ret_matrix) < 20:
        return {"error": "Insufficient data"}

    port_returns = ret_matrix.values @ weights
    cum_returns = (1 + pd.Series(port_returns, index=ret_matrix.index)).cumprod()
    running_max = cum_returns.cummax()
    drawdown = (cum_returns - running_max) / running_max

    max_dd = float(drawdown.min())
    max_dd_date = str(drawdown.idxmin().date()) if not drawdown.empty else None

    # Current drawdown from peak
    current_dd = float(drawdown.iloc[-1]) if len(drawdown) > 0 else 0.0

    # Recovery period (days from max DD to recovery, or ongoing)
    max_dd_idx = drawdown.idxmin()
    post_dd = drawdown.loc[max_dd_idx:]
    recovered = post_dd[post_dd >= 0]
    if len(recovered) > 0:
        recovery_days = (recovered.index[0] - max_dd_idx).days
    else:
        recovery_days = None  # still in drawdown

    return {
        "max_drawdown_pct": round(max_dd * 100, 2),
        "max_drawdown_date": max_dd_date,
        "current_drawdown_pct": round(current_dd * 100, 2),
        "recovery_days": recovery_days,
        "nav_dates": [str(d.date()) for d in cum_returns.index],
        "nav_values": [round(float(v), 4) for v in cum_returns.values],
    }


# ---------------------------------------------------------------------------
# Theme Correlation
# ---------------------------------------------------------------------------

def compute_theme_correlation(positions: list[Position], returns_df: pd.DataFrame) -> dict:
    """Compute correlation matrix between themes (groups of positions)."""
    # Group positions by theme
    theme_tickers: dict[str, list[tuple[str, float, str]]] = {}
    for p in positions:
        theme = p.theme
        if theme not in theme_tickers:
            theme_tickers[theme] = []
        theme_tickers[theme].append((p.ticker, p.market_value, p.side))

    # Build theme return series (value-weighted within each theme)
    theme_returns = {}
    for theme, entries in theme_tickers.items():
        available = [(t, mv, s) for t, mv, s in entries if t in returns_df.columns]
        if not available:
            continue
        total_mv = sum(mv for _, mv, _ in available)
        if total_mv == 0:
            continue

        theme_ret = pd.Series(0.0, index=returns_df.index)
        for ticker, mv, side in available:
            sign = 1.0 if side == "long" else -1.0
            w = sign * mv / total_mv
            if ticker in returns_df.columns:
                theme_ret += returns_df[ticker].fillna(0) * w
        theme_returns[theme] = theme_ret

    if len(theme_returns) < 2:
        return {"themes": [], "matrix": []}

    themes_df = pd.DataFrame(theme_returns).dropna()
    # Use 6 months of data
    if len(themes_df) > 126:
        themes_df = themes_df.iloc[-126:]

    corr = themes_df.corr()
    theme_names = list(corr.columns)
    matrix = [[round(float(corr.iloc[i, j]), 3) for j in range(len(theme_names))] for i in range(len(theme_names))]

    return {
        "themes": theme_names,
        "matrix": matrix,
    }


# ---------------------------------------------------------------------------
# Scenario Analysis
# ---------------------------------------------------------------------------

def compute_scenarios(positions: list[Position], betas: dict[str, float]) -> list[dict]:
    """
    Estimate portfolio impact under various stress scenarios.
    - Market shocks: use position betas
    - Rate shocks: use duration approximation for TIP/TLT
    - USD shock: estimate FX impact on international positions
    """
    total_mv = sum(p.market_value for p in positions)
    scenarios = []

    # --- Market scenarios ---
    for shock_pct in [-5, -10, -20]:
        impact = 0.0
        for p in positions:
            b = betas.get(p.ticker, 1.0)  # default beta=1 if unknown
            sign = 1.0 if p.side == "long" else -1.0
            # Position P&L = beta * market_move * position_value * direction
            impact += b * (shock_pct / 100) * p.market_value * sign
        scenarios.append({
            "scenario": f"Market {shock_pct}%",
            "category": "market",
            "impact_dollar": round(impact, 2),
            "impact_pct": round(impact / total_mv * 100, 2) if total_mv > 0 else 0,
        })

    # --- Rate scenarios (duration approximation) ---
    # TIP duration ~7.5y, TLT duration ~17y
    duration_map = {"TIP": 7.5, "TLT": 17.0}
    for rate_shock_bp in [50, 100]:
        impact = 0.0
        for p in positions:
            dur = duration_map.get(p.ticker)
            if dur is None:
                continue
            # Bond price change ~ -duration * rate_change
            rate_change = rate_shock_bp / 10000
            price_impact = -dur * rate_change
            sign = 1.0 if p.side == "long" else -1.0
            impact += price_impact * p.market_value * sign
        scenarios.append({
            "scenario": f"Rates +{rate_shock_bp}bp",
            "category": "rates",
            "impact_dollar": round(impact, 2),
            "impact_pct": round(impact / total_mv * 100, 2) if total_mv > 0 else 0,
        })

    # --- USD +5% scenario ---
    # International tickers are harmed by strong dollar
    intl_tickers = {
        "AIQUY", "BASFY", "EADSF", "EVKIY", "SLVYY",  # European ADRs
        "INDA", "MCHI", "VNM", "VWO", "EUAD", "XPEV",  # EM/Asia
    }
    usd_impact = 0.0
    for p in positions:
        if p.ticker not in intl_tickers:
            continue
        sign = 1.0 if p.side == "long" else -1.0
        # Rough: international positions lose ~1:1 with USD strengthening
        usd_impact += -0.05 * p.market_value * sign
    scenarios.append({
        "scenario": "USD +5%",
        "category": "fx",
        "impact_dollar": round(usd_impact, 2),
        "impact_pct": round(usd_impact / total_mv * 100, 2) if total_mv > 0 else 0,
    })

    return scenarios


# ---------------------------------------------------------------------------
# Position Flags
# ---------------------------------------------------------------------------

def compute_flags(positions: list[Position]) -> list[dict]:
    """Flag positions with significant P&L moves."""
    flags = []
    for p in positions:
        pnl = p.pnl_pct
        if pnl >= 20:
            flags.append({
                "ticker": p.ticker,
                "side": p.side,
                "pnl_pct": round(pnl, 2),
                "pnl_dollar": round(p.pnl_dollar, 2),
                "market_value": round(p.market_value, 2),
                "flag": "winner",
                "message": f"{p.ticker} is up {pnl:.1f}% — consider taking profits",
            })
        elif pnl <= -15:
            flags.append({
                "ticker": p.ticker,
                "side": p.side,
                "pnl_pct": round(pnl, 2),
                "pnl_dollar": round(p.pnl_dollar, 2),
                "market_value": round(p.market_value, 2),
                "flag": "loser",
                "message": f"{p.ticker} is down {pnl:.1f}% — review thesis or cut loss",
            })
    # Sort: biggest losses first, then biggest winners
    flags.sort(key=lambda x: x["pnl_pct"])
    return flags


# ---------------------------------------------------------------------------
# Full Risk Summary (one-shot computation)
# ---------------------------------------------------------------------------

def compute_full_risk() -> dict:
    """
    Compute all risk metrics in one pass.
    Called by the router, result is cached.
    """
    positions = get_positions()
    tickers = list(set(p.ticker for p in positions))

    # Fetch 1y of price data for all tickers
    prices_df = get_prices(tickers, period="1y")
    returns_df = prices_df.pct_change().dropna() if not prices_df.empty else pd.DataFrame()

    # Fetch betas
    betas = fetch_betas(tickers)

    # Compute everything
    exposures = compute_exposures(positions)
    beta_exposure = compute_beta_adjusted_exposure(positions, betas)
    var_data = compute_var(positions, returns_df)
    drawdown = compute_drawdown(positions, returns_df)
    correlation = compute_theme_correlation(positions, returns_df)
    scenarios = compute_scenarios(positions, betas)
    flags = compute_flags(positions)

    # Position details for the frontend
    position_details = []
    for p in positions:
        position_details.append({
            "ticker": p.ticker,
            "side": p.side,
            "shares": p.shares,
            "entry_price": p.entry_price,
            "current_price": p.current_price,
            "market_value": round(p.market_value, 2),
            "pnl_pct": round(p.pnl_pct, 2),
            "pnl_dollar": round(p.pnl_dollar, 2),
            "weight_pct": round(p.market_value / PORTFOLIO_VALUE * 100, 2),
            "beta": betas.get(p.ticker),
            "theme": p.theme,
        })

    return {
        "exposures": {**exposures, **beta_exposure},
        "var": var_data,
        "drawdown": drawdown,
        "correlation": correlation,
        "scenarios": scenarios,
        "flags": flags,
        "positions": position_details,
        "meta": {
            "num_positions": len(positions),
            "num_long": sum(1 for p in positions if p.side == "long"),
            "num_short": sum(1 for p in positions if p.side == "short"),
            "tickers_with_data": len([t for t in tickers if t in returns_df.columns]),
            "tickers_missing_data": [t for t in tickers if t not in returns_df.columns],
            "portfolio_value": PORTFOLIO_VALUE,
        },
    }
