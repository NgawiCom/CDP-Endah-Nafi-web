from __future__ import annotations

import argparse
import json
import mimetypes
import re
import sqlite3
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qs, unquote, urlparse


ROOT_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT_DIR / "frontend"
DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_DB_PATH = DATA_DIR / "echo_monitoring.sqlite3"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def json_dumps(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def parse_json(raw: bytes) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Body harus JSON valid.") from exc
    if not isinstance(value, dict):
        raise ValueError("Body JSON harus berupa object.")
    return value


def clean_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def optional_text(value: Any) -> str | None:
    text = clean_text(value)
    return text or None


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def json_field(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("calibration_data harus berupa object.")
    return json.dumps(value, ensure_ascii=False)


class Store:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def init_schema(self) -> None:
        with self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS patients (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  patient_code TEXT NOT NULL UNIQUE,
                  name TEXT NOT NULL DEFAULT '',
                  gender TEXT,
                  nik TEXT,
                  room TEXT,
                  bed TEXT,
                  notes TEXT,
                  calibration_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tracking_sessions (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  patient_id INTEGER NOT NULL,
                  started_at TEXT NOT NULL,
                  ended_at TEXT,
                  status TEXT NOT NULL DEFAULT 'active',
                  source TEXT,
                  device_label TEXT,
                  notes TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS tracking_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  session_id INTEGER NOT NULL,
                  patient_id INTEGER NOT NULL,
                  captured_at TEXT NOT NULL,
                  event_type TEXT NOT NULL DEFAULT 'snapshot',
                  gaze_direction TEXT,
                  program_direction TEXT,
                  eye_state TEXT,
                  confidence INTEGER,
                  eye_gap REAL,
                  gaze_ratio REAL,
                  fps REAL,
                  latency_ms REAL,
                  blink_count INTEGER,
                  click_status TEXT,
                  output_message TEXT,
                  metadata_json TEXT,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY (session_id) REFERENCES tracking_sessions(id) ON DELETE CASCADE,
                  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_patient_started
                  ON tracking_sessions(patient_id, started_at DESC);

                CREATE INDEX IF NOT EXISTS idx_events_session_captured
                  ON tracking_events(session_id, captured_at DESC);

                """
            )
            self.migrate_schema(db)

    def migrate_schema(self, db: sqlite3.Connection) -> None:
        columns = {row["name"] for row in db.execute("PRAGMA table_info(patients)").fetchall()}
        migrations = {
            "gender": "ALTER TABLE patients ADD COLUMN gender TEXT",
            "nik": "ALTER TABLE patients ADD COLUMN nik TEXT",
            "calibration_json": "ALTER TABLE patients ADD COLUMN calibration_json TEXT",
        }

        for column, statement in migrations.items():
            if column not in columns:
                db.execute(statement)

        db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_nik_unique
              ON patients(nik)
              WHERE nik IS NOT NULL AND nik != ''
            """
        )

    def upsert_patient(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = clean_text(payload.get("name"))
        gender = clean_text(payload.get("gender"))
        nik = clean_text(payload.get("nik") or payload.get("NIK"))
        patient_code = clean_text(payload.get("patient_code") or payload.get("patientCode"), f"NIK-{nik}")
        calibration_data = payload.get("calibration_data")

        if calibration_data is None:
            calibration_data = payload.get("calibrationData") or payload.get("coordinates")

        if not name:
            raise ValueError("Nama pasien wajib diisi.")
        if not gender:
            raise ValueError("Jenis kelamin wajib diisi.")
        if not nik:
            raise ValueError("NIK wajib diisi.")
        if not patient_code:
            raise ValueError("patient_code wajib diisi.")

        now = utc_now()
        values = {
            "patient_code": patient_code,
            "name": name,
            "gender": gender,
            "nik": nik,
            "room": optional_text(payload.get("room")),
            "bed": optional_text(payload.get("bed")),
            "notes": optional_text(payload.get("notes")),
            "calibration_json": json_field(calibration_data),
        }

        with self.connect() as db:
            existing = db.execute(
                """
                SELECT * FROM patients
                 WHERE nik = ? OR patient_code = ?
                 LIMIT 1
                """,
                (nik, patient_code),
            ).fetchone()

            if existing:
                db.execute(
                    """
                    UPDATE patients
                       SET patient_code = ?,
                           name = ?,
                           gender = ?,
                           nik = ?,
                           room = ?,
                           bed = ?,
                           notes = ?,
                           calibration_json = COALESCE(?, calibration_json),
                           updated_at = ?
                     WHERE id = ?
                    """,
                    (
                        values["patient_code"],
                        values["name"],
                        values["gender"],
                        values["nik"],
                        values["room"],
                        values["bed"],
                        values["notes"],
                        values["calibration_json"],
                        now,
                        existing["id"],
                    ),
                )
            else:
                db.execute(
                    """
                    INSERT INTO patients (
                      patient_code,
                      name,
                      gender,
                      nik,
                      room,
                      bed,
                      notes,
                      calibration_json,
                      created_at,
                      updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        values["patient_code"],
                        values["name"],
                        values["gender"],
                        values["nik"],
                        values["room"],
                        values["bed"],
                        values["notes"],
                        values["calibration_json"],
                        now,
                        now,
                    ),
                )

            row = db.execute(
                "SELECT * FROM patients WHERE nik = ? OR patient_code = ? LIMIT 1",
                (nik, patient_code),
            ).fetchone()
            return self.expand_patient(row)

    def list_patients(self, query: str = "") -> list[dict[str, Any]]:
        query = clean_text(query)
        with self.connect() as db:
            params: list[Any] = []
            where = ""
            if query:
                where = "WHERE p.name LIKE ? OR p.nik LIKE ? OR p.patient_code LIKE ?"
                pattern = f"%{query}%"
                params.extend([pattern, pattern, pattern])

            rows = db.execute(
                f"""
                SELECT p.*,
                       COUNT(DISTINCT s.id) AS session_count,
                       MAX(s.started_at) AS last_session_at,
                       COUNT(e.id) AS event_count,
                       CASE
                         WHEN p.calibration_json IS NULL OR p.calibration_json = '' THEN 0
                         ELSE 1
                       END AS has_calibration
                  FROM patients p
             LEFT JOIN tracking_sessions s ON s.patient_id = p.id
             LEFT JOIN tracking_events e ON e.patient_id = p.id
                 {where}
              GROUP BY p.id
              ORDER BY COALESCE(MAX(s.started_at), p.created_at) DESC
                """,
                params,
            ).fetchall()
            return [self.expand_patient(row, include_calibration=False) for row in rows]

    def get_patient(self, patient_id: int) -> dict[str, Any] | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
            return self.expand_patient(row) if row else None

    def create_session(self, patient_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        if self.get_patient(patient_id) is None:
            raise LookupError("Pasien tidak ditemukan.")

        now = utc_now()
        started_at = clean_text(payload.get("started_at") or payload.get("startedAt"), now)
        source = optional_text(payload.get("source")) or "dashboard"
        device_label = optional_text(payload.get("device_label") or payload.get("deviceLabel"))
        notes = optional_text(payload.get("notes"))

        with self.connect() as db:
            cursor = db.execute(
                """
                INSERT INTO tracking_sessions
                  (patient_id, started_at, status, source, device_label, notes, created_at, updated_at)
                VALUES (?, ?, 'active', ?, ?, ?, ?, ?)
                """,
                (patient_id, started_at, source, device_label, notes, now, now),
            )
            row = db.execute(
                "SELECT * FROM tracking_sessions WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
            return row_to_dict(row)

    def update_session(self, session_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        status = clean_text(payload.get("status"), "active")
        ended_at = optional_text(payload.get("ended_at") or payload.get("endedAt"))
        notes = optional_text(payload.get("notes"))

        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM tracking_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if row is None:
                raise LookupError("Sesi tidak ditemukan.")

            db.execute(
                """
                UPDATE tracking_sessions
                   SET status = ?, ended_at = COALESCE(?, ended_at), notes = COALESCE(?, notes), updated_at = ?
                 WHERE id = ?
                """,
                (status, ended_at, notes, now, session_id),
            )
            updated = db.execute(
                "SELECT * FROM tracking_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            return row_to_dict(updated)

    def list_sessions(self, patient_id: int) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                """
                SELECT s.*,
                       COUNT(e.id) AS event_count,
                       MAX(e.captured_at) AS last_event_at
                  FROM tracking_sessions s
             LEFT JOIN tracking_events e ON e.session_id = s.id
                 WHERE s.patient_id = ?
              GROUP BY s.id
              ORDER BY s.started_at DESC
                """,
                (patient_id,),
            ).fetchall()
            return [row_to_dict(row) for row in rows]

    def create_event(self, session_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as db:
            session = db.execute(
                "SELECT * FROM tracking_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if session is None:
                raise LookupError("Sesi tidak ditemukan.")

            metadata = payload.get("metadata")
            if metadata is not None and not isinstance(metadata, dict):
                raise ValueError("metadata harus berupa object.")

            cursor = db.execute(
                """
                INSERT INTO tracking_events (
                  session_id,
                  patient_id,
                  captured_at,
                  event_type,
                  gaze_direction,
                  program_direction,
                  eye_state,
                  confidence,
                  eye_gap,
                  gaze_ratio,
                  fps,
                  latency_ms,
                  blink_count,
                  click_status,
                  output_message,
                  metadata_json,
                  created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    session["patient_id"],
                    clean_text(payload.get("captured_at") or payload.get("capturedAt"), now),
                    clean_text(payload.get("event_type") or payload.get("eventType"), "snapshot"),
                    optional_text(payload.get("gaze_direction") or payload.get("gazeDirection")),
                    optional_text(payload.get("program_direction") or payload.get("programDirection")),
                    optional_text(payload.get("eye_state") or payload.get("eyeState")),
                    payload.get("confidence"),
                    payload.get("eye_gap") if payload.get("eye_gap") is not None else payload.get("eyeGap"),
                    payload.get("gaze_ratio") if payload.get("gaze_ratio") is not None else payload.get("gazeRatio"),
                    payload.get("fps"),
                    payload.get("latency_ms") if payload.get("latency_ms") is not None else payload.get("latencyMs"),
                    payload.get("blink_count") if payload.get("blink_count") is not None else payload.get("blinkCount"),
                    optional_text(payload.get("click_status") or payload.get("clickStatus")),
                    optional_text(payload.get("output_message") or payload.get("outputMessage")),
                    json.dumps(metadata, ensure_ascii=False) if metadata is not None else None,
                    now,
                ),
            )
            row = db.execute(
                "SELECT * FROM tracking_events WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
            return self.expand_event(row)

    def list_events(self, session_id: int, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 1000))
        with self.connect() as db:
            rows = db.execute(
                """
                SELECT * FROM tracking_events
                 WHERE session_id = ?
              ORDER BY captured_at DESC, id DESC
                 LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()
            return [self.expand_event(row) for row in rows]

    def session_summary(self, session_id: int) -> dict[str, Any]:
        with self.connect() as db:
            session = db.execute(
                "SELECT * FROM tracking_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if session is None:
                raise LookupError("Sesi tidak ditemukan.")

            stats = db.execute(
                """
                SELECT COUNT(*) AS event_count,
                       AVG(confidence) AS average_confidence,
                       MAX(captured_at) AS last_event_at,
                       SUM(CASE WHEN event_type = 'message' THEN 1 ELSE 0 END) AS message_count,
                       SUM(CASE WHEN gaze_direction = 'ATAS' THEN 1 ELSE 0 END) AS up_count,
                       SUM(CASE WHEN gaze_direction = 'BAWAH' THEN 1 ELSE 0 END) AS down_count
                  FROM tracking_events
                 WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()
            latest = db.execute(
                """
                SELECT * FROM tracking_events
                 WHERE session_id = ?
              ORDER BY captured_at DESC, id DESC
                 LIMIT 1
                """,
                (session_id,),
            ).fetchone()

            return {
                "session": row_to_dict(session),
                "stats": row_to_dict(stats),
                "latest_event": self.expand_event(latest) if latest else None,
            }

    def expand_patient(self, row: sqlite3.Row, include_calibration: bool = True) -> dict[str, Any]:
        patient = row_to_dict(row)
        raw_calibration = patient.pop("calibration_json", None)
        patient["has_calibration"] = bool(patient.get("has_calibration") or raw_calibration)

        if include_calibration:
            patient["calibration_data"] = json.loads(raw_calibration) if raw_calibration else None

        return patient

    def expand_event(self, row: sqlite3.Row) -> dict[str, Any]:
        event = row_to_dict(row)
        raw_metadata = event.pop("metadata_json", None)
        event["metadata"] = json.loads(raw_metadata) if raw_metadata else None
        return event


class AppHandler(BaseHTTPRequestHandler):
    store: Store

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format % args))

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        self.dispatch()

    def do_POST(self) -> None:
        self.dispatch()

    def do_PATCH(self) -> None:
        self.dispatch()

    def dispatch(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/"):
                self.handle_api(parsed.path, parse_qs(parsed.query))
            else:
                self.handle_static(parsed.path)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except LookupError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except Exception as exc:  # pragma: no cover - defensive runtime boundary.
            self.send_json({"error": "Internal server error", "detail": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        return parse_json(self.rfile.read(length))

    def handle_api(self, path: str, query: dict[str, list[str]]) -> None:
        if self.command == "GET" and path == "/api/health":
            self.send_json({"ok": True, "database": str(self.store.db_path), "time": utc_now()})
            return

        if path == "/api/patients":
            if self.command == "GET":
                search_query = (query.get("q") or query.get("search") or [""])[0]
                self.send_json({"patients": self.store.list_patients(search_query)})
                return
            if self.command == "POST":
                self.send_json({"patient": self.store.upsert_patient(self.read_json())}, HTTPStatus.CREATED)
                return

        patient_match = re.fullmatch(r"/api/patients/(\d+)", path)
        if patient_match and self.command == "GET":
            patient = self.store.get_patient(int(patient_match.group(1)))
            if patient is None:
                raise LookupError("Pasien tidak ditemukan.")
            self.send_json({"patient": patient})
            return

        sessions_match = re.fullmatch(r"/api/patients/(\d+)/sessions", path)
        if sessions_match:
            patient_id = int(sessions_match.group(1))
            if self.command == "GET":
                self.send_json({"sessions": self.store.list_sessions(patient_id)})
                return
            if self.command == "POST":
                session = self.store.create_session(patient_id, self.read_json())
                self.send_json({"session": session}, HTTPStatus.CREATED)
                return

        session_match = re.fullmatch(r"/api/sessions/(\d+)", path)
        if session_match and self.command == "PATCH":
            session = self.store.update_session(int(session_match.group(1)), self.read_json())
            self.send_json({"session": session})
            return

        events_match = re.fullmatch(r"/api/sessions/(\d+)/tracking-events", path)
        if events_match:
            session_id = int(events_match.group(1))
            if self.command == "GET":
                limit = int((query.get("limit") or ["100"])[0])
                self.send_json({"events": self.store.list_events(session_id, limit)})
                return
            if self.command == "POST":
                event = self.store.create_event(session_id, self.read_json())
                self.send_json({"event": event}, HTTPStatus.CREATED)
                return

        summary_match = re.fullmatch(r"/api/sessions/(\d+)/summary", path)
        if summary_match and self.command == "GET":
            self.send_json(self.store.session_summary(int(summary_match.group(1))))
            return

        self.send_json({"error": "Endpoint tidak ditemukan."}, HTTPStatus.NOT_FOUND)

    def handle_static(self, path: str) -> None:
        relative = unquote(path.lstrip("/"))
        if not relative:
            relative = "index.html"

        target = (FRONTEND_DIR / relative).resolve()
        if not str(target).startswith(str(FRONTEND_DIR.resolve())) or not target.is_file():
            self.send_json({"error": "File tidak ditemukan."}, HTTPStatus.NOT_FOUND)
            return

        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        payload = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json_dumps(payload)
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backend E.C.H.O Monitoring.")
    parser.add_argument("--host", default="127.0.0.1", help="Host server. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8000, help="Port server. Default: 8000")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Path database SQLite.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    AppHandler.store = Store(args.db)
    server = ThreadingHTTPServer((args.host, args.port), AppHandler)

    print(f"E.C.H.O backend aktif: http://{args.host}:{args.port}")
    print(f"Database: {args.db}")
    print("Tekan Ctrl+C untuk berhenti.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
