"""
Constraint checker for the Multi-Asset Market Neutral Fund mandate.

Works standalone (accepts spread dicts directly) so it can be tested
without MongoDB. Constraints from Fund_Mandate_Strategy.md:
  - Net equity exposure: +/- 10%
  - Max single position: 10%
  - Max sector: 25%
  - Max gross leverage: 120%
"""

from models.portfolio import ConstraintStatus


# Mandate constraints
CONSTRAINTS = {
    "net_equity_exposure": {"limit": 10.0, "description": "Net Equity Exposure (%)"},
    "max_single_position": {"limit": 10.0, "description": "Max Single Position (%)"},
    "max_sector": {"limit": 25.0, "description": "Max Sector Concentration (%)"},
    "max_gross_leverage": {"limit": 120.0, "description": "Gross Leverage (%)"},
}


def _status_from_utilization(util_pct: float) -> str:
    if util_pct >= 100:
        return "violation"
    elif util_pct >= 80:
        return "warning"
    return "ok"


def _calc_exposures(spreads: list[dict]) -> dict:
    """
    Calculate portfolio exposure metrics from a list of spread dicts.
    Each spread has long_leg and short_leg with allocation_pct and tickers.
    Only considers active/proposed spreads.
    """
    total_long = 0.0
    total_short = 0.0
    positions = {}  # ticker -> net allocation
    sector_exposure = {}  # asset_class -> gross allocation

    for s in spreads:
        if s.get("status", "active") == "closed":
            continue

        long_leg = s.get("long_leg", {})
        short_leg = s.get("short_leg", {})
        asset_class = s.get("asset_class", "equities")

        long_alloc = long_leg.get("allocation_pct", 0)
        short_alloc = short_leg.get("allocation_pct", 0)

        total_long += long_alloc
        total_short += short_alloc

        # Track individual position sizes
        for ticker, weight in zip(
            long_leg.get("tickers", []), long_leg.get("weights", [])
        ):
            alloc = long_alloc * weight
            positions[ticker] = positions.get(ticker, 0) + alloc

        for ticker, weight in zip(
            short_leg.get("tickers", []), short_leg.get("weights", [])
        ):
            alloc = short_alloc * weight
            positions[ticker] = positions.get(ticker, 0) + alloc

        # Sector = asset_class for our purposes
        gross = long_alloc + short_alloc
        sector_exposure[asset_class] = sector_exposure.get(asset_class, 0) + gross

    return {
        "total_long": total_long,
        "total_short": total_short,
        "net_exposure": total_long - total_short,
        "gross_exposure": total_long + total_short,
        "max_single_position": max(positions.values()) if positions else 0,
        "max_sector": max(sector_exposure.values()) if sector_exposure else 0,
        "positions": positions,
        "sector_exposure": sector_exposure,
    }


def check_constraints(spreads: list[dict]) -> list[ConstraintStatus]:
    """Check all mandate constraints against current spreads."""
    exp = _calc_exposures(spreads)

    results = []

    # 1. Net equity exposure (+/- 10%)
    # Only count equities for this constraint
    equity_spreads = [s for s in spreads if s.get("asset_class") == "equities" and s.get("status") != "closed"]
    eq_long = sum(s.get("long_leg", {}).get("allocation_pct", 0) for s in equity_spreads)
    eq_short = sum(s.get("short_leg", {}).get("allocation_pct", 0) for s in equity_spreads)
    net_eq = abs(eq_long - eq_short)
    limit = CONSTRAINTS["net_equity_exposure"]["limit"]
    util = (net_eq / limit * 100) if limit > 0 else 0
    results.append(ConstraintStatus(
        name="Net Equity Exposure",
        current_value=round(eq_long - eq_short, 2),
        limit=limit,
        utilization_pct=round(util, 1),
        status=_status_from_utilization(util),
    ))

    # 2. Max single position
    max_pos = exp["max_single_position"]
    limit = CONSTRAINTS["max_single_position"]["limit"]
    util = (max_pos / limit * 100) if limit > 0 else 0
    results.append(ConstraintStatus(
        name="Max Single Position",
        current_value=round(max_pos, 2),
        limit=limit,
        utilization_pct=round(util, 1),
        status=_status_from_utilization(util),
    ))

    # 3. Max sector concentration
    max_sec = exp["max_sector"]
    limit = CONSTRAINTS["max_sector"]["limit"]
    util = (max_sec / limit * 100) if limit > 0 else 0
    results.append(ConstraintStatus(
        name="Max Sector Concentration",
        current_value=round(max_sec, 2),
        limit=limit,
        utilization_pct=round(util, 1),
        status=_status_from_utilization(util),
    ))

    # 4. Gross leverage
    gross = exp["gross_exposure"]
    limit = CONSTRAINTS["max_gross_leverage"]["limit"]
    util = (gross / limit * 100) if limit > 0 else 0
    results.append(ConstraintStatus(
        name="Gross Leverage",
        current_value=round(gross, 2),
        limit=limit,
        utilization_pct=round(util, 1),
        status=_status_from_utilization(util),
    ))

    return results


def check_with_proposed(
    existing_spreads: list[dict], proposed: dict
) -> list[ConstraintStatus]:
    """
    Pre-flight check: what happens to constraints if we add this spread?
    Accepts proposed as a dict (from SpreadCreate.model_dump()).
    """
    all_spreads = existing_spreads + [proposed]
    return check_constraints(all_spreads)
