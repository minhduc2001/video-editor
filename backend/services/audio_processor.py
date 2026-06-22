import os
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any

from core.config import settings

class AudioProcessor:
    """Service for separating vocals and background music using Demucs"""
    
    @staticmethod
    def extract_audio(video_path: Path, output_audio_path: Path) -> bool:
        """Extracts WAV audio from MP4 using FFmpeg (fast)"""
        if output_audio_path.exists():
            return True
            
        cmd = [
            "ffmpeg", "-y", "-i", str(video_path), 
            "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", 
            str(output_audio_path)
        ]
        
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            return True
        except subprocess.CalledProcessError as e:
            print(f"FFmpeg extraction failed: {e.stderr.decode()}")
            return False

    @staticmethod
    def isolate_vocals(audio_path: Path, output_dir: Path) -> Dict[str, Any]:
        """
        Uses Demucs to split audio into Vocals and No-Vocals (BGM).
        Optimized for machines by using the htdemucs_ft model or running on CPU/GPU.
        """
        # Demucs output structure: output_dir / htdemucs_ft / <filename> / vocals.wav
        base_name = audio_path.stem
        demucs_out = output_dir / "demucs"
        
        expected_vocal_path = demucs_out / settings.DEMUCS_MODEL / base_name / "vocals.wav"
        expected_bgm_path = demucs_out / settings.DEMUCS_MODEL / base_name / "no_vocals.wav"
        
        if expected_vocal_path.exists() and expected_bgm_path.exists():
            print("Vocal isolation already cached.")
            return {
                "status": "success",
                "vocals_path": str(expected_vocal_path),
                "bgm_path": str(expected_bgm_path)
            }
            
        # Command: demucs -n htdemucs_ft --two-stems=vocals -o <output> <input_file>
        demucs_runner = Path(__file__).with_name("demucs_torchcodec_compat.py")
        cmd = [
            sys.executable,
            str(demucs_runner),
            "-n", settings.DEMUCS_MODEL,
            "--two-stems=vocals",
            "-o", str(demucs_out),
            str(audio_path)
        ]
        
        print(f"Running Demucs for vocal isolation: {' '.join(cmd)}")
        try:
            # This is heavy and takes time
            subprocess.run(cmd, check=True)
            
            return {
                "status": "success",
                "vocals_path": str(expected_vocal_path),
                "bgm_path": str(expected_bgm_path)
            }
        except subprocess.CalledProcessError as e:
            print(f"Demucs failed: {e}")
            return {
                "status": "error",
                "message": "Vocal isolation failed. Check if Demucs is installed and RAM is sufficient."
            }
