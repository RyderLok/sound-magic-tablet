"""Piko — Python enhancement service configuration."""
from pathlib import Path

HOST = "0.0.0.0"
PORT = 8001
WS_AUDIO_PATH = "/ws/audio"

SAMPLE_RATE = 16000
FRAME_SAMPLES = 512
ANALYSIS_TARGET_HZ = 20
PYTHON_WEIGHT_DEFAULT = 0.6

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# CORS for web-demo on :8000
CORS_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]
