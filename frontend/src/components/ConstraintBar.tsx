import { cn, constraintColor, constraintBgClass } from '@/lib/utils';
import { InfoTip } from '@/components/Tooltip';
import { CONSTRAINT_TOOLTIPS } from '@/lib/tooltips';

interface ConstraintBarProps {
  name: string;
  current: number;
  limit: number;
  /** If provided, shows a ghost segment for the proposed value */
  proposed?: number;
  /** Optional tooltip override */
  tooltip?: { title: string; explanation: string };
}

export function ConstraintBar({ name, current, limit, proposed, tooltip }: ConstraintBarProps) {
  const absLimit = Math.abs(limit);
  const absCurrent = Math.abs(current);
  const absProposed = proposed !== undefined ? Math.abs(proposed) : undefined;

  const utilization = absLimit > 0 ? (absCurrent / absLimit) * 100 : 0;
  const proposedUtil = absProposed !== undefined && absLimit > 0
    ? (absProposed / absLimit) * 100
    : undefined;

  const color = constraintColor(utilization);
  const proposedColor = proposedUtil !== undefined ? constraintColor(proposedUtil) : undefined;

  const fillWidth = Math.min(utilization, 100);
  const proposedWidth = proposedUtil !== undefined ? Math.min(proposedUtil, 100) : undefined;

  // Status icon
  const icon = color === 'green' ? '\u2705' : color === 'yellow' ? '\u26A0\uFE0F' : '\u274C';

  // Delta text
  const delta = proposed !== undefined
    ? `${current.toFixed(1)}% \u2192 ${proposed.toFixed(1)}% (${proposed >= current ? '+' : ''}${(proposed - current).toFixed(1)}%)`
    : null;

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1 text-sm">
        <span className="text-gh-text-muted inline-flex items-center">
          {name}
          {(tooltip || CONSTRAINT_TOOLTIPS[name]) && (
            <InfoTip
              title={(tooltip || CONSTRAINT_TOOLTIPS[name]).title}
              explanation={(tooltip || CONSTRAINT_TOOLTIPS[name]).explanation}
            />
          )}
        </span>
        <span className="flex items-center gap-2">
          {delta && (
            <span className={cn(
              'text-xs',
              proposedColor === 'red' && 'text-gh-red',
              proposedColor === 'yellow' && 'text-gh-yellow',
              proposedColor === 'green' && 'text-gh-green',
            )}>
              {delta}
            </span>
          )}
          <span className="text-gh-text">
            {absCurrent.toFixed(1)}% / {limit > 0 ? '' : '\u00B1'}{absLimit}%
          </span>
          <span className="text-sm">{icon}</span>
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-gh-bg overflow-hidden border border-gh-border">
        {/* Proposed ghost bar (renders behind current bar when proposed > current) */}
        {proposedWidth !== undefined && proposedWidth > fillWidth && (
          <div
            className={cn(
              'constraint-bar-fill absolute inset-y-0 left-0 rounded-full opacity-30',
              proposedColor && constraintBgClass(proposedColor),
            )}
            style={{ width: `${proposedWidth}%` }}
          />
        )}
        {/* Current fill */}
        <div
          className={cn(
            'constraint-bar-fill absolute inset-y-0 left-0 rounded-full',
            constraintBgClass(color),
          )}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}
