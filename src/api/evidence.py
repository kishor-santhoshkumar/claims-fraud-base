"""GET /providers/{provider_id}/evidence -- rule engine findings for one provider.

Runs (or reads cached results from) the rule engine over that provider's
full claim set -- see src/rules/engine.py. No ML involved; independent of
the cascade model artifact and independent of pagination on /claims.
"""

from fastapi import APIRouter, HTTPException

from src.api.evidence_schemas import ProviderEvidenceResponse
from src.rules.engine import get_engine

router = APIRouter(prefix="/providers", tags=["Evidence"])


@router.get("/{provider_id}/evidence", response_model=ProviderEvidenceResponse)
def get_provider_evidence(provider_id: str):
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="Rule engine not loaded")

    if not engine.provider_exists(provider_id):
        raise HTTPException(
            status_code=404,
            detail=f"No claims found for provider_id '{provider_id}'",
        )

    return ProviderEvidenceResponse(**engine.evidence_for_provider(provider_id))
