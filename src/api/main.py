"""FastAPI service exposing the Claims Fraud Risk Detector cascade model.

Loads the trained artifact from outputs/model/cascade_model.joblib
(produced by src/train_final_model.py) and serves predictions over HTTP.
Does not touch notebooks/ or retrain anything at request time.

Run:
    uvicorn src.api.main:app --host 0.0.0.0 --port 8000

Docs:
    http://localhost:8000/docs   (Swagger UI)
    http://localhost:8000/redoc  (ReDoc)
"""

from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from src.api.auth import router as auth_router
from src.api.claims import load_claims_table, router as claims_router, set_claims_table
from src.api.evidence import router as evidence_router
from src.api.decisions import router as decisions_router
from src.api.shap_explain import build_shap_state, router as shap_router, set_shap_state
from src.api.analytics import router as analytics_router
from src.rules.engine import build_engine, set_engine
from src.api.schemas import (
    BatchPredictRequest,
    BatchPredictResponse,
    ModelInfo,
    PredictionResult,
    SingleProviderRequest,
)

ROOT = Path(__file__).resolve().parent.parent.parent
MODEL_PATH = ROOT / "outputs" / "model" / "cascade_model.joblib"

DEFAULT_DECISION_THRESHOLD = 0.5

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"Model artifact not found at {MODEL_PATH}. Run "
            "`python src/train_final_model.py` first."
        )
    artifact = joblib.load(MODEL_PATH)
    _state["artifact"] = artifact
    print(f"Loaded model artifact from {MODEL_PATH} "
          f"({artifact['trained_rows']} providers, {len(artifact['feature_cols'])} features)")

    # SHAP explainer for /providers/{id}/shap -- read-only explanation of
    # the already-trained xgb_ranker, built once against the same cached
    # feature matrix it was trained from (outputs/features_train.parquet).
    # Does not retrain or alter the model in any way. Optional-data
    # posture, same as claims/rules below: degrades to 503, not a startup
    # failure, if the parquet is ever missing.
    try:
        provider_df = pd.read_parquet(ROOT / "outputs" / "features_train.parquet")
        shap_state = build_shap_state(artifact, provider_df)
        set_shap_state(shap_state)
        print(f"SHAP explainer ready ({len(provider_df):,} providers in reference distribution)")
    except FileNotFoundError as e:
        print(f"Feature matrix not found ({e}); GET /providers/{{provider_id}}/shap will return 503.")

    # Raw claims (data/Train_*.csv) are optional -- gitignored, not every
    # clone of this repo will have them. If absent, /predict* still works;
    # only GET /providers/{id}/claims degrades (503) instead of the whole
    # app failing to start.
    try:
        claims_df = load_claims_table()
        set_claims_table(claims_df)
        print(f"Loaded {len(claims_df):,} raw claims "
              f"({(claims_df['claim_type'] == 'inpatient').sum():,} inpatient, "
              f"{(claims_df['claim_type'] == 'outpatient').sum():,} outpatient)")

        # Rule engine (src/rules/) depends on claims_df being loaded -- same
        # optional-data posture as claims: if this fails, /evidence and the
        # rule_flags on /claims degrade to empty/503 rather than crashing
        # the app.
        engine = build_engine(claims_df)
        set_engine(engine)
        print(f"Rule engine ready: {len(engine.enabled_rules)} enabled, "
              f"{len(engine.disabled_rules)} disabled")
        for rule, reason in engine.disabled_rules:
            print(f"  disabled: {rule.rule_id} ({reason})")
        dup_rate = engine.rule_fire_rate("DUPLICATE_CLAIM")
        if dup_rate is not None:
            print(f"  DUPLICATE_CLAIM fires on {dup_rate:.1%} of providers")
    except FileNotFoundError as e:
        print(f"Raw claims data not found ({e}); "
              "GET /providers/{provider_id}/claims will return 503 until data/ is populated, "
              "and the rule engine will not be built.")

    yield
    _state.clear()


