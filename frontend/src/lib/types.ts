export interface SpreadLeg {
  tickers: string[];
  weights: number[];
  allocation_pct: number;
}

export interface SpreadCreate {
  asset_class: string;
  theme: string;
  thesis: string;
  long_leg: SpreadLeg;
  short_leg: SpreadLeg;
  entry_date: string;
  stop_loss_pct: number;
  target_exit_date?: string;
  target_pnl_pct?: number;
  owner?: string;
}

export interface Spread extends SpreadCreate {
  id: string;
  status: string;
  created_by: string;
  created_at: string;
  entry_prices: Record<string, number>;
  current_prices: Record<string, number> | null;
  pnl_pct: number | null;
  notes: Array<{ author: string; text: string; date: string }>;
}

export interface ConstraintStatus {
  name: string;
  current_value: number;
  limit: number;
  utilization_pct: number;
  status: string; // 'ok' | 'warning' | 'violation'
}

export interface PortfolioSummary {
  total_long_pct: number;
  total_short_pct: number;
  net_exposure_pct: number;
  gross_exposure_pct: number;
  num_spreads: number;
  constraints: ConstraintStatus[];
}

export interface ConstraintCheckResult {
  constraints: ConstraintStatus[];
  has_violations: boolean;
}

export type AssetClass = 'Equities' | 'Bonds' | 'Commodities' | 'FX';

export const ASSET_CLASSES: AssetClass[] = ['Equities', 'Bonds', 'Commodities', 'FX'];

export const THEME_SUGGESTIONS = [
  'Relative value',
  'Mean reversion',
  'Momentum divergence',
  'Sector rotation',
  'Macro hedge',
  'Event-driven',
  'Carry trade',
  'Curve steepener/flattener',
];

// ---------------------------------------------------------------------------
// Explore: Signals
// ---------------------------------------------------------------------------

export interface Signal {
  long: string;
  short: string;
  signal_type: 'cointegration' | 'valuation' | 'correlation_breakdown';
  strength: number; // 0-100
  zscore: number;
  rationale: string;
  p_value?: number;
  pe_long?: number;
  pe_short?: number;
  historical_corr?: number;
  recent_corr?: number;
}

// ---------------------------------------------------------------------------
// Explore: Sector Heatmap
// ---------------------------------------------------------------------------

export interface SectorData {
  sector_name: string;
  etf: string;
  daily_return_pct: number;
  weekly_return_pct: number;
  monthly_return_pct: number;
}

// ---------------------------------------------------------------------------
// Explore: Factor Momentum
// ---------------------------------------------------------------------------

export interface FactorData {
  factor_name: string;
  etf: string;
  daily_return: number;
  weekly_return: number;
  monthly_return: number;
  ytd_return: number;
}

// ---------------------------------------------------------------------------
// Explore: Stock Screener
// ---------------------------------------------------------------------------

export interface ScreenerParams {
  sector?: string;
  min_market_cap?: number;
  max_pe?: number;
  min_volume?: number;
}

export interface StockResult {
  ticker: string;
  name: string;
  sector: string;
  market_cap: number;
  pe_ratio: number;
  volume: number;
  price: number;
  high_52w: number;
  low_52w: number;
}

// ---------------------------------------------------------------------------
// Explore: Investigation
// ---------------------------------------------------------------------------

export interface InvestigationResult {
  analytics: SpreadAnalytics;
  fundamentals: PairComparison;
  constraints: ConstraintCheckResult;
}

// ---------------------------------------------------------------------------
// Portfolio: PnL
// ---------------------------------------------------------------------------

export interface PortfolioPnL {
  dates: string[];
  daily_pnl: number[];
  cumulative_pnl: number[];
}

// ---------------------------------------------------------------------------
// PnL Module (StockTrak snapshot-based)
// ---------------------------------------------------------------------------

export interface PnLPosition {
  symbol: string;
  description: string;
  quantity: number;
  currency: string;
  last_price: number;
  price_paid: number;
  day_change: number;
  profit_loss: number;
  market_value: number;
  pnl_pct: number;
  side: 'long' | 'short';
  asset_class: string;
  theme: string;
}

export interface PnLTheme {
  theme: string;
  pnl: number;
  pnl_pct: number;
  market_value: number;
}

export interface PnLAssetClass {
  asset_class: string;
  pnl: number;
  market_value: number;
}

export interface PnLLatest {
  has_data: boolean;
  message?: string;
  upload_date?: string;
  num_positions?: number;
  portfolio_value?: number;
  total_pnl?: number;
  total_pnl_pct?: number;
  pnl_by_theme?: PnLTheme[];
  pnl_by_asset_class?: PnLAssetClass[];
  positions?: PnLPosition[];
  periods?: {
    wtd: number;
    mtd: number;
    ttd: number;
  };
}

export interface NavPoint {
  date: string;
  value: number;
}

export interface PnLHistory {
  num_snapshots: number;
  nav_series: NavPoint[];
  initial_value: number;
}

// ---------------------------------------------------------------------------
// Portfolio: Optimization
// ---------------------------------------------------------------------------

