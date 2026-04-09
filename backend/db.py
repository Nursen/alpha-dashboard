"""
Database layer — uses MongoDB if available, falls back to local JSON file store.
"""
import json
import os
import uuid
from pathlib import Path
from datetime import datetime, timezone

MONGODB_AVAILABLE = False
DATA_DIR = Path(__file__).parent / "data"
DATA_FILE = DATA_DIR / "spreads.json"

# Try MongoDB first
try:
    from motor.motor_asyncio import AsyncIOMotorClient
    from config import MONGODB_URI, DB_NAME
    MONGODB_AVAILABLE = True
except Exception:
    pass

client = None
db = None

# ---- JSON file fallback ----

class JsonCollection:
    """Minimal async-compatible collection backed by a JSON file."""

    def __init__(self, filepath: Path):
        self.filepath = filepath
        self._data: list[dict] = []
        self._load()

    def _load(self):
        if self.filepath.exists():
            with open(self.filepath, "r") as f:
                self._data = json.load(f)
        else:
            self._data = []

    def _save(self):
        self.filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(self.filepath, "w") as f:
            json.dump(self._data, f, indent=2, default=str)

    async def insert_one(self, doc: dict):
        doc["_id"] = str(uuid.uuid4())
        self._data.append(doc)
        self._save()

        class Result:
            inserted_id = doc["_id"]
        return Result()

    async def find_one(self, query: dict):
        for doc in self._data:
            if self._matches(doc, query):
                return dict(doc)  # return a copy
        return None

    def find(self, query: dict = None):
        query = query or {}
        results = [dict(d) for d in self._data if self._matches(d, query)]
        return _AsyncCursor(results)

    async def update_one(self, query: dict, update: dict):
        for doc in self._data:
            if self._matches(doc, query):
                if "$set" in update:
                    doc.update(update["$set"])
                if "$push" in update:
                    for key, val in update["$push"].items():
                        if key not in doc:
                            doc[key] = []
                        doc[key].append(val)
                self._save()

                class Result:
                    matched_count = 1
                    modified_count = 1
                return Result()

        class NoResult:
            matched_count = 0
            modified_count = 0
        return NoResult()

    async def count_documents(self, query: dict = None):
        query = query or {}
        return sum(1 for d in self._data if self._matches(d, query))

    async def create_index(self, field):
        pass  # no-op for JSON

    def _matches(self, doc: dict, query: dict) -> bool:
        for key, val in query.items():
            if key == "_id":
                if str(doc.get("_id")) != str(val):
                    return False
            elif doc.get(key) != val:
                return False
        return True


class _AsyncCursor:
    def __init__(self, results):
        self._results = results
        self._sorted = False

    def sort(self, field, direction=-1):
        self._results.sort(
            key=lambda d: d.get(field, ""),
            reverse=(direction == -1),
        )
        return self

    def __aiter__(self):
        self._iter = iter(self._results)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class JsonDB:
    """Minimal DB that mimics motor's interface using JSON files."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.spreads = JsonCollection(data_dir / "spreads.json")
        self.portfolio_snapshots = JsonCollection(data_dir / "snapshots.json")
        self.alerts = JsonCollection(data_dir / "alerts.json")


async def connect_db():
    global client, db, MONGODB_AVAILABLE
    if MONGODB_AVAILABLE:
        try:
            client = AsyncIOMotorClient(MONGODB_URI, serverSelectionTimeoutMS=3000)
            # Test connection
            await client.admin.command("ping")
            db = client[DB_NAME]
            await db.spreads.create_index("status")
            await db.spreads.create_index("asset_class")
            await db.spreads.create_index("created_by")
            print("✓ Connected to MongoDB")
            return
        except Exception as e:
            print(f"✗ MongoDB unavailable ({e}), falling back to JSON file store")
            MONGODB_AVAILABLE = False

    # Fallback to JSON — works but data is ephemeral on Railway (no persistent disk)
    db = JsonDB(DATA_DIR)
    print(f"✓ Using JSON file store at {DATA_DIR}/")
    if os.getenv("RAILWAY_ENVIRONMENT"):
        print("⚠ WARNING: Running on Railway without MongoDB — data will not persist across deploys!")


async def close_db():
    global client
    if client:
        client.close()


def get_db():
    """Return the database instance. Call after connect_db()."""
    return db
