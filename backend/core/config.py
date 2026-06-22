import json
import os
import shutil
from pathlib import Path
from typing import Any, Dict

# --- DIRECTORY CONFIGURATION ---
BASE_DIR = Path(__file__).resolve().parent.parent
TEMP_DIR = BASE_DIR / "temp_projects"
MODELS_DIR = BASE_DIR / "models"
OUTPUT_DIR = BASE_DIR / "output"
USER_SETTINGS_PATH = BASE_DIR / "user_settings.json"

TRANSLATION_DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "gemini": "gemini-1.5-flash",
    "deepseek": "deepseek-chat",
    "9router": "cc/claude-opus-4-6",
    "google_free": "",
}
TRANSLATION_PROVIDERS = set(TRANSLATION_DEFAULT_MODELS)

def coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)

# Create directories if they don't exist
for d in [TEMP_DIR, MODELS_DIR, OUTPUT_DIR]:
    d.mkdir(parents=True, exist_ok=True)

class Settings:
    PROJECT_NAME: str = "Video Dubbing AI Pro"
    
    # Path settings
    TEMP_DIR: Path = TEMP_DIR
    MODELS_DIR: Path = MODELS_DIR
    OUTPUT_DIR: Path = OUTPUT_DIR
    
    # --- TRANSLATION CONFIGURATION ---
    # User can set API Key via UI, which will be stored in a local SQLite DB or .env
    # For now, we simulate settings.
    TRANSLATION_API_KEY: str = os.getenv("TRANSLATION_API_KEY", "")
    TRANSLATION_PROVIDER: str = os.getenv("TRANSLATION_PROVIDER", "google_free")
    TRANSLATION_MODEL: str = os.getenv("TRANSLATION_MODEL", "")
    TRANSLATION_BASE_URL: str = os.getenv("TRANSLATION_BASE_URL", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    VIENEU_API_URL: str = os.getenv("VIENEU_API_URL", "")
    VIENEU_MODEL_ID: str = os.getenv("VIENEU_MODEL_ID", "pnnbao-ump/VieNeu-TTS-v2")
    ENABLE_FALLBACK: bool = True # Fallback to google_free if API key fails or runs out of credit

    # --- TELEGRAM NOTIFICATIONS ---
    TELEGRAM_ENABLED: bool = os.getenv("TELEGRAM_ENABLED", "").lower() in {"1", "true", "yes", "on"}
    TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    TELEGRAM_CHAT_ID: str = os.getenv("TELEGRAM_CHAT_ID", "")
    
    # --- HARDWARE OPTIMIZATION ---
    # For low-end machines (máy yếu), we should aggressively clean up temp files
    # and use int8 precision for heavy models.
    WHISPER_MODEL_SIZE: str = os.getenv("WHISPER_MODEL_SIZE", "large-v3") # 'tiny', 'base', 'small', 'medium', 'large-v3'
    WHISPER_COMPUTE_TYPE: str = os.getenv("WHISPER_COMPUTE_TYPE", "int8") # 'int8' for CPU/low RAM, 'float16' for GPU
    WHISPER_LANGUAGE_MODE: str = os.getenv("WHISPER_LANGUAGE_MODE", "auto_zh_fallback")
    WHISPER_FALLBACK_LANGUAGE: str = os.getenv("WHISPER_FALLBACK_LANGUAGE", "zh")
    WHISPER_MIN_LANGUAGE_PROBABILITY: float = float(os.getenv("WHISPER_MIN_LANGUAGE_PROBABILITY", "0.55"))
    DEMUCS_MODEL: str = "htdemucs_ft" # Fast and good enough for vocal isolation
    
    # --- CLEANUP POLICY ---
    AUTO_CLEANUP_TEMP: bool = True # Delete project temp files after successful export

    def __init__(self):
        self.load_user_settings()

    def default_translation_model(self, provider: str) -> str:
        return TRANSLATION_DEFAULT_MODELS.get(provider, "")

    def load_user_settings(self):
        if not USER_SETTINGS_PATH.exists():
            if not self.TRANSLATION_MODEL:
                self.TRANSLATION_MODEL = self.default_translation_model(self.TRANSLATION_PROVIDER)
            return

        try:
            data = json.loads(USER_SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"Could not load user settings: {exc}")
            return

        provider = str(data.get("translation_provider", self.TRANSLATION_PROVIDER))
        if provider in TRANSLATION_PROVIDERS:
            self.TRANSLATION_PROVIDER = provider

        self.TRANSLATION_API_KEY = str(data.get("translation_api_key", self.TRANSLATION_API_KEY))
        self.TRANSLATION_BASE_URL = str(
            data.get("translation_base_url")
            or data.get("base_url")
            or self.TRANSLATION_BASE_URL
        )
        self.OPENAI_API_KEY = str(data.get("openai_api_key", self.OPENAI_API_KEY))
        self.VIENEU_API_URL = str(data.get("vieneu_api_url", self.VIENEU_API_URL))
        self.VIENEU_MODEL_ID = str(data.get("vieneu_model_id", self.VIENEU_MODEL_ID))
        self.TELEGRAM_ENABLED = coerce_bool(data.get("telegram_enabled"), self.TELEGRAM_ENABLED)
        self.TELEGRAM_BOT_TOKEN = str(data.get("telegram_bot_token", self.TELEGRAM_BOT_TOKEN))
        self.TELEGRAM_CHAT_ID = str(data.get("telegram_chat_id", self.TELEGRAM_CHAT_ID))
        self.WHISPER_MODEL_SIZE = str(data.get("whisper_model_size", self.WHISPER_MODEL_SIZE))
        self.WHISPER_COMPUTE_TYPE = str(data.get("whisper_compute_type", self.WHISPER_COMPUTE_TYPE))
        self.WHISPER_LANGUAGE_MODE = str(data.get("whisper_language_mode", self.WHISPER_LANGUAGE_MODE))
        self.WHISPER_FALLBACK_LANGUAGE = str(data.get("whisper_fallback_language", self.WHISPER_FALLBACK_LANGUAGE))
        try:
            self.WHISPER_MIN_LANGUAGE_PROBABILITY = float(
                data.get(
                    "whisper_min_language_probability",
                    self.WHISPER_MIN_LANGUAGE_PROBABILITY,
                )
            )
        except (TypeError, ValueError):
            pass
        self.TRANSLATION_MODEL = str(
            data.get("translation_model")
            or data.get("model")
            or self.TRANSLATION_MODEL
            or self.default_translation_model(self.TRANSLATION_PROVIDER)
        )
        self.ENABLE_FALLBACK = coerce_bool(data.get("enable_fallback"), self.ENABLE_FALLBACK)

    def get_translation_settings(self) -> Dict[str, Any]:
        model = self.TRANSLATION_MODEL or self.default_translation_model(self.TRANSLATION_PROVIDER)

        return {
            "provider": self.TRANSLATION_PROVIDER,
            "api_key": self.TRANSLATION_API_KEY,
            "base_url": self.TRANSLATION_BASE_URL,
            "openai_api_key": self.OPENAI_API_KEY,
            "vieneu_api_url": self.VIENEU_API_URL,
            "vieneu_model_id": self.VIENEU_MODEL_ID,
            "model": model,
            "enable_fallback": self.ENABLE_FALLBACK,
            "providers": sorted(TRANSLATION_PROVIDERS),
        }

    def get_telegram_settings(self) -> Dict[str, Any]:
        return {
            "enabled": self.TELEGRAM_ENABLED,
            "bot_token": self.TELEGRAM_BOT_TOKEN,
            "chat_id": self.TELEGRAM_CHAT_ID,
        }

    def get_stt_settings(self) -> Dict[str, Any]:
        return {
            "model_size": self.WHISPER_MODEL_SIZE,
            "compute_type": self.WHISPER_COMPUTE_TYPE,
            "language_mode": self.WHISPER_LANGUAGE_MODE,
            "fallback_language": self.WHISPER_FALLBACK_LANGUAGE,
            "min_language_probability": self.WHISPER_MIN_LANGUAGE_PROBABILITY,
            "model_options": ["tiny", "base", "small", "medium", "large-v3"],
            "compute_options": ["int8", "int8_float16", "float16", "float32"],
            "language_mode_options": ["auto_zh_fallback", "zh", "auto"],
        }

    def save_user_settings(self):
        USER_SETTINGS_PATH.write_text(
            json.dumps(
                {
                    "translation_provider": self.TRANSLATION_PROVIDER,
                    "translation_api_key": self.TRANSLATION_API_KEY,
                    "translation_base_url": self.TRANSLATION_BASE_URL,
                    "openai_api_key": self.OPENAI_API_KEY,
                    "vieneu_api_url": self.VIENEU_API_URL,
                    "vieneu_model_id": self.VIENEU_MODEL_ID,
                    "translation_model": self.TRANSLATION_MODEL,
                    "enable_fallback": self.ENABLE_FALLBACK,
                    "telegram_enabled": self.TELEGRAM_ENABLED,
                    "telegram_bot_token": self.TELEGRAM_BOT_TOKEN,
                    "telegram_chat_id": self.TELEGRAM_CHAT_ID,
                    "whisper_model_size": self.WHISPER_MODEL_SIZE,
                    "whisper_compute_type": self.WHISPER_COMPUTE_TYPE,
                    "whisper_language_mode": self.WHISPER_LANGUAGE_MODE,
                    "whisper_fallback_language": self.WHISPER_FALLBACK_LANGUAGE,
                    "whisper_min_language_probability": self.WHISPER_MIN_LANGUAGE_PROBABILITY,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    def update_translation_settings(
        self,
        provider: str,
        api_key: str,
        base_url: str,
        model: str,
        enable_fallback: bool,
        openai_api_key: str = "",
        vieneu_api_url: str = "",
        vieneu_model_id: str = "",
    ) -> Dict[str, Any]:
        if provider not in TRANSLATION_PROVIDERS:
            raise ValueError(f"Unsupported translation provider: {provider}")

        self.TRANSLATION_PROVIDER = provider
        self.TRANSLATION_API_KEY = api_key.strip()
        self.TRANSLATION_BASE_URL = base_url.strip()
        self.OPENAI_API_KEY = openai_api_key.strip()
        self.VIENEU_API_URL = vieneu_api_url.strip()
        self.VIENEU_MODEL_ID = vieneu_model_id.strip() or self.VIENEU_MODEL_ID
        self.TRANSLATION_MODEL = model.strip() or self.default_translation_model(provider)
        self.ENABLE_FALLBACK = enable_fallback

        self.save_user_settings()

        return self.get_translation_settings()

    def update_telegram_settings(
        self,
        enabled: bool,
        bot_token: str = "",
        chat_id: str = "",
    ) -> Dict[str, Any]:
        self.TELEGRAM_ENABLED = enabled
        self.TELEGRAM_BOT_TOKEN = bot_token.strip()
        self.TELEGRAM_CHAT_ID = chat_id.strip()
        self.save_user_settings()

        return self.get_telegram_settings()

    def update_stt_settings(
        self,
        model_size: str,
        compute_type: str,
        language_mode: str,
        fallback_language: str,
        min_language_probability: float,
    ) -> Dict[str, Any]:
        self.WHISPER_MODEL_SIZE = model_size.strip() or "large-v3"
        self.WHISPER_COMPUTE_TYPE = compute_type.strip() or "int8"
        self.WHISPER_LANGUAGE_MODE = language_mode.strip() or "auto_zh_fallback"
        self.WHISPER_FALLBACK_LANGUAGE = fallback_language.strip() or "zh"
        self.WHISPER_MIN_LANGUAGE_PROBABILITY = max(0.0, min(1.0, float(min_language_probability)))
        self.save_user_settings()

        return self.get_stt_settings()

settings = Settings()

def get_project_temp_dir(project_id: str) -> Path:
    """Create and return a temporary directory for a specific project"""
    proj_dir = TEMP_DIR / project_id
    proj_dir.mkdir(parents=True, exist_ok=True)
    return proj_dir

def cleanup_project(project_id: str):
    """Aggressively clean up temp files for a project to save disk space"""
    if not settings.AUTO_CLEANUP_TEMP:
        return
    proj_dir = TEMP_DIR / project_id
    if proj_dir.exists():
        try:
            shutil.rmtree(proj_dir)
            print(f"Cleaned up project directory: {proj_dir}")
        except Exception as e:
            print(f"Failed to clean up {proj_dir}: {e}")
