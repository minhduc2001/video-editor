from __future__ import annotations
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from pathlib import Path
import uuid
import asyncio

from core.config import settings, get_project_temp_dir, cleanup_project
from services.downloader import VideoDownloader
from services.audio_processor import AudioProcessor
from services.stt_service import stt_service
from services.translator import TranslatorService
from services.tts_service import TTSService
from services.video_editor import VideoEditorService

router = APIRouter()

class ProcessRequest(BaseModel):
    url: str
    target_language: str = "vi"
    voice: str = "vi-VN-HoaiMyNeural" # Edge TTS Voice ID

class ProcessResponse(BaseModel):
    project_id: str
    status: str
    message: str

# In-memory dictionary to track job status (in production, use Redis/DB)
job_status = {}

async def run_pipeline(project_id: str, request: ProcessRequest):
    """
    The main asynchronous pipeline that glues all AI services together.
    """
    job_status[project_id] = {"status": "processing", "step": "Downloading video..."}
    proj_dir = get_project_temp_dir(project_id)
    
    try:
        # 1. Download Video
        download_res = VideoDownloader.download_video(request.url, proj_dir, "original")
        if download_res["status"] != "success":
            raise Exception(f"Download failed: {download_res.get('message')}")
        video_path = Path(download_res["video_path"])
        
        # 2. Extract Audio & Isolate Vocals
        job_status[project_id]["step"] = "Isolating vocals..."
        audio_path = proj_dir / "extracted_audio.wav"
        AudioProcessor.extract_audio(video_path, audio_path)
        
        iso_res = AudioProcessor.isolate_vocals(audio_path, proj_dir)
        if iso_res["status"] != "success":
            raise Exception(f"Vocal isolation failed: {iso_res.get('message')}")
        vocals_path = Path(iso_res["vocals_path"])
        bgm_path = Path(iso_res["bgm_path"])
        
        # 3. Speech-to-Text (Transcribe)
        job_status[project_id]["step"] = "Transcribing audio (STT)..."
        stt_res = stt_service.transcribe(vocals_path)
        if stt_res["status"] != "success":
            raise Exception(f"Transcription failed: {stt_res.get('message')}")
        segments = stt_res["segments"]
        
        # 4. Translation
        job_status[project_id]["step"] = "Translating subtitles..."
        segments = TranslatorService.translate_segments(segments, request.target_language)
        
        # 5. Text-to-Speech & Time Stretching
        job_status[project_id]["step"] = "Generating AI Voice (TTS) & Stretching..."
        segments = await TTSService.process_segments(segments, request.voice, proj_dir / "dubs")
        
        # 6. Render Final Video
        job_status[project_id]["step"] = "Rendering final video (FFmpeg)..."
        output_video_path = settings.OUTPUT_DIR / f"{project_id}_final.mp4"
        
        render_success = VideoEditorService.render_final_video(
            video_path, bgm_path, segments, output_video_path, bgm_volume=0.2
        )
        if not render_success:
            raise Exception("Video rendering failed")
            
        job_status[project_id] = {
            "status": "completed", 
            "step": "Done", 
            "output_url": f"/output/{output_video_path.name}"
        }
        
        # Cleanup temp files for low-end machines
        cleanup_project(project_id)
        
    except Exception as e:
        job_status[project_id] = {"status": "error", "message": str(e)}
        print(f"Pipeline error for {project_id}: {e}")

@router.post("/process", response_model=ProcessResponse)
async def process_video(request: ProcessRequest, background_tasks: BackgroundTasks):
    """
    Endpoint to start the video dubbing pipeline.
    Returns immediately with a project_id.
    """
    project_id = str(uuid.uuid4())
    background_tasks.add_task(run_pipeline, project_id, request)
    
    return ProcessResponse(
        project_id=project_id,
        status="accepted",
        message="Video processing started in background"
    )

@router.get("/status/{project_id}")
async def get_status(project_id: str):
    """Get the current status of a processing job"""
    status = job_status.get(project_id, {"status": "not_found"})
    return status
