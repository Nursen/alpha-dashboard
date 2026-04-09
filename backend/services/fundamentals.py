"""
Fundamental analysis service — pulls financial statements from yfinance,
computes composite scores, and compares long/short pairs.

Caches aggressively (1h TTL) because financial statements don't change intraday.
"""

import yfinance as yf
import pandas as pd
import numpy as np
from cachetools import TTLCache
import logging

logger = logging.getLogger(__name__)

# 1-hour cache for financial data (statements change quarterly at most)
_financials_cache: TTLCache = TTLCache(maxsize=200, ttl=3600)


def _safe_get(d: dict, key: str, default=None):
    """Safely get from dict, returning default for missing/NaN."""
    val = d.get(key, default)
    if val is None:
        return default
    try:
        if pd.isna(val):
            return default
    except (TypeError, ValueError):
        pass
    return val


def _safe_float(val, default=None) -> float | None:
    """Convert to float, returning None for anything invalid."""
    if val is None:
        return default
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _df_to_dict(df: pd.DataFrame | None) -> dict | None:
    """Convert a yfinance financial statement DataFrame to a nested dict.
    yfinance returns rows=line items, columns=dates (most recent first).
    """
    if df is None or df.empty:
        return None
    # Convert column dates to strings, keep row index as-is
    result = {}
    for col in df.columns:
        date_str = col.strftime("%Y-%m-%d") if hasattr(col, "strftime") else str(col)
        col_data = {}
        for idx in df.index:
            val = _safe_float(df.loc[idx, col])
            col_data[str(idx)] = val
        result[date_str] = col_data
    return result


def _get_latest_value(df: pd.DataFrame | None, row_label: str) -> float | None:
    """Get the most recent value for a line item from a financial statement DF."""
    if df is None or df.empty:
        return None
    # Try exact match first, then partial match
    for label in df.index:
        if str(label).strip() == row_label.strip():
            val = df.loc[label].iloc[0]  # first column = most recent
            return _safe_float(val)
    # Partial / case-insensitive fallback
    for label in df.index:
        if row_label.lower() in str(label).lower():
            val = df.loc[label].iloc[0]
            return _safe_float(val)
    return None


def _get_two_period_values(df: pd.DataFrame | None, row_label: str) -> tuple[float | None, float | None]:
    """Get the two most recent values for a line item (current, previous)."""
    if df is None or df.empty or len(df.columns) < 2:
        return None, None
    for label in df.index:
        if row_label.lower() in str(label).lower():
            current = _safe_float(df.loc[label].iloc[0])
            previous = _safe_float(df.loc[label].iloc[1])
            return current, previous
    return None, None


def _calc_growth(current: float | None, previous: float | None) -> float | None:
    """Calculate growth rate, handling edge cases."""
    if current is None or previous is None or previous == 0:
        return None
    return (current - previous) / abs(previous)


def _get_three_period_cagr(df: pd.DataFrame | None, row_label: str) -> float | None:
    """Calculate 3-year CAGR if enough data exists."""
    if df is None or df.empty or len(df.columns) < 3:
        return None
    for label in df.index:
        if row_label.lower() in str(label).lower():
            latest = _safe_float(df.loc[label].iloc[0])
            oldest = _safe_float(df.loc[label].iloc[-1])
            if latest is None or oldest is None or oldest <= 0:
                return None
            n_years = len(df.columns) - 1
            if n_years <= 0:
                return None
            try:
                return (latest / oldest) ** (1 / n_years) - 1
            except (ZeroDivisionError, ValueError):
                return None
    return None


# ---------------------------------------------------------------------------
# Main public API
# ---------------------------------------------------------------------------


