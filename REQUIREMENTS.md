# Alpha Dashboard — Requirements & Feature Tracker

## Overview
Team portfolio review dashboard for MGT 845 Multi-Asset Market Neutral Fund.
Stack: Vite+React+TypeScript (frontend) / Python FastAPI (backend) / MongoDB or JSON (storage) / Supabase (auth, pending)

---

## Core Features

### 1. Spread Entry
- [x] Enter new pair/spread trades (long + short legs)
- [x] Each leg supports single ticker or basket of tickers with custom weights
- [x] Asset class, theme, thesis fields
- [x] Entry date, stop loss %
- [x] Target exit date and target P&L % (exit targets)
- [x] Risk/reward ratio auto-calculated from stop loss + target P&L
- [x] Holding period auto-calculated from entry + target exit dates
- [x] Owner field (team member responsible for sub-portfolio)
- [x] Live constraint checker (pre-flight: "what breaks if I add this?")
- [x] Quick research links per ticker (Yahoo, Google Finance, News, Google Alerts, Seeking Alpha)
- [x] Constraint override with acknowledgment checkbox

### 2. Spread Review (deep-dive per spread)
- [ ] Charts tab: Normalized price overlay (long vs short), spread chart with z-score bands, rolling correlation
- [ ] Fundamentals tab: Side-by-side financial scores (0-100), financials comparison, "wrong side" warnings
- [ ] Risk tab: Portfolio impact, correlation with existing positions, max drawdown, distance to stop loss
- [ ] Notes tab: Investment thesis display, team notes timeline, add-note form
- [ ] Quick stats header: P&L %, correlation, Sharpe, z-score, days held
*(Currently being built — Sprint 2)*

### 3. Portfolio Overview
- [x] KPI cards: Net exposure, gross exposure, active spread count
- [ ] Portfolio P&L (aggregate)
- [x] Constraint traffic lights (progress bars with green/yellow/red)
- [x] Active spreads list (clickable → spread review)
- [x] Portfolio news feed (auto-fetched from yfinance for all portfolio tickers)
- [ ] Exposure breakdown chart by asset class
- [ ] Position table (sortable, filterable: all/active/closed)
- [ ] Optimizer: current vs optimal allocation with rebalancing recommendations

### 4. Automated Fundamental Analysis
- [x] Financial statement retrieval (income, balance sheet, cash flow via yfinance)
- [x] Fundamental scoring (0-100): growth, profitability, health, cash flow, valuation
- [x] Pair comparison with directional validation ("wrong side" warnings)
- [x] Key divergence highlighting
- [x] API: GET /api/fundamentals/{ticker}, /compare, /score

### 5. News & Alerts
- [x] Portfolio-wide news feed on dashboard (aggregated from all active tickers)
- [x] Per-spread news endpoint (GET /api/news/spread/{id})
- [x] Per-ticker news endpoint (GET /api/news/ticker/{ticker})
- [x] One-click Google Alert setup from spread entry form
- [x] Links to Yahoo Finance, Google Finance, Seeking Alpha, Google News per ticker

### 6. Explore Page (idea generation)
- [ ] Signals tab: Auto-generated pair suggestions (cointegration, valuation divergence, factor mismatch, correlation breakdown)
- [ ] Sector heatmap (daily performance via sector ETFs)
- [ ] Correlation explorer (input tickers, get heatmap + rolling correlation)
- [ ] News feed (filterable by portfolio tickers)
- [ ] Stock screener (sector, market cap, volume, P/E filters)
- [ ] Factor momentum (MTUM, VLUE, QUAL, USMV, SIZE ETFs)
*(Planned for Sprint 3)*

### 7. Risk Management
- [x] Mandate constraint enforcement (net ±10%, gross 120%, single 10%, sector 25%)
- [x] Real-time constraint utilization display
- [x] Pre-flight constraint checking on new spreads
- [ ] VaR calculation
- [ ] Max drawdown tracking
- [ ] Factor exposure decomposition
- [ ] Daily P&L monitoring
- [ ] Alert generation for constraint violations

