import { useState, useRef, useEffect, type ReactNode } from 'react';

interface TooltipProps {
  label?: string;
  title: string;
  explanation: string;
  source?: string;
  children?: ReactNode;
}

/**
 * Tooltip popover that appears on hover. Shows title, explanation, and optional source.
 * Positions above by default, falls back to below if near top of viewport.
 */
export function Tooltip({ title, explanation, source, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [above, setAbove] = useState(true);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (visible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // If trigger is within 180px of the top, show below instead
      setAbove(rect.top > 180);
    }
  }, [visible]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center gap-1"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      <span
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gh-text-muted/40
                   text-[9px] leading-none text-gh-text-muted hover:text-gh-accent hover:border-gh-accent/60
                   cursor-help transition-colors flex-shrink-0 select-none"
        aria-label={`Info: ${title}`}
      >
        i
      </span>
      {visible && (
        <span
          className={`absolute z-50 left-1/2 -translate-x-1/2 w-[300px]
                      bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl p-3
                      transition-opacity duration-150
                      ${above ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          // Prevent the popover from being clipped on the left edge
          style={{ minWidth: 240, maxWidth: 300 }}
        >
          <span className="block text-sm font-semibold text-gh-text">{title}</span>
          <span className="block text-xs text-gh-text-muted mt-1 leading-relaxed">{explanation}</span>
          {source && (
            <span className="block text-[10px] text-gh-text-muted/60 mt-2 italic">{source}</span>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * Compact info icon with tooltip -- for placing inline next to existing labels.
 * Does NOT render children; just the (i) icon and popover.
 */
export function InfoTip({ title, explanation, source }: Omit<TooltipProps, 'children' | 'label'>) {
  const [visible, setVisible] = useState(false);
  const [above, setAbove] = useState(true);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (visible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setAbove(rect.top > 180);
    }
  }, [visible]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gh-text-muted/40
                   text-[9px] leading-none text-gh-text-muted hover:text-gh-accent hover:border-gh-accent/60
                   cursor-help transition-colors flex-shrink-0 select-none ml-1"
        aria-label={`Info: ${title}`}
      >
        i
      </span>
      {visible && (
        <span
          className={`absolute z-50 left-1/2 -translate-x-1/2 w-[300px]
                      bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl p-3
                      transition-opacity duration-150
                      ${above ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          style={{ minWidth: 240, maxWidth: 300 }}
        >
          <span className="block text-sm font-semibold text-gh-text">{title}</span>
          <span className="block text-xs text-gh-text-muted mt-1 leading-relaxed">{explanation}</span>
          {source && (
            <span className="block text-[10px] text-gh-text-muted/60 mt-2 italic">{source}</span>
          )}
        </span>
      )}
    </span>
  );
}
