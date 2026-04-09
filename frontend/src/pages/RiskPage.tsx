import { useNavigate } from 'react-router-dom';
import { useApi } from '@/hooks/useApi';
import { getPortfolioRisk } from '@/lib/api';
import { Skeleton } from '@/components/LoadingSkeleton';
import { ErrorState } from '@/components/ErrorState';
import { InfoTip } from '@/components/Tooltip';
import { RISK_PAGE_TOOLTIPS } from '@/lib/tooltips';
import { cn } from '@/lib/utils';
import type { PortfolioRisk, SpreadRisk, RiskAlert } from '@/lib/types';

// --- KPI Card (same pattern as DashboardPage) ---

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

// --- Color helpers ---

function sharpeColor(v: number): string {
  if (v >= 1.0) return 'text-gh-green';
  if (v >= 0.5) return 'text-gh-yellow';
  return 'text-gh-red';
}

function betaColor(v: number | null): string {
  if (v === null) return 'text-gh-text-muted';
  const abs = Math.abs(v);
  if (abs <= 0.05) return 'text-gh-green';
  if (abs <= 0.1) return 'text-gh-yellow';
  return 'text-gh-red';
}

function pnlColor(v: number | null): string {
  if (v === null) return 'text-gh-text-muted';
  return v >= 0 ? 'text-gh-green' : 'text-gh-red';
}

function riskBarColor(pct: number): string {
  if (pct < 15) return 'bg-gh-green';
  if (pct < 30) return 'bg-gh-yellow';
  return 'bg-gh-red';
}

function statusIcon(status: string): string {
  if (status === 'critical') return '\u{1F534}';
  if (status === 'warning') return '\u{26A0}\u{FE0F}';
  return '\u{2705}';
}

function severityIcon(severity: string): string {
  return severity === 'critical' ? '\u{1F534}' : '\u{26A0}\u{FE0F}';
}

// --- Risk Attribution Table ---

