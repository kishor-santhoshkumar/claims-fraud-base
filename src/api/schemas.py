"""Pydantic request/response models for the Claims Fraud Risk Detector API.

Input schema mirrors the 31 provider-level engineered features documented
in README.md → Feature Engineering. The API scores providers from their
already-aggregated feature vector (the same shape as a row of
outputs/features_train.parquet minus Provider/fraud_label) -- it does not
re-run the raw-claims ETL (src/loaders.py + src/features.py) itself.
"""

from typing import Optional

from pydantic import BaseModel, Field


class ProviderFeatures(BaseModel):
    # --- Volume ---
    n_claims: float = Field(..., description="Total claims filed by the provider")
    n_unique_bene: float = Field(..., description="Distinct beneficiaries served")
    n_inpatient_claims: float = Field(..., description="Inpatient claim count")
    n_outpatient_claims: float = Field(..., description="Outpatient claim count")
    ip_op_ratio: float = Field(..., description="Inpatient-to-outpatient claim ratio")
    claims_per_bene: float = Field(..., description="Claims per unique beneficiary")

    # --- Physician ---
    n_unique_attending: float = Field(..., description="Distinct attending physicians")
    n_unique_operating: float = Field(..., description="Distinct operating physicians")
    n_unique_other: float = Field(..., description="Distinct 'other' physicians")
    claims_per_physician: float = Field(..., description="Claims per distinct physician")

    # --- Money ---
    total_reimbursed: float = Field(..., description="Sum of reimbursed amounts")
    mean_reimbursed: float = Field(..., description="Mean reimbursed amount per claim")
    max_reimbursed: float = Field(..., description="Max reimbursed amount on a single claim")
    std_reimbursed: float = Field(..., description="Std dev of reimbursed amounts")
    total_deductible: float = Field(..., description="Sum of deductible amounts")
    mean_deductible: float = Field(..., description="Mean deductible amount per claim")

    # --- Duration ---
    mean_claim_duration: float = Field(..., description="Mean claim duration in days")
    max_claim_duration: float = Field(..., description="Max claim duration in days")
    mean_admission_length: float = Field(..., description="Mean inpatient admission length")
    max_admission_length: float = Field(..., description="Max inpatient admission length")

    # --- Coding ---
    mean_n_diag: float = Field(..., description="Mean number of diagnosis codes per claim")
    mean_n_proc: float = Field(..., description="Mean number of procedure codes per claim")
    n_unique_primary_diag: float = Field(..., description="Distinct primary diagnosis codes used")
    primary_diag_entropy: float = Field(..., description="Shannon entropy of primary diagnosis codes")

    # --- Patient mix ---
    mean_chronic_count: float = Field(..., description="Mean chronic condition count across patients")
    mean_age_at_claim: float = Field(..., description="Mean patient age at time of claim")
    deceased_rate: float = Field(..., description="Fraction of claims tied to deceased patients")

    # --- Geography ---
    n_distinct_states: float = Field(..., description="Distinct patient states")
    n_distinct_counties: float = Field(..., description="Distinct patient counties")

    # --- Cross-entity ring signals ---
    mean_phy_n_providers: float = Field(
        ..., description="Mean # distinct providers an attending physician bills across"
    )
    mean_bene_n_providers: float = Field(
        ..., description="Mean # distinct providers a beneficiary appears at"
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "n_claims": 120, "n_unique_bene": 85, "n_inpatient_claims": 15,
                "n_outpatient_claims": 105, "ip_op_ratio": 0.14, "claims_per_bene": 1.41,
                "n_unique_attending": 6, "n_unique_operating": 2, "n_unique_other": 3,
                "claims_per_physician": 20.0, "total_reimbursed": 185000.0,
                "mean_reimbursed": 1541.7, "max_reimbursed": 22000.0, "std_reimbursed": 2100.5,
                "total_deductible": 9600.0, "mean_deductible": 80.0,
                "mean_claim_duration": 2.3, "max_claim_duration": 14,
                "mean_admission_length": 4.1, "max_admission_length": 20,
                "mean_n_diag": 5.2, "mean_n_proc": 1.8, "n_unique_primary_diag": 34,
                "primary_diag_entropy": 3.9, "mean_chronic_count": 4.6,
                "mean_age_at_claim": 71.4, "deceased_rate": 0.02,
                "n_distinct_states": 2, "n_distinct_counties": 5,
                "mean_phy_n_providers": 1.3, "mean_bene_n_providers": 1.6,
            }
        }
    }


class SingleProviderRequest(ProviderFeatures):
    """Request body for POST /predict. Identical to ProviderFeatures (so
    existing callers posting a flat 31-feature JSON body keep working
    unchanged) with one added optional field: provider_id.
    """

    provider_id: Optional[str] = Field(
        default=None,
        description=(
            "Optional stable provider identifier, echoed back on the response "
            "for frontend routing. Corresponds to the `Provider` column in "
            "outputs/features_train.parquet (e.g. 'PRV51001'). Not required — "
            "omit it and existing callers are unaffected."
        ),
    )


class BatchProviderItem(BaseModel):
    """One entry in a POST /predict/batch request."""

    provider_id: str = Field(
        ...,
        description=(
            "Stable unique provider identifier, echoed back in the response so "
            "the frontend can route to a case-detail page per row. Corresponds "
            "to the `Provider` column in outputs/features_train.parquet "
            "(e.g. 'PRV51001')."
        ),
    )
    features: ProviderFeatures


class BatchPredictRequest(BaseModel):
    providers: list[BatchProviderItem]

    model_config = {
        "json_schema_extra": {
            "example": {
                "providers": [
                    {"provider_id": "PRV51001", "features": ProviderFeatures.model_config["json_schema_extra"]["example"]},
                ]
            }
        }
    }


class PredictionResult(BaseModel):
    provider_id: Optional[str] = Field(
        default=None,
        description="Echoes the request's provider_id, if one was supplied. None for callers that omitted it.",
    )
    fraud_probability: float = Field(..., description="Final risk score in [0, 1]")
    gate_passed: bool = Field(..., description="Whether the RandomForest gate passed this provider to the XGBoost ranker")
    gate_score: float = Field(..., description="RandomForest gate's fraud probability estimate")
    gate_threshold: float = Field(..., description="Threshold gate_score was compared against")
    flagged: bool = Field(..., description="fraud_probability >= decision_threshold")
    decision_threshold: float = Field(..., description="Threshold used to compute `flagged`")


class BatchPredictResponse(BaseModel):
    results: list[PredictionResult]


class GateEvalMetrics(BaseModel):
    total_providers: int
    positive_providers: int
    providers_passed: int
    providers_filtered: int
    pass_rate: float
    positives_retained: int
    positives_lost: int
    recall: float
    precision: float
    f1: float


class ModelInfo(BaseModel):
    architecture: str
    feature_count: int
    feature_cols: list[str]
    gate_threshold: float
    gate_target_recall: float
    actual_gate_recall: float = Field(..., description="Honest out-of-fold gate recall (5-fold CV)")
    providers_passed: int = Field(..., description="Providers passing the gate in the full-data deployment fit")
    pass_rate: float = Field(..., description="Gate pass rate in the full-data deployment fit")
    rf_gate_params: dict = Field(..., description="Hyperparameters used for the Stage-1 RandomForest gate")
    gate_eval_full: GateEvalMetrics = Field(..., description="Gate metrics on the full training set (self-consistency check)")
    gate_eval_cv: GateEvalMetrics = Field(..., description="Gate metrics from honest 5-fold out-of-fold validation")
    trained_rows: int
    positive_rate: float
    notes: str
