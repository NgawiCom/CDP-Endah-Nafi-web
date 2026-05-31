"""Business logic untuk pasien (CRUD + listing dengan agregat)."""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.exceptions import NotFoundError
from app.models import Patient, TrackingEvent, TrackingSession
from app.schemas import PatientIn


def _attach_calibration(patient: Patient) -> dict[str, Any]:
    raw = patient.calibration_json
    return {
        "has_calibration": bool(raw),
        "calibration_data": json.loads(raw) if raw else None,
    }


def list_patients(db: Session, query: str = "") -> list[dict[str, Any]]:
    session_count = func.count(func.distinct(TrackingSession.id)).label("session_count")
    last_session_at = func.max(TrackingSession.started_at).label("last_session_at")
    event_count = func.count(TrackingEvent.id).label("event_count")
    has_cal = case(
        (Patient.calibration_json.is_not(None), 1), else_=0
    ).label("has_calibration_flag")

    stmt = (
        select(Patient, session_count, last_session_at, event_count, has_cal)
        .outerjoin(TrackingSession, TrackingSession.patient_id == Patient.id)
        .outerjoin(TrackingEvent, TrackingEvent.patient_id == Patient.id)
        .group_by(Patient.id)
        .order_by(func.coalesce(last_session_at, Patient.created_at).desc())
    )

    if query:
        like = f"%{query.strip()}%"
        stmt = stmt.where(
            (Patient.name.ilike(like))
            | (Patient.nik.ilike(like))
            | (Patient.patient_code.ilike(like))
        )

    rows = db.execute(stmt).all()
    result: list[dict[str, Any]] = []
    for row in rows:
        patient, s_count, last_at, e_count, _has = row
        item = {
            **{c.name: getattr(patient, c.name) for c in patient.__table__.columns if c.name != "calibration_json"},
            "session_count": int(s_count or 0),
            "event_count": int(e_count or 0),
            "last_session_at": last_at,
            **_attach_calibration(patient),
        }
        item.pop("calibration_data", None)  # ringan saja di list
        result.append(item)
    return result


def get_patient(db: Session, patient_id: int) -> dict[str, Any]:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise NotFoundError("Pasien tidak ditemukan.")
    data = {c.name: getattr(patient, c.name) for c in patient.__table__.columns if c.name != "calibration_json"}
    data.update(_attach_calibration(patient))
    return data


def upsert_patient(db: Session, payload: PatientIn, created_by_id: int | None = None) -> dict[str, Any]:
    nik = payload.nik.strip()
    patient_code = (payload.patient_code or f"NIK-{nik}").strip()

    existing = db.scalar(
        select(Patient).where((Patient.nik == nik) | (Patient.patient_code == patient_code))
    )

    calibration_json = (
        json.dumps(payload.calibration_data, ensure_ascii=False) if payload.calibration_data else None
    )

    if existing:
        existing.patient_code = patient_code
        existing.name = payload.name.strip()
        existing.gender = payload.gender.strip()
        existing.nik = nik
        existing.room = (payload.room or "").strip() or None
        existing.bed = (payload.bed or "").strip() or None
        existing.notes = payload.notes or None
        if calibration_json is not None:
            existing.calibration_json = calibration_json
        patient = existing
    else:
        patient = Patient(
            patient_code=patient_code,
            name=payload.name.strip(),
            gender=payload.gender.strip(),
            nik=nik,
            room=(payload.room or "").strip() or None,
            bed=(payload.bed or "").strip() or None,
            notes=payload.notes or None,
            calibration_json=calibration_json,
            created_by_id=created_by_id,
        )
        db.add(patient)

    db.commit()
    db.refresh(patient)

    data = {c.name: getattr(patient, c.name) for c in patient.__table__.columns if c.name != "calibration_json"}
    data.update(_attach_calibration(patient))
    return data
