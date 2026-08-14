"""Pydantic response models for GET /providers/{provider_id}/evidence.

See src/rules/engine.py for how these are computed.
"""

from typing import Optional

from pydantic import BaseModel, Field


class RuleEvidence(BaseModel):
    type: str = Field("rule", description="Evidence kind; always 'rule' for this engine")
    rule_id: str
    category: str = Field(..., description="'fraud' | 'waste' | 'abuse'")
    severity: str = Field(..., description="'high' | 'medium' | 'low'")
    citation: Optional[str] = Field(
        None, description="Null if the ruleset's citation is still a TODO placeholder"
    )
    summary: str
    matching_claim_ids: list[str]


class ProviderEvidenceResponse(BaseModel):
    provider_id: str
    rules_evaluated: int
    rules_fired: int
    findings: list[RuleEvidence]
