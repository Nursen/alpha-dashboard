/**
 * All tooltip content for the Alpha Dashboard.
 * Written in a conversational TA tone for MBA students learning finance.
 * Every explanation ends with WHY it matters for the market-neutral mandate.
 */

// ---------------------------------------------------------------------------
// Dashboard KPI Cards
// ---------------------------------------------------------------------------

export const KPI_TOOLTIPS = {
  netExposure: {
    title: 'Net Exposure',
    explanation:
      'The difference between your long positions and short positions. Think of it as your directional bet on the market. +10% means you\'re slightly bullish. 0% means perfectly market neutral. Your mandate says stay within \u00B110%.',
    source: 'Calculated from active spread allocations',
  },
  grossExposure: {
    title: 'Gross Exposure',
    explanation:
      'Total size of all your positions (longs + shorts added together, ignoring direction). This measures how much capital you have deployed. Higher = more leverage. Your mandate caps this at 120%.',
    source: 'Sum of all long + short allocation percentages',
  },
  activeSpreads: {
    title: 'Active Spreads',
    explanation:
      'Number of pair trades currently running in the portfolio. Each spread has a long leg (what you bought) and a short leg (what you sold short).',
  },
  portfolioPnl: {
    title: 'Portfolio P&L',
    explanation:
      'Total profit or loss across all active positions, measured from entry prices. Green = making money. Red = losing money. This is mark-to-market \u2014 based on current prices, not realized gains.',
    source: 'Live prices from Yahoo Finance vs. entry prices',
  },
} as const;

// ---------------------------------------------------------------------------
// Constraint Bars
// ---------------------------------------------------------------------------

export const CONSTRAINT_TOOLTIPS: Record<string, { title: string; explanation: string }> = {
  'Net Equity Exposure': {
    title: 'Net Equity Exposure',
    explanation:
      'How directional your equity book is. Your mandate says stay within \u00B110% \u2014 meaning your longs and shorts should roughly cancel out. Going beyond means you\'re making a market bet, which isn\'t your job.',
  },
  'Gross Leverage': {
    title: 'Gross Leverage',
    explanation:
      'Total capital deployed as a % of portfolio. Over 120% means you\'re using borrowed money (leverage). More leverage = more risk and more potential return. Your mandate caps this at 120%.',
  },
  'Max Single Position': {
    title: 'Max Single Position',
    explanation:
      'Largest individual ticker as a % of portfolio. Capped at 10% to prevent concentration risk \u2014 if one stock blows up, it shouldn\'t tank your whole fund. Think of it as avoiding a single point of failure.',
  },
  'Max Sector': {
    title: 'Max Sector',
    explanation:
      'Largest sector allocation. Capped at 25% so you\'re not overexposed to one industry. If tech crashes, it shouldn\'t wipe you out.',
  },
};

// ---------------------------------------------------------------------------
// Spread Review Quick Stats
// ---------------------------------------------------------------------------

export const STAT_TOOLTIPS = {
  pnl: {
    title: 'Profit & Loss',
    explanation:
      'How much this spread has made or lost since entry. Calculated as: (long leg return) minus (short leg return). Positive = your long pick is outperforming your short pick.',
    source: 'Live prices from Yahoo Finance vs. entry prices',
  },
  correlation: {
    title: 'Correlation',
    explanation:
      'How closely the two legs move together, from -1 to +1. High correlation (>0.7) means they move in sync \u2014 good for pairs because the spread is more predictable. Low correlation means they move independently \u2014 the spread will be more volatile.',
    source: '1-year daily returns from Yahoo Finance',
  },
  spreadSharpe: {
    title: 'Spread Sharpe Ratio',
    explanation:
      'Return per unit of risk for this spread. Think of it as efficiency \u2014 miles per gallon for your trade. Below 0.5 = poor. 0.5-1.0 = decent. Above 1.0 = good. Above 2.0 = exceptional. Calculated as (annualized return - risk-free rate) / annualized volatility.',
    source: '1-year historical spread returns, risk-free rate = 4.3% (SOFR)',
  },
  zscore: {
    title: 'Z-Score',
    explanation:
      'How far the current spread is from its average, measured in standard deviations. Z = 0 means at the mean. Z > 2 means unusually wide (potential entry for mean reversion). Z < -2 means unusually narrow. For your mandate, this helps time entries and exits.',
    source: 'Rolling 60-day mean and standard deviation of cumulative spread',
  },
  daysHeld: {
    title: 'Days Held',
    explanation:
      'Calendar days since this spread was entered. Track this against your target exit date. Longer holds increase exposure to thesis drift \u2014 the original reason for the trade may no longer apply.',
  },
} as const;

