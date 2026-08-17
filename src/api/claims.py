"""GET /providers/{provider_id}/claims -- individual claim rows for one provider.

Straight lookup/filter over the raw Kaggle inpatient + outpatient claim
tables (src/loaders.py), tagged with claim_type and paginated. No ML, no
scoring, no dependency on the cascade model artifact.

The raw claims table is loaded once, at app startup (main.py's lifespan
calls load_claims_table() and hands it to set_claims_table()), and kept in
memory here -- mirrors how src/api/auth.py owns its own module-level state.
"""

import math

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from src.loaders import load_all
from src.api.claims_schemas import ClaimRecord, ProviderClaimsResponse, RuleFlag
from src.rules.engine import get_engine

DEFAULT_LIMIT = 50
MAX_LIMIT = 500

_DIAG_COLS = [f"ClmDiagnosisCode_{i}" for i in range(1, 11)]
_PROC_COLS = [f"ClmProcedureCode_{i}" for i in range(1, 7)]

_state: dict = {}


def load_claims_table() -> pd.DataFrame:
    """Load + concat raw inpatient/outpatient claims once, tagged with
    claim_type. Outpatient claims have no admission/discharge dates in the
    source data, so those columns are added as null for that half.

    Also merges in DOB/DOD from the beneficiary table (by BeneID) -- these
    two extra columns exist purely for the rule engine (src/rules/), which
    needs them for POST_DEATH_SERVICE / SERVICE_BEFORE_BIRTH. They are not
    referenced by _row_to_claim(), so the existing /claims response shape
    is completely unaffected by this addition.
    """
    data = load_all()
    ip, op = data["ip"].copy(), data["op"].copy()
    ip["claim_type"] = "inpatient"
    op["claim_type"] = "outpatient"
    op["AdmissionDt"] = pd.NaT
    op["DischargeDt"] = pd.NaT

    combined = pd.concat([ip, op], ignore_index=True, sort=False)
    combined = combined.merge(data["bene"][["BeneID", "DOB", "DOD", "State"]], on="BeneID", how="left")
    combined = combined.sort_values("ClaimStartDt", kind="stable").reset_index(drop=True)
    return combined


def set_claims_table(df: pd.DataFrame) -> None:
    _state["claims_df"] = df


def get_claims_df() -> pd.DataFrame | None:
    return _state.get("claims_df")


def _iso(value) -> str | None:
    if pd.isna(value):
        return None
    return value.strftime("%Y-%m-%d")


def _row_to_claim(row, rule_flags_map: dict[str, list[dict]] | None = None) -> ClaimRecord:
    diagnosis_codes = [str(row[c]) for c in _DIAG_COLS if pd.notna(row.get(c))]
    procedure_codes = [str(row[c]) for c in _PROC_COLS if pd.notna(row.get(c))]
    deductible = row.get("DeductibleAmtPaid")
    attending = row.get("AttendingPhysician")
    claim_id = row["ClaimID"]
    flags = (rule_flags_map or {}).get(claim_id, [])

    return ClaimRecord(
        claim_id=claim_id,
        bene_id=row["BeneID"],
        claim_start_dt=_iso(row["ClaimStartDt"]),
        claim_end_dt=_iso(row["ClaimEndDt"]),
        claim_type=row["claim_type"],
        amount_reimbursed=float(row["InscClaimAmtReimbursed"]),
        deductible_paid=float(deductible) if pd.notna(deductible) else None,
        attending_physician=attending if pd.notna(attending) else None,
        diagnosis_codes=diagnosis_codes,
        procedure_codes=procedure_codes,
        admission_dt=_iso(row["AdmissionDt"]),
        discharge_dt=_iso(row["DischargeDt"]),
        rule_flags=[RuleFlag(**f) for f in flags],
    )


router = APIRouter(prefix="/providers", tags=["Claims"])


@router.get("/{provider_id}/claims", response_model=ProviderClaimsResponse)
def get_provider_claims(
    provider_id: str,
    page: int = Query(1, ge=1, description="1-indexed page number"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT, description="Claims per page"),
):
    """Individual claims for one provider, sorted by claim_start_dt
    ascending. Median provider has ~31 claims; the heaviest has 8,240 --
    paginate rather than assume a small result set.
    """
    claims_df = _state.get("claims_df")
    if claims_df is None:
        raise HTTPException(status_code=503, detail="Claims data not loaded")

    provider_claims = claims_df[claims_df["Provider"] == provider_id]
    total_claims = len(provider_claims)
    if total_claims == 0:
        raise HTTPException(
            status_code=404,
            detail=f"No claims found for provider_id '{provider_id}'",
        )

    total_pages = math.ceil(total_claims / limit)
    start = (page - 1) * limit
    page_rows = provider_claims.iloc[start : start + limit]

    # Real rule_flags, if the rule engine is loaded (see src/rules/engine.py).
    # Cached per provider_id there, so this doesn't re-run rule checks on
    # every paginated request -- degrades to [] on every claim (not an
    # error) if the engine failed to load for some reason.
    engine = get_engine()
    rule_flags_map = engine.rule_flags_for_claims(provider_id) if engine else {}

    return ProviderClaimsResponse(
        provider_id=provider_id,
        total_claims=total_claims,
        page=page,
        limit=limit,
        total_pages=total_pages,
        claims=[_row_to_claim(row, rule_flags_map) for _, row in page_rows.iterrows()],
    )
