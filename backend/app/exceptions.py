"""Exception klas domain + handler global yang konsisten."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


class AppError(Exception):
    """Base error domain — diturunkan agar handler dapat mapping status code."""

    status_code: int = 400
    message: str = "Terjadi kesalahan."

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    message = "Data tidak ditemukan."


class ValidationError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    message = "Data tidak valid."


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    message = "Data sudah ada."


class AuthError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    message = "Tidak terautentikasi."


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_req: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": exc.message})

    @app.exception_handler(HTTPException)
    async def _http_error(_req: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "HTTP error."
        return JSONResponse(status_code=exc.status_code, content={"error": detail})

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_req: Request, exc: RequestValidationError) -> JSONResponse:
        msgs = [f"{'.'.join(str(p) for p in e['loc'][1:]) or e['loc'][-1]}: {e['msg']}" for e in exc.errors()]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": "; ".join(msgs) or "Data tidak valid."},
        )

    @app.exception_handler(IntegrityError)
    async def _integrity_error(_req: Request, _exc: IntegrityError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"error": "Konflik data: nilai unik sudah dipakai."},
        )
