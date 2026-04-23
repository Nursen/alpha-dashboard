from __future__ import annotations

"""
StockTrak CSV parser — handles OpenPosition and PortfolioSummary exports.

Edge cases:
- Quoted numbers with commas: "$19,823.73" or "1,643.39"
- Negative quantities = short positions
- Options tickers: NVDA2629E200 (ticker + expiry + strike)
- FX pairs: EUR/NOK
- Futures: BZ/U6, HO/U6
"""

import csv
import io
import re
from datetime import date


# ---------------------------------------------------------------------------
# Theme mapping — assigns each ticker to an investment theme
# ---------------------------------------------------------------------------

THEME_MAP: dict[str, list[str]] = {
    "AI Billing": ["BILL", "INTU", "G", "CNDT"],
    "Defense": ["EUAD", "EADSF", "ITA"],
    "EV / Auto": ["XPEV", "TSLA", "IDRV", "LIT", "SMP", "LKQ"],
    "Healthcare / Beauty": ["LLY", "AMGN", "INMD", "ELF", "BBWI", "WW", "VEEV", "DOCS", "TTEC"],
    "Chemicals": ["AIQUY", "APD", "LIN", "BASFY", "EVKIY", "SLVYY", "XOM"],
    "Logistics": ["FDX", "UPS", "XLI"],
    "Tech Hardware": ["DELL", "HPE", "HPQ"],
    "Emerging Markets": ["INDA", "VNM", "MCHI", "VWO"],
    "Alternatives": ["BX", "OBDC"],
    "Bonds / Rates": ["TIP", "TLT"],
    "Robotics": ["ROBO"],
    "Trade Schools": ["UTI", "CHGG"],
    "Volatility": ["NVDA"],  # options on NVDA
    "FX": ["EUR/NOK", "USD/JPY"],
    "Commodities": ["BZ/U6", "HO/U6"],
}

# Invert: ticker -> theme
_TICKER_TO_THEME: dict[str, str] = {}
for theme, tickers in THEME_MAP.items():
    for t in tickers:
        _TICKER_TO_THEME[t] = theme


def _clean_number(s: str) -> float:
    """Parse numbers that may be quoted, have commas, dollar signs, or % signs."""
    if not s or not s.strip():
        return 0.0
    s = s.strip().strip('"').strip("$").strip("%").replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _classify_position(symbol: str) -> str:
    """Classify a StockTrak position by asset type."""
    # FX pairs contain / and a currency code
    if "/" in symbol:
        parts = symbol.split("/")
        # Futures: second part is a month+year code like U6, F7
        if len(parts) == 2 and re.match(r"^[A-Z]\d$", parts[1]):
            return "futures"
        # FX: both parts are 3-letter currency codes
        if all(re.match(r"^[A-Z]{3}$", p) for p in parts):
            return "fx"
        # Default for slash-containing symbols
        return "futures"

    # Options: ticker followed by digits and a letter code (e.g. NVDA2629E200)
    if re.match(r"^[A-Z]+\d{4,}[A-Z]\d+$", symbol):
        return "option"

    # ETFs we know about
    etfs = {
        "EUAD", "ITA", "IDRV", "LIT", "INDA", "VNM", "MCHI", "VWO",
        "TIP", "TLT", "ROBO", "XLI", "GLD", "SLV", "UUP", "FXY",
    }
    if symbol in etfs:
        return "etf"

    return "equity"


def _get_theme(symbol: str) -> str:
    """Look up theme for a symbol. For options, strip to base ticker."""
    if symbol in _TICKER_TO_THEME:
        return _TICKER_TO_THEME[symbol]

    # Options: extract base ticker (e.g., NVDA2629E200 -> NVDA)
    match = re.match(r"^([A-Z]+)\d", symbol)
    if match:
        base = match.group(1)
        if base in _TICKER_TO_THEME:
            return _TICKER_TO_THEME[base]

    return "Other"


