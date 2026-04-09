import { useState, useEffect, lazy, Suspense, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@/hooks/useApi';
import {
  getSignals,
  getSectorHeatmap,
  getFactorMomentum,
  screenStocks,
  investigatePair,
  getCorrelationMatrix,
  getTickerNews,
} from '@/lib/api';
import type { NewsArticle } from '@/lib/api';
import { ConstraintBar } from '@/components/ConstraintBar';
import { Skeleton, CardSkeleton, TableSkeleton } from '@/components/LoadingSkeleton';
import { ErrorState } from '@/components/ErrorState';
import { InfoTip } from '@/components/Tooltip';
import { cn, fmtPct } from '@/lib/utils';
import {
  EXPLORE_TOOLTIPS,
  SIGNAL_TYPE_TOOLTIPS,
  FACTOR_TOOLTIPS,
  SCREENER_TOOLTIPS,
} from '@/lib/tooltips';
import type {
  Signal,
  SectorData,
  FactorData,
  StockResult,
  InvestigationResult,
  CorrelationMatrix,
  SpreadAnalytics,
  PairComparison,
} from '@/lib/types';

const Plot = lazy(() => import('react-plotly.js'));

// Shared Plotly layout (matches SpreadReviewPage)
const PLOTLY_LAYOUT = {
  paper_bgcolor: '#0d1117',
  plot_bgcolor: '#0d1117',
  font: { color: '#8b949e', size: 12 },
  xaxis: { gridcolor: '#1c2333', zerolinecolor: '#30363d' },
  yaxis: { gridcolor: '#1c2333', zerolinecolor: '#30363d' },
  margin: { t: 30, b: 40, l: 55, r: 20 },
  showlegend: true,
  legend: { orientation: 'h' as const, x: 0.5, xanchor: 'center' as const, y: 1.12 },
};
const PLOTLY_CONFIG = { displayModeBar: false, responsive: true };

type ExploreTab = 'signals' | 'sectors' | 'correlation' | 'news' | 'screener' | 'factors';

const TABS: { key: ExploreTab; label: string; tooltipKey: keyof typeof EXPLORE_TOOLTIPS }[] = [
  { key: 'signals', label: 'Signals', tooltipKey: 'signals' },
  { key: 'sectors', label: 'Sector Heatmap', tooltipKey: 'sectorHeatmap' },
  { key: 'correlation', label: 'Correlation', tooltipKey: 'correlationExplorer' },
  { key: 'news', label: 'News', tooltipKey: 'news' },
  { key: 'screener', label: 'Screener', tooltipKey: 'screener' },
  { key: 'factors', label: 'Factors', tooltipKey: 'factorMomentum' },
];

// ---------------------------------------------------------------------------
// Signal type styling
// ---------------------------------------------------------------------------

const SIGNAL_BADGES: Record<Signal['signal_type'], { label: string; color: string }> = {
  cointegration: { label: 'Cointegration', color: 'bg-gh-accent/15 text-gh-accent border-gh-accent/30' },
  valuation: { label: 'Valuation', color: 'bg-gh-green/15 text-gh-green border-gh-green/30' },
  correlation_breakdown: { label: 'Corr Breakdown', color: 'bg-gh-orange/15 text-gh-orange border-gh-orange/30' },
};

// ---------------------------------------------------------------------------
// Helper: format large numbers
// ---------------------------------------------------------------------------

function fmtBigNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  if (Math.abs(v) >= 1e12) return (v / 1e12).toFixed(1) + 'T';
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function returnColor(val: number): string {
  if (val > 0.5) return 'text-gh-green';
  if (val < -0.5) return 'text-gh-red';
  return 'text-gh-text-muted';
}

function heatColor(val: number): string {
  if (val > 1.5) return 'bg-gh-green/30 border-gh-green/40';
  if (val > 0.5) return 'bg-gh-green/15 border-gh-green/25';
  if (val > -0.5) return 'bg-gh-bg border-gh-border';
  if (val > -1.5) return 'bg-gh-red/15 border-gh-red/25';
  return 'bg-gh-red/30 border-gh-red/40';
}

// ===========================================================================
// Main Explore Page
// ===========================================================================

export function ExplorePage() {
  const [tab, setTab] = useState<ExploreTab>('signals');
  const [investigateSignal, setInvestigateSignal] = useState<Signal | null>(null);

  return (
    <div className="max-w-7xl space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gh-border overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors inline-flex items-center gap-1',
              tab === t.key
                ? 'border-gh-accent text-gh-accent'
                : 'border-transparent text-gh-text-muted hover:text-gh-text',
            )}
          >
            {t.label}
            <InfoTip {...EXPLORE_TOOLTIPS[t.tooltipKey]} />
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'signals' && <SignalsTab onInvestigate={setInvestigateSignal} />}
      {tab === 'sectors' && <SectorHeatmapTab />}
      {tab === 'correlation' && <CorrelationTab />}
      {tab === 'news' && <NewsTab />}
      {tab === 'screener' && <ScreenerTab />}
      {tab === 'factors' && <FactorsTab />}

      {/* Investigation Modal */}
      {investigateSignal && (
        <InvestigationModal
          signal={investigateSignal}
          onClose={() => setInvestigateSignal(null)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Tab 1: Signals
// ===========================================================================

function SignalsTab({ onInvestigate }: { onInvestigate: (s: Signal) => void }) {
  const { data: signals, loading, error, refetch } = useApi<Signal[]>(() => getSignals(), []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (!signals || signals.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-gh-text-muted text-sm mb-3">
          No signals found. The scanner runs on ~80 stocks across 8 sectors. Try refreshing -- signals update hourly.
        </p>
        <button onClick={refetch} className="px-4 py-2 text-sm bg-gh-accent/10 text-gh-accent border border-gh-accent/30 rounded-lg hover:bg-gh-accent/20 transition-colors">
          Refresh Signals
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gh-text-muted">{signals.length} signals found</p>
        <button
          onClick={refetch}
          className="px-3 py-1.5 text-xs bg-gh-accent/10 text-gh-accent border border-gh-accent/30 rounded-lg hover:bg-gh-accent/20 transition-colors"
        >
          Refresh Signals
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {signals.map((s, i) => (
          <SignalCard key={i} signal={s} onInvestigate={() => onInvestigate(s)} />
        ))}
      </div>
    </div>
  );
}

function SignalCard({ signal, onInvestigate }: { signal: Signal; onInvestigate: () => void }) {
  const badge = SIGNAL_BADGES[signal.signal_type];
  const tipContent = SIGNAL_TYPE_TOOLTIPS[signal.signal_type];

  // Key metric varies by type
  let keyMetric: { label: string; value: string } | null = null;
  if (signal.signal_type === 'cointegration') {
    keyMetric = { label: 'Z-Score', value: signal.zscore.toFixed(2) };
  } else if (signal.signal_type === 'valuation') {
    keyMetric = {
      label: 'P/E Spread',
      value: signal.pe_long && signal.pe_short
        ? `${signal.pe_long.toFixed(1)}x vs ${signal.pe_short.toFixed(1)}x`
        : signal.zscore.toFixed(2),
    };
  } else if (signal.signal_type === 'correlation_breakdown') {
    keyMetric = {
      label: 'Corr Delta',
      value: signal.historical_corr !== undefined && signal.recent_corr !== undefined
        ? `${signal.historical_corr.toFixed(2)} -> ${signal.recent_corr.toFixed(2)}`
        : signal.zscore.toFixed(2),
    };
  }

  return (
    <div className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg hover:border-gh-accent/30 transition-colors">
      {/* Header: badge + pair name */}
      <div className="flex items-start justify-between mb-3">
        <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium inline-flex items-center gap-1', badge.color)}>
          {badge.label}
          <InfoTip {...tipContent} />
        </span>
        {signal.p_value !== undefined && (
          <span className="text-[10px] text-gh-text-muted">p={signal.p_value.toFixed(3)}</span>
        )}
      </div>

      <div className="mb-3">
        <span className="text-sm font-semibold text-gh-text">
          Long <span className="text-gh-green">{signal.long}</span>
          {' / '}
          Short <span className="text-gh-red">{signal.short}</span>
        </span>
      </div>

      {/* Strength meter */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] text-gh-text-muted mb-1">
          <span>Strength</span>
          <span>{signal.strength}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-gh-bg overflow-hidden border border-gh-border">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              signal.strength >= 70 ? 'bg-gh-green' : signal.strength >= 40 ? 'bg-gh-yellow' : 'bg-gh-red',
            )}
            style={{ width: `${Math.min(signal.strength, 100)}%` }}
          />
        </div>
      </div>

      {/* Key metric */}
      {keyMetric && (
        <div className="flex items-center justify-between text-xs mb-3">
          <span className="text-gh-text-muted">{keyMetric.label}</span>
          <span className="text-gh-text font-medium">{keyMetric.value}</span>
        </div>
      )}

      {/* Rationale */}
      <p className="text-xs text-gh-text-muted leading-relaxed mb-4 line-clamp-2">{signal.rationale}</p>

      {/* Actions */}
      <button
        onClick={onInvestigate}
        className="w-full px-3 py-2 text-xs font-medium bg-gh-accent/10 text-gh-accent border border-gh-accent/30 rounded-lg hover:bg-gh-accent/20 transition-colors"
      >
        Investigate
      </button>
    </div>
  );
}

// ===========================================================================
// Tab 2: Sector Heatmap
// ===========================================================================

function SectorHeatmapTab() {
  const { data: sectors, loading, error, refetch } = useApi<SectorData[]>(() => getSectorHeatmap(), []);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!sectors || sectors.length === 0) return <p className="text-sm text-gh-text-muted py-8 text-center">No sector data available</p>;

  function getValue(s: SectorData) {
    if (period === 'weekly') return s.weekly_return_pct;
    if (period === 'monthly') return s.monthly_return_pct;
    return s.daily_return_pct;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {(['daily', 'weekly', 'monthly'] as const).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-lg transition-colors',
              period === p
                ? 'bg-gh-accent/10 text-gh-accent border border-gh-accent/30'
                : 'text-gh-text-muted border border-gh-border hover:text-gh-text',
            )}
          >
            {p === 'daily' ? '1D' : p === 'weekly' ? '1W' : '1M'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {sectors.map(s => {
          const val = getValue(s);
          return (
            <div
              key={s.etf}
              className={cn('p-4 rounded-lg border transition-colors', heatColor(val))}
            >
              <div className="text-xs text-gh-text-muted mb-1">{s.etf}</div>
              <div className="text-sm font-semibold text-gh-text">{s.sector_name}</div>
              <div className={cn('text-lg font-bold mt-1', returnColor(val))}>
                {fmtPct(val)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// Tab 3: Correlation Explorer
// ===========================================================================

function CorrelationTab() {
  const [tickerInput, setTickerInput] = useState('SPY, QQQ, AAPL, MSFT, GOOGL, AMZN, XOM, JPM');
  const [_tickers, setTickers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<CorrelationMatrix | null>(null);

  const handleCalculate = useCallback(async () => {
    const parsed = tickerInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (parsed.length < 2) return;
    setTickers(parsed);
    setLoading(true);
    setError(null);
    try {
      const result = await getCorrelationMatrix(parsed);
      setMatrix(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch correlation data');
    } finally {
      setLoading(false);
    }
  }, [tickerInput]);

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <input
          type="text"
          value={tickerInput}
          onChange={e => setTickerInput(e.target.value.toUpperCase())}
          placeholder="Enter tickers, comma-separated"
          className="flex-1 px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
          onKeyDown={e => e.key === 'Enter' && handleCalculate()}
        />
        <button
          onClick={handleCalculate}
          disabled={loading}
          className="px-4 py-2 text-sm bg-gh-accent/10 text-gh-accent border border-gh-accent/30 rounded-lg hover:bg-gh-accent/20 transition-colors disabled:opacity-50"
        >
          {loading ? 'Calculating...' : 'Calculate'}
        </button>
      </div>

      {error && <ErrorState message={error} onRetry={handleCalculate} />}

      {loading && <Skeleton className="h-[400px] w-full" />}

      {matrix && !loading && (
        <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
          <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
            <Plot
              data={[
                {
                  type: 'heatmap',
                  z: matrix.matrix,
                  x: matrix.tickers,
                  y: matrix.tickers,
                  colorscale: [
                    [0, '#ff7b72'],
                    [0.5, '#0d1117'],
                    [1, '#58a6ff'],
                  ],
                  zmin: -1,
                  zmax: 1,
                  text: matrix.matrix.map(row => row.map(v => v.toFixed(2))) as any,
                  texttemplate: '%{text}',
                  hovertemplate: '%{x} vs %{y}: %{z:.3f}<extra></extra>',
                },
              ]}
              layout={{
                ...PLOTLY_LAYOUT,
                height: 450,
                showlegend: false,
                margin: { t: 30, b: 80, l: 80, r: 20 },
                xaxis: { ...PLOTLY_LAYOUT.xaxis, tickangle: -45 },
              }}
              config={PLOTLY_CONFIG}
              style={{ width: '100%' }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Tab 4: News
// ===========================================================================

function NewsTab() {
  const [tickerInput, setTickerInput] = useState('');
  const [searchTickers, setSearchTickers] = useState<string[]>([]);

  const fetcher = useCallback(() => {
    if (searchTickers.length > 0) {
      return getTickerNews(searchTickers);
    }
    return getTickerNews([]);
  }, [searchTickers]);

  const { data: news, loading, error, refetch } = useApi<NewsArticle[]>(fetcher, [searchTickers]);

  const handleSearch = () => {
    const parsed = tickerInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    setSearchTickers(parsed);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <input
          type="text"
          value={tickerInput}
          onChange={e => setTickerInput(e.target.value.toUpperCase())}
          placeholder="Filter by tickers (comma-separated) or leave empty for all portfolio tickers"
          className="flex-1 px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2 text-sm bg-gh-accent/10 text-gh-accent border border-gh-accent/30 rounded-lg hover:bg-gh-accent/20 transition-colors"
        >
          Filter
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-12 w-12 rounded" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : news && news.length > 0 ? (
        <div className="space-y-3 max-h-[600px] overflow-y-auto">
          {news.map((article, i) => (
            <a
              key={i}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 p-3 rounded-lg bg-gh-bg-secondary border border-gh-border hover:border-gh-accent/30 transition-colors group"
            >
              {article.thumbnail && (
                <img src={article.thumbnail} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gh-text group-hover:text-gh-accent transition-colors line-clamp-2">
                  {article.title}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gh-accent/10 text-gh-accent font-medium">
                    {article.ticker}
                  </span>
                  <span className="text-xs text-gh-text-muted">{article.publisher}</span>
                  <span className="text-xs text-gh-text-muted">
                    {article.published_at ? new Date(article.published_at).toLocaleDateString() : ''}
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gh-text-muted py-8 text-center">No news available. Try entering specific tickers above.</p>
      )}
    </div>
  );
}

// ===========================================================================
// Tab 5: Screener
// ===========================================================================

const SECTOR_OPTIONS = [
  '', 'Technology', 'Healthcare', 'Financials', 'Energy', 'Consumer Discretionary',
  'Consumer Staples', 'Industrials', 'Materials', 'Utilities', 'Real Estate', 'Communication Services',
];

function ScreenerTab() {
  const [sector, setSector] = useState('');
  const [minCap, setMinCap] = useState('');
  const [maxPE, setMaxPE] = useState('');
  const [minVolume, setMinVolume] = useState('');
  const [results, setResults] = useState<StockResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<keyof StockResult>('market_cap');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await screenStocks({
        sector: sector || undefined,
        min_market_cap: minCap ? parseFloat(minCap) : undefined,
        max_pe: maxPE ? parseFloat(maxPE) : undefined,
        min_volume: minVolume ? parseFloat(minVolume) : undefined,
      });
      setResults(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const sorted = useMemo(() => {
    if (!results) return null;
    return [...results].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortAsc ? aVal - bVal : bVal - aVal;
      }
      return sortAsc
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [results, sortCol, sortAsc]);

  function toggleSort(col: keyof StockResult) {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(false);
    }
  }

  const thClass = 'px-3 py-2 text-left text-[10px] uppercase tracking-wide text-gh-text-muted cursor-pointer hover:text-gh-text select-none';

  return (
    <div className="space-y-4">
      {/* Filter row */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[10px] text-gh-text-muted uppercase tracking-wide mb-1 inline-flex items-center">
            Sector <InfoTip {...SCREENER_TOOLTIPS.sector} />
          </label>
          <select
            value={sector}
            onChange={e => setSector(e.target.value)}
            className="px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
          >
            <option value="">All Sectors</option>
            {SECTOR_OPTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gh-text-muted uppercase tracking-wide mb-1 inline-flex items-center">
            Min Market Cap ($B) <InfoTip {...SCREENER_TOOLTIPS.marketCap} />
          </label>
          <input
            type="number"
            value={minCap}
            onChange={e => setMinCap(e.target.value)}
            placeholder="e.g. 10"
            className="w-28 px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gh-text-muted uppercase tracking-wide mb-1 inline-flex items-center">
            Max P/E <InfoTip {...SCREENER_TOOLTIPS.pe} />
          </label>
          <input
            type="number"
            value={maxPE}
            onChange={e => setMaxPE(e.target.value)}
            placeholder="e.g. 30"
            className="w-28 px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gh-text-muted uppercase tracking-wide mb-1 inline-flex items-center">
            Min Volume <InfoTip {...SCREENER_TOOLTIPS.volume} />
          </label>
          <input
            type="number"
            value={minVolume}
            onChange={e => setMinVolume(e.target.value)}
            placeholder="e.g. 1000000"
            className="w-32 px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-4 py-2 text-sm bg-gh-accent/10 text-gh-accent border border-gh-accent/30 rounded-lg hover:bg-gh-accent/20 transition-colors disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && <ErrorState message={error} onRetry={handleSearch} />}
      {loading && <TableSkeleton rows={8} />}

      {sorted && !loading && (
        <div className="overflow-x-auto rounded-lg border border-gh-border">
          <table className="w-full text-sm">
            <thead className="bg-gh-bg-secondary">
              <tr>
                <th className={thClass} onClick={() => toggleSort('ticker')}>Ticker {sortCol === 'ticker' ? (sortAsc ? '^' : 'v') : ''}</th>
                <th className={thClass} onClick={() => toggleSort('name')}>Name {sortCol === 'name' ? (sortAsc ? '^' : 'v') : ''}</th>
                <th className={thClass} onClick={() => toggleSort('sector')}>Sector</th>
                <th className={thClass} onClick={() => toggleSort('market_cap')}>Mkt Cap {sortCol === 'market_cap' ? (sortAsc ? '^' : 'v') : ''}</th>
                <th className={thClass} onClick={() => toggleSort('pe_ratio')}>P/E {sortCol === 'pe_ratio' ? (sortAsc ? '^' : 'v') : ''}</th>
                <th className={thClass} onClick={() => toggleSort('volume')}>Volume {sortCol === 'volume' ? (sortAsc ? '^' : 'v') : ''}</th>
                <th className={thClass} onClick={() => toggleSort('price')}>Price {sortCol === 'price' ? (sortAsc ? '^' : 'v') : ''}</th>
                <th className={thClass}>52W Range</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => (
                <tr
                  key={s.ticker}
                  className="border-t border-gh-border hover:bg-gh-bg-secondary/50 transition-colors cursor-pointer"
                  onClick={() => window.open(`https://finance.yahoo.com/quote/${s.ticker}/`, '_blank')}
                >
                  <td className="px-3 py-2.5 font-medium text-gh-accent">{s.ticker}</td>
                  <td className="px-3 py-2.5 text-gh-text max-w-[200px] truncate">{s.name}</td>
                  <td className="px-3 py-2.5 text-gh-text-muted text-xs">{s.sector}</td>
                  <td className="px-3 py-2.5 text-gh-text">{fmtBigNum(s.market_cap)}</td>
                  <td className="px-3 py-2.5 text-gh-text">{s.pe_ratio ? s.pe_ratio.toFixed(1) + 'x' : '--'}</td>
                  <td className="px-3 py-2.5 text-gh-text-muted">{fmtBigNum(s.volume)}</td>
                  <td className="px-3 py-2.5 text-gh-text">${s.price.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-xs text-gh-text-muted">
                    ${s.low_52w.toFixed(0)} - ${s.high_52w.toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <p className="text-sm text-gh-text-muted py-8 text-center">No stocks match your criteria. Try broadening the filters.</p>
          )}
        </div>
      )}

      {!sorted && !loading && !error && (
        <p className="text-sm text-gh-text-muted py-8 text-center">Set your filters and click Search to find stocks.</p>
      )}
    </div>
  );
}

// ===========================================================================
// Tab 6: Factor Momentum
// ===========================================================================

function FactorsTab() {
  const { data: factors, loading, error, refetch } = useApi<FactorData[]>(() => getFactorMomentum(), []);

  if (loading) return <TableSkeleton rows={5} />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!factors || factors.length === 0) return <p className="text-sm text-gh-text-muted py-8 text-center">No factor data available</p>;

  return (
    <div className="space-y-6">
      {/* Factor cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {factors.map(f => {
          const tip = FACTOR_TOOLTIPS[f.factor_name];
          return (
            <div key={f.factor_name} className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gh-text inline-flex items-center gap-1">
                  {f.factor_name}
                  {tip && <InfoTip {...tip} />}
                </span>
                <span className="text-[10px] text-gh-text-muted">{f.etf}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: '1D', val: f.daily_return },
                  { label: '1W', val: f.weekly_return },
                  { label: '1M', val: f.monthly_return },
                  { label: 'YTD', val: f.ytd_return },
                ].map(p => (
                  <div key={p.label}>
                    <div className="text-[10px] text-gh-text-muted mb-0.5">{p.label}</div>
                    <div className={cn('text-sm font-bold', returnColor(p.val))}>
                      {fmtPct(p.val)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Factor comparison bar chart */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-3">
          Factor Performance Comparison (1M)
        </h3>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Plot
            data={[
              {
                type: 'bar',
                x: factors.map(f => f.factor_name),
                y: factors.map(f => f.monthly_return),
                marker: {
                  color: factors.map(f => f.monthly_return >= 0 ? '#3fb950' : '#ff7b72'),
                },
                text: factors.map(f => fmtPct(f.monthly_return)),
                textposition: 'auto',
              },
            ]}
            layout={{
              ...PLOTLY_LAYOUT,
              height: 280,
              showlegend: false,
              yaxis: { ...PLOTLY_LAYOUT.yaxis, title: { text: '1-Month Return (%)' } },
            }}
            config={PLOTLY_CONFIG}
            style={{ width: '100%' }}
          />
        </Suspense>
      </div>
    </div>
  );
}

// ===========================================================================
// Investigation Modal
// ===========================================================================

function InvestigationModal({ signal, onClose }: { signal: Signal; onClose: () => void }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [viewTab, setViewTab] = useState<'charts' | 'fundamentals' | 'fit'>('charts');

  // Fetch investigation data on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    investigatePair(signal.long, signal.short)
      .then(data => {
        setResult(data);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [signal.long, signal.short]);

  function handleAdd() {
    const params = new URLSearchParams({
      long: signal.long,
      short: signal.short,
      theme: signal.signal_type === 'cointegration'
        ? 'Mean reversion'
        : signal.signal_type === 'valuation'
          ? 'Relative value'
          : 'Momentum divergence',
      thesis: signal.rationale,
    });
    navigate(`/spreads/new?${params.toString()}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-gh-bg border border-gh-border rounded-xl shadow-2xl w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gh-border sticky top-0 bg-gh-bg z-10">
          <div>
            <h2 className="text-lg font-semibold text-gh-text">
              Investigating: Long <span className="text-gh-green">{signal.long}</span>
              {' / '}Short <span className="text-gh-red">{signal.short}</span>
            </h2>
            <p className="text-xs text-gh-text-muted mt-0.5">{signal.rationale}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleAdd}
              className="px-4 py-2 text-sm font-medium bg-gh-accent text-white rounded-lg hover:bg-gh-accent/90 transition-colors"
            >
              Add as Spread
            </button>
            <button
              onClick={onClose}
              className="text-gh-text-muted hover:text-gh-text text-xl leading-none px-2"
            >
              x
            </button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-gh-border">
          {(['charts', 'fundamentals', 'fit'] as const).map(t => (
            <button
              key={t}
              onClick={() => setViewTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
                viewTab === t
                  ? 'border-gh-accent text-gh-accent'
                  : 'border-transparent text-gh-text-muted hover:text-gh-text',
              )}
            >
              {t === 'fit' ? 'Portfolio Fit' : t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          {loading && (
            <div className="space-y-4">
              <Skeleton className="h-72 w-full" />
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            </div>
          )}

          {error && <ErrorState message={error} />}

          {result && viewTab === 'charts' && (
            <InvestigationCharts analytics={result.analytics} long={signal.long} short={signal.short} />
          )}
          {result && viewTab === 'fundamentals' && (
            <InvestigationFundamentals fundamentals={result.fundamentals} long={signal.long} short={signal.short} />
          )}
          {result && viewTab === 'fit' && (
            <InvestigationFit constraints={result.constraints} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Investigation sub-views
// ---------------------------------------------------------------------------

function InvestigationCharts({ analytics, long, short }: { analytics: SpreadAnalytics; long: string; short: string }) {
  const pd = analytics.price_data;

  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Correlation', value: analytics.correlation?.toFixed(3) || '--' },
          { label: 'Z-Score', value: analytics.current_zscore?.toFixed(2) || '--', color: analytics.current_zscore && Math.abs(analytics.current_zscore) > 2 ? 'text-gh-red' : analytics.current_zscore && Math.abs(analytics.current_zscore) > 1 ? 'text-gh-yellow' : 'text-gh-green' },
          { label: 'Spread Sharpe', value: analytics.spread_sharpe?.toFixed(2) || '--' },
          { label: 'Half-Life', value: analytics.half_life_days ? `${analytics.half_life_days}d` : '--' },
          { label: 'Max Drawdown', value: analytics.max_drawdown_pct ? `${analytics.max_drawdown_pct.toFixed(1)}%` : '--', color: 'text-gh-red' },
        ].map(s => (
          <div key={s.label} className="p-3 bg-gh-bg-secondary border border-gh-border rounded-lg text-center">
            <div className="text-[10px] text-gh-text-muted uppercase tracking-wide mb-1">{s.label}</div>
            <div className={cn('text-lg font-bold', s.color || 'text-gh-text')}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Normalized Price Chart */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-3">
          Normalized Prices (rebased to 100)
        </h3>
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <Plot
            data={[
              {
                type: 'scatter', mode: 'lines',
                name: `Long: ${long}`,
                x: pd.dates, y: pd.long_normalized,
                line: { color: '#3fb950', width: 2 },
              },
              {
                type: 'scatter', mode: 'lines',
                name: `Short: ${short}`,
                x: pd.dates, y: pd.short_normalized,
                line: { color: '#ff7b72', width: 2 },
              },
            ]}
            layout={{ ...PLOTLY_LAYOUT, height: 320 }}
            config={PLOTLY_CONFIG}
            style={{ width: '100%' }}
          />
        </Suspense>
      </div>

      {/* Spread + Z-Score Chart */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-3">
          Cumulative Spread & Z-Score
        </h3>
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <Plot
            data={[
              {
                type: 'scatter', mode: 'lines', name: 'Spread',
                x: pd.dates, y: pd.spread,
                fill: 'tozeroy', fillcolor: 'rgba(63,185,80,0.08)',
                line: { color: '#58a6ff', width: 2 },
              },
              {
                type: 'scatter', mode: 'lines', name: 'Z-Score',
                x: pd.dates, y: pd.zscore_series,
                yaxis: 'y2',
                line: { color: '#d2a8ff', width: 1.5 },
              },
            ]}
            layout={{
              ...PLOTLY_LAYOUT,
              height: 320,
              yaxis: { ...PLOTLY_LAYOUT.yaxis, title: { text: 'Cumulative Spread' } },
              yaxis2: {
                overlaying: 'y', side: 'right',
                gridcolor: 'transparent', zerolinecolor: '#30363d',
                title: { text: 'Z-Score', font: { color: '#d2a8ff' } },
              },
              shapes: [
                { type: 'line', y0: 1, y1: 1, x0: 0, x1: 1, xref: 'paper', yref: 'y2', line: { color: '#e3b341', width: 1, dash: 'dash' } },
                { type: 'line', y0: -1, y1: -1, x0: 0, x1: 1, xref: 'paper', yref: 'y2', line: { color: '#e3b341', width: 1, dash: 'dash' } },
                { type: 'line', y0: 2, y1: 2, x0: 0, x1: 1, xref: 'paper', yref: 'y2', line: { color: '#ff7b72', width: 1, dash: 'dash' } },
                { type: 'line', y0: -2, y1: -2, x0: 0, x1: 1, xref: 'paper', yref: 'y2', line: { color: '#ff7b72', width: 1, dash: 'dash' } },
              ],
            }}
            config={PLOTLY_CONFIG}
            style={{ width: '100%' }}
          />
        </Suspense>
      </div>
    </div>
  );
}

function InvestigationFundamentals({ fundamentals, long, short }: { fundamentals: PairComparison; long: string; short: string }) {
  const categories = [
    { key: 'growth_score', label: 'Growth', max: 20 },
    { key: 'profitability_score', label: 'Profitability', max: 20 },
    { key: 'health_score', label: 'Health', max: 20 },
    { key: 'cashflow_score', label: 'Cash Flow', max: 20 },
    { key: 'valuation_score', label: 'Valuation', max: 20 },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Score comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: `Long: ${long}`, score: fundamentals.long, color: 'text-gh-green' },
          { label: `Short: ${short}`, score: fundamentals.short, color: 'text-gh-red' },
        ].map(side => (
          <div key={side.label} className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg">
            <div className={cn('text-sm font-semibold mb-3', side.color)}>{side.label}</div>
            <div className="text-3xl font-bold text-gh-text mb-3">{side.score.total_score}/100</div>
            <div className="space-y-2">
              {categories.map(c => {
                const val = side.score[c.key] as number;
                return (
                  <div key={c.key}>
                    <div className="flex justify-between text-xs text-gh-text-muted mb-0.5">
                      <span>{c.label}</span>
                      <span>{val}/{c.max}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gh-bg overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gh-accent"
                        style={{ width: `${(val / c.max) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Direction check */}
      <div className={cn(
        'p-3 rounded-lg border text-sm',
        fundamentals.direction_valid
          ? 'bg-gh-green/10 border-gh-green/30 text-gh-green'
          : 'bg-gh-red/10 border-gh-red/30 text-gh-red',
      )}>
        {fundamentals.direction_valid
          ? `Fundamentals support this direction: ${long} scores ${fundamentals.score_delta.toFixed(0)} points higher than ${short}.`
          : `Warning: ${short} actually scores higher than ${long}. Consider flipping the trade direction.`
        }
        {fundamentals.warning && <span className="block mt-1 text-gh-yellow text-xs">{fundamentals.warning}</span>}
      </div>

      {/* Key divergences */}
      {fundamentals.key_divergences.length > 0 && (
        <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-3">Key Divergences</h3>
          <div className="space-y-2">
            {fundamentals.key_divergences.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-gh-border last:border-0">
                <span className="text-gh-text-muted">{d.metric}</span>
                <div className="flex items-center gap-4">
                  <span className={d.favors === 'long' ? 'text-gh-green font-medium' : 'text-gh-text'}>{d.long}</span>
                  <span className="text-gh-text-muted text-xs">vs</span>
                  <span className={d.favors === 'short' ? 'text-gh-red font-medium' : 'text-gh-text'}>{d.short}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InvestigationFit({ constraints }: { constraints: { constraints: Array<{ name: string; current_value: number; limit: number; utilization_pct: number; status: string }>; has_violations: boolean } }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gh-text-muted">
        If you add this pair at 5% allocation per leg, here is how it affects your portfolio constraints:
      </p>

      <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
        {constraints.constraints.map(c => (
          <ConstraintBar
            key={c.name}
            name={c.name}
            current={c.current_value}
            limit={c.limit}
          />
        ))}
      </div>

      {constraints.has_violations && (
        <div className="p-3 rounded-lg bg-gh-red/10 border border-gh-red/30 text-gh-red text-sm">
          Adding this pair would violate one or more mandate constraints. You may still add it with an override.
        </div>
      )}

      {!constraints.has_violations && (
        <div className="p-3 rounded-lg bg-gh-green/10 border border-gh-green/30 text-gh-green text-sm">
          This pair fits within all mandate constraints at 5% allocation per leg.
        </div>
      )}
    </div>
  );
}