function RiskTable({ spreads, onRowClick }: { spreads: SpreadRisk[]; onRowClick: (id: string) => void }) {
  return (
    <div className="bg-gh-bg-secondary border border-gh-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-gh-border">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gh-text-muted uppercase tracking-wide">Spread</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gh-text-muted uppercase tracking-wide">Theme</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gh-text-muted uppercase tracking-wide">
                <span className="inline-flex items-center">
                  Alloc %
                </span>
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gh-text-muted uppercase tracking-wide min-w-[180px]">
                <span className="inline-flex items-center">
                  Risk Contribution
                  <InfoTip {...RISK_PAGE_TOOLTIPS.riskContribution} />
                </span>
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gh-text-muted uppercase tracking-wide">
                <span className="inline-flex items-center">
                  Vol
                  <InfoTip {...RISK_PAGE_TOOLTIPS.standaloneVol} />
                </span>
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gh-text-muted uppercase tracking-wide">Sharpe</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gh-text-muted uppercase tracking-wide">
                <span className="inline-flex items-center">
                  Corr SPY
                  <InfoTip {...RISK_PAGE_TOOLTIPS.corrToSpy} />
                </span>
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gh-text-muted uppercase tracking-wide">Max DD</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gh-text-muted uppercase tracking-wide">P&L</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gh-text-muted uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gh-border">
            {spreads.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gh-text-muted text-sm">
                  No spread risk data available
                </td>
              </tr>
            ) : (
              spreads.map(s => (
                <tr
                  key={s.spread_id}
                  onClick={() => onRowClick(s.spread_id)}
                  className="hover:bg-gh-bg-tertiary transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm font-medium text-gh-text whitespace-nowrap">{s.name}</td>
                  <td className="px-3 py-3 text-sm text-gh-text-muted truncate max-w-[160px]">{s.theme}</td>
                  <td className="px-3 py-3 text-sm text-gh-text-muted text-right">{s.allocation_pct.toFixed(1)}%</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-gh-bg overflow-hidden border border-gh-border">
                        <div
                          className={cn('h-full rounded-full transition-all', riskBarColor(s.risk_contribution_pct))}
                          style={{ width: `${Math.min(s.risk_contribution_pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gh-text-muted w-10 text-right">{s.risk_contribution_pct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-sm text-gh-text-muted text-right">{s.standalone_vol_pct.toFixed(1)}%</td>
                  <td className={cn('px-3 py-3 text-sm text-right', sharpeColor(s.standalone_sharpe))}>
                    {s.standalone_sharpe.toFixed(2)}
                  </td>
                  <td className={cn('px-3 py-3 text-sm text-right',
                    s.correlation_to_spy !== null && Math.abs(s.correlation_to_spy) > 0.3
                      ? 'text-gh-red'
                      : 'text-gh-text-muted'
                  )}>
                    {s.correlation_to_spy !== null ? s.correlation_to_spy.toFixed(2) : '--'}
                  </td>
                  <td className="px-3 py-3 text-sm text-gh-red text-right">{s.max_drawdown_pct.toFixed(1)}%</td>
                  <td className={cn('px-3 py-3 text-sm text-right font-medium', pnlColor(s.current_pnl_pct))}>
                    {s.current_pnl_pct !== null ? `${s.current_pnl_pct >= 0 ? '+' : ''}${s.current_pnl_pct.toFixed(1)}%` : '--'}
                  </td>
                  <td className="px-3 py-3 text-center text-sm">{statusIcon(s.status)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Alert Card ---

function AlertCard({ alert, onReview }: { alert: RiskAlert; onReview: () => void }) {
  return (
    <div className={cn(
      'flex items-start gap-3 p-3 rounded-lg border',
      alert.severity === 'critical'
        ? 'bg-gh-red/5 border-gh-red/30'
        : 'bg-gh-yellow/5 border-gh-yellow/30',
    )}>
      <span className="text-lg flex-shrink-0 mt-0.5">{severityIcon(alert.severity)}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gh-text">{alert.spread_name}</div>
        <div className="text-xs text-gh-text-muted mt-0.5 leading-relaxed">{alert.message}</div>
      </div>
      {alert.spread_id && (
        <button
          onClick={(e) => { e.stopPropagation(); onReview(); }}
          className="text-xs px-3 py-1.5 bg-gh-bg-secondary border border-gh-border rounded-lg
                     hover:border-gh-accent hover:text-gh-accent transition-colors text-gh-text-muted flex-shrink-0"
        >
          Review
        </button>
      )}
    </div>
  );
}

// --- Main Page ---

export function RiskPage() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApi<PortfolioRisk>(() => getPortfolioRisk(), []);

  const metrics = data?.portfolio_metrics;
  const spreads = data?.spread_risk ?? [];
  const alerts = data?.risk_alerts ?? [];

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Portfolio Risk KPIs */}
      <div>
        <h2 className="text-sm font-semibold text-gh-text mb-4 uppercase tracking-wide">
          Portfolio Risk Dashboard
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))
          ) : error ? (
            <div className="col-span-6">
              <ErrorState message={error} onRetry={refetch} />
            </div>
          ) : metrics ? (
            <>
              <KPICard
                label="Sharpe Ratio"
                value={metrics.sharpe_ratio.toFixed(2)}
                color={sharpeColor(metrics.sharpe_ratio)}
                tooltip={RISK_PAGE_TOOLTIPS.sharpe}
              />
              <KPICard
                label="Annual Return"
                value={`${metrics.annualized_return_pct >= 0 ? '+' : ''}${metrics.annualized_return_pct.toFixed(1)}%`}
                color={pnlColor(metrics.annualized_return_pct)}
                tooltip={RISK_PAGE_TOOLTIPS.annualReturn}
              />
              <KPICard
                label="Annual Vol"
                value={`${metrics.annualized_vol_pct.toFixed(1)}%`}
                color="text-gh-text"
                tooltip={RISK_PAGE_TOOLTIPS.annualVol}
              />
              <KPICard
                label="Beta to SPY"
                value={metrics.beta_to_spy !== null ? metrics.beta_to_spy.toFixed(3) : '--'}
                color={betaColor(metrics.beta_to_spy)}
                tooltip={RISK_PAGE_TOOLTIPS.beta}
              />
              <KPICard
                label="Max Drawdown"
                value={`${metrics.max_drawdown_pct.toFixed(1)}%`}
                color="text-gh-red"
                tooltip={RISK_PAGE_TOOLTIPS.maxDrawdown}
              />
              <KPICard
                label="95% VaR (1d)"
                value={`${metrics.var_95_pct.toFixed(2)}%`}
                color="text-gh-text"
                subtitle={`99% VaR: ${metrics.var_99_pct.toFixed(2)}%`}
                tooltip={RISK_PAGE_TOOLTIPS.var95}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* Risk Attribution Table */}
      <div>
        <h2 className="text-sm font-semibold text-gh-text mb-4 uppercase tracking-wide">
          Risk Attribution by Spread
        </h2>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? null : (
          <RiskTable
            spreads={spreads}
            onRowClick={(id) => navigate(`/spreads/${id}`)}
          />
        )}
      </div>

      {/* Risk Alerts */}
      <div>
        <h2 className="text-sm font-semibold text-gh-text mb-4 uppercase tracking-wide">
          Risk Alerts
        </h2>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : alerts.length > 0 ? (
          <div className="space-y-2">
            {alerts.map((alert, i) => (
              <AlertCard
                key={i}
                alert={alert}
                onReview={() => {
                  if (alert.spread_id) navigate(`/spreads/${alert.spread_id}`);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="p-6 bg-gh-bg-secondary border border-gh-border rounded-lg text-center">
            <span className="text-lg mr-2">{'\u2705'}</span>
            <span className="text-sm text-gh-text-muted">All spreads within normal risk parameters</span>
          </div>
        )}
      </div>

      {/* Data note */}
      {data && !data.error && (
        <div className="text-xs text-gh-text-muted/60 italic">
          Risk data cached for 5 minutes. Metrics based on 1-year daily returns. Risk-free rate: 4.3% (SOFR).
        </div>
      )}
    </div>
  );
}
