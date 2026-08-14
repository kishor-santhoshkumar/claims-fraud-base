"""Pydantic response models for investigator decision endpoints.

`decision` on the request is validated MANUALLY in decisions.py (plain
str field here, not a Pydantic Literal) so an invalid value returns 400
with a clear message, per spec -- not FastAPI's default 422 for schema
validation failures.
"""

from typing import Optional

from pydantic import BaseModel

ALLOWED_DECISIONS = ("confirmed", "cleared", "escalated")


class DecisionRequest(BaseModel):
    decision: str
    notes: Optional[str] = None


class DecisionRecord(BaseModel):
    provider_id: str
    decision: str
    decided_by: str
    decided_at: str
    notes: Optional[str] = None


class DecisionSummary(BaseModel):
    provider_id: str
    decision: str
    decided_at: str
