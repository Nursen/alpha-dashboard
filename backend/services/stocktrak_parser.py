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
from datetime import date, datetime


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


def parse_trade_notes(csv_text: str) -> list[dict]:
    """
    Parse StockTrak TradeNotes CSV.

    Returns list of trade dicts with extracted pair relationships,
    IC decisions, and corrections.
    """
    reader = csv.DictReader(io.StringIO(csv_text))
    trades: list[dict] = []

    for row in reader:
        symbol = row.get("Symbol", "").strip()
        if not symbol:
            continue

        raw_side = row.get("OrderSide", "").strip()
        note = row.get("Note", "").strip().strip('"')
        trade_date_str = row.get("TradeDate", "").strip()

        # Parse date
        trade_date = None
        for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M:%S %p", "%Y-%m-%d"):
            try:
                trade_date = datetime.strptime(trade_date_str, fmt)
                break
            except (ValueError, TypeError):
                continue

        # Normalize side
        side = raw_side.lower().strip()

        # Extract pair symbol from note text
        pair_symbol = _extract_pair_symbol(note, symbol)

        # Flag IC rejections
        note_lower = note.lower()
        ic_rejected = any(phrase in note_lower for phrase in [
            "did not pass ic", "not approved by ic", "not covered by ic",
        ])

        # Flag corrections / wrong trades
        is_correction = any(phrase in note_lower for phrase in [
            "wrong trade", "wrong stock",
        ])

        # Infer theme from symbol or note
        theme = _get_theme(symbol)
        if theme == "Other":
            theme = _infer_theme_from_note(note)

        trades.append({
            "trade_date": trade_date.isoformat() if trade_date else trade_date_str,
            "symbol": symbol,
            "side": side,
            "note": note,
            "pair_symbol": pair_symbol,
            "theme": theme,
            "ic_rejected": ic_rejected,
            "is_correction": is_correction,
            "asset_class": _classify_position(symbol),
        })

    return trades


def _extract_pair_symbol(note: str, own_symbol: str) -> str | None:
    """Extract the paired ticker from a trade note."""
    if not note:
        return None

    note_upper = note.upper()

    # Pattern: "Paired with long BILL" or "Paired with short G"
    m = re.search(r"PAIRED?\s+(?:TRADE\s+)?WITH\s+(?:LONG|SHORT)?\s*([A-Z]{1,5})", note_upper)
    if m:
        sym = m.group(1)
        if sym != own_symbol.upper():
            return sym

    # Pattern: "pair trade with tesla" — resolve common names to tickers
    m = re.search(r"PAIR\s+TRADE\s+WITH\s+(\w+)", note_upper)
    if m:
        name = m.group(1)
        resolved = _resolve_name_to_ticker(name)
        if resolved and resolved != own_symbol.upper():
            return resolved

    # Pattern: "EUAD long / ITA short" or "XPEV/TSLA pair"
    m = re.search(r"([A-Z]{2,6})\s*(?:LONG|SHORT)?\s*/\s*([A-Z]{2,6})\s*(?:LONG|SHORT)?", note_upper)
    if m:
        t1, t2 = m.group(1), m.group(2)
        if t1 == own_symbol.upper():
            return t2
        if t2 == own_symbol.upper():
            return t1

    # Pattern: "Paired with long BILL." at end
    m = re.search(r"PAIRED?\s+WITH\s+(?:LONG|SHORT)\s+([A-Z]{1,6})", note_upper)
    if m:
        sym = m.group(1)
        if sym != own_symbol.upper():
            return sym

    return None


_NAME_TO_TICKER = {
    "TESLA": "TSLA", "XPENG": "XPEV", "DELL": "DELL", "APPLE": "AAPL",
    "GOOGLE": "GOOG", "MICROSOFT": "MSFT", "AMAZON": "AMZN",
}


def _resolve_name_to_ticker(name: str) -> str | None:
    """Resolve a company name to its ticker."""
    upper = name.upper()
    if upper in _NAME_TO_TICKER:
        return _NAME_TO_TICKER[upper]
    # If it's already a short uppercase string, treat as ticker
    if len(upper) <= 5 and upper.isalpha():
        return upper
    return None


# Theme keywords found in notes
_THEME_KEYWORDS = {
    "Defense": ["defense", "nato", "lockheed", "rtx", "northrop"],
    "AI Billing": ["ai automation", "billing", "bpo", "back-office"],
    "EV / Auto": ["ev ", "electric vehicle", "battery", "lithium", "ice vehicle", "auto part"],
    "Healthcare / Beauty": ["glp-1", "mounjaro", "zepbound", "beauty", "cosmetic", "tiktok", "morpheus"],
    "Chemicals": ["chemical", "industrial gas"],
    "Logistics": ["logistics", "fedex", "ups"],
    "Tech Hardware": ["dell", "hpe", "hpq"],
    "Bonds / Rates": ["inflation", "interest rate", "tips", "treasury"],
    "Volatility": ["volatility", "straddle", "strangle"],
    "Alternatives": ["bdc", "alternatives", "private credit"],
    "Emerging Markets": ["india", "vietnam", "emerging"],
}


def _infer_theme_from_note(note: str) -> str:
    """Try to infer theme from note text using keyword matching."""
    if not note:
        return "Other"
    note_lower = note.lower()
    for theme, keywords in _THEME_KEYWORDS.items():
        if any(kw in note_lower for kw in keywords):
            return theme
    return "Other"


def extract_spreads(trades: list[dict]) -> list[dict]:
    """
    From parsed trade notes, extract unique spread/pair relationships.

    Returns list of dicts: {long_symbol, short_symbol, theme, notes}
    """
    # Build a map of symbol -> trades that mention a pair
    pairs: dict[tuple[str, str], dict] = {}

    for t in trades:
        if not t.get("pair_symbol"):
            continue

        sym = t["symbol"]
        pair = t["pair_symbol"]

        # Determine which is long and which is short
        if t["side"] in ("buy",):
            long_sym, short_sym = sym, pair
        elif t["side"] in ("short",):
            long_sym, short_sym = pair, sym
        else:
            continue

        key = tuple(sorted([long_sym, short_sym]))
        if key not in pairs:
            pairs[key] = {
                "long_symbol": long_sym,
                "short_symbol": short_sym,
                "theme": t["theme"],
                "notes": [],
                "first_trade": t["trade_date"],
            }

        if t["note"] and t["note"] not in pairs[key]["notes"]:
            pairs[key]["notes"].append(t["note"])

    return list(pairs.values())


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
