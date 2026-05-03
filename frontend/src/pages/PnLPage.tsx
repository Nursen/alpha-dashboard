import { useState, useCallback, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useApi } from '@/hooks/useApi';
import { getPnLLatest, getPnLHistory, uploadPnLCsv, uploadTradeNotes, getTrades, getExtractedSpreads } from '@/lib/api';
import { Skeleton } from '@/components/LoadingSkeleton';
import { ErrorState } from '@/components/ErrorState';
import { InfoTip } from '@/components/Tooltip';
import { cn, fmtPct } from '@/lib/utils';
import type { PnLLatest, PnLHistory, PnLPosition, TradesResponse, SpreadsExtractedResponse, TradeNote, ExtractedSpread } from '@/lib/types';

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

type PnLSortKey = 'symbol' | 'description' | 'side' | 'quantity' | 'last_price' | 'market_value' | 'profit_loss' | 'pnl_pct' | 'asset_class' | 'theme';

function PositionsTable({ positions }: { positions: PnLPosition[] }) {
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [sortKey, setSortKey] = useState<PnLSortKey>('profit_loss');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key: PnLSortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const flatSorted = useMemo(() => {
    return [...positions].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [positions, sortKey, sortAsc]);

  const grouped = useMemo(() => {
    const groups: Record<string, PnLPosition[]> = {};
    for (const p of positions) {
      const key = p.theme || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    const entries = Object.entries(groups);
    entries.sort((a, b) => {
      const aPnl = a[1].reduce((sum, p) => sum + p.profit_loss, 0);
      const bPnl = b[1].reduce((sum, p) => sum + p.profit_loss, 0);
      return bPnl - aPnl;
    });
    return entries;
  }, [positions]);

  const SortTh = ({ k, label, align = 'left' }: { k: PnLSortKey; label: string; align?: string }) => (
    <th
      className={cn(
        'py-2 px-2 text-xs font-medium text-gh-text-muted uppercase cursor-pointer hover:text-gh-text transition-colors select-none',
        align === 'right' ? 'text-right' : 'text-left',
      )}
      onClick={() => { setViewMode('flat'); handleSort(k); }}
    >
      {label} {viewMode === 'flat' && sortKey === k ? (sortAsc ? '(asc)' : '(desc)') : ''}
    </th>
  );

  return (
    <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gh-text uppercase tracking-wide">
          Positions ({positions.length})
        </h2>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setViewMode('grouped')}
            className={cn(
              'px-2 py-1 rounded',
              viewMode === 'grouped' ? 'bg-gh-accent/20 text-gh-accent' : 'text-gh-text-muted hover:text-gh-text',
            )}
          >
            By Theme
          </button>
          <button
            onClick={() => setViewMode('flat')}
            className={cn(
              'px-2 py-1 rounded',
              viewMode === 'flat' ? 'bg-gh-accent/20 text-gh-accent' : 'text-gh-text-muted hover:text-gh-text',
            )}
          >
            Flat (sortable)
          </button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gh-bg-secondary">
            <tr className="border-b border-gh-border">
              <SortTh k="symbol" label="Symbol" />
              <SortTh k="description" label="Name" />
              <SortTh k="side" label="Side" />
              <SortTh k="quantity" label="Qty" align="right" />
              <SortTh k="last_price" label="Price" align="right" />
              <SortTh k="market_value" label="Mkt Value" align="right" />
              <SortTh k="profit_loss" label="P&L" align="right" />
              <SortTh k="pnl_pct" label="P&L %" align="right" />
              <SortTh k="asset_class" label="Type" />
            </tr>
          </thead>
          <tbody>
            {viewMode === 'grouped' ? (
              grouped.map(([theme, themePositions]) => (
                <GroupRows key={theme} theme={theme} positions={themePositions} />
              ))
            ) : (
              flatSorted.map((p) => (
                <FlatRow key={p.symbol} p={p} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FlatRow({ p }: { p: PnLPosition }) {
  return (
    <tr className="hover:bg-gh-bg-tertiary/50 transition-colors">
      <td className="py-1.5 px-2 font-mono text-gh-text">{p.symbol}</td>
      <td className="py-1.5 px-2 text-gh-text-muted text-xs truncate max-w-[120px]" title={p.description}>{p.description || '--'}</td>
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
      <td className="py-1.5 px-2 text-right text-gh-text-muted">${p.last_price.toFixed(2)}</td>
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
  );
}

function GroupRows({ theme, positions }: { theme: string; positions: PnLPosition[] }) {
  const themePnl = positions.reduce((sum, p) => sum + p.profit_loss, 0);
  return (
    <>
      <tr className="border-t border-gh-border/50">
        <td colSpan={6} className="py-2 px-2 text-xs font-semibold text-gh-accent">
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
          <td className="py-1.5 px-2 text-gh-text-muted text-xs truncate max-w-[120px]" title={p.description}>{p.description || '--'}</td>
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
// Trade Journal — Timeline + Spreads
// ---------------------------------------------------------------------------

function sideColor(side: string): string {
  if (side === 'buy') return 'bg-gh-green/15 text-gh-green';
  if (side === 'short') return 'bg-gh-red/15 text-gh-red';
  return 'bg-gh-bg-tertiary text-gh-text-muted'; // sell, cover
}

function sideLabel(side: string): string {
  const map: Record<string, string> = { buy: 'BUY', short: 'SHORT', sell: 'SELL', cover: 'COVER' };
  return map[side] || side.toUpperCase();
}

function formatTradeDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function TradeTimeline({ trades }: { trades: TradeNote[] }) {
  const [filter, setFilter] = useState<'all' | 'ic' | 'corrections'>('all');

  const filtered = useMemo(() => {
    if (filter === 'ic') return trades.filter(t => t.ic_rejected);
    if (filter === 'corrections') return trades.filter(t => t.is_correction);
    return trades;
  }, [trades, filter]);

  // Group by date (day)
  const grouped = useMemo(() => {
    const groups: Record<string, TradeNote[]> = {};
    for (const t of filtered) {
      const day = t.trade_date.slice(0, 10);
      if (!groups[day]) groups[day] = [];
      groups[day].push(t);
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  return (
    <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gh-text uppercase tracking-wide">
          Trade Timeline ({filtered.length} trades)
        </h2>
        <div className="flex gap-2 text-xs">
          {(['all', 'ic', 'corrections'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-2 py-1 rounded',
                filter === f ? 'bg-gh-accent/20 text-gh-accent' : 'text-gh-text-muted hover:text-gh-text',
              )}
            >
              {f === 'all' ? 'All' : f === 'ic' ? 'IC Rejected' : 'Corrections'}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[600px] overflow-y-auto space-y-4">
        {grouped.map(([day, dayTrades]) => (
          <div key={day}>
            <div className="text-xs text-gh-text-muted font-semibold mb-2 sticky top-0 bg-gh-bg-secondary py-1">
              {new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <div className="space-y-1.5">
              {dayTrades.map((t, i) => (
                <div
                  key={`${t.symbol}-${i}`}
                  className={cn(
                    'flex items-start gap-3 p-2.5 rounded-lg border transition-colors',
                    t.ic_rejected ? 'border-gh-yellow/40 bg-gh-yellow/5' :
                    t.is_correction ? 'border-gh-red/30 bg-gh-red/5' :
                    'border-gh-border/50 hover:bg-gh-bg-tertiary/50',
                  )}
                >
                  {/* Side badge */}
                  <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5', sideColor(t.side))}>
                    {sideLabel(t.side)}
                  </span>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-gh-text">{t.symbol}</span>
                      {t.pair_symbol && (
                        <span className="text-xs text-gh-accent">
                          &harr; {t.pair_symbol}
                        </span>
                      )}
                      {t.theme !== 'Other' && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-gh-accent/10 text-gh-accent rounded">
                          {t.theme}
                        </span>
                      )}
                      {t.ic_rejected && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-gh-yellow/20 text-gh-yellow rounded font-semibold">
                          IC REJECTED
                        </span>
                      )}
                      {t.is_correction && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-gh-red/20 text-gh-red rounded font-semibold">
                          CORRECTION
                        </span>
                      )}
                    </div>
                    {t.note && (
                      <p className="text-xs text-gh-text-muted mt-1 line-clamp-2">{t.note}</p>
                    )}
                  </div>

                  {/* Time */}
                  <span className="text-[10px] text-gh-text-muted shrink-0">
                    {formatTradeDate(t.trade_date)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpreadsList({ spreads }: { spreads: ExtractedSpread[] }) {
  return (
    <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
      <h2 className="text-sm font-semibold text-gh-text mb-4 uppercase tracking-wide">
        Extracted Pairs ({spreads.length})
        <InfoTip
          title="Pair Extraction"
          explanation="Spread pairs automatically extracted from your trade notes. These are inferred from keywords like 'paired with', 'pair trade with', and 'long/short' patterns in the note text."
        />
      </h2>

      <div className="space-y-3">
        {spreads.map((s, i) => (
          <div key={i} className="p-3 border border-gh-border/50 rounded-lg hover:bg-gh-bg-tertiary/50 transition-colors">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-sm font-semibold text-gh-green">{s.long_symbol}</span>
              <span className="text-gh-text-muted text-xs">&harr;</span>
              <span className="font-mono text-sm font-semibold text-gh-red">{s.short_symbol}</span>
              {s.theme !== 'Other' && (
                <span className="text-[10px] px-1.5 py-0.5 bg-gh-accent/10 text-gh-accent rounded ml-auto">
                  {s.theme}
                </span>
              )}
            </div>
            {s.notes.length > 0 && (
              <p className="text-xs text-gh-text-muted line-clamp-2">
                {s.notes[0]}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TradeNotesUpload({ onUploadComplete }: { onUploadComplete: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ num_trades: number; num_spreads: number; ic_rejections: number; corrections: number } | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadTradeNotes(file);
      setResult(res);
      onUploadComplete();
    } catch (e: any) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg">
      <div className="flex items-center gap-3">
        <label className={cn(
          'text-xs px-3 py-1.5 border rounded-lg transition-colors cursor-pointer',
          uploading
            ? 'bg-gh-accent/10 text-gh-text-muted border-gh-border cursor-wait'
            : 'bg-gh-accent/10 text-gh-accent border-gh-accent/30 hover:bg-gh-accent/20',
        )}>
          {uploading ? 'Uploading...' : 'Upload TradeNotes CSV'}
          <input
            type="file"
            accept=".csv"
            className="hidden"
            disabled={uploading}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>
        {result && (
          <span className="text-xs text-gh-text-muted">
            Parsed {result.num_trades} trades, {result.num_spreads} pairs, {result.ic_rejections} IC rejections
          </span>
        )}
        {error && <span className="text-xs text-gh-red">{error}</span>}
      </div>
    </div>
  );
}

function TradeJournalTab() {
  const {
    data: tradesData,
    loading: tradesLoading,
    error: tradesError,
    refetch: refetchTrades,
  } = useApi<TradesResponse>(() => getTrades(), []);

  const {
    data: spreadsData,
    loading: spreadsLoading,
    refetch: refetchSpreads,
  } = useApi<SpreadsExtractedResponse>(() => getExtractedSpreads(), []);

  const handleUploadComplete = () => {
    refetchTrades();
    refetchSpreads();
  };

  return (
    <div className="space-y-6">
      <TradeNotesUpload onUploadComplete={handleUploadComplete} />

      {tradesLoading && (
        <div className="p-8 bg-gh-bg-secondary border border-gh-border rounded-lg">
          <Skeleton className="h-4 w-32 mb-3" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {tradesError && <ErrorState message={tradesError} onRetry={refetchTrades} />}

      {tradesData && !tradesData.has_data && (
        <div className="p-8 bg-gh-bg-secondary border border-gh-border rounded-lg text-center">
          <p className="text-gh-text-muted text-sm">
            No trade notes uploaded yet. Upload a StockTrak TradeNotes CSV to see your trade journal.
          </p>
        </div>
      )}

      {tradesData?.has_data && (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryCard
              label="Total Trades"
              value={String(tradesData.num_trades)}
              tooltip={{ title: 'Total Trades', explanation: 'Total number of trade entries in the uploaded TradeNotes CSV.' }}
            />
            <SummaryCard
              label="IC Rejections"
              value={String(tradesData.ic_rejections)}
              color={tradesData.ic_rejections > 0 ? 'text-gh-yellow' : 'text-gh-text'}
              tooltip={{ title: 'IC Rejections', explanation: 'Trades flagged as "Did not pass IC" or "Not approved by IC" -- positions that were reversed after Investment Committee review.' }}
            />
            <SummaryCard
              label="Pairs Identified"
              value={String(spreadsData?.num_spreads ?? '...')}
              color="text-gh-accent"
              tooltip={{ title: 'Pairs Identified', explanation: 'Spread pairs automatically extracted from note text. Look for "paired with", "pair trade with", and "long/short" patterns.' }}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Trade Timeline — takes 2/3 */}
            <div className="lg:col-span-2">
              <TradeTimeline trades={tradesData.trades} />
            </div>

            {/* Extracted Spreads — takes 1/3 */}
            <div>
              {spreadsLoading ? (
                <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
                  <Skeleton className="h-4 w-32 mb-3" />
                  <Skeleton className="h-40 w-full" />
                </div>
              ) : spreadsData?.has_data ? (
                <SpreadsList spreads={spreadsData.spreads} />
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

type PnLTab = 'portfolio' | 'journal';

export function PnLPage() {
  const [activeTab, setActiveTab] = useState<PnLTab>('portfolio');

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
      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-gh-border">
        <button
          onClick={() => setActiveTab('portfolio')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'portfolio'
              ? 'border-gh-accent text-gh-accent'
              : 'border-transparent text-gh-text-muted hover:text-gh-text',
          )}
        >
          Portfolio P&L
        </button>
        <button
          onClick={() => setActiveTab('journal')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'journal'
              ? 'border-gh-accent text-gh-accent'
              : 'border-transparent text-gh-text-muted hover:text-gh-text',
          )}
        >
          Trade Journal
        </button>
      </div>

      {/* Trade Journal Tab */}
      {activeTab === 'journal' && <TradeJournalTab />}

      {/* Portfolio P&L Tab */}
      {activeTab === 'portfolio' && (
        <>
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
        </>
      )}
    </div>
  );
}
