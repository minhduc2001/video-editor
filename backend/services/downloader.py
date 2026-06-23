import csv
import json
import os
import http.cookiejar
import http.cookies
import io
from pathlib import Path
import re
import shutil
import subprocess
import sys
import yt_dlp
from yt_dlp.cookies import extract_cookies_from_browser
from typing import Dict, Any, Optional

from core.config import settings

class VideoDownloader:
    """Service to handle downloading videos from Douyin/TikTok/Youtube"""

    COOKIE_ERROR_HINT = (
        "Douyin now requires a fresh guest cookie (s_v_web_id), not account login. "
        "Open the video link in the selected browser, let the page fully load, close all "
        "browser windows/background processes so cookies are not locked, then retry. If it still fails, choose "
        "the exact Chrome/Edge profile in Settings > Downloader or use a cookies.txt file."
    )
    CHROME_COOKIE_COPY_HINT = (
        "The browser is locking its cookie database, so yt-dlp cannot read it. Close the "
        "Douyin Session browser window and retry. If you are using Chrome cookies, close "
        "all Chrome windows/background processes or switch to Douyin Session, Cookie Header, "
        "or cookies.txt in Settings > Downloader."
    )

    DOUYIN_LOGIN_URL = "https://www.douyin.com/"
    CHROMIUM_BROWSERS = {"brave", "chrome", "chromium", "edge", "opera", "vivaldi"}
    DOUYIN_REQUIRED_COOKIE = "s_v_web_id"
    DOUYIN_USEFUL_COOKIES = {
        "s_v_web_id",
        "ttwid",
        "msToken",
        "__ac_nonce",
        "__ac_signature",
    }

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
    def _browser_executable(browser: str) -> Optional[str]:
        browser_name = browser.strip().lower()

        if os.name == "nt":
            local_app_data = os.getenv("LOCALAPPDATA", "")
            program_files = os.getenv("PROGRAMFILES", r"C:\Program Files")
            program_files_x86 = os.getenv("PROGRAMFILES(X86)", r"C:\Program Files (x86)")

            candidates = {
                "edge": [
                    shutil.which("msedge"),
                    Path(program_files_x86) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                    Path(program_files) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                ],
                "chrome": [
                    shutil.which("chrome"),
                    Path(program_files) / "Google" / "Chrome" / "Application" / "chrome.exe",
                    Path(program_files_x86) / "Google" / "Chrome" / "Application" / "chrome.exe",
                    Path(local_app_data) / "Google" / "Chrome" / "Application" / "chrome.exe",
                ],
                "firefox": [
                    shutil.which("firefox"),
                    Path(program_files) / "Mozilla Firefox" / "firefox.exe",
                    Path(program_files_x86) / "Mozilla Firefox" / "firefox.exe",
                ],
                "brave": [
                    shutil.which("brave"),
                    Path(program_files) / "BraveSoftware" / "Brave-Browser" / "Application" / "brave.exe",
                    Path(program_files_x86) / "BraveSoftware" / "Brave-Browser" / "Application" / "brave.exe",
                    Path(local_app_data) / "BraveSoftware" / "Brave-Browser" / "Application" / "brave.exe",
                ],
                "chromium": [
                    shutil.which("chromium"),
                    shutil.which("chromium-browser"),
                ],
                "opera": [
                    shutil.which("opera"),
                    Path(local_app_data) / "Programs" / "Opera" / "opera.exe",
                    Path(program_files) / "Opera" / "launcher.exe",
                ],
                "vivaldi": [
                    shutil.which("vivaldi"),
                    Path(program_files) / "Vivaldi" / "Application" / "vivaldi.exe",
                    Path(program_files_x86) / "Vivaldi" / "Application" / "vivaldi.exe",
                    Path(local_app_data) / "Vivaldi" / "Application" / "vivaldi.exe",
                ],
            }.get(browser_name, [])
        elif sys.platform == "darwin":
            candidates = {
                "edge": ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
                "chrome": ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
                "firefox": ["/Applications/Firefox.app/Contents/MacOS/firefox"],
                "brave": ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
                "chromium": ["/Applications/Chromium.app/Contents/MacOS/Chromium"],
                "opera": ["/Applications/Opera.app/Contents/MacOS/Opera"],
                "vivaldi": ["/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"],
            }.get(browser_name, [])
        else:
            candidates = {
                "edge": [shutil.which("microsoft-edge"), shutil.which("msedge")],
                "chrome": [shutil.which("google-chrome"), shutil.which("chrome"), shutil.which("chromium")],
                "firefox": [shutil.which("firefox")],
                "brave": [shutil.which("brave-browser"), shutil.which("brave")],
                "chromium": [shutil.which("chromium"), shutil.which("chromium-browser")],
                "opera": [shutil.which("opera")],
                "vivaldi": [shutil.which("vivaldi")],
            }.get(browser_name, [])

        for candidate in candidates:
            if not candidate:
                continue

            candidate_path = Path(candidate)
            if candidate_path.exists():
                return str(candidate_path)

        return None

    @staticmethod
    def _browser_user_data_dir(browser: str) -> Optional[Path]:
        browser_name = browser.strip().lower()

        if os.name == "nt":
            local_app_data = Path(os.getenv("LOCALAPPDATA", ""))
            app_data = Path(os.getenv("APPDATA", ""))
            candidates = {
                "brave": local_app_data / "BraveSoftware" / "Brave-Browser" / "User Data",
                "chrome": local_app_data / "Google" / "Chrome" / "User Data",
                "chromium": local_app_data / "Chromium" / "User Data",
                "edge": local_app_data / "Microsoft" / "Edge" / "User Data",
                "opera": app_data / "Opera Software" / "Opera Stable",
                "vivaldi": local_app_data / "Vivaldi" / "User Data",
            }.get(browser_name)
        elif sys.platform == "darwin":
            app_data = Path.home() / "Library" / "Application Support"
            candidates = {
                "brave": app_data / "BraveSoftware" / "Brave-Browser",
                "chrome": app_data / "Google" / "Chrome",
                "chromium": app_data / "Chromium",
                "edge": app_data / "Microsoft Edge",
                "opera": app_data / "com.operasoftware.Opera",
                "vivaldi": app_data / "Vivaldi",
            }.get(browser_name)
        else:
            config_home = Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config"))
            candidates = {
                "brave": config_home / "BraveSoftware" / "Brave-Browser",
                "chrome": config_home / "google-chrome",
                "chromium": config_home / "chromium",
                "edge": config_home / "microsoft-edge",
                "opera": config_home / "opera",
                "vivaldi": config_home / "vivaldi",
            }.get(browser_name)

        if not candidates:
            return None

        try:
            return candidates if candidates.exists() else None
        except OSError:
            return candidates

    @staticmethod
    def _browser_process_names(browser: str) -> list[str]:
        browser_name = browser.strip().lower()
        return {
            "brave": ["brave.exe", "brave-browser.exe", "brave"],
            "chrome": ["chrome.exe", "chrome", "google-chrome"],
            "chromium": ["chromium.exe", "chromium", "chromium-browser"],
            "edge": ["msedge.exe", "microsoft-edge", "msedge"],
            "firefox": ["firefox.exe", "firefox"],
            "opera": ["opera.exe", "launcher.exe", "opera"],
            "vivaldi": ["vivaldi.exe", "vivaldi"],
        }.get(browser_name, [f"{browser_name}.exe", browser_name])

    @staticmethod
    def is_browser_running(browser: str) -> bool:
        process_names = VideoDownloader._browser_process_names(browser)

        try:
            if os.name == "nt":
                for process_name in process_names:
                    if not process_name.endswith(".exe"):
                        continue
                    result = subprocess.run(
                        ["tasklist", "/FI", f"IMAGENAME eq {process_name}", "/FO", "CSV", "/NH"],
                        capture_output=True,
                        text=True,
                        timeout=4,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    )
                    rows = list(csv.reader(io.StringIO(result.stdout)))
                    if any(row and row[0].strip('"').lower() == process_name.lower() for row in rows):
                        return True
                return False

            for process_name in process_names:
                result = subprocess.run(
                    ["pgrep", "-x", process_name],
                    capture_output=True,
                    text=True,
                    timeout=4,
                )
                if result.returncode == 0:
                    return True
        except Exception as exc:
            print(f"Could not check browser process state: {exc}")

        return False

    @staticmethod
    def list_browser_profiles(browser: str = "chrome") -> Dict[str, Any]:
        browser_name = (browser or "chrome").strip().lower()
        user_data_dir = VideoDownloader._browser_user_data_dir(browser_name)
        if not user_data_dir:
            return {
                "browser": browser_name,
                "user_data_dir": "",
                "profiles": [],
            }

        info_cache: Dict[str, Any] = {}
        last_used = ""
        local_state_path = user_data_dir / "Local State"
        try:
            has_local_state = local_state_path.exists()
        except OSError:
            has_local_state = False

        if has_local_state:
            try:
                local_state = json.loads(local_state_path.read_text(encoding="utf-8"))
                profile_state = local_state.get("profile", {})
                info_cache = profile_state.get("info_cache", {}) or {}
                last_used = str(profile_state.get("last_used", "") or "")
            except Exception as exc:
                print(f"Could not read browser Local State: {exc}")

        profile_ids = set(info_cache.keys())
        try:
            profile_dirs = list(user_data_dir.iterdir())
        except OSError as exc:
            print(f"Could not list browser profiles: {exc}")
            profile_dirs = []

        for child in profile_dirs:
            try:
                has_cookies = child.is_dir() and list(child.rglob("Cookies"))
            except OSError:
                has_cookies = False

            if has_cookies and (child.name == "Default" or child.name.startswith("Profile ")):
                profile_ids.add(child.name)

        def sort_key(profile_id: str) -> tuple[int, str]:
            if profile_id == last_used:
                return (0, profile_id)
            if profile_id == "Default":
                return (1, profile_id)
            return (2, profile_id)

        profiles = []
        for profile_id in sorted(profile_ids, key=sort_key):
            profile_info = info_cache.get(profile_id, {}) if isinstance(info_cache, dict) else {}
            profiles.append({
                "id": profile_id,
                "name": profile_info.get("name") or profile_id,
                "path": str(user_data_dir / profile_id),
                "is_last_used": profile_id == last_used,
            })

        return {
            "browser": browser_name,
            "user_data_dir": str(user_data_dir),
            "profiles": profiles,
        }

    @staticmethod
    def open_cookie_browser(browser: str = "chrome", url: str = "") -> Dict[str, Any]:
        browser_name = (browser or "chrome").strip().lower()
        executable = VideoDownloader._browser_executable(browser_name)
        if not executable:
            return {
                "status": "error",
                "message": f"Could not find {browser_name}. Install it or choose another browser.",
            }

        target_url = url.strip() if url.strip().startswith(("http://", "https://")) else VideoDownloader.DOUYIN_LOGIN_URL

        subprocess.Popen(
            [executable, target_url],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )

        return {
            "status": "opened",
            "browser": browser_name,
            "opened_url": target_url,
            "message": (
                f"Opened your normal {browser_name} profile. Let Douyin load there, "
                f"then close all {browser_name} windows/background processes before downloading so yt-dlp can read cookies."
            ),
        }

    @staticmethod
    def open_douyin_session(browser: str = "edge", url: str = "") -> Dict[str, Any]:
        browser_name = (browser or "edge").strip().lower()
        if browser_name not in {"edge", "chrome"}:
            return {
                "status": "error",
                "message": "Douyin Session currently supports Edge or Chrome.",
            }

        executable = VideoDownloader._browser_executable(browser_name)
        if not executable:
            return {
                "status": "error",
                "message": f"Could not find {browser_name}. Install it or choose another session browser.",
            }

        user_data_dir = settings.downloader_session_user_data_dir(browser_name)
        profile_dir = settings.downloader_session_profile_dir(browser_name)
        user_data_dir.mkdir(parents=True, exist_ok=True)

        target_url = url.strip() if url.strip().startswith(("http://", "https://")) else VideoDownloader.DOUYIN_LOGIN_URL

        command = [
            executable,
            f"--user-data-dir={user_data_dir}",
            "--profile-directory=Default",
            "--no-first-run",
            "--disable-features=Translate",
            target_url,
        ]

        subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )

        return {
            "status": "opened",
            "browser": browser_name,
            "profile_path": str(profile_dir),
            "opened_url": target_url,
            "message": "Let the Douyin page fully load so it creates guest cookies, then close that browser window/background process before downloading.",
        }

    @staticmethod
    def douyin_session_status(browser: str = "edge") -> Dict[str, Any]:
        browser_name = (browser or settings.DOWNLOADER_SESSION_BROWSER or "edge").strip().lower()
        profile_dir = settings.downloader_session_profile_dir(browser_name)
        cookie_files = list(profile_dir.rglob("Cookies")) if profile_dir.exists() else []

        return {
            "browser": browser_name,
            "profile_path": str(profile_dir),
            "has_cookie_database": bool(cookie_files),
            "cookie_database": str(cookie_files[0]) if cookie_files else "",
        }

    @staticmethod
    def _resolve_browser_profile(browser: str) -> tuple[str, str]:
        profile = (settings.DOWNLOADER_BROWSER_PROFILE or "").strip()
        if profile:
            return profile, "configured"

        profiles = VideoDownloader.list_browser_profiles(browser).get("profiles", [])
        last_used_profile = next(
            (item.get("id") for item in profiles if item.get("is_last_used")),
            "",
        )
        if last_used_profile:
            return str(last_used_profile), "last_used"

        return "", "auto"

    @staticmethod
    def _summarize_cookie_names(cookie_names: set[str], source: str, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        found_useful = sorted(cookie_names.intersection(VideoDownloader.DOUYIN_USEFUL_COOKIES))
        has_required = VideoDownloader.DOUYIN_REQUIRED_COOKIE in cookie_names
        status = "ok" if has_required else "missing_required_cookie"

        result = {
            "status": status,
            "source": source,
            "has_s_v_web_id": has_required,
            "useful_cookie_names": found_useful,
            "douyin_cookie_name_count": len(cookie_names),
        }
        if extra:
            result.update(extra)
        return result

    @staticmethod
    def _summarize_cookie_jar(cookie_jar: http.cookiejar.CookieJar, source: str, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        douyin_cookie_names = {
            cookie.name
            for cookie in cookie_jar
            if "douyin.com" in (cookie.domain or "")
        }
        domains = sorted({
            cookie.domain
            for cookie in cookie_jar
            if "douyin.com" in (cookie.domain or "")
        })
        return VideoDownloader._summarize_cookie_names(
            douyin_cookie_names,
            source,
            {
                "douyin_cookie_domains": domains,
                **(extra or {}),
            },
        )

    @staticmethod
    def cookie_diagnostics() -> Dict[str, Any]:
        cookie_mode = (settings.DOWNLOADER_COOKIE_MODE or "none").strip().lower()
        base = {
            "cookie_mode": cookie_mode,
        }

        try:
            if cookie_mode == "browser":
                browser = (settings.DOWNLOADER_COOKIES_FROM_BROWSER or "chrome").strip().lower()
                profile, profile_source = VideoDownloader._resolve_browser_profile(browser)
                browser_running = VideoDownloader.is_browser_running(browser)
                cookie_jar = extract_cookies_from_browser(browser, profile or None)
                return VideoDownloader._summarize_cookie_jar(
                    cookie_jar,
                    "browser",
                    {
                        **base,
                        "browser": browser,
                        "profile": profile,
                        "profile_source": profile_source,
                        "browser_running": browser_running,
                    },
                )

            if cookie_mode == "session":
                browser = (settings.DOWNLOADER_SESSION_BROWSER or "edge").strip().lower()
                profile_dir = settings.downloader_session_profile_dir(browser)
                cookie_jar = extract_cookies_from_browser(browser, str(profile_dir))
                return VideoDownloader._summarize_cookie_jar(
                    cookie_jar,
                    "session",
                    {
                        **base,
                        "browser": browser,
                        "profile": str(profile_dir),
                    },
                )

            if cookie_mode == "file":
                cookies_file = Path(settings.DOWNLOADER_COOKIES_FILE or "").expanduser()
                if not cookies_file.exists() or not cookies_file.is_file():
                    return {
                        **base,
                        "status": "error",
                        "source": "file",
                        "message": f"Cookies file was not found: {cookies_file}",
                    }

                cookie_jar = http.cookiejar.MozillaCookieJar(str(cookies_file))
                cookie_jar.load(ignore_discard=True, ignore_expires=True)
                return VideoDownloader._summarize_cookie_jar(
                    cookie_jar,
                    "file",
                    {
                        **base,
                        "cookies_file": str(cookies_file),
                    },
                )

            if cookie_mode == "header":
                cookie_header = (settings.DOWNLOADER_COOKIE_HEADER or "").strip()
                if cookie_header.lower().startswith("cookie:"):
                    cookie_header = cookie_header.split(":", 1)[1].strip()
                parsed_cookie = http.cookies.SimpleCookie()
                parsed_cookie.load(cookie_header)
                cookie_names = set(parsed_cookie.keys())
                return VideoDownloader._summarize_cookie_names(
                    cookie_names,
                    "header",
                    base,
                )

            return {
                **base,
                "status": "disabled",
                "source": "none",
                "message": "Downloader cookie mode is disabled.",
            }
        except Exception as exc:
            message = VideoDownloader._clean_error_message(exc)
            lower_message = message.lower()
            reason = "browser_cookie_database_locked" if (
                "could not copy" in lower_message and "cookie" in lower_message
                or "permission denied" in lower_message and "cookie" in lower_message
            ) else "cookie_read_failed"
            return {
                **base,
                "status": "error",
                "source": cookie_mode,
                "reason": reason,
                "message": message,
            }

    @staticmethod
    def format_cookie_diagnostics(diagnostics: Dict[str, Any]) -> str:
        status = diagnostics.get("status", "unknown")
        mode = diagnostics.get("cookie_mode", "unknown")
        source = diagnostics.get("source", "unknown")
        browser = diagnostics.get("browser", "")
        profile = diagnostics.get("profile", "")
        browser_running = diagnostics.get("browser_running")
        has_s_v_web_id = diagnostics.get("has_s_v_web_id")
        useful_names = diagnostics.get("useful_cookie_names", [])
        message = diagnostics.get("message", "")

        parts = [f"mode={mode}", f"source={source}", f"status={status}"]
        if browser:
            parts.append(f"browser={browser}")
        if profile:
            parts.append(f"profile={profile}")
        if browser_running is not None:
            parts.append(f"browser_running={'yes' if browser_running else 'no'}")
        if has_s_v_web_id is not None:
            parts.append(f"s_v_web_id={'yes' if has_s_v_web_id else 'no'}")
        if useful_names:
            parts.append(f"found={', '.join(useful_names)}")
        if message:
            parts.append(f"message={message}")
        return "; ".join(parts)

    @staticmethod
    def _is_cookie_error(error: Exception) -> bool:
        message = str(error).lower()
        return (
            "fresh cookies" in message
            or "could not copy" in message and "cookie" in message
            or "could not copy chrome cookie database" in message
            or ("permission denied" in message and "cookies" in message)
            or ("cookies" in message and "needed" in message)
        )

    @staticmethod
    def _clean_error_message(error: Exception) -> str:
        message = str(error)
        message = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", message)
        return message.strip()

    @staticmethod
    def _apply_cookie_settings(ydl_opts: Dict[str, Any]) -> None:
        cookie_mode = (settings.DOWNLOADER_COOKIE_MODE or "none").strip().lower()

        if cookie_mode == "browser":
            browser = (settings.DOWNLOADER_COOKIES_FROM_BROWSER or "").strip().lower()
            if not browser:
                raise ValueError("Downloader cookie mode is Browser but no browser was selected.")

            profile, profile_source = VideoDownloader._resolve_browser_profile(browser)
            if os.name == "nt" and browser in VideoDownloader.CHROMIUM_BROWSERS and VideoDownloader.is_browser_running(browser):
                raise ValueError(
                    f"{browser} is still running, so Windows may lock the cookie database. "
                    f"Close all {browser} windows/background processes, then retry. "
                    "If you need to keep the browser open, use Cookie Header or cookies.txt in Settings > Downloader."
                )

            ydl_opts["cookiesfrombrowser"] = (browser, profile) if profile else (browser,)
            print(f"yt-dlp will load cookies from browser: {browser}{f' ({profile}, {profile_source})' if profile else ''}")
            return

        if cookie_mode == "session":
            browser = (settings.DOWNLOADER_SESSION_BROWSER or "edge").strip().lower()
            profile_dir = settings.downloader_session_profile_dir(browser)
            if not profile_dir.exists() or not list(profile_dir.rglob("Cookies")):
                raise ValueError(
                    "Douyin Session cookies were not found. Open Settings > Downloader, "
                    "click Open Douyin Session, let Douyin fully load, close that browser window/background process, then retry."
                )

            ydl_opts["cookiesfrombrowser"] = (browser, str(profile_dir))
            print(f"yt-dlp will load Douyin Session cookies from: {profile_dir}")
            return

        if cookie_mode == "file":
            cookies_file = Path(settings.DOWNLOADER_COOKIES_FILE or "").expanduser()
            if not cookies_file.exists() or not cookies_file.is_file():
                raise ValueError(f"Cookies file was not found: {cookies_file}")

            ydl_opts["cookiefile"] = str(cookies_file)
            print(f"yt-dlp will load cookies from file: {cookies_file}")
            return

        if cookie_mode == "header":
            cookie_header = (settings.DOWNLOADER_COOKIE_HEADER or "").strip()
            if cookie_header.lower().startswith("cookie:"):
                cookie_header = cookie_header.split(":", 1)[1].strip()
            if not cookie_header:
                raise ValueError("Downloader cookie mode is Cookie Header but the cookie value is empty.")

            ydl_opts.setdefault("http_headers", {})["Cookie"] = cookie_header
            print("yt-dlp will use a manual Cookie header.")
    
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
            VideoDownloader._apply_cookie_settings(ydl_opts)
        except ValueError as error:
            return {
                "status": "error",
                "message": str(error),
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
            message = VideoDownloader._clean_error_message(e)
            if VideoDownloader._is_cookie_error(e):
                hint = (
                    VideoDownloader.CHROME_COOKIE_COPY_HINT
                    if "could not copy chrome cookie database" in message.lower()
                    else VideoDownloader.COOKIE_ERROR_HINT
                )
                diagnostics = VideoDownloader.cookie_diagnostics()
                diagnostics_text = VideoDownloader.format_cookie_diagnostics(diagnostics)
                message = f"{message}\n\n{hint}\n\nCookie diagnostics: {diagnostics_text}"
            return {
                "status": "error",
                "message": message
            }
