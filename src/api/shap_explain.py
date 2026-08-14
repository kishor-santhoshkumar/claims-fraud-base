"""GET /providers/{provider_id}/shap -- SHAP feature attribution for the
already-trained XGBoost ranker (outputs/model/cascade_model.joblib).

Explains WHY the model scored a provider the way it did. Does not
retrain, fine-tune, or otherwise modify the model -- read-only
explanation of an existing prediction. Fully independent of the rule
engine (src/rules/): rules answer "did a specific pattern occur", SHAP
answers "which of the 31 model features pushed this score up or down,
and by how much."

--- Units: base_value and shap_value are in log-odds (margin) space ---

shap.TreeExplainer is run with model_output="raw", feature_perturbation=
"tree_path_dependent" -- the fast, exact-for-trees mode that needs no
background dataset. Verified against this project's real model: for any
row, base_value + sum(shap_values) reproduces the model's raw margin
output exactly, and sigmoid(that) reproduces xgb_ranker.predict_proba()
to 6+ decimal places (spot-checked on PRV52114: 0.9994161 both ways).

The probability-space alternative (model_output="probability",
feature_perturbation="interventional") was tried first and rejected --
not a style preference, a real library limitation: it raises
NotImplementedError against this XGBoost model's tree structure
("Categorical split is not yet supported. You can still use
TreeExplainer with feature_perturbation='tree_path_dependent'.").

Practical effect for the frontend: shap_value's SIGN (direction) and
RELATIVE magnitude (bar length, normalized against the row's own max
|shap_value|) are both preserved correctly regardless of which space
you compute in -- and that's all the UI uses. Nothing downstream is
affected by working in log-odds units instead of probability points.

Precomputed once at startup, same pattern as claims/rules:
  - one TreeExplainer bound to the trained xgb_ranker
  - per-feature sorted value arrays, for O(log n) percentile lookups
Each provider's full response is cached after first computation.

compute_full_shap() below is the shared, single source of the actual
explainer.shap_values() call -- src/api/analytics.py's batch endpoints
(GET /analytics/shap-importance) reuse it directly rather than
duplicating SHAP logic, so a given provider's expensive tree-walk only
ever runs once regardless of which endpoint asks for it first.
"""

from __future__ import annotations

import bisect

import numpy as np
import pandas as pd
import shap
from fastapi import APIRouter, HTTPException

from src.api.shap_schemas import ShapFeature, ShapResponse

TOP_N_FEATURES = 8

# Plain-English label for every one of the 31 features (see README.md ->
# Feature Engineering for the grouping these are drawn from).
DISPLAY_NAMES = {
    "n_claims": "Total claims filed",
    "n_unique_bene": "Unique beneficiaries",
    "n_inpatient_claims": "Inpatient claims",
    "n_outpatient_claims": "Outpatient claims",
    "ip_op_ratio": "Inpatient-to-outpatient ratio",
    "claims_per_bene": "Claims per beneficiary",
    "n_unique_attending": "Unique attending physicians",
    "n_unique_operating": "Unique operating physicians",
    "n_unique_other": "Unique other physicians",
    "claims_per_physician": "Claims per physician",
    "total_reimbursed": "Total reimbursement",
    "mean_reimbursed": "Average reimbursement per claim",
    "max_reimbursed": "Highest single-claim reimbursement",
    "std_reimbursed": "Reimbursement variability",
    "total_deductible": "Total deductible billed",
    "mean_deductible": "Average deductible per claim",
    "mean_claim_duration": "Average claim duration (days)",
    "max_claim_duration": "Longest claim duration (days)",
    "mean_admission_length": "Average hospital stay length (days)",
    "max_admission_length": "Longest hospital stay (days)",
    "mean_n_diag": "Average diagnosis codes per claim",
    "mean_n_proc": "Average procedure codes per claim",
    "n_unique_primary_diag": "Distinct primary diagnoses billed",
    "primary_diag_entropy": "Diagnosis code diversity",
    "mean_chronic_count": "Average chronic conditions per patient",
    "mean_age_at_claim": "Average patient age",
    "deceased_rate": "Share of claims for deceased patients",
    "n_distinct_states": "States billed across",
    "n_distinct_counties": "Counties billed across",
    "mean_phy_n_providers": "Physicians' provider overlap",
    "mean_bene_n_providers": "Beneficiaries' provider overlap",
}

_CURRENCY_FIELDS = {
    "total_reimbursed",
    "mean_reimbursed",
    "max_reimbursed",
    "std_reimbursed",
    "total_deductible",
    "mean_deductible",
}