// ---------------------------------------------------------------------------
// Chart Descriptions (shown as small text above charts)
// ---------------------------------------------------------------------------

export const CHART_DESCRIPTIONS = {
  normalizedPrice:
    'Both legs rebased to 100 at the start. If the green line (long) is above 100 and the red line (short) is below 100, your spread is profitable. The wider the gap, the more you\'re making.',
  spread:
    'The cumulative spread \u2014 your long minus your short. When it\'s above zero (green area), you\'re making money. The yellow dashed lines show \u00B11 standard deviation and the red dashed lines show \u00B12 standard deviations from the rolling mean. Extreme z-scores may signal an entry or exit point.',
  rollingCorrelation:
    'How the correlation between your two legs changes over time (60-day rolling window). If correlation drops suddenly, the pair may be breaking down \u2014 your thesis might need review.',
} as const;

// ---------------------------------------------------------------------------
// Fundamentals Tab
// ---------------------------------------------------------------------------

export const FUNDAMENTALS_TOOLTIPS = {
  scoreHeader:
    'Each ticker gets a fundamental quality score from 0-100, measuring five dimensions: growth (revenue trajectory), profitability (margins), financial health (debt levels), cash flow (actual money generated), and valuation (how expensive). Higher score = stronger company. For your pair to make sense, the long leg should score higher than the short leg.',
  growth: {
    title: 'Growth',
    explanation: 'Revenue and earnings growth rate. Fast-growing companies score higher.',
  },
  profitability: {
    title: 'Profitability',
    explanation: 'Operating margins and whether they\'re improving. Higher margins = more efficient business.',
  },
  health: {
    title: 'Health',
    explanation: 'Balance sheet strength \u2014 how much debt vs. equity. Low debt = healthier.',
  },
  cashflow: {
    title: 'Cash Flow',
    explanation: 'Free cash flow yield and growth. This is actual cash the business generates, not accounting profit.',
  },
  valuation: {
    title: 'Valuation',
    explanation: 'How cheap or expensive the stock is (P/E, EV/EBITDA). LOWER valuation = HIGHER score, because cheaper stocks have more upside potential.',
  },
  source: 'Source: Financial statements from Yahoo Finance (quarterly, most recent available). Scores are computed by the dashboard \u2014 not analyst ratings.',
} as const;

// Map category labels to tooltip keys
export const FUNDAMENTAL_CATEGORY_MAP: Record<string, keyof Pick<typeof FUNDAMENTALS_TOOLTIPS, 'growth' | 'profitability' | 'health' | 'cashflow' | 'valuation'>> = {
  Growth: 'growth',
  Profitability: 'profitability',
  Health: 'health',
  'Cash Flow': 'cashflow',
  Valuation: 'valuation',
};

// ---------------------------------------------------------------------------
// Risk Tab
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Risk Page — Portfolio-Level Metrics
// ---------------------------------------------------------------------------

