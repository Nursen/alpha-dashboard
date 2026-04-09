import { useNavigate } from 'react-router-dom';
import { useApi } from '@/hooks/useApi';
import { getPortfolioSummary, getSpreads, getPortfolioNews } from '@/lib/api';
import type { NewsArticle } from '@/lib/api';
import { ConstraintBar } from '@/components/ConstraintBar';
import { SpreadCard } from '@/components/SpreadCard';
import { Skeleton, CardSkeleton } from '@/components/LoadingSkeleton';
import { ErrorState } from '@/components/ErrorState';
import { cn } from '@/lib/utils';
import { InfoTip } from '@/components/Tooltip';
import { KPI_TOOLTIPS } from '@/lib/tooltips';
import type { PortfolioSummary, Spread } from '@/lib/types';

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

function netColor(val: number): string {
  const abs = Math.abs(val);
  if (abs <= 5) return 'text-gh-green';
  if (abs <= 8) return 'text-gh-yellow';
  return 'text-gh-red';
}

function grossColor(val: number): string {
  if (val <= 80) return 'text-gh-green';
  if (val <= 100) return 'text-gh-yellow';
  return 'text-gh-red';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useApi<PortfolioSummary>(() => getPortfolioSummary(), []);

  const {
    data: spreads,
    loading: spreadsLoading,
    error: spreadsError,
    refetch: refetchSpreads,
  } = useApi<Spread[]>(() => getSpreads('active'), []);

  const {
    data: news,
    loading: newsLoading,
  } = useApi<NewsArticle[]>(() => getPortfolioNews(), []);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 bg-gh-bg-secondary border border-gh-border rounded-lg space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))
        ) : summaryError ? (
          <div className="col-span-4">
            <ErrorState message={summaryError} onRetry={refetchSummary} />
          </div>
        ) : summary ? (
          <>
            <KPICard
              label="Net Exposure"
              value={`${summary.net_exposure_pct >= 0 ? '+' : ''}${summary.net_exposure_pct.toFixed(1)}%`}
              color={netColor(summary.net_exposure_pct)}
              tooltip={KPI_TOOLTIPS.netExposure}
            />
            <KPICard
              label="Gross Exposure"
              value={`${summary.gross_exposure_pct.toFixed(1)}%`}
              color={grossColor(summary.gross_exposure_pct)}
              tooltip={KPI_TOOLTIPS.grossExposure}
            />
            <KPICard
              label="Active Spreads"
              value={String(summary.num_spreads)}
              color="text-gh-accent"
              tooltip={KPI_TOOLTIPS.activeSpreads}
            />
            <KPICard
              label="Portfolio P&L"
              value="--"
              color="text-gh-text-muted"
              subtitle="Coming Sprint 2"
              tooltip={KPI_TOOLTIPS.portfolioPnl}
            />
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Constraint Traffic Lights */}
        <div className="lg:col-span-1 p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
          <h2 className="text-sm font-semibold text-gh-text mb-4 uppercase tracking-wide">
            Mandate Constraints
          </h2>
          {summaryLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-full" />
                </div>
              ))}
            </div>
          ) : summary?.constraints.length ? (
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

        {/* Active Spreads */}
        <div className="lg:col-span-2 p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gh-text uppercase tracking-wide">
              Active Spreads
            </h2>
            <button
              onClick={() => navigate('/spreads/new')}
              className="text-xs px-3 py-1.5 bg-gh-accent/10 text-gh-accent border border-gh-accent/30
                         rounded-lg hover:bg-gh-accent/20 transition-colors"
            >
              + New Spread
            </button>
          </div>

          {spreadsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : spreadsError ? (
            <ErrorState message={spreadsError} onRetry={refetchSpreads} />
          ) : spreads && spreads.length > 0 ? (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {spreads.map(s => (
                <SpreadCard
                  key={s.id}
                  spread={s}
                  onClick={() => navigate(`/spreads/${s.id}`)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-gh-text-muted text-sm mb-3">No active spreads yet</p>
              <button
                onClick={() => navigate('/spreads/new')}
                className="text-sm px-4 py-2 bg-gh-accent text-white rounded-lg hover:bg-gh-accent/90 transition-colors"
              >
                Create your first spread
              </button>
            </div>
          )}
        </div>
      </div>

      {/* News Feed */}
      <div className="p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
        <h2 className="text-sm font-semibold text-gh-text mb-4 uppercase tracking-wide">
          Portfolio News
        </h2>
        {newsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-12 w-12 rounded" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : news && news.length > 0 ? (
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {news.slice(0, 15).map((article, i) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-3 p-2 rounded-lg hover:bg-gh-bg transition-colors group"
              >
                {article.thumbnail && (
                  <img
                    src={article.thumbnail}
                    alt=""
                    className="w-12 h-12 rounded object-cover flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gh-text group-hover:text-gh-accent transition-colors line-clamp-2">
                    {article.title}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gh-accent/10 text-gh-accent font-medium">
                      {article.ticker}
                    </span>
                    <span className="text-xs text-gh-text-muted">
                      {article.publisher}
                    </span>
                    <span className="text-xs text-gh-text-muted">
                      {article.published_at ? new Date(article.published_at).toLocaleDateString() : ''}
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gh-text-muted">No news available for portfolio tickers</p>
        )}
      </div>
    </div>
  );
}
