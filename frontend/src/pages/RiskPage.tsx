import { useState, useMemo } from 'react';
import { useApi } from '@/hooks/useApi';
import { getRiskSummary, getRiskFactors, getRiskLiquidity, getRiskOptimize } from '@/lib/api';
import { Skeleton } from '@/components/LoadingSkeleton';
import { ErrorState } from '@/components/ErrorState';
import { InfoTip } from '@/components/Tooltip';
import { POSITION_RISK_TOOLTIPS } from '@/lib/tooltips';
import { cn } from '@/lib/utils';
import type {
  RiskSummary,
  VaRData,
  DrawdownData,
  ScenarioResult,
  ThemeCorrelation,
  PositionFlag,
  ExposureBreakdown,
  PositionDetail,
  FactorExposure,
  LiquidityPosition,
  SummaryStats,
} from '@/lib/types';

// Lazy-load Plotly to avoid blocking initial render
import Plot from 'react-plotly.js';

// --- KPI Card (reused pattern from existing codebase) ---

function KPICard({
  label,
  value,
  color,
  subtitle,
  tooltip,
}: {
  label: string;
  value: string;
  color?: string;
  subtitle?: string;
  tooltip?: { title: string; explanation: string; source?: string };
}) {
  return (
    <div className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg">
      <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-1 inline-flex items-center">
        {label}
        {tooltip && <InfoTip title={tooltip.title} explanation={tooltip.explanation} source={tooltip.source} />}
      </div>
      <div className={cn('text-2xl font-bold', color || 'text-gh-text')}>{value}</div>
      {subtitle && <div className="text-xs text-gh-text-muted mt-1">{subtitle}</div>}
    </div>
  );
}

