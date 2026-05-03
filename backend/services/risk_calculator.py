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
from dataclasses import dataclass, field
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

# ---------------------------------------------------------------------------
# Sector / Country / Region mappings (Angela's feedback)
# ---------------------------------------------------------------------------

TICKER_SECTORS = {
    "DELL": "Technology", "HPE": "Technology", "HPQ": "Technology",
    "BILL": "Technology", "AIQUY": "Technology", "ROBO": "Technology",
    "LLY": "Healthcare", "AMGN": "Healthcare", "INMD": "Healthcare",
    "TSLA": "Consumer Discretionary", "BBWI": "Consumer Discretionary",
    "WW": "Consumer Discretionary", "ELF": "Consumer Discretionary",
    "XPEV": "Consumer Discretionary",
    "FDX": "Industrials", "UPS": "Industrials", "XLI": "Industrials",
    "G": "Industrials", "EUAD": "Industrials", "EADSF": "Industrials",
    "SLVYY": "Materials", "APD": "Materials", "LIN": "Materials",
    "XOM": "Materials", "BASFY": "Materials", "EVKIY": "Materials",
    "BX": "Financials", "OBDC": "Financials",
    # ETFs / Bonds / EM mapped to their primary exposure
    "TIP": "Fixed Income", "TLT": "Fixed Income",
    "INDA": "EM Equity", "VNM": "EM Equity", "MCHI": "EM Equity",
    "VWO": "EM Equity",
}

TICKER_COUNTRY = {
    "DELL": "US", "HPE": "US", "HPQ": "US", "BILL": "US", "BX": "US",
    "OBDC": "US", "FDX": "US", "UPS": "US", "XLI": "US", "LLY": "US",
    "AMGN": "US", "TSLA": "US", "BBWI": "US", "WW": "US", "ELF": "US",
    "APD": "US", "LIN": "US", "XOM": "US", "TIP": "US", "TLT": "US",
    "ROBO": "US", "G": "US",
    "EADSF": "Europe", "BASFY": "Europe", "EVKIY": "Europe",
    "SLVYY": "Europe", "EUAD": "Europe", "AIQUY": "Europe",
    "XPEV": "Asia", "MCHI": "Asia", "INMD": "Asia",
    "INDA": "EM", "VNM": "EM", "VWO": "EM",
}

COUNTRY_TO_REGION = {
    "US": "Americas",
    "Europe": "Europe",
    "Asia": "Asia-Pacific",
    "EM": "Emerging Markets",
}

