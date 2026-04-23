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

// ---------------------------------------------------------------------------
// PnL Module (StockTrak snapshots)
// ---------------------------------------------------------------------------

import type { PnLLatest, PnLHistory, PnLTheme, PnLAssetClass } from './types';

const API_BASE_RAW = import.meta.env.VITE_API_URL || '/api';

export async function uploadPnLCsv(
  positionsFile: File,
  summaryFile?: File,
  snapshotDate?: string,
): Promise<{ status: string; snapshot_id: string; num_positions: number; portfolio_value: number }> {
  const formData = new FormData();
  formData.append('positions_file', positionsFile);
  if (summaryFile) formData.append('summary_file', summaryFile);
  if (snapshotDate) formData.append('snapshot_date', snapshotDate);

  const res = await fetch(`${API_BASE_RAW}/pnl/upload`, {
    method: 'POST',
    headers: { 'X-Dev-User': 'nursen' },
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export function getPnLLatest(): Promise<PnLLatest> {
  return api<PnLLatest>('/pnl/latest');
}

export function getPnLHistory(): Promise<PnLHistory> {
  return api<PnLHistory>('/pnl/history');
}

export function getPnLByTheme(): Promise<{ themes: PnLTheme[] }> {
  return api<{ themes: PnLTheme[] }>('/pnl/by-theme');
}

export function getPnLByAssetClass(): Promise<{ asset_classes: PnLAssetClass[] }> {
  return api<{ asset_classes: PnLAssetClass[] }>('/pnl/by-asset-class');
}

// ---------------------------------------------------------------------------
// Risk Management (position-level risk from StockTrak)
// ---------------------------------------------------------------------------

import type {
  RiskSummary,
  VaRData,
  ThemeCorrelation,
  ScenarioResult,
  PositionFlag,
} from './types';

export function getRiskSummary(): Promise<RiskSummary> {
  return api<RiskSummary>('/risk/summary');
}

export function getRiskVar(): Promise<VaRData> {
  return api<VaRData>('/risk/var');
}

export function getRiskCorrelation(): Promise<ThemeCorrelation> {
  return api<ThemeCorrelation>('/risk/correlation');
}

export function getRiskScenarios(): Promise<{ scenarios: ScenarioResult[] }> {
  return api<{ scenarios: ScenarioResult[] }>('/risk/scenarios');
}

export function getRiskFlags(): Promise<{ flags: PositionFlag[] }> {
  return api<{ flags: PositionFlag[] }>('/risk/flags');
}
