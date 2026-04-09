from fastapi import APIRouter, Depends
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from datetime import datetime, timezone
from cachetools import TTLCache
import logging

from auth import get_current_user
from db import get_db
from models.portfolio import PortfolioSummary, ConstraintStatus
from models.spread import SpreadCreate
from services.risk import check_constraints, check_with_proposed
from services.market_data import get_prices, get_current_prices
from services.analytics import calculate_pair_returns, calculate_spread_stats, TRADING_DAYS

logger = logging.getLogger(__name__)

# Cache risk computation for 5 minutes (heavy endpoint)
_risk_cache: TTLCache = TTLCache(maxsize=1, ttl=300)

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


async def _get_active_spreads() -> list[dict]:
    """Fetch all non-closed spreads from DB."""
    db = get_db()
    # Get all spreads and filter in Python (compatible with JSON fallback)
    cursor = db.spreads.find({})
    spreads = []
    async for doc in cursor:
        if doc.get("status") != "closed":
            doc["id"] = str(doc.pop("_id"))
            spreads.append(doc)
    return spreads


# ---------------------------------------------------------------------------
# Portfolio Risk Attribution
# ---------------------------------------------------------------------------

def _max_drawdown(returns: pd.Series) -> float:
    """Max drawdown from a return series, returned as a percentage (e.g. -18.5)."""
    cum = (1 + returns).cumprod()
    running_max = cum.cummax()
    dd = (cum - running_max) / running_max
    return round(float(dd.min()) * 100, 2) if len(dd) > 0 else 0.0