# Company name lookup — avoids yfinance call for known tickers
TICKER_NAMES = {
    "AIQUY": "Air Liquide ADR", "AMGN": "Amgen", "APD": "Air Products",
    "BASFY": "BASF ADR", "BBWI": "Bath & Body Works", "BILL": "BILL Holdings",
    "BX": "Blackstone", "DELL": "Dell Technologies", "EADSF": "Airbus",
    "ELF": "e.l.f. Beauty", "EUAD": "iShares MSCI Europe Aerospace & Defence",
    "EVKIY": "Evonik Industries ADR", "FDX": "FedEx", "G": "Genpact",
    "HPE": "Hewlett Packard Enterprise", "HPQ": "HP Inc.",
    "INDA": "iShares MSCI India", "INMD": "InMode",
    "LIN": "Linde", "LLY": "Eli Lilly", "MCHI": "iShares MSCI China",
    "OBDC": "Blue Owl Capital", "ROBO": "ROBO Global Robotics ETF",
    "SLVYY": "Solvay ADR", "TIP": "iShares TIPS Bond ETF",
    "TLT": "iShares 20+ Year Treasury", "TSLA": "Tesla",
    "UPS": "United Parcel Service", "VNM": "VanEck Vietnam ETF",
    "VWO": "Vanguard FTSE Emerging Markets", "WW": "WW International",
    "XLI": "Industrial Select Sector SPDR", "XOM": "Exxon Mobil",
    "XPEV": "XPeng",
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

    @property
    def sector(self) -> str:
        return TICKER_SECTORS.get(self.ticker, "Other")

    @property
    def country(self) -> str:
        return TICKER_COUNTRY.get(self.ticker, "US")

    @property
    def region(self) -> str:
        return COUNTRY_TO_REGION.get(self.country, "Other")

    @property
    def name(self) -> str:
        return TICKER_NAMES.get(self.ticker, self.ticker)


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
# Exposure by Sector / Country / Region
# ---------------------------------------------------------------------------

def _group_exposure(positions: list[Position], key_fn) -> dict:
    """Group positions by a key function and compute gross/net exposure."""
    groups: dict[str, dict] = {}
    gross_total = sum(p.market_value for p in positions)
    for p in positions:
        k = key_fn(p)
        if k not in groups:
            groups[k] = {"long": 0.0, "short": 0.0}
        if p.side == "long":
            groups[k]["long"] += p.market_value
        else:
            groups[k]["short"] += p.market_value

    result = []
    for name, v in sorted(groups.items(), key=lambda x: -(x[1]["long"] + x[1]["short"])):
        gross = v["long"] + v["short"]
        net = v["long"] - v["short"]
        result.append({
            "name": name,
            "long_exposure": round(v["long"], 2),
            "short_exposure": round(v["short"], 2),
            "gross_exposure": round(gross, 2),
            "net_exposure": round(net, 2),
            "gross_pct": round(gross / gross_total * 100, 2) if gross_total > 0 else 0,
            "net_pct": round(net / gross_total * 100, 2) if gross_total > 0 else 0,
        })
    return result


def compute_exposure_by_sector(positions: list[Position]) -> list[dict]:
    return _group_exposure(positions, lambda p: p.sector)


def compute_exposure_by_country(positions: list[Position]) -> list[dict]:
    return _group_exposure(positions, lambda p: p.country)


def compute_exposure_by_region(positions: list[Position]) -> list[dict]:
    return _group_exposure(positions, lambda p: p.region)


def compute_exposure_by_theme(positions: list[Position]) -> list[dict]:
    return _group_exposure(positions, lambda p: p.theme)


# ---------------------------------------------------------------------------
# Summary Statistics
# ---------------------------------------------------------------------------

def compute_summary_stats(positions: list[Position]) -> dict:
    """Position count, avg per theme, max theme size, max position size."""
    gross = sum(p.market_value for p in positions)
    if gross == 0:
        return {}

    # Theme sizes
    theme_mv: dict[str, float] = {}
    for p in positions:
        theme_mv.setdefault(p.theme, 0.0)
        theme_mv[p.theme] += p.market_value

    max_theme = max(theme_mv.values()) if theme_mv else 0
    max_position = max(p.market_value for p in positions) if positions else 0
    avg_per_theme = len(positions) / len(theme_mv) if theme_mv else 0

    return {
        "total_positions": len(positions),
        "num_themes": len(theme_mv),
        "avg_positions_per_theme": round(avg_per_theme, 1),
        "max_theme_size_pct": round(max_theme / gross * 100, 2),
        "max_theme_name": max(theme_mv, key=theme_mv.get) if theme_mv else "",
        "max_position_size_pct": round(max_position / gross * 100, 2),
        "max_position_ticker": max(positions, key=lambda p: p.market_value).ticker if positions else "",
    }


# ---------------------------------------------------------------------------
# Beta-Adjusted Exposure by grouping (theme, sector, country)
# ---------------------------------------------------------------------------

def compute_beta_adjusted_by_group(
    positions: list[Position], betas: dict[str, float], key_fn
) -> list[dict]:
    """Beta-adjusted gross and net exposure for each group."""
    groups: dict[str, dict] = {}
    for p in positions:
        k = key_fn(p)
        if k not in groups:
            groups[k] = {"beta_long": 0.0, "beta_short": 0.0, "raw_long": 0.0, "raw_short": 0.0}
        b = betas.get(p.ticker, 1.0)
        if p.side == "long":
            groups[k]["beta_long"] += b * p.market_value
            groups[k]["raw_long"] += p.market_value
        else:
            groups[k]["beta_short"] += b * p.market_value
            groups[k]["raw_short"] += p.market_value

    result = []
    for name, v in sorted(groups.items()):
        result.append({
            "name": name,
            "beta_adj_gross": round(v["beta_long"] + v["beta_short"], 2),
            "beta_adj_net": round(v["beta_long"] - v["beta_short"], 2),
            "raw_gross": round(v["raw_long"] + v["raw_short"], 2),
            "raw_net": round(v["raw_long"] - v["raw_short"], 2),
        })
    return result


# ---------------------------------------------------------------------------
# Per-Position Risk Metrics (5Y max drawdown, skew, kurtosis)
# ---------------------------------------------------------------------------

def compute_position_risk_metrics(tickers: list[str]) -> dict[str, dict]:
    """5Y max drawdown, skewness, kurtosis per ticker. Uses 5y price data."""
    from scipy.stats import skew, kurtosis as kurt

    prices_5y = get_prices(tickers, period="5y")
    if prices_5y.empty:
        return {}

    returns_5y = prices_5y.pct_change().dropna()
    result = {}
    for ticker in tickers:
        if ticker not in returns_5y.columns:
            continue
        ret = returns_5y[ticker].dropna()
        if len(ret) < 60:
            continue

        # Max drawdown from 5y price series
        if ticker in prices_5y.columns:
            px = prices_5y[ticker].dropna()
            cum_max = px.cummax()
            dd = (px - cum_max) / cum_max
            max_dd = float(dd.min()) * 100
        else:
            max_dd = None

        result[ticker] = {
            "max_drawdown_5y_pct": round(max_dd, 2) if max_dd is not None else None,
            "skewness": round(float(skew(ret)), 3),
            "kurtosis": round(float(kurt(ret)), 3),
            "num_observations_5y": len(ret),
        }
    return result


# ---------------------------------------------------------------------------
# Factor Exposure (Fama-French 5 + Momentum)
# Uses 2y trailing regression of position returns on FF factors.
# Falls back to hardcoded estimates if Ken French data unavailable.
# ---------------------------------------------------------------------------

def _fetch_ff_factors() -> pd.DataFrame | None:
    """Try to fetch Fama-French 5 factor + momentum data from Kenneth French library."""
    cache_key = "ff_factors_daily"
    if cache_key in _price_cache:
        return _price_cache[cache_key]

    try:
        import pandas_datareader.data as web
        ff5 = web.DataReader("F-F_Research_Data_5_Factors_2x3_daily", "famafrench")[0]
        mom = web.DataReader("F-F_Momentum_Factor_daily", "famafrench")[0]
        ff5 = ff5 / 100  # Convert from percent
        mom = mom / 100
        factors = ff5.join(mom, how="inner")
        factors.columns = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF", "Mom"]
        _price_cache[cache_key] = factors
        return factors
    except Exception as e:
        logger.warning(f"Could not fetch FF factors: {e}")
        return None


def compute_factor_exposures(positions: list[Position], returns_df: pd.DataFrame) -> dict:
    """
    Regress each position's returns on FF5 + Momentum.
    Returns factor betas per position and per theme.
    """
    factors_df = _fetch_ff_factors()

    factor_names = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]

    if factors_df is None:
        # Fallback: return empty structure with a note
        return {
            "factor_names": factor_names,
            "by_position": [],
            "by_theme": [],
            "methodology": "Fama-French 5 Factor + Momentum. Data source unavailable — install pandas-datareader for live factor data.",
        }

    # Use 2 years of data (504 trading days)
    factors_recent = factors_df.iloc[-504:] if len(factors_df) > 504 else factors_df

    # Align dates
    common_idx = returns_df.index.intersection(factors_recent.index)
    if len(common_idx) < 60:
        return {
            "factor_names": factor_names,
            "by_position": [],
            "by_theme": [],
            "methodology": "Insufficient overlapping data between position returns and factor data.",
        }

    X = factors_recent.loc[common_idx, factor_names].values
    # Add constant for regression
    X_with_const = np.column_stack([np.ones(len(X)), X])

    position_factors = []
    for p in positions:
        if p.ticker not in returns_df.columns:
            continue
        y = returns_df.loc[common_idx, p.ticker].values
        mask = ~(np.isnan(y) | np.any(np.isnan(X_with_const), axis=1))
        if mask.sum() < 60:
            continue
        try:
            # OLS: beta = (X'X)^-1 X'y
            Xm = X_with_const[mask]
            ym = y[mask]
            betas = np.linalg.lstsq(Xm, ym, rcond=None)[0]
            alpha = betas[0]
            factor_betas = betas[1:]
            position_factors.append({
                "ticker": p.ticker,
                "theme": p.theme,
                "side": p.side,
                "alpha_daily": round(float(alpha), 6),
                "factor_betas": {fn: round(float(fb), 4) for fn, fb in zip(factor_names, factor_betas)},
            })
        except Exception as e:
            logger.warning(f"Factor regression failed for {p.ticker}: {e}")

    # Aggregate by theme (market-value weighted average)
    theme_factors: dict[str, dict] = {}
    for pf in position_factors:
        theme = pf["theme"]
        if theme not in theme_factors:
            theme_factors[theme] = {fn: [] for fn in factor_names}
            theme_factors[theme]["_weights"] = []
        # Find position market value for weighting
        pos = next((p for p in positions if p.ticker == pf["ticker"]), None)
        w = pos.market_value if pos else 1.0
        sign = 1.0 if pf["side"] == "long" else -1.0
        for fn in factor_names:
            theme_factors[theme][fn].append(sign * pf["factor_betas"][fn] * w)
        theme_factors[theme]["_weights"].append(w)

    by_theme = []
    for theme, data in sorted(theme_factors.items()):
        total_w = sum(data["_weights"])
        if total_w == 0:
            continue
        avg = {fn: round(sum(data[fn]) / total_w, 4) for fn in factor_names}
        by_theme.append({"theme": theme, "factor_betas": avg})

    return {
        "factor_names": factor_names,
        "by_position": position_factors,
        "by_theme": by_theme,
        "methodology": "OLS regression on Fama-French 5 factors + Momentum. 2-year trailing daily returns. Factor data from Kenneth French Data Library.",
    }


