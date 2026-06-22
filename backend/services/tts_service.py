import os
import asyncio
import subprocess
from pathlib import Path
from typing import Dict, Any, List
import requests
import edge_tts

from core.config import settings
from services.ai_debug import log_ai_failure, log_ai_start, log_ai_success

class TTSService:
    """Service to generate Text-to-Speech and stretch audio to match original timing"""
    OPENAI_TTS_MODEL = "gpt-4o-mini-tts"
    _vieneu_local_client = None
    _vieneu_remote_clients: Dict[str, Any] = {}
    OPENAI_VOICE_INSTRUCTIONS = {
        "marin": "Speak Vietnamese naturally with a warm, clear, conversational tone. Keep the pacing steady and suitable for short video narration.",
        "cedar": "Speak Vietnamese naturally with a calm, confident narrator tone. Keep pronunciation clear and the delivery grounded.",
        "coral": "Speak Vietnamese with a friendly, bright, expressive tone. Keep the energy pleasant but not exaggerated.",
        "verse": "Speak Vietnamese with a smooth, youthful, social-video narration style. Keep it natural and lightly expressive.",
        "nova": "Speak Vietnamese clearly with a modern female narrator style. Keep the cadence natural and easy to listen to.",
        "shimmer": "Speak Vietnamese with a soft, polished, gentle narrator tone. Keep the delivery clean and relaxed.",
    }

    @staticmethod
    def _get_openai_api_key() -> str:
        return settings.OPENAI_API_KEY or os.getenv("OPENAI_API_KEY") or (
            settings.TRANSLATION_API_KEY
            if settings.TRANSLATION_PROVIDER == "openai"
            else ""
        )

    @staticmethod
    def _parse_openai_voice(voice: str) -> str | None:
        if not voice.startswith("openai:"):
            return None

        return voice.split(":", 1)[1].strip() or None

    @staticmethod
    def _parse_vieneu_voice(voice: str) -> str | None:
        if not voice.startswith("vieneu:"):
            return None

        parsed_voice = voice.split(":", 1)[1].strip()
        return parsed_voice or "Bình An"

    @staticmethod
    def generate_openai_speech(text: str, voice: str, output_path: Path) -> bool:
        api_key = TTSService._get_openai_api_key()
        if not api_key:
            print(
                "[AI API] failure "
                "{\"provider\":\"openai\",\"action\":\"tts\",\"error\":\"missing OpenAI API key. Set it in Settings or OPENAI_API_KEY.\"}"
            )
            return False

        url = "https://api.openai.com/v1/audio/speech"
        start_time = log_ai_start(
            "openai",
            "tts",
            "POST",
            url,
            model=TTSService.OPENAI_TTS_MODEL,
            extra={"voice": voice, "input_chars": len(text)},
        )

        response: requests.Response | None = None

        try:
            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": TTSService.OPENAI_TTS_MODEL,
                    "voice": voice,
                    "input": text,
                    "instructions": TTSService.OPENAI_VOICE_INSTRUCTIONS.get(
                        voice,
                        "Speak Vietnamese naturally with clear pronunciation and a conversational tone.",
                    ),
                    "response_format": "mp3",
                },
                timeout=120,
            )
            response.raise_for_status()
            output_path.write_bytes(response.content)
            log_ai_success(
                "openai",
                "tts",
                start_time,
                status_code=response.status_code,
                model=TTSService.OPENAI_TTS_MODEL,
                extra={
                    "voice": voice,
                    "input_chars": len(text),
                    "output_bytes": len(response.content),
                },
            )
            return True
        except Exception as e:
            log_ai_failure(
                "openai",
                "tts",
                start_time,
                e,
                url=url,
                model=TTSService.OPENAI_TTS_MODEL,
                response=response or getattr(e, "response", None),
                extra={"voice": voice, "input_chars": len(text)},
            )
            return False

    @staticmethod
    def _get_vieneu_local_client():
        if TTSService._vieneu_local_client is not None:
            return TTSService._vieneu_local_client

        try:
            from vieneu import Vieneu
        except Exception as e:
            raise RuntimeError(
                "VieNeu SDK is not installed. Install it with: "
                "backend\\venv\\Scripts\\python.exe -m pip install vieneu"
            ) from e

        TTSService._vieneu_local_client = Vieneu()
        return TTSService._vieneu_local_client

    @staticmethod
    def _get_vieneu_remote_client(api_base: str):
        cache_key = f"{api_base}|{settings.VIENEU_MODEL_ID}"
        if cache_key in TTSService._vieneu_remote_clients:
            return TTSService._vieneu_remote_clients[cache_key]

        try:
            from vieneu import Vieneu
        except Exception as e:
            raise RuntimeError(
                "VieNeu SDK is not installed. Install it with: "
                "backend\\venv\\Scripts\\python.exe -m pip install vieneu"
            ) from e

        client = Vieneu(
            mode="remote",
            api_base=api_base,
            model_name=settings.VIENEU_MODEL_ID,
            emotion="natural",
        )
        TTSService._vieneu_remote_clients[cache_key] = client
        return client

    @staticmethod
    def generate_vieneu_speech(text: str, voice: str, output_path: Path) -> bool:
        provider = "vieneu_remote" if settings.VIENEU_API_URL else "vieneu_local"
        start_time = log_ai_start(
            provider,
            "tts",
            "SDK",
            settings.VIENEU_API_URL or "local",
            model=settings.VIENEU_MODEL_ID,
            extra={"voice": voice, "input_chars": len(text)},
        )

        try:
            if settings.VIENEU_API_URL:
                client = TTSService._get_vieneu_remote_client(settings.VIENEU_API_URL)
            else:
                client = TTSService._get_vieneu_local_client()

            infer_voice = voice
            if settings.VIENEU_API_URL and voice:
                try:
                    infer_voice = client.get_preset_voice(voice)
                except Exception:
                    infer_voice = voice

            audio = client.infer(text=text, voice=infer_voice)
            client.save(audio, str(output_path))
            success = output_path.exists()
            if success:
                log_ai_success(
                    provider,
                    "tts",
                    start_time,
                    model=settings.VIENEU_MODEL_ID,
                    extra={
                        "voice": voice,
                        "input_chars": len(text),
                        "output_path": str(output_path),
                    },
                )
            else:
                log_ai_failure(
                    provider,
                    "tts",
                    start_time,
                    RuntimeError("VieNeu did not create output file"),
                    url=settings.VIENEU_API_URL or "local",
                    model=settings.VIENEU_MODEL_ID,
                    extra={"voice": voice, "input_chars": len(text), "output_path": str(output_path)},
                )
            return success
        except Exception as e:
            log_ai_failure(
                provider,
                "tts",
                start_time,
                e,
                url=settings.VIENEU_API_URL or "local",
                model=settings.VIENEU_MODEL_ID,
                extra={"voice": voice, "input_chars": len(text)},
            )
            return False
    
    @staticmethod
    async def generate_speech(text: str, voice: str, output_path: Path) -> bool:
        """Generates TTS using Microsoft Edge TTS API"""
        openai_voice = TTSService._parse_openai_voice(voice)
        if openai_voice:
            return TTSService.generate_openai_speech(text, openai_voice, output_path)

        vieneu_voice = TTSService._parse_vieneu_voice(voice)
        if vieneu_voice:
            return TTSService.generate_vieneu_speech(text, vieneu_voice, output_path)

        try:
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(str(output_path))
            return True
        except Exception as e:
            print(f"TTS generation failed: {e}")
            return False

    @staticmethod
    def get_audio_duration(audio_path: Path) -> float:
        """Gets duration of an audio file using FFprobe"""
        cmd = [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration", "-of",
            "default=noprint_wrappers=1:nokey=1", str(audio_path)
        ]
        try:
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            return float(result.stdout.strip())
        except Exception as e:
            print(f"Failed to get duration: {e}")
            return 0.0

    @staticmethod
    def stretch_audio(input_path: Path, output_path: Path, target_duration: float) -> bool:
        """
        Uses FFmpeg's atempo filter to change speed so the audio exactly matches target_duration.
        atempo is limited to 0.5x - 100.0x in newer FFmpeg, but typically 0.5 to 2.0.
        If we need extreme stretching, we chain atempo filters.
        """
        current_duration = TTSService.get_audio_duration(input_path)
        if current_duration <= 0 or target_duration <= 0:
            return False
            
        ratio = current_duration / target_duration
        
        # Limit ratio to avoid extreme chipmunk/slowmo distortion (e.g. 0.8x to 1.5x is reasonable)
        # But for exact matching, we apply the exact ratio.
        # If ratio > 2.0 or < 0.5, we'd need to chain atempo filters.
        # For simplicity, we assume one filter is enough (0.5 - 2.0 bounds).
        ratio = max(0.5, min(ratio, 2.0))
        
        cmd = [
            "ffmpeg", "-y", "-i", str(input_path),
            "-filter:a", f"atempo={ratio}",
            str(output_path)
        ]
        
        try:
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            return True
        except Exception as e:
            print(f"Audio stretch failed: {e}")
            return False

    @staticmethod
    async def process_segments(segments: List[Dict[str, Any]], voice: str, output_dir: Path) -> List[Dict[str, Any]]:
        """
        Generates TTS for all segments, stretches them to match their original duration,
        and saves them in the output directory.
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        
        processed_segments = []
        for i, seg in enumerate(segments):
            text = str(seg.get("translated_text") or seg.get("text") or "").strip()
            target_duration = float(seg.get("duration") or max(0.2, float(seg.get("end", 0)) - float(seg.get("start", 0))))

            if not text:
                continue
            
            # Temporary paths
            raw_suffix = "wav" if voice.startswith("vieneu:") else "mp3"
            raw_audio = output_dir / f"seg_{i}_raw.{raw_suffix}"
            stretched_audio = output_dir / f"seg_{i}_final.wav"
            
            # 1. Generate TTS
            success = await TTSService.generate_speech(text, voice, raw_audio)
            if not success:
                continue
                
            # 2. Stretch to match exact target duration
            stretch_success = TTSService.stretch_audio(raw_audio, stretched_audio, target_duration)
            
            if stretch_success:
                # Add audio path back to segment
                seg["dub_audio_path"] = str(stretched_audio)
                processed_segments.append(seg)
                
            # Optional: Clean up raw audio
            if raw_audio.exists():
                raw_audio.unlink()
                
        return processed_segments
