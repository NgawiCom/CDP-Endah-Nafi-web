"""Auth router: register, login, current user, logout."""
from __future__ import annotations

from fastapi import APIRouter, status

from app.deps import CurrentUser, DbSession
from app.schemas import LoginIn, MessageOut, RegisterIn, TokenOut, UserOut
from app.services import auth_service


router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post(
    "/register",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Daftar akun operator baru",
)
def register(payload: RegisterIn, db: DbSession) -> dict:
    user = auth_service.register_user(db, payload)
    return {"user": UserOut.model_validate(user).model_dump()}


@router.post("/login", response_model=TokenOut, summary="Login dan dapatkan JWT")
def login(payload: LoginIn, db: DbSession) -> TokenOut:
    user, token, expires_in = auth_service.authenticate(db, payload)
    return TokenOut(
        token=token,
        expires_in=expires_in,
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=dict, summary="Info user yang sedang login")
def me(user: CurrentUser) -> dict:
    return {"user": UserOut.model_validate(user).model_dump()}


@router.post("/logout", response_model=MessageOut, summary="Logout (klien hapus token)")
def logout(_user: CurrentUser) -> MessageOut:
    # JWT stateless: revocation cukup di sisi klien (hapus localStorage).
    return MessageOut(message="Logout berhasil.")
