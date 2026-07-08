from __future__ import annotations
import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

def _get_log_file_path() -> Path:
    # If packaged, use AppData or custom path
    if getattr(sys, "frozen", False):
        override = os.getenv("VIDEO_EDITOR_BACKEND_HOME", "").strip()
        if override:
            base_dir = Path(override)
        else:
            local_app_data = os.getenv("LOCALAPPDATA")
            if local_app_data:
                base_dir = Path(local_app_data) / "VideoEditor" / "backend"
            else:
                base_dir = Path.home() / "AppData" / "Local" / "VideoEditor" / "backend"
    else:
        # Development mode
        base_dir = Path(__file__).parent.parent
        
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir / "backend.log"

LOG_FILE = _get_log_file_path()

def setup_logger():
    logger = logging.getLogger("video_editor")
    logger.setLevel(logging.INFO)
    
    # Prevent adding handlers multiple times
    if not logger.handlers:
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        
        # File handler (10MB max, keep 3 backups)
        file_handler = RotatingFileHandler(
            LOG_FILE, maxBytes=10*1024*1024, backupCount=3, encoding='utf-8'
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        
        # Console handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
        
    return logger

logger = setup_logger()
