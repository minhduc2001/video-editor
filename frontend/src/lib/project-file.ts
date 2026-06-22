import type { BlurMaskClip, DubbingClip, ImportedVideo, TextClip, TimelineVideoClip } from '@/types/media';

const PROJECT_SCHEMA = 'ai-video-editor-project';
const PROJECT_VERSION = 1;
const AUTOSAVE_DB_NAME = 'ai-video-editor-projects';
const AUTOSAVE_STORE_NAME = 'snapshots';
const RECENT_PROJECT_KEY = 'recent-project';

export interface ProjectMetadata {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

interface SavedVideo {
  id: string
  name: string
  size: number
  type: string
  duration: number | null
  width?: number | null
  height?: number | null
  importedAt: number
  dataUrl: string
  backendProjectId?: string
  backendVideoPath?: string
  bgmPath?: string
  vocalsPath?: string
}

export interface ProjectFile {
  schema: typeof PROJECT_SCHEMA
  version: typeof PROJECT_VERSION
  savedAt: number
  project: ProjectMetadata
  videos: SavedVideo[]
  activeVideoId: string | null
  timelineClips: TimelineVideoClip[]
  selectedTimelineClipId: string | null
  textClips: TextClip[]
  selectedTextClipId: string | null
  dubbingClips?: DubbingClip[]
  blurMaskClips?: BlurMaskClip[]
  reduceOriginalAudioAll?: boolean
}

interface BuildProjectFileInput {
  project: ProjectMetadata
  videos: ImportedVideo[]
  activeVideoId: string | null
  timelineClips: TimelineVideoClip[]
  selectedTimelineClipId: string | null
  textClips: TextClip[]
  selectedTextClipId: string | null
  dubbingClips: DubbingClip[]
  blurMaskClips: BlurMaskClip[]
  reduceOriginalAudioAll: boolean
  videoDataUrlCache: Map<string, string>
}

export interface HydratedProject {
  project: ProjectMetadata
  videos: ImportedVideo[]
  activeVideoId: string | null
  timelineClips: TimelineVideoClip[]
  selectedTimelineClipId: string | null
  textClips: TextClip[]
  selectedTextClipId: string | null
  dubbingClips: DubbingClip[]
  blurMaskClips: BlurMaskClip[]
  reduceOriginalAudioAll: boolean
}

type ProjectFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: Array<{
      description: string
      accept: Record<string, string[]>
    }>
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>
      close: () => Promise<void>
    }>
  }>
}

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();

  reader.addEventListener('load', () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
      return;
    }

    reject(new Error('Could not read media file.'));
  });
  reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read media file.')));
  reader.readAsDataURL(file);
});

const dataUrlToFile = async (dataUrl: string, name: string, type: string, importedAt: number) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  return new File([blob], name, {
    type: type || blob.type || 'video/mp4',
    lastModified: importedAt,
  });
};

const requestToPromise = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.addEventListener('success', () => resolve(request.result));
  request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')));
});

const openAutosaveDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(AUTOSAVE_DB_NAME, 1);

  request.addEventListener('upgradeneeded', () => {
    const db = request.result;

    if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
      db.createObjectStore(AUTOSAVE_STORE_NAME);
    }
  });
  request.addEventListener('success', () => resolve(request.result));
  request.addEventListener('error', () => reject(request.error ?? new Error('Could not open autosave database.')));
});

const sanitizeFileName = (name: string) => {
  const cleanedName = name.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');

  return cleanedName || 'video-project';
};

const isProjectFile = (value: unknown): value is ProjectFile => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const projectFile = value as Partial<ProjectFile>;

  return (
    projectFile.schema === PROJECT_SCHEMA &&
    projectFile.version === PROJECT_VERSION &&
    Boolean(projectFile.project) &&
    Array.isArray(projectFile.videos) &&
    Array.isArray(projectFile.timelineClips) &&
    Array.isArray(projectFile.textClips)
  );
};

export const createProjectMetadata = (name: string): ProjectMetadata => {
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled Project',
    createdAt: now,
    updatedAt: now,
  };
};

export const buildProjectFile = async ({
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
  videoDataUrlCache,
}: BuildProjectFileInput): Promise<ProjectFile> => {
  const savedAt = Date.now();
  const savedVideos = await Promise.all(
    videos.map(async (video) => {
      let dataUrl = videoDataUrlCache.get(video.id);

      if (!dataUrl) {
        dataUrl = await fileToDataUrl(video.file);
        videoDataUrlCache.set(video.id, dataUrl);
      }

      return {
        id: video.id,
        name: video.name,
        size: video.size,
        type: video.type,
        duration: video.duration,
        width: video.width,
        height: video.height,
        importedAt: video.importedAt,
        dataUrl,
        backendProjectId: video.backendProjectId,
        backendVideoPath: video.backendVideoPath,
        bgmPath: video.bgmPath,
        vocalsPath: video.vocalsPath,
      };
    })
  );

  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    savedAt,
    project: {
      ...project,
      updatedAt: savedAt,
    },
    videos: savedVideos,
    activeVideoId,
    timelineClips,
    selectedTimelineClipId,
    textClips,
    selectedTextClipId,
    dubbingClips,
    blurMaskClips,
    reduceOriginalAudioAll,
  };
};

