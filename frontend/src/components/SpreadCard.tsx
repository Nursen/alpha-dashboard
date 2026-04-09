import type { Spread } from '@/lib/types';

interface SpreadCardProps {
  spread: Spread;
  onClick: () => void;
}

const assetClassIcon: Record<string, string> = {
  Equities: '\uD83D\uDCC8',
  Bonds: '\uD83C\uDFE6',
  Commodities: '\u26CF\uFE0F',
  FX: '\uD83D\uDCB1',
};

export function SpreadCard({ spread, onClick }: SpreadCardProps) {
  const longTickers = spread.long_leg.tickers.join(', ');
  const shortTickers = spread.short_leg.tickers.join(', ');
  const label = `${longTickers} / ${shortTickers}`;
  const icon = assetClassIcon[spread.asset_class] || '\uD83D\uDCC8';

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 bg-gh-bg-secondary border border-gh-border rounded-lg
                 hover:border-gh-accent/50 transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-gh-text">
          {icon} {label}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gh-bg-tertiary text-gh-text-muted border border-gh-border">
          {spread.asset_class}
        </span>
      </div>
      <div className="text-sm text-gh-text-muted mb-2 truncate">
        Theme: {spread.theme}
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="text-gh-green">Long: {spread.long_leg.allocation_pct}%</span>
        <span className="text-gh-red">Short: {spread.short_leg.allocation_pct}%</span>
        <span className={
          spread.status === 'active' ? 'text-gh-accent' : 'text-gh-text-muted'
        }>
          {spread.status.charAt(0).toUpperCase() + spread.status.slice(1)}
        </span>
      </div>
    </button>
  );
}