def parse_open_positions(csv_text: str) -> list[dict]:
    """
    Parse StockTrak OpenPosition CSV.

    Returns list of position dicts with standardized fields.
    """
    reader = csv.DictReader(io.StringIO(csv_text))
    positions = []

    for row in reader:
        symbol = row.get("Symbol", "").strip()
        if not symbol:
            continue

        quantity = _clean_number(row.get("Quantity", "0"))
        last_price = _clean_number(row.get("LastPrice", "0"))
        price_paid = _clean_number(row.get("PricePaid", "0"))
        day_change = _clean_number(row.get("DayChange", "0"))
        profit_loss = _clean_number(row.get("ProfitLoss", "0"))
        market_value = _clean_number(row.get("MarketValue", "0"))
        pnl_pct = _clean_number(row.get("ProfitLossPercentage", "0"))

        positions.append({
            "symbol": symbol,
            "description": row.get("Description", "").strip(),
            "quantity": quantity,
            "currency": row.get("Currency", "USD").strip(),
            "last_price": last_price,
            "price_paid": price_paid,
            "day_change": day_change,
            "profit_loss": profit_loss,
            "market_value": market_value,
            "pnl_pct": pnl_pct,
            "side": "short" if quantity < 0 else "long",
            "asset_class": _classify_position(symbol),
            "theme": _get_theme(symbol),
        })

    return positions


def parse_portfolio_summary(csv_text: str) -> dict:
    """
    Parse StockTrak PortfolioSummary CSV.

    The format is a key-value grid, not a standard tabular CSV.
    """
    result = {
        "date": None,
        "cash_balance": 0.0,
        "short_sale_proceeds": 0.0,
        "loan_balance": 0.0,
        "market_value_long": 0.0,
        "market_value_short": 0.0,
        "net_market_value": 0.0,
        "portfolio_value": 0.0,
        "percentage_return": 0.0,
        "buying_power": 0.0,
        "trades_made": 0,
        "trades_allowed": 0,
        "futures_mark_to_market": 0.0,
    }

    lines = csv_text.strip().split("\n")
    for line in lines:
        # Split on comma but respect quoted values
        parts = list(csv.reader(io.StringIO(line)))[0] if line.strip() else []
        text = line.lower()

        for i, part in enumerate(parts):
            part_lower = part.strip().lower().rstrip(":")

            if part_lower == "date" and i + 1 < len(parts):
                result["date"] = parts[i + 1].strip()

            elif "cash balance" in part_lower and i + 1 < len(parts):
                result["cash_balance"] = _clean_number(parts[i + 1])

            elif "short sale proceeds" in part_lower and i + 1 < len(parts):
                result["short_sale_proceeds"] = _clean_number(parts[i + 1])

            elif "loan balance" in part_lower and i + 1 < len(parts):
                result["loan_balance"] = _clean_number(parts[i + 1])

            elif "market value of long" in part_lower and i + 1 < len(parts):
                result["market_value_long"] = _clean_number(parts[i + 1])

            elif "market value of short" in part_lower and i + 1 < len(parts):
                result["market_value_short"] = _clean_number(parts[i + 1])

            elif "net" in part_lower and "market value" in part_lower and i + 1 < len(parts):
                result["net_market_value"] = _clean_number(parts[i + 1])

            elif "portfolio value" in part_lower and i + 1 < len(parts):
                result["portfolio_value"] = _clean_number(parts[i + 1])

            elif "percentage return" in part_lower and i + 1 < len(parts):
                result["percentage_return"] = _clean_number(parts[i + 1])

            elif "buying power" in part_lower and i + 1 < len(parts):
                result["buying_power"] = _clean_number(parts[i + 1])

            elif "trades made" in part_lower and i + 1 < len(parts):
                trades_str = parts[i + 1].strip()
                if "/" in trades_str:
                    made, allowed = trades_str.split("/")
                    result["trades_made"] = int(made.strip())
                    result["trades_allowed"] = int(allowed.strip())

            elif "futures" in part_lower and "mark to market" in part_lower and i + 1 < len(parts):
                result["futures_mark_to_market"] = _clean_number(parts[i + 1])

    return result
