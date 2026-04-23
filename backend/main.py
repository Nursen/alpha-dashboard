import re
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from config import ALLOWED_ORIGINS
from db import connect_db, close_db
from routers import spreads, portfolio, market_data, fundamentals, news, explore, pnl, risk


# Middleware to allow any *.vercel.app origin (deployed previews, etc.)
VERCEL_PATTERN = re.compile(r"^https://[\w-]+\.vercel\.app$")


class DynamicCORSMiddleware(BaseHTTPMiddleware):
    """Supplement CORSMiddleware: accept any *.vercel.app origin dynamically."""

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin", "")
        response: Response = await call_next(request)
        # If the origin is a Vercel preview deploy, add CORS headers
        if origin and VERCEL_PATTERN.match(origin):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "*"
            response.headers["Access-Control-Allow-Headers"] = "*"
        return response


async def _auto_seed_if_empty():
    """Seed with mandate pairs if database is empty (e.g., fresh deploy)."""
    from db import get_db
    db = get_db()
    count = await db.spreads.count_documents({})
    if count == 0:
        from seed_data import seed_json
        seed_json()
        # Reload the JSON store
        if hasattr(db, 'spreads') and hasattr(db.spreads, '_load'):
            db.spreads._load()
        print(f"Auto-seeded {8} mandate pairs (empty database detected)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    await _auto_seed_if_empty()
    yield
    await close_db()


app = FastAPI(
    title="Alpha Dashboard API",
    description="Multi-Asset Market Neutral Fund — team portfolio review tool",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — configured origins from env + localhost defaults for dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Also allow any *.vercel.app preview deploy
app.add_middleware(DynamicCORSMiddleware)

# Routers
app.include_router(spreads.router)
app.include_router(portfolio.router)
app.include_router(market_data.router)
app.include_router(fundamentals.router)
app.include_router(news.router)
app.include_router(explore.router)
app.include_router(pnl.router)
app.include_router(risk.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "alpha-dashboard-api"}