export const RISK_PAGE_TOOLTIPS = {
  sharpe: {
    title: 'Portfolio Sharpe Ratio',
    explanation:
      'Portfolio return per unit of risk. Think of it as efficiency — are you being compensated enough for the risk you\'re taking? Above 1.0 is good for a market-neutral fund. Below 0.5 means you\'re taking risk without adequate reward.',
    source: 'Annualized from daily portfolio returns, risk-free rate = 4.3% (SOFR)',
  },
  annualReturn: {
    title: 'Annualized Return',
    explanation:
      'Expected yearly return based on recent daily performance, extrapolated to a full year (x252 trading days). This is hypothetical — past performance doesn\'t guarantee future results.',
    source: 'Daily weighted portfolio returns, annualized',
  },
  annualVol: {
    title: 'Annualized Volatility',
    explanation:
      'How much the portfolio bounces around, annualized. Lower is better for market-neutral. Think of it as the "noise level" — 10% means your portfolio typically swings +/-10% per year.',
    source: 'Standard deviation of daily returns x sqrt(252)',
  },
  beta: {
    title: 'Beta to SPY',
    explanation:
      'How much your portfolio moves with the S&P 500. For market neutral, this should be near 0. If it\'s 0.3, you\'re 30% correlated to the market — meaning 30% of your returns are just market exposure, not alpha.',
    source: 'Covariance of portfolio returns with SPY / variance of SPY, 1-year',
  },
  maxDrawdown: {
    title: 'Max Drawdown',
    explanation:
      'Worst peak-to-trough loss in portfolio history. This is the "worst day at the office" metric. If it\'s -15%, there was a stretch where you went from your best to 15% below your best.',
    source: 'Historical portfolio cumulative returns',
  },
  var95: {
    title: '95% VaR (1-Day)',
    explanation:
      'Value at Risk — on 95% of trading days, your portfolio won\'t lose more than this amount. Like P95 latency: "we\'re 95% confident daily loss won\'t exceed X%."',
    source: 'Historical simulation of daily returns, 5th percentile',
  },
  riskContribution: {
    title: 'Risk Contribution %',
    explanation:
      'What % of total portfolio risk comes from this spread. If one spread contributes 40% of risk but only 10% of allocation, it\'s disproportionately risky — consider right-sizing.',
    source: 'Marginal contribution to volatility, normalized to 100%',
  },
  standaloneVol: {
    title: 'Standalone Volatility',
    explanation:
      'This spread\'s volatility if you held it alone. Compare to portfolio vol — diversification should make the portfolio less volatile than any single spread.',
    source: 'Annualized standard deviation of spread daily returns',
  },
  corrToSpy: {
    title: 'Correlation to SPY',
    explanation:
      'How correlated this spread is with the market. For market neutral, each spread should have low correlation to SPY. High correlation means this spread is adding directional market exposure.',
    source: 'Pearson correlation of daily returns with SPY, 1-year',
  },
} as const;

export const RISK_TOOLTIPS = {
  maxDrawdown: {
    title: 'Max Drawdown',
    explanation:
      'The largest peak-to-trough decline in this spread\'s history. Think of it as the worst-case pain point. If max drawdown is -25%, there was a period where you\'d have been down 25% from your best point.',
  },
  beta: {
    title: 'Beta (Long / Short / Net)',
    explanation:
      'Beta measures sensitivity to the overall market (S&P 500). Beta = 1 means moves with the market. Beta = 0 means independent. For market neutral, your NET beta (long beta minus short beta) should be close to 0.',
    source: 'Regression of daily returns against SPY, 1-year history',
  },
  halfLife: {
    title: 'Half-Life',
    explanation:
      'For mean-reverting spreads, half-life tells you how many days it typically takes for the spread to move halfway back to its average. Shorter half-life = faster mean reversion = trade resolves quicker.',
  },
  daysHeld: {
    title: 'Days Held',
    explanation:
      'Calendar days since this spread was entered. Track this against your target exit date. Longer holds increase exposure to thesis drift \u2014 the original reason for the trade may no longer apply.',
  },
} as const;

// ---------------------------------------------------------------------------
// Spread Entry Form Fields
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Explore Page Tabs
// ---------------------------------------------------------------------------

export const EXPLORE_TOOLTIPS = {
  signals: {
    title: 'Signal Scanner',
    explanation:
      'The signals engine automatically scans ~80 liquid US stocks for three types of opportunities: pairs that are statistically mean-reverting (cointegration), pairs with diverging valuations (one cheap, one expensive in the same sector), and pairs whose historical correlation has broken down (potential convergence). These are starting points for research, not guaranteed trades.',
    source: 'Automated scan of ~80 stocks across 8 sectors',
  },
  sectorHeatmap: {
    title: 'Sector Heatmap',
    explanation:
      'Shows how each sector of the S&P 500 is performing. Green = up, red = down. Use this to spot sector rotation \u2014 if energy is hot and tech is cold, look for pairs within those sectors.',
    source: 'Sector ETF prices from Yahoo Finance',
  },
  correlationExplorer: {
    title: 'Correlation Explorer',
    explanation:
      'Enter any tickers to see how correlated they are. Correlation near +1 means they move together (good for pairs). Near 0 means independent. Near -1 means they move opposite. For your pairs, you want moderate positive correlation (0.3-0.7) \u2014 enough structure for the spread to be predictable, but not so high that there\'s no spread to trade.',
    source: '1-year daily returns from Yahoo Finance',
  },
  news: {
    title: 'News Feed',
    explanation:
      'Latest news for your portfolio tickers. Breaking news can be a catalyst \u2014 or a warning sign. Check here before and after entering a position.',
  },
  screener: {
    title: 'Stock Screener',
    explanation:
      'Search for stocks that meet your criteria. This is a starting point for finding new positions. The universe covers ~100 liquid US stocks.',
    source: 'Yahoo Finance fundamentals (cached, may be delayed up to 1 hour)',
  },
  factorMomentum: {
    title: 'Factor Momentum',
    explanation:
      'Factors are systematic drivers of stock returns that academics have identified. Momentum = stocks that went up keep going up. Value = cheap stocks outperform. Quality = profitable companies outperform. When a factor is strong (green), consider tilting your pairs toward that factor.',
    source: 'Factor ETF prices from Yahoo Finance',
  },
} as const;

