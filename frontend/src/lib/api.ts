import type { Spread, SpreadCreate, PortfolioSummary, ConstraintCheckResult, SpreadAnalytics, PairComparison, PortfolioRisk } from './types';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-User': 'nursen',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error ${res.status}`);
  }
  return res.json();
}

export function getSpreads(status?: string): Promise<Spread[]> {
  const params = status ? `?status=${status}` : '';
  return api<Spread[]>(`/spreads${params}`);
}

export function getSpread(id: string): Promise<Spread> {
  return api<Spread>(`/spreads/${id}`);
}

export function createSpread(data: SpreadCreate): Promise<Spread> {
  return api<Spread>('/spreads', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateSpread(id: string, data: Partial<SpreadCreate>): Promise<Spread> {
  return api<Spread>(`/spreads/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteSpread(id: string): Promise<void> {
  return api<void>(`/spreads/${id}`, { method: 'DELETE' });
}

export function getPortfolioSummary(): Promise<PortfolioSummary> {
  return api<PortfolioSummary>('/portfolio/summary');
}

export function getPortfolioConstraints(): Promise<PortfolioSummary> {
  return api<PortfolioSummary>('/portfolio/constraints');
}

export function checkSpread(data: SpreadCreate): Promise<ConstraintCheckResult> {
  return api<ConstraintCheckResult>('/portfolio/check-spread', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getMarketPrices(tickers: string[], period = '1y') {
  return api<Record<string, number[]>>(`/market/prices?tickers=${tickers.join(',')}&period=${period}`);
}

export function getMarketQuote(tickers: string[]) {
  return api<Record<string, { price: number; change_pct: number }>>(`/market/quote?tickers=${tickers.join(',')}`);
}

export function getSpreadAnalytics(id: string): Promise<SpreadAnalytics> {
  return api<SpreadAnalytics>(`/spreads/${id}/analytics`);
}

export function getFundamentalComparison(longTicker: string, shortTicker: string): Promise<PairComparison> {
  return api<PairComparison>(`/fundamentals/compare?long=${longTicker}&short=${shortTicker}`);
}

export function addNote(spreadId: string, text: string) {
  return api<{ status: string; note: { text: string; author: string; created_at: string } }>(`/spreads/${spreadId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// News
export interface NewsArticle {
  title: string;
  summary: string;
  publisher: string;
  published_at: string;
  url: string;
  content_type: string;
  thumbnail: string | null;
  ticker: string;
}

export function getPortfolioNews(): Promise<NewsArticle[]> {
  return api<NewsArticle[]>('/news');
}

export function getSpreadNews(spreadId: string): Promise<NewsArticle[]> {
  return api<NewsArticle[]>(`/news/spread/${spreadId}`);
}

// ---------------------------------------------------------------------------
// Explore endpoints
// ---------------------------------------------------------------------------

import type {
  Signal,
  SectorData,
  FactorData,
  ScreenerParams,
  StockResult,
  InvestigationResult,
  PortfolioPnL,
  OptimizationResult,
  CorrelationMatrix,
} from './types';

export async function getSignals(): Promise<Signal[]> {
  const res = await api<any>('/explore/signals');
  return res.signals ?? res ?? [];
}

export async function getSectorHeatmap(): Promise<SectorData[]> {
  const res = await api<any>('/explore/sector-heatmap');
  return res.sectors ?? res ?? [];
}

export async function getFactorMomentum(): Promise<FactorData[]> {
  const res = await api<any>('/explore/factors');
  return res.factors ?? res ?? [];
}

export async function screenStocks(params: ScreenerParams): Promise<StockResult[]> {
  const qs = new URLSearchParams();
  if (params.sector) qs.set('sector', params.sector);
  if (params.min_market_cap) qs.set('min_market_cap', String(params.min_market_cap));
  if (params.max_pe) qs.set('max_pe', String(params.max_pe));
  if (params.min_volume) qs.set('min_volume', String(params.min_volume));
  const res = await api<any>(`/explore/screen?${qs.toString()}`);
  return res.stocks ?? res ?? [];
}

export function investigatePair(long: string, short: string, allocation = 5): Promise<InvestigationResult> {
  return api<InvestigationResult>(`/explore/investigate?long=${long}&short=${short}&allocation=${allocation}`);
}

export function getCorrelationMatrix(tickers: string[]): Promise<CorrelationMatrix> {
  return api<CorrelationMatrix>(`/market/correlation?tickers=${tickers.join(',')}`);
}

export function getTickerNews(tickers: string[]): Promise<NewsArticle[]> {
  return api<NewsArticle[]>(`/news?tickers=${tickers.join(',')}`);
}

export function getPortfolioPnL(): Promise<PortfolioPnL> {
  return api<PortfolioPnL>('/portfolio/pnl');
}

export function getPortfolioOptimization(): Promise<OptimizationResult> {
  return api<OptimizationResult>('/portfolio/optimize');
}

export function getPortfolioRisk(): Promise<PortfolioRisk> {
  return api<PortfolioRisk>('/portfolio/risk');
}