app = FastAPI(
    title="Claims Fraud Risk Detector API",
    description=(
        "Serves the two-stage cascade model (RandomForest gate → XGBoost ranker) "
        "trained for provider-level healthcare claims fraud detection. "
        "Input is a provider's 31 pre-aggregated engineered features "
        "(see README.md → Feature Engineering)."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: hackathon-scope wildcard so the frontend dev server (any port/origin)
# can call this API during development. No cookies are used (Bearer tokens
# are sent via the Authorization header), so allow_credentials=False is
# compatible with allow_origins=["*"]. Tighten this before any real
# deployment (e.g. restrict to the actual frontend origin(s)).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth is a separate concern from the ML pipeline below -- see src/api/auth.py.
# Not applied to /predict, /predict/batch, /health, or /model/info (unprotected
# by design, per spec). To protect a route later, add
# `current_user: dict = Depends(get_current_user)` (from src.api.auth) as a
# parameter -- it 401s automatically on a missing/invalid/expired token.
app.include_router(auth_router)

# Claim-level lookup -- src/api/claims.py. Straight filter/pagination over
# the raw Kaggle claim tables, no ML involved. Independent of the cascade
# model artifact; degrades to 503 (not a startup failure) if data/ is absent.
app.include_router(claims_router)

# Rule engine evidence -- src/api/evidence.py / src/rules/. Also no ML.
app.include_router(evidence_router)

# Investigator decisions -- src/api/decisions.py. In-memory store, POST
# requires auth (reuses get_current_user from src/api/auth.py). No coupling
# to claims, evidence, or the ML pipeline.
app.include_router(decisions_router)

# SHAP feature attribution -- src/api/shap_explain.py. Explains the
# existing xgb_ranker's predictions; never retrains or modifies it.
app.include_router(shap_router)

# Batch-level analytics aggregates -- src/api/analytics.py. Pure
# aggregation over the rule engine's and SHAP module's existing
# per-provider (cached) computations; no new rule or ML logic.
app.include_router(analytics_router)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/docs")


@app.get("/health", tags=["Meta"])
def health():
    loaded = "artifact" in _state
    return {
        "status": "ok" if loaded else "unavailable",
        "model_loaded": loaded,
    }


@app.get("/model/info", response_model=ModelInfo, tags=["Meta"])
def model_info():
    artifact = _get_artifact()
    cv = artifact["gate_eval_cv"]
    full = artifact["gate_eval_full"]
    return ModelInfo(
        architecture="RandomForest gate (stage 1) -> XGBoost ranker (stage 2)",
        feature_count=len(artifact["feature_cols"]),
        feature_cols=artifact["feature_cols"],
        gate_threshold=artifact["gate_threshold"],
        gate_target_recall=artifact["gate_target_recall"],
        actual_gate_recall=cv["recall"],
        providers_passed=full["providers_passed"],
        pass_rate=full["pass_rate"],
        rf_gate_params=artifact["rf_gate_params"],
        gate_eval_full=full,
        gate_eval_cv=cv,
        trained_rows=artifact["trained_rows"],
        positive_rate=artifact["positive_rate"],
        notes=(
            "This artifact was fit on the full cached provider feature matrix "
            "(outputs/features_train.parquet), not the raw Kaggle CSVs. "
            f"The Stage-1 RandomForest gate uses class_weight='balanced_subsample' "
            f"(recomputed per-tree from each bootstrap draw) and min_samples_leaf=10, "
            f"which fixed an earlier configuration (class_weight='balanced' with "
            f"unconstrained leaves) that collapsed to gate_threshold=0.0 and passed "
            f"~100% of providers through as a no-op. The gate now filters "
            f"{full['providers_filtered']:,}/{full['total_providers']:,} providers "
            f"({1 - full['pass_rate']:.1%}) on the full-data fit, and honest 5-fold "
            f"out-of-fold validation shows {cv['recall']:.1%} actual recall against "
            f"the {artifact['gate_target_recall']:.0%} target, with a {cv['pass_rate']:.1%} "
            f"out-of-fold pass rate."
        ),
    )


@app.post("/predict", response_model=PredictionResult, tags=["Inference"])
def predict(request: SingleProviderRequest, decision_threshold: float = DEFAULT_DECISION_THRESHOLD):
    """Score a single provider from its pre-aggregated feature vector.

    `provider_id` is optional and purely pass-through (echoed on the
    response for routing) -- it is excluded before the feature vector is
    built, so it cannot influence the RF gate or XGBoost scoring.
    """
    artifact = _get_artifact()
    row = pd.DataFrame([request.model_dump(exclude={"provider_id"})])[artifact["feature_cols"]]

    gate_score = float(artifact["rf_gate"].predict_proba(row)[:, 1][0])
    gate_passed = gate_score >= artifact["gate_threshold"]

    if gate_passed:
        fraud_probability = float(artifact["xgb_ranker"].predict_proba(row)[:, 1][0])
    else:
        fraud_probability = 0.0

    return PredictionResult(
        provider_id=request.provider_id,
        fraud_probability=fraud_probability,
        gate_passed=gate_passed,
        gate_score=gate_score,
        gate_threshold=artifact["gate_threshold"],
        flagged=fraud_probability >= decision_threshold,
        decision_threshold=decision_threshold,
    )


@app.post("/predict/batch", response_model=BatchPredictResponse, tags=["Inference"])
def predict_batch(request: BatchPredictRequest, decision_threshold: float = DEFAULT_DECISION_THRESHOLD):
    """Score multiple providers in one call.

    Each entry carries a required `provider_id`, echoed back on its
    matching result (same order as the request) so the frontend can route
    a queue row to its case-detail page. provider_id is pass-through only
    -- it plays no part in the RF gate or XGBoost feature vector.
    """
    if not request.providers:
        raise HTTPException(status_code=400, detail="Empty batch")
    artifact = _get_artifact()
    provider_ids = [item.provider_id for item in request.providers]
    df = pd.DataFrame([item.features.model_dump() for item in request.providers])[artifact["feature_cols"]]

    gate_scores = artifact["rf_gate"].predict_proba(df)[:, 1]
    gate_mask = gate_scores >= artifact["gate_threshold"]

    fraud_proba = pd.Series(0.0, index=df.index)
    if gate_mask.any():
        fraud_proba.loc[gate_mask] = artifact["xgb_ranker"].predict_proba(df[gate_mask])[:, 1]

    results = [
        PredictionResult(
            provider_id=provider_ids[i],
            fraud_probability=float(fraud_proba.iloc[i]),
            gate_passed=bool(gate_mask[i]),
            gate_score=float(gate_scores[i]),
            gate_threshold=artifact["gate_threshold"],
            flagged=float(fraud_proba.iloc[i]) >= decision_threshold,
            decision_threshold=decision_threshold,
        )
        for i in range(len(request.providers))
    ]
    return BatchPredictResponse(results=results)


def _get_artifact():
    artifact = _state.get("artifact")
    if artifact is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return artifact
