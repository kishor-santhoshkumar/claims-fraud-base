"""Pydantic response models for GET /providers/{provider_id}/shap.

See src/api/shap_explain.py for how these are computed.
"""

from typing import Optional

from pydantic import BaseModel


class ShapFeature(BaseModel):
    feature: str
    display_name: str
    value: float
    value_formatted: str
    shap_value: float
    direction: str  # "increases_risk" | "decreases_risk"
    percentile: Optional[float] = None


class ShapResponse(BaseModel):
    provider_id: str
    base_value: float
    fraud_probability: float
    top_features: list[ShapFeature]
