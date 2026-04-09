from pydantic import BaseModel


class ConstraintStatus(BaseModel):
    name: str
    current_value: float
    limit: float
    utilization_pct: float  # current/limit * 100
    status: str  # ok, warning, violation


class PortfolioSummary(BaseModel):
    total_long_pct: float
    total_short_pct: float
    net_exposure_pct: float
    gross_exposure_pct: float
    num_spreads: int
    constraints: list[ConstraintStatus]
