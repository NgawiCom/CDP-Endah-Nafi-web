"""FastAPI dependencies: session DB + current authenticated user."""
from __future__ import annotations

from typing import Annotated, Optional

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.exceptions import AuthError
from app.models import User
from app.security import decode_access_token


_bearer = HTTPBearer(auto_error=False, description="JWT bearer token")

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    creds: Annotated[Optional[HTTPAuthorizationCredentials], Depends(_bearer)] = None,
) -> User:
    if creds is None or not creds.credentials:
        raise AuthError("Header Authorization Bearer wajib disertakan.")

    try:
        payload = decode_access_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise AuthError("Token sudah kedaluwarsa, silakan login ulang.")
    except jwt.InvalidTokenError:
        raise AuthError("Token tidak valid.")

    user_id = payload.get("sub")
    if user_id is None:
        raise AuthError("Token tidak memiliki subjek.")

    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise AuthError("User tidak ditemukan atau dinonaktifkan.")

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