# ---------------------------------------------------------------------------
# Enhanced Scenarios (GFC, European Debt Crisis, etc.)
# ---------------------------------------------------------------------------

HISTORICAL_SCENARIOS = [
    {
        "scenario": "GFC (2008)",
        "category": "historical",
        "market_shock": -0.50,
        "rate_shock_bp": -200,
        "usd_shock": 0.10,
        "correlation_multiplier": 1.5,
        "description": "Global Financial Crisis: equities -50%, rates -200bp, USD +10%, correlations spike",
    },
    {
        "scenario": "European Debt Crisis (2011)",
        "category": "historical",
        "market_shock": -0.20,
        "rate_shock_bp": -50,
        "usd_shock": 0.05,
        "correlation_multiplier": 1.3,
        "description": "European sovereign debt crisis: equities -20%, European names hit harder",
    },
    {
        "scenario": "Flash Crash (2010)",
        "category": "historical",
        "market_shock": -0.09,
        "rate_shock_bp": 0,
        "usd_shock": 0.0,
        "correlation_multiplier": 1.8,
        "description": "Intraday crash: equities -9%, extreme correlation spike, rapid recovery",
    },
    {
        "scenario": "Volmageddon (Feb 2018)",
        "category": "historical",
        "market_shock": -0.10,
        "rate_shock_bp": 25,
        "usd_shock": 0.0,
        "correlation_multiplier": 1.4,
        "description": "VIX spike, vol-selling unwind: equities -10%, rates +25bp",
    },
    {
        "scenario": "COVID Crash (Mar 2020)",
        "category": "historical",
        "market_shock": -0.34,
        "rate_shock_bp": -100,
        "usd_shock": 0.08,
        "correlation_multiplier": 1.6,
        "description": "Pandemic selloff: equities -34%, rates -100bp, USD safe haven +8%",
    },
]