export interface OptimizationResult {
  current_weights: Record<string, number>;
  optimal_weights: Record<string, number>;
  current_sharpe: number;
  optimal_sharpe: number;
  rebalance_suggestions: string[];
}

// ---------------------------------------------------------------------------
// Explore: Correlation Matrix
// ---------------------------------------------------------------------------

export interface CorrelationMatrix {
  tickers: string[];
  matrix: number[][];
}

// ---------------------------------------------------------------------------
// Portfolio Risk Attribution
// ---------------------------------------------------------------------------

export interface PortfolioMetrics {
  sharpe_ratio: number;
  annualized_return_pct: number;
  annualized_vol_pct: number;
  beta_to_spy: number | null;
  max_drawdown_pct: number;
  var_95_pct: number;
  var_99_pct: number;
  correlation_to_spy: number | null;
}

export interface SpreadRisk {
  spread_id: string;
  name: string;
  theme: string;
  asset_class: string;
  allocation_pct: number;
  risk_contribution_pct: number;
  marginal_vol_contribution: number;
  standalone_vol_pct: number;
  standalone_sharpe: number;
  correlation_to_portfolio: number;
  correlation_to_spy: number | null;
  max_drawdown_pct: number;
  current_pnl_pct: number | null;
  status: 'ok' | 'warning' | 'critical';
}

export interface RiskAlert {
  type: string;
  spread_name: string;
  message: string;
  severity: 'warning' | 'critical';
  spread_id: string | null;
}

export interface PortfolioRisk {
  portfolio_metrics: PortfolioMetrics;
  spread_risk: SpreadRisk[];
  risk_alerts: RiskAlert[];
  error?: string;
}

// --- Spread Analytics ---

export interface SpreadAnalytics {
  correlation: number | null;
  beta_long: number | null;
  beta_short: number | null;
  net_beta: number | null;
  spread_sharpe: number | null;
  spread_ann_return: number | null;
  spread_ann_vol: number | null;
  current_zscore: number | null;
  half_life_days: number | null;
  max_drawdown_pct: number | null;
  price_data: {
    dates: string[];
    long_normalized: number[];
    short_normalized: number[];
    spread: number[];
    zscore_series: number[];
  };
  rolling_correlation: {
    dates: string[];
    values: number[];
  };
}

// --- Fundamentals Comparison ---

export interface FundamentalScore {
  ticker: string;
  total_score: number;
  growth_score: number;
  profitability_score: number;
  health_score: number;
  cashflow_score: number;
  valuation_score: number;
  details: Record<string, number | null>;
}

export interface PairComparison {
  long: FundamentalScore;
  short: FundamentalScore;
  score_delta: number;
  direction_valid: boolean;
  warning: string | null;
  key_divergences: Array<{
    metric: string;
    long: string;
    short: string;
    favors: 'long' | 'short';
  }>;
  side_by_side: Record<string, { long: number | null; short: number | null }>;
}

// ---------------------------------------------------------------------------
// Position-Level Risk (StockTrak positions)
// ---------------------------------------------------------------------------

export interface RiskExposures {
  gross_exposure: number;
  net_exposure: number;
  long_exposure: number;
  short_exposure: number;
  gross_exposure_pct: number;
  net_exposure_pct: number;
  long_short_ratio: number | null;
  beta_adjusted_net_exposure: number;
  beta_adjusted_net_pct: number;
  missing_beta_tickers: string[];
}

export interface VaRBucket {
  var_95_pct: number;
  var_99_pct: number;
  var_95_dollar: number;
  var_99_dollar: number;
}

export interface VaRData {
  parametric: VaRBucket;
  historical: VaRBucket;
  portfolio_daily_vol_pct: number;
  num_observations: number;
  error?: string;
}

export interface DrawdownData {
  max_drawdown_pct: number;
  max_drawdown_date: string | null;
  current_drawdown_pct: number;
  recovery_days: number | null;
  nav_dates: string[];
  nav_values: number[];
  error?: string;
}

export interface ThemeCorrelation {
  themes: string[];
  matrix: number[][];
}

export interface ScenarioResult {
  scenario: string;
  category: string;
  impact_dollar: number;
  impact_pct: number;
}

export interface PositionFlag {
  ticker: string;
  side: string;
  pnl_pct: number;
  pnl_dollar: number;
  market_value: number;
  flag: 'winner' | 'loser';
  message: string;
}

export interface PositionDetail {
  ticker: string;
  side: string;
  shares: number;
  entry_price: number;
  current_price: number;
  market_value: number;
  pnl_pct: number;
  pnl_dollar: number;
  weight_pct: number;
  beta: number | null;
  theme: string;
}

export interface RiskSummary {
  exposures: RiskExposures;
  var: VaRData;
  drawdown: DrawdownData;
  correlation: ThemeCorrelation;
  scenarios: ScenarioResult[];
  flags: PositionFlag[];
  positions: PositionDetail[];
  meta: {
    num_positions: number;
    num_long: number;
    num_short: number;
    tickers_with_data: number;
    tickers_missing_data: string[];
    portfolio_value: number;
  };
}
