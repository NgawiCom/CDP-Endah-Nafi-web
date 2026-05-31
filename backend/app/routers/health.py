"""Endpoint health & meta."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import get_settings
from app.schemas import HealthOut


router = APIRouter(prefix="/api", tags=["System"])
settings = get_settings()


@router.get("/health", response_model=HealthOut, summary="Health check")
def healthcheck() -> HealthOut:
    return HealthOut(
        service=settings.project_name,
        version=settings.project_version,
        time=datetime.now(timezone.utc),
        database=settings.database_url,
    )
