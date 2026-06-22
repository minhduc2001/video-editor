export interface ImportedVideo {
  id: string
  name: string
  file: File
  url: string
  size: number
  type: string
  duration: number | null
  width?: number | null
  height?: number | null
  importedAt: number
  backendProjectId?: string
  backendVideoPath?: string
  bgmPath?: string
  vocalsPath?: string
  uploadStatus?: "idle" | "uploading" | "ready" | "error"
  uploadError?: string
  voiceIsolationStatus?: "idle" | "processing" | "ready" | "error"
  voiceIsolationError?: string
}

export interface SeekCommand {
  id: number
  time: number
}

export interface TimelineVideoClip {
  id: string
  videoId: string
  start: number
  end: number
  sourceStart: number
  sourceEnd: number
}

export interface TextClip {
  id: string
  timelineClipId: string
  text: string
  start: number
  end: number
  x: number
  y: number
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: "normal" | "italic"
  color: string
  strokeColor: string
  strokeWidth: number
  backgroundColor: string
  backgroundOpacity: number
  source: "manual" | "caption"
}

export interface DubbingClip {
  id: string
  textClipId: string
  timelineClipId: string
  text: string
  start: number
  end: number
  audioPath: string
  audioUrl: string
  voice: string
  volume: number
  speed: number
}

export interface BlurMaskClip {
  id: string
  timelineClipId: string
  start: number
  end: number
  x: number
  y: number
  width: number
  height: number
  intensity: number
  mode?: "blur" | "solid"
  color?: string
  opacity?: number
  source?: "manual" | "caption_cover"
}

export interface CaptionSegment {
  id?: number
  start: number
  end: number
  text: string
  source_text?: string
  translated_text?: string
  duration?: number
}

export interface AllInOneAutomationOptions {
  urls: string[]
  voice: string
  translateToVietnamese: boolean
  includeVietnameseVoice: boolean
  burnSubtitles: boolean
  duckOriginalAudioAll: boolean
}

export interface AllInOneAutomationResult {
  sourceUrl: string
  downloadUrl: string
  fileName: string
}
