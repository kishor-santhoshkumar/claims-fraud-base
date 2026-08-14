"""Pydantic response models for GET /providers/{provider_id}/claims.

Straight lookup/filter over the raw Kaggle inpatient + outpatient claim
tables -- no ML, no scoring. See src/api/claims.py.
"""

from typing import Optional

from pydantic import BaseModel, Field


class RuleFlag(BaseModel):
    rule_id: str
    severity: str = Field(..., description="'high' | 'medium' | 'low'")


class ClaimRecord(BaseModel):
    claim_id: str
    bene_id: str
    claim_start_dt: Optional[str] = Field(None, description="YYYY-MM-DD")
    claim_end_dt: Optional[str] = Field(None, description="YYYY-MM-DD")
    claim_type: str = Field(..., description="'inpatient' or 'outpatient'")
    amount_reimbursed: float
    deductible_paid: Optional[float] = None
    attending_physician: Optional[str] = None
    diagnosis_codes: list[str] = Field(default_factory=list)
    procedure_codes: list[str] = Field(default_factory=list)
    admission_dt: Optional[str] = Field(None, description="Inpatient only; null for outpatient claims")
    discharge_dt: Optional[str] = Field(None, description="Inpatient only; null for outpatient claims")
    rule_flags: list[RuleFlag] = Field(
        default_factory=list,
        description=(
            "Populated from the rule engine (see src/rules/) once GET "
            "/providers/{id}/evidence has evaluated this provider. Empty for "
            "claims that don't match any fired rule -- never fabricated."
        ),
    )


class ProviderClaimsResponse(BaseModel):
    provider_id: str
    total_claims: int
    page: int
    limit: int
    total_pages: int
    claims: list[ClaimRecord]