def compute_enhanced_scenarios(positions: list[Position], betas: dict[str, float]) -> list[dict]:
    """
    Extended scenario analysis including historical events.
    Keeps original scenarios and adds new historical ones.
    """
    # Start with the original scenarios
    scenarios = compute_scenarios(positions, betas)

    total_mv = sum(p.market_value for p in positions)
    if total_mv == 0:
        return scenarios

    duration_map = {"TIP": 7.5, "TLT": 17.0}
    intl_tickers = {
        "AIQUY", "BASFY", "EADSF", "EVKIY", "SLVYY",
        "INDA", "MCHI", "VNM", "VWO", "EUAD", "XPEV",
    }

    for hs in HISTORICAL_SCENARIOS:
        impact = 0.0
        # Market component
        for p in positions:
            b = betas.get(p.ticker, 1.0) * hs.get("correlation_multiplier", 1.0)
            sign = 1.0 if p.side == "long" else -1.0
            impact += b * hs["market_shock"] * p.market_value * sign

        # Rate component
        rate_bp = hs.get("rate_shock_bp", 0)
        if rate_bp != 0:
            for p in positions:
                dur = duration_map.get(p.ticker)
                if dur is None:
                    continue
                rate_change = rate_bp / 10000
                price_impact = -dur * rate_change
                sign = 1.0 if p.side == "long" else -1.0
                impact += price_impact * p.market_value * sign

        # USD component
        usd_shock = hs.get("usd_shock", 0)
        if usd_shock != 0:
            for p in positions:
                if p.ticker not in intl_tickers:
                    continue
                sign = 1.0 if p.side == "long" else -1.0
                impact += -usd_shock * p.market_value * sign

        scenarios.append({
            "scenario": hs["scenario"],
            "category": "historical",
            "impact_dollar": round(impact, 2),
            "impact_pct": round(impact / total_mv * 100, 2),
            "description": hs.get("description", ""),
        })

    return scenarios


