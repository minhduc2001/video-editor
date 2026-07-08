from __future__ import annotations
import json
import re
from typing import List, Dict, Any
import requests

from core.config import settings
from services.ai_debug import log_ai_failure, log_ai_start, log_ai_success, preview

class TranslatorService:
    """Service to translate text using various AI providers with fallback"""
    
    @staticmethod
    def translate_segments(segments: List[Dict[str, Any]], target_lang: str = "vi") -> List[Dict[str, Any]]:
        """
        Translates a list of subtitle segments.
        Returns the segments with an added 'translated_text' field.
        """
        # If segments is empty, return early
        if not segments:
            return []

        provider = settings.TRANSLATION_PROVIDER
        api_key = settings.TRANSLATION_API_KEY
        
        # Batch translation for APIs to save cost and time
        texts_to_translate = [seg["text"] for seg in segments]
        translated_texts = []
        
        success = False
        if api_key and provider in ["openai", "deepseek", "9router"]:
            translated_texts = TranslatorService._translate_openai_compatible(
                texts_to_translate,
                api_key,
                provider,
                target_lang,
                settings.TRANSLATION_MODEL,
                settings.TRANSLATION_BASE_URL,
            )
            if translated_texts and len(translated_texts) == len(texts_to_translate):
                success = True

        if api_key and provider == "gemini":
            translated_texts = TranslatorService._translate_gemini(
                texts_to_translate,
                api_key,
                target_lang,
                settings.TRANSLATION_MODEL,
            )
            if translated_texts and len(translated_texts) == len(texts_to_translate):
                success = True
                
        # Fallback to Google Translate (Free but rate-limited)
        if not success and settings.ENABLE_FALLBACK:
            print("Using fallback Google Translate API...")
            translated_texts = TranslatorService._translate_google_free(texts_to_translate, target_lang)
            if translated_texts and len(translated_texts) == len(texts_to_translate):
                success = True
                
        if not success:
            print("All translation methods failed. Using original text.")
            translated_texts = texts_to_translate # Fallback to original
            
        # Merge back to segments
        for i, seg in enumerate(segments):
            seg["translated_text"] = translated_texts[i]
            
        return segments

    @staticmethod
    def _build_json_translation_prompt(texts: List[str], target_lang: str) -> str:
        return (
            "Translate each subtitle line into Vietnamese. "
            "Keep the exact same number of items and preserve subtitle meaning naturally. "
            f"Target language code: {target_lang}. "
            "Return only a JSON array of strings, no markdown.\n\n"
            + json.dumps(texts, ensure_ascii=False)
        )

    @staticmethod
    def _parse_translation_output(result_text: str, expected_count: int) -> List[str]:
        cleaned = result_text.strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list):
                translated = [str(item).strip() for item in parsed]
                if len(translated) == expected_count:
                    return translated
        except Exception:
            pass

        lines = [
            re.sub(r"^\s*(?:\d+[\).\s-]+|[-*]\s+)", "", line).strip()
            for line in cleaned.splitlines()
            if line.strip()
        ]

        return lines

    @staticmethod
    def _normalize_chat_completions_url(base_url: str) -> str:
        normalized = (base_url or "").strip().rstrip("/")

        if not normalized:
            return ""

        if normalized.endswith("/chat/completions"):
            return normalized

        if normalized.endswith("/v1"):
            return f"{normalized}/chat/completions"

        return f"{normalized}/v1/chat/completions"

    @staticmethod
    def _normalize_models_url(base_url: str) -> str:
        normalized = (base_url or "").strip().rstrip("/")

        if not normalized:
            return ""

        if normalized.endswith("/models"):
            return normalized

        if normalized.endswith("/chat/completions"):
            return f"{normalized.rsplit('/chat/completions', 1)[0]}/models"

        if normalized.endswith("/v1"):
            return f"{normalized}/models"

        return f"{normalized}/v1/models"

    @staticmethod
    def list_openai_compatible_models(base_url: str, api_key: str) -> List[Dict[str, str]]:
        url = TranslatorService._normalize_models_url(base_url)

        if not url:
            raise ValueError("Missing API URL")

        start_time = log_ai_start(
            "9router",
            "list_models",
            "GET",
            url,
        )

        response: requests.Response | None = None

        try:
            response = requests.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            log_ai_failure(
                "9router",
                "list_models",
                start_time,
                exc,
                url=url,
                response=response or getattr(exc, "response", None),
            )
            raise

        data = payload.get("data", payload if isinstance(payload, list) else [])
        models: List[Dict[str, str]] = []
        seen = set()

        for item in data:
            if isinstance(item, str):
                model_id = item
                model_name = item
            elif isinstance(item, dict):
                model_id = str(item.get("id") or item.get("model") or item.get("name") or "").strip()
                model_name = str(item.get("name") or model_id).strip()
            else:
                continue

            if not model_id or model_id in seen:
                continue

            seen.add(model_id)
            models.append({"id": model_id, "name": model_name or model_id})

        log_ai_success(
            "9router",
            "list_models",
            start_time,
            status_code=response.status_code,
            extra={"model_count": len(models)},
        )

        if not models:
            print(
                "[AI API] parse_warning "
                + preview(
                    {
                        "provider": "9router",
                        "action": "list_models",
                        "warning": "No models parsed from response.",
                        "response_body": payload,
                    }
                )
            )

        return models

    @staticmethod
    def _read_openai_stream_text(response: requests.Response) -> str:
        chunks: List[str] = []

        for raw_line in response.iter_lines(decode_unicode=True):
            if not raw_line:
                continue

            line = raw_line.strip()
            if line.startswith("data:"):
                line = line[5:].strip()

            if line == "[DONE]":
                break

            try:
                payload = json.loads(line)
            except Exception:
                continue

            choices = payload.get("choices") or []
            if not choices:
                continue

            choice = choices[0]
            delta = choice.get("delta") or {}
            message = choice.get("message") or {}
            content = delta.get("content") or message.get("content") or ""

            if content:
                chunks.append(str(content))

        return "".join(chunks).strip()

    @staticmethod
    def _translate_openai_compatible(
        texts: List[str],
        api_key: str,
        provider: str,
        target_lang: str,
        model: str,
        base_url: str = "",
    ) -> List[str]:
        """Translates an array of strings using an OpenAI-compatible endpoint"""
        url = "https://api.openai.com/v1/chat/completions"
        selected_model = model or settings.default_translation_model("openai")
        
        if provider == "deepseek":
            url = "https://api.deepseek.com/v1/chat/completions"
            selected_model = model or settings.default_translation_model("deepseek")

        if provider == "9router":
            url = TranslatorService._normalize_chat_completions_url(base_url)
            selected_model = model or settings.default_translation_model("9router")

            if not url:
                print("[AI API] failure {\"provider\":\"9router\",\"action\":\"translate\",\"error\":\"missing API URL\"}")
                return []
            
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        prompt = TranslatorService._build_json_translation_prompt(texts, target_lang)
        
        stream_response = provider == "9router"
        data = {
            "model": selected_model,
            "messages": [
                {"role": "system", "content": "You are a professional video subtitle translator."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.3,
            "stream": stream_response,
        }
        
        start_time = log_ai_start(
            provider,
            "translate",
            "POST",
            url,
            model=selected_model,
            extra={
                "segments": len(texts),
                "target_lang": target_lang,
                "stream": stream_response,
                "prompt_chars": len(prompt),
            },
        )

        response: requests.Response | None = None

        try:
            response = requests.post(
                url,
                headers=headers,
                json=data,
                timeout=60,
                stream=stream_response,
            )
            response.raise_for_status()
            if stream_response:
                result_text = TranslatorService._read_openai_stream_text(response)
            else:
                result_text = response.json()["choices"][0]["message"]["content"].strip()
            translated_lines = TranslatorService._parse_translation_output(result_text, len(texts))
            
            # Very basic validation
            if len(translated_lines) != len(texts):
                print(
                    "[AI API] parse_warning "
                    + preview(
                        {
                            "provider": provider,
                            "action": "translate",
                            "model": selected_model,
                            "expected_lines": len(texts),
                            "returned_lines": len(translated_lines),
                            "raw_output": result_text,
                        }
                    )
                )
                # We might need better parsing in production

            log_ai_success(
                provider,
                "translate",
                start_time,
                status_code=response.status_code,
                model=selected_model,
                extra={
                    "segments": len(texts),
                    "returned_lines": len(translated_lines),
                    "response_chars": len(result_text),
                },
            )
                
            return translated_lines
        except Exception as e:
            log_ai_failure(
                provider,
                "translate",
                start_time,
                e,
                url=url,
                model=selected_model,
                response=response or getattr(e, "response", None),
                extra={
                    "segments": len(texts),
                    "target_lang": target_lang,
                    "stream": stream_response,
                },
            )
            return []

    @staticmethod
    def _translate_gemini(
        texts: List[str],
        api_key: str,
        target_lang: str,
        model: str,
    ) -> List[str]:
        selected_model = model or settings.default_translation_model("gemini")
        prompt = TranslatorService._build_json_translation_prompt(texts, target_lang)
        url = (
            "https://generativelanguage.googleapis.com/v1beta/"
            f"models/{selected_model}:generateContent"
        )

        start_time = log_ai_start(
            "gemini",
            "translate",
            "POST",
            url,
            model=selected_model,
            extra={
                "segments": len(texts),
                "target_lang": target_lang,
                "prompt_chars": len(prompt),
            },
        )

        response: requests.Response | None = None

        try:
            response = requests.post(
                url,
                params={"key": api_key},
                json={
                    "contents": [
                        {
                            "role": "user",
                            "parts": [{"text": prompt}],
                        }
                    ],
                    "generationConfig": {
                        "temperature": 0.2,
                    },
                },
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            parts = payload["candidates"][0]["content"]["parts"]
            result_text = "".join(part.get("text", "") for part in parts).strip()
            translated_lines = TranslatorService._parse_translation_output(result_text, len(texts))

            if len(translated_lines) != len(texts):
                print(
                    "[AI API] parse_warning "
                    + preview(
                        {
                            "provider": "gemini",
                            "action": "translate",
                            "model": selected_model,
                            "expected_lines": len(texts),
                            "returned_lines": len(translated_lines),
                            "raw_output": result_text,
                        }
                    )
                )

            log_ai_success(
                "gemini",
                "translate",
                start_time,
                status_code=response.status_code,
                model=selected_model,
                extra={
                    "segments": len(texts),
                    "returned_lines": len(translated_lines),
                    "response_chars": len(result_text),
                },
            )

            return translated_lines
        except Exception as e:
            log_ai_failure(
                "gemini",
                "translate",
                start_time,
                e,
                url=url,
                model=selected_model,
                response=response or getattr(e, "response", None),
                extra={
                    "segments": len(texts),
                    "target_lang": target_lang,
                },
            )
            return []

    @staticmethod
    def _translate_google_free(texts: List[str], target_lang: str) -> List[str]:
        """Translate text line-by-line using Google's public web endpoint."""
        translated_texts: List[str] = []

        for text in texts:
            if not text.strip():
                translated_texts.append(text)
                continue

            try:
                response = requests.get(
                    "https://translate.googleapis.com/translate_a/single",
                    params={
                        "client": "gtx",
                        "sl": "auto",
                        "tl": target_lang,
                        "dt": "t",
                        "q": text,
                    },
                    timeout=12,
                )
                response.raise_for_status()
                payload = response.json()
                translated = "".join(part[0] for part in payload[0] if part and part[0]).strip()
                translated_texts.append(translated or text)
            except Exception as e:
                print(f"Google Translate line failed: {e}")
                translated_texts.append(text)

        return translated_texts
