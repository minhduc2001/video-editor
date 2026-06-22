from pathlib import Path
from typing import Dict, Any, List
from faster_whisper import WhisperModel

from core.config import settings

CHINESE_LANGUAGE_CODES = {"zh", "yue"}

class STTService:
    """Service for Speech-to-Text using faster-whisper"""
    
    def __init__(self):
        # Initialize model lazily or at startup depending on memory constraints.
        # We'll do it lazily here to save memory when not transcribing.
        self.model = None
        self.loaded_model_size = ""
        self.loaded_compute_type = ""

    def _load_model(self):
        model_changed = (
            self.loaded_model_size != settings.WHISPER_MODEL_SIZE
            or self.loaded_compute_type != settings.WHISPER_COMPUTE_TYPE
        )

        if self.model is None or model_changed:
            print(f"Loading Faster Whisper model: {settings.WHISPER_MODEL_SIZE} ({settings.WHISPER_COMPUTE_TYPE})")
            # For low-end machines, we might force CPU if CUDA is OOM, but faster-whisper handles it gracefully 
            # if we specify device="auto". We will use device="auto".
            self.model = WhisperModel(
                settings.WHISPER_MODEL_SIZE, 
                device="auto", 
                compute_type=settings.WHISPER_COMPUTE_TYPE,
                download_root=str(Path(settings.MODELS_DIR) / "whisper")
            )
            self.loaded_model_size = settings.WHISPER_MODEL_SIZE
            self.loaded_compute_type = settings.WHISPER_COMPUTE_TYPE

    def reset_model(self):
        self.model = None
        self.loaded_model_size = ""
        self.loaded_compute_type = ""

    def _run_transcription(self, audio_path: Path, language: str | None) -> Dict[str, Any]:
        if self.model is None:
            raise RuntimeError("Whisper model is not loaded")

        language_label = language or "auto"
        print(
            "Running Faster Whisper transcription: "
            f"model={settings.WHISPER_MODEL_SIZE}, compute={settings.WHISPER_COMPUTE_TYPE}, language={language_label}"
        )

        segments, info = self.model.transcribe(
            str(audio_path),
            beam_size=5,
            language=language,
            task="transcribe",
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
        )

        detected_language = getattr(info, "language", "") or language_label
        language_probability = float(getattr(info, "language_probability", 0) or 0)
        result_segments = []

        for segment in segments:
            result_segments.append({
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
                "duration": segment.end - segment.start
            })

        print(
            "Faster Whisper result: "
            f"requested_language={language_label}, detected_language={detected_language}, "
            f"probability={language_probability:.3f}, segments={len(result_segments)}"
        )

        return {
            "language": detected_language,
            "language_probability": language_probability,
            "segments": result_segments,
        }

    def transcribe(self, audio_path: Path, language: str | None = None) -> Dict[str, Any]:
        """
        Transcribes audio and returns segments with timestamps.
        Defaults are controlled by Settings. For Chinese video, auto_zh_fallback
        auto-detects first, then reruns with zh if detection looks wrong.
        """
        if not audio_path.exists():
            return {"status": "error", "message": f"Audio file not found: {audio_path}"}
            
        try:
            self._load_model()

            language_mode = language or settings.WHISPER_LANGUAGE_MODE
            language_source = language_mode

            if language_mode == "auto_zh_fallback":
                first_pass = self._run_transcription(audio_path, None)
                detected_language = first_pass["language"]
                probability = first_pass["language_probability"]
                should_fallback = (
                    detected_language not in CHINESE_LANGUAGE_CODES
                    or probability < settings.WHISPER_MIN_LANGUAGE_PROBABILITY
                )

                if should_fallback:
                    print(
                        "Faster Whisper fallback: "
                        f"detected_language={detected_language}, probability={probability:.3f}, "
                        f"fallback_language={settings.WHISPER_FALLBACK_LANGUAGE}"
                    )
                    transcription = self._run_transcription(
                        audio_path,
                        settings.WHISPER_FALLBACK_LANGUAGE,
                    )
                    language_source = "zh_fallback"
                else:
                    transcription = first_pass
                    language_source = "auto"
            elif language_mode == "auto":
                transcription = self._run_transcription(audio_path, None)
                language_source = "auto"
            else:
                transcription = self._run_transcription(audio_path, language_mode)
                language_source = "forced"

            return {
                "status": "success",
                "language": transcription["language"],
                "language_probability": transcription["language_probability"],
                "language_source": language_source,
                "model_size": settings.WHISPER_MODEL_SIZE,
                "compute_type": settings.WHISPER_COMPUTE_TYPE,
                "segments": transcription["segments"]
            }
            
        except Exception as e:
            print(f"Transcription failed: {e}")
            return {"status": "error", "message": str(e)}

# Singleton instance
stt_service = STTService()
