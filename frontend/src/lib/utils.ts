/** Merge class names, filtering out falsy values */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Format a number as percentage with sign */
export function fmtPct(value: number, decimals = 1): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Get constraint bar color based on utilization percentage */
export function constraintColor(utilization: number): 'green' | 'yellow' | 'red' {
  if (utilization < 60) return 'green';
  if (utilization < 85) return 'yellow';
  return 'red';
}

/** Map constraint color to Tailwind bg classes */
export function constraintBgClass(color: 'green' | 'yellow' | 'red'): string {
  return {
    green: 'bg-gh-green',
    yellow: 'bg-gh-yellow',
    red: 'bg-gh-red',
  }[color];
}

/** Get today's date as YYYY-MM-DD */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Debounce a function */
export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