def get_financials(ticker: str) -> dict:
    """
    Pull full financial data for a ticker. Returns structured dict with
    income_statement, balance_sheet, cash_flow, key_ratios, growth, info.
    Cached for 1 hour.
    """
    cache_key = f"financials_{ticker}"
    if cache_key in _financials_cache:
        return _financials_cache[cache_key]

    result = {
        "ticker": ticker,
        "income_statement": None,
        "balance_sheet": None,
        "cash_flow": None,
        "key_ratios": {},
        "growth": {},
        "info": {},
    }

    try:
        t = yf.Ticker(ticker)
    except Exception as e:
        logger.error(f"Failed to create Ticker for {ticker}: {e}")
        result["error"] = str(e)
        return result

    # --- Financial statements ---
    try:
        inc = t.financials
        result["income_statement"] = {
            "revenue": _get_latest_value(inc, "Total Revenue"),
            "ebitda": _get_latest_value(inc, "EBITDA"),
            "operating_income": _get_latest_value(inc, "Operating Income"),
            "net_income": _get_latest_value(inc, "Net Income"),
            "raw": _df_to_dict(inc),
        }
    except Exception as e:
        logger.warning(f"Income statement failed for {ticker}: {e}")

    try:
        bs = t.balance_sheet
        result["balance_sheet"] = {
            "total_assets": _get_latest_value(bs, "Total Assets"),
            "total_debt": _get_latest_value(bs, "Total Debt"),
            "total_equity": _get_latest_value(bs, "Stockholders Equity")
            or _get_latest_value(bs, "Total Equity"),
            "cash": _get_latest_value(bs, "Cash And Cash Equivalents")
            or _get_latest_value(bs, "Cash"),
            "current_assets": _get_latest_value(bs, "Current Assets"),
            "current_liabilities": _get_latest_value(bs, "Current Liabilities"),
        }
    except Exception as e:
        logger.warning(f"Balance sheet failed for {ticker}: {e}")

    try:
        cf = t.cashflow
        operating_cf = _get_latest_value(cf, "Operating Cash Flow") or _get_latest_value(
            cf, "Total Cash From Operating Activities"
        )
        capex = _get_latest_value(cf, "Capital Expenditure") or _get_latest_value(
            cf, "Capital Expenditures"
        )
        fcf = None
        if operating_cf is not None and capex is not None:
            # capex is usually negative in yfinance
            fcf = operating_cf + capex if capex < 0 else operating_cf - capex
        elif operating_cf is not None:
            fcf = _get_latest_value(cf, "Free Cash Flow")

        result["cash_flow"] = {
            "operating_cash_flow": operating_cf,
            "capex": capex,
            "free_cash_flow": fcf,
        }
    except Exception as e:
        logger.warning(f"Cash flow failed for {ticker}: {e}")

    # --- Info / metadata ---
    try:
        info = t.info or {}
        result["info"] = {
            "market_cap": _safe_float(info.get("marketCap")),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "dividend_yield": _safe_float(info.get("dividendYield")),
            "fifty_two_week_high": _safe_float(info.get("fiftyTwoWeekHigh")),
            "fifty_two_week_low": _safe_float(info.get("fiftyTwoWeekLow")),
            "short_name": info.get("shortName"),
        }
    except Exception as e:
        logger.warning(f"Info failed for {ticker}: {e}")

    # --- Key ratios (computed from statements + info) ---
    try:
        info = t.info or {}
        inc = t.financials
        bs = t.balance_sheet

        pe = _safe_float(info.get("trailingPE"))
        pb = _safe_float(info.get("priceToBook"))
        ev_ebitda = _safe_float(info.get("enterpriseToEbitda"))

        equity = (
            result.get("balance_sheet", {}).get("total_equity") if result.get("balance_sheet") else None
        )
        debt = result.get("balance_sheet", {}).get("total_debt") if result.get("balance_sheet") else None
        current_assets = (
            result.get("balance_sheet", {}).get("current_assets") if result.get("balance_sheet") else None
        )
        current_liab = (
            result.get("balance_sheet", {}).get("current_liabilities")
            if result.get("balance_sheet")
            else None
        )
        net_income = (
            result.get("income_statement", {}).get("net_income")
            if result.get("income_statement")
            else None
        )
        revenue = (
            result.get("income_statement", {}).get("revenue")
            if result.get("income_statement")
            else None
        )
        op_income = (
            result.get("income_statement", {}).get("operating_income")
            if result.get("income_statement")
            else None
        )

        de_ratio = (debt / equity) if debt is not None and equity and equity != 0 else None
        current_ratio = (
            (current_assets / current_liab)
            if current_assets is not None and current_liab and current_liab != 0
            else None
        )
        roe = (net_income / equity) if net_income is not None and equity and equity != 0 else None
        op_margin = (op_income / revenue) if op_income is not None and revenue and revenue != 0 else None
        net_margin = (
            (net_income / revenue) if net_income is not None and revenue and revenue != 0 else None
        )

        result["key_ratios"] = {
            "pe_ratio": pe,
            "pb_ratio": pb,
            "ev_ebitda": ev_ebitda,
            "debt_to_equity": _safe_float(de_ratio),
            "current_ratio": _safe_float(current_ratio),
            "roe": _safe_float(roe),
            "operating_margin": _safe_float(op_margin),
            "net_margin": _safe_float(net_margin),
        }
    except Exception as e:
        logger.warning(f"Ratios failed for {ticker}: {e}")

    # --- Growth ---
    try:
        inc = t.financials
        rev_curr, rev_prev = _get_two_period_values(inc, "Total Revenue")
        earn_curr, earn_prev = _get_two_period_values(inc, "Net Income")

        result["growth"] = {
            "revenue_growth_yoy": _calc_growth(rev_curr, rev_prev),
            "earnings_growth_yoy": _calc_growth(earn_curr, earn_prev),
            "revenue_cagr_3y": _get_three_period_cagr(inc, "Total Revenue"),
        }
    except Exception as e:
        logger.warning(f"Growth calcs failed for {ticker}: {e}")

    _financials_cache[cache_key] = result
    return result