# ---------------------------------------------------------------------------
# Liquidity: Days to liquidate at 15% VWAP
# ---------------------------------------------------------------------------

def compute_liquidity(positions: list[Position]) -> list[dict]:
    """Estimate days to liquidate each position at 15% of avg daily volume."""
    import yfinance as yf

    result = []
    for p in positions:
        cache_key = f"avgvol_{p.ticker}"
        if cache_key in _price_cache:
            avg_vol = _price_cache[cache_key]
        else:
            try:
                info = yf.Ticker(p.ticker).info
                avg_vol = info.get("averageVolume", 0) or info.get("averageDailyVolume10Day", 0) or 0
                _price_cache[cache_key] = avg_vol
            except Exception:
                avg_vol = 0
                _price_cache[cache_key] = 0

        # 15% VWAP participation rate (Angela requested 15%, not 10%)
        daily_capacity = avg_vol * 0.15
        days = round(p.shares / daily_capacity, 1) if daily_capacity > 0 else None

        result.append({
            "ticker": p.ticker,
            "shares": p.shares,
            "avg_daily_volume": avg_vol,
            "daily_capacity_15pct": round(daily_capacity, 0) if daily_capacity > 0 else 0,
            "days_to_liquidate": days,
            "liquidity_flag": "illiquid" if (days is not None and days > 5) else "ok",
        })
    return result


# ---------------------------------------------------------------------------
# Portfolio Optimizer (mean-variance, simple equal-risk-contribution)
# ---------------------------------------------------------------------------

