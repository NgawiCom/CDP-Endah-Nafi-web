"""Tracking sessions + events router."""
from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.deps import CurrentUser, DbSession
from app.schemas import SessionIn, SessionUpdateIn, TrackingEventIn
from app.services import session_service


# Nested di /api/patients/{id}/sessions
patient_sessions_router = APIRouter(prefix="/api/patients/{patient_id}/sessions", tags=["Sessions"])
# Top-level di /api/sessions/{id}
sessions_router = APIRouter(prefix="/api/sessions/{session_id}", tags=["Sessions"])


@patient_sessions_router.get("", response_model=dict, summary="Daftar sesi pasien")
def list_patient_sessions(patient_id: int, db: DbSession, _user: CurrentUser) -> dict:
    return {"sessions": session_service.list_sessions(db, patient_id)}


@patient_sessions_router.post(
    "",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Buat sesi tracking baru",
)
def create_patient_session(
    patient_id: int, payload: SessionIn, db: DbSession, _user: CurrentUser
) -> dict:
    return {"session": session_service.create_session(db, patient_id, payload)}


@sessions_router.patch("", response_model=dict, summary="Update status / ended_at / notes sesi")
def update_session(
    session_id: int, payload: SessionUpdateIn, db: DbSession, _user: CurrentUser
) -> dict:
    return {"session": session_service.update_session(db, session_id, payload)}


@sessions_router.get("/summary", response_model=dict, summary="Ringkasan agregat sesi")
def session_summary(session_id: int, db: DbSession, _user: CurrentUser) -> dict:
    return session_service.session_summary(db, session_id)


@sessions_router.get("/tracking-events", response_model=dict, summary="Daftar event tracking sesi")
def list_events(
    session_id: int,
    db: DbSession,
    _user: CurrentUser,
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict:
    return {"events": session_service.list_events(db, session_id, limit)}


@sessions_router.post(
    "/tracking-events",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Rekam event tracking baru",
)
def create_event(
    session_id: int, payload: TrackingEventIn, db: DbSession, _user: CurrentUser
) -> dict:
    return {"event": session_service.create_event(db, session_id, payload)}
