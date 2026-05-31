"""
E.C.H.O Monitoring backend — entry point.

Jalankan dari root project:
    python backend/server.py
Atau langsung via uvicorn:
    uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# Pastikan folder backend/ ada di sys.path agar `from app...` resolvable
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import uvicorn

from app.config import get_settings


def parse_args(settings) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="E.C.H.O Monitoring backend (FastAPI).")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--reload", action="store_true", default=settings.reload)
    parser.add_argument("--cors-origin", default=None, help="Override CORS allow-origin (comma-separated).")
    parser.add_argument("--log-level", default="info", choices=["critical", "error", "warning", "info", "debug"])
    return parser.parse_args()


def main() -> None:
    settings = get_settings()
    args = parse_args(settings)

    if args.cors_origin:
        settings.cors_origins = [o.strip() for o in args.cors_origin.split(",") if o.strip()]

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    )

    banner = (
        f"\n  {settings.project_name} v{settings.project_version}\n"
        f"  -> http://{args.host}:{args.port}\n"
        f"  -> Docs   : http://{args.host}:{args.port}/api/docs\n"
        f"  -> DB     : {settings.database_url}\n"
        f"  -> CORS   : {settings.cors_origins}\n"
    )
    print(banner)

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
