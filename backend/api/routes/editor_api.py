from fastapi import APIRouter, HTTPException, BackgroundTasks, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pathlib import Path
import mimetypes
import uuid
import shutil
import subprocess
import requests
from urllib.parse import quote
from typing import List, Dict, Any, Optional

from core.config import settings, get_project_temp_dir
from services.downloader import VideoDownloader
from services.audio_processor import AudioProcessor
from services.stt_service import stt_service
from services.translator import TranslatorService
from services.tts_service import TTSService
from services.video_editor import VideoEditorService

router = APIRouter()

# --- DTOs ---
class DownloadRequest(BaseModel):
    url: str

class TranslationSettingsRequest(BaseModel):
    provider: str
    api_key: str = ""
    base_url: str = ""
    openai_api_key: str = ""
    vieneu_api_url: str = ""
    vieneu_model_id: str = ""
    model: str = ""
    enable_fallback: bool = True

class TranslationModelsRequest(BaseModel):
    provider: str = "9router"
    api_key: str = ""
    base_url: str = ""

class STTSettingsRequest(BaseModel):
    model_size: str = "large-v3"
    compute_type: str = "int8"
    language_mode: str = "auto_zh_fallback"
    fallback_language: str = "zh"
    min_language_probability: float = 0.55

class TelegramSettingsRequest(BaseModel):
    enabled: bool = False
    bot_token: str = ""
    chat_id: str = ""

class TelegramNotificationResult(BaseModel):
    source_url: str = ""
    file_name: str = ""
    download_url: str = ""

class TelegramNotificationRequest(BaseModel):
    title: str = "Job completed"
    message: str = ""
    results: List[TelegramNotificationResult] = Field(default_factory=list)

class STTRequest(BaseModel):
    video_path: str
    isolate_vocals: bool = False
    translate_to_vietnamese: bool = False

class VoiceIsolationRequest(BaseModel):
    video_path: str

class TTSRequest(BaseModel):
    segments: List[Dict[str, Any]]
    target_language: str = "vi"
    voice: str = "vi-VN-HoaiMyNeural"
    translate: bool = False

class RenderRequest(BaseModel):
    video_path: str
    bgm_path: str
    segments: List[Dict[str, Any]]
    bgm_volume: float = 0.2

class TimelineExportClip(BaseModel):
    video_path: str
    source_start: float
    source_end: float
    bgm_path: Optional[str] = None

class TimelineExportTextClip(BaseModel):
    text: str
    start: float
    end: float
    x: float = 50
    y: float = 78
    font_family: str = "Arial"
    font_size: float = 30
    font_weight: int = 700
    font_style: str = "normal"
    color: str = "#ffffff"
    stroke_color: str = "#000000"
    stroke_width: float = 0
    background_color: str = "#000000"
    background_opacity: float = 0

class TimelineExportBlurMask(BaseModel):
    start: float
    end: float
    x: float = 50
    y: float = 82
    width: float = 82
    height: float = 13
    intensity: float = 16
    mode: str = "blur"
    color: str = "#ffd84d"
    opacity: float = 0.86

class TimelineExportDubbingClip(BaseModel):
    audio_path: str
    start: float
    end: float
    volume: float = 1
    speed: float = 1

class TimelineExportRequest(BaseModel):
    clips: List[TimelineExportClip]
    text_clips: List[TimelineExportTextClip] = []
    blur_masks: List[TimelineExportBlurMask] = []
    dubbing_clips: List[TimelineExportDubbingClip] = []
    duck_original_audio_all: bool = False
    include_audio: bool = True
    burn_subtitles: bool = True
    output_name: str = "export"
    output_width: int = 0
    output_height: int = 0

# --- GRANULAR APIs ---

@router.get("/settings/translation")
async def get_translation_settings():
    """Return local translation provider settings used by this packaged app."""
    return settings.get_translation_settings()

