import { useState, useCallback, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useApi } from '@/hooks/useApi';
import { getPnLLatest, getPnLHistory, uploadPnLCsv } from '@/lib/api';
import { Skeleton } from '@/components/LoadingSkeleton';
import { ErrorState } from '@/components/ErrorState';
import { InfoTip } from '@/components/Tooltip';
import { cn, fmtPct } from '@/lib/utils';
import type { PnLLatest, PnLHistory, PnLPosition } from '@/lib/types';

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  color,
  tooltip,
}: {
  label: string;
  value: string;
  color?: string;
  tooltip?: { title: string; explanation: string };
}) {
  return (
    <div className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg">
      <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-1 inline-flex items-center">
        {label}
        {tooltip && <InfoTip title={tooltip.title} explanation={tooltip.explanation} />}
      </div>
      <div className={cn('text-2xl font-bold', color || 'text-gh-text')}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV Upload Dropzone
// ---------------------------------------------------------------------------

function CsvUpload({ onUploadComplete }: { onUploadComplete: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posFile, setPosFile] = useState<File | null>(null);
  const [sumFile, setSumFile] = useState<File | null>(null);
  const [snapshotDate, setSnapshotDate] = useState('');

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv'));
    for (const f of files) {
      if (f.name.toLowerCase().includes('openposition')) setPosFile(f);
      else if (f.name.toLowerCase().includes('portfoliosummary')) setSumFile(f);
      else if (!posFile) setPosFile(f);  // default to positions if unclear
    }
  }, [posFile]);

  const handleUpload = async () => {
    if (!posFile) return;
    setUploading(true);
    setError(null);
    try {
      await uploadPnLCsv(posFile, sumFile || undefined, snapshotDate || undefined);
      setPosFile(null);
      setSumFile(null);
      setSnapshotDate('');
      onUploadComplete();
    } catch (e: any) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
      <h2 className="text-sm font-semibold text-gh-text mb-3 uppercase tracking-wide">
        Upload StockTrak CSV
      </h2>

      <div
        className={cn(
          'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
          dragging ? 'border-gh-accent bg-gh-accent/5' : 'border-gh-border',
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <p className="text-sm text-gh-text-muted mb-2">
          Drag & drop StockTrak CSVs here, or pick files below
        </p>
        <div className="flex flex-wrap gap-3 justify-center items-center">
          <label className="text-xs px-3 py-1.5 bg-gh-accent/10 text-gh-accent border border-gh-accent/30 rounded-lg hover:bg-gh-accent/20 transition-colors cursor-pointer">
            OpenPosition CSV {posFile && `(${posFile.name})`}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && setPosFile(e.target.files[0])}
            />
          </label>
          <label className="text-xs px-3 py-1.5 bg-gh-bg-tertiary text-gh-text-muted border border-gh-border rounded-lg hover:bg-gh-bg transition-colors cursor-pointer">
            PortfolioSummary CSV (optional) {sumFile && `(${sumFile.name})`}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && setSumFile(e.target.files[0])}
            />
          </label>
          <input
            type="date"
            value={snapshotDate}
            onChange={(e) => setSnapshotDate(e.target.value)}
            placeholder="Snapshot date"
            className="text-xs px-3 py-1.5 bg-gh-bg border border-gh-border rounded-lg text-gh-text"
          />
        </div>
      </div>

      {error && <p className="text-sm text-gh-red mt-2">{error}</p>}

      {posFile && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className={cn(
            'mt-3 text-sm px-4 py-2 rounded-lg transition-colors',
            uploading
              ? 'bg-gh-accent/30 text-gh-text-muted cursor-wait'
              : 'bg-gh-accent text-white hover:bg-gh-accent/90',
          )}
        >
          {uploading ? 'Uploading...' : 'Upload & Parse'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Positions Table (grouped by theme)
// ---------------------------------------------------------------------------

function PositionsTable({ positions }: { positions: PnLPosition[] }) {
  const [sortBy, setSortBy] = useState<'theme' | 'pnl'>('theme');

  const grouped = useMemo(() => {
    const groups: Record<string, PnLPosition[]> = {};
    for (const p of positions) {
      const key = p.theme || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    // Sort groups by total P&L if sorting by pnl
    const entries = Object.entries(groups);
    if (sortBy === 'pnl') {
      entries.sort((a, b) => {
        const aPnl = a[1].reduce((sum, p) => sum + p.profit_loss, 0);
        const bPnl = b[1].reduce((sum, p) => sum + p.profit_loss, 0);
        return bPnl - aPnl;
      });
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return entries;
  }, [positions, sortBy]);

  return (
    <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gh-text uppercase tracking-wide">
          Positions ({positions.length})
        </h2>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setSortBy('theme')}
            className={cn(
              'px-2 py-1 rounded',
              sortBy === 'theme' ? 'bg-gh-accent/20 text-gh-accent' : 'text-gh-text-muted hover:text-gh-text',
            )}
          >
            By Theme
          </button>
          <button
            onClick={() => setSortBy('pnl')}
            className={cn(
              'px-2 py-1 rounded',
              sortBy === 'pnl' ? 'bg-gh-accent/20 text-gh-accent' : 'text-gh-text-muted hover:text-gh-text',
            )}
          >
            By P&L
          </button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gh-bg-secondary">
            <tr className="text-xs text-gh-text-muted uppercase border-b border-gh-border">
              <th className="text-left py-2 px-2">Symbol</th>
              <th className="text-left py-2 px-2">Side</th>
              <th className="text-right py-2 px-2">Qty</th>
              <th className="text-right py-2 px-2">Price</th>
              <th className="text-right py-2 px-2">Mkt Value</th>
              <th className="text-right py-2 px-2">P&L</th>
              <th className="text-right py-2 px-2">P&L %</th>
              <th className="text-left py-2 px-2">Type</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([theme, positions]) => (
              <GroupRows key={theme} theme={theme} positions={positions} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({ theme, positions }: { theme: string; positions: PnLPosition[] }) {
  const themePnl = positions.reduce((sum, p) => sum + p.profit_loss, 0);
  return (
    <>
      <tr className="border-t border-gh-border/50">
        <td colSpan={5} className="py-2 px-2 text-xs font-semibold text-gh-accent">
          {theme}
        </td>
        <td className="py-2 px-2 text-xs font-semibold text-right">
          <span className={themePnl >= 0 ? 'text-gh-green' : 'text-gh-red'}>
            ${themePnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </td>
        <td colSpan={2} />
      </tr>
      {positions.map((p) => (
        <tr key={p.symbol} className="hover:bg-gh-bg-tertiary/50 transition-colors">
          <td className="py-1.5 px-2 font-mono text-gh-text">{p.symbol}</td>
          <td className="py-1.5 px-2">
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded',
              p.side === 'long' ? 'bg-gh-green/15 text-gh-green' : 'bg-gh-red/15 text-gh-red',
            )}>
              {p.side}
            </span>
          </td>
          <td className="py-1.5 px-2 text-right text-gh-text-muted">
            {Math.abs(p.quantity).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </td>
          <td className="py-1.5 px-2 text-right text-gh-text-muted">
            ${p.last_price.toFixed(2)}
          </td>
          <td className="py-1.5 px-2 text-right text-gh-text">
            ${p.market_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </td>
          <td className={cn('py-1.5 px-2 text-right font-medium', p.profit_loss >= 0 ? 'text-gh-green' : 'text-gh-red')}>
            ${p.profit_loss.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </td>
          <td className={cn('py-1.5 px-2 text-right', p.pnl_pct >= 0 ? 'text-gh-green' : 'text-gh-red')}>
            {fmtPct(p.pnl_pct)}
          </td>
          <td className="py-1.5 px-2 text-xs text-gh-text-muted">{p.asset_class}</td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Plotly chart config (dark theme matching the dashboard)
// ---------------------------------------------------------------------------

const PLOT_LAYOUT_BASE: Partial<Plotly.Layout> = {
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: { color: '#c9d1d9', size: 11 },
  margin: { l: 50, r: 20, t: 30, b: 40 },
  xaxis: { gridcolor: '#21262d', linecolor: '#30363d' },
  yaxis: { gridcolor: '#21262d', linecolor: '#30363d' },
};

const PLOT_CONFIG: Partial<Plotly.Config> = {
  displayModeBar: false,
  responsive: true,
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function PnLPage() {
  const {
    data: latest,
    loading: latestLoading,
    error: latestError,
    refetch: refetchLatest,
  } = useApi<PnLLatest>(() => getPnLLatest(), []);

  const {
    data: history,
    loading: historyLoading,
    refetch: refetchHistory,
  } = useApi<PnLHistory>(() => getPnLHistory(), []);

  const handleUploadComplete = () => {
    refetchLatest();
    refetchHistory();
  };

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Upload */}
      <CsvUpload onUploadComplete={handleUploadComplete} />

      {/* Loading state */}
      {latestLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {latestError && <ErrorState message={latestError} onRetry={refetchLatest} />}

      {/* No data yet */}
      {latest && !latest.has_data && (
        <div className="p-8 bg-gh-bg-secondary border border-gh-border rounded-lg text-center">
          <p className="text-gh-text-muted text-sm">{latest.message}</p>
        </div>
      )}

      {/* Data loaded */}
      {latest?.has_data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <SummaryCard
              label="Portfolio Value"
              value={`$${(latest.portfolio_value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              color="text-gh-text"
              tooltip={{ title: 'Portfolio Value', explanation: 'Total market value of all positions plus cash, as reported by StockTrak.' }}
            />
            <SummaryCard
              label="Total P&L"
              value={`$${(latest.total_pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              color={(latest.total_pnl || 0) >= 0 ? 'text-gh-green' : 'text-gh-red'}
              tooltip={{ title: 'Total P&L', explanation: 'Sum of unrealized profit/loss across all positions since entry.' }}
            />
            <SummaryCard
              label="WTD"
              value={fmtPct(latest.periods?.wtd || 0)}
              color={(latest.periods?.wtd || 0) >= 0 ? 'text-gh-green' : 'text-gh-red'}
              tooltip={{ title: 'Week-to-Date Return', explanation: 'Portfolio return since Monday of this week, computed from snapshot values.' }}
            />
            <SummaryCard
              label="MTD"
              value={fmtPct(latest.periods?.mtd || 0)}
              color={(latest.periods?.mtd || 0) >= 0 ? 'text-gh-green' : 'text-gh-red'}
              tooltip={{ title: 'Month-to-Date Return', explanation: 'Portfolio return since the 1st of this month.' }}
            />
            <SummaryCard
              label="TTD"
              value={fmtPct(latest.periods?.ttd || 0)}
              color={(latest.periods?.ttd || 0) >= 0 ? 'text-gh-green' : 'text-gh-red'}
              tooltip={{ title: 'Term-to-Date Return', explanation: 'Portfolio return since 3/31 (start of StockTrak simulation). Initial value: $1,000,000.' }}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* NAV Chart */}
            <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
              <h2 className="text-sm font-semibold text-gh-text mb-3 uppercase tracking-wide">
                Portfolio NAV
                <InfoTip
                  title="NAV Chart"
                  explanation="Net Asset Value over time, plotted from each uploaded snapshot. Upload more CSVs to fill in the timeline."
                />
              </h2>
              {historyLoading ? (
                <Skeleton className="h-[250px] w-full" />
              ) : history && history.nav_series.length > 0 ? (
                <Plot
                  data={[
                    {
                      x: history.nav_series.map(p => p.date),
                      y: history.nav_series.map(p => p.value),
                      type: 'scatter' as const,
                      mode: 'lines+markers' as const,
                      line: { color: '#58a6ff', width: 2 },
                      marker: { size: 6 },
                      name: 'NAV',
                    },
                    {
                      x: history.nav_series.map(p => p.date),
                      y: history.nav_series.map(() => history.initial_value),
                      type: 'scatter' as const,
                      mode: 'lines' as const,
                      line: { color: '#484f58', width: 1, dash: 'dot' as const },
                      name: 'Initial ($1M)',
                    },
                  ]}
                  layout={{
                    ...PLOT_LAYOUT_BASE,
                    height: 250,
                    showlegend: true,
                    legend: { x: 0, y: 1.15, orientation: 'h' as const },
                    yaxis: { ...PLOT_LAYOUT_BASE.yaxis, tickprefix: '$' },
                  }}
                  config={PLOT_CONFIG}
                  className="w-full"
                />
              ) : (
                <p className="text-sm text-gh-text-muted py-8 text-center">
                  Upload multiple snapshots to see NAV over time
                </p>
              )}
            </div>

            {/* P&L by Theme Bar Chart */}
            <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
              <h2 className="text-sm font-semibold text-gh-text mb-3 uppercase tracking-wide">
                P&L by Theme
                <InfoTip
                  title="P&L by Theme"
                  explanation="Unrealized P&L grouped by investment theme. Helps identify which theses are working and which are not."
                />
              </h2>
              {latest.pnl_by_theme && latest.pnl_by_theme.length > 0 ? (
                <Plot
                  data={[
                    {
                      x: latest.pnl_by_theme.map(t => t.theme),
                      y: latest.pnl_by_theme.map(t => t.pnl),
                      type: 'bar' as const,
                      marker: {
                        color: latest.pnl_by_theme.map(t => t.pnl >= 0 ? '#3fb950' : '#f85149'),
                      },
                    },
                  ]}
                  layout={{
                    ...PLOT_LAYOUT_BASE,
                    height: 250,
                    showlegend: false,
                    xaxis: { ...PLOT_LAYOUT_BASE.xaxis, tickangle: -35 },
                    yaxis: { ...PLOT_LAYOUT_BASE.yaxis, tickprefix: '$' },
                  }}
                  config={PLOT_CONFIG}
                  className="w-full"
                />
              ) : (
                <p className="text-sm text-gh-text-muted py-8 text-center">No theme data</p>
              )}
            </div>
          </div>

          {/* P&L by Asset Class */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
              <h2 className="text-sm font-semibold text-gh-text mb-3 uppercase tracking-wide">
                P&L by Asset Class
                <InfoTip
                  title="Asset Class Breakdown"
                  explanation="P&L split by asset type: equity, ETF, option, FX, futures. Shows diversification across the multi-asset mandate."
                />
              </h2>
              {latest.pnl_by_asset_class && latest.pnl_by_asset_class.length > 0 ? (
                <Plot
                  data={[
                    {
                      labels: latest.pnl_by_asset_class.map(a => a.asset_class),
                      values: latest.pnl_by_asset_class.map(a => a.market_value),
                      type: 'pie' as const,
                      hole: 0.4,
                      textinfo: 'label+percent' as const,
                      marker: {
                        colors: ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#79c0ff'],
                      },
                    },
                  ]}
                  layout={{
                    ...PLOT_LAYOUT_BASE,
                    height: 250,
                    showlegend: false,
                  }}
                  config={PLOT_CONFIG}
                  className="w-full"
                />
              ) : (
                <p className="text-sm text-gh-text-muted py-8 text-center">No asset class data</p>
              )}
            </div>

            {/* Snapshot Info */}
            <div className="lg:col-span-2 p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
              <h2 className="text-sm font-semibold text-gh-text mb-3 uppercase tracking-wide">
                Snapshot Info
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gh-text-muted">Date:</span>{' '}
                  <span className="text-gh-text">{latest.upload_date}</span>
                </div>
                <div>
                  <span className="text-gh-text-muted">Positions:</span>{' '}
                  <span className="text-gh-text">{latest.num_positions}</span>
                </div>
                <div>
                  <span className="text-gh-text-muted">Snapshots:</span>{' '}
                  <span className="text-gh-text">{history?.num_snapshots ?? '...'}</span>
                </div>
                <div>
                  <span className="text-gh-text-muted">Total P&L %:</span>{' '}
                  <span className={(latest.total_pnl_pct || 0) >= 0 ? 'text-gh-green' : 'text-gh-red'}>
                    {fmtPct(latest.total_pnl_pct || 0)}
                  </span>
                </div>
              </div>

              {/* Quick theme summary table */}
              {latest.pnl_by_theme && latest.pnl_by_theme.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gh-text-muted uppercase border-b border-gh-border">
                        <th className="text-left py-1.5">Theme</th>
                        <th className="text-right py-1.5">P&L</th>
                        <th className="text-right py-1.5">P&L %</th>
                        <th className="text-right py-1.5">Mkt Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.pnl_by_theme.map(t => (
                        <tr key={t.theme} className="border-b border-gh-border/30 hover:bg-gh-bg-tertiary/50">
                          <td className="py-1.5 text-gh-text">{t.theme}</td>
                          <td className={cn('py-1.5 text-right', t.pnl >= 0 ? 'text-gh-green' : 'text-gh-red')}>
                            ${t.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td className={cn('py-1.5 text-right', t.pnl_pct >= 0 ? 'text-gh-green' : 'text-gh-red')}>
                            {fmtPct(t.pnl_pct)}
                          </td>
                          <td className="py-1.5 text-right text-gh-text-muted">
                            ${t.market_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Positions Table */}
          {latest.positions && latest.positions.length > 0 && (
            <PositionsTable positions={latest.positions} />
          )}
        </>
      )}
    </div>
  );
}