def score_ticker(ticker: str) -> dict:
    """
    Compute composite fundamental score (0-100) with category breakdown.
    Higher = fundamentally stronger.
    """
    data = get_financials(ticker)
    ratios = data.get("key_ratios") or {}
    growth_data = data.get("growth") or {}
    cf_data = data.get("cash_flow") or {}
    info = data.get("info") or {}

    details = {}

    # --- 1. Growth (0-20) ---
    rev_growth = growth_data.get("revenue_growth_yoy")
    earn_growth = growth_data.get("earnings_growth_yoy")
    details["revenue_growth_pct"] = round(rev_growth * 100, 1) if rev_growth is not None else None
    details["earnings_growth_pct"] = round(earn_growth * 100, 1) if earn_growth is not None else None

    growth_score = 0
    if rev_growth is not None:
        rg = rev_growth * 100  # as percentage
        if rg > 20:
            growth_score = 20
        elif rg > 10:
            growth_score = 15
        elif rg > 5:
            growth_score = 10
        elif rg > 0:
            growth_score = 5
        # Bonus: margin expansion (earnings growing faster than revenue)
        if earn_growth is not None and rev_growth is not None and rev_growth > 0:
            if earn_growth > rev_growth:
                growth_score = min(20, growth_score + 5)

    # --- 2. Profitability (0-20) ---
    op_margin = ratios.get("operating_margin")
    details["operating_margin_pct"] = round(op_margin * 100, 1) if op_margin is not None else None

    prof_score = 0
    if op_margin is not None:
        om = op_margin * 100
        if om > 20:
            prof_score = 15
        elif om > 10:
            prof_score = 10
        elif om > 0:
            prof_score = 5
        # Margin improving QoQ — approximate from YoY data
        # We check if earnings growth > revenue growth as a proxy
        if earn_growth is not None and rev_growth is not None:
            if earn_growth > rev_growth:
                prof_score = min(20, prof_score + 5)

    # --- 3. Financial Health (0-20) ---
    de = ratios.get("debt_to_equity")
    cr = ratios.get("current_ratio")
    details["debt_to_equity"] = round(de, 2) if de is not None else None
    details["current_ratio"] = round(cr, 2) if cr is not None else None

    health_score = 0
    if de is not None:
        if de < 0.5:
            health_score = 15
        elif de < 1.0:
            health_score = 10
        elif de < 2.0:
            health_score = 5
    if cr is not None:
        if cr > 2.0:
            health_score = min(20, health_score + 5)
        elif cr > 1.0:
            health_score = min(20, health_score + 3)

    # --- 4. Cash Flow (0-20) ---
    fcf = cf_data.get("free_cash_flow")
    mkt_cap = info.get("market_cap")
    fcf_yield = None
    if fcf is not None and mkt_cap and mkt_cap > 0:
        fcf_yield = fcf / mkt_cap
    details["fcf"] = fcf
    details["fcf_yield_pct"] = round(fcf_yield * 100, 1) if fcf_yield is not None else None

    cf_score = 0
    if fcf is not None:
        if fcf > 0:
            cf_score = 10
        # FCF yield scoring
        if fcf_yield is not None:
            fy = fcf_yield * 100
            if fy > 5:
                cf_score = min(20, cf_score + 5)
            elif fy > 3:
                cf_score = min(20, cf_score + 3)
        # FCF growing — check operating CF growth as proxy
        ocf_curr, ocf_prev = None, None
        try:
            t = yf.Ticker(ticker)
            cf_df = t.cashflow
            ocf_curr, ocf_prev = _get_two_period_values(cf_df, "Operating Cash Flow")
            if ocf_curr is None:
                ocf_curr, ocf_prev = _get_two_period_values(
                    cf_df, "Total Cash From Operating Activities"
                )
        except Exception:
            pass
        if ocf_curr is not None and ocf_prev is not None and ocf_prev > 0:
            if ocf_curr > ocf_prev:
                cf_score = min(20, cf_score + 5)

    # --- 5. Valuation (0-20, inverse — cheap = good) ---
    pe = ratios.get("pe_ratio")
    ev_ebitda = ratios.get("ev_ebitda")
    details["pe_ratio"] = round(pe, 1) if pe is not None else None
    details["ev_ebitda"] = round(ev_ebitda, 1) if ev_ebitda is not None else None

    val_score = 0
    if pe is not None and pe > 0:
        if pe < 15:
            val_score = 15
        elif pe < 25:
            val_score = 10
        elif pe < 40:
            val_score = 5
    if ev_ebitda is not None and ev_ebitda > 0:
        if ev_ebitda < 10:
            val_score = min(20, val_score + 5)
        elif ev_ebitda < 15:
            val_score = min(20, val_score + 3)

    total = growth_score + prof_score + health_score + cf_score + val_score

    result = {
        "ticker": ticker,
        "total_score": total,
        "growth_score": growth_score,
        "profitability_score": prof_score,
        "health_score": health_score,
        "cashflow_score": cf_score,
        "valuation_score": val_score,
        "details": details,
    }

    return result


