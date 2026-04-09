"""
News service — fetches news for tickers via yfinance.
"""
import yfinance as yf
from datetime import datetime
from cachetools import TTLCache

# Cache news for 10 minutes
_news_cache: TTLCache = TTLCache(maxsize=200, ttl=600)


def get_news_for_ticker(ticker: str, max_items: int = 10) -> list[dict]:
    """Fetch recent news for a single ticker."""
    cache_key = f"news:{ticker}"
    if cache_key in _news_cache:
        return _news_cache[cache_key]

    try:
        t = yf.Ticker(ticker)
        raw_news = t.news or []
    except Exception:
        return []

    articles = []
    for item in raw_news[:max_items]:
        content = item.get("content", {})
        if not content:
            continue

        title = content.get("title", "")
        if not title:
            continue

        # Extract thumbnail
        thumbnail = None
        thumb_data = content.get("thumbnail")
        if thumb_data and thumb_data.get("resolutions"):
            # Get smallest resolution for performance
            resolutions = thumb_data["resolutions"]
            smallest = min(resolutions, key=lambda r: r.get("width", 9999))
            thumbnail = smallest.get("url")

        articles.append({
            "title": title,
            "summary": content.get("summary", ""),
            "publisher": content.get("provider", {}).get("displayName", "Unknown"),
            "published_at": content.get("pubDate", ""),
            "url": content.get("canonicalUrl", {}).get("url", ""),
            "content_type": content.get("contentType", "STORY"),
            "thumbnail": thumbnail,
            "ticker": ticker,
        })

    _news_cache[cache_key] = articles
    return articles


def get_news_for_tickers(tickers: list[str], max_per_ticker: int = 5) -> list[dict]:
    """Fetch news for multiple tickers, merged and sorted by date."""
    all_news = []
    for ticker in tickers:
        articles = get_news_for_ticker(ticker, max_items=max_per_ticker)
        all_news.extend(articles)

    # Sort by published date (newest first), deduplicate by title
    seen_titles = set()
    unique = []
    for article in sorted(all_news, key=lambda a: a.get("published_at", ""), reverse=True):
        if article["title"] not in seen_titles:
            seen_titles.add(article["title"])
            unique.append(article)

    return unique
