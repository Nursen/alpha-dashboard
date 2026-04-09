from pydantic import BaseModel


class FundamentalScore(BaseModel):
    ticker: str
    total_score: int
    growth_score: int
    profitability_score: int
    health_score: int
    cashflow_score: int
    valuation_score: int
    details: dict


class PairComparison(BaseModel):
    long: FundamentalScore
    short: FundamentalScore
    score_delta: int
    direction_valid: bool
    warning: str | None
    key_divergences: list[dict]
    side_by_side: dict
