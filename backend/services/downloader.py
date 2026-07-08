from __future__ import annotations
from pathlib import Path
import re
from typing import Any, Dict, Optional
from urllib.parse import unquote

import requests

from core.config import settings


class VideoDownloader:
    """Download Douyin/TikTok videos through the configured self-hosted API."""

    DEFAULT_TIMEOUT_SECONDS = 180
    STREAM_CHUNK_SIZE = 1024 * 1024
    BROWSER_HEADERS = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
        ),
    }

    @staticmethod
    def _api_base_url() -> str:
        base_url = (settings.DOWNLOADER_API_BASE_URL or "").strip().rstrip("/")
        if not base_url:
            raise ValueError(
                "Downloader API URL is not configured. Open Settings > Downloader "
                "and enter the base URL of your download server."
            )

        if not base_url.startswith(("http://", "https://")):
            raise ValueError("Downloader API URL must start with http:// or https://")

        return base_url

    @staticmethod
    def _endpoint(path: str) -> str:
        return f"{VideoDownloader._api_base_url()}/{path.lstrip('/')}"

    @staticmethod
    def _clean_error_message(error: Exception) -> str:
        message = str(error)
        message = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", message)
        return message.strip()

    @staticmethod
    def _response_error(response: requests.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            payload = response.text.strip()

        if isinstance(payload, dict):
            detail = payload.get("detail") or payload.get("message") or payload.get("error")
            if isinstance(detail, list):
                return "; ".join(str(item) for item in detail)
            if detail:
                return str(detail)

        if payload:
            return str(payload)

        return response.reason or f"HTTP {response.status_code}"

    @staticmethod
    def _parse_content_disposition_filename(header_value: str) -> str:
        if not header_value:
            return ""

        filename_star = re.search(r"filename\*=UTF-8''([^;]+)", header_value, re.IGNORECASE)
        if filename_star:
            return Path(unquote(filename_star.group(1).strip().strip('"'))).name

        filename = re.search(r'filename="?([^";]+)"?', header_value, re.IGNORECASE)
        if filename:
            return Path(filename.group(1).strip()).name

        return ""

    @staticmethod
    def _sanitize_title(value: str, fallback: str) -> str:
        clean = re.sub(r"[^\w\-.() ]+", "_", value, flags=re.UNICODE).strip(" ._")
        return clean[:120] or fallback

    @staticmethod
    def _parse_video(url: str) -> Dict[str, Any]:
        response = requests.post(
            VideoDownloader._endpoint("/api/parse"),
            json={"url": url},
            headers=VideoDownloader.BROWSER_HEADERS,
            timeout=60,
        )

        if not response.ok:
            raise ValueError(f"Downloader parse failed: {VideoDownloader._response_error(response)}")

        try:
            payload = response.json()
        except ValueError as exc:
            raise ValueError("Downloader parse returned invalid JSON.") from exc

        if payload.get("success") is False:
            raise ValueError(payload.get("error") or "Downloader parse failed.")

        data = payload.get("data") if isinstance(payload, dict) else None
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _write_stream_response(response: requests.Response, output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = output_path.with_suffix(f"{output_path.suffix}.part")

        with temp_path.open("wb") as output_file:
            for chunk in response.iter_content(chunk_size=VideoDownloader.STREAM_CHUNK_SIZE):
                if chunk:
                    output_file.write(chunk)

        if temp_path.stat().st_size <= 0:
            temp_path.unlink(missing_ok=True)
            raise ValueError("Downloader API returned an empty video file.")

        temp_path.replace(output_path)

    @staticmethod
    def _download_from_direct_url(video_url: str, output_path: Path) -> None:
        if not video_url:
            raise ValueError("Downloader parse did not return a video_url.")

        response = requests.get(
            video_url,
            stream=True,
            timeout=VideoDownloader.DEFAULT_TIMEOUT_SECONDS,
            headers={
                **VideoDownloader.BROWSER_HEADERS,
                "Referer": "https://www.douyin.com/",
            },
        )
        if not response.ok:
            raise ValueError(f"Direct video download failed: {VideoDownloader._response_error(response)}")

        VideoDownloader._write_stream_response(response, output_path)

    @staticmethod
    def _download_via_api(url: str, output_path: Path) -> Optional[str]:
        response = requests.post(
            VideoDownloader._endpoint("/api/download"),
            json={"url": url},
            headers=VideoDownloader.BROWSER_HEADERS,
            stream=True,
            timeout=VideoDownloader.DEFAULT_TIMEOUT_SECONDS,
        )

        if response.status_code in {404, 405}:
            response.close()
            response = requests.get(
                VideoDownloader._endpoint("/api/download"),
                params={"url": url},
                headers=VideoDownloader.BROWSER_HEADERS,
                stream=True,
                timeout=VideoDownloader.DEFAULT_TIMEOUT_SECONDS,
            )

        if not response.ok:
            raise ValueError(f"Downloader API download failed: {VideoDownloader._response_error(response)}")

        content_type = response.headers.get("content-type", "").lower()
        if "application/json" in content_type:
            try:
                payload = response.json()
            finally:
                response.close()

            if isinstance(payload, dict):
                if payload.get("success") is False:
                    raise ValueError(payload.get("error") or "Downloader API download failed.")

                data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
                direct_url = data.get("video_url") or data.get("download_url") or data.get("url")
                if direct_url:
                    VideoDownloader._download_from_direct_url(str(direct_url), output_path)
                    return str(direct_url)

            raise ValueError("Downloader API returned JSON but no downloadable video URL.")

        content_disposition = response.headers.get("content-disposition", "")
        filename = VideoDownloader._parse_content_disposition_filename(content_disposition)
        VideoDownloader._write_stream_response(response, output_path)
        return filename

    @staticmethod
    def download_video(url: str, output_dir: Path, custom_name: str = "original") -> Dict[str, Any]:
        """Download a video through the configured self-hosted downloader API."""
        video_path = output_dir / f"{custom_name}.mp4"

        if video_path.exists():
            return {
                "status": "success",
                "video_path": str(video_path),
                "cached": True,
            }

        try:
            video_info: Dict[str, Any] = {}
            parse_error = ""
            try:
                video_info = VideoDownloader._parse_video(url)
            except Exception as exc:
                parse_error = VideoDownloader._clean_error_message(exc)
                print(f"Downloader parse warning: {parse_error}")

            direct_url = str(video_info.get("video_url") or "").strip()
            if direct_url:
                print("Downloader using parsed no-watermark video_url.")
                VideoDownloader._download_from_direct_url(direct_url, video_path)
                downloaded_name = direct_url
            else:
                print("Downloader parse did not return video_url; falling back to /api/download.")
                downloaded_name = VideoDownloader._download_via_api(url, video_path)
            title = str(
                video_info.get("title")
                or downloaded_name
                or video_info.get("video_id")
                or video_path.stem
            )

            return {
                "status": "success",
                "title": VideoDownloader._sanitize_title(title, video_path.stem),
                "duration": video_info.get("duration") or 0,
                "width": 0,
                "height": 0,
                "video_path": str(video_path),
                "cached": False,
                "platform": video_info.get("platform", ""),
                "strategy_used": video_info.get("strategy_used", ""),
                "parse_warning": parse_error,
            }
        except Exception as exc:
            message = VideoDownloader._clean_error_message(exc)
            print(f"Downloader API failed: {message}")
            return {
                "status": "error",
                "message": message,
            }
