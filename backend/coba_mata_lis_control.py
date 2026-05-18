"""
E.C.H.O eye control replacement.

Program ini tidak memakai dataset. Arah pandangan dipelajari dari kalibrasi
langsung pengguna, lalu dipakai untuk Program E dengan dua arah: ATAS/BAWAH.

Kontrol:
  B  kalibrasi lihat bawah
  C  kalibrasi lihat tengah/center
  T  kalibrasi lihat atas
  S  mulai Program E setelah kalibrasi lengkap
  R  ulang kalibrasi saat program berjalan
  Q  keluar

Sinyal:
  Mata tertutup 5 detik = YES
  Kedip cepat 2 kali    = NO
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from collections import Counter, deque
from dataclasses import dataclass
from typing import Deque, Dict, Iterable, List, Optional, Tuple


WINDOW_TITLE = "E.C.H.O Eye Control - Python"
DEFAULT_CALIBRATION_SECONDS = 4.0
MIN_CALIBRATION_SECONDS = 3.0
MAX_CALIBRATION_SECONDS = 15.0
MIN_CALIBRATION_SAMPLES = 8

CLOSED_THRESHOLD_FACTOR = 0.55
MIN_CLOSED_THRESHOLD = 0.006
MAX_CLOSED_THRESHOLD = 0.09
DIRECTION_ACTIVATION_RATIO = 0.35
MIN_DIRECTION_OFFSET = 0.001

LONG_CLOSE_SECONDS = 5.0
FAST_BLINK_MIN_SECONDS = 0.05
FAST_BLINK_MAX_SECONDS = 0.70
DOUBLE_BLINK_WINDOW_SECONDS = 1.20

MIN_OPEN_GAP_FOR_CALIBRATION = 0.006
SMOOTHING_FRAMES = 3

TARGET_BY_KEY = {
    ord("t"): "top",
    ord("c"): "center",
    ord("b"): "bottom",
}

TARGET_LABEL = {
    "top": "ATAS",
    "center": "TENGAH",
    "bottom": "BAWAH",
}

LEFT_IRIS = (468, 469, 470, 471, 472)
RIGHT_IRIS = (473, 474, 475, 476, 477)
LEFT_TOP = (158, 159, 160)
LEFT_BOTTOM = (144, 145, 153)
RIGHT_TOP = (385, 386, 387)
RIGHT_BOTTOM = (373, 374, 380)
LEFT_CORNERS = (33, 133)
RIGHT_CORNERS = (362, 263)


@dataclass
class EyeFeatures:
    gaze_ratio: float
    eye_gap: float
    left_iris: Tuple[float, float]
    right_iris: Tuple[float, float]
    eye_points: Tuple[Tuple[float, float], ...]


@dataclass
class CalibrationProfile:
    top: float
    center: float
    bottom: float
    upper_threshold: float
    lower_threshold: float
    closed_threshold: float
    ordered_automatically: bool = False


class CalibrationSession:
    def __init__(self, seconds: float) -> None:
        self.seconds = clamp(seconds, MIN_CALIBRATION_SECONDS, MAX_CALIBRATION_SECONDS)
        self.samples: Dict[str, List[float]] = {"top": [], "center": [], "bottom": []}
        self.open_eye_gaps: List[float] = []
        self.active_target: Optional[str] = None
        self.active_samples: List[float] = []
        self.active_started_at = 0.0
        self.active_ends_at = 0.0
        self.message = "Kalibrasi dulu: tekan B, C, atau T."

    def reset(self) -> None:
        self.samples = {"top": [], "center": [], "bottom": []}
        self.open_eye_gaps = []
        self.active_target = None
        self.active_samples = []
        self.active_started_at = 0.0
        self.active_ends_at = 0.0
        self.message = "Kalibrasi diulang. Tekan B, C, atau T."

    def start(self, target: str, now: float) -> None:
        self.active_target = target
        self.active_samples = []
        self.active_started_at = now
        self.active_ends_at = now + self.seconds
        label = TARGET_LABEL[target]
        self.message = f"Lihat {label}. Mengambil data {self.seconds:.0f} detik..."

    def update(self, features: Optional[EyeFeatures], now: float) -> None:
        if self.active_target is None:
            return

        if features is not None and features.eye_gap >= MIN_OPEN_GAP_FOR_CALIBRATION:
            self.active_samples.append(features.gaze_ratio)
            self.open_eye_gaps.append(features.eye_gap)

        if now < self.active_ends_at:
            return

        target = self.active_target
        label = TARGET_LABEL[target]
        sample_count = len(self.active_samples)

        if sample_count >= MIN_CALIBRATION_SAMPLES:
            self.samples[target] = list(self.active_samples)
            self.message = f"Kalibrasi {label} selesai ({sample_count} sampel)."
        else:
            self.samples[target] = []
            self.message = f"Kalibrasi {label} gagal. Wajah/mata kurang terbaca."

        self.active_target = None
        self.active_samples = []

    def progress(self, now: float) -> float:
        if self.active_target is None:
            return 0.0
        total = max(self.active_ends_at - self.active_started_at, 0.001)
        return clamp((now - self.active_started_at) / total, 0.0, 1.0)

    def is_complete(self) -> bool:
        return all(len(values) >= MIN_CALIBRATION_SAMPLES for values in self.samples.values())

    def build_profile(self) -> Optional[CalibrationProfile]:
        if not self.is_complete():
            return None

        top = safe_median(self.samples["top"])
        center = safe_median(self.samples["center"])
        bottom = safe_median(self.samples["bottom"])
        ordered_automatically = False

        if not (top < center < bottom):
            top, center, bottom = sorted((top, center, bottom))
            ordered_automatically = True

        upper_threshold = center - max(
            (center - top) * DIRECTION_ACTIVATION_RATIO,
            MIN_DIRECTION_OFFSET,
        )
        lower_threshold = center + max(
            (bottom - center) * DIRECTION_ACTIVATION_RATIO,
            MIN_DIRECTION_OFFSET,
        )
        open_gap = safe_median(self.open_eye_gaps) if self.open_eye_gaps else 0.16
        closed_threshold = max(
            MIN_CLOSED_THRESHOLD,
            min(MAX_CLOSED_THRESHOLD, open_gap * CLOSED_THRESHOLD_FACTOR),
        )

        return CalibrationProfile(
            top=top,
            center=center,
            bottom=bottom,
            upper_threshold=upper_threshold,
            lower_threshold=lower_threshold,
            closed_threshold=closed_threshold,
            ordered_automatically=ordered_automatically,
        )


class BlinkInterpreter:
    def __init__(self) -> None:
        self.eye_closed = False
        self.closed_started_at = 0.0
        self.long_close_sent = False
        self.quick_blinks: Deque[float] = deque(maxlen=2)

    def reset(self) -> None:
        self.eye_closed = False
        self.closed_started_at = 0.0
        self.long_close_sent = False
        self.quick_blinks.clear()

    def update(self, is_closed: bool, now: float) -> Tuple[str, Optional[str]]:
        if is_closed:
            if not self.eye_closed:
                self.eye_closed = True
                self.closed_started_at = now
                self.long_close_sent = False

            closed_for = now - self.closed_started_at
            if closed_for >= LONG_CLOSE_SECONDS and not self.long_close_sent:
                self.long_close_sent = True
                self.quick_blinks.clear()
                return f"MATA TERTUTUP {closed_for:.1f}s", "YES"

            return f"MATA TERTUTUP {closed_for:.1f}s", None

        if not self.eye_closed:
            return "MATA TERBUKA", None

        closed_duration = now - self.closed_started_at
        self.eye_closed = False

        if self.long_close_sent:
            self.long_close_sent = False
            return "MATA TERBUKA", None

        if FAST_BLINK_MIN_SECONDS <= closed_duration <= FAST_BLINK_MAX_SECONDS:
            self.quick_blinks.append(now)
            while self.quick_blinks and now - self.quick_blinks[0] > DOUBLE_BLINK_WINDOW_SECONDS:
                self.quick_blinks.popleft()

            if len(self.quick_blinks) >= 2:
                self.quick_blinks.clear()
                return "MATA TERBUKA", "NO"

            return "KEDIP CEPAT 1X", None

        self.quick_blinks.clear()
        return "MATA TERBUKA", None


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def safe_median(values: Iterable[float]) -> float:
    values = list(values)
    if not values:
        return 0.0
    return float(statistics.median(values))


def load_dependencies():
    try:
        import cv2  # type: ignore
        import mediapipe as mp  # type: ignore
    except ImportError as exc:
        print("Dependency belum lengkap.")
        print("Install dulu dengan:")
        print("  pip install opencv-python mediapipe")
        print(f"Detail error: {exc}")
        return None, None

    return cv2, mp


def point(landmarks, index: int) -> Tuple[float, float]:
    landmark = landmarks[index]
    return float(landmark.x), float(landmark.y)


def mean_point(landmarks, indexes: Iterable[int]) -> Tuple[float, float]:
    points = [point(landmarks, index) for index in indexes]
    return (
        sum(item[0] for item in points) / len(points),
        sum(item[1] for item in points) / len(points),
    )


def distance(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return (dx * dx + dy * dy) ** 0.5


def eye_ratio(
    landmarks,
    iris_indexes: Iterable[int],
    top_indexes: Iterable[int],
    bottom_indexes: Iterable[int],
    corner_indexes: Tuple[int, int],
) -> Tuple[float, float, Tuple[float, float]]:
    iris = mean_point(landmarks, iris_indexes)
    top = mean_point(landmarks, top_indexes)
    bottom = mean_point(landmarks, bottom_indexes)
    corner_a = point(landmarks, corner_indexes[0])
    corner_b = point(landmarks, corner_indexes[1])

    vertical_gap = max(bottom[1] - top[1], 0.0001)
    horizontal_width = max(distance(corner_a, corner_b), 0.0001)
    ratio = clamp((iris[1] - top[1]) / vertical_gap, -0.5, 1.5)
    normalized_gap = abs(bottom[1] - top[1]) / horizontal_width

    return ratio, normalized_gap, iris


def extract_eye_features(face_landmarks) -> Optional[EyeFeatures]:
    landmarks = face_landmarks.landmark
    if len(landmarks) <= max(RIGHT_IRIS):
        return None

    left_ratio, left_gap, left_iris = eye_ratio(
        landmarks,
        LEFT_IRIS,
        LEFT_TOP,
        LEFT_BOTTOM,
        LEFT_CORNERS,
    )
    right_ratio, right_gap, right_iris = eye_ratio(
        landmarks,
        RIGHT_IRIS,
        RIGHT_TOP,
        RIGHT_BOTTOM,
        RIGHT_CORNERS,
    )
    gaze_ratio = (left_ratio + right_ratio) / 2.0
    eye_gap = (left_gap + right_gap) / 2.0

    eye_points = tuple(
        mean_point(landmarks, group)
        for group in (LEFT_TOP, LEFT_BOTTOM, RIGHT_TOP, RIGHT_BOTTOM, LEFT_IRIS, RIGHT_IRIS)
    )

    return EyeFeatures(
        gaze_ratio=gaze_ratio,
        eye_gap=eye_gap,
        left_iris=left_iris,
        right_iris=right_iris,
        eye_points=eye_points,
    )


def classify_direction(features: EyeFeatures, profile: CalibrationProfile) -> str:
    if features.gaze_ratio < profile.upper_threshold:
        return "ATAS"
    if features.gaze_ratio > profile.lower_threshold:
        return "BAWAH"
    return "TENGAH"


def stable_direction(history: Deque[str]) -> str:
    if not history:
        return "-"
    counts = Counter(history)
    return counts.most_common(1)[0][0]


def open_camera(cv2, camera_index: int):
    capture = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not capture.isOpened():
        capture.release()
        capture = cv2.VideoCapture(camera_index)
    if capture.isOpened():
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        capture.set(cv2.CAP_PROP_FPS, 30)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return capture


def draw_text_block(cv2, frame, lines: List[str], x: int, y: int, scale: float = 0.58) -> None:
    for offset, line in enumerate(lines):
        cv2.putText(
            frame,
            line,
            (x, y + offset * 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            scale,
            (245, 245, 245),
            1,
            cv2.LINE_AA,
        )


def draw_bar(cv2, frame, x: int, y: int, width: int, height: int, progress: float) -> None:
    cv2.rectangle(frame, (x, y), (x + width, y + height), (70, 70, 70), 1)
    cv2.rectangle(
        frame,
        (x + 2, y + 2),
        (x + int((width - 4) * progress), y + height - 2),
        (41, 171, 135),
        -1,
    )


def draw_eye_points(cv2, frame, features: EyeFeatures) -> None:
    height, width = frame.shape[:2]
    for item in features.eye_points:
        x = int(item[0] * width)
        y = int(item[1] * height)
        cv2.circle(frame, (x, y), 3, (53, 224, 172), -1)

    for item in (features.left_iris, features.right_iris):
        x = int(item[0] * width)
        y = int(item[1] * height)
        cv2.circle(frame, (x, y), 5, (0, 180, 255), -1)


def draw_overlay(
    cv2,
    frame,
    mode: str,
    session: CalibrationSession,
    profile: Optional[CalibrationProfile],
    features: Optional[EyeFeatures],
    direction: str,
    program_direction: str,
    eye_state: str,
    output: str,
    now: float,
) -> None:
    height, width = frame.shape[:2]
    cv2.rectangle(frame, (0, 0), (width, 142), (11, 30, 34), -1)
    cv2.rectangle(frame, (0, height - 74), (width, height), (11, 30, 34), -1)

    if features is not None:
        draw_eye_points(cv2, frame, features)

    if mode == "calibration":
        completed = [
            f"{TARGET_LABEL[target]}: {'OK' if session.samples[target] else '--'}"
            for target in ("bottom", "center", "top")
        ]
        lines = [
            "MODE KALIBRASI - lihat sesuai tombol selama data diambil",
            "B=bawah  C=center  T=atas  S=mulai Program E  Q=keluar",
            session.message,
            " | ".join(completed),
        ]
        draw_text_block(cv2, frame, lines, 18, 28)
        if session.active_target is not None:
            draw_bar(cv2, frame, 18, 112, width - 36, 16, session.progress(now))
    else:
        ratio_text = f"{features.gaze_ratio:.3f}" if features else "-"
        gap_text = f"{features.eye_gap:.3f}" if features else "-"
        threshold_text = "-"
        if profile is not None:
            threshold_text = f"atas<{profile.upper_threshold:.3f} bawah>{profile.lower_threshold:.3f}"

        lines = [
            "PROGRAM E AKTIF - dua arah: ATAS / BAWAH",
            f"ARAH PROGRAM: {program_direction}     DETEKSI: {direction}",
            f"MATA: {eye_state}     OUTPUT: {output}",
            f"ratio={ratio_text}  gap={gap_text}  threshold={threshold_text}",
        ]
        draw_text_block(cv2, frame, lines, 18, 28)

    bottom_lines = [
        "YES = mata tertutup 5 detik     NO = kedip cepat 2 kali",
        "Tekan R untuk kalibrasi ulang, Q untuk keluar.",
    ]
    draw_text_block(cv2, frame, bottom_lines, 18, height - 46, scale=0.55)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Eye tracking Python untuk E.C.H.O.")
    parser.add_argument("--camera", type=int, default=0, help="Index kamera. Default: 0.")
    parser.add_argument(
        "--calibration-seconds",
        type=float,
        default=DEFAULT_CALIBRATION_SECONDS,
        help="Durasi tiap kalibrasi, 3-15 detik. Default: 4.",
    )
    parser.add_argument(
        "--no-mirror",
        action="store_true",
        help="Matikan mirror kamera kalau arah terasa terbalik.",
    )
    return parser.parse_args()


def main() -> int:
    cv2, mp = load_dependencies()
    if cv2 is None or mp is None:
        return 1

    args = parse_args()
    calibration_seconds = clamp(
        args.calibration_seconds,
        MIN_CALIBRATION_SECONDS,
        MAX_CALIBRATION_SECONDS,
    )
    session = CalibrationSession(calibration_seconds)
    blink = BlinkInterpreter()
    direction_history: Deque[str] = deque(maxlen=SMOOTHING_FRAMES)

    capture = open_camera(cv2, args.camera)
    if not capture.isOpened():
        print(f"Kamera index {args.camera} tidak bisa dibuka.")
        return 1

    face_mesh = mp.solutions.face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.65,
        min_tracking_confidence=0.7,
    )

    mode = "calibration"
    profile: Optional[CalibrationProfile] = None
    output = "MENUNGGU"
    last_direction_printed = "-"

    print("E.C.H.O Eye Control Python")
    print("Kalibrasi dulu: B=bawah, C=center, T=atas. Tekan S untuk mulai.")

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                print("Frame kamera tidak terbaca.")
                break

            if not args.no_mirror:
                frame = cv2.flip(frame, 1)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            results = face_mesh.process(rgb)
            features = None

            if results.multi_face_landmarks:
                features = extract_eye_features(results.multi_face_landmarks[0])

            now = time.monotonic()
            key = cv2.waitKey(1) & 0xFF

            if key in (27, ord("q")):
                break

            if mode == "calibration":
                session.update(features, now)

                if session.active_target is None and key in TARGET_BY_KEY:
                    session.start(TARGET_BY_KEY[key], now)
                elif session.active_target is None and key == ord("s"):
                    profile = session.build_profile()
                    if profile is None:
                        session.message = "Kalibrasi belum lengkap. Isi B, C, dan T dulu."
                    else:
                        mode = "running"
                        output = "PROGRAM E MULAI"
                        blink.reset()
                        direction_history.clear()
                        if profile.ordered_automatically:
                            print("Catatan: urutan nilai kalibrasi diperbaiki otomatis.")
                        print("Program E dimulai. Arah aktif hanya ATAS dan BAWAH.")

                draw_overlay(
                    cv2,
                    frame,
                    mode,
                    session,
                    profile,
                    features,
                    "-",
                    "-",
                    "MATA TERBUKA" if features else "WAJAH TIDAK TERBACA",
                    output,
                    now,
                )
            else:
                if key == ord("r"):
                    mode = "calibration"
                    profile = None
                    output = "MENUNGGU KALIBRASI"
                    last_direction_printed = "-"
                    direction_history.clear()
                    blink.reset()
                    session.reset()
                    draw_overlay(
                        cv2,
                        frame,
                        mode,
                        session,
                        profile,
                        features,
                        "-",
                        "-",
                        "MATA TERBUKA" if features else "WAJAH TIDAK TERBACA",
                        output,
                        now,
                    )
                    cv2.imshow(WINDOW_TITLE, frame)
                    continue

                direction = "-"
                program_direction = "-"
                eye_state = "WAJAH TIDAK TERBACA"

                if features is not None and profile is not None:
                    is_closed = features.eye_gap < profile.closed_threshold
                    eye_state, blink_event = blink.update(is_closed, now)

                    if blink_event == "YES":
                        output = "YES"
                        print(f"[{time.strftime('%H:%M:%S')}] YES - mata tertutup 5 detik")
                    elif blink_event == "NO":
                        output = "NO"
                        print(f"[{time.strftime('%H:%M:%S')}] NO - kedip cepat 2 kali")

                    if not is_closed:
                        direction_history.append(classify_direction(features, profile))
                        direction = stable_direction(direction_history)
                        if direction in ("ATAS", "BAWAH"):
                            program_direction = direction
                    else:
                        direction = "MATA TERTUTUP"
                else:
                    blink.reset()
                    direction_history.clear()

                if program_direction != last_direction_printed and program_direction in ("ATAS", "BAWAH"):
                    last_direction_printed = program_direction
                    print(f"[{time.strftime('%H:%M:%S')}] ARAH: {program_direction}")
                elif program_direction == "-":
                    last_direction_printed = "-"

                draw_overlay(
                    cv2,
                    frame,
                    mode,
                    session,
                    profile,
                    features,
                    direction,
                    program_direction,
                    eye_state,
                    output,
                    now,
                )

            cv2.imshow(WINDOW_TITLE, frame)

    finally:
        face_mesh.close()
        capture.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    sys.exit(main())
