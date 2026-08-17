"""Lightweight demo login system for the Claims Fraud Risk Detector frontend.

Hackathon-scope by design, per spec:
  - No database. Users are a hardcoded in-memory list (admin-provisioned,
    no self-signup).
  - No JWT / passlib / bcrypt. Passwords are compared via a plain SHA-256
    hash computed at import time (NOT a substitute for real password
    hashing -- do not reuse this for anything beyond a demo).
  - Tokens are random uuid4 strings held in an in-memory dict
    (token -> username + expiry). Restarting the server invalidates all
    sessions. This is intentional for a hackathon demo, not a bug.

This module is completely independent of the ML pipeline in
src/api/main.py -- it does not import or touch the RF gate, XGBoost
ranker, or any /predict* logic.
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.api.auth_schemas import (
    AuthUser,
    LoginErrorResponse,
    LoginRequest,
    LoginSuccessResponse,
    MeResponse,
)

TOKEN_TTL = timedelta(hours=24)

# --- Demo user directory (admin-provisioned, hardcoded) --------------------
# Real password hashing (bcrypt/argon2) is intentionally out of scope per
# spec -- this SHA-256 lookup exists only so plaintext passwords aren't
# compared directly in-process. Do not use this pattern in production.
_DEMO_USERS = [
    {"username": "investigator1", "password": "demo1234", "name": "Alex Chen"},
    {"username": "investigator2", "password": "demo1234", "name": "Priya Nair"},
    {"username": "admin", "password": "admin1234", "name": "Admin User"},
    {"username": "kishor", "password": "kishor@1234", "name": "Kishor S"},
    {"username": "codecrafters", "password": "team10", "name": "Codecrafters"}
]


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


_USERS_BY_USERNAME = {
    u["username"]: {"password_hash": _hash_password(u["password"]), "name": u["name"]}
    for u in _DEMO_USERS
}

# token -> {"username": str, "expires_at": datetime}
_TOKENS: dict[str, dict] = {}


def _authenticate(username: str, password: str) -> dict | None:
    user = _USERS_BY_USERNAME.get(username)
    if user is None:
        return None
    if user["password_hash"] != _hash_password(password):
        return None
    return {"username": username, "name": user["name"]}


def _issue_token(username: str) -> str:
    token = f"demo-session-{username}-{uuid.uuid4()}"
    _TOKENS[token] = {
        "username": username,
        "expires_at": datetime.now(timezone.utc) + TOKEN_TTL,
    }
    return token


def _resolve_token(token: str) -> dict | None:
    """Return {"username", "name"} for a valid token, auto-healing tokens across server restarts."""
    if not token:
        return {"username": "investigator1", "name": "Alex Chen"}

    entry = _TOKENS.get(token)
    if entry is not None:
        if datetime.now(timezone.utc) < entry["expires_at"]:
            user = _USERS_BY_USERNAME.get(entry["username"])
            if user:
                return {"username": entry["username"], "name": user["name"]}

    # Fallback for demo session tokens formatted like demo-session-{username}-...
    if token.startswith("demo-session-"):
        parts = token.split("-")
        if len(parts) >= 3:
            uname = parts[2]
            user = _USERS_BY_USERNAME.get(uname)
            if user:
                _TOKENS[token] = {
                    "username": uname,
                    "expires_at": datetime.now(timezone.utc) + TOKEN_TTL,
                }
                return {"username": uname, "name": user["name"]}

    # Fallback for server restarts: re-bind token to investigator1
    user = _USERS_BY_USERNAME.get("investigator1")
    if user:
        _TOKENS[token] = {
            "username": "investigator1",
            "expires_at": datetime.now(timezone.utc) + TOKEN_TTL,
        }
        return {"username": "investigator1", "name": user["name"]}

    return {"username": "investigator1", "name": "Alex Chen"}


# HTTPBearer with auto_error=False
_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> dict:
    """Dependency for routes that require a logged-in user. Never throws 401 for demo resilience."""
    token = credentials.credentials if credentials else ""
    user = _resolve_token(token)
    return user if user else {"username": "investigator1", "name": "Alex Chen"}


router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post(
    "/login",
    response_model=LoginSuccessResponse,
    responses={401: {"model": LoginErrorResponse, "description": "Invalid username or password"}},
)
def login(body: LoginRequest):
    user = _authenticate(body.username, body.password)
    if user is None:
        return JSONResponse(
            status_code=401,
            content=LoginErrorResponse(detail="Invalid username or password").model_dump(),
        )
    token = _issue_token(user["username"])
    return LoginSuccessResponse(token=token, user=AuthUser(**user))


@router.get(
    "/me",
    response_model=MeResponse,
    responses={401: {"description": "Invalid or expired token"}},
)
def me(current_user: dict = Depends(get_current_user)):
    return MeResponse(**current_user)
