import { useState, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '@/hooks/useApi';
import {
  getSpread,
  getSpreadAnalytics,
  getFundamentalComparison,
  getPortfolioSummary,
  addNote,
} from '@/lib/api';
import { ConstraintBar } from '@/components/ConstraintBar';
import { Skeleton } from '@/components/LoadingSkeleton';
import { ErrorState } from '@/components/ErrorState';
import { useToast } from '@/components/Toast';
import { cn, fmtPct } from '@/lib/utils';
import { InfoTip } from '@/components/Tooltip';
import {
  STAT_TOOLTIPS,
  CHART_DESCRIPTIONS,
  FUNDAMENTALS_TOOLTIPS,
  RISK_TOOLTIPS,
} from '@/lib/tooltips';
import type {
  Spread,
  SpreadAnalytics,
  PairComparison,
  PortfolioSummary,
} from '@/lib/types';

const Plot = lazy(() => import('react-plotly.js'));

type Tab = 'charts' | 'fundamentals' | 'risk' | 'notes';

const TABS: { key: Tab; label: string }[] = [
  { key: 'charts', label: 'Charts' },
  { key: 'fundamentals', label: 'Fundamentals' },
  { key: 'risk', label: 'Risk' },
  { key: 'notes', label: 'Notes & Thesis' },
];

// Shared Plotly layout defaults
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

function zscoreLabel(z: number | null): { text: string; color: string } {
  if (z === null) return { text: 'N/A', color: 'text-gh-text-muted' };
  const abs = Math.abs(z);
  if (abs > 2) return { text: 'Extreme', color: 'text-gh-red' };
  if (abs > 1) return { text: 'Trending', color: 'text-gh-yellow' };
  return { text: 'Mean-reverting', color: 'text-gh-green' };
}

function StatCard({ label, value, color, sub, tooltip }: {
  label: string; value: string; color?: string; sub?: string;
  tooltip?: { title: string; explanation: string; source?: string };
}) {
  return (
    <div className="p-3 bg-gh-bg border border-gh-border rounded-lg text-center min-w-[120px]">
      <div className="text-[10px] text-gh-text-muted uppercase tracking-wide mb-1 inline-flex items-center justify-center">
        {label}
        {tooltip && <InfoTip title={tooltip.title} explanation={tooltip.explanation} source={tooltip.source} />}
      </div>
      <div className={cn('text-lg font-bold', color || 'text-gh-text')}>{value}</div>
      {sub && <div className="text-[10px] text-gh-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function fmtNum(v: number | null | undefined, decimals = 2, suffix = ''): string {
  if (v === null || v === undefined) return '--';
  return v.toFixed(decimals) + suffix;
}

function fmtBigNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  if (Math.abs(v) >= 1e12) return (v / 1e12).toFixed(1) + 'T';
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function daysBetween(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Tab components
// ---------------------------------------------------------------------------

function ChartsTab({ analytics, spread }: { analytics: SpreadAnalytics; spread: Spread }) {
  const pd = analytics.price_data;
  const rc = analytics.rolling_correlation;
  const longLabel = spread.long_leg.tickers.join('+');
  const shortLabel = spread.short_leg.tickers.join('+');
  const zInfo = zscoreLabel(analytics.current_zscore);

  return (
    <div className="space-y-6">
      {/* Normalized Price Chart */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-1">
          Normalized Prices (rebased to 100)
        </h3>
        <p className="text-[11px] text-gh-text-muted/70 mb-3 leading-relaxed">{CHART_DESCRIPTIONS.normalizedPrice}</p>
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <Plot
            data={[
              {
                type: 'scatter',
                mode: 'lines',
                name: `Long: ${longLabel}`,
                x: pd.dates,
                y: pd.long_normalized,
                line: { color: '#3fb950', width: 2 },
              },
              {
                type: 'scatter',
                mode: 'lines',
                name: `Short: ${shortLabel}`,
                x: pd.dates,
                y: pd.short_normalized,
                line: { color: '#ff7b72', width: 2 },
              },
            ]}
            layout={{
              ...PLOTLY_LAYOUT,
              height: 320,
              shapes: [
                {
                  type: 'line',
                  x0: spread.entry_date,
                  x1: spread.entry_date,
                  y0: 0,
                  y1: 1,
                  yref: 'paper',
                  line: { color: '#8b949e', width: 1, dash: 'dash' },
                },
              ],
              annotations: [
                {
                  x: spread.entry_date,
                  y: 1,
                  yref: 'paper',
                  text: 'Entry',
                  showarrow: false,
                  font: { color: '#8b949e', size: 10 },
                  yanchor: 'bottom',
                },
              ],
            }}
            config={PLOTLY_CONFIG}
            style={{ width: '100%' }}
          />
        </Suspense>
      </div>

      {/* Spread / Z-Score Chart */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-1">
          Cumulative Spread & Z-Score
        </h3>
        <p className="text-[11px] text-gh-text-muted/70 mb-3 leading-relaxed">{CHART_DESCRIPTIONS.spread}</p>
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <Plot
            data={[
              {
                type: 'scatter',
                mode: 'lines',
                name: 'Spread',
                x: pd.dates,
                y: pd.spread,
                fill: 'tozeroy',
                fillcolor: 'rgba(63,185,80,0.08)',
                line: { color: '#58a6ff', width: 2 },
              },
              {
                type: 'scatter',
                mode: 'lines',
                name: 'Z-Score',
                x: pd.dates,
                y: pd.zscore_series,
                yaxis: 'y2',
                line: { color: '#d2a8ff', width: 1.5 },
              },
            ]}
            layout={{
              ...PLOTLY_LAYOUT,
              height: 320,
              yaxis: {
                ...PLOTLY_LAYOUT.yaxis,
                title: { text: 'Cumulative Spread' },
              },
              yaxis2: {
                overlaying: 'y',
                side: 'right',
                gridcolor: 'transparent',
                zerolinecolor: '#30363d',
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

      {/* Bottom row: rolling corr + mini stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rolling Correlation */}
        <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-1">
            Rolling 60-Day Correlation
          </h3>
          <p className="text-[11px] text-gh-text-muted/70 mb-3 leading-relaxed">{CHART_DESCRIPTIONS.rollingCorrelation}</p>
          <Suspense fallback={<Skeleton className="h-52 w-full" />}>
            <Plot
              data={[
                {
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Rolling Corr',
                  x: rc.dates,
                  y: rc.values,
                  line: { color: '#58a6ff', width: 2 },
                },
              ]}
              layout={{
                ...PLOTLY_LAYOUT,
                height: 240,
                showlegend: false,
                shapes: analytics.correlation !== null ? [
                  {
                    type: 'line',
                    y0: analytics.correlation,
                    y1: analytics.correlation,
                    x0: 0,
                    x1: 1,
                    xref: 'paper',
                    line: { color: '#8b949e', width: 1, dash: 'dot' },
                  },
                ] : [],
              }}
              config={PLOTLY_CONFIG}
              style={{ width: '100%' }}
            />
          </Suspense>
        </div>

        {/* Mini Summary Stats */}
        <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-4">
            Pair Statistics
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gh-text-muted inline-flex items-center">Correlation<InfoTip {...STAT_TOOLTIPS.correlation} /></span>
              <span className="text-gh-text font-medium">{fmtNum(analytics.correlation, 3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gh-text-muted inline-flex items-center">Long Beta (SPY)<InfoTip {...RISK_TOOLTIPS.beta} /></span>
              <span className="text-gh-text font-medium">{fmtNum(analytics.beta_long, 3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gh-text-muted">Short Beta (SPY)</span>
              <span className="text-gh-text font-medium">{fmtNum(analytics.beta_short, 3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gh-text-muted">Net Beta</span>
              <span className={cn(
                'font-medium',
                analytics.net_beta !== null && Math.abs(analytics.net_beta) < 0.3
                  ? 'text-gh-green'
                  : 'text-gh-yellow',
              )}>
                {fmtNum(analytics.net_beta, 3)}
              </span>
            </div>
            <div className="border-t border-gh-border my-2" />
            <div className="flex justify-between">
              <span className="text-gh-text-muted">Ann. Return</span>
              <span className="text-gh-text font-medium">
                {analytics.spread_ann_return !== null
                  ? fmtPct(analytics.spread_ann_return * 100)
                  : '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gh-text-muted">Ann. Volatility</span>
              <span className="text-gh-text font-medium">
                {analytics.spread_ann_vol !== null
                  ? fmtPct(analytics.spread_ann_vol * 100)
                  : '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gh-text-muted inline-flex items-center">Sharpe Ratio<InfoTip {...STAT_TOOLTIPS.spreadSharpe} /></span>
              <span className={cn(
                'font-medium',
                analytics.spread_sharpe !== null && analytics.spread_sharpe > 1
                  ? 'text-gh-green'
                  : analytics.spread_sharpe !== null && analytics.spread_sharpe > 0
                    ? 'text-gh-yellow'
                    : 'text-gh-red',
              )}>
                {fmtNum(analytics.spread_sharpe, 2)}
              </span>
            </div>
            <div className="border-t border-gh-border my-2" />
            <div className="flex justify-between">
              <span className="text-gh-text-muted inline-flex items-center">Current Z-Score<InfoTip {...STAT_TOOLTIPS.zscore} /></span>
              <span className={cn('font-medium', zInfo.color)}>
                {fmtNum(analytics.current_zscore, 2)} ({zInfo.text})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gh-text-muted inline-flex items-center">Half-Life<InfoTip {...RISK_TOOLTIPS.halfLife} /></span>
              <span className="text-gh-text font-medium">
                {analytics.half_life_days ? `${analytics.half_life_days} days` : '--'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FundamentalsTab({ spread }: { spread: Spread }) {
  const longTicker = spread.long_leg.tickers[0];
  const shortTicker = spread.short_leg.tickers[0];
  const isBasket = spread.long_leg.tickers.length > 1 || spread.short_leg.tickers.length > 1;

  const { data: comp, loading, error, refetch } = useApi<PairComparison>(
    () => getFundamentalComparison(longTicker, shortTicker),
    [longTicker, shortTicker],
  );

  if (loading) return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!comp) return null;

  const categories = [
    { key: 'growth_score', label: 'Growth', max: 20 },
    { key: 'profitability_score', label: 'Profitability', max: 20 },
    { key: 'health_score', label: 'Health', max: 20 },
    { key: 'cashflow_score', label: 'Cash Flow', max: 20 },
    { key: 'valuation_score', label: 'Valuation', max: 20 },
  ] as const;

  // Determine cell color for side-by-side: which side does the metric favor?
  const inversMetrics = new Set(['Debt/Equity', 'P/E']);
  function cellColor(metric: string, longVal: number | null, shortVal: number | null, side: 'long' | 'short') {
    if (longVal === null || shortVal === null) return '';
    const isInverse = inversMetrics.has(metric);
    const longBetter = isInverse ? longVal < shortVal : longVal > shortVal;
    if (side === 'long') return longBetter ? 'bg-gh-green/10' : 'bg-gh-red/10';
    return longBetter ? 'bg-gh-red/10' : 'bg-gh-green/10';
  }

  function formatSBS(metric: string, val: number | null): string {
    if (val === null) return '--';
    if (metric === 'Revenue' || metric === 'Net Income' || metric === 'FCF' || metric === 'Market Cap') return fmtBigNum(val);
    if (metric === 'Revenue Growth' || metric === 'Operating Margin') return (val * 100).toFixed(1) + '%';
    if (metric === 'Debt/Equity') return val.toFixed(2);
    if (metric === 'P/E') return val.toFixed(1) + 'x';
    return val.toFixed(2);
  }

  return (
    <div className="space-y-6">
      {isBasket && (
        <div className="text-xs text-gh-text-muted bg-gh-bg border border-gh-border rounded-lg px-3 py-2">
          Showing fundamentals for primary tickers ({longTicker} vs {shortTicker}).
          {spread.long_leg.tickers.length > 1 && ` Long leg is a basket of ${spread.long_leg.tickers.length} tickers.`}
          {spread.short_leg.tickers.length > 1 && ` Short leg is a basket of ${spread.short_leg.tickers.length} tickers.`}
        </div>
      )}

      {/* Score comparison */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-5">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-1">
          Fundamental Scores
        </h3>
        <p className="text-[11px] text-gh-text-muted/70 mb-4 leading-relaxed">{FUNDAMENTALS_TOOLTIPS.scoreHeader}</p>
        <div className="flex items-center justify-center gap-8 mb-6">
          <div className="text-center">
            <div className="text-xs text-gh-text-muted mb-1">Long: {longTicker}</div>
            <div className={cn(
              'text-4xl font-bold',
              comp.direction_valid ? 'text-gh-green' : 'text-gh-red',
            )}>
              {comp.long.total_score}
              <span className="text-lg text-gh-text-muted">/100</span>
            </div>
          </div>
          <div className="text-2xl text-gh-text-muted">vs</div>
          <div className="text-center">
            <div className="text-xs text-gh-text-muted mb-1">Short: {shortTicker}</div>
            <div className={cn(
              'text-4xl font-bold',
              !comp.direction_valid ? 'text-gh-green' : 'text-gh-red',
            )}>
              {comp.short.total_score}
              <span className="text-lg text-gh-text-muted">/100</span>
            </div>
          </div>
        </div>

        {!comp.direction_valid && comp.warning && (
          <div className="mb-4 p-3 rounded-lg bg-gh-red/10 border border-gh-red/30 text-gh-red text-xs">
            {comp.warning}
          </div>
        )}

        {/* Category breakdown bars */}
        <Suspense fallback={<Skeleton className="h-52 w-full" />}>
          <Plot
            data={[
              {
                type: 'bar',
                name: longTicker,
                x: categories.map(c => c.label),
                y: categories.map(c => comp.long[c.key]),
                marker: { color: '#3fb950' },
              },
              {
                type: 'bar',
                name: shortTicker,
                x: categories.map(c => c.label),
                y: categories.map(c => comp.short[c.key]),
                marker: { color: '#ff7b72' },
              },
            ]}
            layout={{
              ...PLOTLY_LAYOUT,
              height: 240,
              barmode: 'group',
              yaxis: { ...PLOTLY_LAYOUT.yaxis, title: { text: 'Score (max 20)' }, range: [0, 22] },
            }}
            config={PLOTLY_CONFIG}
            style={{ width: '100%' }}
          />
        </Suspense>
        <p className="text-[10px] text-gh-text-muted/60 mt-3 italic">{FUNDAMENTALS_TOOLTIPS.source}</p>
      </div>

      {/* Side-by-side financials table */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg overflow-hidden">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide px-4 pt-4 pb-2">
          Side-by-Side Financials
        </h3>
        <table className="w-full text-sm">
          <thead className="border-b border-gh-border">
            <tr>
              <th className="px-4 py-2 text-left text-xs text-gh-text-muted">Metric</th>
              <th className="px-4 py-2 text-right text-xs text-gh-green">{longTicker} (Long)</th>
              <th className="px-4 py-2 text-right text-xs text-gh-red">{shortTicker} (Short)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gh-border">
            {Object.entries(comp.side_by_side).map(([metric, vals]) => (
              <tr key={metric}>
                <td className="px-4 py-2 text-gh-text-muted">{metric}</td>
                <td className={cn('px-4 py-2 text-right text-gh-text', cellColor(metric, vals.long, vals.short, 'long'))}>
                  {formatSBS(metric, vals.long)}
                </td>
                <td className={cn('px-4 py-2 text-right text-gh-text', cellColor(metric, vals.long, vals.short, 'short'))}>
                  {formatSBS(metric, vals.short)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Key divergences */}
      {comp.key_divergences.length > 0 && (
        <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-3">
            Key Divergences
          </h3>
          <div className="space-y-2">
            {comp.key_divergences.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gh-text">{d.metric}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gh-text-muted">{d.long} vs {d.short}</span>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    d.favors === 'long'
                      ? 'bg-gh-green/10 text-gh-green border border-gh-green/30'
                      : 'bg-gh-red/10 text-gh-red border border-gh-red/30',
                  )}>
                    Favors {d.favors}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RiskTab({ spread, analytics }: { spread: Spread; analytics: SpreadAnalytics | null }) {
  const { data: summary } = useApi<PortfolioSummary>(() => getPortfolioSummary(), []);

  const daysHeld = daysBetween(spread.entry_date);
  const totalAlloc = spread.long_leg.allocation_pct + spread.short_leg.allocation_pct;

  return (
    <div className="space-y-6">
      {/* Portfolio impact */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-5">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-4">
          Portfolio Impact
        </h3>
        <p className="text-sm text-gh-text-muted mb-4">
          With this spread, your portfolio constraints look like:
        </p>
        {summary?.constraints.length ? (
          summary.constraints.map(c => (
            <ConstraintBar
              key={c.name}
              name={c.name}
              current={c.current_value}
              limit={c.limit}
            />
          ))
        ) : (
          <p className="text-sm text-gh-text-muted">No constraints loaded</p>
        )}
      </div>

      {/* Risk metrics */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-5">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-4">
          Risk Metrics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Max Drawdown"
            value={analytics?.max_drawdown_pct !== null && analytics?.max_drawdown_pct !== undefined
              ? `${analytics.max_drawdown_pct.toFixed(1)}%`
              : '--'}
            color={analytics?.max_drawdown_pct !== null && analytics?.max_drawdown_pct !== undefined && analytics.max_drawdown_pct < -15
              ? 'text-gh-red'
              : 'text-gh-yellow'}
            tooltip={RISK_TOOLTIPS.maxDrawdown}
          />
          <StatCard
            label="Days Held"
            value={String(daysHeld)}
            tooltip={RISK_TOOLTIPS.daysHeld}
          />
          <StatCard
            label="Stop Loss"
            value={`${spread.stop_loss_pct}%`}
            color="text-gh-red"
            sub={spread.pnl_pct !== null
              ? `P&L: ${fmtPct(spread.pnl_pct)}`
              : undefined}
          />
          <StatCard
            label="Position Size"
            value={`${totalAlloc.toFixed(1)}%`}
            sub={`L: ${spread.long_leg.allocation_pct}% / S: ${spread.short_leg.allocation_pct}%`}
          />
        </div>
      </div>

      {/* Beta analysis */}
      {analytics && (
        <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-5">
          <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-1 inline-flex items-center">
            Beta Analysis
            <InfoTip {...RISK_TOOLTIPS.beta} />
          </h3>
          <p className="text-[10px] text-gh-text-muted/60 mb-4 italic">{RISK_TOOLTIPS.beta.source}</p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xs text-gh-text-muted mb-1">Long Beta</div>
              <div className="text-xl font-bold text-gh-green">{fmtNum(analytics.beta_long, 2)}</div>
            </div>
            <div>
              <div className="text-xs text-gh-text-muted mb-1">Short Beta</div>
              <div className="text-xl font-bold text-gh-red">{fmtNum(analytics.beta_short, 2)}</div>
            </div>
            <div>
              <div className="text-xs text-gh-text-muted mb-1">Net Beta</div>
              <div className={cn(
                'text-xl font-bold',
                analytics.net_beta !== null && Math.abs(analytics.net_beta) < 0.3
                  ? 'text-gh-green'
                  : 'text-gh-yellow',
              )}>
                {fmtNum(analytics.net_beta, 2)}
              </div>
              <div className="text-[10px] text-gh-text-muted mt-1">
                {analytics.net_beta !== null && Math.abs(analytics.net_beta) < 0.3
                  ? 'Market neutral'
                  : 'Directional bias'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NotesTab({ spread, onNoteAdded }: { spread: Spread; onNoteAdded: () => void }) {
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSubmitting(true);
    try {
      await addNote(spread.id, noteText.trim());
      setNoteText('');
      toast('Note added', 'success');
      onNoteAdded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add note';
      toast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Investment thesis */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-5">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-3">
          Investment Thesis
        </h3>
        <p className="text-sm text-gh-text leading-relaxed">
          {spread.thesis || 'No thesis recorded.'}
        </p>
      </div>

      {/* Notes timeline */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-5">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-4">
          Team Notes ({spread.notes.length})
        </h3>
        {spread.notes.length === 0 ? (
          <p className="text-sm text-gh-text-muted">No notes yet. Add one below.</p>
        ) : (
          <div className="space-y-3">
            {[...spread.notes].reverse().map((note, i) => (
              <div key={i} className="p-3 bg-gh-bg border border-gh-border rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gh-accent">{note.author}</span>
                  <span className="text-[10px] text-gh-text-muted">
                    {note.date || (note as Record<string, string>).created_at || ''}
                  </span>
                </div>
                <p className="text-sm text-gh-text">{note.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add note form */}
      <form onSubmit={handleAddNote} className="bg-gh-bg-secondary border border-gh-border rounded-lg p-5">
        <h3 className="text-xs font-semibold text-gh-text-muted uppercase tracking-wide mb-3">
          Add Note
        </h3>
        <textarea
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          placeholder="Share an observation, risk flag, or thesis update..."
          rows={3}
          className="w-full px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text resize-y mb-3"
        />
        <button
          type="submit"
          disabled={!noteText.trim() || submitting}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            noteText.trim() && !submitting
              ? 'bg-gh-accent text-white hover:bg-gh-accent/90'
              : 'bg-gh-border text-gh-text-muted cursor-not-allowed',
          )}
        >
          {submitting ? 'Adding...' : 'Add Note'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SpreadReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('charts');

  const {
    data: spread,
    loading: spreadLoading,
    error: spreadError,
    refetch: refetchSpread,
  } = useApi<Spread>(() => getSpread(id!), [id]);

  const {
    data: analytics,
    loading: analyticsLoading,
    error: analyticsError,
    refetch: refetchAnalytics,
  } = useApi<SpreadAnalytics>(() => getSpreadAnalytics(id!), [id]);

  if (spreadLoading) {
    return (
      <div className="max-w-7xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (spreadError) {
    return <ErrorState message={spreadError} onRetry={refetchSpread} />;
  }

  if (!spread) return null;

  const longLabel = spread.long_leg.tickers.join(' + ');
  const shortLabel = spread.short_leg.tickers.join(' + ');
  const spreadName = `${longLabel} / ${shortLabel}`;
  const daysHeld = daysBetween(spread.entry_date);
  const zInfo = zscoreLabel(analytics?.current_zscore ?? null);

  return (
    <div className="max-w-7xl">
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="text-sm text-gh-text-muted hover:text-gh-text transition-colors mb-4"
      >
        &larr; Back to Dashboard
      </button>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h1 className="text-2xl font-bold text-gh-text">{spreadName}</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gh-bg-tertiary text-gh-text-muted border border-gh-border">
            {spread.asset_class}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gh-accent/10 text-gh-accent border border-gh-accent/30">
            {spread.theme}
          </span>
          <span className={cn(
            'text-xs px-2 py-0.5 rounded-full',
            spread.status === 'active'
              ? 'bg-gh-green/10 text-gh-green border border-gh-green/30'
              : spread.status === 'proposed'
                ? 'bg-gh-yellow/10 text-gh-yellow border border-gh-yellow/30'
                : 'bg-gh-border/50 text-gh-text-muted border border-gh-border',
          )}>
            {spread.status}
          </span>
        </div>

        {/* Quick stat cards */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          <StatCard
            label="P&L"
            value={spread.pnl_pct !== null ? fmtPct(spread.pnl_pct) : '--'}
            color={spread.pnl_pct !== null
              ? spread.pnl_pct >= 0 ? 'text-gh-green' : 'text-gh-red'
              : 'text-gh-text-muted'}
            tooltip={STAT_TOOLTIPS.pnl}
          />
          <StatCard
            label="Correlation"
            value={analyticsLoading ? '...' : fmtNum(analytics?.correlation, 3)}
            tooltip={STAT_TOOLTIPS.correlation}
          />
          <StatCard
            label="Spread Sharpe"
            value={analyticsLoading ? '...' : fmtNum(analytics?.spread_sharpe, 2)}
            color={analytics?.spread_sharpe !== null && analytics?.spread_sharpe !== undefined
              ? analytics.spread_sharpe > 1 ? 'text-gh-green'
                : analytics.spread_sharpe > 0 ? 'text-gh-yellow'
                  : 'text-gh-red'
              : undefined}
            tooltip={STAT_TOOLTIPS.spreadSharpe}
          />
          <StatCard
            label="Z-Score"
            value={analyticsLoading ? '...' : fmtNum(analytics?.current_zscore, 2)}
            color={zInfo.color}
            sub={zInfo.text}
            tooltip={STAT_TOOLTIPS.zscore}
          />
          <StatCard
            label="Days Held"
            value={String(daysHeld)}
            tooltip={STAT_TOOLTIPS.daysHeld}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gh-border mb-6">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors relative',
              activeTab === t.key
                ? 'text-gh-accent'
                : 'text-gh-text-muted hover:text-gh-text',
            )}
          >
            {t.label}
            {activeTab === t.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gh-accent rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'charts' && (
        analyticsLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        ) : analyticsError ? (
          <ErrorState message={analyticsError} onRetry={refetchAnalytics} />
        ) : analytics ? (
          <ChartsTab analytics={analytics} spread={spread} />
        ) : null
      )}

      {activeTab === 'fundamentals' && (
        <FundamentalsTab spread={spread} />
      )}

      {activeTab === 'risk' && (
        <RiskTab spread={spread} analytics={analytics} />
      )}

      {activeTab === 'notes' && (
        <NotesTab spread={spread} onNoteAdded={refetchSpread} />
      )}
    </div>
  );
}
