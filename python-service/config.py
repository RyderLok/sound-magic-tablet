"""Piko — Python enhancement service configuration."""
import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (no python-dotenv dependency). Does not override existing env."""
    if not path.is_file():
        return
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            key, _, val = s.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except OSError:
        pass


_load_dotenv(_ROOT / ".env")

HOST = "0.0.0.0"
PORT = 8001
WS_AUDIO_PATH = "/ws/audio"

SAMPLE_RATE = 16000
FRAME_SAMPLES = 512
ANALYSIS_TARGET_HZ = 20
PYTHON_WEIGHT_DEFAULT = 0.6

OUTPUT_DIR = _ROOT / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# CORS for web-demo on :8000
CORS_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

# Optional SiliconFlow Qwen3-Omni (SILICONFLOW_API_KEY in env / .env)
SILICONFLOW_API_KEY = (os.environ.get("SILICONFLOW_API_KEY") or "").strip()
SILICONFLOW_OMNI_ENABLED = (os.environ.get("SILICONFLOW_OMNI_ENABLED") or "1").strip()
SILICONFLOW_OMNI_MODEL = os.environ.get(
    "SILICONFLOW_OMNI_MODEL", "Qwen/Qwen3-Omni-30B-A3B-Instruct"
)
SILICONFLOW_BASE_URL = os.environ.get(
    "SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1"
)

# Supabase Sounds (preferred). When unset → local disk under LOCAL_SOUNDS_DIR.
# Mac LaunchAgent mirrors this package to:
#   ~/Library/Application Support/Piko/python-runtime/
# so local WAVs live next to the running app, NOT always the Desktop project folder.
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
SUPABASE_SOUNDS_BUCKET = (os.environ.get("SUPABASE_SOUNDS_BUCKET") or "sounds").strip() or "sounds"

LOCAL_SOUNDS_DIR = _ROOT / "sounds"
LOCAL_SOUNDS_DIR.mkdir(parents=True, exist_ok=True)
LOCAL_SOUNDS_INDEX = LOCAL_SOUNDS_DIR / "index.json"


def supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def write_local_sounds_pointer() -> Path:
    """Write a Finder-friendly pointer next to WAVs (absolute path self-doc)."""
    pointer = LOCAL_SOUNDS_DIR / "WHERE_ARE_MY_RECORDINGS.txt"
    text = (
        "Piko local sounds (Supabase not configured or offline fallback)\n"
        f"Directory: {LOCAL_SOUNDS_DIR.resolve()}\n"
        f"Index:     {LOCAL_SOUNDS_INDEX.resolve()}\n"
        "Fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env to upload to cloud.\n"
        "Then run: python migrate_local_to_supabase.py\n"
    )
    try:
        pointer.write_text(text, encoding="utf-8")
    except OSError:
        pass
    return pointer
