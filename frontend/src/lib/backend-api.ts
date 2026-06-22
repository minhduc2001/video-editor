import type { AllInOneAutomationResult, CaptionSegment } from '@/types/media'

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8000'

export type TranslationProvider = 'openai' | 'gemini' | 'deepseek' | '9router' | 'google_free'

export interface TranslationSettings {
  provider: TranslationProvider
  api_key: string
  base_url: string
  openai_api_key: string
  vieneu_api_url: string
  vieneu_model_id: string
  model: string
  enable_fallback: boolean
  providers?: TranslationProvider[]
}

export interface TranslationModelOption {
  id: string
  name: string
}

export interface SttSettings {
  model_size: string
  compute_type: string
  language_mode: string
  fallback_language: string
  min_language_probability: number
  model_options?: string[]
  compute_options?: string[]
  language_mode_options?: string[]
}

export interface TelegramSettings {
  enabled: boolean
  bot_token: string
  chat_id: string
}

export interface TelegramNotificationRequest {
  title: string
  message?: string
  results?: AllInOneAutomationResult[]
}

interface ImportVideoResponse {
  project_id: string
  video_path: string
  filename: string
}

interface TranscribeResponse {
  bgm_path?: string
  vocals_path: string
  isolation_status?: 'success' | 'skipped' | 'error'
  language?: string
  language_probability?: number
  language_source?: string
  model_size?: string
  compute_type?: string
  segments: CaptionSegment[]
}

interface VoiceIsolationResponse {
  audio_path: string
  bgm_path: string
  vocals_path: string
}

export interface DubbingSegmentPayload {
  id: string
  timeline_clip_id: string
  text: string
  start: number
  end: number
  duration: number
}

export interface DubbingSegmentResponse extends DubbingSegmentPayload {
  dub_audio_path: string
  dub_audio_url: string
}

interface GenerateDubbingResponse {
  project_id: string
  segments: DubbingSegmentResponse[]
}

interface DownloadVideoResponse {
  project_id: string
  video_path: string
  title: string
  filename: string
  duration: number
  size: number
  width?: number
  height?: number
  media_url: string
}

export interface ExportTimelineClipPayload {
  video_path: string
  source_start: number
  source_end: number
  bgm_path?: string
}

export interface ExportTimelineTextPayload {
  text: string
  start: number
  end: number
  x: number
  y: number
  font_family: string
  font_size: number
  font_weight: number
  font_style: 'normal' | 'italic'
  color: string
  stroke_color: string
  stroke_width: number
  background_color: string
  background_opacity: number
}

export interface ExportTimelineBlurMaskPayload {
  start: number
  end: number
  x: number
  y: number
  width: number
  height: number
  intensity: number
  mode?: 'blur' | 'solid'
  color?: string
  opacity?: number
}

export interface ExportTimelineDubbingPayload {
  audio_path: string
  start: number
  end: number
  volume: number
  speed: number
}

export interface ExportTimelineRequest {
  clips: ExportTimelineClipPayload[]
  text_clips: ExportTimelineTextPayload[]
  blur_masks?: ExportTimelineBlurMaskPayload[]
  dubbing_clips?: ExportTimelineDubbingPayload[]
  duck_original_audio_all?: boolean
  include_audio: boolean
  burn_subtitles: boolean
  output_name: string
  output_width?: number
  output_height?: number
}

interface ExportTimelineResponse {
  status: 'done'
  output_url: string
  output_path: string
  filename: string
}

const toBackendUrl = (url: string) =>
  url.startsWith('http') ? url : `${API_BASE_URL}${url}`

async function readErrorMessage(response: Response) {
  try {
    const data = await response.json()
    return data.detail || data.message || response.statusText
  } catch {
    return response.statusText
  }
}

export async function getTranslationSettings() {
  const response = await fetch(`${API_BASE_URL}/api/settings/translation`)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as TranslationSettings
}

export async function saveTranslationSettings(settings: TranslationSettings) {
  const response = await fetch(`${API_BASE_URL}/api/settings/translation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as TranslationSettings
}

export async function getTranslationModels(settings: Pick<TranslationSettings, 'provider' | 'base_url' | 'api_key'>) {
  const response = await fetch(`${API_BASE_URL}/api/settings/translation/models`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as { models: TranslationModelOption[] }
}

export async function getSttSettings() {
  const response = await fetch(`${API_BASE_URL}/api/settings/stt`)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as SttSettings
}

export async function saveSttSettings(settings: SttSettings) {
  const response = await fetch(`${API_BASE_URL}/api/settings/stt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as SttSettings
}

export async function getTelegramSettings() {
  const response = await fetch(`${API_BASE_URL}/api/settings/telegram`)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as TelegramSettings
}

export async function saveTelegramSettings(settings: TelegramSettings) {
  const response = await fetch(`${API_BASE_URL}/api/settings/telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as TelegramSettings
}

export async function sendTelegramNotification(request: TelegramNotificationRequest) {
  const response = await fetch(`${API_BASE_URL}/api/notifications/telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: request.title,
      message: request.message ?? '',
      results: (request.results ?? []).map((result) => ({
        source_url: result.sourceUrl,
        file_name: result.fileName,
        download_url: result.downloadUrl,
      })),
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as { status: 'sent' | 'skipped'; reason?: string }
}

export async function generateDubbingFromText(
  segments: DubbingSegmentPayload[],
  voice: string,
  translate = false
) {
  const response = await fetch(`${API_BASE_URL}/api/translate-and-dub`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      segments,
      voice,
      translate,
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const data = (await response.json()) as GenerateDubbingResponse

  return {
    ...data,
    segments: data.segments.map((segment) => ({
      ...segment,
      dub_audio_url: toBackendUrl(segment.dub_audio_url),
    })),
  }
}

export async function uploadVideoToBackend(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/api/import-video`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as ImportVideoResponse
}

export async function downloadVideoFromLink(url: string) {
  const response = await fetch(`${API_BASE_URL}/api/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const data = (await response.json()) as DownloadVideoResponse

  return {
    ...data,
    download_url: toBackendUrl(data.media_url),
  }
}

interface TranscribeBackendOptions {
  translateToVietnamese?: boolean
}

export async function transcribeBackendVideo(
  videoPath: string,
  options: TranscribeBackendOptions = {}
) {
  const response = await fetch(`${API_BASE_URL}/api/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_path: videoPath,
      translate_to_vietnamese: Boolean(options.translateToVietnamese),
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as TranscribeResponse
}

export async function isolateVoiceBackendVideo(videoPath: string) {
  const response = await fetch(`${API_BASE_URL}/api/isolate-voice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ video_path: videoPath }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return (await response.json()) as VoiceIsolationResponse
}

export async function exportTimelineVideo(request: ExportTimelineRequest) {
  const response = await fetch(`${API_BASE_URL}/api/export-timeline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const data = (await response.json()) as ExportTimelineResponse

  return {
    ...data,
    download_url: toBackendUrl(data.output_url),
  }
}