function fmtDollar(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pnlColor(v: number): string {
  return v >= 0 ? 'text-gh-green' : 'text-gh-red';
}

// --- Summary Stats Table ---

function SummaryStatsCard({ stats }: { stats: SummaryStats }) {
  return (
    <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
      <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-3">Portfolio Summary</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs text-gh-text-muted">Positions</div>
          <div className="text-lg font-bold text-gh-text">{stats.total_positions}</div>
        </div>
        <div>
          <div className="text-xs text-gh-text-muted">Avg / Theme</div>
          <div className="text-lg font-bold text-gh-text">{stats.avg_positions_per_theme}</div>
        </div>
        <div>
          <div className="text-xs text-gh-text-muted">Max Theme ({stats.max_theme_name})</div>
          <div className="text-lg font-bold text-gh-text">{stats.max_theme_size_pct}%</div>
        </div>
        <div>
          <div className="text-xs text-gh-text-muted">Max Position ({stats.max_position_ticker})</div>
          <div className="text-lg font-bold text-gh-text">{stats.max_position_size_pct}%</div>
        </div>
      </div>
    </div>
  );
}

// --- Exposure Charts ---

const CHART_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#79c0ff', '#f0883e', '#a5d6ff', '#56d364', '#db6d28'];

function ExposureBarChart({ data, title }: { data: ExposureBreakdown[]; title: string }) {
  if (!data.length) return null;
  return (
    <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
      <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-2">{title}</div>
      <Plot
        data={[
          {
            x: data.map(d => d.name),
            y: data.map(d => d.long_exposure),
            name: 'Long',
            type: 'bar' as const,
            marker: { color: '#3fb950' },
          },
          {
            x: data.map(d => d.name),
            y: data.map(d => -d.short_exposure),
            name: 'Short',
            type: 'bar' as const,
            marker: { color: '#f85149' },
          },
        ]}
        layout={{
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          font: { color: '#c9d1d9', size: 10 },
          margin: { l: 50, r: 10, t: 10, b: 80 },
          barmode: 'group' as const,
          xaxis: { gridcolor: '#21262d', tickangle: -35 },
          yaxis: { gridcolor: '#21262d', tickprefix: '$' },
          height: 250,
          showlegend: true,
          legend: { x: 0, y: 1.15, orientation: 'h' as const, font: { size: 10 } },
        }}
        config={{ displayModeBar: false, responsive: true }}
        className="w-full"
      />
    </div>
  );
}

function ExposurePieChart({ data, title }: { data: ExposureBreakdown[]; title: string }) {
  if (!data.length) return null;
  return (
    <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
      <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-2">{title} (Gross)</div>
      <Plot
        data={[
          {
            labels: data.map(d => d.name),
            values: data.map(d => d.gross_exposure),
            type: 'pie' as const,
            hole: 0.4,
            textinfo: 'label+percent' as const,
            marker: { colors: CHART_COLORS },
          },
        ]}
        layout={{
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          font: { color: '#c9d1d9', size: 10 },
          margin: { l: 10, r: 10, t: 10, b: 10 },
          height: 250,
          showlegend: false,
        }}
        config={{ displayModeBar: false, responsive: true }}
        className="w-full"
      />
    </div>
  );
}

// --- VaR Section ---

function VaRSection({ data }: { data: VaRData }) {
  if (data.error) {
    return <div className="text-sm text-gh-text-muted italic">{data.error}</div>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Parametric VaR */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-3 inline-flex items-center">
          Parametric VaR
          <InfoTip {...POSITION_RISK_TOOLTIPS.parametricVar} />
        </div>
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gh-text-muted">95% Confidence (1-day)</span>
            <div className="text-right">
              <span className="text-lg font-bold text-gh-red">{data.parametric.var_95_pct.toFixed(2)}%</span>
              <span className="text-xs text-gh-text-muted ml-2">{fmtDollar(data.parametric.var_95_dollar)}</span>
            </div>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gh-text-muted">99% Confidence (1-day)</span>
            <div className="text-right">
              <span className="text-lg font-bold text-gh-red">{data.parametric.var_99_pct.toFixed(2)}%</span>
              <span className="text-xs text-gh-text-muted ml-2">{fmtDollar(data.parametric.var_99_dollar)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Historical VaR */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-3 inline-flex items-center">
          Historical VaR
          <InfoTip {...POSITION_RISK_TOOLTIPS.historicalVar} />
        </div>
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gh-text-muted">95% Confidence (1-day)</span>
            <div className="text-right">
              <span className="text-lg font-bold text-gh-red">{data.historical.var_95_pct.toFixed(2)}%</span>
              <span className="text-xs text-gh-text-muted ml-2">{fmtDollar(data.historical.var_95_dollar)}</span>
            </div>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gh-text-muted">99% Confidence (1-day)</span>
            <div className="text-right">
              <span className="text-lg font-bold text-gh-red">{data.historical.var_99_pct.toFixed(2)}%</span>
              <span className="text-xs text-gh-text-muted ml-2">{fmtDollar(data.historical.var_99_dollar)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Scenario Analysis Table ---

function ScenarioTable({ scenarios }: { scenarios: ScenarioResult[] }) {
  const categoryLabels: Record<string, string> = {
    market: 'Market Shock',
    rates: 'Interest Rates',
    fx: 'Currency',
    historical: 'Historical Event',
  };
  return (
    <div className="bg-gh-bg-secondary border border-gh-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="border-b border-gh-border">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gh-text-muted uppercase">Scenario</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gh-text-muted uppercase">Category</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gh-text-muted uppercase">Impact ($)</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gh-text-muted uppercase">Impact (%)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gh-border">
          {scenarios.map((s, i) => (
            <tr key={i} className="hover:bg-gh-bg-tertiary transition-colors" title={s.description || ''}>
              <td className="px-4 py-3 text-sm font-medium text-gh-text">{s.scenario}</td>
              <td className="px-4 py-3 text-sm text-gh-text-muted">{categoryLabels[s.category] || s.category}</td>
              <td className={cn('px-4 py-3 text-sm text-right font-medium', pnlColor(s.impact_dollar))}>
                {fmtDollar(s.impact_dollar)}
              </td>
              <td className={cn('px-4 py-3 text-sm text-right font-medium', pnlColor(s.impact_pct))}>
                {s.impact_pct >= 0 ? '+' : ''}{s.impact_pct.toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Correlation Heatmap ---

function CorrelationHeatmap({ data }: { data: ThemeCorrelation }) {
  if (!data.themes.length) {
    return <div className="text-sm text-gh-text-muted italic">No theme correlation data available</div>;
  }

  // Plotly heatmap config
  const plotData: Plotly.Data[] = [
    {
      z: data.matrix,
      x: data.themes,
      y: data.themes,
      type: 'heatmap' as const,
      colorscale: [
        [0, '#f85149'],    // negative correlation = red
        [0.5, '#0d1117'],  // zero = dark (background)
        [1, '#3fb950'],    // positive correlation = green
      ],
      zmin: -1,
      zmax: 1,
      text: data.matrix.map(row => row.map(v => v.toFixed(2))) as unknown as string[],
      texttemplate: '%{text}',
      textfont: { size: 11, color: '#c9d1d9' },
      hovertemplate: '%{x} vs %{y}: %{z:.2f}<extra></extra>',
      showscale: true,
      colorbar: {
        tickfont: { color: '#8b949e', size: 10 },
        title: { text: 'Corr', font: { color: '#8b949e', size: 10 } },
      },
    },
  ];

  const layout: Partial<Plotly.Layout> = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    margin: { l: 120, r: 40, t: 20, b: 100 },
    xaxis: {
      tickfont: { color: '#8b949e', size: 10 },
      tickangle: -45,
    },
    yaxis: {
      tickfont: { color: '#8b949e', size: 10 },
      autorange: 'reversed' as const,
    },
    height: 400,
  };

  return (
    <Plot
      data={plotData}
      layout={layout}
      config={{ displayModeBar: false, responsive: true }}
      className="w-full"
    />
  );
}

// --- Flagged Positions Table ---

function FlaggedPositions({ flags }: { flags: PositionFlag[] }) {
  if (!flags.length) {
    return (
      <div className="p-6 bg-gh-bg-secondary border border-gh-border rounded-lg text-center">
        <span className="text-sm text-gh-text-muted">No positions flagged -- all within normal P&L range</span>
      </div>
    );
  }

  return (
    <div className="bg-gh-bg-secondary border border-gh-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="border-b border-gh-border">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gh-text-muted uppercase">Ticker</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gh-text-muted uppercase">Side</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gh-text-muted uppercase">P&L %</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gh-text-muted uppercase">P&L $</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gh-text-muted uppercase">Mkt Value</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gh-text-muted uppercase">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gh-border">
          {flags.map((f, i) => {
            const isWinner = f.flag === 'winner';
            const rowBg = isWinner ? 'bg-gh-green/5' : 'bg-gh-red/5';
            const borderColor = isWinner ? 'border-l-gh-green' : 'border-l-gh-red';
            return (
              <tr key={i} className={cn(rowBg, 'border-l-2', borderColor, 'hover:bg-gh-bg-tertiary transition-colors')}>
                <td className="px-4 py-3 text-sm font-medium text-gh-text">{f.ticker}</td>
                <td className="px-4 py-3 text-sm text-gh-text-muted capitalize">{f.side}</td>
                <td className={cn('px-4 py-3 text-sm text-right font-bold', isWinner ? 'text-gh-green' : 'text-gh-red')}>
                  {f.pnl_pct >= 0 ? '+' : ''}{f.pnl_pct.toFixed(1)}%
                </td>
                <td className={cn('px-4 py-3 text-sm text-right', isWinner ? 'text-gh-green' : 'text-gh-red')}>
                  {fmtDollar(f.pnl_dollar)}
                </td>
                <td className="px-4 py-3 text-sm text-gh-text-muted text-right">{fmtDollar(f.market_value)}</td>
                <td className="px-4 py-3 text-xs text-gh-text-muted">{f.message}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Drawdown Card ---

function DrawdownCard({ data }: { data: DrawdownData }) {
  if (data.error) {
    return <div className="text-sm text-gh-text-muted italic">{data.error}</div>;
  }

  return (
    <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4 space-y-3">
      <div className="text-xs text-gh-text-muted uppercase tracking-wide inline-flex items-center">
        Drawdown
        <InfoTip {...POSITION_RISK_TOOLTIPS.maxDrawdown} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-gh-text-muted mb-1">Max Drawdown</div>
          <div className="text-xl font-bold text-gh-red">{data.max_drawdown_pct.toFixed(1)}%</div>
          {data.max_drawdown_date && (
            <div className="text-[10px] text-gh-text-muted mt-0.5">{data.max_drawdown_date}</div>
          )}
        </div>
        <div>
          <div className="text-xs text-gh-text-muted mb-1 inline-flex items-center">
            Current DD
            <InfoTip {...POSITION_RISK_TOOLTIPS.currentDrawdown} />
          </div>
          <div className={cn('text-xl font-bold', data.current_drawdown_pct < -2 ? 'text-gh-red' : 'text-gh-text')}>
            {data.current_drawdown_pct.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-gh-text-muted mb-1">Recovery</div>
          <div className="text-xl font-bold text-gh-text">
            {data.recovery_days !== null ? `${data.recovery_days}d` : 'Ongoing'}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Positions Table with sortable columns, sector/country, beta-adj, risk metrics ---

type SortKey = 'ticker' | 'name' | 'sector' | 'country' | 'market_value' | 'pnl_pct' | 'beta' | 'beta_adjusted_exposure' | 'max_drawdown_5y_pct' | 'skewness' | 'kurtosis';

function PositionsTable({ positions }: { positions: PositionDetail[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('market_value');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    return [...positions].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [positions, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const SortHeader = ({ k, label, align = 'left' }: { k: SortKey; label: string; align?: string }) => (
    <th
      className={cn(
        'py-2 px-2 text-xs font-medium text-gh-text-muted uppercase cursor-pointer hover:text-gh-text transition-colors select-none',
        align === 'right' ? 'text-right' : 'text-left',
      )}
      onClick={() => handleSort(k)}
    >
      {label} {sortKey === k ? (sortAsc ? '(asc)' : '(desc)') : ''}
    </th>
  );

  return (
    <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
      <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-3">
        All Positions ({positions.length}) -- click headers to sort
      </div>
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gh-bg-secondary border-b border-gh-border">
            <tr>
              <SortHeader k="ticker" label="Ticker" />
              <SortHeader k="name" label="Name" />
              <th className="py-2 px-2 text-left text-xs font-medium text-gh-text-muted uppercase">Side</th>
              <SortHeader k="sector" label="Sector" />
              <SortHeader k="country" label="Country" />
              <SortHeader k="market_value" label="Mkt Val" align="right" />
              <SortHeader k="pnl_pct" label="P&L %" align="right" />
              <SortHeader k="beta" label="Beta" align="right" />
              <SortHeader k="beta_adjusted_exposure" label="Beta-Adj Exp" align="right" />
              <SortHeader k="max_drawdown_5y_pct" label="5Y Max DD" align="right" />
              <SortHeader k="skewness" label="Skew" align="right" />
              <SortHeader k="kurtosis" label="Kurt" align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gh-border/30">
            {sorted.map(p => (
              <tr key={p.ticker} className="hover:bg-gh-bg-tertiary/50 transition-colors">
                <td className="py-1.5 px-2 font-mono font-medium text-gh-text">{p.ticker}</td>
                <td className="py-1.5 px-2 text-gh-text-muted truncate max-w-[120px]" title={p.name}>{p.name}</td>
                <td className="py-1.5 px-2">
                  <span className={cn(
                    'px-1.5 py-0.5 rounded',
                    p.side === 'long' ? 'bg-gh-green/15 text-gh-green' : 'bg-gh-red/15 text-gh-red',
                  )}>
                    {p.side}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-gh-text-muted">{p.sector}</td>
                <td className="py-1.5 px-2 text-gh-text-muted">{p.country}</td>
                <td className="py-1.5 px-2 text-right text-gh-text">{fmtDollar(p.market_value)}</td>
                <td className={cn('py-1.5 px-2 text-right font-medium', pnlColor(p.pnl_pct))}>
                  {p.pnl_pct >= 0 ? '+' : ''}{p.pnl_pct.toFixed(1)}%
                </td>
                <td className="py-1.5 px-2 text-right text-gh-text-muted">{p.beta?.toFixed(2) ?? '--'}</td>
                <td className={cn('py-1.5 px-2 text-right', p.beta_adjusted_exposure != null ? pnlColor(p.beta_adjusted_exposure) : '')}>
                  {p.beta_adjusted_exposure != null ? fmtDollar(p.beta_adjusted_exposure) : '--'}
                </td>
                <td className="py-1.5 px-2 text-right text-gh-red">
                  {p.max_drawdown_5y_pct != null ? `${p.max_drawdown_5y_pct.toFixed(1)}%` : '--'}
                </td>
                <td className="py-1.5 px-2 text-right text-gh-text-muted">{p.skewness?.toFixed(2) ?? '--'}</td>
                <td className="py-1.5 px-2 text-right text-gh-text-muted">{p.kurtosis?.toFixed(1) ?? '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Factor Exposure Tab (lazy-loaded) ---

function FactorTab() {
  const { data, loading, error } = useApi<FactorExposure>(() => getRiskFactors(), []);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (error) return <div className="text-sm text-gh-red">{error}</div>;
  if (!data || !data.by_theme.length) {
    return <div className="text-sm text-gh-text-muted italic">{data?.methodology || 'No factor data available'}</div>;
  }

  const factorNames = data.factor_names;

  return (
    <div className="space-y-6">
      {/* Theme-level factor exposure */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-3">Factor Exposure by Theme</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-gh-border">
              <tr>
                <th className="py-2 px-2 text-left text-xs font-medium text-gh-text-muted uppercase">Theme</th>
                {factorNames.map(fn => (
                  <th key={fn} className="py-2 px-2 text-right text-xs font-medium text-gh-text-muted uppercase">{fn}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gh-border/30">
              {data.by_theme.map(t => (
                <tr key={t.theme} className="hover:bg-gh-bg-tertiary/50">
                  <td className="py-1.5 px-2 font-medium text-gh-text">{t.theme}</td>
                  {factorNames.map(fn => {
                    const v = t.factor_betas[fn] ?? 0;
                    return (
                      <td key={fn} className={cn('py-1.5 px-2 text-right', Math.abs(v) > 0.3 ? (v > 0 ? 'text-gh-green' : 'text-gh-red') : 'text-gh-text-muted')}>
                        {v.toFixed(3)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Position-level factor exposure */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-3">Factor Exposure by Position</div>
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gh-bg-secondary border-b border-gh-border">
              <tr>
                <th className="py-2 px-2 text-left text-xs font-medium text-gh-text-muted uppercase">Ticker</th>
                <th className="py-2 px-2 text-left text-xs font-medium text-gh-text-muted uppercase">Side</th>
                <th className="py-2 px-2 text-right text-xs font-medium text-gh-text-muted uppercase">Alpha</th>
                {factorNames.map(fn => (
                  <th key={fn} className="py-2 px-2 text-right text-xs font-medium text-gh-text-muted uppercase">{fn}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gh-border/30">
              {data.by_position.map(p => (
                <tr key={p.ticker} className="hover:bg-gh-bg-tertiary/50">
                  <td className="py-1.5 px-2 font-mono font-medium text-gh-text">{p.ticker}</td>
                  <td className="py-1.5 px-2">
                    <span className={cn('px-1 py-0.5 rounded', p.side === 'long' ? 'bg-gh-green/15 text-gh-green' : 'bg-gh-red/15 text-gh-red')}>
                      {p.side}
                    </span>
                  </td>
                  <td className={cn('py-1.5 px-2 text-right', pnlColor(p.alpha_daily * 252))}>{(p.alpha_daily * 252 * 100).toFixed(2)}%</td>
                  {factorNames.map(fn => {
                    const v = p.factor_betas[fn] ?? 0;
                    return (
                      <td key={fn} className={cn('py-1.5 px-2 text-right', Math.abs(v) > 0.5 ? (v > 0 ? 'text-gh-green' : 'text-gh-red') : 'text-gh-text-muted')}>
                        {v.toFixed(3)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-gh-text-muted/60 italic">{data.methodology}</div>
    </div>
  );
}

// --- Liquidity Tab (lazy-loaded) ---

function LiquidityTab() {
  const { data, loading, error } = useApi<{ positions: LiquidityPosition[] }>(() => getRiskLiquidity(), []);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (error) return <div className="text-sm text-gh-red">{error}</div>;
  if (!data?.positions?.length) return <div className="text-sm text-gh-text-muted italic">No liquidity data</div>;

  return (
    <div className="space-y-4">
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-3">
          Liquidity Analysis (15% VWAP participation)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-gh-border">
              <tr>
                <th className="py-2 px-2 text-left text-xs font-medium text-gh-text-muted uppercase">Ticker</th>
                <th className="py-2 px-2 text-right text-xs font-medium text-gh-text-muted uppercase">Shares</th>
                <th className="py-2 px-2 text-right text-xs font-medium text-gh-text-muted uppercase">Avg Daily Vol</th>
                <th className="py-2 px-2 text-right text-xs font-medium text-gh-text-muted uppercase">15% Capacity</th>
                <th className="py-2 px-2 text-right text-xs font-medium text-gh-text-muted uppercase">Days to Liquidate</th>
                <th className="py-2 px-2 text-left text-xs font-medium text-gh-text-muted uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gh-border/30">
              {data.positions.map(p => (
                <tr key={p.ticker} className={cn('hover:bg-gh-bg-tertiary/50', p.liquidity_flag === 'illiquid' && 'bg-gh-red/5')}>
                  <td className="py-1.5 px-2 font-mono font-medium text-gh-text">{p.ticker}</td>
                  <td className="py-1.5 px-2 text-right text-gh-text-muted">{p.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="py-1.5 px-2 text-right text-gh-text-muted">{p.avg_daily_volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="py-1.5 px-2 text-right text-gh-text-muted">{p.daily_capacity_15pct.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className={cn('py-1.5 px-2 text-right font-medium', p.days_to_liquidate != null && p.days_to_liquidate > 5 ? 'text-gh-red' : 'text-gh-text')}>
                    {p.days_to_liquidate != null ? p.days_to_liquidate.toFixed(1) : '--'}
                  </td>
                  <td className="py-1.5 px-2">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-semibold',
                      p.liquidity_flag === 'illiquid' ? 'bg-gh-red/20 text-gh-red' : 'bg-gh-green/15 text-gh-green',
                    )}>
                      {p.liquidity_flag === 'illiquid' ? 'ILLIQUID' : 'OK'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-xs text-gh-text-muted/60 italic">
        Days to liquidate = shares / (avg_daily_volume * 15%). Positions with &gt;5 days flagged as illiquid.
      </div>
    </div>
  );
}

// --- Optimizer Tab (lazy-loaded) ---

function OptimizerTab() {
  const { data, loading, error } = useApi<import('@/lib/types').OptimizationResult>(() => getRiskOptimize(), []);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (error) return <div className="text-sm text-gh-red">{error}</div>;
  if (!data || data.error) return <div className="text-sm text-gh-text-muted italic">{data?.error || 'Optimization unavailable'}</div>;

  const themes = Object.keys(data.optimal_weights);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KPICard label="Current Sharpe" value={data.current_sharpe.toFixed(3)} />
        <KPICard
          label="Optimal Sharpe (ERC)"
          value={data.optimal_sharpe.toFixed(3)}
          color={data.optimal_sharpe > data.current_sharpe ? 'text-gh-green' : 'text-gh-text'}
        />
      </div>

      {/* Weights comparison chart */}
      <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
        <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-2">Current vs Optimal Theme Weights</div>
        <Plot
          data={[
            {
              x: themes,
              y: themes.map(t => data.current_weights[t] || 0),
              name: 'Current',
              type: 'bar' as const,
              marker: { color: '#58a6ff' },
            },
            {
              x: themes,
              y: themes.map(t => data.optimal_weights[t] || 0),
              name: 'Optimal (ERC)',
              type: 'bar' as const,
              marker: { color: '#3fb950' },
            },
          ]}
          layout={{
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { color: '#c9d1d9', size: 10 },
            margin: { l: 40, r: 10, t: 10, b: 100 },
            barmode: 'group' as const,
            xaxis: { gridcolor: '#21262d', tickangle: -35 },
            yaxis: { gridcolor: '#21262d', ticksuffix: '%' },
            height: 280,
            showlegend: true,
            legend: { x: 0, y: 1.15, orientation: 'h' as const, font: { size: 10 } },
          }}
          config={{ displayModeBar: false, responsive: true }}
          className="w-full"
        />
      </div>

      {/* Suggestions */}
      {data.suggestions.length > 0 && (
        <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-4">
          <div className="text-xs text-gh-text-muted uppercase tracking-wide mb-3">Rebalancing Suggestions</div>
          <ul className="space-y-2">
            {data.suggestions.map((s, i) => (
              <li key={i} className="text-sm text-gh-text flex items-start gap-2">
                <span className="text-gh-accent font-bold shrink-0">--</span> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs text-gh-text-muted/60 italic">{data.methodology}</div>
    </div>
  );
}

// --- Tab selector for switching views ---

type TabId = 'overview' | 'var' | 'scenarios' | 'correlation' | 'factors' | 'liquidity' | 'optimizer' | 'flags';

function TabBar({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'var', label: 'VaR' },
    { id: 'scenarios', label: 'Scenarios' },
    { id: 'correlation', label: 'Correlation' },
    { id: 'factors', label: 'Factors' },
    { id: 'liquidity', label: 'Liquidity' },
    { id: 'optimizer', label: 'Optimizer' },
    { id: 'flags', label: 'Flags' },
  ];
  return (
    <div className="flex gap-1 border-b border-gh-border overflow-x-auto">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
            active === t.id
              ? 'border-gh-accent text-gh-accent'
              : 'border-transparent text-gh-text-muted hover:text-gh-text',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}


// === MAIN PAGE ===

export function RiskPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const { data, loading, error, refetch } = useApi<RiskSummary>(() => getRiskSummary(), []);

  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }

  if (!data) return null;

  const {
    exposures, var: varData, drawdown, correlation, scenarios, flags, meta, positions,
    exposure_by_sector, exposure_by_country, exposure_by_region, exposure_by_theme,
    summary_stats,
  } = data;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* --- Row 1: Exposure KPIs --- */}
      <div>
        <h2 className="text-sm font-semibold text-gh-text mb-4 uppercase tracking-wide">
          Position-Level Risk Dashboard
          <span className="text-gh-text-muted font-normal ml-2">
            ({meta.num_positions} positions: {meta.num_long} long, {meta.num_short} short)
          </span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Gross Exposure"
            value={fmtDollar(exposures.gross_exposure)}
            subtitle={`${exposures.gross_exposure_pct.toFixed(1)}% of portfolio`}
            tooltip={POSITION_RISK_TOOLTIPS.grossExposure}
          />
          <KPICard
            label="Net Exposure"
            value={fmtDollar(exposures.net_exposure)}
            color={Math.abs(exposures.net_exposure_pct) < 10 ? 'text-gh-green' : 'text-gh-red'}
            subtitle={`${exposures.net_exposure_pct >= 0 ? '+' : ''}${exposures.net_exposure_pct.toFixed(1)}%`}
            tooltip={POSITION_RISK_TOOLTIPS.netExposure}
          />
          <KPICard
            label="Beta-Adj Net"
            value={`${exposures.beta_adjusted_net_pct >= 0 ? '+' : ''}${exposures.beta_adjusted_net_pct.toFixed(2)}%`}
            color={Math.abs(exposures.beta_adjusted_net_pct) < 5 ? 'text-gh-green' : 'text-gh-yellow'}
            subtitle={fmtDollar(exposures.beta_adjusted_net_exposure)}
            tooltip={POSITION_RISK_TOOLTIPS.betaAdjustedNet}
          />
          <KPICard
            label="Long/Short Ratio"
            value={exposures.long_short_ratio !== null ? exposures.long_short_ratio.toFixed(2) : '--'}
            color={exposures.long_short_ratio !== null && Math.abs(exposures.long_short_ratio - 1) < 0.15
              ? 'text-gh-green'
              : 'text-gh-yellow'}
            subtitle={`Long: ${fmtDollar(exposures.long_exposure)} / Short: ${fmtDollar(exposures.short_exposure)}`}
            tooltip={POSITION_RISK_TOOLTIPS.longShortRatio}
          />
        </div>
      </div>

      {/* --- Summary Stats --- */}
      {summary_stats && <SummaryStatsCard stats={summary_stats} />}

      {/* --- Row 2: VaR + Drawdown summary cards --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <KPICard
          label="95% VaR (1-day)"
          value={!varData.error ? `${varData.historical.var_95_pct.toFixed(2)}%` : '--'}
          color="text-gh-red"
          subtitle={!varData.error ? `${fmtDollar(varData.historical.var_95_dollar)} historical` : ''}
          tooltip={POSITION_RISK_TOOLTIPS.historicalVar}
        />
        <KPICard
          label="99% VaR (1-day)"
          value={!varData.error ? `${varData.historical.var_99_pct.toFixed(2)}%` : '--'}
          color="text-gh-red"
          subtitle={!varData.error ? `${fmtDollar(varData.historical.var_99_dollar)} historical` : ''}
          tooltip={POSITION_RISK_TOOLTIPS.historicalVar}
        />
        <KPICard
          label="Max Drawdown"
          value={!drawdown.error ? `${drawdown.max_drawdown_pct.toFixed(1)}%` : '--'}
          color="text-gh-red"
          subtitle={drawdown.max_drawdown_date ? `On ${drawdown.max_drawdown_date}` : ''}
          tooltip={POSITION_RISK_TOOLTIPS.maxDrawdown}
        />
      </div>

      {/* --- Exposure Charts (Sector / Country / Region) --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExposureBarChart data={exposure_by_sector} title="Exposure by Sector" />
        <ExposurePieChart data={exposure_by_sector} title="Sector" />
        <ExposureBarChart data={exposure_by_country} title="Exposure by Country" />
        <ExposurePieChart data={exposure_by_country} title="Country" />
      </div>

      {/* --- Tabs for detailed sections --- */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      <div className="min-h-[400px]">
        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <DrawdownCard data={drawdown} />

            {/* Positions Table */}
            <PositionsTable positions={positions} />

            {/* Quick scenario summary */}
            <div>
              <h3 className="text-sm font-semibold text-gh-text mb-3 uppercase tracking-wide inline-flex items-center">
                Scenario Analysis
                <InfoTip {...POSITION_RISK_TOOLTIPS.scenarioAnalysis} />
              </h3>
              <ScenarioTable scenarios={scenarios} />
            </div>

            {/* Quick flags */}
            {flags.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gh-text mb-3 uppercase tracking-wide">
                  Position Alerts ({flags.length})
                </h3>
                <FlaggedPositions flags={flags} />
              </div>
            )}
          </div>
        )}

        {/* VaR tab */}
        {activeTab === 'var' && (
          <div className="space-y-6">
            <VaRSection data={varData} />
            {!varData.error && (
              <div className="text-xs text-gh-text-muted/60 italic">
                Based on {varData.num_observations} days of return data.
                Daily portfolio volatility: {varData.portfolio_daily_vol_pct.toFixed(3)}%.
              </div>
            )}
          </div>
        )}

        {/* Scenarios tab */}
        {activeTab === 'scenarios' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gh-text uppercase tracking-wide inline-flex items-center">
              Stress Scenarios
              <InfoTip {...POSITION_RISK_TOOLTIPS.scenarioAnalysis} />
            </h3>
            <ScenarioTable scenarios={scenarios} />
            <div className="text-xs text-gh-text-muted/60 italic">
              Market scenarios use position betas. Rate scenarios use duration approximation (TIP ~7.5y, TLT ~17y).
              USD scenario assumes ~1:1 FX pass-through on international positions.
              Historical scenarios apply correlation multipliers to amplify beta-driven losses,
              simulating how correlations spike during crises (e.g., 1.5x for GFC, 1.8x for Flash Crash).
            </div>
          </div>
        )}

        {/* Correlation tab */}
        {activeTab === 'correlation' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gh-text uppercase tracking-wide inline-flex items-center">
              Theme Correlation Matrix
              <InfoTip {...POSITION_RISK_TOOLTIPS.themeCorrelation} />
            </h3>
            <div className="bg-gh-bg-secondary border border-gh-border rounded-lg p-2">
              <CorrelationHeatmap data={correlation} />
            </div>
            <div className="text-xs text-gh-text-muted/60 italic">
              Methodology: 6-month trailing window of daily returns, value-weighted within each theme.
              Frequency: daily. Low inter-theme correlation means better diversification.
            </div>
          </div>
        )}

        {/* Factors tab */}
        {activeTab === 'factors' && <FactorTab />}

        {/* Liquidity tab */}
        {activeTab === 'liquidity' && <LiquidityTab />}

        {/* Optimizer tab */}
        {activeTab === 'optimizer' && <OptimizerTab />}

        {/* Flags tab */}
        {activeTab === 'flags' && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gh-text uppercase tracking-wide">
              Flagged Positions
              <span className="text-gh-text-muted font-normal ml-2">
                (Winners &gt;+20%, Losers &lt;-15%)
              </span>
            </h3>
            <FlaggedPositions flags={flags} />
          </div>
        )}
      </div>

      {/* Data provenance note */}
      <div className="text-xs text-gh-text-muted/60 italic">
        Risk data cached for 5 minutes. Positions from StockTrak snapshot (4/20/2026).
        {meta.tickers_missing_data.length > 0 && (
          <span>
            {' '}Missing price data for: {meta.tickers_missing_data.join(', ')}.
          </span>
        )}
      </div>
    </div>
  );
}
