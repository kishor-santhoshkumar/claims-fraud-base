"""Pydantic request/response models for the demo auth endpoints
(/auth/login, /auth/me). Kept separate from schemas.py, which is only
for the ML prediction contract -- this file has nothing to do with the
RF gate / XGBoost pipeline.
"""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str

    model_config = {
        "json_schema_extra": {
            "example": {"username": "investigator1", "password": "demo1234"}
        }
    }


class AuthUser(BaseModel):
    username: str
    name: str


class LoginSuccessResponse(BaseModel):
    success: bool = True
    token: str = Field(..., description="Bearer token; pass as `Authorization: Bearer <token>` on subsequent requests")
    user: AuthUser


class LoginErrorResponse(BaseModel):
    success: bool = False
    detail: str = "Invalid username or password"


class MeResponse(BaseModel):
    username: str
    name: str
