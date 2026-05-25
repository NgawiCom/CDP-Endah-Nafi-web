"""Business logic untuk tracking sessions + events."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.exceptions import NotFoundError, ValidationError
from app.models import Patient, TrackingEvent, TrackingSession
from app.schemas import SessionIn, SessionUpdateIn, TrackingEventIn


def _to_dict(obj: Any) -> dict[str, Any]:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def list_sessions(db: Session, patient_id: int) -> list[dict[str, Any]]:
    if db.get(Patient, patient_id) is None:
        raise NotFoundError("Pasien tidak ditemukan.")

    event_count = func.count(TrackingEvent.id).label("event_count")
    last_event_at = func.max(TrackingEvent.captured_at).label("last_event_at")

    stmt = (
        select(TrackingSession, event_count, last_event_at)
        .outerjoin(TrackingEvent, TrackingEvent.session_id == TrackingSession.id)
        .where(TrackingSession.patient_id == patient_id)
        .group_by(TrackingSession.id)
        .order_by(TrackingSession.started_at.desc())
    )

    items: list[dict[str, Any]] = []
    for sess, e_count, last_at in db.execute(stmt).all():
        item = _to_dict(sess)
        item["event_count"] = int(e_count or 0)
        item["last_event_at"] = last_at
        items.append(item)
    return items


def create_session(db: Session, patient_id: int, payload: SessionIn) -> dict[str, Any]:
    if db.get(Patient, patient_id) is None:
        raise NotFoundError("Pasien tidak ditemukan.")

    sess = TrackingSession(
        patient_id=patient_id,
        started_at=payload.started_at or datetime.now(timezone.utc),
        source=(payload.source or "dashboard").strip(),
        device_label=(payload.device_label or "").strip() or None,
        notes=payload.notes,
        status="active",
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    out = _to_dict(sess)
    out.update({"event_count": 0, "last_event_at": None})
    return out


def update_session(db: Session, session_id: int, payload: SessionUpdateIn) -> dict[str, Any]:
    sess = db.get(TrackingSession, session_id)
    if sess is None:
        raise NotFoundError("Sesi tidak ditemukan.")

    if payload.status is not None:
        sess.status = payload.status
    if payload.ended_at is not None:
        sess.ended_at = payload.ended_at
    if payload.notes is not None:
        sess.notes = payload.notes

    db.commit()
    db.refresh(sess)
    return _to_dict(sess)


def create_event(db: Session, session_id: int, payload: TrackingEventIn) -> dict[str, Any]:
    sess = db.get(TrackingSession, session_id)
    if sess is None:
        raise NotFoundError("Sesi tidak ditemukan.")

    metadata = payload.metadata
    if metadata is not None and not isinstance(metadata, dict):
        raise ValidationError("metadata harus berupa object.")

    event = TrackingEvent(
        session_id=session_id,
        patient_id=sess.patient_id,
        captured_at=payload.captured_at or datetime.now(timezone.utc),
        event_type=payload.event_type,
        gaze_direction=payload.gaze_direction,
        program_direction=payload.program_direction,
        eye_state=payload.eye_state,
        confidence=payload.confidence,
        eye_gap=payload.eye_gap,
        gaze_ratio=payload.gaze_ratio,
        fps=payload.fps,
        latency_ms=payload.latency_ms,
        blink_count=payload.blink_count,
        click_status=payload.click_status,
        output_message=payload.output_message,
        metadata_json=json.dumps(metadata, ensure_ascii=False) if metadata is not None else None,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _serialize_event(event)


def list_events(db: Session, session_id: int, limit: int = 100) -> list[dict[str, Any]]:
    if db.get(TrackingSession, session_id) is None:
        raise NotFoundError("Sesi tidak ditemukan.")
    limit = max(1, min(limit, 1000))
    stmt = (
        select(TrackingEvent)
        .where(TrackingEvent.session_id == session_id)
        .order_by(TrackingEvent.captured_at.desc(), TrackingEvent.id.desc())
        .limit(limit)
    )
    return [_serialize_event(e) for e in db.scalars(stmt).all()]


def session_summary(db: Session, session_id: int) -> dict[str, Any]:
    sess = db.get(TrackingSession, session_id)
    if sess is None:
        raise NotFoundError("Sesi tidak ditemukan.")

    stats_row = db.execute(
        select(
            func.count(TrackingEvent.id).label("event_count"),
            func.avg(TrackingEvent.confidence).label("average_confidence"),
            func.max(TrackingEvent.captured_at).label("last_event_at"),
            func.sum(case((TrackingEvent.event_type == "message", 1), else_=0)).label("message_count"),
            func.sum(case((TrackingEvent.gaze_direction == "ATAS", 1), else_=0)).label("up_count"),
            func.sum(case((TrackingEvent.gaze_direction == "BAWAH", 1), else_=0)).label("down_count"),
        ).where(TrackingEvent.session_id == session_id)
    ).one()

    latest = db.scalar(
        select(TrackingEvent)
        .where(TrackingEvent.session_id == session_id)
        .order_by(TrackingEvent.captured_at.desc(), TrackingEvent.id.desc())
        .limit(1)
    )

    return {
        "session": {**_to_dict(sess), "event_count": int(stats_row.event_count or 0)},
        "stats": {
            "event_count": int(stats_row.event_count or 0),
            "average_confidence": float(stats_row.average_confidence) if stats_row.average_confidence is not None else None,
            "last_event_at": stats_row.last_event_at,
            "message_count": int(stats_row.message_count or 0),
            "up_count": int(stats_row.up_count or 0),
            "down_count": int(stats_row.down_count or 0),
        },
        "latest_event": _serialize_event(latest) if latest else None,
    }


def _serialize_event(event: TrackingEvent) -> dict[str, Any]:
    data = {c.name: getattr(event, c.name) for c in event.__table__.columns if c.name != "metadata_json"}
    data["metadata"] = json.loads(event.metadata_json) if event.metadata_json else None
    return data
