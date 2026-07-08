from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pathlib import Path
from core.logger import LOG_FILE

router = APIRouter()

@router.get("/logs")
def get_system_logs(lines: int = 500):
    """Returns the last N lines of the backend log file."""
    try:
        log_path = Path(LOG_FILE)
        if not log_path.exists():
            return {"logs": "Log file not found."}
        
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            # Read all lines and get the last N
            all_lines = f.readlines()
            last_lines = all_lines[-lines:]
            
        return {"logs": "".join(last_lines)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read logs: {str(e)}")