_INTEGER_FIELDS = {
    "n_claims",
    "n_unique_bene",
    "n_inpatient_claims",
    "n_outpatient_claims",
    "n_unique_attending",
    "n_unique_operating",
    "n_unique_other",
    "n_unique_primary_diag",
    "n_distinct_states",
    "n_distinct_counties",
}


def _format_value(feature: str, value: float) -> str:
    if feature in _CURRENCY_FIELDS:
        return f"${value:,.0f}"
    if feature in _INTEGER_FIELDS:
        return f"{value:,.0f}"
    text = f"{value:,.2f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


router = APIRouter(prefix="/providers", tags=["Model Signals"])

_state: dict = {}


def build_shap_state(artifact: dict, provider_df: pd.DataFrame) -> dict:
    """Called once at startup (see main.py's lifespan). `artifact` is the
    same joblib-loaded cascade model dict already used by /predict;
    `provider_df` is outputs/features_train.parquet, the same table the
    model was trained from -- used here purely as a lookup table for a
    provider's 31 feature values and as the reference distribution for
    percentile ranks, never to retrain anything.
    """
    feature_cols = artifact["feature_cols"]
    explainer = shap.TreeExplainer(
        artifact["xgb_ranker"],
        model_output="raw",
        feature_perturbation="tree_path_dependent",
    )
    filled = provider_df[feature_cols].fillna(0)
    sorted_values = {col: np.sort(filled[col].values) for col in feature_cols}

    indexed = provider_df.copy()
    indexed[feature_cols] = filled
    indexed = indexed.set_index("Provider")

    return {
        "explainer": explainer,
        "feature_cols": feature_cols,
        "provider_df": indexed,
        "sorted_values": sorted_values,
        "cache": {},
        "full_cache": {},
    }


def set_shap_state(state: dict) -> None:
    _state.clear()
    _state.update(state)


def is_loaded() -> bool:
    return "explainer" in _state


def get_feature_cols() -> list[str]:
    return _state["feature_cols"]


def _percentile(feature: str, value: float) -> float:
    arr = _state["sorted_values"][feature]
    idx = bisect.bisect_left(arr, value)
    return round(100 * idx / len(arr), 1)


def compute_full_shap(provider_id: str) -> dict | None:
    """All 31 features' SHAP values for one provider (not truncated to the
    top N). Cached separately from the public endpoint's response cache
    below, since this is the shared computation both /shap and
    /analytics/shap-importance build on. Returns None if the provider has
    no feature row (caller decides how to handle that)."""
    cached = _state["full_cache"].get(provider_id)
    if cached is not None:
        return cached

    provider_df = _state["provider_df"]
    if provider_id not in provider_df.index:
        return None

    feature_cols = _state["feature_cols"]
    row = provider_df.loc[[provider_id], feature_cols]

    explainer = _state["explainer"]
    row_shap_values = explainer.shap_values(row)[0]
    base_value = float(explainer.expected_value)
    margin = base_value + float(row_shap_values.sum())

    result = {
        "row": row,
        "shap_values": row_shap_values,  # np.ndarray, shape (31,), aligned to feature_cols order
        "base_value": base_value,
        "margin": margin,
    }
    _state["full_cache"][provider_id] = result
    return result


@router.get("/{provider_id}/shap", response_model=ShapResponse)
def get_provider_shap(provider_id: str):
    if not is_loaded():
        raise HTTPException(status_code=503, detail="SHAP explainer not loaded")

    cached = _state["cache"].get(provider_id)
    if cached is not None:
        return cached

    full = compute_full_shap(provider_id)
    if full is None:
        raise HTTPException(
            status_code=404,
            detail=f"No feature data found for provider_id '{provider_id}'",
        )

    feature_cols = _state["feature_cols"]
    row = full["row"]
    row_shap_values = full["shap_values"]
    fraud_probability = float(1.0 / (1.0 + np.exp(-full["margin"])))

    order = np.argsort(-np.abs(row_shap_values))[:TOP_N_FEATURES]
    top_features = []
    for i in order:
        feature = feature_cols[i]
        value = float(row.iloc[0][feature])
        sv = float(row_shap_values[i])
        top_features.append(
            ShapFeature(
                feature=feature,
                display_name=DISPLAY_NAMES.get(feature, feature),
                value=value,
                value_formatted=_format_value(feature, value),
                shap_value=sv,
                direction="increases_risk" if sv > 0 else "decreases_risk",
                percentile=_percentile(feature, value),
            )
        )

    response = ShapResponse(
        provider_id=provider_id,
        base_value=full["base_value"],
        fraud_probability=fraud_probability,
        top_features=top_features,
    )
    _state["cache"][provider_id] = response
    return response
