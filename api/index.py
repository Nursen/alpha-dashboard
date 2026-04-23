"""
Vercel serverless function — wraps the FastAPI backend.

All /api/* requests are routed here by vercel.json rewrites.
Vercel's Python runtime detects the ASGI `app` variable automatically.

NOTE: Vercel serverless has an ephemeral filesystem. The JSON file-based
DB works per-invocation but data won't persist across cold starts.
This is fine for the class demo — hardcoded positions in seed_data.py
are re-loaded each time.
"""
import sys
import os

# Add backend directory to Python path so imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

# Force JSON fallback — no MongoDB on Vercel serverless
os.environ.setdefault("MONGODB_URI", "")

from main import app  # noqa: E402 — path must be set first

# Vercel detects this ASGI app variable
