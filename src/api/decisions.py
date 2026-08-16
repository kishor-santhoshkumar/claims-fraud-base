"""Investigator decisions: Confirm fraud / Clear provider / Escalate for
review.

SQLite-backed store (stdlib sqlite3, no new dependency), keyed by
provider_id -- latest decision wins, no audit history (per spec). Storage
lives entirely behind get_decision() / set_decision() / get_all_decisions()
below; the route handlers only call those three functions and never touch
sqlite directly, so this remains the swap target if storage changes again
later.

Decisions are a PERMANENT record tied to provider_id only. There is no
run/session concept: nothing in this module is ever cleared, reset, or
touched by POST /predict or POST /predict/batch (src/api/main.py) -- those
endpoints only ever compute and return risk scores. A decision made here
survives page reloads, backend restarts, and re-deployments, and stays
exactly as recorded no matter how many times the simulation is re-run.

Independent of the rule engine, claims data, and ML pipeline -- a
decision can be recorded for any provider_id the frontend has confidence
in, with no coupling to whether that provider has claims or evidence.
POST requires a valid auth token (reuses src/api/auth.py's
get_current_user); the two GET endpoints are open, same posture as
/predict and /predict/batch elsewhere in this API.
"""

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from src.api.auth import get_current_user
from src.api.decisions_schemas import (
    ALLOWED_DECISIONS,
    DecisionRecord,
    DecisionRequest,
    DecisionSummary,
)

router = APIRouter(tags=["Decisions"])

# -- storage (SQLite; swap target for a different DB later -- nothing
#    outside this block, including the route handlers below, needs to
#    change) -------------------------------------------------------------
#
# DB file: data/decisions.db under the project root by default. data/
# already exists there (it's where the raw claims CSVs live -- see
# src/api/claims.py) and is gitignored, same posture as this file: runtime
# data, not something checked into source control.
#
# Overridable with the DECISIONS_DB_PATH env var so a deployment target
# with a mounted persistent volume/disk can point this at the volume's
# mount path with zero code changes. NOTE: as of this change, this repo
# has no deployment config (no Dockerfile/Procfile/render.yaml/fly.toml)
# and no confirmed hosting target, so persistence in production has NOT
# been verified end-to-end -- see the deployment note delivered alongside
# this change. If/when a host is picked, set DECISIONS_DB_PATH to a path
# on that host's persistent volume if its default filesystem is ephemeral.
ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = Path(os.environ.get("DECISIONS_DB_PATH", ROOT / "data" / "decisions.db"))


@contextmanager
def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _init_db() -> None:
    """Create data/ and the decisions table if they don't exist yet.
    Runs once at import time (below), so this works on a fresh clone/deploy
    with no existing data/ directory and no manual setup step."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS decisions (
                provider_id TEXT PRIMARY KEY,
                decision    TEXT NOT NULL,
                decided_by  TEXT NOT NULL,
                decided_at  TEXT NOT NULL,
                notes       TEXT
            )
            """
        )


_init_db()


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
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO decisions (provider_id, decision, decided_by, decided_at, notes)
            VALUES (:provider_id, :decision, :decided_by, :decided_at, :notes)
            ON CONFLICT(provider_id) DO UPDATE SET
                decision   = excluded.decision,
                decided_by = excluded.decided_by,
                decided_at = excluded.decided_at,
                notes      = excluded.notes
            """,
            record,
        )  # overwrite -- an investigator can change their mind; latest wins
    return record


def get_decision(provider_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT provider_id, decision, decided_by, decided_at, notes "
            "FROM decisions WHERE provider_id = ?",
            (provider_id,),
        ).fetchone()
    return dict(row) if row is not None else None


def get_all_decisions() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT provider_id, decision, decided_by, decided_at, notes FROM decisions"
        ).fetchall()
    return [dict(r) for r in rows]


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
