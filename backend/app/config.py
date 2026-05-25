"""Application settings, dimuat dari environment variables atau file .env."""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        env_prefix="ECHO_",
        case_sensitive=False,
        extra="ignore",
    )

    project_name: str = "E.C.H.O Monitoring API"
    project_version: str = "3.0.0"
    project_description: str = (
        "Backend API untuk dashboard monitoring pasien non-verbal berbasis eye-tracking."
    )

    host: str = "127.0.0.1"
    port: int = 8000
    debug: bool = False
    reload: bool = False

    database_url: str = Field(
        default_factory=lambda: f"sqlite:///{DATA_DIR / 'echo_monitoring.sqlite3'}"
    )

    cors_origins: List[str] = ["*"]

    jwt_secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(48))
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    bcrypt_rounds: int = 12

    frontend_dir: Path = ROOT_DIR / "frontend"
    data_dir: Path = DATA_DIR

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value):
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return settings
