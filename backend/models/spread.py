from datetime import datetime
from pydantic import BaseModel, field_validator


class SpreadLeg(BaseModel):
    tickers: list[str]
    weights: list[float]  # must sum to ~1.0
    allocation_pct: float  # % of portfolio AUM

    @field_validator("weights")
    @classmethod
    def weights_sum_to_one(cls, v):
        if abs(sum(v) - 1.0) > 0.01:
            raise ValueError(f"Weights must sum to 1.0, got {sum(v)}")
        return v

    @field_validator("tickers")
    @classmethod
    def tickers_match_weights(cls, v, info):
        weights = info.data.get("weights")
        if weights and len(v) != len(weights):
            raise ValueError("tickers and weights must have same length")
        return [t.upper() for t in v]


class SpreadCreate(BaseModel):
    asset_class: str  # equities, bonds, commodities, fx
    theme: str
    thesis: str
    long_leg: SpreadLeg
    short_leg: SpreadLeg
    entry_date: str  # ISO date string
    stop_loss_pct: float = -50.0
    # Exit targets
    target_exit_date: str | None = None  # ISO date — when do we expect to close?
    target_pnl_pct: float | None = None  # target profit % to take (e.g., 15.0 = +15%)
    # Sub-portfolio owner
    owner: str | None = None  # team member responsible for this spread

    @field_validator("asset_class")
    @classmethod
    def valid_asset_class(cls, v):
        allowed = {"equities", "bonds", "commodities", "fx"}
        if v.lower() not in allowed:
            raise ValueError(f"asset_class must be one of {allowed}")
        return v.lower()


class NoteCreate(BaseModel):
    text: str


class SpreadResponse(SpreadCreate):
    id: str
    status: str  # proposed, active, closed
    created_by: str
    created_at: datetime
    entry_prices: dict[str, float]
    current_prices: dict[str, float] | None = None
    pnl_pct: float | None = None
    notes: list[dict] = []