### 8. Sub-Portfolios & Team
- [x] Owner field on spreads (team member assignment)
- [ ] Filter dashboard/portfolio by owner
- [ ] Sub-portfolio report view (per team member)
- [ ] IC presentation export (per sub-portfolio)
- [ ] Supabase auth (team login)

---

## Mandate Constraints (from Fund_Mandate_Strategy.md)

| Constraint | Limit | Status |
|-----------|-------|--------|
| Net equity exposure | ±10% | Enforced |
| Beta | ±0.05 | Tracked |
| Max single position | 10% | Enforced |
| Max sector | 25% | Enforced |
| Max gross leverage | 120% | Enforced |
| Duration | ±5 years | Tracked |
| FX net | 0% | Tracked |

---

## API Endpoints

### Spreads
| Method | Endpoint | Status |
|--------|----------|--------|
| POST | /api/spreads | Done |
| GET | /api/spreads | Done |
| GET | /api/spreads/{id} | Done |
| PUT | /api/spreads/{id} | Done |
| DELETE | /api/spreads/{id} | Done |
| POST | /api/spreads/{id}/notes | Done |
| GET | /api/spreads/{id}/analytics | Done |

### Portfolio
| Method | Endpoint | Status |
|--------|----------|--------|
| GET | /api/portfolio/summary | Done |
| GET | /api/portfolio/constraints | Done |
| POST | /api/portfolio/check-spread | Done |
| GET | /api/portfolio/optimize | Planned |
| GET | /api/portfolio/pnl | Planned |
| GET | /api/portfolio/risk | Planned |

### Market Data
| Method | Endpoint | Status |
|--------|----------|--------|
| GET | /api/market/prices | Done |
| GET | /api/market/quote | Done |
| GET | /api/market/correlation | Done |
| GET | /api/market/info/{ticker} | Done |
| GET | /api/market/sector-heatmap | Planned |

### Fundamentals
| Method | Endpoint | Status |
|--------|----------|--------|
| GET | /api/fundamentals/{ticker} | Done |
| GET | /api/fundamentals/compare | Done |
| GET | /api/fundamentals/score | Done |

### News
| Method | Endpoint | Status |
|--------|----------|--------|
| GET | /api/news | Done |
| GET | /api/news/ticker/{ticker} | Done |
| GET | /api/news/spread/{spread_id} | Done |

### Explore / Signals
| Method | Endpoint | Status |
|--------|----------|--------|
| GET | /api/explore/signals | Planned |
| GET | /api/explore/screen | Planned |
| GET | /api/explore/factors | Planned |

---

## Sprint Timeline

| Sprint | Dates | Focus | Status |
|--------|-------|-------|--------|
| 1 | Apr 8-14 | Foundation, spread entry, constraints | Done |
| 2 | Apr 15-21 | Spread review, P&L, fundamentals | In Progress |
| 3 | Apr 22-28 | Explore, signals engine, optimizer | Planned |
| 4 | Apr 29 - May 5 | Polish, export, presentation | Planned |

---

## Data Sources

| Data | Source | Cost |
|------|--------|------|
| Price history | yfinance | Free |
| Current quotes | yfinance | Free |
| Financial statements | yfinance | Free |
| Fundamental ratios | yfinance .info | Free |
| News | yfinance .news | Free |
| Sector ETFs | yfinance (XLK, XLF, etc.) | Free |
| Factor ETFs | yfinance (MTUM, VLUE, etc.) | Free |

---

## Architecture

```
Frontend (Vite+React+TS, port 5174)
  ↓ /api proxy
Backend (FastAPI, port 8000)
  ↓
MongoDB Atlas or JSON file fallback
  +
yfinance (market data, fundamentals, news)
```
