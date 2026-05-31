"""Patient router: list / detail / upsert."""
from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.deps import CurrentUser, DbSession
from app.schemas import PatientIn
from app.services import patient_service


router = APIRouter(prefix="/api/patients", tags=["Patients"])


@router.get("", response_model=dict, summary="Daftar pasien (opsional dengan query)")
def list_patients(
    db: DbSession,
    _user: CurrentUser,
    q: str = Query(default="", max_length=180, description="Cari nama / NIK / kode pasien"),
) -> dict:
    return {"patients": patient_service.list_patients(db, q)}


@router.post(
    "",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Tambah atau update pasien (idempotent by NIK)",
)
def upsert_patient(payload: PatientIn, db: DbSession, user: CurrentUser) -> dict:
    return {"patient": patient_service.upsert_patient(db, payload, created_by_id=user.id)}


@router.get("/{patient_id}", response_model=dict, summary="Detail pasien")
def get_patient(patient_id: int, db: DbSession, _user: CurrentUser) -> dict:
    return {"patient": patient_service.get_patient(db, patient_id)}
