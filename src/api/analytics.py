"""Batch-level aggregate endpoints for the Analytics page.

GET /analytics/rule-fire-rates  -- reuses the rule engine's cached
    per-provider evidence (src/rules/engine.py); this module only counts
    and aggregates across providers, it does not evaluate any rule logic
    itself.

GET /analytics/shap-importance  -- reuses shap_explain.compute_full_shap
    (src/api/shap_explain.py), the same full-31-feature SHAP computation
    the single-provider /providers/{id}/shap endpoint uses. A provider
    visited on the Case file page is already cached here; a provider
    seen for the first time via this endpoint gets cached for later too.

Both take `provider_ids` as a comma-separated query param (same pattern
already used by the Claims detail page's rule-finding filter link, e.g.
?claimIds=CLM1,CLM2) rather than a request body, since the frontend
already holds the full batch's provider_ids client-side after a
/predict/batch run and a GET with the ID list is simplest to call from
there.

No new ML or rule logic lives here -- purely aggregation over existing,
already-cached computations.
"""

from __future__ import annotations

import numpy as np
from fastapi import APIRouter, HTTPException, Query

import pandas as pd
from src.api.claims import get_claims_df
from src.api.shap_explain import DISPLAY_NAMES, compute_full_shap, get_feature_cols, is_loaded
from src.rules.engine import get_engine

router = APIRouter(prefix="/analytics", tags=["Analytics"])

TOP_N_SHAP_FEATURES = 10


@router.get("/claims-by-month")
def get_claims_by_month():
    claims_df = get_claims_df()
    if claims_df is None or claims_df.empty:
        raise HTTPException(status_code=503, detail="Claims data not loaded")

    df = claims_df.dropna(subset=["ClaimStartDt"]).copy()
    df["month"] = df["ClaimStartDt"].dt.strftime("%Y-%m")
    df["month_label"] = df["ClaimStartDt"].dt.strftime("%b %Y")

    grouped = df.groupby(["month", "month_label"]).size().reset_index(name="claims")
    grouped = grouped.sort_values("month")

    return [
        {
            "month": row["month"],
            "month_label": row["month_label"],
            "claims": int(row["claims"]),
        }
        for _, row in grouped.iterrows()
    ]


@router.get("/providers-by-state")
def get_providers_by_state():
    claims_df = get_claims_df()
    if claims_df is None or claims_df.empty:
        raise HTTPException(status_code=503, detail="Claims data not loaded")

    if "State" not in claims_df.columns:
        return []

    # Get state for each provider
    prov_states = (
        claims_df.groupby("Provider")["State"]
        .agg(lambda x: x.mode()[0] if not x.mode().empty else (x.dropna().iloc[0] if not x.dropna().empty else "Unknown"))
        .reset_index()
    )

    counts = prov_states["State"].value_counts().reset_index()
    counts.columns = ["state", "providers"]
    counts = counts.sort_values("providers", ascending=False)

    return [
        {
            "state": f"State {row['state']}" if str(row["state"]).isdigit() else str(row["state"]),
            "providers": int(row["providers"]),
        }
        for _, row in counts.iterrows()
    ]


def _parse_provider_ids(provider_ids: str) -> list[str]:
    ids = [p.strip() for p in provider_ids.split(",") if p.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="provider_ids must contain at least one provider")
    return ids


def _format_rule_name(rule_id: str) -> str:
    """"DUPLICATE_CLAIM" -> "Duplicate claim" -- same convention as the
    frontend's formatRuleId() so names read identically everywhere."""
    words = rule_id.lower().split("_")
    return words[0].capitalize() + " " + " ".join(words[1:])


@router.get("/rule-fire-rates")
def get_rule_fire_rates(provider_ids: str = Query(..., description="Comma-separated provider IDs")):
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="Rule engine not loaded")

    ids = _parse_provider_ids(provider_ids)

    fired_counts = {rule.rule_id: 0 for rule in engine.enabled_rules}
    rule_meta = {rule.rule_id: rule for rule in engine.enabled_rules}
    provider_fired_counts = {}

    valid_count = 0
    for provider_id in ids:
        if not engine.provider_exists(provider_id):
            continue  # skip unknown IDs rather than fail the whole batch
        valid_count += 1
        evidence = engine.evidence_for_provider(provider_id)  # cached, not recomputed
        findings = evidence.get("findings", [])
        provider_fired_counts[provider_id] = len(findings)
        for finding in findings:
            fired_counts[finding["rule_id"]] += 1

    rules_out = [
        {
            "rule_id": rule_id,
            "name": _format_rule_name(rule_id),
            "severity": rule_meta[rule_id].severity,
            "providers_fired": count,
            "fire_rate": (count / valid_count) if valid_count else 0.0,
        }
        for rule_id, count in fired_counts.items()
    ]
    rules_out.sort(key=lambda r: r["fire_rate"], reverse=True)

    return {
        "total_providers": valid_count,
        "rules": rules_out,
        "provider_fired_counts": provider_fired_counts,
    }


@router.get("/shap-importance")
def get_shap_importance(provider_ids: str = Query(..., description="Comma-separated provider IDs")):
    if not is_loaded():
        raise HTTPException(status_code=503, detail="SHAP explainer not loaded")

    ids = _parse_provider_ids(provider_ids)
    feature_cols = get_feature_cols()
    abs_sum = np.zeros(len(feature_cols))
    valid_count = 0

    for provider_id in ids:
        full = compute_full_shap(provider_id)  # cached; reused from Case file visits where possible
        if full is None:
            continue
        abs_sum += np.abs(full["shap_values"])
        valid_count += 1

    if valid_count == 0:
        raise HTTPException(status_code=404, detail="None of the given provider_ids have feature data")

    avg_abs = abs_sum / valid_count
    order = np.argsort(-avg_abs)[:TOP_N_SHAP_FEATURES]

    features_out = [
        {
            "feature": feature_cols[i],
            "display_name": DISPLAY_NAMES.get(feature_cols[i], feature_cols[i]),
            "avg_abs_shap": float(avg_abs[i]),
        }
        for i in order
    ]

    return {"total_providers": valid_count, "features": features_out}
