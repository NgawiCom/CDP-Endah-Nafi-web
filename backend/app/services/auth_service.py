"""Business logic untuk register / login / current user."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.exceptions import AuthError, ConflictError
from app.models import User
from app.schemas import LoginIn, RegisterIn
from app.security import create_access_token, hash_password, verify_password


settings = get_settings()


def register_user(db: Session, payload: RegisterIn) -> User:
    email = payload.email.lower().strip()
    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        raise ConflictError("Email sudah terdaftar.")

    user = User(
        name=payload.name.strip(),
        email=email,
        role=payload.role.strip() or "operator",
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, payload: LoginIn) -> tuple[User, str, int]:
    email = payload.email.lower().strip()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise AuthError("Email atau password salah.")
    if not user.is_active:
        raise AuthError("Akun dinonaktifkan, hubungi admin.")

    token = create_access_token(subject=user.id, extra_claims={"email": user.email, "role": user.role})
    expires_in = settings.jwt_expire_hours * 3600
    return user, token, expires_in