def compute_optimization(positions: list[Position], returns_df: pd.DataFrame) -> dict:
    """
    Simple mean-variance optimizer suggesting theme-level weight adjustments.
    Uses equal-risk-contribution as the target (simpler than full MVO for a class project).
    """
    from scipy.optimize import minimize

    # Build theme returns
    theme_tickers: dict[str, list[tuple[str, float, str]]] = {}
    for p in positions:
        theme_tickers.setdefault(p.theme, []).append((p.ticker, p.market_value, p.side))

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
            theme_ret += returns_df[ticker].fillna(0) * w
        theme_returns[theme] = theme_ret

    if len(theme_returns) < 2:
        return {"error": "Need at least 2 themes with return data"}

    themes_df = pd.DataFrame(theme_returns).dropna()
    if len(themes_df) < 60:
        return {"error": "Insufficient return data for optimization"}

    # Use last 6 months
    themes_df = themes_df.iloc[-126:] if len(themes_df) > 126 else themes_df

    theme_names = list(themes_df.columns)
    n = len(theme_names)
    cov = themes_df.cov().values * TRADING_DAYS  # annualized
    mu = themes_df.mean().values * TRADING_DAYS  # annualized

    # Current weights
    gross = sum(p.market_value for p in positions)
    current_weights = {}
    for theme in theme_names:
        theme_mv = sum(mv for _, mv, _ in theme_tickers.get(theme, []))
        current_weights[theme] = round(theme_mv / gross * 100, 2) if gross > 0 else 0

    # Equal Risk Contribution optimization
    def risk_contribution_obj(w):
        port_var = w @ cov @ w
        if port_var <= 0:
            return 1e10
        sigma = np.sqrt(port_var)
        marginal_risk = cov @ w / sigma
        risk_contrib = w * marginal_risk
        target = sigma / n  # equal risk for each theme
        return np.sum((risk_contrib - target) ** 2)

    x0 = np.ones(n) / n
    bounds = [(0.02, 0.40)] * n  # min 2%, max 40% per theme
    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]

    try:
        res = minimize(risk_contribution_obj, x0, method="SLSQP",
                      bounds=bounds, constraints=constraints)
        if not res.success:
            return {"error": f"Optimization did not converge: {res.message}"}

        optimal_weights = {theme: round(float(w) * 100, 2) for theme, w in zip(theme_names, res.x)}

        # Compute Sharpe for current and optimal
        cw = np.array([current_weights.get(t, 0) / 100 for t in theme_names])
        cw_norm = cw / cw.sum() if cw.sum() > 0 else x0

        def portfolio_sharpe(w):
            ret = w @ mu
            vol = np.sqrt(w @ cov @ w)
            return ret / vol if vol > 0 else 0

        current_sharpe = round(float(portfolio_sharpe(cw_norm)), 3)
        optimal_sharpe = round(float(portfolio_sharpe(res.x)), 3)

        # Suggestions
        suggestions = []
        for theme in theme_names:
            curr = current_weights.get(theme, 0)
            opt = optimal_weights.get(theme, 0)
            diff = opt - curr
            if abs(diff) > 2:
                direction = "Increase" if diff > 0 else "Decrease"
                suggestions.append(f"{direction} {theme} from {curr:.1f}% to {opt:.1f}% ({diff:+.1f}%)")

        return {
            "current_weights": current_weights,
            "optimal_weights": optimal_weights,
            "current_sharpe": current_sharpe,
            "optimal_sharpe": optimal_sharpe,
            "suggestions": suggestions,
            "methodology": "Equal Risk Contribution (ERC) optimization on theme-level returns. 6-month trailing data, annualized.",
        }
    except Exception as e:
        return {"error": f"Optimization failed: {str(e)}"}


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
    scenarios = compute_enhanced_scenarios(positions, betas)
    flags = compute_flags(positions)

    # New: exposure breakdowns by sector, country, region, theme
    exposure_by_sector = compute_exposure_by_sector(positions)
    exposure_by_country = compute_exposure_by_country(positions)
    exposure_by_region = compute_exposure_by_region(positions)
    exposure_by_theme = compute_exposure_by_theme(positions)

    # New: summary statistics
    summary_stats = compute_summary_stats(positions)

    # New: beta-adjusted exposure by groupings
    beta_adj_by_theme = compute_beta_adjusted_by_group(positions, betas, lambda p: p.theme)
    beta_adj_by_sector = compute_beta_adjusted_by_group(positions, betas, lambda p: p.sector)
    beta_adj_by_country = compute_beta_adjusted_by_group(positions, betas, lambda p: p.country)

    # New: per-position risk metrics (5Y drawdown, skew, kurtosis)
    position_risk_metrics = compute_position_risk_metrics(tickers)

    # Position details for the frontend (enriched with sector/country/name/beta-adj)
    position_details = []
    for p in positions:
        b = betas.get(p.ticker)
        beta_adj_mv = b * p.market_value if b is not None else None
        sign = 1.0 if p.side == "long" else -1.0
        prm = position_risk_metrics.get(p.ticker, {})
        position_details.append({
            "ticker": p.ticker,
            "name": p.name,
            "side": p.side,
            "shares": p.shares,
            "entry_price": p.entry_price,
            "current_price": p.current_price,
            "market_value": round(p.market_value, 2),
            "pnl_pct": round(p.pnl_pct, 2),
            "pnl_dollar": round(p.pnl_dollar, 2),
            "weight_pct": round(p.market_value / PORTFOLIO_VALUE * 100, 2),
            "beta": b,
            "beta_adjusted_exposure": round(sign * beta_adj_mv, 2) if beta_adj_mv is not None else None,
            "theme": p.theme,
            "sector": p.sector,
            "country": p.country,
            "region": p.region,
            # Per-position risk metrics
            "max_drawdown_5y_pct": prm.get("max_drawdown_5y_pct"),
            "skewness": prm.get("skewness"),
            "kurtosis": prm.get("kurtosis"),
        })

    return {
        "exposures": {**exposures, **beta_exposure},
        "var": var_data,
        "drawdown": drawdown,
        "correlation": correlation,
        "scenarios": scenarios,
        "flags": flags,
        "positions": position_details,
        "exposure_by_sector": exposure_by_sector,
        "exposure_by_country": exposure_by_country,
        "exposure_by_region": exposure_by_region,
        "exposure_by_theme": exposure_by_theme,
        "summary_stats": summary_stats,
        "beta_adjusted_by_theme": beta_adj_by_theme,
        "beta_adjusted_by_sector": beta_adj_by_sector,
        "beta_adjusted_by_country": beta_adj_by_country,
        "meta": {
            "num_positions": len(positions),
            "num_long": sum(1 for p in positions if p.side == "long"),
            "num_short": sum(1 for p in positions if p.side == "short"),
            "tickers_with_data": len([t for t in tickers if t in returns_df.columns]),
            "tickers_missing_data": [t for t in tickers if t not in returns_df.columns],
            "portfolio_value": PORTFOLIO_VALUE,
        },
    }
