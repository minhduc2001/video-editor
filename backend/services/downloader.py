import os
from pathlib import Path
import yt_dlp
from typing import Dict, Any, Optional

class VideoDownloader:
    """Service to handle downloading videos from Douyin/TikTok/Youtube"""

    @staticmethod
    def _find_downloaded_video(output_dir: Path, custom_name: str) -> Path:
        preferred_path = output_dir / f"{custom_name}.mp4"
        if preferred_path.exists():
            return preferred_path

        candidates = sorted(
            output_dir.glob(f"{custom_name}.*"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for candidate in candidates:
            if candidate.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm", ".m4v"}:
                return candidate

        return preferred_path
    
    @staticmethod
    def download_video(url: str, output_dir: Path, custom_name: str = "original") -> Dict[str, Any]:
        """
        Downloads a video and returns the path to the video and extracted audio.
        Optimized to download the best quality video.
        """
        video_path = output_dir / f"{custom_name}.mp4"
        
        # If the file already exists (e.g. cached/restarted task), return it
        if video_path.exists():
            print(f"Video already exists at {video_path}")
            return {
                "status": "success", 
                "video_path": str(video_path),
                "cached": True
            }

        ydl_opts = {
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': str(output_dir / f"{custom_name}.%(ext)s"),
            'merge_output_format': 'mp4',
            'quiet': False,
            'no_warnings': True,
            # Workaround for TikTok/Douyin anti-scraping
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-us,en;q=0.5',
                'Sec-Fetch-Mode': 'navigate',
            }
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = info.get('title', 'Unknown Title')
                duration = info.get('duration', 0)
                downloaded_path = VideoDownloader._find_downloaded_video(output_dir, custom_name)
                
                return {
                    "status": "success",
                    "title": title,
                    "duration": duration,
                    "width": info.get("width") or 0,
                    "height": info.get("height") or 0,
                    "video_path": str(downloaded_path),
                    "cached": False
                }
        except Exception as e:
            print(f"Download failed: {e}")
            return {
                "status": "error",
                "message": str(e)
            }