def compare_pair(long_ticker: str, short_ticker: str) -> dict:
    """
    Side-by-side comparison of long vs short leg with directional validation.
    """
    long_score = score_ticker(long_ticker)
    short_score = score_ticker(short_ticker)

    long_data = get_financials(long_ticker)
    short_data = get_financials(short_ticker)

    delta = long_score["total_score"] - short_score["total_score"]
    direction_valid = delta > 0

    warning = None
    if not direction_valid:
        warning = (
            f"Short leg ({short_ticker}) has better fundamentals than long leg "
            f"({long_ticker}). Score: {short_score['total_score']} vs {long_score['total_score']}. "
            f"Review your directional thesis."
        )

    # --- Key divergences ---
    divergences = []

    def _add_divergence(metric: str, long_val, short_val, fmt: str = "{:.1f}"):
        if long_val is None and short_val is None:
            return
        l_str = fmt.format(long_val) if long_val is not None else "N/A"
        s_str = fmt.format(short_val) if short_val is not None else "N/A"
        favors = "long"
        if long_val is not None and short_val is not None:
            # For most metrics, higher is better for longs
            if metric in ("P/E Ratio", "EV/EBITDA", "Debt/Equity"):
                favors = "long" if long_val < short_val else "short"
            else:
                favors = "long" if long_val > short_val else "short"
        divergences.append(
            {"metric": metric, "long": l_str, "short": s_str, "favors": favors}
        )

    ld, sd = long_score["details"], short_score["details"]

    _add_divergence(
        "Revenue Growth",
        ld.get("revenue_growth_pct"),
        sd.get("revenue_growth_pct"),
        "{:+.1f}%",
    )
    _add_divergence(
        "Operating Margin",
        ld.get("operating_margin_pct"),
        sd.get("operating_margin_pct"),
        "{:.1f}%",
    )
    _add_divergence("Debt/Equity", ld.get("debt_to_equity"), sd.get("debt_to_equity"), "{:.2f}")
    _add_divergence("P/E Ratio", ld.get("pe_ratio"), sd.get("pe_ratio"), "{:.1f}x")
    _add_divergence("EV/EBITDA", ld.get("ev_ebitda"), sd.get("ev_ebitda"), "{:.1f}x")
    _add_divergence("FCF Yield", ld.get("fcf_yield_pct"), sd.get("fcf_yield_pct"), "{:.1f}%")

    # --- Side-by-side raw data ---
    def _get_nested(data: dict, *keys):
        d = data
        for k in keys:
            if d is None or not isinstance(d, dict):
                return None
            d = d.get(k)
        return d

    side_by_side = {
        "Revenue": {
            "long": _get_nested(long_data, "income_statement", "revenue"),
            "short": _get_nested(short_data, "income_statement", "revenue"),
        },
        "Revenue Growth": {
            "long": _get_nested(long_data, "growth", "revenue_growth_yoy"),
            "short": _get_nested(short_data, "growth", "revenue_growth_yoy"),
        },
        "Operating Margin": {
            "long": _get_nested(long_data, "key_ratios", "operating_margin"),
            "short": _get_nested(short_data, "key_ratios", "operating_margin"),
        },
        "Net Income": {
            "long": _get_nested(long_data, "income_statement", "net_income"),
            "short": _get_nested(short_data, "income_statement", "net_income"),
        },
        "Debt/Equity": {
            "long": _get_nested(long_data, "key_ratios", "debt_to_equity"),
            "short": _get_nested(short_data, "key_ratios", "debt_to_equity"),
        },
        "FCF": {
            "long": _get_nested(long_data, "cash_flow", "free_cash_flow"),
            "short": _get_nested(short_data, "cash_flow", "free_cash_flow"),
        },
        "P/E": {
            "long": _get_nested(long_data, "key_ratios", "pe_ratio"),
            "short": _get_nested(short_data, "key_ratios", "pe_ratio"),
        },
        "Market Cap": {
            "long": _get_nested(long_data, "info", "market_cap"),
            "short": _get_nested(short_data, "info", "market_cap"),
        },
    }

    return {
        "long": long_score,
        "short": short_score,
        "score_delta": delta,
        "direction_valid": direction_valid,
        "warning": warning,
        "key_divergences": divergences,
        "side_by_side": side_by_side,
    }