def _compute_risk(spreads: list[dict]) -> dict:
    """
    Core risk computation. Separated from endpoint so we can cache it.
    """
    if not spreads:
        return {
            "portfolio_metrics": {},
            "spread_risk": [],
            "risk_alerts": [],
            "error": "No active spreads",
        }

    # --- Build per-spread return series ---
    spread_meta = []  # parallel list: metadata per spread
    spread_return_series = []  # parallel list: pd.Series of daily returns
    skipped = []

    all_tickers_global = set()
    for s in spreads:
        all_tickers_global.update(s.get("long_leg", {}).get("tickers", []))
        all_tickers_global.update(s.get("short_leg", {}).get("tickers", []))

    # Single bulk price fetch for efficiency
    all_tickers_list = list(all_tickers_global) + ["SPY"]
    try:
        prices_df = get_prices(all_tickers_list, period="1y")
    except Exception as e:
        logger.error(f"Risk price fetch failed: {e}")
        return {"portfolio_metrics": {}, "spread_risk": [], "risk_alerts": [], "error": str(e)}

    if prices_df.empty:
        return {"portfolio_metrics": {}, "spread_risk": [], "risk_alerts": [], "error": "No price data"}

    for s in spreads:
        long_leg = s.get("long_leg", {})
        short_leg = s.get("short_leg", {})
        long_tickers = long_leg.get("tickers", [])
        short_tickers = short_leg.get("tickers", [])

        if not long_tickers or not short_tickers:
            skipped.append(s.get("id", "?"))
            continue

        long_weights = long_leg.get("weights", [1.0 / max(len(long_tickers), 1)] * len(long_tickers))
        short_weights = short_leg.get("weights", [1.0 / max(len(short_tickers), 1)] * len(short_tickers))

        try:
            pair_ret = calculate_pair_returns(prices_df, long_tickers, long_weights, short_tickers, short_weights)
            clean = pair_ret.dropna()
            if len(clean) < 20:
                skipped.append(s.get("id", "?"))
                continue

            spread_return_series.append(clean)

            # allocation = average of long+short alloc (how much capital is committed)
            long_alloc = long_leg.get("allocation_pct", 0)
            short_alloc = short_leg.get("allocation_pct", 0)
            alloc_pct = (long_alloc + short_alloc) / 2.0

            # P&L from entry prices
            pnl_pct = None
            entry_prices = s.get("entry_prices", {})
            if entry_prices:
                current_prices = get_current_prices(long_tickers + short_tickers)
                if current_prices:
                    long_pnl = sum(
                        ((current_prices.get(t, 0) - entry_prices.get(t, 0)) / entry_prices[t]) * w
                        for t, w in zip(long_tickers, long_weights)
                        if t in entry_prices and entry_prices[t] > 0 and t in current_prices
                    )
                    short_pnl = sum(
                        ((current_prices.get(t, 0) - entry_prices.get(t, 0)) / entry_prices[t]) * w
                        for t, w in zip(short_tickers, short_weights)
                        if t in entry_prices and entry_prices[t] > 0 and t in current_prices
                    )
                    pnl_pct = round((long_pnl - short_pnl) * 100, 2)

            # Days held
            created_at = s.get("created_at")
            days_held = None
            if created_at:
                try:
                    if isinstance(created_at, str):
                        created_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                    else:
                        created_dt = created_at
                    days_held = (datetime.now(timezone.utc) - created_dt.replace(tzinfo=timezone.utc if created_dt.tzinfo is None else created_dt.tzinfo)).days
                except Exception:
                    pass

            name_parts = []
            if long_tickers:
                name_parts.append(",".join(long_tickers))
            if short_tickers:
                name_parts.append(",".join(short_tickers))

            spread_meta.append({
                "spread_id": s.get("id", ""),
                "name": "/".join(name_parts),
                "theme": s.get("theme", ""),
                "asset_class": s.get("asset_class", "equities"),
                "allocation_pct": round(alloc_pct, 1),
                "current_pnl_pct": pnl_pct,
                "days_held": days_held,
            })
        except Exception as e:
            logger.warning(f"Risk: skipping spread {s.get('id')}: {e}")
            skipped.append(s.get("id", "?"))

    if not spread_return_series:
        return {"portfolio_metrics": {}, "spread_risk": [], "risk_alerts": [], "error": "No valid spread data"}

    # --- Align all return series to common dates ---
    combined = pd.concat(spread_return_series, axis=1).dropna()
    combined.columns = range(len(spread_return_series))
    n = len(spread_return_series)

    if len(combined) < 20:
        return {"portfolio_metrics": {}, "spread_risk": [], "risk_alerts": [], "error": "Insufficient overlapping data"}

    # --- Weights (normalized by allocation) ---
    raw_weights = np.array([m["allocation_pct"] for m in spread_meta])
    total_w = raw_weights.sum()
    weights = raw_weights / total_w if total_w > 0 else np.ones(n) / n

    # --- Portfolio return series (weighted sum) ---
    port_returns = combined.values @ weights
    port_series = pd.Series(port_returns, index=combined.index)

    # --- SPY returns aligned ---
    spy_ret = None
    if "SPY" in prices_df.columns:
        spy_raw = prices_df["SPY"].pct_change().dropna()
        common_spy = port_series.index.intersection(spy_raw.index)
        if len(common_spy) > 20:
            spy_ret = spy_raw.loc[common_spy]
            port_aligned = port_series.loc[common_spy]

    # --- Portfolio-level metrics ---
    risk_free = 0.043
    ann_ret = float(port_series.mean() * TRADING_DAYS)
    ann_vol = float(port_series.std() * np.sqrt(TRADING_DAYS))
    sharpe = round((ann_ret - risk_free) / ann_vol, 2) if ann_vol > 0 else 0.0

    # Beta and correlation to SPY
    beta_to_spy = None
    corr_to_spy = None
    if spy_ret is not None:
        cov_matrix_spy = np.cov(port_aligned.values, spy_ret.values)
        beta_to_spy = round(float(cov_matrix_spy[0, 1] / cov_matrix_spy[1, 1]), 3) if cov_matrix_spy[1, 1] > 0 else 0.0
        # Rolling 60-day correlation, take the last value
        rolling_corr = port_aligned.rolling(60, min_periods=20).corr(spy_ret)
        corr_to_spy = round(float(rolling_corr.iloc[-1]), 3) if not rolling_corr.empty and not np.isnan(rolling_corr.iloc[-1]) else None

    # Max drawdown
    max_dd = _max_drawdown(port_series)

    # VaR (historical simulation)
    sorted_returns = np.sort(port_series.values)
    var_95 = round(float(np.percentile(sorted_returns, 5)) * 100, 2)
    var_99 = round(float(np.percentile(sorted_returns, 1)) * 100, 2)

    portfolio_metrics = {
        "sharpe_ratio": sharpe,
        "annualized_return_pct": round(ann_ret * 100, 2),
        "annualized_vol_pct": round(ann_vol * 100, 2),
        "beta_to_spy": beta_to_spy,
        "max_drawdown_pct": max_dd,
        "var_95_pct": var_95,
        "var_99_pct": var_99,
        "correlation_to_spy": corr_to_spy,
    }

    # --- Per-spread risk attribution ---
    cov_matrix = combined.cov().values * TRADING_DAYS
    port_vol_annual = ann_vol  # already computed

    spread_risk = []
    risk_alerts = []
    mcvols = []

    for i in range(n):
        # Marginal contribution to volatility
        spread_i_returns = combined[i]
        cov_with_port = float(np.cov(spread_i_returns.values, port_series.values)[0, 1]) * TRADING_DAYS
        mcvol = (weights[i] * cov_with_port / port_vol_annual) if port_vol_annual > 0 else 0.0
        mcvols.append(mcvol)

    total_mcvol = sum(abs(m) for m in mcvols)

    for i in range(n):
        meta = spread_meta[i]
        spread_i_returns = combined[i]

        # Standalone metrics
        standalone_vol = float(spread_i_returns.std() * np.sqrt(TRADING_DAYS)) * 100
        standalone_ann_ret = float(spread_i_returns.mean() * TRADING_DAYS)
        standalone_sharpe = round((standalone_ann_ret - risk_free) / (standalone_vol / 100), 2) if standalone_vol > 0 else 0.0

        # Correlation to portfolio (excluding self for cleaner signal)
        other_weights = weights.copy()
        other_weights[i] = 0
        other_sum = other_weights.sum()
        if other_sum > 0:
            other_weights_norm = other_weights / other_sum
            other_port = combined.values @ other_weights_norm
            corr_to_port = float(np.corrcoef(spread_i_returns.values, other_port)[0, 1])
        else:
            corr_to_port = 1.0

        # Correlation to SPY
        corr_spy = None
        if spy_ret is not None:
            common_idx = spread_i_returns.index.intersection(spy_ret.index)
            if len(common_idx) > 20:
                corr_spy = float(np.corrcoef(
                    spread_i_returns.loc[common_idx].values,
                    spy_ret.loc[common_idx].values
                )[0, 1])

        # Max drawdown for this spread
        spread_dd = _max_drawdown(spread_i_returns)

        # Risk contribution %
        risk_contrib = (abs(mcvols[i]) / total_mcvol * 100) if total_mcvol > 0 else 0.0

        # Status
        status = "ok"
        if risk_contrib > 30:
            status = "warning"
        if spread_dd < -20:
            status = "warning"
        if corr_spy is not None and abs(corr_spy) > 0.3:
            status = "warning"
        if standalone_sharpe < 0 and meta.get("days_held") is not None and meta["days_held"] > 30:
            status = "critical"

        entry = {
            "spread_id": meta["spread_id"],
            "name": meta["name"],
            "theme": meta["theme"],
            "asset_class": meta["asset_class"],
            "allocation_pct": meta["allocation_pct"],
            "risk_contribution_pct": round(risk_contrib, 1),
            "marginal_vol_contribution": round(mcvols[i] * 100, 2),
            "standalone_vol_pct": round(standalone_vol, 1),
            "standalone_sharpe": standalone_sharpe,
            "correlation_to_portfolio": round(corr_to_port, 2),
            "correlation_to_spy": round(corr_spy, 3) if corr_spy is not None else None,
            "max_drawdown_pct": spread_dd,
            "current_pnl_pct": meta["current_pnl_pct"],
            "status": status,
        }
        spread_risk.append(entry)

        # --- Generate alerts ---
        if risk_contrib > 30:
            risk_alerts.append({
                "type": "high_risk_contribution",
                "spread_name": meta["name"],
                "message": f"This spread contributes {risk_contrib:.0f}% of portfolio risk but only {meta['allocation_pct']:.0f}% of allocation",
                "severity": "warning",
                "spread_id": meta["spread_id"],
            })

        if corr_spy is not None and abs(corr_spy) > 0.3:
            risk_alerts.append({
                "type": "high_spy_correlation",
                "spread_name": meta["name"],
                "message": f"Correlation to SPY is {corr_spy:.2f} — this spread adds market exposure, weakening neutrality",
                "severity": "warning",
                "spread_id": meta["spread_id"],
            })

        if spread_dd < -20:
            risk_alerts.append({
                "type": "high_drawdown",
                "spread_name": meta["name"],
                "message": f"Max drawdown is {spread_dd:.1f}% — consider reviewing thesis",
                "severity": "warning",
                "spread_id": meta["spread_id"],
            })

        if standalone_sharpe < 0 and meta.get("days_held") is not None and meta["days_held"] > 30:
            risk_alerts.append({
                "type": "negative_sharpe_long_hold",
                "spread_name": meta["name"],
                "message": f"Negative Sharpe ({standalone_sharpe}) and held {meta['days_held']} days — thesis may be broken",
                "severity": "critical",
                "spread_id": meta["spread_id"],
            })

    # Portfolio-level alerts
    if var_95 < -2.0:
        risk_alerts.append({
            "type": "high_var",
            "spread_name": "Portfolio",
            "message": f"95% daily VaR is {var_95:.1f}% — portfolio is taking on significant tail risk",
            "severity": "warning",
            "spread_id": None,
        })

    if beta_to_spy is not None and abs(beta_to_spy) > 0.1:
        risk_alerts.append({
            "type": "high_beta",
            "spread_name": "Portfolio",
            "message": f"Portfolio beta to SPY is {beta_to_spy:.3f} — not fully market neutral",
            "severity": "warning",
            "spread_id": None,
        })

    # Sort spread_risk by risk contribution descending
    spread_risk.sort(key=lambda x: x["risk_contribution_pct"], reverse=True)

    return {
        "portfolio_metrics": portfolio_metrics,
        "spread_risk": spread_risk,
        "risk_alerts": risk_alerts,
    }


