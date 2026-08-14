"""Investigator decisions: Confirm fraud / Clear provider / Escalate for
review.

In-memory store, keyed by provider_id -- latest decision wins, no audit
history yet (per spec). Storage lives entirely behind get_decision() /
set_decision() / get_all_decisions() below; swapping this to a real
database later only means reimplementing those three functions, nothing
above them.

Independent of the rule engine, claims data, and ML pipeline -- a
decision can be recorded for any provider_id the frontend has confidence
in, with no coupling to whether that provider has claims or evidence.
POST requires a valid auth token (reuses src/api/auth.py's
get_current_user); the two GET endpoints are open, same posture as
/predict and /predict/batch elsewhere in this API.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from src.api.auth import get_current_user
from src.api.decisions_schemas import (
    ALLOWED_DECISIONS,
    DecisionRecord,
    DecisionRequest,
    DecisionSummary,
)

router = APIRouter(tags=["Decisions"])

# -- storage (swap target for a real DB later; nothing outside this block
#    needs to change) -----------------------------------------------------

_store: dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def set_decision(provider_id: str, decision: str, decided_by: str, notes: str | None) -> dict:
    record = {
        "provider_id": provider_id,
        "decision": decision,
        "decided_by": decided_by,
        "decided_at": _now_iso(),
        "notes": notes,
    }
    _store[provider_id] = record  # overwrite -- an investigator can change their mind
    return record


def get_decision(provider_id: str) -> dict | None:
    return _store.get(provider_id)


def get_all_decisions() -> list[dict]:
    return list(_store.values())


# -- routes ----------------------------------------------------------------


@router.post("/providers/{provider_id}/decision", response_model=DecisionRecord)
def post_provider_decision(
    provider_id: str,
    body: DecisionRequest,
    current_user: dict = Depends(get_current_user),
):
    if body.decision not in ALLOWED_DECISIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid decision '{body.decision}'. "
                f"Must be one of: {', '.join(ALLOWED_DECISIONS)}"
            ),
        )
    record = set_decision(provider_id, body.decision, current_user["username"], body.notes)
    return DecisionRecord(**record)


@router.get("/providers/{provider_id}/decision", response_model=DecisionRecord)
def get_provider_decision(provider_id: str):
    """404 here means 'no decision yet' -- a normal, expected state for a
    freshly-scored provider, not an error. Callers should treat it as
    'undecided', not surface it as a failure."""
    record = get_decision(provider_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"No decision recorded yet for provider_id '{provider_id}'",
        )
    return DecisionRecord(**record)


@router.get("/decisions", response_model=list[DecisionSummary])
def list_decisions():
    """All recorded decisions in one call, so the frontend can badge an
    entire queue/dashboard without one request per provider."""
    return [DecisionSummary(**d) for d in get_all_decisions()]
