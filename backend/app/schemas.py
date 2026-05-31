"""Pydantic v2 schemas — request bodies & API response models."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


# ── Base helpers ──────────────────────────────────────────────────────────────


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── Auth ──────────────────────────────────────────────────────────────────────


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    role: str = Field(default="operator", max_length=32)
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORMModel):
    id: int
    name: str
    email: EmailStr
    role: str


class TokenOut(BaseModel):
    token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


# ── Patient ───────────────────────────────────────────────────────────────────


class PatientIn(BaseModel):
    patient_code: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=180)
    gender: str = Field(min_length=1, max_length=16)
    nik: str = Field(min_length=16, max_length=16, pattern=r"^\d{16}$")
    room: Optional[str] = Field(default=None, max_length=64)
    bed: Optional[str] = Field(default=None, max_length=64)
    notes: Optional[str] = None
    calibration_data: Optional[dict[str, Any]] = None


class PatientOut(ORMModel):
    id: int
    patient_code: str
    name: str
    gender: str
    nik: str
    room: Optional[str] = None
    bed: Optional[str] = None
    notes: Optional[str] = None
    has_calibration: bool = False
    calibration_data: Optional[dict[str, Any]] = None
    session_count: int = 0
    event_count: int = 0
    last_session_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


# ── Session ───────────────────────────────────────────────────────────────────


class SessionIn(BaseModel):
    started_at: Optional[datetime] = None
    source: Optional[str] = Field(default=None, max_length=64)
    device_label: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = None


class SessionUpdateIn(BaseModel):
    status: Optional[str] = Field(default=None, max_length=32)
    ended_at: Optional[datetime] = None
    notes: Optional[str] = None


class SessionOut(ORMModel):
    id: int
    patient_id: int
    started_at: datetime
    ended_at: Optional[datetime] = None
    status: str
    source: Optional[str] = None
    device_label: Optional[str] = None
    notes: Optional[str] = None
    event_count: int = 0
    last_event_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


# ── Tracking events ───────────────────────────────────────────────────────────


class TrackingEventIn(BaseModel):
    captured_at: Optional[datetime] = None
    event_type: str = Field(default="snapshot", max_length=32)
    gaze_direction: Optional[str] = Field(default=None, max_length=32)
    program_direction: Optional[str] = Field(default=None, max_length=32)
    eye_state: Optional[str] = Field(default=None, max_length=32)
    confidence: Optional[int] = Field(default=None, ge=0, le=100)
    eye_gap: Optional[float] = None
    gaze_ratio: Optional[float] = None
    fps: Optional[float] = Field(default=None, ge=0)
    latency_ms: Optional[float] = Field(default=None, ge=0)
    blink_count: Optional[int] = Field(default=None, ge=0)
    click_status: Optional[str] = Field(default=None, max_length=32)
    output_message: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None

    @field_validator("event_type")
    @classmethod
    def _normalize_type(cls, v: str) -> str:
        return v.strip().lower() or "snapshot"


class TrackingEventOut(ORMModel):
    id: int
    session_id: int
    patient_id: int
    captured_at: datetime
    event_type: str
    gaze_direction: Optional[str] = None
    program_direction: Optional[str] = None
    eye_state: Optional[str] = None
    confidence: Optional[int] = None
    eye_gap: Optional[float] = None
    gaze_ratio: Optional[float] = None
    fps: Optional[float] = None
    latency_ms: Optional[float] = None
    blink_count: Optional[int] = None
    click_status: Optional[str] = None
    output_message: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    created_at: datetime


class SessionSummaryOut(BaseModel):
    session: SessionOut
    stats: dict[str, Any]
    latest_event: Optional[TrackingEventOut] = None


# ── Common response envelopes ─────────────────────────────────────────────────


class HealthOut(BaseModel):
    ok: bool = True
    service: str
    version: str
    time: datetime
    database: str


class MessageOut(BaseModel):
    ok: bool = True
    message: str = "OK"


class ErrorOut(BaseModel):
    error: str