@router.get("/risk")
async def portfolio_risk(user_id: str = Depends(get_current_user)):
    """
    Portfolio risk metrics + per-spread risk attribution.
    Cached for 5 minutes because it fetches prices for all spreads.
    """
    cache_key = "risk"
    if cache_key in _risk_cache:
        return _risk_cache[cache_key]

    spreads = await _get_active_spreads()
    result = _compute_risk(spreads)
    _risk_cache[cache_key] = result
    return result


@router.get("/summary", response_model=PortfolioSummary)
async def portfolio_summary(user_id: str = Depends(get_current_user)):
    """
    Calculate portfolio summary from all active spreads:
    total long/short exposure, net/gross, constraint status.
    """
    spreads = await _get_active_spreads()

    total_long = 0.0
    total_short = 0.0

    for s in spreads:
        total_long += s.get("long_leg", {}).get("allocation_pct", 0)
        total_short += s.get("short_leg", {}).get("allocation_pct", 0)

    constraints = check_constraints(spreads)

    return PortfolioSummary(
        total_long_pct=round(total_long, 2),
        total_short_pct=round(total_short, 2),
        net_exposure_pct=round(total_long - total_short, 2),
        gross_exposure_pct=round(total_long + total_short, 2),
        num_spreads=len(spreads),
        constraints=constraints,
    )


