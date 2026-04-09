import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createSpread, checkSpread } from '@/lib/api';
import { ConstraintBar } from '@/components/ConstraintBar';
import { useToast } from '@/components/Toast';
import { cn, today } from '@/lib/utils';
import { InfoTip } from '@/components/Tooltip';
import { ENTRY_TOOLTIPS } from '@/lib/tooltips';
import type { SpreadCreate, ConstraintCheckResult, AssetClass } from '@/lib/types';
import { ASSET_CLASSES, THEME_SUGGESTIONS } from '@/lib/types';

function LegEditor({
  label,
  color,
  tickers,
  setTickers,
  weights,
  setWeights,
  allocation,
  setAllocation,
}: {
  label: string;
  color: string;
  tickers: string;
  setTickers: (v: string) => void;
  weights: string;
  setWeights: (v: string) => void;
  allocation: number;
  setAllocation: (v: number) => void;
}) {
  const tickerList = tickers.split(',').map(t => t.trim()).filter(Boolean);
  const showWeights = tickerList.length > 1;

  return (
    <div className={cn('p-4 rounded-lg border', color)}>
      <h3 className="text-sm font-semibold mb-3">{label}</h3>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gh-text-muted mb-1">
            Tickers (comma-separated)
          </label>
          <input
            type="text"
            value={tickers}
            onChange={e => setTickers(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL, MSFT"
            className="w-full px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
          />
        </div>

        {showWeights && (
          <div>
            <label className="block text-xs text-gh-text-muted mb-1">
              Weights (comma-separated, must sum to 1)
            </label>
            <input
              type="text"
              value={weights}
              onChange={e => setWeights(e.target.value)}
              placeholder={`e.g. ${tickerList.map(() => (1 / tickerList.length).toFixed(2)).join(', ')}`}
              className="w-full px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
            />
          </div>
        )}

        <div>
          <label className="block text-xs text-gh-text-muted mb-1">
            Allocation %
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={allocation}
              onChange={e => setAllocation(parseFloat(e.target.value))}
              className="flex-1 accent-[var(--color-gh-accent)]"
            />
            <input
              type="number"
              min={0.5}
              max={50}
              step={0.5}
              value={allocation}
              onChange={e => setAllocation(parseFloat(e.target.value) || 0)}
              className="w-20 px-2 py-1.5 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text text-center"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function parseLeg(tickers: string, weights: string, allocation: number) {
  const tickerList = tickers.split(',').map(t => t.trim()).filter(Boolean);
  let weightList: number[];

  if (weights.trim()) {
    weightList = weights.split(',').map(w => parseFloat(w.trim())).filter(w => !isNaN(w));
    // Pad or truncate to match ticker count
    while (weightList.length < tickerList.length) weightList.push(0);
    weightList = weightList.slice(0, tickerList.length);
  } else {
    // Equal weight
    weightList = tickerList.map(() => 1 / tickerList.length);
  }

  return {
    tickers: tickerList,
    weights: weightList,
    allocation_pct: allocation,
  };
}

export function SpreadEntryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  // Form state (pre-fill from URL params if coming from Explore > Investigate)
  const [assetClass, setAssetClass] = useState<AssetClass>('Equities');
  const [theme, setTheme] = useState(searchParams.get('theme') || '');
  const [thesis, setThesis] = useState(searchParams.get('thesis') || '');
  const [entryDate, setEntryDate] = useState(today());
  const [stopLoss, setStopLoss] = useState(-50);
  const [targetExitDate, setTargetExitDate] = useState('');
  const [targetPnl, setTargetPnl] = useState<number | ''>('');
  const [owner, setOwner] = useState('');

  // Long leg
  const [longTickers, setLongTickers] = useState(searchParams.get('long') || '');
  const [longWeights, setLongWeights] = useState('');
  const [longAlloc, setLongAlloc] = useState(5);

  // Short leg
  const [shortTickers, setShortTickers] = useState(searchParams.get('short') || '');
  const [shortWeights, setShortWeights] = useState('');
  const [shortAlloc, setShortAlloc] = useState(5);

  // Constraint check
  const [checkResult, setCheckResult] = useState<ConstraintCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [overrideViolation, setOverrideViolation] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Debounced constraint check
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const buildSpreadData = useCallback((): SpreadCreate | null => {
    const longLeg = parseLeg(longTickers, longWeights, longAlloc);
    const shortLeg = parseLeg(shortTickers, shortWeights, shortAlloc);

    if (longLeg.tickers.length === 0 || shortLeg.tickers.length === 0) return null;

    return {
      asset_class: assetClass,
      theme,
      thesis,
      long_leg: longLeg,
      short_leg: shortLeg,
      entry_date: entryDate,
      stop_loss_pct: stopLoss,
      target_exit_date: targetExitDate || undefined,
      target_pnl_pct: targetPnl !== '' ? Number(targetPnl) : undefined,
      owner: owner || undefined,
    } as SpreadCreate;
  }, [assetClass, theme, thesis, longTickers, longWeights, longAlloc, shortTickers, shortWeights, shortAlloc, entryDate, stopLoss, targetExitDate, targetPnl, owner]);

  // Run constraint check on form changes (debounced)
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const data = buildSpreadData();
      if (!data) {
        setCheckResult(null);
        return;
      }
      setChecking(true);
      try {
        const result = await checkSpread(data);
        setCheckResult(result);
      } catch {
        // Silently fail constraint check — not critical
      } finally {
        setChecking(false);
      }
    }, 500);

    return () => clearTimeout(timerRef.current);
  }, [buildSpreadData]);

  const canSubmit = longTickers.trim() && shortTickers.trim() && theme.trim()
    && (!checkResult?.has_violations || overrideViolation);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data = buildSpreadData();
    if (!data) return;

    setSubmitting(true);
    try {
      await createSpread(data);
      toast('Spread created successfully', 'success');
      navigate('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create spread';
      toast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main form — 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Asset class + theme row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gh-text-muted mb-1 uppercase tracking-wide inline-flex items-center">
                Asset Class
                <InfoTip {...ENTRY_TOOLTIPS.assetClass} />
              </label>
              <select
                value={assetClass}
                onChange={e => setAssetClass(e.target.value as AssetClass)}
                className="w-full px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
              >
                {ASSET_CLASSES.map(ac => (
                  <option key={ac} value={ac}>{ac}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gh-text-muted mb-1 uppercase tracking-wide">
                Theme
              </label>
              <input
                type="text"
                value={theme}
                onChange={e => setTheme(e.target.value)}
                placeholder="e.g. EV valuation normalization"
                list="theme-suggestions"
                className="w-full px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
              />
              <datalist id="theme-suggestions">
                {THEME_SUGGESTIONS.map(s => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Legs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LegEditor
              label="Long Leg"
              color="border-gh-green/30 bg-gh-green/5"
              tickers={longTickers}
              setTickers={setLongTickers}
              weights={longWeights}
              setWeights={setLongWeights}
              allocation={longAlloc}
              setAllocation={setLongAlloc}
            />
            <LegEditor
              label="Short Leg"
              color="border-gh-red/30 bg-gh-red/5"
              tickers={shortTickers}
              setTickers={setShortTickers}
              weights={shortWeights}
              setWeights={setShortWeights}
              allocation={shortAlloc}
              setAllocation={setShortAlloc}
            />
          </div>

          {/* Quick Research Links */}
          {(longTickers.trim() || shortTickers.trim()) && (
            <div className="p-4 bg-gh-bg border border-gh-border rounded-lg">
              <h3 className="text-xs text-gh-text-muted uppercase tracking-wide mb-3">Quick Research & Alerts</h3>
              <div className="flex flex-wrap gap-2">
                {[...longTickers.split(','), ...shortTickers.split(',')]
                  .map(t => t.trim())
                  .filter(Boolean)
                  .map(ticker => (
                    <div key={ticker} className="flex items-center gap-1">
                      <span className="text-xs font-medium text-gh-text bg-gh-bg-secondary px-2 py-1 rounded">
                        {ticker}
                      </span>
                      <a
                        href={`https://finance.yahoo.com/quote/${ticker}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-1.5 py-1 rounded bg-gh-accent/10 text-gh-accent hover:bg-gh-accent/20 transition-colors"
                        title={`Yahoo Finance: ${ticker}`}
                      >
                        Yahoo
                      </a>
                      <a
                        href={`https://www.google.com/finance/quote/${ticker}:NASDAQ`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-1.5 py-1 rounded bg-gh-accent/10 text-gh-accent hover:bg-gh-accent/20 transition-colors"
                        title={`Google Finance: ${ticker}`}
                      >
                        Google
                      </a>
                      <a
                        href={`https://news.google.com/search?q=${ticker}%20stock`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-1.5 py-1 rounded bg-gh-yellow/10 text-gh-yellow hover:bg-gh-yellow/20 transition-colors"
                        title={`Google News alerts for ${ticker}`}
                      >
                        News
                      </a>
                      <a
                        href={`https://www.google.com/alerts#create:q=${ticker}%20stock&rt=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-1.5 py-1 rounded bg-gh-green/10 text-gh-green hover:bg-gh-green/20 transition-colors"
                        title={`Set up Google Alert for ${ticker}`}
                      >
                        Set Alert
                      </a>
                      <a
                        href={`https://seekingalpha.com/symbol/${ticker}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] px-1.5 py-1 rounded bg-gh-accent/10 text-gh-accent hover:bg-gh-accent/20 transition-colors"
                        title={`Seeking Alpha: ${ticker}`}
                      >
                        SA
                      </a>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Thesis */}
          <div>
            <label className="block text-xs text-gh-text-muted mb-1 uppercase tracking-wide">
              Investment Thesis
            </label>
            <textarea
              value={thesis}
              onChange={e => setThesis(e.target.value)}
              placeholder="Why does this spread generate alpha? What's the catalyst? What's the edge?"
              rows={4}
              className="w-full px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text resize-y"
            />
          </div>

          {/* Entry date + stop loss */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gh-text-muted mb-1 uppercase tracking-wide">
                Entry Date
              </label>
              <input
                type="date"
                value={entryDate}
                onChange={e => setEntryDate(e.target.value)}
                className="w-full px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
              />
            </div>
            <div>
              <label className="text-xs text-gh-text-muted mb-1 uppercase tracking-wide inline-flex items-center">
                Stop Loss %
                <InfoTip {...ENTRY_TOOLTIPS.stopLoss} />
              </label>
              <input
                type="number"
                value={stopLoss}
                onChange={e => setStopLoss(parseFloat(e.target.value) || 0)}
                step={5}
                className="w-full px-3 py-2 bg-gh-bg border border-gh-border rounded-lg text-sm text-gh-text"
              />
            </div>
          </div>

          {/* Exit Targets + Owner */}
          <div className="p-4 bg-gh-bg border border-gh-border rounded-lg space-y-4">
            <h3 className="text-xs text-gh-text-muted uppercase tracking-wide">Exit Targets & Ownership</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-gh-text-muted mb-1 inline-flex items-center">
                  Target Exit Date
                  <InfoTip {...ENTRY_TOOLTIPS.targetExitDate} />
                </label>
                <input
                  type="date"
                  value={targetExitDate}
                  onChange={e => setTargetExitDate(e.target.value)}
                  className="w-full px-3 py-2 bg-gh-bg-secondary border border-gh-border rounded-lg text-sm text-gh-text"
                />
              </div>
              <div>
                <label className="text-xs text-gh-text-muted mb-1 inline-flex items-center">
                  Target P&L %
                  <InfoTip {...ENTRY_TOOLTIPS.targetPnl} />
                </label>
                <input
                  type="number"
                  value={targetPnl}
                  onChange={e => setTargetPnl(e.target.value ? parseFloat(e.target.value) : '')}
                  placeholder="e.g. 15"
                  step={1}
                  className="w-full px-3 py-2 bg-gh-bg-secondary border border-gh-border rounded-lg text-sm text-gh-text"
                />
              </div>
              <div>
                <label className="text-xs text-gh-text-muted mb-1 inline-flex items-center">
                  Owner
                  <InfoTip {...ENTRY_TOOLTIPS.owner} />
                </label>
                <input
                  type="text"
                  value={owner}
                  onChange={e => setOwner(e.target.value)}
                  placeholder="Team member name"
                  className="w-full px-3 py-2 bg-gh-bg-secondary border border-gh-border rounded-lg text-sm text-gh-text"
                />
              </div>
            </div>
            {entryDate && targetExitDate && (
              <div className="text-xs text-gh-text-muted">
                Holding period: {Math.round((new Date(targetExitDate).getTime() - new Date(entryDate).getTime()) / (1000 * 60 * 60 * 24))} days
                {targetPnl !== '' && stopLoss ? (
                  <span className="ml-3">
                    Risk/reward: {Math.abs(stopLoss)}% risk for {targetPnl}% reward = <span className={Number(targetPnl) / Math.abs(stopLoss) >= 1 ? 'text-gh-green' : 'text-gh-red'}>{(Number(targetPnl) / Math.abs(stopLoss)).toFixed(1)}:1</span>
                  </span>
                ) : null}
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className={cn(
                'px-6 py-2.5 rounded-lg text-sm font-medium transition-colors',
                canSubmit && !submitting
                  ? 'bg-gh-accent text-white hover:bg-gh-accent/90'
                  : 'bg-gh-border text-gh-text-muted cursor-not-allowed',
              )}
            >
              {submitting ? 'Creating...' : 'Create Spread'}
            </button>

            {checkResult?.has_violations && (
              <label className="flex items-center gap-2 text-xs text-gh-yellow cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideViolation}
                  onChange={e => setOverrideViolation(e.target.checked)}
                  className="accent-gh-yellow"
                />
                I understand this violates constraints
              </label>
            )}
          </div>
        </div>

        {/* Constraint checker panel — right side */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 p-5 bg-gh-bg-secondary border border-gh-border rounded-lg">
            <h2 className="text-sm font-semibold text-gh-text mb-4 uppercase tracking-wide flex items-center gap-2">
              Live Constraint Check
              {checking && (
                <span className="inline-block w-3 h-3 rounded-full border-2 border-gh-accent border-t-transparent animate-spin" />
              )}
            </h2>

            {checkResult ? (
              <div className="space-y-1">
                {checkResult.constraints.map(c => (
                  <ConstraintBar
                    key={c.name}
                    name={c.name}
                    current={c.current_value}
                    limit={c.limit}
                    proposed={c.current_value} // The check endpoint returns the "proposed" state already
                  />
                ))}
                {checkResult.has_violations && (
                  <div className="mt-4 p-3 rounded-lg bg-gh-red/10 border border-gh-red/30 text-gh-red text-xs">
                    This spread would violate one or more mandate constraints.
                    You can still submit with the override checkbox.
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gh-text-muted">
                Enter tickers on both legs to see how this spread affects portfolio constraints.
              </p>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
