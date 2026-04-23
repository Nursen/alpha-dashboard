import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { getRiskSummary } from '@/lib/api';
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
            <tr key={i} className="hover:bg-gh-bg-tertiary transition-colors">
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
      text: data.matrix.map(row => row.map(v => v.toFixed(2))),
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

// --- Tab selector for switching views ---

type TabId = 'overview' | 'var' | 'scenarios' | 'correlation' | 'flags';

function TabBar({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'var', label: 'VaR' },
    { id: 'scenarios', label: 'Scenarios' },
    { id: 'correlation', label: 'Correlation' },
    { id: 'flags', label: 'Flags' },
  ];
  return (
    <div className="flex gap-1 border-b border-gh-border">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
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

  const { exposures, var: varData, drawdown, correlation, scenarios, flags, meta } = data;

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

      {/* --- Tabs for detailed sections --- */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      <div className="min-h-[400px]">
        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <DrawdownCard data={drawdown} />

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
              Correlation computed from 6 months of daily returns, value-weighted within each theme.
              Low inter-theme correlation means better diversification.
            </div>
          </div>
        )}

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
