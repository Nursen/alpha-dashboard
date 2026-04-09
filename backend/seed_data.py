"""
Seed script — populates the database with the 8 current pairs from the mandate.
Works with both MongoDB and JSON file fallback.
Run: python seed_data.py
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

SEED_SPREADS = [
    {
        "asset_class": "equities",
        "theme": "EV Value Reversion",
        "thesis": "EV valuations normalizing; XPEV cheaper but similar growth profile to TSLA",
        "long_leg": {"tickers": ["XPEV"], "weights": [1.0], "allocation_pct": 10.0},
        "short_leg": {"tickers": ["TSLA"], "weights": [1.0], "allocation_pct": 10.0},
        "entry_date": "2026-03-31",
        "stop_loss_pct": -50.0,
    },
    {
        "asset_class": "equities",
        "theme": "Fintech Disruption",
        "thesis": "Fintech disrupting legacy industrial; BILL growth undervalued vs G",
        "long_leg": {"tickers": ["BILL"], "weights": [1.0], "allocation_pct": 4.0},
        "short_leg": {"tickers": ["G"], "weights": [1.0], "allocation_pct": 4.0},
        "entry_date": "2026-03-31",
        "stop_loss_pct": -50.0,
    },
    {
        "asset_class": "equities",
        "theme": "European Defense Premium",
        "thesis": "European defense spending increase benefits EUAD vs broad US defense ITA",
        "long_leg": {"tickers": ["EUAD"], "weights": [1.0], "allocation_pct": 5.0},
        "short_leg": {"tickers": ["ITA"], "weights": [1.0], "allocation_pct": 5.0},
        "entry_date": "2026-03-31",
        "stop_loss_pct": -50.0,
    },
    {
        "asset_class": "equities",
        "theme": "EV Supply Chain",
        "thesis": "Lithium/EV supply chain secular growth vs legacy auto parts",
        "long_leg": {"tickers": ["LIT"], "weights": [1.0], "allocation_pct": 4.0},
        "short_leg": {"tickers": ["LKQ"], "weights": [1.0], "allocation_pct": 4.0},
        "entry_date": "2026-03-31",
        "stop_loss_pct": -50.0,
    },
    {
        "asset_class": "equities",
        "theme": "Hardware OEM Divergence",
        "thesis": "DELL AI/server cycle outperformance vs HPQ PC-only exposure",
        "long_leg": {"tickers": ["DELL"], "weights": [1.0], "allocation_pct": 10.0},
        "short_leg": {"tickers": ["HPQ"], "weights": [1.0], "allocation_pct": 10.0},
        "entry_date": "2026-03-31",
        "stop_loss_pct": -50.0,
    },
    {
        "asset_class": "bonds",
        "theme": "Real Yields Attractive",
        "thesis": "TIPS outperform long Treasuries as real yields stay elevated",
        "long_leg": {"tickers": ["TIP"], "weights": [1.0], "allocation_pct": 15.0},
        "short_leg": {"tickers": ["TLT"], "weights": [1.0], "allocation_pct": 15.0},
        "entry_date": "2026-03-31",
        "stop_loss_pct": -50.0,
    },
    {
        "asset_class": "commodities",
        "theme": "Monetary Uncertainty",
        "thesis": "Gold outperforms silver in risk-off / monetary uncertainty environment",
        "long_leg": {"tickers": ["GLD"], "weights": [1.0], "allocation_pct": 10.0},
        "short_leg": {"tickers": ["SLV"], "weights": [1.0], "allocation_pct": 5.0},
        "entry_date": "2026-03-31",
        "stop_loss_pct": -50.0,
    },
    {
        "asset_class": "fx",
        "theme": "Interest Rate Differential",
        "thesis": "USD strength vs JPY on rate differential; BOJ behind Fed",
        "long_leg": {"tickers": ["UUP"], "weights": [1.0], "allocation_pct": 10.0},
        "short_leg": {"tickers": ["FXY"], "weights": [1.0], "allocation_pct": 10.0},
        "entry_date": "2026-03-31",
        "stop_loss_pct": -50.0,
    },
]


def seed_json():
    """Seed using JSON file store (no MongoDB needed)."""
    data_dir = Path(__file__).parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    spreads = []
    for spread in SEED_SPREADS:
        doc = dict(spread)
        doc.update({
            "_id": str(uuid.uuid4()),
            "status": "active",
            "created_by": "seed-script",
            "created_at": "2026-03-31T00:00:00+00:00",
            "entry_prices": {},
            "current_prices": None,
            "pnl_pct": None,
            "notes": [],
        })
        spreads.append(doc)

    with open(data_dir / "spreads.json", "w") as f:
        json.dump(spreads, f, indent=2, default=str)

    print(f"Seeded {len(spreads)} spreads to {data_dir / 'spreads.json'}:")
    for s in spreads:
        long_t = s["long_leg"]["tickers"][0]
        short_t = s["short_leg"]["tickers"][0]
        alloc = s["long_leg"]["allocation_pct"]
        print(f"  {long_t}/{short_t} ({s['asset_class']}, {alloc}%, \"{s['theme']}\")")


async def seed_mongo():
    """Seed using MongoDB."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from config import MONGODB_URI, DB_NAME

    client = AsyncIOMotorClient(MONGODB_URI)
    db = client[DB_NAME]

    deleted = await db.spreads.delete_many({})
    print(f"Cleared {deleted.deleted_count} existing spreads")

    docs = []
    for spread in SEED_SPREADS:
        doc = dict(spread)
        doc.update({
            "status": "active",
            "created_by": "seed-script",
            "created_at": datetime(2026, 3, 31, tzinfo=timezone.utc),
            "entry_prices": {},
            "current_prices": None,
            "pnl_pct": None,
            "notes": [],
        })
        docs.append(doc)

    result = await db.spreads.insert_many(docs)
    print(f"Inserted {len(result.inserted_ids)} spreads")
    client.close()


if __name__ == "__main__":
    # Try MongoDB first, fall back to JSON
    try:
        from config import MONGODB_URI
        from motor.motor_asyncio import AsyncIOMotorClient
        asyncio.run(seed_mongo())
    except Exception as e:
        print(f"MongoDB unavailable ({e}), seeding to JSON file...")
        seed_json()

    print("\nSeed complete!")