// ---------------------------------------------------------------------------
// Signal Types
// ---------------------------------------------------------------------------

export const SIGNAL_TYPE_TOOLTIPS = {
  cointegration: {
    title: 'Cointegration Signal',
    explanation:
      'These two stocks have a statistically significant long-run equilibrium relationship. When the spread deviates from its mean, it tends to revert back. The z-score tells you how far from normal the spread is right now. |Z| > 2 is a strong signal.',
  },
  valuation: {
    title: 'Valuation Divergence',
    explanation:
      'One stock in this pair looks cheap relative to the other on fundamental metrics (P/E ratio, etc.). The thesis is that valuations in the same sector tend to converge over time. Long the cheap one, short the expensive one.',
  },
  correlation_breakdown: {
    title: 'Correlation Breakdown',
    explanation:
      'These two stocks historically move together, but recently their correlation has broken down. This could signal a temporary divergence that will revert, or a structural change. Investigate the reason before trading.',
  },
} as const;

// ---------------------------------------------------------------------------
// Factor Definitions
// ---------------------------------------------------------------------------

export const FACTOR_TOOLTIPS: Record<string, { title: string; explanation: string }> = {
  Momentum: {
    title: 'Momentum Factor',
    explanation: 'Stocks that have performed well recently tend to continue performing well. This factor is captured by the MTUM ETF. Strong momentum means "winners keep winning" is working.',
  },
  Value: {
    title: 'Value Factor',
    explanation: 'Cheap stocks (low P/E, low price-to-book) tend to outperform expensive ones over time. Captured by the VLUE ETF. When value is strong, look for undervalued longs.',
  },
  Quality: {
    title: 'Quality Factor',
    explanation: 'Companies with high profitability, low debt, and stable earnings tend to outperform. Captured by the QUAL ETF. Quality is often a "flight to safety" factor.',
  },
  'Low Volatility': {
    title: 'Low Volatility Factor',
    explanation: 'Less volatile stocks tend to deliver better risk-adjusted returns than theory predicts. Captured by the USMV ETF. When this factor is strong, the market prefers safety.',
  },
  Size: {
    title: 'Size Factor',
    explanation: 'Small-cap stocks have historically outperformed large-caps over long periods, though with more risk. Captured by the SIZE ETF. When small-caps lead, risk appetite is high.',
  },
};

// ---------------------------------------------------------------------------
// Screener Field Tooltips
// ---------------------------------------------------------------------------

export const SCREENER_TOOLTIPS = {
  sector: {
    title: 'Sector Filter',
    explanation: 'Filter stocks by GICS sector. Pairs within the same sector tend to have higher correlation and more predictable spreads.',
  },
  marketCap: {
    title: 'Market Cap (Billions)',
    explanation: 'Minimum market capitalization in billions of dollars. Larger companies are more liquid and easier to short. For your fund, stay above $5B to ensure you can actually execute trades.',
  },
  pe: {
    title: 'Max P/E Ratio',
    explanation: 'Price-to-earnings ratio cap. Lower P/E = cheaper stock. A P/E of 15 means investors pay $15 for every $1 of earnings. Filtering by max P/E helps find value stocks for the long side.',
  },
  volume: {
    title: 'Min Avg Volume',
    explanation: 'Minimum average daily trading volume. Higher volume = easier to enter and exit positions without moving the price. For pairs trading, liquidity matters on BOTH sides.',
  },
} as const;

// ---------------------------------------------------------------------------
// Position-Level Risk Page (StockTrak positions)
// ---------------------------------------------------------------------------

