"""ORM model untuk user, pasien, sesi, dan event tracking."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(180), nullable=False, unique=True, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="operator")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    patients: Mapped[list["Patient"]] = relationship(back_populates="created_by", cascade="all, delete-orphan")


class Patient(Base, TimestampMixin):
    __tablename__ = "patients"
    __table_args__ = (UniqueConstraint("nik", name="uq_patients_nik"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    gender: Mapped[str] = mapped_column(String(16), nullable=False)
    nik: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    room: Mapped[Optional[str]] = mapped_column(String(64))
    bed: Mapped[Optional[str]] = mapped_column(String(64))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    calibration_json: Mapped[Optional[str]] = mapped_column(Text)

    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped[Optional[User]] = relationship(back_populates="patients")

    sessions: Mapped[list["TrackingSession"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )


class TrackingSession(Base, TimestampMixin):
    __tablename__ = "tracking_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    source: Mapped[Optional[str]] = mapped_column(String(64))
    device_label: Mapped[Optional[str]] = mapped_column(String(120))
    notes: Mapped[Optional[str]] = mapped_column(Text)

    patient: Mapped[Patient] = relationship(back_populates="sessions")
    events: Mapped[list["TrackingEvent"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class TrackingEvent(Base):
    __tablename__ = "tracking_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("tracking_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, default="snapshot")

    gaze_direction: Mapped[Optional[str]] = mapped_column(String(32))
    program_direction: Mapped[Optional[str]] = mapped_column(String(32))
    eye_state: Mapped[Optional[str]] = mapped_column(String(32))
    confidence: Mapped[Optional[int]] = mapped_column(Integer)
    eye_gap: Mapped[Optional[float]] = mapped_column(Float)
    gaze_ratio: Mapped[Optional[float]] = mapped_column(Float)
    fps: Mapped[Optional[float]] = mapped_column(Float)
    latency_ms: Mapped[Optional[float]] = mapped_column(Float)
    blink_count: Mapped[Optional[int]] = mapped_column(Integer)
    click_status: Mapped[Optional[str]] = mapped_column(String(32))
    output_message: Mapped[Optional[str]] = mapped_column(Text)
    metadata_json: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    session: Mapped[TrackingSession] = relationship(back_populates="events")
