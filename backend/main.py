from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
from pathlib import Path

from core.config import settings
from api.routes import video_flow, editor_api

app = FastAPI(title="Video Dubbing Backend API")

# Setup CORS to allow requests from the Tauri frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to Tauri's local url
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve output directory so frontend can access the final video
output_path = Path(settings.OUTPUT_DIR)
output_path.mkdir(exist_ok=True)
app.mount("/output", StaticFiles(directory=str(output_path)), name="output")

# Include Routers
app.include_router(editor_api.router, prefix="/api", tags=["editor"])
app.include_router(video_flow.router, prefix="/api/auto", tags=["auto-pipeline"])

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Video Dubbing Backend is running!"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
