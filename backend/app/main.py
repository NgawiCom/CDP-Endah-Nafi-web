"""FastAPI app factory + middleware + router wiring."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import Settings, get_settings
from app.database import init_db
from app.exceptions import register_exception_handlers
from app.routers import auth, health, patients, sessions


log = logging.getLogger("echo.app")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    settings: Settings = get_settings()
    init_db()
    log.info("E.C.H.O backend siap | DB=%s", settings.database_url)
    yield
    log.info("E.C.H.O backend shutdown.")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(
        title=settings.project_name,
        description=settings.project_description,
        version=settings.project_version,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials="*" not in settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "Accept"],
    )

    register_exception_handlers(app)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(patients.router)
    app.include_router(sessions.patient_sessions_router)
    app.include_router(sessions.sessions_router)

    @app.api_route(
        "/api/{full_path:path}",
        methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        include_in_schema=False,
    )
    async def _api_not_found(full_path: str):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Endpoint /api/{full_path} tidak ditemukan.",
        )

    frontend_dir = Path(settings.frontend_dir)
    if frontend_dir.is_dir():
        app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")

    return app
