import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Clock3, Download, FilePlus2, FileText, FolderOpen, Save, Settings as SettingsIcon, X } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/Player';
import { Timeline } from './components/Timeline';
import { PropertiesPanel } from './components/PropertiesPanel';
import {
  downloadVideoFromLink,
  exportTimelineVideo,
  generateDubbingFromText,
  getSttSettings,
  getTelegramSettings,
  getTranslationModels,
  getTranslationSettings,
  isolateVoiceBackendVideo,
  saveSttSettings,
  saveTelegramSettings,
  saveTranslationSettings,
  sendTelegramNotification,
  transcribeBackendVideo,
  uploadVideoToBackend,
  type TranslationProvider,
  type TranslationSettings,
  type TranslationModelOption,
  type SttSettings,
  type TelegramSettings,
  type DubbingSegmentPayload,
} from './lib/backend-api';
import { parseSrtFileText, type ParsedSrtCue } from './lib/srt';
import {
  DEFAULT_TEXT_BACKGROUND_COLOR,
  DEFAULT_TEXT_BACKGROUND_OPACITY,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TEXT_STROKE_COLOR,
  DEFAULT_TEXT_STROKE_WIDTH,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TEXT_WEIGHT,
  AUTO_CAPTION_BACKGROUND_COLOR,
  AUTO_CAPTION_BACKGROUND_OPACITY,
  AUTO_CAPTION_COVER_COLOR,
  AUTO_CAPTION_COVER_OPACITY,
  AUTO_CAPTION_TEXT_COLOR,
} from './lib/text-style';
import {
  buildProjectFile,
  createProjectMetadata,
  hydrateProjectFile,
  loadRecentProjectSnapshot,
  parseProjectFileText,
  saveProjectFileToDisk,
  saveRecentProjectSnapshot,
  type ProjectFile,
  type ProjectMetadata,
} from './lib/project-file';
import { formatDuration } from './lib/media';
import type {
  AllInOneAutomationOptions,
  AllInOneAutomationResult,
  BlurMaskClip,
  CaptionSegment,
  DubbingClip,
  ImportedVideo,
  SeekCommand,
  TextClip,
  TimelineVideoClip,
} from './types/media';

type CaptionStatus = "idle" | "uploading" | "transcribing" | "ready" | "error";
type ExportStatus = 'idle' | 'preparing' | 'rendering' | 'done' | 'error';
type LinkImportStatus = 'idle' | 'downloading' | 'ready' | 'error';
type AllInOneStatus = 'idle' | 'running' | 'done' | 'error';
type SettingsStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';
type SettingsTab = 'translation' | 'tts' | 'stt' | 'telegram';
type TranslationModelsStatus = 'idle' | 'loading' | 'ready' | 'error';
type DubbingStatus = 'idle' | 'generating' | 'ready' | 'error';
const MIN_VIDEO_CLIP_DURATION = 0.1;
const MIN_TEXT_CLIP_DURATION = 0.2;
const PANE_LAYOUT_STORAGE_KEY = 'ai-video-editor-pane-layout';
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 560;
const MIN_PROPERTIES_WIDTH = 260;
const MAX_PROPERTIES_WIDTH = 560;
const MIN_TIMELINE_HEIGHT = 180;
const MAX_TIMELINE_HEIGHT = 520;
const HISTORY_LIMIT = 80;
const HISTORY_GROUP_WINDOW_MS = 700;

type PaneResizeTarget = 'sidebar' | 'properties' | 'timeline';

interface PaneLayout {
  sidebarWidth: number
  propertiesWidth: number
  timelineHeight: number
}

interface EditorHistorySnapshot {
  videos: ImportedVideo[]
  activeVideoId: string | null
  timelineClips: TimelineVideoClip[]
  selectedTimelineClipId: string | null
  textClips: TextClip[]
  selectedTextClipId: string | null
  selectedTextClipIds: string[]
  dubbingClips: DubbingClip[]
  selectedDubbingClipId: string | null
  blurMaskClips: BlurMaskClip[]
  selectedBlurMaskClipId: string | null
  currentTime: number
}

interface SubtitleEntry extends TextClip {
  timelineStart: number
  timelineEnd: number
}

interface BlurMaskEntry extends BlurMaskClip {
  timelineStart: number
  timelineEnd: number
}

const defaultPaneLayout: PaneLayout = {
  sidebarWidth: 340,
  propertiesWidth: 340,
  timelineHeight: 280,
};

const defaultTranslationSettings: TranslationSettings = {
  provider: 'google_free',
  api_key: '',
  base_url: '',
  openai_api_key: '',
  vieneu_api_url: '',
  vieneu_model_id: 'pnnbao-ump/VieNeu-TTS-v2',
  model: '',
  enable_fallback: true,
};

const defaultTelegramSettings: TelegramSettings = {
  enabled: false,
  bot_token: '',
  chat_id: '',
};

const defaultSttSettings: SttSettings = {
  model_size: 'large-v3',
  compute_type: 'int8',
  language_mode: 'auto_zh_fallback',
  fallback_language: 'zh',
  min_language_probability: 0.55,
  model_options: ['tiny', 'base', 'small', 'medium', 'large-v3'],
  compute_options: ['int8', 'int8_float16', 'float16', 'float32'],
  language_mode_options: ['auto_zh_fallback', 'zh', 'auto'],
};

const translationProviderLabels: Record<TranslationProvider, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  '9router': '9Router',
  google_free: 'Google Free',
};

const orderedTranslationProviders: TranslationProvider[] = [
  'openai',
  'gemini',
  'deepseek',
  '9router',
  'google_free',
];

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'translation', label: 'Translation' },
  { id: 'tts', label: 'TTS' },
  { id: 'stt', label: 'STT' },
  { id: 'telegram', label: 'Telegram' },
];

const sttLanguageModeLabels: Record<string, string> = {
  auto_zh_fallback: 'Auto + Chinese fallback',
  zh: 'Force Chinese',
  auto: 'Auto only',
};

const defaultModelForProvider = (provider: TranslationProvider) => {
  if (provider === 'openai') {
    return 'gpt-4o-mini';
  }

  if (provider === 'gemini') {
    return 'gemini-1.5-flash';
  }

  if (provider === 'deepseek') {
    return 'deepseek-chat';
  }

  if (provider === '9router') {
    return 'cc/claude-opus-4-6';
  }

  return '';
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const readPaneLayout = () => {
  try {
    const rawLayout = window.localStorage.getItem(PANE_LAYOUT_STORAGE_KEY);

    if (!rawLayout) {
      return defaultPaneLayout;
    }

    const parsed = JSON.parse(rawLayout) as Partial<PaneLayout>;

    return {
      sidebarWidth: clamp(parsed.sidebarWidth ?? defaultPaneLayout.sidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
      propertiesWidth: clamp(
        parsed.propertiesWidth ?? defaultPaneLayout.propertiesWidth,
        MIN_PROPERTIES_WIDTH,
        MAX_PROPERTIES_WIDTH
      ),
      timelineHeight: clamp(
        parsed.timelineHeight ?? defaultPaneLayout.timelineHeight,
        MIN_TIMELINE_HEIGHT,
        MAX_TIMELINE_HEIGHT
      ),
    };
  } catch {
    return defaultPaneLayout;
  }
};

const reflowTimelineClips = (clips: TimelineVideoClip[]) => {
  let cursor = 0;

  return clips.map((clip) => {
    const duration = Math.max(MIN_VIDEO_CLIP_DURATION, clip.end - clip.start);
    const nextClip = {
      ...clip,
      start: cursor,
      end: cursor + duration,
    };
    cursor = nextClip.end;
    return nextClip;
  });
};

const buildTimelineClipShiftMap = (
  previousClips: TimelineVideoClip[],
  nextClips: TimelineVideoClip[]
) => {
  const previousStartById = new Map(previousClips.map((clip) => [clip.id, clip.start]));

  return new Map(
    nextClips.map((clip) => [
      clip.id,
      clip.start - (previousStartById.get(clip.id) ?? clip.start),
    ])
  );
};

const sanitizeDownloadFileName = (name: string, extension: string) => {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
  return `${cleaned || 'video-project'}${extension}`;
};

const formatSrtTimestamp = (seconds: number) => {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    wholeSeconds
  ).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
};

const getVideoDesignSize = (video?: ImportedVideo | null) => ({
  width: video?.width && video.width > 0 ? video.width : 1280,
  height: video?.height && video.height > 0 ? video.height : 720,
});

const wrapCaptionText = (text: string, maxCharsPerLine: number) => {
  const normalizedText = text.trim().replace(/\s+/g, ' ');

  if (!normalizedText || normalizedText.length <= maxCharsPerLine) {
    return normalizedText;
  }

  const words = normalizedText.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  words.forEach((word) => {
    if (word.length > maxCharsPerLine) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }

      for (let index = 0; index < word.length; index += maxCharsPerLine) {
        lines.push(word.slice(index, index + maxCharsPerLine));
      }
      return;
    }

    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      return;
    }

    currentLine = nextLine;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, 3).join('\n');
};

const getAutoCaptionStyle = (text: string, video?: ImportedVideo | null) => {
  const { width, height } = getVideoDesignSize(video);
  const isPortrait = height > width;
  const shortSide = Math.min(width, height);
  const textLength = text.trim().replace(/\s+/g, ' ').length;
  const lengthScale = textLength > 54
    ? 0.66
    : textLength > 38
      ? 0.74
      : textLength > 26
        ? 0.84
        : textLength > 16
          ? 0.92
          : 1;
  const fontSize = Math.round(
    clamp(shortSide * (isPortrait ? 0.052 : 0.045) * lengthScale, 28, isPortrait ? 64 : 56)
  );
  const maxCharsPerLine = Math.round(
    clamp((width * 0.82) / Math.max(1, fontSize * 0.54), isPortrait ? 16 : 22, isPortrait ? 34 : 48)
  );

  return {
    x: 50,
    y: isPortrait ? 84 : 82,
    fontSize,
    text: wrapCaptionText(text, maxCharsPerLine),
  };
};

const getAutoCaptionLaneY = (lane: number, video?: ImportedVideo | null) => {
  const { width, height } = getVideoDesignSize(video);
  const isPortrait = height > width;
  const baseY = isPortrait ? 84 : 82;
  const laneGap = isPortrait ? 9 : 8;

  return clamp(baseY - lane * laneGap, 54, 90);
};

const layoutAutoCaptionClips = (clips: TextClip[], video?: ImportedVideo | null) => {
  const laneEnds: number[] = [];

  return clips
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((clip) => {
      let lane = laneEnds.findIndex((end) => clip.start >= end - 0.05);

      if (lane === -1) {
        lane = laneEnds.length;
      }

      lane = Math.min(lane, 2);
      laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, clip.end);

      return {
        ...clip,
        y: getAutoCaptionLaneY(lane, video),
      };
    });
};

const buildAutoCaptionCoverMasks = (
  clips: TextClip[],
  timelineClipId: string,
  video?: ImportedVideo | null
): BlurMaskClip[] => {
  const { height } = getVideoDesignSize(video);

  return clips.map((clip) => {
    const lineCount = Math.max(1, clip.text.split('\n').length);
    const coverHeight = clamp(((clip.fontSize * lineCount * 1.45) / height) * 100 + 2.4, 7, 18);

    return {
      id: crypto.randomUUID(),
      timelineClipId,
      start: clip.start,
      end: clip.end,
      x: 50,
      y: clip.y,
      width: 92,
      height: coverHeight,
      intensity: 16,
      mode: 'solid' as const,
      color: AUTO_CAPTION_COVER_COLOR,
      opacity: AUTO_CAPTION_COVER_OPACITY,
      source: 'caption_cover' as const,
    };
  });
};

