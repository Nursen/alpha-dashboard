import { useState, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@/hooks/useApi';
import { getSpreads, getPortfolioSummary } from '@/lib/api';
import { ConstraintBar } from '@/components/ConstraintBar';
import { Skeleton, TableSkeleton } from '@/components/LoadingSkeleton';
import { ErrorState } from '@/components/ErrorState';
import { cn } from '@/lib/utils';
import type { Spread, PortfolioSummary } from '@/lib/types';

// Lazy load Plotly to keep initial bundle small
const Plot = lazy(() => import('react-plotly.js'));

type FilterTab = 'all' | 'active' | 'closed';
type SortKey = 'theme' | 'asset_class' | 'long_alloc' | 'short_alloc' | 'status' | 'entry_date';

export function PortfolioPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<FilterTab>('all');
  const [sortKey, setSortKey] = useState<SortKey>('entry_date');
  const [sortAsc, setSortAsc] = useState(false);

  const { data: spreads, loading, error, refetch } = useApi<Spread[]>(() => getSpreads(), []);
  const { data: summary } = useApi<PortfolioSummary>(() => getPortfolioSummary(), []);

  const filtered = useMemo(() => {
    if (!spreads) return [];
    let list = [...spreads];
    if (tab !== 'all') list = list.filter(s => s.status === tab);

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'theme': cmp = a.theme.localeCompare(b.theme); break;
        case 'asset_class': cmp = a.asset_class.localeCompare(b.asset_class); break;
        case 'long_alloc': cmp = a.long_leg.allocation_pct - b.long_leg.allocation_pct; break;
        case 'short_alloc': cmp = a.short_leg.allocation_pct - b.short_leg.allocation_pct; break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'entry_date': cmp = a.entry_date.localeCompare(b.entry_date); break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [spreads, tab, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  // Build exposure breakdown data for Plotly
  const chartData = useMemo(() => {
    if (!spreads) return null;
    const activeSpreads = spreads.filter(s => s.status === 'active');
    const classes = [...new Set(activeSpreads.map(s => s.asset_class))];

    const longByClass = classes.map(ac =>
      activeSpreads.filter(s => s.asset_class === ac).reduce((sum, s) => sum + s.long_leg.allocation_pct, 0)
    );
    const shortByClass = classes.map(ac =>
      activeSpreads.filter(s => s.asset_class === ac).reduce((sum, s) => sum + s.short_leg.allocation_pct, 0)
    );

    return { classes, longByClass, shortByClass };
  }, [spreads]);

  const SortHeader = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <th
      onClick={() => handleSort(sortKeyVal)}
      className="px-4 py-3 text-left text-xs font-medium text-gh-text-muted uppercase tracking-wide cursor-pointer hover:text-gh-text transition-colors select-none"
    >
      {label}
      {sortKey === sortKeyVal && (
        <span className="ml-1">{sortAsc ? '\u25B2' : '\u25BC'}</span>
      )}
    </th>
  );

  return (
    <div className="max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main content — 3 columns */}
        <div className="lg:col-span-3 space-y-6">
          {/* Filter tabs */}
          <div className="flex gap-1 bg-gh-bg-secondary p-1 rounded-lg border border-gh-border w-fit">
            {(['all', 'active', 'closed'] as FilterTab[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'px-4 py-1.5 text-sm rounded-md transition-colors capitalize',
                  tab === t
                    ? 'bg-gh-accent/15 text-gh-accent'
                    : 'text-gh-text-muted hover:text-gh-text',
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Table */}
          {loading ? (
            <TableSkeleton rows={5} />
          ) : error ? (
            <ErrorState message={error} onRetry={refetch} />
          ) : (
            <div className="bg-gh-bg-secondary border border-gh-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gh-border">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gh-text-muted uppercase tracking-wide">
                        Pair
                      </th>
                      <SortHeader label="Asset Class" sortKeyVal="asset_class" />
                      <SortHeader label="Theme" sortKeyVal="theme" />
                      <SortHeader label="Long %" sortKeyVal="long_alloc" />
                      <SortHeader label="Short %" sortKeyVal="short_alloc" />
                      <SortHeader label="Status" sortKeyVal="status" />
                      <SortHeader label="Entry" sortKeyVal="entry_date" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gh-border">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gh-text-muted text-sm">
                          No spreads found
                        </td>
                      </tr>
                    ) : (
                      filtered.map(s => (
                        <tr
                          key={s.id}
                          onClick={() => navigate(`/spreads/${s.id}`)}
                          className="hover:bg-gh-bg-tertiary transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3 text-sm font-medium text-gh-text whitespace-nowrap">
                            {s.long_leg.tickers.join(',')} / {s.short_leg.tickers.join(',')}
                          </td>
                          <td className="px-4 py-3 text-sm text-gh-text-muted">{s.asset_class}</td>
                          <td className="px-4 py-3 text-sm text-gh-text-muted truncate max-w-[200px]">{s.theme}</td>
                          <td className="px-4 py-3 text-sm text-gh-green">{s.long_leg.allocation_pct}%</td>
                          <td className="px-4 py-3 text-sm text-gh-red">{s.short_leg.allocation_pct}%</td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              'text-xs px-2 py-0.5 rounded-full',
                              s.status === 'active'
                                ? 'bg-gh-green/10 text-gh-green border border-gh-green/30'
                                : 'bg-gh-border/50 text-gh-text-muted border border-gh-border',
                            )}>
                              {s.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gh-text-muted">{s.entry_date}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Exposure Breakdown Chart */}
          {chartData && chartData.classes.length > 0 && (
            <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gh-text mb-4 uppercase tracking-wide">
                Exposure by Asset Class
              </h2>
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                <Plot
                  data={[
                    {
                      type: 'bar',
                      name: 'Long',
                      x: chartData.classes,
                      y: chartData.longByClass,
                      marker: { color: '#3fb950' },
                    },
                    {
                      type: 'bar',
                      name: 'Short',
                      x: chartData.classes,
                      y: chartData.shortByClass.map(v => -v),
                      marker: { color: '#ff7b72' },
                    },
                  ]}
                  layout={{
                    barmode: 'relative',
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    font: { color: '#8b949e', size: 12 },
                    margin: { t: 10, b: 40, l: 50, r: 20 },
                    height: 280,
                    xaxis: {
                      gridcolor: '#30363d',
                      zerolinecolor: '#30363d',
                    },
                    yaxis: {
                      title: { text: 'Allocation %' },
                      gridcolor: '#30363d',
                      zerolinecolor: '#e6edf3',
                      zerolinewidth: 1,
                    },
                    legend: {
                      orientation: 'h',
                      x: 0.5,
                      xanchor: 'center',
                      y: 1.15,
                    },
                    showlegend: true,
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: '100%' }}
                />
              </Suspense>
            </div>
          )}
        </div>

        {/* Sidebar summary */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 space-y-4">
            {/* Exposure summary */}
            <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
              <h2 className="text-sm font-semibold text-gh-text mb-3 uppercase tracking-wide">
                Summary
              </h2>
              {summary ? (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gh-text-muted">Net Exposure</span>
                    <span className="text-gh-text font-medium">
                      {summary.net_exposure_pct >= 0 ? '+' : ''}{summary.net_exposure_pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gh-text-muted">Gross Exposure</span>
                    <span className="text-gh-text font-medium">{summary.gross_exposure_pct.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gh-text-muted">Long</span>
                    <span className="text-gh-green">{summary.total_long_pct.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gh-text-muted">Short</span>
                    <span className="text-gh-red">{summary.total_short_pct.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gh-text-muted">Positions</span>
                    <span className="text-gh-text">{summary.num_spreads}</span>
                  </div>
                </div>
              ) : (
                <Skeleton className="h-32 w-full" />
              )}
            </div>

            {/* Compact constraints */}
            {summary?.constraints && summary.constraints.length > 0 && (
              <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
                <h2 className="text-sm font-semibold text-gh-text mb-3 uppercase tracking-wide">
                  Constraints
                </h2>
                {summary.constraints.map(c => (
                  <ConstraintBar
                    key={c.name}
                    name={c.name}
                    current={c.current_value}
                    limit={c.limit}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
