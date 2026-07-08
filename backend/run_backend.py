from __future__ import annotations
import os
import sys
from pathlib import Path


def _packaged_log_path() -> Path:
    override = os.getenv("VIDEO_EDITOR_BACKEND_HOME", "").strip()
    if override:
        base_dir = Path(override)
        base_dir.mkdir(parents=True, exist_ok=True)
        return base_dir / "backend.log"

    local_app_data = os.getenv("LOCALAPPDATA")
    if local_app_data:
        base_dir = Path(local_app_data) / "VideoEditor" / "backend"
    else:
        base_dir = Path.home() / "AppData" / "Local" / "VideoEditor" / "backend"

    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir / "backend.log"


def _redirect_packaged_logs() -> None:
    if not getattr(sys, "frozen", False):
        return

    log_file = _packaged_log_path().open("a", encoding="utf-8", errors="replace", buffering=1)
    sys.stdout = log_file
    sys.stderr = log_file
    print("\n--- Video Editor backend starting ---", flush=True)


def main() -> None:
    _redirect_packaged_logs()
    import uvicorn
    from main import app

    host = os.getenv("VIDEO_EDITOR_BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("VIDEO_EDITOR_BACKEND_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