@router.post("/settings/translation")
async def update_translation_settings(request: TranslationSettingsRequest):
    """Persist local translation provider settings for this machine."""
    try:
        return settings.update_translation_settings(
            provider=request.provider,
            api_key=request.api_key,
            base_url=request.base_url,
            model=request.model,
            enable_fallback=request.enable_fallback,
            openai_api_key=request.openai_api_key,
            vieneu_api_url=request.vieneu_api_url,
            vieneu_model_id=request.vieneu_model_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.get("/settings/stt")
async def get_stt_settings():
    """Return speech-to-text settings for auto captions."""
    return settings.get_stt_settings()

@router.post("/settings/stt")
async def update_stt_settings(request: STTSettingsRequest):
    """Persist speech-to-text settings and reset the loaded Whisper model if needed."""
    previous_model_size = settings.WHISPER_MODEL_SIZE
    previous_compute_type = settings.WHISPER_COMPUTE_TYPE
    saved = settings.update_stt_settings(
        model_size=request.model_size,
        compute_type=request.compute_type,
        language_mode=request.language_mode,
        fallback_language=request.fallback_language,
        min_language_probability=request.min_language_probability,
    )

    if (
        previous_model_size != settings.WHISPER_MODEL_SIZE
        or previous_compute_type != settings.WHISPER_COMPUTE_TYPE
    ):
        stt_service.reset_model()

    return saved

@router.post("/settings/translation/models")
async def get_translation_models(request: TranslationModelsRequest):
    """List available models from an OpenAI-compatible provider."""
    if request.provider != "9router":
        raise HTTPException(status_code=400, detail="Model listing is currently supported for 9Router only.")

    if not request.base_url.strip():
        raise HTTPException(status_code=400, detail="API URL is required.")

    if not request.api_key.strip():
        raise HTTPException(status_code=400, detail="API key is required.")

    try:
        return {
            "models": TranslatorService.list_openai_compatible_models(
                request.base_url,
                request.api_key,
            )
        }
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Could not load models: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.get("/settings/telegram")
async def get_telegram_settings():
    """Return local Telegram notification settings."""
    return settings.get_telegram_settings()

@router.post("/settings/telegram")
async def update_telegram_settings(request: TelegramSettingsRequest):
    """Persist local Telegram notification settings for this machine."""
    return settings.update_telegram_settings(
        enabled=request.enabled,
        bot_token=request.bot_token,
        chat_id=request.chat_id,
    )

@router.post("/notifications/telegram")
async def send_telegram_notification(request: TelegramNotificationRequest):
    """Send a Telegram notification for a finished automation job."""
    if not settings.TELEGRAM_ENABLED:
        return {"status": "skipped", "reason": "telegram_disabled"}

    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
        raise HTTPException(
            status_code=400,
            detail="Telegram Bot Token and Chat ID are required.",
        )

    lines = [f"Done: {request.title}"]

    if request.message.strip():
        lines.extend(["", request.message.strip()])

    if request.results:
        lines.extend(["", f"Exports: {len(request.results)}"])
        for index, result in enumerate(request.results, start=1):
            lines.extend([
                "",
                f"{index}. {result.file_name or 'export.mp4'}",
                f"Source: {result.source_url or '-'}",
                f"Local download: {result.download_url or '-'}",
            ])

    text = "\n".join(lines)
    if len(text) > 3900:
        text = f"{text[:3890]}\n...truncated"

    try:
        response = requests.post(
            f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
            json={
                "chat_id": settings.TELEGRAM_CHAT_ID,
                "text": text,
                "disable_web_page_preview": True,
            },
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Telegram request failed: {exc}") from exc

    if not response.ok:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text

        raise HTTPException(status_code=502, detail=f"Telegram API failed: {detail}")

    return {"status": "sent"}

@router.post("/import-video")
async def import_video(file: UploadFile = File(...)):
    """Upload a local video file from the frontend so backend services can process it."""
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a video")

    project_id = str(uuid.uuid4())
    proj_dir = get_project_temp_dir(project_id)
    original_name = Path(file.filename or "video.mp4").name
    suffix = Path(original_name).suffix or ".mp4"
    video_path = proj_dir / f"original{suffix}"

    try:
        with video_path.open("wb") as output_file:
            shutil.copyfileobj(file.file, output_file)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded video: {exc}") from exc
    finally:
        await file.close()

    return {
        "project_id": project_id,
        "video_path": str(video_path),
        "filename": original_name,
    }

@router.post("/download")
async def download_media(request: DownloadRequest):
    """Bước 1: Tải video từ URL (Tiktok/Youtube/Douyin)"""
    url = request.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Please enter a valid http(s) video URL")

    project_id = str(uuid.uuid4())
    proj_dir = get_project_temp_dir(project_id)
    
    res = VideoDownloader.download_video(url, proj_dir, "original")
    if res["status"] != "success":
        raise HTTPException(status_code=400, detail=res.get("message"))

    video_path = Path(res["video_path"])
    if not video_path.exists():
        raise HTTPException(status_code=500, detail="Downloaded video file was not found")

    width = int(res.get("width") or 0)
    height = int(res.get("height") or 0)
    if width <= 0 or height <= 0:
        width, height = VideoEditorService._probe_video_size(video_path)
        
    return {
        "project_id": project_id,
        "video_path": str(video_path),
        "title": res.get("title") or video_path.stem,
        "filename": video_path.name,
        "duration": res.get("duration") or 0,
        "width": width,
        "height": height,
        "size": video_path.stat().st_size,
        "media_url": f"/api/media/{project_id}/{quote(video_path.name)}",
    }

@router.get("/media/{project_id}/{filename}")
async def get_downloaded_media(project_id: str, filename: str):
    """Serve a downloaded/imported backend media file for frontend preview."""
    if "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    media_path = (settings.TEMP_DIR / project_id / filename).resolve()
    temp_root = settings.TEMP_DIR.resolve()

    try:
        media_path.relative_to(temp_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid media path") from exc

    if not media_path.exists() or not media_path.is_file():
        raise HTTPException(status_code=404, detail="Media file not found")

    media_type = mimetypes.guess_type(str(media_path))[0] or "application/octet-stream"
    return FileResponse(media_path, media_type=media_type, filename=filename)

@router.post("/transcribe")
async def transcribe_media(request: STTRequest):
    """Bước 2: Tách âm thanh và nhận diện giọng nói (STT) thành Subtitles"""
    video_path = Path(request.video_path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")
        
    proj_dir = video_path.parent
    audio_path = proj_dir / "extracted_audio.wav"
    
    # Extract audio first. Auto captions should not depend on Demucs because
    # vocal isolation is slow and can be interrupted by dev-server reloads.
    if not AudioProcessor.extract_audio(video_path, audio_path):
        raise HTTPException(status_code=500, detail="Audio extraction failed. Check FFmpeg installation.")

    transcribe_audio_path = audio_path
    iso_res = {
        "status": "skipped",
        "bgm_path": "",
        "vocals_path": str(audio_path),
    }

    if request.isolate_vocals:
        iso_res = AudioProcessor.isolate_vocals(audio_path, proj_dir)

        if iso_res["status"] == "success":
            transcribe_audio_path = Path(iso_res["vocals_path"])
        else:
            print("Vocal isolation failed during transcription. Falling back to extracted audio.")

    stt_res = stt_service.transcribe(transcribe_audio_path)
    if stt_res["status"] != "success":
        raise HTTPException(status_code=500, detail=stt_res.get("message", "STT failed"))

    segments = stt_res["segments"]
    if request.translate_to_vietnamese:
        translated_segments = TranslatorService.translate_segments(
            [segment.copy() for segment in segments],
            "vi",
        )
        segments = []
        for segment in translated_segments:
            source_text = segment.get("text", "")
            translated_text = segment.get("translated_text", source_text)
            segments.append({
                **segment,
                "source_text": source_text,
                "translated_text": translated_text,
                "text": translated_text,
            })
        
    return {
        "bgm_path": iso_res.get("bgm_path", ""),
        "vocals_path": str(transcribe_audio_path),
        "isolation_status": iso_res.get("status", "skipped"),
        "language": stt_res.get("language", ""),
        "language_probability": stt_res.get("language_probability", 0),
        "language_source": stt_res.get("language_source", ""),
        "model_size": stt_res.get("model_size", ""),
        "compute_type": stt_res.get("compute_type", ""),
        "segments": segments
    }

@router.post("/isolate-voice")
async def isolate_voice(request: VoiceIsolationRequest):
    """Extract Chinese/original voice and background music tracks from an uploaded video."""
    video_path = Path(request.video_path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    proj_dir = video_path.parent
    audio_path = proj_dir / "extracted_audio.wav"

    if not AudioProcessor.extract_audio(video_path, audio_path):
        raise HTTPException(status_code=500, detail="Audio extraction failed. Check FFmpeg installation.")

    iso_res = AudioProcessor.isolate_vocals(audio_path, proj_dir)
    if iso_res["status"] != "success":
        raise HTTPException(status_code=500, detail=iso_res.get("message", "Vocal isolation failed"))

    return {
        "audio_path": str(audio_path),
        "bgm_path": iso_res["bgm_path"],
        "vocals_path": iso_res["vocals_path"],
    }

@router.post("/translate-and-dub")
async def generate_dubbing(request: TTSRequest):
    """Bước 3: Dịch thuật và tạo giọng nói AI (TTS) + Time stretch"""
    if not request.segments:
        raise HTTPException(status_code=400, detail="No segments provided")
        
    source_segments = [segment.copy() for segment in request.segments]
    if request.translate:
        source_segments = TranslatorService.translate_segments(source_segments, request.target_language)

    project_id = str(uuid.uuid4())
    temp_dir = get_project_temp_dir(project_id)
    final_segments = await TTSService.process_segments(source_segments, request.voice, temp_dir)
    if not final_segments:
        raise HTTPException(
            status_code=500,
            detail="TTS generation failed. Check the selected voice and API key settings.",
        )

    for segment in final_segments:
        audio_path = Path(segment.get("dub_audio_path", ""))
        if audio_path.exists():
            segment["dub_audio_url"] = f"/api/media/{project_id}/{quote(audio_path.name)}"

    return {
        "project_id": project_id,
        "segments": final_segments
    }

@router.post("/render")
async def render_video(request: RenderRequest, background_tasks: BackgroundTasks):
    """Bước 4: Trộn Video, Subtitle, AI Voice và xuất file MP4 cuối cùng"""
    output_filename = f"export_{uuid.uuid4().hex[:8]}.mp4"
    output_path = settings.OUTPUT_DIR / output_filename
    
    def render_task():
        VideoEditorService.render_final_video(
            Path(request.video_path),
            Path(request.bgm_path),
            request.segments,
            output_path,
            request.bgm_volume
        )
        
    background_tasks.add_task(render_task)
    
    return {
        "status": "rendering",
        "output_url": f"/output/{output_filename}"
    }

@router.post("/export-timeline")
async def export_timeline(request: TimelineExportRequest):
    """Render the current editor timeline into one MP4 file."""
    if not request.clips:
        raise HTTPException(status_code=400, detail="Timeline has no clips to export")

    safe_name = "".join(
        char if char.isalnum() or char in ("-", "_") else "_"
        for char in (request.output_name or "export")
    ).strip("_") or "export"
    output_filename = f"{safe_name}_{uuid.uuid4().hex[:8]}.mp4"
    output_path = settings.OUTPUT_DIR / output_filename

    try:
        VideoEditorService.render_timeline_export(
            clips=[clip.dict() for clip in request.clips],
            text_clips=[clip.dict() for clip in request.text_clips],
            blur_masks=[mask.dict() for mask in request.blur_masks],
            dubbing_clips=[clip.dict() for clip in request.dubbing_clips],
            duck_original_audio_all=request.duck_original_audio_all,
            output_path=output_path,
            include_audio=request.include_audio,
            burn_subtitles=request.burn_subtitles,
            output_width=request.output_width,
            output_height=request.output_height,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=500, detail=f"FFmpeg export failed: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}") from exc

    return {
        "status": "done",
        "output_url": f"/output/{output_filename}",
        "output_path": str(output_path),
        "filename": output_filename,
    }
