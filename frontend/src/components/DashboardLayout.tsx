import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/useApi';
import { getPortfolioSummary } from '@/lib/api';

const NAV_ITEMS: { to: string; label: string; icon: string; disabled?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: '\u25A6' },
  { to: '/spreads/new', label: 'New Spread', icon: '+' },
  { to: '/portfolio', label: 'Portfolio', icon: '\u25A4' },
  { to: '/risk', label: 'Risk', icon: '\u25C7' },
  { to: '/explore', label: 'Explore', icon: '\u25CB' },
];

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/spreads/new': 'New Spread',
  '/portfolio': 'Portfolio',
  '/risk': 'Risk Monitor',
  '/explore': 'Explore',
};

function ExposureBadge({ label, value }: { label: string; value: number }) {
  const abs = Math.abs(value);
  let color = 'bg-gh-green/15 text-gh-green border-gh-green/30';
  if (abs >= 10) color = 'bg-gh-red/15 text-gh-red border-gh-red/30';
  else if (abs >= 8) color = 'bg-gh-yellow/15 text-gh-yellow border-gh-yellow/30';

  return (
    <span className={cn('px-3 py-1 rounded-full text-xs font-medium border', color)}>
      {label}: {value >= 0 ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

export function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { data: summary } = useApi(() => getPortfolioSummary(), []);

  const pageTitle = PAGE_TITLES[location.pathname] || 'Alpha Dashboard';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col bg-gh-bg-secondary border-r border-gh-border transition-all duration-200 shrink-0',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-gh-border">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gh-accent text-lg font-bold hover:opacity-80 transition-opacity"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            A
          </button>
          {!collapsed && (
            <span className="font-semibold text-gh-text whitespace-nowrap">Alpha Dashboard</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2">
          {NAV_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => cn(
                  'flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg transition-colors text-sm',
                  isActive
                    ? 'bg-gh-accent/10 text-gh-accent'
                    : 'text-gh-text-muted hover:text-gh-text hover:bg-gh-bg-tertiary',
                )}
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
          ))}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="px-4 py-3 border-t border-gh-border text-xs text-gh-text-muted">
            Sprint 3 / Dev Mode
          </div>
        )}
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between h-14 px-6 border-b border-gh-border bg-gh-bg-secondary/50 shrink-0">
          <h1 className="text-lg font-semibold text-gh-text">{pageTitle}</h1>
          <div className="flex items-center gap-3">
            {summary && (
              <>
                <ExposureBadge label="Net" value={summary.net_exposure_pct} />
                <ExposureBadge label="Gross" value={summary.gross_exposure_pct} />
              </>
            )}
            {/* User avatar placeholder */}
            <div className="w-8 h-8 rounded-full bg-gh-accent/20 border border-gh-accent/30 flex items-center justify-center text-xs text-gh-accent font-medium">
              N
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