@router.get("/constraints", response_model=list[ConstraintStatus])
async def constraint_status(user_id: str = Depends(get_current_user)):
    """Just the constraint utilization bars."""
    spreads = await _get_active_spreads()
    return check_constraints(spreads)


@router.post("/check-spread")
async def check_spread_preflight(
    proposed: SpreadCreate,
    user_id: str = Depends(get_current_user),
):
    """
    Pre-flight check: if I add this spread, what happens to constraints?
    Returns constraint status with has_violations flag.
    """
    existing = await _get_active_spreads()
    proposed_dict = proposed.model_dump()
    proposed_dict["status"] = "proposed"
    constraints = check_with_proposed(existing, proposed_dict)
    has_violations = any(c.status == "violation" for c in constraints)
    return {
        "constraints": [c.model_dump() for c in constraints],
        "has_violations": has_violations,
    }


# ---------------------------------------------------------------------------
# Portfolio P&L time series
# ---------------------------------------------------------------------------

@router.get("/pnl")
async def portfolio_pnl(user_id: str = Depends(get_current_user)):
    """
    Calculate daily and cumulative P&L for the whole portfolio.
    Aggregates across all active/proposed spreads using historical prices.
    """
    spreads = await _get_active_spreads()
    if not spreads:
        return {"dates": [], "daily_pnl": [], "cumulative_pnl": [], "num_spreads": 0}

    # Collect all tickers we need prices for
    all_tickers = set()
    for s in spreads:
        all_tickers.update(s.get("long_leg", {}).get("tickers", []))
        all_tickers.update(s.get("short_leg", {}).get("tickers", []))

    if not all_tickers:
        return {"dates": [], "daily_pnl": [], "cumulative_pnl": [], "num_spreads": 0}

    try:
        prices_df = get_prices(list(all_tickers), period="1y")
    except Exception as e:
        logger.error(f"PnL price fetch failed: {e}")
        return {"dates": [], "daily_pnl": [], "cumulative_pnl": [], "error": str(e)}

    if prices_df.empty:
        return {"dates": [], "daily_pnl": [], "cumulative_pnl": [], "error": "No price data"}

    returns = prices_df.pct_change().dropna()
    if returns.empty:
        return {"dates": [], "daily_pnl": [], "cumulative_pnl": [], "error": "Insufficient data"}

    # Aggregate weighted returns across all spreads
    portfolio_daily = pd.Series(0.0, index=returns.index)

    for s in spreads:
        long_leg = s.get("long_leg", {})
        short_leg = s.get("short_leg", {})
        long_alloc = long_leg.get("allocation_pct", 0) / 100.0  # convert to decimal
        short_alloc = short_leg.get("allocation_pct", 0) / 100.0

        # Long leg contribution
        for ticker, weight in zip(long_leg.get("tickers", []), long_leg.get("weights", [])):
            if ticker in returns.columns:
                portfolio_daily += returns[ticker] * weight * long_alloc

        # Short leg contribution (profit when price goes down)
        for ticker, weight in zip(short_leg.get("tickers", []), short_leg.get("weights", [])):
            if ticker in returns.columns:
                portfolio_daily -= returns[ticker] * weight * short_alloc

    cumulative = portfolio_daily.cumsum()
    dates = [d.strftime("%Y-%m-%d") for d in portfolio_daily.index]

    return {
        "dates": dates,
        "daily_pnl": [round(float(v) * 100, 4) for v in portfolio_daily.values],
        "cumulative_pnl": [round(float(v) * 100, 4) for v in cumulative.values],
        "num_spreads": len(spreads),
    }