const downloadTextFile = (fileName: string, text: string, type = 'text/plain') => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function App() {
  const [project, setProject] = useState<ProjectMetadata>(() =>
    createProjectMetadata('Untitled Project')
  );
  const [projectNameDraft, setProjectNameDraft] = useState('Untitled Project');
  const [isProjectReady, setIsProjectReady] = useState(false);
  const [recentProjectFile, setRecentProjectFile] = useState<ProjectFile | null>(null);
  const [projectStatus, setProjectStatus] = useState('Choose or create a project');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>('idle');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('translation');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [translationSettings, setTranslationSettings] = useState<TranslationSettings>(defaultTranslationSettings);
  const [translationSettingsDraft, setTranslationSettingsDraft] =
    useState<TranslationSettings>(defaultTranslationSettings);
  const [translationModelOptions, setTranslationModelOptions] = useState<TranslationModelOption[]>([]);
  const [translationModelsStatus, setTranslationModelsStatus] = useState<TranslationModelsStatus>('idle');
  const [translationModelsError, setTranslationModelsError] = useState<string | null>(null);
  const [sttSettings, setSttSettings] = useState<SttSettings>(defaultSttSettings);
  const [sttSettingsDraft, setSttSettingsDraft] = useState<SttSettings>(defaultSttSettings);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings>(defaultTelegramSettings);
  const [telegramSettingsDraft, setTelegramSettingsDraft] =
    useState<TelegramSettings>(defaultTelegramSettings);
  const [paneLayout, setPaneLayout] = useState<PaneLayout>(() => readPaneLayout());
  const [videos, setVideos] = useState<ImportedVideo[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [timelineClips, setTimelineClips] = useState<TimelineVideoClip[]>([]);
  const [selectedTimelineClipId, setSelectedTimelineClipId] = useState<string | null>(null);
  const [textClips, setTextClips] = useState<TextClip[]>([]);
  const [selectedTextClipId, setSelectedTextClipId] = useState<string | null>(null);
  const [selectedTextClipIds, setSelectedTextClipIds] = useState<string[]>([]);
  const [dubbingClips, setDubbingClips] = useState<DubbingClip[]>([]);
  const [selectedDubbingClipId, setSelectedDubbingClipId] = useState<string | null>(null);
  const [blurMaskClips, setBlurMaskClips] = useState<BlurMaskClip[]>([]);
  const [selectedBlurMaskClipId, setSelectedBlurMaskClipId] = useState<string | null>(null);
  const [dubbingStatus, setDubbingStatus] = useState<DubbingStatus>('idle');
  const [dubbingError, setDubbingError] = useState<string | null>(null);
  const [captionStatus, setCaptionStatus] = useState<CaptionStatus>("idle");
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [linkImportStatus, setLinkImportStatus] = useState<LinkImportStatus>('idle');
  const [linkImportError, setLinkImportError] = useState<string | null>(null);
  const [allInOneStatus, setAllInOneStatus] = useState<AllInOneStatus>('idle');
  const [allInOneStep, setAllInOneStep] = useState('');
  const [allInOneError, setAllInOneError] = useState<string | null>(null);
  const [allInOneResults, setAllInOneResults] = useState<AllInOneAutomationResult[]>([]);
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
  const [exportIncludeAudio, setExportIncludeAudio] = useState(true);
  const [exportBurnSubtitles, setExportBurnSubtitles] = useState(true);
  const [reduceOriginalAudioAll, setReduceOriginalAudioAll] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDownloadUrl, setExportDownloadUrl] = useState<string | null>(null);
  const [exportFileName, setExportFileName] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [seekCommand, setSeekCommand] = useState<SeekCommand>({ id: 0, time: 0 });
  const [undoStack, setUndoStack] = useState<EditorHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorHistorySnapshot[]>([]);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const videoDataUrlCacheRef = useRef<Map<string, string>>(new Map());
  const autosaveTimerRef = useRef<number | null>(null);
  const historyGroupRef = useRef<string | null>(null);
  const historyGroupTimerRef = useRef<number | null>(null);
  const copiedTimelineClipIdRef = useRef<string | null>(null);
  const autoCaptionRequestRef = useRef(false);

  const selectedTimelineClip = useMemo(
    () => timelineClips.find((clip) => clip.id === selectedTimelineClipId) ?? null,
    [selectedTimelineClipId, timelineClips]
  );

  const timelineVideo = useMemo(
    () => videos.find((video) => video.id === selectedTimelineClip?.videoId) ?? null,
    [selectedTimelineClip?.videoId, videos]
  );

  const selectedTextClip = useMemo(
    () => textClips.find((clip) => clip.id === selectedTextClipId) ?? null,
    [selectedTextClipId, textClips]
  );

  const selectedTextClips = useMemo(() => {
    const selectedIds = selectedTextClipIds.length > 0
      ? selectedTextClipIds
      : selectedTextClipId
        ? [selectedTextClipId]
        : [];
    const selectedIdSet = new Set(selectedIds);

    return textClips.filter((clip) => selectedIdSet.has(clip.id));
  }, [selectedTextClipId, selectedTextClipIds, textClips]);

  const selectedDubbingClip = useMemo(
    () => dubbingClips.find((clip) => clip.id === selectedDubbingClipId) ?? null,
    [dubbingClips, selectedDubbingClipId]
  );

  const activeTextClips = useMemo(
    () => textClips.filter((clip) => clip.timelineClipId === selectedTimelineClipId),
    [selectedTimelineClipId, textClips]
  );
  const activeBlurMaskClips = useMemo(
    () => blurMaskClips.filter((clip) => clip.timelineClipId === selectedTimelineClipId),
    [blurMaskClips, selectedTimelineClipId]
  );

  const timelineDuration = useMemo(
    () => Math.max(0, ...timelineClips.map((clip) => clip.end)),
    [timelineClips]
  );

  const timelineCurrentTime = selectedTimelineClip
    ? selectedTimelineClip.start + currentTime
    : 0;
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const selectedClipDuration = selectedTimelineClip
    ? Math.max(MIN_TEXT_CLIP_DURATION, selectedTimelineClip.end - selectedTimelineClip.start)
    : 0;
  const canSplitClip = Boolean(
    selectedTimelineClip &&
    currentTime > MIN_VIDEO_CLIP_DURATION &&
    currentTime < selectedClipDuration - MIN_VIDEO_CLIP_DURATION
  );
  const isExporting = exportStatus === 'preparing' || exportStatus === 'rendering';

  const createEditorSnapshot = (): EditorHistorySnapshot => ({
    videos: videos.map((video) => ({ ...video })),
    activeVideoId,
    timelineClips: timelineClips.map((clip) => ({ ...clip })),
    selectedTimelineClipId,
    textClips: textClips.map((clip) => ({ ...clip })),
    selectedTextClipId,
    selectedTextClipIds: selectedTextClipIds.slice(),
    dubbingClips: dubbingClips.map((clip) => ({ ...clip })),
    selectedDubbingClipId,
    blurMaskClips: blurMaskClips.map((clip) => ({ ...clip })),
    selectedBlurMaskClipId,
    currentTime,
  });

  const restoreEditorSnapshot = (snapshot: EditorHistorySnapshot) => {
    setVideos(snapshot.videos.map((video) => ({ ...video })));
    setActiveVideoId(snapshot.activeVideoId);
    setTimelineClips(snapshot.timelineClips.map((clip) => ({ ...clip })));
    setSelectedTimelineClipId(snapshot.selectedTimelineClipId);
    setTextClips(snapshot.textClips.map((clip) => ({ ...clip })));
    setSelectedTextClipId(snapshot.selectedTextClipId);
    setSelectedTextClipIds(snapshot.selectedTextClipIds.slice());
    setDubbingClips(snapshot.dubbingClips.map((clip) => ({ ...clip })));
    setSelectedDubbingClipId(snapshot.selectedDubbingClipId);
    setBlurMaskClips(snapshot.blurMaskClips.map((clip) => ({ ...clip })));
    setSelectedBlurMaskClipId(snapshot.selectedBlurMaskClipId);
    setCaptionStatus('idle');
    setCaptionError(null);
    setCurrentTime(snapshot.currentTime);
    setSeekCommand((currentCommand) => ({
      id: currentCommand.id + 1,
      time: snapshot.currentTime,
    }));
  };

  const resetHistory = () => {
    setUndoStack([]);
    setRedoStack([]);
    historyGroupRef.current = null;
    copiedTimelineClipIdRef.current = null;

    if (historyGroupTimerRef.current) {
      window.clearTimeout(historyGroupTimerRef.current);
      historyGroupTimerRef.current = null;
    }
  };

  const recordHistory = (label: string, groupKey?: string) => {
    if (groupKey && historyGroupRef.current === groupKey) {
      return;
    }

    if (historyGroupTimerRef.current) {
      window.clearTimeout(historyGroupTimerRef.current);
      historyGroupTimerRef.current = null;
    }

    historyGroupRef.current = groupKey ?? null;

    if (groupKey) {
      historyGroupTimerRef.current = window.setTimeout(() => {
        historyGroupRef.current = null;
        historyGroupTimerRef.current = null;
      }, HISTORY_GROUP_WINDOW_MS);
    }

    const snapshot = createEditorSnapshot();

    setUndoStack((currentStack) => [...currentStack, snapshot].slice(-HISTORY_LIMIT));
    setRedoStack([]);
    setProjectStatus(label);
  };

  const handleUndo = () => {
    if (!canUndo) {
      return;
    }

    const previousSnapshot = undoStack[undoStack.length - 1];

    setUndoStack((currentStack) => currentStack.slice(0, -1));
    setRedoStack((currentStack) => [...currentStack, createEditorSnapshot()].slice(-HISTORY_LIMIT));
    restoreEditorSnapshot(previousSnapshot);
    historyGroupRef.current = null;
    setProjectStatus('Undo');
  };

  const handleRedo = () => {
    if (!canRedo) {
      return;
    }

    const nextSnapshot = redoStack[redoStack.length - 1];

    setRedoStack((currentStack) => currentStack.slice(0, -1));
    setUndoStack((currentStack) => [...currentStack, createEditorSnapshot()].slice(-HISTORY_LIMIT));
    restoreEditorSnapshot(nextSnapshot);
    historyGroupRef.current = null;
    setProjectStatus('Redo');
  };

  const revokeImportedObjectUrls = () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  };

  const resetPlaybackState = () => {
    setCurrentTime(0);
    setSeekCommand((currentCommand) => ({
      id: currentCommand.id + 1,
      time: 0,
    }));
  };

  const resetEditorState = (nextProject: ProjectMetadata) => {
    revokeImportedObjectUrls();
    videoDataUrlCacheRef.current.clear();
    resetHistory();
    setProject(nextProject);
    setProjectNameDraft(nextProject.name);
    setVideos([]);
    setActiveVideoId(null);
    setTimelineClips([]);
    setSelectedTimelineClipId(null);
    setTextClips([]);
    setSelectedTextClipId(null);
    setSelectedTextClipIds([]);
    setDubbingClips([]);
    setSelectedDubbingClipId(null);
    setBlurMaskClips([]);
    setSelectedBlurMaskClipId(null);
    setDubbingStatus('idle');
    setDubbingError(null);
    setCaptionStatus('idle');
    setCaptionError(null);
    setLinkImportStatus('idle');
    setLinkImportError(null);
    setAllInOneStatus('idle');
    setAllInOneStep('');
    setAllInOneError(null);
    setAllInOneResults([]);
    setIsExportPanelOpen(false);
    setReduceOriginalAudioAll(false);
    setExportStatus('idle');
    setExportError(null);
    setExportDownloadUrl(null);
    setExportFileName(null);
    resetPlaybackState();
  };

  const buildCurrentProjectFile = () =>
    buildProjectFile({
      project,
      videos,
      activeVideoId,
      timelineClips,
      selectedTimelineClipId,
      textClips,
      selectedTextClipId,
      dubbingClips,
      blurMaskClips,
      reduceOriginalAudioAll,
      videoDataUrlCache: videoDataUrlCacheRef.current,
    });

  const loadProjectSnapshot = async (projectFile: ProjectFile, status: string) => {
    setIsLoadingProject(true);
    setProjectError(null);

    try {
      revokeImportedObjectUrls();
      videoDataUrlCacheRef.current = new Map(
        projectFile.videos.map((video) => [video.id, video.dataUrl])
      );

      const hydratedProject = await hydrateProjectFile(projectFile, (url) => {
        objectUrlsRef.current.push(url);
      });

      setProject(hydratedProject.project);
      setProjectNameDraft(hydratedProject.project.name);
      setVideos(hydratedProject.videos);
      setActiveVideoId(hydratedProject.activeVideoId);
      setTimelineClips(hydratedProject.timelineClips);
      setSelectedTimelineClipId(hydratedProject.selectedTimelineClipId);
      setTextClips(hydratedProject.textClips);
      setSelectedTextClipId(hydratedProject.selectedTextClipId);
      setSelectedTextClipIds(
        hydratedProject.selectedTextClipId ? [hydratedProject.selectedTextClipId] : []
      );
      setDubbingClips(hydratedProject.dubbingClips);
      setSelectedDubbingClipId(null);
      setBlurMaskClips(hydratedProject.blurMaskClips);
      setReduceOriginalAudioAll(hydratedProject.reduceOriginalAudioAll);
      setSelectedBlurMaskClipId(null);
      setDubbingStatus('idle');
      setDubbingError(null);
      setCaptionStatus('idle');
      setCaptionError(null);
      setLinkImportStatus('idle');
      setLinkImportError(null);
      setAllInOneStatus('idle');
      setAllInOneStep('');
      setAllInOneError(null);
      setAllInOneResults([]);
      setIsExportPanelOpen(false);
      setExportStatus('idle');
      setExportError(null);
      setExportDownloadUrl(null);
      setExportFileName(null);
      setIsProjectReady(true);
      resetHistory();
      setRecentProjectFile(projectFile);
      setProjectStatus(status);
      resetPlaybackState();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Could not open project.');
    } finally {
      setIsLoadingProject(false);
    }
  };

  const handleCreateProject = () => {
    const nextProject = createProjectMetadata(projectNameDraft);

    resetEditorState(nextProject);
    setProjectError(null);
    setProjectStatus('Project ready');
    setIsProjectReady(true);
  };

  const handleOpenProjectFile = async (file: File) => {
    setIsLoadingProject(true);
    setProjectError(null);

    try {
      const text = await file.text();
      const projectFile = parseProjectFileText(text);

      setIsLoadingProject(false);
      await loadProjectSnapshot(projectFile, 'Project opened');
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Could not open project.');
      setIsLoadingProject(false);
    }
  };

  const handleProjectFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      void handleOpenProjectFile(file);
      event.target.value = '';
    }
  };

  const handleOpenRecentProject = () => {
    if (recentProjectFile) {
      void loadProjectSnapshot(recentProjectFile, 'Recent project opened');
    }
  };

  const handleSaveProject = async () => {
    if (!isProjectReady || isSavingProject) {
      return;
    }

    setIsSavingProject(true);
    setProjectError(null);

    try {
      const projectFile = await buildCurrentProjectFile();
      const result = await saveProjectFileToDisk(projectFile);

      if (result === 'cancelled') {
        setProjectStatus('Save cancelled');
        return;
      }

      await saveRecentProjectSnapshot(projectFile);
      setProject(projectFile.project);
      setRecentProjectFile(projectFile);
      setProjectStatus(result === 'downloaded' ? 'Project file downloaded' : 'Project saved');
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Could not save project.');
    } finally {
      setIsSavingProject(false);
    }
  };

  const loadTranslationSettings = async () => {
    setSettingsStatus('loading');
    setSettingsError(null);

    try {
      const loadedSettings = await getTranslationSettings();
      const loadedTelegramSettings = await getTelegramSettings();
      const loadedSttSettings = await getSttSettings();
      const normalizedSettings = {
        ...defaultTranslationSettings,
        ...loadedSettings,
        model: loadedSettings.model || defaultModelForProvider(loadedSettings.provider),
      };
      const normalizedTelegramSettings = {
        ...defaultTelegramSettings,
        ...loadedTelegramSettings,
      };
      const normalizedSttSettings = {
        ...defaultSttSettings,
        ...loadedSttSettings,
      };

      setTranslationSettings(normalizedSettings);
      setTranslationSettingsDraft(normalizedSettings);
      setTelegramSettings(normalizedTelegramSettings);
      setTelegramSettingsDraft(normalizedTelegramSettings);
      setSttSettings(normalizedSttSettings);
      setSttSettingsDraft(normalizedSttSettings);
      setSettingsStatus('idle');
    } catch (error) {
      setSettingsStatus('error');
      setSettingsError(error instanceof Error ? error.message : 'Could not load settings.');
    }
  };

  const handleOpenSettings = () => {
    setTranslationSettingsDraft(translationSettings);
    setTelegramSettingsDraft(telegramSettings);
    setSttSettingsDraft(sttSettings);
    setSettingsTab('translation');
    setTranslationModelsError(null);
    setTranslationModelsStatus('idle');
    setSettingsError(null);
    setSettingsStatus('idle');
    setIsSettingsOpen(true);
  };

  const handleTranslationProviderChange = (provider: TranslationProvider) => {
    if (provider !== '9router') {
      setTranslationModelOptions([]);
      setTranslationModelsError(null);
      setTranslationModelsStatus('idle');
    }

    setTranslationSettingsDraft((currentSettings) => ({
      ...currentSettings,
      provider,
      api_key: provider === 'google_free' ? '' : currentSettings.api_key,
      model: defaultModelForProvider(provider),
    }));
  };

  const handleLoadTranslationModels = async () => {
    if (translationSettingsDraft.provider !== '9router') {
      return;
    }

    if (!translationSettingsDraft.base_url.trim() || !translationSettingsDraft.api_key.trim()) {
      setTranslationModelsStatus('error');
      setTranslationModelsError('Enter API URL and API key first.');
      return;
    }

    setTranslationModelsStatus('loading');
    setTranslationModelsError(null);

    try {
      const result = await getTranslationModels({
        provider: translationSettingsDraft.provider,
        base_url: translationSettingsDraft.base_url,
        api_key: translationSettingsDraft.api_key,
      });

      setTranslationModelOptions(result.models);
      setTranslationModelsStatus('ready');

      const hasCurrentModel = result.models.some(
        (model) => model.id === translationSettingsDraft.model
      );

      if ((!translationSettingsDraft.model || !hasCurrentModel) && result.models[0]) {
        setTranslationSettingsDraft((currentSettings) => ({
          ...currentSettings,
          model: result.models[0].id,
        }));
      }
    } catch (error) {
      setTranslationModelOptions([]);
      setTranslationModelsStatus('error');
      setTranslationModelsError(error instanceof Error ? error.message : 'Could not load models.');
    }
  };

  const handleSaveTranslationSettings = async () => {
    setSettingsStatus('saving');
    setSettingsError(null);

    try {
      const savedSettings = await saveTranslationSettings({
        ...translationSettingsDraft,
        model:
          translationSettingsDraft.model ||
          defaultModelForProvider(translationSettingsDraft.provider),
      });
      const normalizedSettings = {
        ...defaultTranslationSettings,
        ...savedSettings,
      };
      const savedTelegramSettings = await saveTelegramSettings(telegramSettingsDraft);
      const normalizedTelegramSettings = {
        ...defaultTelegramSettings,
        ...savedTelegramSettings,
      };
      const savedSttSettings = await saveSttSettings(sttSettingsDraft);
      const normalizedSttSettings = {
        ...defaultSttSettings,
        ...savedSttSettings,
      };

      setTranslationSettings(normalizedSettings);
      setTranslationSettingsDraft(normalizedSettings);
      setTelegramSettings(normalizedTelegramSettings);
      setTelegramSettingsDraft(normalizedTelegramSettings);
      setSttSettings(normalizedSttSettings);
      setSttSettingsDraft(normalizedSttSettings);
      setSettingsStatus('saved');
      setProjectStatus('Settings saved');
    } catch (error) {
      setSettingsStatus('error');
      setSettingsError(error instanceof Error ? error.message : 'Could not save settings.');
    }
  };

  const startPaneResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    target: PaneResizeTarget
  ) => {
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const startLayout = paneLayout;
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;

    document.body.style.cursor = target === 'timeline' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setPaneLayout((currentLayout) => {
        if (target === 'sidebar') {
          return {
            ...currentLayout,
            sidebarWidth: clamp(
              startLayout.sidebarWidth + moveEvent.clientX - startX,
              MIN_SIDEBAR_WIDTH,
              MAX_SIDEBAR_WIDTH
            ),
          };
        }

        if (target === 'properties') {
          return {
            ...currentLayout,
            propertiesWidth: clamp(
              startLayout.propertiesWidth - (moveEvent.clientX - startX),
              MIN_PROPERTIES_WIDTH,
              MAX_PROPERTIES_WIDTH
            ),
          };
        }

        return {
          ...currentLayout,
          timelineHeight: clamp(
            startLayout.timelineHeight - (moveEvent.clientY - startY),
            MIN_TIMELINE_HEIGHT,
            clamp(window.innerHeight - 220, MIN_TIMELINE_HEIGHT, MAX_TIMELINE_HEIGHT)
          ),
        };
      });
    };

    const stopResize = () => {
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  const handleImportVideos = (files: FileList) => {
    const importedVideos = Array.from(files)
      .filter((file) => file.type.startsWith('video/'))
      .map((file) => {
        const url = URL.createObjectURL(file);
        objectUrlsRef.current.push(url);

        return {
          id: crypto.randomUUID(),
          name: file.name,
          file,
          url,
          size: file.size,
          type: file.type || 'video',
          duration: null,
          width: null,
          height: null,
          importedAt: Date.now(),
          uploadStatus: 'idle',
          voiceIsolationStatus: 'idle',
        } satisfies ImportedVideo;
      });

    if (importedVideos.length === 0) {
      return;
    }

    recordHistory('Imported media');
    setVideos((currentVideos) => [...importedVideos, ...currentVideos]);
    setActiveVideoId(importedVideos[0].id);
  };

  const downloadLinkVideoToImportedVideo = async (sourceUrl: string): Promise<ImportedVideo> => {
    const downloaded = await downloadVideoFromLink(sourceUrl);
    const mediaResponse = await fetch(downloaded.download_url);

    if (!mediaResponse.ok) {
      throw new Error('Downloaded video could not be loaded for preview.');
    }

    const blob = await mediaResponse.blob();
    const extension = downloaded.filename.match(/\.[a-z0-9]+$/i)?.[0] ?? '.mp4';
    const nameBase = (downloaded.title || downloaded.filename || 'downloaded-video').replace(/\.[a-z0-9]+$/i, '');
    const fileName = sanitizeDownloadFileName(
      nameBase,
      extension
    );
    const importedAt = Date.now();
    const file = new File([blob], fileName, {
      type: blob.type || 'video/mp4',
      lastModified: importedAt,
    });
    const previewUrl = URL.createObjectURL(file);
    objectUrlsRef.current.push(previewUrl);

    return {
      id: crypto.randomUUID(),
      name: fileName,
      file,
      url: previewUrl,
      size: downloaded.size || file.size,
      type: file.type || 'video/mp4',
      duration: downloaded.duration || null,
      width: downloaded.width ?? null,
      height: downloaded.height ?? null,
      importedAt,
      backendProjectId: downloaded.project_id,
      backendVideoPath: downloaded.video_path,
      uploadStatus: 'ready',
      voiceIsolationStatus: 'idle',
    };
  };

  const handleImportVideoLink = async (url: string) => {
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setLinkImportStatus('error');
      setLinkImportError('Enter a Douyin/TikTok/Youtube video link.');
      return;
    }

    setLinkImportStatus('downloading');
    setLinkImportError(null);

    try {
      const importedVideo = await downloadLinkVideoToImportedVideo(trimmedUrl);

      recordHistory('Imported link video');
      setVideos((currentVideos) => [importedVideo, ...currentVideos]);
      setActiveVideoId(importedVideo.id);
      setLinkImportStatus('ready');
      setProjectStatus('Imported link video');
    } catch (error) {
      setLinkImportStatus('error');
      setLinkImportError(error instanceof Error ? error.message : 'Download video failed.');
    }
  };

  const createSubtitleTextClip = (
    ownerClip: TimelineVideoClip,
    cue: ParsedSrtCue,
    localStart: number,
    localEnd: number
  ): TextClip | null => {
    const ownerDuration = Math.max(
      MIN_TEXT_CLIP_DURATION,
      ownerClip.end - ownerClip.start
    );
    const start = clamp(
      localStart,
      0,
      Math.max(0, ownerDuration - MIN_TEXT_CLIP_DURATION)
    );
    const end = clamp(
      Math.max(localEnd, start + MIN_TEXT_CLIP_DURATION),
      start + MIN_TEXT_CLIP_DURATION,
      ownerDuration
    );

    if (end <= start) {
      return null;
    }

    const ownerVideo = videos.find((video) => video.id === ownerClip.videoId) ?? timelineVideo;
    const captionStyle = getAutoCaptionStyle(cue.text, ownerVideo);

    return {
      id: crypto.randomUUID(),
      timelineClipId: ownerClip.id,
      text: captionStyle.text,
      start,
      end,
      x: captionStyle.x,
      y: captionStyle.y,
      fontFamily: DEFAULT_TEXT_FONT,
      fontSize: captionStyle.fontSize,
      fontWeight: DEFAULT_TEXT_WEIGHT,
      fontStyle: DEFAULT_TEXT_STYLE,
      color: DEFAULT_TEXT_COLOR,
      strokeColor: DEFAULT_TEXT_STROKE_COLOR,
      strokeWidth: DEFAULT_TEXT_STROKE_WIDTH,
      backgroundColor: DEFAULT_TEXT_BACKGROUND_COLOR,
      backgroundOpacity: DEFAULT_TEXT_BACKGROUND_OPACITY,
      source: 'caption',
    };
  };

  const mapSrtCuesToTimeline = (cues: ParsedSrtCue[]) => {
    const sortedTimelineClips = timelineClips
      .slice()
      .sort((a, b) => a.start - b.start);
    const importedTextClips: TextClip[] = [];

    cues.forEach((cue) => {
      sortedTimelineClips.forEach((timelineClip) => {
        const overlapStart = Math.max(cue.start, timelineClip.start);
        const overlapEnd = Math.min(cue.end, timelineClip.end);

        if (overlapEnd <= overlapStart) {
          return;
        }

        const textClip = createSubtitleTextClip(
          timelineClip,
          cue,
          overlapStart - timelineClip.start,
          overlapEnd - timelineClip.start
        );

        if (textClip) {
          importedTextClips.push(textClip);
        }
      });
    });

    return importedTextClips;
  };

  const handleImportSubtitles = async (file: File) => {
    if (timelineClips.length === 0) {
      setCaptionStatus('error');
      setCaptionError('Drag a video to the timeline before importing subtitles.');
      return;
    }

    try {
      const cues = parseSrtFileText(await file.text());

      if (cues.length === 0) {
        throw new Error('No valid subtitle cues found in this file.');
      }

      const importedTextClips = mapSrtCuesToTimeline(cues);

      if (importedTextClips.length === 0) {
        throw new Error('Subtitle timing does not overlap the current timeline.');
      }

      recordHistory('Imported subtitles');
      const firstOwnerClip = timelineClips.find(
        (clip) => clip.id === importedTextClips[0].timelineClipId
      );

      setTextClips((currentClips) => [...currentClips, ...importedTextClips]);
      setSelectedTextClipId(importedTextClips[0].id);
      setSelectedTextClipIds([importedTextClips[0].id]);
      setSelectedDubbingClipId(null);
      setSelectedTimelineClipId(importedTextClips[0].timelineClipId);
      setActiveVideoId(firstOwnerClip?.videoId ?? activeVideoId);
      setCaptionStatus('ready');
      setCaptionError(null);
      setProjectStatus(`Imported ${importedTextClips.length} subtitles`);
    } catch (error) {
      setCaptionStatus('error');
      setCaptionError(error instanceof Error ? error.message : 'Import subtitles failed.');
    }
  };

  const handleAddVideoToTimeline = (videoId: string) => {
    const video = videos.find((currentVideo) => currentVideo.id === videoId);
    const start = timelineClips.reduce(
      (maxEnd, clip) => Math.max(maxEnd, clip.end),
      0
    );
    const duration = video?.duration && video.duration > 0 ? video.duration : 10;
    const clip: TimelineVideoClip = {
      id: crypto.randomUUID(),
      videoId,
      start,
      end: start + duration,
      sourceStart: 0,
      sourceEnd: duration,
    };

    recordHistory('Added clip to timeline');
    setTimelineClips((currentClips) => [...currentClips, clip]);
    setSelectedTimelineClipId(clip.id);
    setActiveVideoId(videoId);
    setSelectedTextClipId(null);
    setSelectedTextClipIds([]);
    setSelectedDubbingClipId(null);
    setCurrentTime(0);
    setSeekCommand((currentCommand) => ({
      id: currentCommand.id + 1,
      time: 0,
    }));
  };

  const handleDurationChange = (
    videoId: string,
    duration: number,
    width?: number,
    height?: number
  ) => {
    setVideos((currentVideos) =>
      currentVideos.map((video) =>
        video.id === videoId
          ? {
              ...video,
              duration,
              width: width && width > 0 ? width : video.width,
              height: height && height > 0 ? height : video.height,
            }
          : video
      )
    );

    setTimelineClips((currentClips) => {
      let cursor = 0;

      const nextClips = currentClips.map((clip) => {
        const currentDuration = Math.max(MIN_VIDEO_CLIP_DURATION, clip.end - clip.start);
        const isUntrimmedClip =
          clip.videoId === videoId &&
          clip.sourceStart === 0 &&
          Math.abs((clip.sourceEnd ?? currentDuration) - currentDuration) < 0.05;
        const clipDuration = isUntrimmedClip ? duration : currentDuration;
        const nextClip = {
          ...clip,
          start: cursor,
          end: cursor + clipDuration,
          sourceEnd: isUntrimmedClip ? duration : clip.sourceEnd,
        };
        cursor = nextClip.end;
        return nextClip;
      });
      const clipShiftMap = buildTimelineClipShiftMap(currentClips, nextClips);

      setDubbingClips((currentDubbingClips) =>
        currentDubbingClips.map((clip) => {
          const shift = clipShiftMap.get(clip.timelineClipId) ?? 0;

          return shift
            ? { ...clip, start: clip.start + shift, end: clip.end + shift }
            : clip;
        })
      );

      return nextClips;
    });
  };

  const handleDeleteTextClip = (clipId: string) => {
    handleDeleteTextClips([clipId]);
  };

  const handleDeleteTimelineClip = (clipId: string) => {
    const deletedClipIndex = timelineClips.findIndex((clip) => clip.id === clipId);

    if (deletedClipIndex < 0) {
      return;
    }

    recordHistory('Deleted timeline clip');
    const nextSelectedClip =
      timelineClips[deletedClipIndex + 1] ??
      timelineClips[deletedClipIndex - 1] ??
      null;
    const deletedTextClipIds = new Set(
      textClips
        .filter((clip) => clip.timelineClipId === clipId)
        .map((clip) => clip.id)
    );
    const nextTimelineClips = reflowTimelineClips(timelineClips.filter((clip) => clip.id !== clipId));
    const clipShiftMap = buildTimelineClipShiftMap(timelineClips, nextTimelineClips);

    setTimelineClips(nextTimelineClips);
    setTextClips((currentClips) =>
      currentClips.filter((clip) => clip.timelineClipId !== clipId)
    );
    setDubbingClips((currentClips) =>
      currentClips.flatMap((clip) => {
        if (clip.timelineClipId === clipId || deletedTextClipIds.has(clip.textClipId)) {
          return [];
        }

        const shift = clipShiftMap.get(clip.timelineClipId) ?? 0;

        return [{
          ...clip,
          start: clip.start + shift,
          end: clip.end + shift,
        }];
      })
    );
    setBlurMaskClips((currentClips) =>
      currentClips.filter((clip) => clip.timelineClipId !== clipId)
    );
    setSelectedBlurMaskClipId((currentClipId) => {
      const deletedMaskClipIds = new Set(
        blurMaskClips
          .filter((clip) => clip.timelineClipId === clipId)
          .map((clip) => clip.id)
      );

      return currentClipId && deletedMaskClipIds.has(currentClipId) ? null : currentClipId;
    });
    setSelectedTextClipIds((currentClipIds) =>
      currentClipIds.filter((currentClipId) => !deletedTextClipIds.has(currentClipId))
    );
    setSelectedTextClipId((currentClipId) =>
      currentClipId && deletedTextClipIds.has(currentClipId) ? null : currentClipId
    );
    setSelectedDubbingClipId((currentClipId) => {
      const deletedDubbingClipIds = new Set(
        dubbingClips
          .filter((clip) => clip.timelineClipId === clipId || deletedTextClipIds.has(clip.textClipId))
          .map((clip) => clip.id)
      );

      return currentClipId && deletedDubbingClipIds.has(currentClipId) ? null : currentClipId;
    });
    setSelectedTimelineClipId(nextSelectedClip?.id ?? null);
    setActiveVideoId(nextSelectedClip?.videoId ?? null);
    setCurrentTime(0);
    setSeekCommand((currentCommand) => ({
      id: currentCommand.id + 1,
      time: 0,
    }));
  };

  const handleSplitTimelineClip = (clipId = selectedTimelineClipId) => {
    if (!clipId) {
      return;
    }

    const clipIndex = timelineClips.findIndex((clip) => clip.id === clipId);
    const clip = timelineClips[clipIndex];

    if (!clip) {
      return;
    }

    const splitAt = Math.max(clip.start, Math.min(timelineCurrentTime, clip.end));
    const leftDuration = splitAt - clip.start;
    const rightDuration = clip.end - splitAt;

    if (leftDuration < MIN_VIDEO_CLIP_DURATION || rightDuration < MIN_VIDEO_CLIP_DURATION) {
      setProjectStatus('Move playhead inside the clip to split');
      return;
    }

    const rightClipId = crypto.randomUUID();
    const sourceSplitAt = clip.sourceStart + leftDuration;
    const leftClip: TimelineVideoClip = {
      ...clip,
      end: splitAt,
      sourceEnd: sourceSplitAt,
    };
    const rightClip: TimelineVideoClip = {
      ...clip,
      id: rightClipId,
      start: splitAt,
      sourceStart: sourceSplitAt,
      sourceEnd: clip.sourceEnd,
    };
    const nextTextClips: TextClip[] = [];
    const nextBlurMaskClips: BlurMaskClip[] = [];
    const nextDubbingClips: DubbingClip[] = [];

    textClips.forEach((textClip) => {
      if (textClip.timelineClipId !== clip.id) {
        nextTextClips.push(textClip);
        return;
      }

      if (textClip.end <= leftDuration) {
        nextTextClips.push(textClip);
        return;
      }

      if (textClip.start >= leftDuration) {
        nextTextClips.push({
          ...textClip,
          timelineClipId: rightClipId,
          start: textClip.start - leftDuration,
          end: textClip.end - leftDuration,
        });
        return;
      }

      nextTextClips.push({
        ...textClip,
        end: leftDuration,
      });
      nextTextClips.push({
        ...textClip,
        id: crypto.randomUUID(),
        timelineClipId: rightClipId,
        start: 0,
        end: textClip.end - leftDuration,
      });
    });

    blurMaskClips.forEach((maskClip) => {
      if (maskClip.timelineClipId !== clip.id) {
        nextBlurMaskClips.push(maskClip);
        return;
      }

      if (maskClip.end <= leftDuration) {
        nextBlurMaskClips.push(maskClip);
        return;
      }

      if (maskClip.start >= leftDuration) {
        nextBlurMaskClips.push({
          ...maskClip,
          timelineClipId: rightClipId,
          start: maskClip.start - leftDuration,
          end: maskClip.end - leftDuration,
        });
        return;
      }

      nextBlurMaskClips.push({
        ...maskClip,
        end: leftDuration,
      });
      nextBlurMaskClips.push({
        ...maskClip,
        id: crypto.randomUUID(),
        timelineClipId: rightClipId,
        start: 0,
        end: maskClip.end - leftDuration,
      });
    });

    dubbingClips.forEach((dubbingClip) => {
      if (dubbingClip.timelineClipId !== clip.id) {
        nextDubbingClips.push(dubbingClip);
        return;
      }

      if (dubbingClip.end <= splitAt) {
        nextDubbingClips.push(dubbingClip);
        return;
      }

      if (dubbingClip.start >= splitAt) {
        nextDubbingClips.push({
          ...dubbingClip,
          timelineClipId: rightClipId,
        });
        return;
      }

      nextDubbingClips.push({
        ...dubbingClip,
        end: splitAt,
      });
      nextDubbingClips.push({
        ...dubbingClip,
        id: crypto.randomUUID(),
        timelineClipId: rightClipId,
        start: splitAt,
        end: dubbingClip.end,
      });
    });

    recordHistory('Split clip');
    setTimelineClips((currentClips) => [
      ...currentClips.slice(0, clipIndex),
      leftClip,
      rightClip,
      ...currentClips.slice(clipIndex + 1),
    ]);
    setTextClips(nextTextClips);
    setBlurMaskClips(nextBlurMaskClips);
    setDubbingClips(nextDubbingClips);
    setSelectedTimelineClipId(rightClipId);
    setSelectedTextClipId(null);
    setSelectedTextClipIds([]);
    setSelectedDubbingClipId(null);
    setCurrentTime(0);
    setSeekCommand((currentCommand) => ({
      id: currentCommand.id + 1,
      time: 0,
    }));
  };

  const duplicateTimelineClip = (clipId: string) => {
    const clipIndex = timelineClips.findIndex((clip) => clip.id === clipId);
    const clip = timelineClips[clipIndex];

    if (!clip) {
      return;
    }

    const duration = Math.max(MIN_VIDEO_CLIP_DURATION, clip.end - clip.start);
    const duplicatedClipId = crypto.randomUUID();
    const duplicatedClip: TimelineVideoClip = {
      ...clip,
      id: duplicatedClipId,
      start: clip.end,
      end: clip.end + duration,
    };
    const duplicatedTextClipIdBySourceId = new Map<string, string>();
    const duplicatedTextClips = textClips
      .filter((textClip) => textClip.timelineClipId === clip.id)
      .map((textClip) => {
        const duplicatedTextClipId = crypto.randomUUID();
        duplicatedTextClipIdBySourceId.set(textClip.id, duplicatedTextClipId);

        return {
          ...textClip,
          id: duplicatedTextClipId,
          timelineClipId: duplicatedClipId,
        };
      });
    const duplicatedBlurMaskClips = blurMaskClips
      .filter((maskClip) => maskClip.timelineClipId === clip.id)
      .map((maskClip) => ({
        ...maskClip,
        id: crypto.randomUUID(),
        timelineClipId: duplicatedClipId,
      }));
    const duplicatedDubbingClips = dubbingClips
      .filter((dubbingClip) => dubbingClip.timelineClipId === clip.id)
      .map((dubbingClip) => ({
        ...dubbingClip,
        id: crypto.randomUUID(),
        timelineClipId: duplicatedClipId,
        textClipId: duplicatedTextClipIdBySourceId.get(dubbingClip.textClipId) ?? dubbingClip.textClipId,
        start: dubbingClip.start + duration,
        end: dubbingClip.end + duration,
      }));
    const shiftedTimelineClipIds = new Set(
      timelineClips.slice(clipIndex + 1).map((currentClip) => currentClip.id)
    );

    recordHistory('Duplicated clip');
    setTimelineClips((currentClips) => [
      ...currentClips.slice(0, clipIndex + 1),
      duplicatedClip,
      ...currentClips.slice(clipIndex + 1).map((currentClip) => ({
        ...currentClip,
        start: currentClip.start + duration,
        end: currentClip.end + duration,
      })),
    ]);
    setTextClips((currentTextClips) => [...currentTextClips, ...duplicatedTextClips]);
    setBlurMaskClips((currentMaskClips) => [...currentMaskClips, ...duplicatedBlurMaskClips]);
    setDubbingClips((currentDubbingClips) => [
      ...currentDubbingClips.map((dubbingClip) =>
        shiftedTimelineClipIds.has(dubbingClip.timelineClipId)
          ? {
              ...dubbingClip,
              start: dubbingClip.start + duration,
              end: dubbingClip.end + duration,
            }
          : dubbingClip
      ),
      ...duplicatedDubbingClips,
    ]);
    setSelectedTimelineClipId(duplicatedClipId);
    setActiveVideoId(duplicatedClip.videoId);
    setSelectedTextClipId(null);
    setSelectedTextClipIds([]);
    setSelectedDubbingClipId(null);
    setCurrentTime(0);
    setSeekCommand((currentCommand) => ({
      id: currentCommand.id + 1,
      time: 0,
    }));
  };

  const handleDuplicateTimelineClip = (clipId = selectedTimelineClipId) => {
    if (clipId) {
      duplicateTimelineClip(clipId);
    }
  };

  const handleCopyTimelineClip = (clipId = selectedTimelineClipId) => {
    if (!clipId) {
      return;
    }

    copiedTimelineClipIdRef.current = clipId;
    setProjectStatus('Clip copied');
  };

  const handlePasteTimelineClip = () => {
    if (copiedTimelineClipIdRef.current) {
      duplicateTimelineClip(copiedTimelineClipIdRef.current);
    }
  };

  const applyTextSelection = (clipIds: string[]) => {
    const existingClipIds = new Set(textClips.map((clip) => clip.id));
    const nextSelectedIds = Array.from(new Set(clipIds)).filter((clipId) =>
      existingClipIds.has(clipId)
    );
    const primaryTextClipId = nextSelectedIds[0] ?? null;

    setSelectedTextClipIds(nextSelectedIds);
    setSelectedTextClipId(primaryTextClipId);
    setSelectedBlurMaskClipId(null);
    setSelectedDubbingClipId(null);

    if (!primaryTextClipId) {
      return;
    }

    const primaryTextClip = textClips.find((clip) => clip.id === primaryTextClipId);
    const ownerClip = primaryTextClip
      ? timelineClips.find((clip) => clip.id === primaryTextClip.timelineClipId)
      : null;

    if (ownerClip) {
      setSelectedTimelineClipId(ownerClip.id);
      setActiveVideoId(ownerClip.videoId);
    }
  };

  const handleSelectTextClip = (
    clipId: string,
    mode: 'single' | 'toggle' | 'add' = 'single'
  ) => {
    const currentSelection = selectedTextClipIds.length > 0
      ? selectedTextClipIds
      : selectedTextClipId
        ? [selectedTextClipId]
        : [];

    if (mode === 'toggle') {
      applyTextSelection(
        currentSelection.includes(clipId)
          ? currentSelection.filter((currentClipId) => currentClipId !== clipId)
          : [...currentSelection, clipId]
      );
      return;
    }

    if (mode === 'add') {
      applyTextSelection([...currentSelection, clipId]);
      return;
    }

    applyTextSelection([clipId]);
  };

  const handleSelectTextClips = (clipIds: string[]) => {
    applyTextSelection(clipIds);
  };

  const handleDeleteTextClips = (clipIds: string[]) => {
    const deletedClipIds = new Set(clipIds);

    if (deletedClipIds.size === 0) {
      return;
    }

    const nextSelectedTextClipIds = selectedTextClipIds.filter(
      (clipId) => !deletedClipIds.has(clipId)
    );

    recordHistory(deletedClipIds.size > 1 ? 'Deleted text group' : 'Deleted text');
    setTextClips((currentClips) => currentClips.filter((clip) => !deletedClipIds.has(clip.id)));
    setDubbingClips((currentClips) =>
      currentClips.filter((clip) => !deletedClipIds.has(clip.textClipId))
    );
    setSelectedDubbingClipId((currentClipId) => {
      const deletedDubbingClipIds = new Set(
        dubbingClips
          .filter((clip) => deletedClipIds.has(clip.textClipId))
          .map((clip) => clip.id)
      );

      return currentClipId && deletedDubbingClipIds.has(currentClipId) ? null : currentClipId;
    });
    setSelectedTextClipIds(nextSelectedTextClipIds);
    setSelectedTextClipId((currentClipId) =>
      currentClipId && !deletedClipIds.has(currentClipId)
        ? currentClipId
        : nextSelectedTextClipIds[0] ?? null
    );
  };

  const handleDeleteSelectedTextClips = () => {
    const clipIds = selectedTextClipIds.length > 0
      ? selectedTextClipIds
      : selectedTextClip
        ? [selectedTextClip.id]
        : [];

    handleDeleteTextClips(clipIds);
  };

  const handleSelectDubbingClip = (clipId: string) => {
    const dubbingClip = dubbingClips.find((clip) => clip.id === clipId);

    if (!dubbingClip) {
      return;
    }

    const ownerClip =
      timelineClips.find((clip) => dubbingClip.start >= clip.start && dubbingClip.start < clip.end) ??
      timelineClips.find((clip) => clip.id === dubbingClip.timelineClipId) ??
      null;

    setSelectedDubbingClipId(clipId);
    setSelectedTextClipId(null);
    setSelectedTextClipIds([]);
    setSelectedBlurMaskClipId(null);

    if (ownerClip) {
      const nextTime = clamp(dubbingClip.start - ownerClip.start, 0, ownerClip.end - ownerClip.start);
      setSelectedTimelineClipId(ownerClip.id);
      setActiveVideoId(ownerClip.videoId);
      setCurrentTime(nextTime);
      setSeekCommand((currentCommand) => ({
        id: currentCommand.id + 1,
        time: nextTime,
      }));
    }
  };

  const handleUpdateDubbingClip = (clipId: string, patch: Partial<DubbingClip>) => {
    const currentClip = dubbingClips.find((clip) => clip.id === clipId);

    if (!currentClip) {
      return;
    }

    const maxTimelineDuration = Math.max(
      MIN_TEXT_CLIP_DURATION,
      timelineDuration,
      currentClip.end
    );
    const shouldClampTime = patch.start !== undefined || patch.end !== undefined;
    let nextStart = patch.start ?? currentClip.start;
    let nextEnd = patch.end ?? currentClip.end;

    if (shouldClampTime) {
      nextStart = clamp(nextStart, 0, Math.max(0, maxTimelineDuration - MIN_TEXT_CLIP_DURATION));
      nextEnd = clamp(nextEnd, nextStart + MIN_TEXT_CLIP_DURATION, maxTimelineDuration);
    }

    const ownerClip =
      timelineClips.find((clip) => nextStart >= clip.start && nextStart < clip.end) ??
      timelineClips.find((clip) => clip.id === currentClip.timelineClipId) ??
      null;

    recordHistory(
      'Edited audio',
      `audio:${clipId}:${Object.keys(patch).sort().join(',') || 'clip'}`
    );
    setDubbingClips((currentClips) =>
      currentClips.map((clip) =>
        clip.id === clipId
          ? {
              ...clip,
              ...patch,
              start: shouldClampTime ? nextStart : clip.start,
              end: shouldClampTime ? nextEnd : clip.end,
              timelineClipId: ownerClip?.id ?? clip.timelineClipId,
              volume: clamp(patch.volume ?? clip.volume ?? 1, 0, 2),
              speed: clamp(patch.speed ?? clip.speed ?? 1, 0.5, 2),
            }
          : clip
      )
    );
  };

  const handleDeleteDubbingClip = (clipId: string) => {
    if (!dubbingClips.some((clip) => clip.id === clipId)) {
      return;
    }

    recordHistory('Deleted audio');
    setDubbingClips((currentClips) => currentClips.filter((clip) => clip.id !== clipId));
    setSelectedDubbingClipId((currentClipId) => (currentClipId === clipId ? null : currentClipId));
  };

  const handleDeleteSelection = () => {
    if (selectedBlurMaskClipId) {
      handleDeleteBlurMaskClip(selectedBlurMaskClipId);
      return;
    }

    if (selectedDubbingClip) {
      handleDeleteDubbingClip(selectedDubbingClip.id);
      return;
    }

    if (selectedTextClipIds.length > 0 || selectedTextClip) {
      handleDeleteSelectedTextClips();
      return;
    }

    if (selectedTimelineClip) {
      handleDeleteTimelineClip(selectedTimelineClip.id);
    }
  };

  const updateVideo = (videoId: string, patch: Partial<ImportedVideo>) => {
    setVideos((currentVideos) =>
      currentVideos.map((video) =>
        video.id === videoId ? { ...video, ...patch } : video
      )
    );
  };

  const handleSeek = (time: number) => {
    const clipAtTime = timelineClips.find(
      (clip) => time >= clip.start && time < clip.end
    );
    const nextSelectedClip =
      clipAtTime ??
      timelineClips.find((clip) => time === clip.end) ??
      selectedTimelineClip;

    if (!nextSelectedClip) {
      return;
    }

    const clipDuration = Math.max(0.2, nextSelectedClip.end - nextSelectedClip.start);
    const nextTime = Math.max(
      0,
      Math.min(time - nextSelectedClip.start, clipDuration)
    );

    setSelectedTimelineClipId(nextSelectedClip.id);
    setActiveVideoId(nextSelectedClip.videoId);

    setCurrentTime(nextTime);
    setSeekCommand((currentCommand) => ({
      id: currentCommand.id + 1,
      time: nextTime,
    }));
  };

  const handleTimelineClipEnded = () => {
    if (!selectedTimelineClip) {
      return false;
    }

    const selectedClipIndex = timelineClips.findIndex(
      (clip) => clip.id === selectedTimelineClip.id
    );
    const nextClip = selectedClipIndex >= 0
      ? timelineClips[selectedClipIndex + 1]
      : null;

    if (!nextClip) {
      setCurrentTime(Math.max(0, selectedTimelineClip.end - selectedTimelineClip.start));
      return false;
    }

    setSelectedTimelineClipId(nextClip.id);
    setActiveVideoId(nextClip.videoId);
    setCurrentTime(0);
    setSeekCommand((currentCommand) => ({
      id: currentCommand.id + 1,
      time: 0,
    }));
    return true;
  };

  const handleAddTextClip = () => {
    if (!timelineVideo || !selectedTimelineClip) {
      return;
    }

    const duration = Math.max(
      MIN_TEXT_CLIP_DURATION,
      selectedTimelineClip.end - selectedTimelineClip.start
    );
    const start = Math.max(0, Math.min(currentTime, duration - MIN_TEXT_CLIP_DURATION));
    const end = Math.min(duration, start + 3);
    const clip: TextClip = {
      id: crypto.randomUUID(),
      timelineClipId: selectedTimelineClip.id,
      text: 'Nhập nội dung text',
      start,
      end: Math.max(end, start + 0.5),
      x: 50,
      y: 78,
      fontFamily: DEFAULT_TEXT_FONT,
      fontSize: DEFAULT_TEXT_SIZE,
      fontWeight: DEFAULT_TEXT_WEIGHT,
      fontStyle: DEFAULT_TEXT_STYLE,
      color: DEFAULT_TEXT_COLOR,
      strokeColor: DEFAULT_TEXT_STROKE_COLOR,
      strokeWidth: DEFAULT_TEXT_STROKE_WIDTH,
      backgroundColor: DEFAULT_TEXT_BACKGROUND_COLOR,
      backgroundOpacity: DEFAULT_TEXT_BACKGROUND_OPACITY,
      source: 'manual',
    };

    recordHistory('Added text');
    setTextClips((currentClips) => [...currentClips, clip]);
    setSelectedTextClipId(clip.id);
    setSelectedTextClipIds([clip.id]);
    setSelectedDubbingClipId(null);
    setSelectedBlurMaskClipId(null);
  };

  const handleAddBlurMaskClip = () => {
    if (!timelineVideo || !selectedTimelineClip) {
      return;
    }

    const duration = Math.max(
      MIN_TEXT_CLIP_DURATION,
      selectedTimelineClip.end - selectedTimelineClip.start
    );
    const start = clamp(currentTime, 0, Math.max(0, duration - MIN_TEXT_CLIP_DURATION));
    const clip: BlurMaskClip = {
      id: crypto.randomUUID(),
      timelineClipId: selectedTimelineClip.id,
      start,
      end: duration,
      x: 50,
      y: 82,
      width: 82,
      height: 13,
      intensity: 16,
      mode: 'blur',
      source: 'manual',
    };

    recordHistory('Added blur mask');
    setBlurMaskClips((currentClips) => [...currentClips, clip]);
    setSelectedTextClipId(null);
    setSelectedTextClipIds([]);
    setSelectedDubbingClipId(null);
    setSelectedBlurMaskClipId(clip.id);
  };

  const handleUpdateBlurMaskClip = (clipId: string, patch: Partial<BlurMaskClip>) => {
    const currentClip = blurMaskClips.find((clip) => clip.id === clipId);
    const ownerClip = currentClip
      ? timelineClips.find((clip) => clip.id === currentClip.timelineClipId)
      : null;

    if (!currentClip || !ownerClip) {
      return;
    }

    const clipDuration = Math.max(MIN_TEXT_CLIP_DURATION, ownerClip.end - ownerClip.start);
    const nextStart = clamp(
      patch.start ?? currentClip.start,
      0,
      Math.max(0, clipDuration - MIN_TEXT_CLIP_DURATION)
    );
    const nextEnd = clamp(
      patch.end ?? currentClip.end,
      nextStart + MIN_TEXT_CLIP_DURATION,
      clipDuration
    );

    recordHistory('Updated blur mask', `blur-mask-${clipId}`);
    setBlurMaskClips((currentClips) =>
      currentClips.map((clip) =>
        clip.id === clipId
          ? {
              ...clip,
              ...patch,
              start: nextStart,
              end: nextEnd,
              x: clamp(patch.x ?? clip.x, 0, 100),
              y: clamp(patch.y ?? clip.y, 0, 100),
              width: clamp(patch.width ?? clip.width, 3, 100),
              height: clamp(patch.height ?? clip.height, 3, 100),
              intensity: clamp(patch.intensity ?? clip.intensity, 2, 60),
              opacity: clamp(patch.opacity ?? clip.opacity ?? 1, 0, 1),
            }
          : clip
      )
    );
  };

  const handleSelectBlurMaskClip = (clipId: string) => {
    const maskClip = blurMaskClips.find((clip) => clip.id === clipId);
    const ownerClip = maskClip
      ? timelineClips.find((clip) => clip.id === maskClip.timelineClipId)
      : null;

    if (!maskClip || !ownerClip) {
      return;
    }

    setSelectedBlurMaskClipId(clipId);
    setSelectedTimelineClipId(ownerClip.id);
    setActiveVideoId(ownerClip.videoId);
    setSelectedTextClipId(null);
    setSelectedTextClipIds([]);
    setSelectedDubbingClipId(null);
  };

  const handleDeleteBlurMaskClip = (clipId: string) => {
    if (!blurMaskClips.some((clip) => clip.id === clipId)) {
      return;
    }

    recordHistory('Deleted blur mask');
    setBlurMaskClips((currentClips) => currentClips.filter((clip) => clip.id !== clipId));
    setSelectedBlurMaskClipId((currentClipId) => (currentClipId === clipId ? null : currentClipId));
  };

  const handleUpdateTextClip = (clipId: string, patch: Partial<TextClip>) => {
    recordHistory(
      'Edited text',
      `text:${clipId}:${Object.keys(patch).sort().join(',') || 'style'}`
    );
    setTextClips((currentClips) =>
      currentClips.map((clip) => {
        if (clip.id !== clipId) {
          return clip;
        }

        const nextClip = { ...clip, ...patch };

        if (patch.end === undefined && patch.start === undefined) {
          return nextClip;
        }

        const ownerClip = timelineClips.find(
          (timelineClip) => timelineClip.id === clip.timelineClipId
        );
        const maxDuration = Math.max(
          MIN_TEXT_CLIP_DURATION,
          ownerClip ? ownerClip.end - ownerClip.start : nextClip.end
        );
        const nextStart = Math.max(
          0,
          Math.min(nextClip.start, maxDuration - MIN_TEXT_CLIP_DURATION)
        );
        const nextEnd = Math.max(
          nextStart + MIN_TEXT_CLIP_DURATION,
          Math.min(nextClip.end, maxDuration)
        );

        return {
          ...nextClip,
          start: nextStart,
          end: nextEnd,
        };
      })
    );
  };

  const handleUpdateSelectedTextClips = (patch: Partial<TextClip>) => {
    const targetClipIds = selectedTextClipIds.length > 0
      ? selectedTextClipIds
      : selectedTextClip
        ? [selectedTextClip.id]
        : [];

    if (targetClipIds.length === 0) {
      return;
    }

    if (targetClipIds.length === 1) {
      handleUpdateTextClip(targetClipIds[0], patch);
      return;
    }

    const targetClipIdSet = new Set(targetClipIds);

    recordHistory(
      'Edited text group',
      `text-group:${targetClipIds.join(',')}:${Object.keys(patch).sort().join(',') || 'style'}`
    );
    setTextClips((currentClips) =>
      currentClips.map((clip) =>
        targetClipIdSet.has(clip.id) ? { ...clip, ...patch } : clip
      )
    );
  };

  const buildDubbingSegmentPayloads = (clips: TextClip[]): DubbingSegmentPayload[] =>
    clips.flatMap((clip) => {
      const ownerClip = timelineClips.find(
        (timelineClip) => timelineClip.id === clip.timelineClipId
      );

      if (!ownerClip) {
        return [];
      }

      const start = ownerClip.start + clip.start;
      const end = ownerClip.start + clip.end;
      const duration = Math.max(MIN_TEXT_CLIP_DURATION, end - start);
      const text = clip.text.trim().replace(/\s+/g, ' ');

      if (!text) {
        return [];
      }

      return [{
        id: clip.id,
        timeline_clip_id: clip.timelineClipId,
        text,
        start,
        end,
        duration,
      }];
    });

  const handleGenerateDubbing = async (scope: 'selected' | 'all', voice: string) => {
    if (dubbingStatus === 'generating') {
      return;
    }

    const targetTextClips = scope === 'selected'
      ? selectedTextClips.length > 0
        ? selectedTextClips
        : selectedTextClip
          ? [selectedTextClip]
          : []
      : textClips;
    const segments = buildDubbingSegmentPayloads(targetTextClips);

    if (segments.length === 0) {
      setDubbingStatus('error');
      setDubbingError('No text clips available for voice generation.');
      return;
    }

    setDubbingStatus('generating');
    setDubbingError(null);
    setProjectStatus('Generating voice...');

    try {
      const generated = await generateDubbingFromText(segments, voice);
      const generatedTextClipIds = new Set(generated.segments.map((segment) => segment.id));
      const nextDubbingClips: DubbingClip[] = generated.segments.map((segment) => ({
        id: crypto.randomUUID(),
        textClipId: segment.id,
        timelineClipId: segment.timeline_clip_id,
        text: segment.text,
        start: segment.start,
        end: segment.end,
        audioPath: segment.dub_audio_path,
        audioUrl: segment.dub_audio_url,
        voice,
        volume: 1,
        speed: 1,
      }));

      recordHistory('Generated voice');
      setDubbingClips((currentClips) => [
        ...currentClips.filter((clip) => !generatedTextClipIds.has(clip.textClipId)),
        ...nextDubbingClips,
      ]);
      setDubbingStatus('ready');
      setProjectStatus(`Generated ${nextDubbingClips.length} voice clips`);
    } catch (error) {
      setDubbingStatus('error');
      setDubbingError(error instanceof Error ? error.message : 'Generate voice failed.');
    }
  };

  const ensureBackendVideo = async (video: ImportedVideo) => {
    if (video.backendVideoPath) {
      return {
        projectId: video.backendProjectId,
        videoPath: video.backendVideoPath,
      };
    }

    updateVideo(video.id, { uploadStatus: 'uploading', uploadError: undefined });
    try {
      const uploaded = await uploadVideoToBackend(video.file);
      updateVideo(video.id, {
        backendProjectId: uploaded.project_id,
        backendVideoPath: uploaded.video_path,
        uploadStatus: 'ready',
      });

      return {
        projectId: uploaded.project_id,
        videoPath: uploaded.video_path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload video failed';
      updateVideo(video.id, { uploadStatus: 'error', uploadError: message });
      throw error;
    }
  };

  const handleIsolateVoice = async () => {
    if (!timelineVideo) {
      return;
    }

    updateVideo(timelineVideo.id, {
      voiceIsolationStatus: 'processing',
      voiceIsolationError: undefined,
    });

    try {
      const backendVideo = await ensureBackendVideo(timelineVideo);
      const isolated = await isolateVoiceBackendVideo(backendVideo.videoPath);

      updateVideo(timelineVideo.id, {
        bgmPath: isolated.bgm_path,
        vocalsPath: isolated.vocals_path,
        voiceIsolationStatus: 'ready',
      });
    } catch (error) {
      updateVideo(timelineVideo.id, {
        voiceIsolationStatus: 'error',
        voiceIsolationError:
          error instanceof Error ? error.message : 'Voice isolation failed',
      });
    }
  };

  const handleAutoCaptions = async (translateToVietnamese = true) => {
    if (autoCaptionRequestRef.current || captionStatus === 'uploading' || captionStatus === 'transcribing') {
      return;
    }

    if (!timelineVideo || !selectedTimelineClip) {
      setCaptionStatus('error');
      setCaptionError('Bạn cần kéo video từ Media xuống timeline trước.');
      return;
    }

    autoCaptionRequestRef.current = true;
    setCaptionError(null);

    try {
      setCaptionStatus('uploading');
      setProjectStatus('Preparing auto captions...');
      const backendVideo = await ensureBackendVideo(timelineVideo);

      setCaptionStatus('transcribing');
      setProjectStatus('Generating auto captions...');
      const transcribed = await transcribeBackendVideo(backendVideo.videoPath, {
        translateToVietnamese,
      });

      if (transcribed.isolation_status === 'success' && transcribed.bgm_path) {
        updateVideo(timelineVideo.id, {
          bgmPath: transcribed.bgm_path,
          vocalsPath: transcribed.vocals_path,
          voiceIsolationStatus: 'ready',
        });
      }

      const sourceStart = selectedTimelineClip.sourceStart;
      const sourceEnd = selectedTimelineClip.sourceEnd;
      const captionClips: TextClip[] = [];

      transcribed.segments.forEach((segment: CaptionSegment) => {
        const overlapStart = Math.max(segment.start, sourceStart);
        const overlapEnd = Math.min(segment.end, sourceEnd);

        if (overlapEnd <= overlapStart) {
          return;
        }

        const captionText = segment.translated_text ?? segment.text;
        const captionStyle = getAutoCaptionStyle(captionText, timelineVideo);

        captionClips.push({
          id: crypto.randomUUID(),
          timelineClipId: selectedTimelineClip.id,
          text: captionStyle.text,
          start: overlapStart - sourceStart,
          end: Math.max(overlapEnd - sourceStart, overlapStart - sourceStart + 0.2),
          x: captionStyle.x,
          y: captionStyle.y,
          fontFamily: DEFAULT_TEXT_FONT,
          fontSize: captionStyle.fontSize,
          fontWeight: DEFAULT_TEXT_WEIGHT,
          fontStyle: DEFAULT_TEXT_STYLE,
          color: AUTO_CAPTION_TEXT_COLOR,
          strokeColor: DEFAULT_TEXT_STROKE_COLOR,
          strokeWidth: DEFAULT_TEXT_STROKE_WIDTH,
          backgroundColor: AUTO_CAPTION_BACKGROUND_COLOR,
          backgroundOpacity: AUTO_CAPTION_BACKGROUND_OPACITY,
          source: 'caption',
        });
      });
      const laidOutCaptionClips = layoutAutoCaptionClips(captionClips, timelineVideo);
      const captionCoverMasks = buildAutoCaptionCoverMasks(
        laidOutCaptionClips,
        selectedTimelineClip.id,
        timelineVideo
      );

      recordHistory('Generated captions');
      setTextClips((currentClips) => [
        ...currentClips.filter(
          (clip) =>
            clip.source !== 'caption' ||
            clip.timelineClipId !== selectedTimelineClip.id
        ),
        ...laidOutCaptionClips,
      ]);
      setBlurMaskClips((currentClips) => [
        ...currentClips.filter(
          (clip) =>
            clip.source !== 'caption_cover' ||
            clip.timelineClipId !== selectedTimelineClip.id
        ),
        ...captionCoverMasks,
      ]);
      setSelectedTextClipId(laidOutCaptionClips[0]?.id ?? null);
      setSelectedTextClipIds(laidOutCaptionClips[0] ? [laidOutCaptionClips[0].id] : []);
      setCaptionStatus('ready');
      setProjectStatus(`Generated ${laidOutCaptionClips.length} captions with subtitle cover`);
    } catch (error) {
      setCaptionStatus('error');
      setCaptionError(error instanceof Error ? error.message : 'Auto captions failed');
    } finally {
      autoCaptionRequestRef.current = false;
    }
  };

  const handleRunAllInOne = async (options: AllInOneAutomationOptions) => {
    if (allInOneStatus === 'running') {
      return;
    }

    const queuedUrls = Array.from(new Set(options.urls.map((url) => url.trim()).filter(Boolean)));

    if (queuedUrls.length === 0) {
      setAllInOneStatus('error');
      setAllInOneStep('');
      setAllInOneError('Enter at least one video link.');
      return;
    }

    setAllInOneStatus('running');
    setAllInOneStep(`Preparing queue: ${queuedUrls.length} video${queuedUrls.length > 1 ? 's' : ''}...`);
    setAllInOneError(null);
    setAllInOneResults([]);
    setCaptionStatus('idle');
    setCaptionError(null);
    setDubbingStatus('idle');
    setDubbingError(null);
    setExportStatus('preparing');
    setExportError(null);
    setExportDownloadUrl(null);
    setExportFileName(null);
    setProjectStatus('All-in-one: preparing queue...');

    try {
      const completedResults: AllInOneAutomationResult[] = [];
      let timelineCursor = timelineClips.reduce(
        (maxEnd, clip) => Math.max(maxEnd, clip.end),
        0
      );

      for (let queueIndex = 0; queueIndex < queuedUrls.length; queueIndex += 1) {
        const queuedUrl = queuedUrls[queueIndex];
        const queueLabel = `${queueIndex + 1}/${queuedUrls.length}`;

        setAllInOneStep(`[${queueLabel}] Downloading video...`);
        setProjectStatus(`All-in-one ${queueLabel}: downloading video...`);
        const importedVideo = await downloadLinkVideoToImportedVideo(queuedUrl);
        const backendVideoPath = importedVideo.backendVideoPath;

        if (!backendVideoPath) {
          throw new Error(`Video ${queueLabel}: downloaded video is missing backend path.`);
        }

        const duration = Math.max(
          MIN_VIDEO_CLIP_DURATION,
          importedVideo.duration && importedVideo.duration > 0 ? importedVideo.duration : 10
        );
        const timelineStart = timelineCursor;
        const timelineClip: TimelineVideoClip = {
          id: crypto.randomUUID(),
          videoId: importedVideo.id,
          start: timelineStart,
          end: timelineStart + duration,
          sourceStart: 0,
          sourceEnd: duration,
        };

        setAllInOneStep(`[${queueLabel}] Transcribing and translating...`);
        setCaptionStatus('transcribing');
        setProjectStatus(`All-in-one ${queueLabel}: generating captions...`);
        const transcribed = await transcribeBackendVideo(backendVideoPath, {
          translateToVietnamese: options.translateToVietnamese,
        });
        const automationVideo: ImportedVideo = {
          ...importedVideo,
          bgmPath: transcribed.bgm_path ?? importedVideo.bgmPath,
          vocalsPath: transcribed.vocals_path ?? importedVideo.vocalsPath,
          voiceIsolationStatus: transcribed.isolation_status === 'success' ? 'ready' : 'idle',
        };
        const captionClips: TextClip[] = [];

        transcribed.segments.forEach((segment: CaptionSegment) => {
          const overlapStart = Math.max(segment.start, 0);
          const overlapEnd = Math.min(segment.end, duration);

          if (overlapEnd <= overlapStart) {
            return;
          }

          const captionText = options.translateToVietnamese
            ? segment.translated_text ?? segment.text
            : segment.text;
          const captionStyle = getAutoCaptionStyle(captionText, automationVideo);

          captionClips.push({
            id: crypto.randomUUID(),
            timelineClipId: timelineClip.id,
            text: captionStyle.text,
            start: overlapStart,
            end: Math.max(overlapEnd, overlapStart + MIN_TEXT_CLIP_DURATION),
            x: captionStyle.x,
            y: captionStyle.y,
            fontFamily: DEFAULT_TEXT_FONT,
            fontSize: captionStyle.fontSize,
            fontWeight: DEFAULT_TEXT_WEIGHT,
            fontStyle: DEFAULT_TEXT_STYLE,
            color: AUTO_CAPTION_TEXT_COLOR,
            strokeColor: DEFAULT_TEXT_STROKE_COLOR,
            strokeWidth: DEFAULT_TEXT_STROKE_WIDTH,
            backgroundColor: AUTO_CAPTION_BACKGROUND_COLOR,
            backgroundOpacity: AUTO_CAPTION_BACKGROUND_OPACITY,
            source: 'caption',
          });
        });

        const laidOutCaptionClips = layoutAutoCaptionClips(captionClips, automationVideo);
        const captionCoverMasks = buildAutoCaptionCoverMasks(
          laidOutCaptionClips,
          timelineClip.id,
          automationVideo
        );

        if (laidOutCaptionClips.length === 0) {
          throw new Error(`Video ${queueLabel}: no speech segments were detected.`);
        }

        let nextDubbingClips: DubbingClip[] = [];
        let exportDubbingClips: Array<{
          audio_path: string
          start: number
          end: number
          volume: number
          speed: number
        }> = [];

        if (options.includeVietnameseVoice) {
          setAllInOneStep(`[${queueLabel}] Generating Vietnamese voice...`);
          setDubbingStatus('generating');
          setProjectStatus(`All-in-one ${queueLabel}: generating Vietnamese voice...`);
          const segments = laidOutCaptionClips.flatMap((clip) => {
            const text = clip.text.trim().replace(/\s+/g, ' ');

            if (!text) {
              return [];
            }

            return [{
              id: clip.id,
              timeline_clip_id: timelineClip.id,
              text,
              start: clip.start,
              end: clip.end,
              duration: Math.max(MIN_TEXT_CLIP_DURATION, clip.end - clip.start),
            }];
          });
          const generated = await generateDubbingFromText(segments, options.voice);

          exportDubbingClips = generated.segments.flatMap((segment) => {
            if (!segment.dub_audio_path || segment.end <= segment.start) {
              return [];
            }

            return [{
              audio_path: segment.dub_audio_path,
              start: segment.start,
              end: segment.end,
              volume: 1,
              speed: 1,
            }];
          });
          nextDubbingClips = generated.segments.map((segment) => ({
            id: crypto.randomUUID(),
            textClipId: segment.id,
            timelineClipId: timelineClip.id,
            text: segment.text,
            start: timelineStart + segment.start,
            end: timelineStart + segment.end,
            audioPath: segment.dub_audio_path,
            audioUrl: segment.dub_audio_url,
            voice: options.voice,
            volume: 1,
            speed: 1,
          }));

          if (nextDubbingClips.length === 0) {
            throw new Error(`Video ${queueLabel}: Vietnamese voice generation returned no audio clips.`);
          }
        }

        recordHistory(`All-in-one automation ${queueLabel}`);
        setVideos((currentVideos) => [automationVideo, ...currentVideos]);
        setTimelineClips((currentClips) => [...currentClips, timelineClip]);
        setTextClips((currentClips) => [...currentClips, ...laidOutCaptionClips]);
        setBlurMaskClips((currentClips) => [...currentClips, ...captionCoverMasks]);
        setDubbingClips((currentClips) => [...currentClips, ...nextDubbingClips]);
        setActiveVideoId(automationVideo.id);
        setSelectedTimelineClipId(timelineClip.id);
        setSelectedTextClipId(laidOutCaptionClips[0]?.id ?? null);
        setSelectedTextClipIds(laidOutCaptionClips[0] ? [laidOutCaptionClips[0].id] : []);
        setSelectedDubbingClipId(null);
        setSelectedBlurMaskClipId(null);
        setCurrentTime(0);
        setSeekCommand((currentCommand) => ({
          id: currentCommand.id + 1,
          time: 0,
        }));
        setCaptionStatus('ready');
        setDubbingStatus(options.includeVietnameseVoice ? 'ready' : 'idle');

        setAllInOneStep(`[${queueLabel}] Exporting video...`);
        setExportStatus('rendering');
        setProjectStatus(`All-in-one ${queueLabel}: exporting video...`);
        const exported = await exportTimelineVideo({
          clips: [{
            video_path: backendVideoPath,
            source_start: 0,
            source_end: duration,
            bgm_path: automationVideo.bgmPath,
          }],
          text_clips: options.burnSubtitles
            ? laidOutCaptionClips.map((clip) => ({
                text: clip.text,
                start: clip.start,
                end: clip.end,
                x: clip.x,
                y: clip.y,
                font_family: clip.fontFamily,
                font_size: clip.fontSize,
                font_weight: clip.fontWeight,
                font_style: clip.fontStyle,
                color: clip.color,
                stroke_color: clip.strokeColor,
                stroke_width: clip.strokeWidth,
                background_color: clip.backgroundColor,
                background_opacity: clip.backgroundOpacity,
              }))
            : [],
          blur_masks: captionCoverMasks.map((clip) => ({
            start: clip.start,
            end: clip.end,
            x: clip.x,
            y: clip.y,
            width: clip.width,
            height: clip.height,
            intensity: clip.intensity,
            mode: clip.mode,
            color: clip.color,
            opacity: clip.opacity,
          })),
          dubbing_clips: options.includeVietnameseVoice ? exportDubbingClips : [],
          duck_original_audio_all: options.includeVietnameseVoice && options.duckOriginalAudioAll,
          include_audio: true,
          burn_subtitles: options.burnSubtitles,
          output_name: automationVideo.name.replace(/\.[a-z0-9]+$/i, '') || project.name,
          output_width: automationVideo.width ?? 0,
          output_height: automationVideo.height ?? 0,
        });

        setExportDownloadUrl(exported.download_url);
        setExportFileName(exported.filename);
        const completedResult = {
          sourceUrl: queuedUrl,
          downloadUrl: exported.download_url,
          fileName: exported.filename,
        };
        completedResults.push(completedResult);
        setAllInOneResults((currentResults) => [...currentResults, completedResult]);
        timelineCursor += duration;
      }

      let telegramWarning = '';

      if (telegramSettings.enabled && completedResults.length > 0) {
        setAllInOneStep('Sending Telegram notification...');
        setProjectStatus('All-in-one: sending Telegram notification...');

        try {
          await sendTelegramNotification({
            title: 'All-in-one queue completed',
            message: [
              `Project: ${project.name}`,
              `Videos exported: ${completedResults.length}/${queuedUrls.length}`,
            ].join('\n'),
            results: completedResults,
          });
        } catch (notificationError) {
          const notificationMessage =
            notificationError instanceof Error
              ? notificationError.message
              : 'Telegram notification failed.';
          telegramWarning = `Telegram failed: ${notificationMessage}`;
        }
      }

      setExportStatus('done');
      setAllInOneStatus('done');
      setAllInOneStep(
        telegramWarning ||
          `Done. Exported ${queuedUrls.length} video${queuedUrls.length > 1 ? 's' : ''}.`
      );
      setProjectStatus(telegramWarning ? 'All-in-one queue done, Telegram failed' : 'All-in-one queue done');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'All-in-one automation failed.';

      setAllInOneStatus('error');
      setAllInOneError(message);
      setAllInOneStep('');
      setCaptionStatus('error');
      setCaptionError(message);
      setDubbingStatus('error');
      setDubbingError(message);
      setExportStatus('error');
      setExportError(message);
      setProjectStatus('All-in-one failed');
    }
  };

  const buildSubtitleEntries = (): SubtitleEntry[] =>
    textClips
      .map((clip) => {
        const ownerClip = timelineClips.find(
          (timelineClip) => timelineClip.id === clip.timelineClipId
        );

        if (!ownerClip) {
          return null;
        }

        const ownerDuration = Math.max(
          MIN_TEXT_CLIP_DURATION,
          ownerClip.end - ownerClip.start
        );
        const start = clamp(clip.start, 0, ownerDuration - MIN_TEXT_CLIP_DURATION);
        const end = clamp(clip.end, start + MIN_TEXT_CLIP_DURATION, ownerDuration);

        return {
          ...clip,
          timelineStart: ownerClip.start + start,
          timelineEnd: ownerClip.start + end,
        };
      })
      .filter((clip): clip is SubtitleEntry => Boolean(clip))
      .filter((clip) => clip.timelineEnd > clip.timelineStart)
      .sort((a, b) => a.timelineStart - b.timelineStart);

  const buildBlurMaskEntries = (): BlurMaskEntry[] =>
    blurMaskClips
      .map((clip) => {
        const ownerClip = timelineClips.find(
          (timelineClip) => timelineClip.id === clip.timelineClipId
        );

        if (!ownerClip) {
          return null;
        }

        const ownerDuration = Math.max(
          MIN_TEXT_CLIP_DURATION,
          ownerClip.end - ownerClip.start
        );
        const start = clamp(clip.start, 0, ownerDuration - MIN_TEXT_CLIP_DURATION);
        const end = clamp(clip.end, start + MIN_TEXT_CLIP_DURATION, ownerDuration);

        return {
          ...clip,
          timelineStart: ownerClip.start + start,
          timelineEnd: ownerClip.start + end,
        };
      })
      .filter((clip): clip is BlurMaskEntry => Boolean(clip))
      .filter((clip) => clip.timelineEnd > clip.timelineStart)
      .sort((a, b) => a.timelineStart - b.timelineStart);

  const handleExportSubtitles = () => {
    const subtitleEntries = buildSubtitleEntries();

    if (subtitleEntries.length === 0) {
      setExportStatus('error');
      setExportError('No text or captions to export.');
      return;
    }

    const srt = subtitleEntries
      .map((clip, index) =>
        [
          String(index + 1),
          `${formatSrtTimestamp(clip.timelineStart)} --> ${formatSrtTimestamp(clip.timelineEnd)}`,
          clip.text.trim() || ' ',
        ].join('\n')
      )
      .join('\n\n');

    downloadTextFile(
      sanitizeDownloadFileName(project.name, '.srt'),
      `${srt}\n`,
      'text/plain;charset=utf-8'
    );
    setExportStatus('done');
    setExportError(null);
    setProjectStatus('Subtitle exported');
  };

  const getAutoExportSize = () => {
    const firstClip = timelineClips.slice().sort((a, b) => a.start - b.start)[0];
    const firstVideo = firstClip
      ? videos.find((video) => video.id === firstClip.videoId)
      : null;

    if (!firstVideo?.width || !firstVideo.height) {
      return { width: 0, height: 0 };
    }

    return {
      width: firstVideo.width,
      height: firstVideo.height,
    };
  };

  const handleExportVideo = async () => {
    if (timelineClips.length === 0) {
      setExportStatus('error');
      setExportError('Timeline has no clips to export.');
      return;
    }

    setExportStatus('preparing');
    setExportError(null);
    setExportDownloadUrl(null);
    setExportFileName(null);

    try {
      const backendPathByVideoId = new Map<string, string>();
      const timelineVideoIds = [...new Set(timelineClips.map((clip) => clip.videoId))];

      for (const videoId of timelineVideoIds) {
        const video = videos.find((currentVideo) => currentVideo.id === videoId);

        if (!video) {
          throw new Error('Missing video in timeline.');
        }

        const backendVideo = await ensureBackendVideo(video);
        backendPathByVideoId.set(video.id, backendVideo.videoPath);
      }

      const exportClips = timelineClips
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((clip) => {
          const videoPath = backendPathByVideoId.get(clip.videoId);
          const clipVideo = videos.find((video) => video.id === clip.videoId);

          if (!videoPath) {
            throw new Error('Missing uploaded video path.');
          }

          return {
            video_path: videoPath,
            source_start: clip.sourceStart,
            source_end: clip.sourceEnd,
            bgm_path: clipVideo?.bgmPath,
          };
        });

      const exportTextClips = buildSubtitleEntries().map((clip) => ({
        text: clip.text,
        start: clip.timelineStart,
        end: clip.timelineEnd,
        x: clip.x,
        y: clip.y,
        font_family: clip.fontFamily,
        font_size: clip.fontSize,
        font_weight: clip.fontWeight,
        font_style: clip.fontStyle,
        color: clip.color,
        stroke_color: clip.strokeColor,
        stroke_width: clip.strokeWidth,
        background_color: clip.backgroundColor,
        background_opacity: clip.backgroundOpacity,
      }));
      const exportBlurMasks = buildBlurMaskEntries().map((clip) => ({
        start: clip.timelineStart,
        end: clip.timelineEnd,
        x: clip.x,
        y: clip.y,
        width: clip.width,
        height: clip.height,
        intensity: clip.intensity,
        mode: clip.mode,
        color: clip.color,
        opacity: clip.opacity,
      }));
      const exportDubbingClips = exportIncludeAudio
        ? dubbingClips.flatMap((clip) => {
            const start = clip.start;
            const end = clip.end;

            if (!clip.audioPath || end <= start) {
              return [];
            }

            return [{
              audio_path: clip.audioPath,
              start,
              end,
              volume: clip.volume ?? 1,
              speed: clip.speed || 1,
            }];
          })
        : [];

      setExportStatus('rendering');
      const exportSize = getAutoExportSize();
      const exported = await exportTimelineVideo({
        clips: exportClips,
        text_clips: exportBurnSubtitles ? exportTextClips : [],
        blur_masks: exportBlurMasks,
        dubbing_clips: exportDubbingClips,
        duck_original_audio_all: reduceOriginalAudioAll,
        include_audio: exportIncludeAudio,
        burn_subtitles: exportBurnSubtitles,
        output_name: project.name,
        output_width: exportSize.width,
        output_height: exportSize.height,
      });

      setExportDownloadUrl(exported.download_url);
      setExportFileName(exported.filename);
      setExportStatus('done');
      setProjectStatus('Export done');
    } catch (error) {
      setExportStatus('error');
      setExportError(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  useEffect(() => {
    let isCancelled = false;

    void loadTranslationSettings();

    void loadRecentProjectSnapshot()
      .then((projectFile) => {
        if (isCancelled || !projectFile) {
          return;
        }

        setRecentProjectFile(projectFile);
        setProjectNameDraft(projectFile.project.name);
        setProjectStatus('Recent project found');
      })
      .catch(() => {
        if (!isCancelled) {
          setProjectStatus('Choose or create a project');
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify(paneLayout));
  }, [paneLayout]);

  useEffect(() => {
    if (!isProjectReady || isLoadingProject || isSavingProject) {
      return;
    }

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void buildCurrentProjectFile()
        .then(async (projectFile) => {
          await saveRecentProjectSnapshot(projectFile);
          setRecentProjectFile(projectFile);
          setProjectStatus(`Autosaved ${new Date(projectFile.savedAt).toLocaleTimeString()}`);
        })
        .catch((error) => {
          setProjectError(error instanceof Error ? error.message : 'Autosave failed.');
        });
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    isProjectReady,
    isLoadingProject,
    isSavingProject,
    project,
    videos,
    activeVideoId,
    timelineClips,
    selectedTimelineClipId,
    textClips,
    dubbingClips,
    blurMaskClips,
    reduceOriginalAudioAll,
    selectedTextClipId,
  ]);

  useEffect(() => {
    if (autoCaptionRequestRef.current) {
      return;
    }

    setCaptionStatus("idle");
    setCaptionError(null);
  }, [selectedTimelineClipId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target?.isContentEditable;

      if (event.ctrlKey || event.metaKey) {
        if (key === 's') {
          event.preventDefault();
          void handleSaveProject();
          return;
        }

        if (key === 'o') {
          event.preventDefault();
          projectInputRef.current?.click();
          return;
        }

        if (isTypingTarget) {
          return;
        }

        if (key === 'e') {
          event.preventDefault();
          setIsExportPanelOpen(true);
          setExportError(null);
          return;
        }

        if (key === 'z') {
          event.preventDefault();

          if (event.shiftKey) {
            handleRedo();
            return;
          }

          handleUndo();
          return;
        }

        if (key === 'y') {
          event.preventDefault();
          handleRedo();
          return;
        }

        if (key === 'b') {
          event.preventDefault();
          handleSplitTimelineClip();
          return;
        }

        if (key === 'd') {
          event.preventDefault();
          handleDuplicateTimelineClip();
          return;
        }

        if (key === 'c') {
          event.preventDefault();
          handleCopyTimelineClip();
          return;
        }

        if (key === 'v') {
          event.preventDefault();
          handlePasteTimelineClip();
          return;
        }
      }

      if (isTypingTarget) {
        return;
      }

      if (event.key === 'Escape') {
        if (selectedBlurMaskClipId || selectedDubbingClip || selectedTextClipIds.length > 0 || selectedTextClip || selectedTimelineClip) {
          event.preventDefault();
          setSelectedBlurMaskClipId(null);
          setSelectedDubbingClipId(null);
          setSelectedTextClipId(null);
          setSelectedTextClipIds([]);
          setSelectedTimelineClipId(null);
        }

        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (timelineDuration > 0) {
          event.preventDefault();
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          const step = event.shiftKey ? 5 : 1;
          handleSeek(Math.max(0, Math.min(timelineDuration, timelineCurrentTime + direction * step)));
        }

        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      if (selectedBlurMaskClipId || selectedDubbingClip || selectedTextClipIds.length > 0 || selectedTextClip || selectedTimelineClip) {
        event.preventDefault();
        handleDeleteSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    canRedo,
    canUndo,
    handleSaveProject,
    redoStack,
    selectedBlurMaskClipId,
    selectedDubbingClip,
    selectedTextClip,
    selectedTextClipIds,
    selectedTimelineClip,
    selectedTimelineClipId,
    timelineCurrentTime,
    timelineDuration,
    timelineClips,
    textClips,
    undoStack,
  ]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }

      revokeImportedObjectUrls();
    };
  }, []);

  const projectFileInput = (
    <input
      ref={projectInputRef}
      type="file"
      accept=".aivproj,.json,application/json"
      className="hidden"
      onChange={handleProjectFileChange}
    />
  );

  const settingsModal = isSettingsOpen ? (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 px-4">
      <div className="max-h-[90vh] w-full max-w-[460px] overflow-y-auto rounded-md border border-[#343434] bg-[#1e1e1e] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2d2d2d] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-white">Settings</div>
            <div className="mt-1 text-[11px] text-gray-500">Translation, TTS, Telegram</div>
          </div>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(false)}
            className="rounded p-1.5 text-gray-400 hover:bg-[#2d2d2d] hover:text-white"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="grid grid-cols-4 rounded border border-[#343434] bg-[#151515] p-1">
            {settingsTabs.map((tab) => {
              const isActive = settingsTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSettingsTab(tab.id)}
                  className={`rounded px-2 py-1.5 text-xs font-medium ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:bg-[#252525] hover:text-gray-100'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="min-h-[250px] space-y-3">
            {settingsTab === 'translation' && (
              <>
                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  Provider
                  <select
                    value={translationSettingsDraft.provider}
                    onChange={(event) =>
                      handleTranslationProviderChange(event.target.value as TranslationProvider)
                    }
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                  >
                    {orderedTranslationProviders
                      .filter(
                        (provider) =>
                          !translationSettings.providers ||
                          translationSettings.providers.includes(provider)
                      )
                      .map((provider) => (
                        <option key={provider} value={provider}>
                          {translationProviderLabels[provider]}
                        </option>
                      ))}
                  </select>
                </label>

                {translationSettingsDraft.provider === '9router' && (
                  <label className="block text-[11px] font-medium uppercase text-gray-500">
                    API URL
                    <input
                      value={translationSettingsDraft.base_url}
                      onChange={(event) =>
                        setTranslationSettingsDraft((currentSettings) => ({
                          ...currentSettings,
                          base_url: event.target.value,
                        }))
                      }
                      onInput={() => {
                        setTranslationModelOptions([]);
                        setTranslationModelsError(null);
                        setTranslationModelsStatus('idle');
                      }}
                      placeholder="https://your-9router-host/v1"
                      className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                    />
                    <span className="mt-1 block text-[10px] normal-case leading-relaxed text-gray-500">
                      Accepts base URL or full /chat/completions endpoint.
                    </span>
                  </label>
                )}

                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  API Key
                  <input
                    type="password"
                    value={translationSettingsDraft.api_key}
                    disabled={translationSettingsDraft.provider === 'google_free'}
                    onChange={(event) =>
                      setTranslationSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        api_key: event.target.value,
                      }))
                    }
                    onInput={() => {
                      if (translationSettingsDraft.provider === '9router') {
                        setTranslationModelOptions([]);
                        setTranslationModelsError(null);
                        setTranslationModelsStatus('idle');
                      }
                    }}
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
                  />
                </label>

                {translationSettingsDraft.provider === '9router' ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-medium uppercase text-gray-500">Model</span>
                      <button
                        type="button"
                        disabled={translationModelsStatus === 'loading'}
                        onClick={() => void handleLoadTranslationModels()}
                        className="rounded border border-[#343434] bg-[#121212] px-2 py-1 text-[11px] font-medium text-gray-200 hover:bg-[#2d2d2d] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {translationModelsStatus === 'loading' ? 'Loading' : 'Load models'}
                      </button>
                    </div>

                    {translationModelOptions.length > 0 ? (
                      <select
                        value={translationSettingsDraft.model}
                        onChange={(event) =>
                          setTranslationSettingsDraft((currentSettings) => ({
                            ...currentSettings,
                            model: event.target.value,
                          }))
                        }
                        className="w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500"
                      >
                        {translationSettingsDraft.model &&
                          !translationModelOptions.some((model) => model.id === translationSettingsDraft.model) && (
                            <option value={translationSettingsDraft.model}>
                              {translationSettingsDraft.model}
                            </option>
                          )}
                        {translationModelOptions.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name || model.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={translationSettingsDraft.model}
                        onChange={(event) =>
                          setTranslationSettingsDraft((currentSettings) => ({
                            ...currentSettings,
                            model: event.target.value,
                          }))
                        }
                        placeholder="cc/claude-opus-4-6"
                        className="w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500"
                      />
                    )}

                    {translationModelsStatus === 'ready' && (
                      <div className="text-[10px] text-emerald-300">
                        Loaded {translationModelOptions.length} model{translationModelOptions.length === 1 ? '' : 's'}.
                      </div>
                    )}

                    {translationModelsError && (
                      <div className="text-[10px] leading-relaxed text-red-300">
                        {translationModelsError}
                      </div>
                    )}
                  </div>
                ) : (
                  <label className="block text-[11px] font-medium uppercase text-gray-500">
                    Model
                    <input
                      value={translationSettingsDraft.model}
                      disabled={translationSettingsDraft.provider === 'google_free'}
                      onChange={(event) =>
                        setTranslationSettingsDraft((currentSettings) => ({
                          ...currentSettings,
                          model: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
                    />
                  </label>
                )}

                <label className="flex items-center justify-between rounded border border-[#343434] bg-[#151515] px-3 py-2 text-xs text-gray-200">
                  <span>Fallback to Google Free</span>
                  <input
                    type="checkbox"
                    checked={translationSettingsDraft.enable_fallback}
                    onChange={(event) =>
                      setTranslationSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        enable_fallback: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-blue-600"
                  />
                </label>
              </>
            )}

            {settingsTab === 'tts' && (
              <>
                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  OpenAI TTS API Key
                  <input
                    type="password"
                    value={translationSettingsDraft.openai_api_key}
                    onChange={(event) =>
                      setTranslationSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        openai_api_key: event.target.value,
                      }))
                    }
                    placeholder="Used by OpenAI voices"
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                  />
                </label>

                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  VieNeu API URL
                  <input
                    value={translationSettingsDraft.vieneu_api_url}
                    onChange={(event) =>
                      setTranslationSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        vieneu_api_url: event.target.value,
                      }))
                    }
                    placeholder="Optional, e.g. http://127.0.0.1:23333/v1"
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                  />
                  <span className="mt-1 block text-[10px] normal-case leading-relaxed text-gray-500">
                    Leave blank to use local VieNeu SDK if installed.
                  </span>
                </label>

                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  VieNeu Model
                  <input
                    value={translationSettingsDraft.vieneu_model_id}
                    onChange={(event) =>
                      setTranslationSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        vieneu_model_id: event.target.value,
                      }))
                    }
                    placeholder="pnnbao-ump/VieNeu-TTS-v2"
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                  />
                </label>
              </>
            )}

            {settingsTab === 'stt' && (
              <>
                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  Whisper Model
                  <select
                    value={sttSettingsDraft.model_size}
                    onChange={(event) =>
                      setSttSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        model_size: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                  >
                    {(sttSettingsDraft.model_options ?? defaultSttSettings.model_options ?? []).map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[10px] normal-case leading-relaxed text-gray-500">
                    large-v3 is more accurate for Chinese captions but downloads/runs much slower.
                  </span>
                </label>

                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  Compute Type
                  <select
                    value={sttSettingsDraft.compute_type}
                    onChange={(event) =>
                      setSttSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        compute_type: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                  >
                    {(sttSettingsDraft.compute_options ?? defaultSttSettings.compute_options ?? []).map((computeType) => (
                      <option key={computeType} value={computeType}>
                        {computeType}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  Language Mode
                  <select
                    value={sttSettingsDraft.language_mode}
                    onChange={(event) =>
                      setSttSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        language_mode: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                  >
                    {(sttSettingsDraft.language_mode_options ?? defaultSttSettings.language_mode_options ?? []).map((mode) => (
                      <option key={mode} value={mode}>
                        {sttLanguageModeLabels[mode] ?? mode}
                      </option>
                    ))}
                  </select>
                </label>

                {sttSettingsDraft.language_mode === 'auto_zh_fallback' && (
                  <>
                    <label className="block text-[11px] font-medium uppercase text-gray-500">
                      Fallback Language
                      <input
                        value={sttSettingsDraft.fallback_language}
                        onChange={(event) =>
                          setSttSettingsDraft((currentSettings) => ({
                            ...currentSettings,
                            fallback_language: event.target.value,
                          }))
                        }
                        placeholder="zh"
                        className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="block text-[11px] font-medium uppercase text-gray-500">
                      Min Detect Confidence
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={sttSettingsDraft.min_language_probability}
                        onChange={(event) =>
                          setSttSettingsDraft((currentSettings) => ({
                            ...currentSettings,
                            min_language_probability: Number(event.target.value),
                          }))
                        }
                        className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                      />
                    </label>
                  </>
                )}
              </>
            )}

            {settingsTab === 'telegram' && (
              <>
                <label className="flex items-center justify-between rounded border border-[#343434] bg-[#151515] px-3 py-2 text-xs text-gray-200">
                  <span>Telegram notifications</span>
                  <input
                    type="checkbox"
                    checked={telegramSettingsDraft.enabled}
                    onChange={(event) =>
                      setTelegramSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        enabled: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-blue-600"
                  />
                </label>

                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  Bot Token
                  <input
                    type="password"
                    value={telegramSettingsDraft.bot_token}
                    onChange={(event) =>
                      setTelegramSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        bot_token: event.target.value,
                      }))
                    }
                    placeholder="123456:ABC..."
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                  />
                </label>

                <label className="block text-[11px] font-medium uppercase text-gray-500">
                  Chat ID
                  <input
                    value={telegramSettingsDraft.chat_id}
                    onChange={(event) =>
                      setTelegramSettingsDraft((currentSettings) => ({
                        ...currentSettings,
                        chat_id: event.target.value,
                      }))
                    }
                    placeholder="-1001234567890 or 123456789"
                    className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs normal-case text-gray-200 outline-none focus:border-blue-500"
                  />
                  <span className="mt-1 block text-[10px] normal-case leading-relaxed text-gray-500">
                    Sends one detailed message when the All-in-one queue finishes successfully.
                  </span>
                </label>
              </>
            )}
          </div>

          {settingsError && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {settingsError}
            </div>
          )}

          {settingsStatus === 'saved' && (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
              Settings saved.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(false)}
              className="rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs text-gray-200 hover:bg-[#2d2d2d]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={settingsStatus === 'saving'}
              onClick={() => void handleSaveTranslationSettings()}
              className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {settingsStatus === 'saving' ? 'Saving' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (!isProjectReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#181818] text-gray-200 font-sans">
        {projectFileInput}
        {settingsModal}
        <div className="w-[420px] rounded-md border border-[#2d2d2d] bg-[#1e1e1e] p-5 shadow-2xl">
          <div className="mb-5 flex items-center justify-between border-b border-[#2d2d2d] pb-4">
            <div>
              <div className="text-sm font-semibold text-white">AI VIDEO EDITOR PRO</div>
              <div className="mt-1 text-[11px] text-gray-500">{projectStatus}</div>
            </div>
            <div className="flex items-center gap-2">
              {recentProjectFile && (
                <div className="text-right text-[10px] text-gray-500">
                  <div>Recent</div>
                  <div>{new Date(recentProjectFile.savedAt).toLocaleString()}</div>
                </div>
              )}
              <button
                type="button"
                onClick={handleOpenSettings}
                className="rounded p-1.5 text-gray-400 hover:bg-[#2d2d2d] hover:text-white"
                aria-label="Open settings"
              >
                <SettingsIcon size={16} />
              </button>
            </div>
          </div>

          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              handleCreateProject();
            }}
          >
            <label className="block text-[11px] font-medium uppercase text-gray-500">
              Project Name
              <input
                value={projectNameDraft}
                onChange={(event) => setProjectNameDraft(event.target.value)}
                className="mt-2 w-full rounded border border-[#343434] bg-[#121212] px-3 py-2 text-sm normal-case text-gray-200 outline-none focus:border-blue-500"
              />
            </label>

            <button
              type="submit"
              disabled={isLoadingProject}
              className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FilePlus2 size={14} />
              New Project
            </button>
          </form>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isLoadingProject}
              onClick={() => projectInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs text-gray-200 hover:bg-[#2d2d2d] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderOpen size={14} />
              Open Project
            </button>
            <button
              type="button"
              disabled={!recentProjectFile || isLoadingProject}
              onClick={handleOpenRecentProject}
              className="flex items-center justify-center gap-2 rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs text-gray-200 hover:bg-[#2d2d2d] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Clock3 size={14} />
              Recent
            </button>
          </div>

          {projectError && (
            <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {projectError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div 
      className="flex flex-col h-screen w-screen bg-[#181818] text-gray-200 overflow-hidden font-sans"
    >
      {projectFileInput}
      {settingsModal}
      {/* Top Menu Bar */}
      <div className="h-10 bg-[#121212] border-b border-[#000] flex items-center px-4 justify-between">
        <div className="flex items-center gap-4">
          <span className="font-bold text-white tracking-wide text-sm">AI VIDEO EDITOR PRO</span>
          <span className="max-w-[260px] truncate text-[10px] text-gray-300 bg-[#1e1e1e] px-2 py-0.5 rounded">
            {project.name}
          </span>
          <span className="text-[10px] text-gray-500 bg-[#1e1e1e] px-2 py-0.5 rounded">
            {projectStatus}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCreateProject}
            className="flex items-center gap-1.5 rounded border border-[#343434] bg-[#1e1e1e] px-3 py-1.5 text-xs text-gray-200 hover:bg-[#2d2d2d]"
          >
            <FilePlus2 size={13} />
            New
          </button>
          <button
            type="button"
            onClick={() => projectInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded border border-[#343434] bg-[#1e1e1e] px-3 py-1.5 text-xs text-gray-200 hover:bg-[#2d2d2d]"
          >
            <FolderOpen size={13} />
            Open
          </button>
          <button
            type="button"
            onClick={handleOpenSettings}
            className="flex items-center gap-1.5 rounded border border-[#343434] bg-[#1e1e1e] px-3 py-1.5 text-xs text-gray-200 hover:bg-[#2d2d2d]"
          >
            <SettingsIcon size={13} />
            Settings
          </button>
          <button
            type="button"
            disabled={isSavingProject}
            onClick={handleSaveProject}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={13} />
            {isSavingProject ? 'Saving' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsExportPanelOpen(true);
              setExportError(null);
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-1.5 rounded"
          >
            Export
          </button>
        </div>
      </div>

      {projectError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-[11px] text-red-300">
          {projectError}
        </div>
      )}

      {/* Main Workspace (Top Half) */}
      <div className="flex min-h-[240px] flex-1 overflow-hidden">
        <div
          data-sidebar-panel
          className="h-full shrink-0"
          style={{ width: `${paneLayout.sidebarWidth}px` }}
        >
          <Sidebar
            videos={videos}
            activeVideoId={activeVideoId}
            timelineVideoIds={new Set(timelineClips.map((clip) => clip.videoId))}
            timelineVideo={timelineVideo}
            onImportVideos={handleImportVideos}
            onSelectVideo={setActiveVideoId}
            onAddVideoToTimeline={handleAddVideoToTimeline}
            onImportVideoLink={(url) => void handleImportVideoLink(url)}
            linkImportStatus={linkImportStatus}
            linkImportError={linkImportError}
            allInOneStatus={allInOneStatus}
            allInOneStep={allInOneStep}
            allInOneError={allInOneError}
            allInOneResults={allInOneResults}
            onRunAllInOne={(options) => void handleRunAllInOne(options)}
            onAddText={handleAddTextClip}
            onAddBlurMask={handleAddBlurMaskClip}
            onImportSubtitles={(file) => void handleImportSubtitles(file)}
            onIsolateVoice={handleIsolateVoice}
            onAutoCaptions={(translateToVietnamese) => void handleAutoCaptions(translateToVietnamese)}
            captionStatus={captionStatus}
            captionError={captionError}
            hasTimelineVideo={Boolean(timelineVideo)}
          />
        </div>

        <div
          className="w-1.5 shrink-0 cursor-col-resize bg-[#060606] transition-colors hover:bg-blue-500/70"
          onPointerDown={(event) => startPaneResize(event, 'sidebar')}
        />

        <Player
          video={timelineVideo}
          textClips={activeTextClips}
          dubbingClips={dubbingClips}
          blurMaskClips={activeBlurMaskClips}
          reduceOriginalAudioAll={reduceOriginalAudioAll}
          selectedBlurMaskClipId={selectedBlurMaskClipId}
          selectedTextClipId={selectedTextClipId}
          selectedTextClipIds={selectedTextClipIds}
          currentTime={currentTime}
          timelineCurrentTime={timelineCurrentTime}
          timelineDuration={timelineDuration}
          clipSourceStart={selectedTimelineClip?.sourceStart ?? 0}
          clipSourceEnd={selectedTimelineClip?.sourceEnd ?? null}
          seekCommand={seekCommand}
          onDurationChange={handleDurationChange}
          onTimeChange={setCurrentTime}
          onSeekTimeline={handleSeek}
          onClipEnded={handleTimelineClipEnded}
          onSelectTextClip={handleSelectTextClip}
          onUpdateTextClip={handleUpdateTextClip}
          onSelectBlurMaskClip={handleSelectBlurMaskClip}
          onUpdateBlurMaskClip={handleUpdateBlurMaskClip}
          onToggleReduceOriginalAudioAll={() => setReduceOriginalAudioAll((currentValue) => !currentValue)}
        />

        <div
          className="w-1.5 shrink-0 cursor-col-resize bg-[#060606] transition-colors hover:bg-blue-500/70"
          onPointerDown={(event) => startPaneResize(event, 'properties')}
        />

        <div
          data-properties-panel
          className="h-full shrink-0"
          style={{ width: `${paneLayout.propertiesWidth}px` }}
        >
          <PropertiesPanel
            video={timelineVideo}
            selectedTextClip={selectedTextClip}
            selectedTextClips={selectedTextClips}
            selectedDubbingClip={selectedDubbingClip}
            textClipCount={textClips.length}
            dubbingStatus={dubbingStatus}
            dubbingError={dubbingError}
            onUpdateTextClip={handleUpdateTextClip}
            onUpdateSelectedTextClips={handleUpdateSelectedTextClips}
            onUpdateDubbingClip={handleUpdateDubbingClip}
            onGenerateDubbing={(scope, voice) => void handleGenerateDubbing(scope, voice)}
          />
        </div>
      </div>

      <div
        className="h-1.5 shrink-0 cursor-row-resize bg-[#060606] transition-colors hover:bg-blue-500/70"
        onPointerDown={(event) => startPaneResize(event, 'timeline')}
      />

      {/* Bottom Workspace (Timeline) */}
      <div
        data-timeline-panel
        className="shrink-0"
        style={{ height: `${paneLayout.timelineHeight}px` }}
      >
        <Timeline
          video={timelineVideo}
          timelineClips={timelineClips}
          selectedTimelineClipId={selectedTimelineClipId}
          videos={videos}
          textClips={textClips}
          dubbingClips={dubbingClips}
          selectedTextClipId={selectedTextClipId}
          selectedTextClipIds={selectedTextClipIds}
          selectedDubbingClipId={selectedDubbingClipId}
          currentTime={currentTime}
          canUndo={canUndo}
          canRedo={canRedo}
          canSplitClip={canSplitClip}
          onSeek={handleSeek}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onSplitTimelineClip={handleSplitTimelineClip}
          onCopyTimelineClip={handleCopyTimelineClip}
          onDuplicateTimelineClip={handleDuplicateTimelineClip}
          onSelectTextClip={handleSelectTextClip}
          onSelectTextClips={handleSelectTextClips}
          onAddVideoToTimeline={handleAddVideoToTimeline}
          onUpdateTextClip={handleUpdateTextClip}
          onSelectDubbingClip={handleSelectDubbingClip}
          onUpdateDubbingClip={handleUpdateDubbingClip}
          onDeleteDubbingClip={handleDeleteDubbingClip}
          onDeleteTextClip={handleDeleteTextClip}
          onDeleteSelectedTextClips={handleDeleteSelectedTextClips}
          onDeleteTimelineClip={handleDeleteTimelineClip}
          onSelectTimelineClip={(clipId) => {
            const clip = timelineClips.find((currentClip) => currentClip.id === clipId);
            if (!clip) {
              return;
            }

            setSelectedTimelineClipId(clip.id);
            setActiveVideoId(clip.videoId);
            setSelectedTextClipId(null);
            setSelectedTextClipIds([]);
            setSelectedBlurMaskClipId(null);
            setSelectedDubbingClipId(null);
            handleSeek(clip.start);
          }}
        />
      </div>

      {isExportPanelOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-[440px] rounded-md border border-[#343434] bg-[#1e1e1e] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#2d2d2d] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-white">Export</div>
                <div className="mt-1 text-[11px] text-gray-500">
                  {timelineClips.length} clips - {formatDuration(timelineDuration)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsExportPanelOpen(false)}
                className="rounded p-1.5 text-gray-400 hover:bg-[#2d2d2d] hover:text-white"
                aria-label="Close export"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <label className="flex items-center justify-between rounded border border-[#343434] bg-[#151515] px-3 py-2 text-xs text-gray-200">
                <span>Include audio</span>
                <input
                  type="checkbox"
                  checked={exportIncludeAudio}
                  onChange={(event) => setExportIncludeAudio(event.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
              </label>

              <label className="flex items-center justify-between rounded border border-[#343434] bg-[#151515] px-3 py-2 text-xs text-gray-200">
                <span>Burn text/subtitles</span>
                <input
                  type="checkbox"
                  checked={exportBurnSubtitles}
                  onChange={(event) => setExportBurnSubtitles(event.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded border border-[#343434] bg-[#151515] px-3 py-2 text-xs text-gray-200">
                <span className="min-w-0">
                  <span className="block">Reduce original audio all timeline</span>
                  <span className="mt-0.5 block text-[10px] text-gray-500">
                    Off: only lowers audio during Vietnamese voice.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={reduceOriginalAudioAll}
                  disabled={!exportIncludeAudio}
                  onChange={(event) => setReduceOriginalAudioAll(event.target.checked)}
                  className="h-4 w-4 shrink-0 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-45"
                />
              </label>

              {exportStatus !== 'idle' && (
                <div className="rounded border border-[#343434] bg-[#121212] px-3 py-2 text-[11px] text-gray-400">
                  {exportStatus === 'preparing' && 'Preparing media...'}
                  {exportStatus === 'rendering' && 'Rendering MP4 with FFmpeg...'}
                  {exportStatus === 'done' && 'Export ready.'}
                  {exportStatus === 'error' && 'Export failed.'}
                </div>
              )}

              {exportError && (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                  {exportError}
                </div>
              )}

              {exportDownloadUrl && (
                <a
                  href={exportDownloadUrl}
                  download={exportFileName ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-500/20"
                >
                  <Download size={14} />
                  Download MP4
                </a>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleExportSubtitles}
                  className="flex items-center justify-center gap-2 rounded border border-[#343434] bg-[#121212] px-3 py-2 text-xs text-gray-200 hover:bg-[#2d2d2d]"
                >
                  <FileText size={14} />
                  Export SRT
                </button>
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => void handleExportVideo()}
                  className="flex items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download size={14} />
                  {isExporting ? 'Exporting' : 'Export MP4'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