export const POSITION_RISK_TOOLTIPS = {
  grossExposure: {
    title: 'Gross Exposure',
    explanation:
      'Total dollar value of all positions (longs + shorts), ignoring direction. Measures how much capital is deployed. Higher = more leverage. Think of it as the "total bet size" of your portfolio.',
    source: 'Sum of |market value| for all positions',
  },
  netExposure: {
    title: 'Net Exposure',
    explanation:
      'Long market value minus short market value. This is your directional bet. If positive, you profit when markets go up. For market neutral, this should be near zero.',
    source: 'Long MV - Short MV from current position prices',
  },
  betaAdjustedNet: {
    title: 'Beta-Adjusted Net Exposure',
    explanation:
      'Net exposure weighted by each position\'s beta (market sensitivity). A stock with beta 2.0 contributes twice as much market exposure as one with beta 1.0. This is a better measure of true market exposure than raw net.',
    source: 'Sum of (beta_i x signed_MV_i) from Yahoo Finance betas',
  },
  longShortRatio: {
    title: 'Long/Short Ratio',
    explanation:
      'Total long market value divided by total short market value. A ratio of 1.0 means perfectly balanced. Above 1.0 = net long bias. Below 1.0 = net short bias.',
  },
  parametricVar: {
    title: 'Parametric VaR',
    explanation:
      'Value at Risk assuming returns follow a normal (bell curve) distribution. "On 95% of days, we won\'t lose more than X." Like P95 latency for your portfolio. The dollar amount shows the actual dollar loss at that confidence level.',
    source: 'Mean + z-score x std_dev of daily portfolio returns, ~1 year',
  },
  historicalVar: {
    title: 'Historical VaR',
    explanation:
      'Value at Risk using actual historical returns (no normal distribution assumption). Often more accurate because real returns have "fat tails" — extreme moves happen more often than a bell curve predicts.',
    source: '5th/1st percentile of actual daily portfolio P&L, ~1 year',
  },
  maxDrawdown: {
    title: 'Max Drawdown',
    explanation:
      'Worst peak-to-trough decline. If your portfolio hit $105K then dropped to $90K, that\'s a -14.3% drawdown. This is the "worst pain" metric — how bad did it get?',
    source: 'Simulated NAV from historical returns of current holdings',
  },
  currentDrawdown: {
    title: 'Current Drawdown',
    explanation:
      'How far below the portfolio\'s all-time high we are right now. 0% means we\'re at peak. -5% means we\'re 5% below our best point.',
  },
  themeCorrelation: {
    title: 'Theme Correlation',
    explanation:
      'How correlated your investment themes are with each other. Low inter-theme correlation means good diversification — when one theme loses, others don\'t necessarily follow. High correlation (>0.5) means your themes move together, reducing diversification benefit.',
    source: 'Value-weighted returns by theme, 6-month rolling window',
  },
  scenarioAnalysis: {
    title: 'Scenario Analysis',
    explanation:
      'Estimates how much the portfolio would lose (or gain) under hypothetical stress events. Uses position betas for market shocks, duration for rate moves, and FX exposure for dollar strength. These are estimates, not guarantees.',
    source: 'Position betas from Yahoo Finance, bond durations estimated',
  },
} as const;

export const ENTRY_TOOLTIPS = {
  assetClass: {
    title: 'Asset Class',
    explanation:
      'The category of financial instrument. Equities = stocks. Bonds = fixed income (loans to companies/governments). Commodities = physical goods (gold, oil). FX = currencies.',
  },
  stopLoss: {
    title: 'Stop Loss %',
    explanation:
      'If the spread loses this much, close it automatically. Set at -50% by default. This is your circuit breaker \u2014 it limits how much any single trade can hurt the portfolio.',
  },
  targetExitDate: {
    title: 'Target Exit Date',
    explanation:
      'When do you expect this trade to resolve? Having a target prevents \'thesis drift\' \u2014 holding a position long after your original reason has played out.',
  },
  targetPnl: {
    title: 'Target P&L %',
    explanation:
      'Your profit target. When the spread reaches this gain, consider taking profits. The risk/reward ratio below shows if the potential gain justifies the risk (stop loss).',
  },
  owner: {
    title: 'Owner',
    explanation:
      'Which team member is responsible for monitoring this spread and reporting on it to the IC (Investment Committee).',
  },
} as const;
