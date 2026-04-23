from __future__ import annotations

"""
P&L computation from StockTrak snapshots.

Computes:
- Total P&L in dollars and percent
- P&L by theme and asset class
- Period breakdowns: WTD, MTD, TTD (term-to-date since 3/31)
- Daily NAV time series from snapshot history
"""

from datetime import date, datetime, timedelta
import logging

logger = logging.getLogger(__name__)

# Term start date — first day of StockTrak simulation
TERM_START = date(2026, 3, 31)
INITIAL_PORTFOLIO_VALUE = 1_000_000.0


def _parse_date(d) -> date | None:
    """Parse a date from various formats."""
    if isinstance(d, date):
        return d
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, str):
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
            try:
                return datetime.strptime(d.strip(), fmt).date()
            except ValueError:
                continue
    return None


def _week_start(d: date) -> date:
    """Monday of the given date's week."""
    return d - timedelta(days=d.weekday())


def compute_pnl_from_snapshot(snapshot: dict) -> dict:
    """
    Given a single snapshot (positions + summary), compute P&L metrics.

    Returns dict with total_pnl, pnl_pct, breakdown by theme and asset class.
    """
    positions = snapshot.get("positions", [])
    summary = snapshot.get("summary", {})
    portfolio_value = summary.get("portfolio_value", 0) or INITIAL_PORTFOLIO_VALUE

    total_pnl = sum(p.get("profit_loss", 0) for p in positions)
    total_cost = sum(
        abs(p.get("quantity", 0)) * p.get("price_paid", 0)
        for p in positions
    )
    pnl_pct = (total_pnl / total_cost * 100) if total_cost > 0 else 0.0

    # By theme
    theme_pnl: dict[str, dict] = {}
    for p in positions:
        theme = p.get("theme", "Other")
        if theme not in theme_pnl:
            theme_pnl[theme] = {"pnl": 0.0, "market_value": 0.0, "cost_basis": 0.0}
        theme_pnl[theme]["pnl"] += p.get("profit_loss", 0)
        theme_pnl[theme]["market_value"] += p.get("market_value", 0)
        cost = abs(p.get("quantity", 0)) * p.get("price_paid", 0)
        theme_pnl[theme]["cost_basis"] += cost

    pnl_by_theme = []
    for theme, data in sorted(theme_pnl.items(), key=lambda x: abs(x[1]["pnl"]), reverse=True):
        pnl_pct_theme = (data["pnl"] / data["cost_basis"] * 100) if data["cost_basis"] > 0 else 0.0
        pnl_by_theme.append({
            "theme": theme,
            "pnl": round(data["pnl"], 2),
            "pnl_pct": round(pnl_pct_theme, 2),
            "market_value": round(data["market_value"], 2),
        })

    # By asset class
    class_pnl: dict[str, dict] = {}
    for p in positions:
        ac = p.get("asset_class", "equity")
        if ac not in class_pnl:
            class_pnl[ac] = {"pnl": 0.0, "market_value": 0.0}
        class_pnl[ac]["pnl"] += p.get("profit_loss", 0)
        class_pnl[ac]["market_value"] += p.get("market_value", 0)

    pnl_by_asset_class = [
        {"asset_class": ac, "pnl": round(data["pnl"], 2), "market_value": round(data["market_value"], 2)}
        for ac, data in sorted(class_pnl.items(), key=lambda x: abs(x[1]["pnl"]), reverse=True)
    ]

    return {
        "portfolio_value": round(portfolio_value, 2),
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round(pnl_pct, 2),
        "pnl_by_theme": pnl_by_theme,
        "pnl_by_asset_class": pnl_by_asset_class,
    }


def compute_period_pnl(snapshots: list[dict]) -> dict:
    """
    Given multiple snapshots ordered by date, compute period P&L:
    WTD (week-to-date), MTD (month-to-date), TTD (term-to-date since 3/31).
    """
    if not snapshots:
        return {"wtd": 0.0, "mtd": 0.0, "ttd": 0.0}

    # Sort by upload_date
    sorted_snaps = sorted(snapshots, key=lambda s: s.get("upload_date", ""))
    latest = sorted_snaps[-1]
    latest_value = latest.get("portfolio_value", INITIAL_PORTFOLIO_VALUE)
    latest_date = _parse_date(latest.get("upload_date")) or date.today()

    def _find_value_at_or_before(target: date) -> float:
        """Find portfolio value from the snapshot at or just before target date."""
        best = None
        for snap in sorted_snaps:
            snap_date = _parse_date(snap.get("upload_date"))
            if snap_date and snap_date <= target:
                best = snap
        if best:
            return best.get("portfolio_value", INITIAL_PORTFOLIO_VALUE)
        return INITIAL_PORTFOLIO_VALUE

    # WTD: from Monday of current week
    wtd_start = _week_start(latest_date)
    wtd_base = _find_value_at_or_before(wtd_start - timedelta(days=1))
    wtd = ((latest_value - wtd_base) / wtd_base * 100) if wtd_base > 0 else 0.0

    # MTD: from 1st of current month
    mtd_start = latest_date.replace(day=1)
    mtd_base = _find_value_at_or_before(mtd_start - timedelta(days=1))
    mtd = ((latest_value - mtd_base) / mtd_base * 100) if mtd_base > 0 else 0.0

    # TTD: from term start (3/31)
    ttd = ((latest_value - INITIAL_PORTFOLIO_VALUE) / INITIAL_PORTFOLIO_VALUE * 100)

    return {
        "wtd": round(wtd, 2),
        "mtd": round(mtd, 2),
        "ttd": round(ttd, 2),
    }


def build_nav_series(snapshots: list[dict]) -> list[dict]:
    """
    Build a daily NAV time series from snapshots.
    Each point: { date, value }
    """
    if not snapshots:
        return []

    sorted_snaps = sorted(snapshots, key=lambda s: s.get("upload_date", ""))
    nav = []

    for snap in sorted_snaps:
        snap_date = snap.get("upload_date", "")
        value = snap.get("portfolio_value", 0)
        if snap_date and value:
            nav.append({"date": snap_date, "value": round(value, 2)})

    return nav