# ---------------------------------------------------------------------------
# Portfolio Optimization (Sharpe maximization)
# ---------------------------------------------------------------------------

@router.get("/optimize")
async def portfolio_optimize(user_id: str = Depends(get_current_user)):
    """
    Run mean-variance optimization on active spreads.
    Maximizes portfolio Sharpe ratio by adjusting spread weights.
    Returns current vs optimal weights and rebalance suggestions.
    """
    spreads = await _get_active_spreads()
    if len(spreads) < 2:
        return {
            "error": "Need at least 2 active spreads to optimize",
            "num_spreads": len(spreads),
        }

    # Build return series for each spread
    spread_names = []
    spread_returns = []
    current_weights = []
    total_alloc = 0.0

    for s in spreads:
        long_leg = s.get("long_leg", {})
        short_leg = s.get("short_leg", {})
        long_tickers = long_leg.get("tickers", [])
        short_tickers = short_leg.get("tickers", [])
        all_tickers = long_tickers + short_tickers

        if not all_tickers:
            continue

        try:
            prices_df = get_prices(all_tickers, period="1y")
            if prices_df.empty:
                continue

            long_weights = long_leg.get("weights", [1.0 / max(len(long_tickers), 1)] * len(long_tickers))
            short_weights = short_leg.get("weights", [1.0 / max(len(short_tickers), 1)] * len(short_tickers))

            pair_ret = calculate_pair_returns(
                prices_df, long_tickers, long_weights, short_tickers, short_weights
            )

            if len(pair_ret.dropna()) < 20:
                continue

            spread_names.append(s.get("theme", f"{long_tickers[0]}/{short_tickers[0]}"))
            spread_returns.append(pair_ret)
            alloc = (long_leg.get("allocation_pct", 0) + short_leg.get("allocation_pct", 0)) / 2
            current_weights.append(alloc)
            total_alloc += alloc

        except Exception as e:
            logger.warning(f"Optimize: skipping spread {s.get('id')}: {e}")
            continue

    if len(spread_returns) < 2:
        return {
            "error": "Not enough spreads with valid price data to optimize",
            "num_spreads": len(spreads),
        }

    # Normalize current weights to sum to 1
    if total_alloc > 0:
        current_weights = [w / total_alloc for w in current_weights]
    else:
        current_weights = [1.0 / len(current_weights)] * len(current_weights)

    # Align all return series to common dates
    combined = pd.concat(spread_returns, axis=1).dropna()
    combined.columns = range(len(spread_returns))

    if len(combined) < 20:
        return {"error": "Insufficient overlapping data for optimization"}

    n = len(spread_returns)
    mean_returns = combined.mean().values * TRADING_DAYS
    cov_matrix = combined.cov().values * TRADING_DAYS
    risk_free = 0.043

    def neg_sharpe(weights):
        port_ret = np.dot(weights, mean_returns)
        port_vol = np.sqrt(np.dot(weights.T, np.dot(cov_matrix, weights)))
        if port_vol == 0:
            return 0
        return -(port_ret - risk_free) / port_vol

    # Constraints: weights sum to 1, each between 5% and 40%
    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
    bounds = [(0.05, 0.40)] * n

    # Start from equal weights
    x0 = np.array([1.0 / n] * n)

    try:
        result = minimize(
            neg_sharpe, x0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 1000},
        )

        if not result.success:
            logger.warning(f"Optimization did not converge: {result.message}")

        optimal_weights = result.x.tolist()
    except Exception as e:
        logger.error(f"Optimization failed: {e}")
        return {"error": f"Optimization failed: {e}"}

    # Calculate Sharpe for current and optimal
    def calc_sharpe(weights):
        w = np.array(weights)
        port_ret = np.dot(w, mean_returns)
        port_vol = np.sqrt(np.dot(w.T, np.dot(cov_matrix, w)))
        return round((port_ret - risk_free) / port_vol, 3) if port_vol > 0 else 0.0

    current_sharpe = calc_sharpe(current_weights)
    optimal_sharpe = calc_sharpe(optimal_weights)

    # Build rebalance suggestions
    rebalance = []
    for i, name in enumerate(spread_names):
        current_pct = round(current_weights[i] * 100, 1)
        optimal_pct = round(optimal_weights[i] * 100, 1)
        delta = round(optimal_pct - current_pct, 1)
        if abs(delta) > 1.0:
            action = "increase" if delta > 0 else "decrease"
            rebalance.append({
                "spread": name,
                "current_weight_pct": current_pct,
                "optimal_weight_pct": optimal_pct,
                "change_pct": delta,
                "action": f"{action} by {abs(delta):.1f}pp",
            })

    return {
        "spreads": spread_names,
        "current_weights": [round(w * 100, 1) for w in current_weights],
        "optimal_weights": [round(w * 100, 1) for w in optimal_weights],
        "current_sharpe": current_sharpe,
        "optimal_sharpe": optimal_sharpe,
        "rebalance_suggestions": rebalance,
        "num_spreads": len(spread_names),
    }