export const parseProjectFileText = (text: string): ProjectFile => {
  const parsed = JSON.parse(text) as unknown;

  if (!isProjectFile(parsed)) {
    throw new Error('This is not a valid AI Video Editor project file.');
  }

  return parsed;
};

export const hydrateProjectFile = async (
  projectFile: ProjectFile,
  registerObjectUrl: (url: string) => void
): Promise<HydratedProject> => {
  const videos = await Promise.all(
    projectFile.videos.map(async (video) => {
      const file = await dataUrlToFile(video.dataUrl, video.name, video.type, video.importedAt);
      const url = URL.createObjectURL(file);
      registerObjectUrl(url);

      return {
        id: video.id,
        name: video.name,
        file,
        url,
        size: video.size || file.size,
        type: video.type || file.type || 'video/mp4',
        duration: video.duration,
        width: video.width ?? null,
        height: video.height ?? null,
        importedAt: video.importedAt,
        backendProjectId: video.backendProjectId,
        backendVideoPath: video.backendVideoPath,
        bgmPath: video.bgmPath,
        vocalsPath: video.vocalsPath,
        uploadStatus: 'idle',
        voiceIsolationStatus: video.vocalsPath ? 'ready' : 'idle',
      } satisfies ImportedVideo;
    })
  );
  const videoIds = new Set(videos.map((video) => video.id));
  const timelineClips = projectFile.timelineClips
    .filter((clip) => videoIds.has(clip.videoId))
    .map((clip) => {
      const duration = Math.max(0.2, clip.end - clip.start);
      const maybeLegacyClip = clip as TimelineVideoClip & {
        sourceStart?: number
        sourceEnd?: number
      };

      return {
        ...clip,
        sourceStart: maybeLegacyClip.sourceStart ?? 0,
        sourceEnd: maybeLegacyClip.sourceEnd ?? duration,
      };
    });
  const timelineClipIds = new Set(timelineClips.map((clip) => clip.id));
  const textClips = projectFile.textClips.filter((clip) => timelineClipIds.has(clip.timelineClipId));
  const textClipIds = new Set(textClips.map((clip) => clip.id));
  const dubbingClips = (projectFile.dubbingClips ?? [])
    .filter((clip) => timelineClipIds.has(clip.timelineClipId) && textClipIds.has(clip.textClipId))
    .map((clip) => ({
      ...clip,
      volume: Math.max(0, Math.min(2, Number.isFinite(clip.volume) ? clip.volume : 1)),
      speed: Math.max(0.5, Math.min(2, Number.isFinite(clip.speed) ? clip.speed : 1)),
    }));
  const blurMaskClips = (projectFile.blurMaskClips ?? []).filter((clip) =>
    timelineClipIds.has(clip.timelineClipId)
  );

  return {
    project: projectFile.project,
    videos,
    activeVideoId: projectFile.activeVideoId && videoIds.has(projectFile.activeVideoId)
      ? projectFile.activeVideoId
      : videos[0]?.id ?? null,
    timelineClips,
    selectedTimelineClipId:
      projectFile.selectedTimelineClipId &&
      timelineClips.some((clip) => clip.id === projectFile.selectedTimelineClipId)
        ? projectFile.selectedTimelineClipId
        : timelineClips[0]?.id ?? null,
    textClips,
    selectedTextClipId:
      projectFile.selectedTextClipId &&
      textClips.some((clip) => clip.id === projectFile.selectedTextClipId)
        ? projectFile.selectedTextClipId
        : null,
    dubbingClips,
    blurMaskClips,
    reduceOriginalAudioAll: Boolean(projectFile.reduceOriginalAudioAll),
  };
};

export const saveProjectFileToDisk = async (projectFile: ProjectFile) => {
  const json = JSON.stringify(projectFile, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const fileName = `${sanitizeFileName(projectFile.project.name)}.aivproj`;
  const pickerWindow = window as ProjectFilePickerWindow;

  if (pickerWindow.showSaveFilePicker) {
    try {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'AI Video Editor Project',
            accept: {
              'application/json': ['.aivproj', '.json'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();

      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }

      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  return 'downloaded';
};

export const saveRecentProjectSnapshot = async (projectFile: ProjectFile) => {
  const db = await openAutosaveDb();
  const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(AUTOSAVE_STORE_NAME);

  await requestToPromise(store.put(projectFile, RECENT_PROJECT_KEY));
  db.close();
};

export const loadRecentProjectSnapshot = async () => {
  const db = await openAutosaveDb();
  const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
  const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
  const value = await requestToPromise(store.get(RECENT_PROJECT_KEY));

  db.close();

  return isProjectFile(value) ? value : null;
};
