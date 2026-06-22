import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Mic, MousePointer2, Redo, Scissors, Undo, Volume2, ZoomIn, ZoomOut } from 'lucide-react';
import { formatDuration } from '@/lib/media';
import type { DubbingClip, ImportedVideo, TextClip, TimelineVideoClip } from '@/types/media';

interface TimelineProps {
  video: ImportedVideo | null
  timelineClips: TimelineVideoClip[]
  selectedTimelineClipId: string | null
  videos: ImportedVideo[]
  textClips: TextClip[]
  dubbingClips: DubbingClip[]
  selectedTextClipId: string | null
  selectedTextClipIds: string[]
  selectedDubbingClipId: string | null
  currentTime: number
  canUndo: boolean
  canRedo: boolean
  canSplitClip: boolean
  onSeek: (time: number) => void
  onUndo: () => void
  onRedo: () => void
  onSplitTimelineClip: (clipId?: string) => void
  onCopyTimelineClip: (clipId?: string) => void
  onDuplicateTimelineClip: (clipId?: string) => void
  onSelectTextClip: (clipId: string, mode?: 'single' | 'toggle' | 'add') => void
  onSelectTextClips: (clipIds: string[]) => void
  onAddVideoToTimeline: (videoId: string) => void
  onUpdateTextClip: (clipId: string, patch: Partial<TextClip>) => void
  onSelectDubbingClip: (clipId: string) => void
  onUpdateDubbingClip: (clipId: string, patch: Partial<DubbingClip>) => void
  onDeleteDubbingClip: (clipId: string) => void
  onDeleteTextClip: (clipId: string) => void
  onDeleteSelectedTextClips: () => void
  onDeleteTimelineClip: (clipId: string) => void
  onSelectTimelineClip: (clipId: string) => void
}

const TRACK_LABEL_WIDTH = 100;
const MIN_ZOOM_LEVEL = 25;
const MAX_ZOOM_LEVEL = 2000;
const THUMBNAIL_WIDTH = 72;
const MAX_THUMBNAILS = 32;
const MIN_TEXT_CLIP_DURATION = 0.2;
const TRACK_LABEL_STYLE = { width: TRACK_LABEL_WIDTH } as const;
const TOOL_BUTTON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-gray-400';
const ACTIVE_TOOL_BUTTON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-blue-400/35 bg-blue-500/15 text-blue-300 shadow-[0_0_0_1px_rgba(96,165,250,0.12)]';
const TRACK_LABEL_CLASS =
  'sticky left-0 z-30 flex shrink-0 border-r border-white/10 bg-[#171717]/95 px-2 shadow-[6px_0_14px_rgba(0,0,0,0.22)] backdrop-blur';

const clampZoomLevel = (zoom: number) =>
  Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, Math.round(zoom)));

type TextDragMode = 'move' | 'trim-start' | 'trim-end';
type AudioDragMode = 'move' | 'trim-start' | 'trim-end';
type TimelineContextMenu =
  | { kind: 'video'; clipId: string; x: number; y: number }
  | { kind: 'text'; clipId: string; x: number; y: number }
  | { kind: 'audio'; clipId: string; x: number; y: number };

interface TextDragState {
  clipId: string
  pointerId: number
  mode: TextDragMode
  originClientX: number
  originStart: number
  originEnd: number
  clipDuration: number
}

interface AudioDragState {
  clipId: string
  pointerId: number
  mode: AudioDragMode
  originClientX: number
  originStart: number
  originEnd: number
}

interface TextMarqueeSelectionState {
  pointerId: number
  startX: number
  currentX: number
  additive: boolean
  originSelectedIds: string[]
}

interface TextClipBounds {
  id: string
  left: number
  right: number
}

const getThumbnailCount = (clipWidth: number) => {
  if (clipWidth <= 0) {
    return 1;
  }

  return Math.max(1, Math.min(MAX_THUMBNAILS, Math.ceil(clipWidth / THUMBNAIL_WIDTH)));
};

interface ClipThumbnailStripProps {
  video: ImportedVideo
  clipDuration: number
  clipWidth: number
}

const ClipThumbnailStrip = ({
  video,
  clipDuration,
  clipWidth,
}: ClipThumbnailStripProps) => {
  const thumbnailCount = useMemo(
    () => getThumbnailCount(clipWidth),
    [clipWidth]
  );
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  useEffect(() => {
    let isCancelled = false;
    const media = document.createElement('video');
    media.muted = true;
    media.preload = 'auto';
    media.src = video.url;

    const waitForVideoEvent = (eventName: 'loadedmetadata' | 'seeked') => new Promise<void>((resolve, reject) => {
      function cleanup() {
        media.removeEventListener(eventName, handleEvent);
        media.removeEventListener('error', handleError);
      }

      function handleEvent() {
        cleanup();
        resolve();
      }

      function handleError() {
        cleanup();
        reject(new Error(`Could not capture video thumbnail: ${eventName}`));
      }

      media.addEventListener(eventName, handleEvent, { once: true });
      media.addEventListener('error', handleError, { once: true });
    });

    const captureThumbnails = async () => {
      try {
        media.load();

        if (media.readyState < HTMLMediaElement.HAVE_METADATA) {
          await waitForVideoEvent('loadedmetadata');
        }

        const mediaDuration = Number.isFinite(media.duration) && media.duration > 0
          ? media.duration
          : clipDuration;
        const captureDuration = Math.max(0.1, mediaDuration);
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext('2d');

        if (!context) {
          return;
        }

        const nextThumbnails: string[] = [];

        for (let thumbnailIndex = 0; thumbnailIndex < thumbnailCount; thumbnailIndex += 1) {
          if (isCancelled) {
            return;
          }

          const progress = (thumbnailIndex + 0.5) / thumbnailCount;
          const sampleTime = Math.min(
            captureDuration - 0.05,
            Math.max(0, progress * captureDuration)
          );

          if (Math.abs(media.currentTime - sampleTime) > 0.02) {
            media.currentTime = sampleTime;
            await waitForVideoEvent('seeked');
          }

          context.drawImage(media, 0, 0, canvas.width, canvas.height);
          nextThumbnails.push(canvas.toDataURL('image/jpeg', 0.68));
        }

        if (!isCancelled) {
          setThumbnails(nextThumbnails);
        }
      } catch {
        if (!isCancelled) {
          setThumbnails([]);
        }
      }
    };

    void captureThumbnails();

    return () => {
      isCancelled = true;
      media.removeAttribute('src');
      media.load();
    };
  }, [clipDuration, thumbnailCount, video.url]);

  if (thumbnails.length > 0) {
    return (
      <div className="absolute inset-0 flex pointer-events-none">
        {thumbnails.map((thumbnail, thumbnailIndex) => (
          <img
            key={`${video.id}-thumbnail-${thumbnailCount}-${thumbnailIndex}`}
            src={thumbnail}
            alt=""
            className="h-full min-w-[72px] flex-1 object-cover opacity-75 border-r border-white/10"
            draggable={false}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex pointer-events-none">
      {Array.from({ length: thumbnailCount }, (_, thumbnailIndex) => (
        <video
          key={`${video.id}-preview-${thumbnailCount}-${thumbnailIndex}`}
          src={video.url}
          muted
          preload="metadata"
          className="h-full min-w-[72px] flex-1 object-cover opacity-60 border-r border-white/10"
        />
      ))}
    </div>
  );
};

export const Timeline = ({
  video,
  timelineClips,
  selectedTimelineClipId,
  videos,
  textClips,
  dubbingClips,
  selectedTextClipId,
  selectedTextClipIds,
  selectedDubbingClipId,
  currentTime,
  canUndo,
  canRedo,
  canSplitClip,
  onSeek,
  onUndo,
  onRedo,
  onSplitTimelineClip,
  onCopyTimelineClip,
  onDuplicateTimelineClip,
  onSelectTextClip,
  onSelectTextClips,
  onAddVideoToTimeline,
  onUpdateTextClip,
  onSelectDubbingClip,
  onUpdateDubbingClip,
  onDeleteDubbingClip,
  onDeleteTextClip,
  onDeleteSelectedTextClips,
  onDeleteTimelineClip,
  onSelectTimelineClip,
}: TimelineProps) => {
  const [zoomLevel, setZoomLevel] = useState(100);
  const [trackLaneWidth, setTrackLaneWidth] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isVideoDragOver, setIsVideoDragOver] = useState(false);
  const [draggingTextClipId, setDraggingTextClipId] = useState<string | null>(null);
  const [draggingDubbingClipId, setDraggingDubbingClipId] = useState<string | null>(null);
  const [textMarqueeSelection, setTextMarqueeSelection] =
    useState<TextMarqueeSelectionState | null>(null);
  const [contextMenu, setContextMenu] = useState<TimelineContextMenu | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const trackLaneRef = useRef<HTMLDivElement>(null);
  const textDragStateRef = useRef<TextDragState | null>(null);
  const audioDragStateRef = useRef<AudioDragState | null>(null);
  const selectedTimelineClip = timelineClips.find(
    (clip) => clip.id === selectedTimelineClipId
  ) ?? null;
  const timelineDuration = Math.max(
    0,
    ...timelineClips.map((clip) => clip.end)
  );
  const zoomOutDurationScale = zoomLevel < 100 ? 100 / zoomLevel : 1;
  const timelineScaleDuration = timelineDuration * zoomOutDurationScale;
  const scrubWidth = Math.max(1, trackLaneWidth);
  const playheadTime = selectedTimelineClip
    ? selectedTimelineClip.start + currentTime
    : 0;
  const progress = timelineScaleDuration > 0
    ? Math.max(0, Math.min(playheadTime / timelineScaleDuration, 1))
    : 0;
  const playheadLeft = TRACK_LABEL_WIDTH + progress * scrubWidth;
  const rulerMarks = useMemo(() => {
    if (timelineScaleDuration <= 0) {
      return [0, 5, 10, 15].map((time) => ({ time, isMajor: true }));
    }

    const majorStep =
      timelineScaleDuration <= 20
        ? 2
        : timelineScaleDuration <= 60
          ? 5
          : timelineScaleDuration <= 180
            ? 15
            : timelineScaleDuration <= 600
              ? 60
              : 120;
    const minorStep = majorStep / 5;
    const marks = [];

    for (let time = 0; time <= timelineScaleDuration; time += minorStep) {
      const roundedTime = Number(time.toFixed(3));
      const majorIndex = Math.round(roundedTime / majorStep);
      const isMajor = Math.abs(roundedTime - majorIndex * majorStep) < 0.001;
      marks.push({ time: roundedTime, isMajor });

      if (marks.length > 180) {
        break;
      }
    }

    if (!marks.length) {
      marks.push({ time: Math.max(0, Math.round(timelineScaleDuration / 2)), isMajor: true });
    }

    return marks;
  }, [timelineScaleDuration]);
  const selectedTextClipIdSet = useMemo(() => new Set(
    selectedTextClipIds.length > 0
      ? selectedTextClipIds
      : selectedTextClipId
        ? [selectedTextClipId]
        : []
  ), [selectedTextClipId, selectedTextClipIds]);
  const textClipBounds = useMemo<TextClipBounds[]>(() => {
    if (timelineScaleDuration <= 0 || scrubWidth <= 0) {
      return [];
    }

    return textClips.flatMap((clip) => {
      const ownerClip = timelineClips.find(
        (timelineClip) => timelineClip.id === clip.timelineClipId
      );

      if (!ownerClip) {
        return [];
      }

      const left = ((ownerClip.start + clip.start) / timelineScaleDuration) * scrubWidth;
      const width = Math.max(36, ((clip.end - clip.start) / timelineScaleDuration) * scrubWidth);

      return [{
        id: clip.id,
        left,
        right: left + width,
      }];
    });
  }, [scrubWidth, textClips, timelineClips, timelineScaleDuration]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); // Prevent browser zooming
        const rect = container.getBoundingClientRect();
        const pointerX = e.clientX - rect.left;
        const contentX = container.scrollLeft + pointerX;
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

        setZoomLevel((prev) => {
          const nextZoom = clampZoomLevel(prev * zoomFactor);
          const widthRatio = Math.max(100, nextZoom) / Math.max(100, prev);

          window.requestAnimationFrame(() => {
            container.scrollLeft = Math.max(0, contentX * widthRatio - pointerX);
          });

          return nextZoom;
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const trackLane = trackLaneRef.current;
    if (!trackLane) {
      return;
    }

    const updateTrackWidth = () => {
      setTrackLaneWidth(Math.max(0, trackLane.getBoundingClientRect().width));
    };

    updateTrackWidth();

    const resizeObserver = new ResizeObserver(updateTrackWidth);
    resizeObserver.observe(trackLane);
    window.addEventListener('resize', updateTrackWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateTrackWidth);
    };
  }, [timelineClips.length, zoomLevel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || isScrubbing || timelineDuration <= 0) {
      return;
    }

    const visibleLeft = container.scrollLeft + TRACK_LABEL_WIDTH + 24;
    const visibleRight = container.scrollLeft + container.clientWidth - 48;
    const followMargin = 80;
    let nextScrollLeft: number | null = null;

    if (playheadLeft < visibleLeft + followMargin) {
      nextScrollLeft = Math.max(0, playheadLeft - TRACK_LABEL_WIDTH - followMargin);
    } else if (playheadLeft > visibleRight - followMargin) {
      nextScrollLeft = Math.max(0, playheadLeft - container.clientWidth + followMargin * 1.5);
    }

    if (nextScrollLeft !== null && Math.abs(nextScrollLeft - container.scrollLeft) > 2) {
      container.scrollTo({ left: nextScrollLeft, behavior: 'smooth' });
    }
  }, [isScrubbing, playheadLeft, timelineDuration]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeContextMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    window.addEventListener('pointerdown', closeContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeContextMenu);

    return () => {
      window.removeEventListener('pointerdown', closeContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeContextMenu);
    };
  }, [contextMenu]);

  const openTextContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    clip: TextClip,
    ownerClip: TimelineVideoClip
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onSeek(ownerClip.start + clip.start);

    if (!selectedTextClipIdSet.has(clip.id)) {
      onSelectTextClip(clip.id);
    }

    setContextMenu({
      kind: 'text',
      clipId: clip.id,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const openVideoContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    clip: TimelineVideoClip
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectTimelineClip(clip.id);
    setContextMenu({
      kind: 'video',
      clipId: clip.id,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const openAudioContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    clip: DubbingClip
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectDubbingClip(clip.id);
    setContextMenu({
      kind: 'audio',
      clipId: clip.id,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const deleteContextMenuTarget = () => {
    if (!contextMenu) {
      return;
    }

    if (contextMenu.kind === 'text') {
      if (selectedTextClipIdSet.has(contextMenu.clipId) && selectedTextClipIdSet.size > 1) {
        onDeleteSelectedTextClips();
        setContextMenu(null);
        return;
      }

      onDeleteTextClip(contextMenu.clipId);
    } else if (contextMenu.kind === 'audio') {
      onDeleteDubbingClip(contextMenu.clipId);
    } else {
      onDeleteTimelineClip(contextMenu.clipId);
    }

    setContextMenu(null);
  };

  const seekFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (timelineDuration <= 0) {
      return;
    }

    const trackLane = trackLaneRef.current;
    if (!trackLane) {
      return;
    }

    const rect = trackLane.getBoundingClientRect();
    const trackX = Math.max(0, event.clientX - rect.left);
    const nextTime = Math.max(
      0,
      Math.min(timelineDuration, (trackX / scrubWidth) * timelineScaleDuration)
    );

    onSeek(nextTime);
  };

  const getTrackXFromPointer = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();

    return Math.max(0, Math.min(scrubWidth, clientX - rect.left));
  };

  const resolveTextMarqueeSelection = (selection: TextMarqueeSelectionState) => {
    const selectionLeft = Math.min(selection.startX, selection.currentX);
    const selectionRight = Math.max(selection.startX, selection.currentX);
    const selectedIds = textClipBounds
      .filter((clipBounds) =>
        clipBounds.right >= selectionLeft && clipBounds.left <= selectionRight
      )
      .map((clipBounds) => clipBounds.id);

    if (!selection.additive) {
      return selectedIds;
    }

    return Array.from(new Set([...selection.originSelectedIds, ...selectedIds]));
  };

  const handleTextTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || timelineScaleDuration <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = getTrackXFromPointer(event.clientX, event.currentTarget);
    const originSelectedIds = selectedTextClipIds.length > 0
      ? selectedTextClipIds
      : selectedTextClipId
        ? [selectedTextClipId]
        : [];
    const selection: TextMarqueeSelectionState = {
      pointerId: event.pointerId,
      startX,
      currentX: startX,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      originSelectedIds,
    };

    setTextMarqueeSelection(selection);

    if (!selection.additive) {
      onSelectTextClips([]);
    }

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleTextTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!textMarqueeSelection || textMarqueeSelection.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const selection = {
      ...textMarqueeSelection,
      currentX: getTrackXFromPointer(event.clientX, event.currentTarget),
    };

    setTextMarqueeSelection(selection);
    onSelectTextClips(resolveTextMarqueeSelection(selection));
  };

  const finishTextTrackSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!textMarqueeSelection || textMarqueeSelection.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const selection = {
      ...textMarqueeSelection,
      currentX: getTrackXFromPointer(event.clientX, event.currentTarget),
    };
    const dragDistance = Math.abs(selection.currentX - selection.startX);

    if (dragDistance <= 3) {
      if (!selection.additive) {
        onSelectTextClips([]);
      }
    } else {
      onSelectTextClips(resolveTextMarqueeSelection(selection));
    }

    setTextMarqueeSelection(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || timelineDuration <= 0) {
      return;
    }

    event.preventDefault();
    setIsScrubbing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) {
      return;
    }

    event.preventDefault();
    seekFromPointer(event);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    setIsScrubbing(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const updateTextDrag = (clientX: number) => {
    const dragState = textDragStateRef.current;
    if (!dragState || scrubWidth <= 0 || timelineScaleDuration <= 0) {
      return;
    }

    const deltaSeconds = ((clientX - dragState.originClientX) / scrubWidth) * timelineScaleDuration;
    const originalDuration = Math.max(
      MIN_TEXT_CLIP_DURATION,
      dragState.originEnd - dragState.originStart
    );

    if (dragState.mode === 'move') {
      const maxStart = Math.max(0, dragState.clipDuration - originalDuration);
      const nextStart = Math.max(
        0,
        Math.min(maxStart, dragState.originStart + deltaSeconds)
      );
      onUpdateTextClip(dragState.clipId, {
        start: nextStart,
        end: nextStart + originalDuration,
      });
      return;
    }

    if (dragState.mode === 'trim-start') {
      const nextStart = Math.max(
        0,
        Math.min(dragState.originEnd - MIN_TEXT_CLIP_DURATION, dragState.originStart + deltaSeconds)
      );
      onUpdateTextClip(dragState.clipId, {
        start: nextStart,
        end: dragState.originEnd,
      });
      return;
    }

    const nextEnd = Math.max(
      dragState.originStart + MIN_TEXT_CLIP_DURATION,
      Math.min(dragState.clipDuration, dragState.originEnd + deltaSeconds)
    );
    onUpdateTextClip(dragState.clipId, {
      start: dragState.originStart,
      end: nextEnd,
    });
  };

  const handleTextPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    clip: TextClip,
    mode: TextDragMode
  ) => {
    const ownerClip = timelineClips.find(
      (timelineClip) => timelineClip.id === clip.timelineClipId
    );

    if (event.button !== 0 || !ownerClip) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    onSeek(ownerClip.start + clip.start);
    onSelectTextClip(
      clip.id,
      event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : 'single'
    );

    textDragStateRef.current = {
      clipId: clip.id,
      pointerId: event.pointerId,
      mode,
      originClientX: event.clientX,
      originStart: clip.start,
      originEnd: clip.end,
      clipDuration: Math.max(
        MIN_TEXT_CLIP_DURATION,
        ownerClip.end - ownerClip.start
      ),
    };
    setDraggingTextClipId(clip.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleTextPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = textDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    updateTextDrag(event.clientX);
  };

  const handleTextPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = textDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    textDragStateRef.current = null;
    setDraggingTextClipId(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const updateAudioDrag = (clientX: number) => {
    const dragState = audioDragStateRef.current;
    if (!dragState || scrubWidth <= 0 || timelineScaleDuration <= 0) {
      return;
    }

    const deltaSeconds = ((clientX - dragState.originClientX) / scrubWidth) * timelineScaleDuration;
    const originalDuration = Math.max(
      MIN_TEXT_CLIP_DURATION,
      dragState.originEnd - dragState.originStart
    );

    if (dragState.mode === 'move') {
      const maxStart = Math.max(0, timelineDuration - originalDuration);
      const nextStart = Math.max(
        0,
        Math.min(maxStart, dragState.originStart + deltaSeconds)
      );
      onUpdateDubbingClip(dragState.clipId, {
        start: nextStart,
        end: nextStart + originalDuration,
      });
      return;
    }

    if (dragState.mode === 'trim-start') {
      const nextStart = Math.max(
        0,
        Math.min(dragState.originEnd - MIN_TEXT_CLIP_DURATION, dragState.originStart + deltaSeconds)
      );
      onUpdateDubbingClip(dragState.clipId, {
        start: nextStart,
        end: dragState.originEnd,
      });
      return;
    }

    const nextEnd = Math.max(
      dragState.originStart + MIN_TEXT_CLIP_DURATION,
      Math.min(timelineDuration, dragState.originEnd + deltaSeconds)
    );
    onUpdateDubbingClip(dragState.clipId, {
      start: dragState.originStart,
      end: nextEnd,
    });
  };

  const handleAudioPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    clip: DubbingClip,
    mode: AudioDragMode
  ) => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    onSelectDubbingClip(clip.id);

    audioDragStateRef.current = {
      clipId: clip.id,
      pointerId: event.pointerId,
      mode,
      originClientX: event.clientX,
      originStart: clip.start,
      originEnd: clip.end,
    };
    setDraggingDubbingClipId(clip.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleAudioPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = audioDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    updateAudioDrag(event.clientX);
  };

  const handleAudioPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = audioDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    audioDragStateRef.current = null;
    setDraggingDubbingClipId(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="h-full min-h-0 bg-[#151515] border-t border-black flex flex-col relative text-gray-200">
      {/* Timeline Toolbar */}
      <div className="h-11 bg-[#202020] flex items-center px-4 justify-between border-b border-black/80 shadow-[0_6px_18px_rgba(0,0,0,0.22)] z-10">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo (Ctrl+Z)"
            className={TOOL_BUTTON_CLASS}
          >
            <Undo size={14} />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
            className={TOOL_BUTTON_CLASS}
          >
            <Redo size={14} />
          </button>
          <div className="w-px h-5 bg-white/10 mx-2 my-auto" />
          <button type="button" title="Selection tool" className={ACTIVE_TOOL_BUTTON_CLASS}>
            <MousePointer2 size={14} />
          </button>
          <button
            type="button"
            disabled={!canSplitClip}
            onClick={() => onSplitTimelineClip()}
            title="Split clip at playhead (Ctrl+B)"
            className={TOOL_BUTTON_CLASS}
          >
            <Scissors size={14} />
          </button>
        </div>
        <div className="flex items-center gap-5">
           <button type="button" title="Voice tools" className={TOOL_BUTTON_CLASS}>
             <Mic size={14} />
           </button>
           <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1">
              <ZoomOut size={14} className="text-gray-500" />
              <input
                type="range"
                min={MIN_ZOOM_LEVEL}
                max={MAX_ZOOM_LEVEL}
                value={zoomLevel}
                onChange={(e) => setZoomLevel(clampZoomLevel(Number(e.target.value)))}
                aria-label="Timeline zoom"
                className="w-32 accent-blue-400 h-1.5 bg-[#343434] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-gray-100 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow cursor-pointer"
              />
              <ZoomIn size={14} className="text-gray-500" />
              <span className="w-11 text-right text-[10px] font-mono text-gray-500">
                {Math.round(zoomLevel)}%
              </span>
           </div>
        </div>
      </div>

      {/* Scrollable Tracks Area */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-auto bg-[#151515] flex flex-col relative scroll-smooth"
      >
        {/* Dynamic Width Container based on Zoom */}
        <div
          ref={timelineContentRef}
          style={{ width: `${Math.max(100, zoomLevel)}%`, minWidth: '100%' }}
          className="flex flex-col relative pb-4 select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          
          {/* Time Ruler inside scroll area so it scrolls with tracks */}
          <div className="h-7 bg-[#181818]/95 border-b border-white/10 relative pl-[100px] sticky top-0 z-20 backdrop-blur">
             {rulerMarks.map((mark) => (
               <div
                 key={`${mark.time}-${mark.isMajor ? 'major' : 'minor'}`}
                 className="absolute bottom-0 font-mono"
                 style={{
                   left:
                     timelineScaleDuration > 0
                       ? `${TRACK_LABEL_WIDTH + (mark.time / timelineScaleDuration) * scrubWidth}px`
                       : `${TRACK_LABEL_WIDTH + mark.time * 60}px`,
                 }}
               >
                 <div className={`${mark.isMajor ? 'h-3 bg-white/30' : 'h-1.5 bg-white/10'} w-px`} />
                 {mark.isMajor && (
                   <div className="absolute left-1 top-[-20px] whitespace-nowrap text-[10px] text-gray-500">
                     {formatDuration(mark.time)}
                   </div>
                 )}
               </div>
             ))}
          </div>

          <div className="relative flex flex-col pt-2 gap-2 z-10">
            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-white/90 z-50 pointer-events-none group h-full shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{ left: `${playheadLeft}px` }}
            >
               <div className="w-3.5 h-4 bg-white rounded-[3px] transform -translate-x-1/2 -mt-2 shadow-[0_2px_10px_rgba(0,0,0,0.45)] flex items-center justify-center pointer-events-auto cursor-ew-resize">
                 <div className="w-px h-2 bg-gray-500" />
               </div>
            </div>

            {/* Text Track */}
            <div className="flex h-9 relative group">
               <div className={`${TRACK_LABEL_CLASS} items-center`} style={TRACK_LABEL_STYLE}>
                  <span className="text-[10px] font-medium text-gray-400">Text/Sub</span>
               </div>
               <div
                 className="flex-1 relative cursor-crosshair rounded-md border border-white/[0.05] bg-[#101010]/80 shadow-inner"
                 onPointerDown={handleTextTrackPointerDown}
                 onPointerMove={handleTextTrackPointerMove}
                 onPointerUp={finishTextTrackSelection}
                 onPointerCancel={finishTextTrackSelection}
               >
                  {textClips.length > 0 && timelineScaleDuration > 0 ? (
                    textClips.map((clip) => {
                      const ownerClip = timelineClips.find(
                        (timelineClip) => timelineClip.id === clip.timelineClipId
                      );

                      if (!ownerClip) {
                        return null;
                      }

                      const left = ((ownerClip.start + clip.start) / timelineScaleDuration) * scrubWidth;
                      const width = Math.max(36, ((clip.end - clip.start) / timelineScaleDuration) * scrubWidth);
                      const isSelected = selectedTextClipIdSet.has(clip.id);

                      return (
                        <button
                          key={clip.id}
                          type="button"
                          data-text-clip-id={clip.id}
                          onPointerDown={(event) => handleTextPointerDown(event, clip, 'move')}
                          onPointerMove={handleTextPointerMove}
                          onPointerUp={handleTextPointerUp}
                          onPointerCancel={handleTextPointerUp}
                          onClick={(event) => event.stopPropagation()}
                          onContextMenu={(event) => openTextContextMenu(event, clip, ownerClip)}
                          className={`absolute inset-y-1 flex touch-none items-center rounded-md border px-3 text-left text-[10px] font-medium text-white cursor-grab active:cursor-grabbing shadow-[0_3px_10px_rgba(0,0,0,0.25)] transition-[background-color,border-color,box-shadow] ${
                            isSelected
                              ? 'border-white/90 bg-[#d27a38] ring-1 ring-white/60'
                              : 'border-[#df8747]/80 bg-[#bd6e33] hover:border-orange-200/80 hover:bg-[#c9783a]'
                          } ${draggingTextClipId === clip.id ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.28),0_8px_18px_rgba(0,0,0,0.35)]' : ''}`}
                          style={{ left: `${left}px`, width: `${width}px` }}
                        >
                          <span
                            className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize rounded-l-md bg-white/15 hover:bg-white/35"
                            onPointerDown={(event) => handleTextPointerDown(event, clip, 'trim-start')}
                            onPointerMove={handleTextPointerMove}
                            onPointerUp={handleTextPointerUp}
                            onPointerCancel={handleTextPointerUp}
                          />
                          <span className="pointer-events-none block min-w-0 truncate">
                            {clip.text}
                          </span>
                          <span
                            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-r-md bg-white/15 hover:bg-white/35"
                            onPointerDown={(event) => handleTextPointerDown(event, clip, 'trim-end')}
                            onPointerMove={handleTextPointerMove}
                            onPointerUp={handleTextPointerUp}
                            onPointerCancel={handleTextPointerUp}
                          />
                        </button>
                      );
                    })
                  ) : (
                    <div className="absolute inset-y-1 left-0 text-[10px] text-gray-600 flex items-center px-3">
                      Captions/text pending
                    </div>
                  )}
                  {textMarqueeSelection && Math.abs(textMarqueeSelection.currentX - textMarqueeSelection.startX) > 3 && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-30 rounded border border-blue-300 bg-blue-400/15 shadow-[0_0_18px_rgba(96,165,250,0.16)]"
                      style={{
                        left: `${Math.min(textMarqueeSelection.startX, textMarqueeSelection.currentX)}px`,
                        width: `${Math.abs(textMarqueeSelection.currentX - textMarqueeSelection.startX)}px`,
                      }}
                    />
                  )}
               </div>
            </div>

            {/* Main Video Track */}
            <div className="flex h-[72px] relative group">
               <div className={`${TRACK_LABEL_CLASS} flex-col justify-center`} style={TRACK_LABEL_STYLE}>
                  <span className="text-[10px] font-medium text-gray-400">Main Track</span>
                  <div className="mt-1 flex items-center gap-1 text-gray-500">
                    <Volume2 size={12} />
                    <span className="text-[9px]">Video</span>
                  </div>
               </div>
               <div
                 ref={trackLaneRef}
                 className="flex-1 relative cursor-ew-resize overflow-hidden rounded-md border border-white/[0.05] bg-[#0f0f0f] shadow-inner"
               >
                 <div
                   className={`absolute inset-0 z-0 transition-colors ${isVideoDragOver ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-300/80' : 'bg-[linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[length:72px_100%]'}`}
                   onDragOver={(event) => {
                     if (event.dataTransfer.types.includes('application/x-video-id')) {
                       event.preventDefault();
                       event.dataTransfer.dropEffect = 'copy';
                       setIsVideoDragOver(true);
                     }
                   }}
                   onDragLeave={() => setIsVideoDragOver(false)}
                   onDrop={(event) => {
                     event.preventDefault();
                     setIsVideoDragOver(false);
                     const videoId =
                       event.dataTransfer.getData('application/x-video-id') ||
                       event.dataTransfer.getData('text/plain');

                     if (videoId) {
                       onAddVideoToTimeline(videoId);
                     }
                   }}
                 />
                 {timelineClips.length > 0 && timelineScaleDuration > 0 ? (
                   timelineClips.map((clip, index) => {
                     const clipVideo = videos.find((currentVideo) => currentVideo.id === clip.videoId);
                     if (!clipVideo) {
                       return null;
                     }

                     const clipDuration = clip.end - clip.start;
                     const left = (clip.start / timelineScaleDuration) * scrubWidth;
                     const width = Math.max(80, (clipDuration / timelineScaleDuration) * scrubWidth);

                     return (
                       <button
                         key={clip.id}
                         type="button"
                         data-timeline-clip-id={clip.id}
                         onClick={() => onSelectTimelineClip(clip.id)}
                         onContextMenu={(event) => openVideoContextMenu(event, clip)}
                         onPointerDown={(event) => event.stopPropagation()}
                         className={`absolute inset-y-1 overflow-hidden rounded-md border cursor-pointer transition-[border-color,box-shadow,filter,background-color] hover:brightness-110 focus:outline-none focus:ring-1 focus:ring-white ${
                           selectedTimelineClipId === clip.id
                             ? 'bg-[#28659a] border-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_8px_18px_rgba(0,0,0,0.35)]'
                             : 'bg-[#20496e] border-[#30689e]/85 shadow-[0_5px_12px_rgba(0,0,0,0.22)]'
                         }`}
                         style={{ left: `${left}px`, width: `${width}px` }}
                       >
                         <ClipThumbnailStrip
                           video={clipVideo}
                           clipDuration={clipDuration}
                           clipWidth={width}
                         />
                         <div className="absolute inset-0 bg-gradient-to-b from-[#183b5c]/35 via-[#183b5c]/15 to-[#102d45]/80 pointer-events-none" />
                         <div className="relative z-10 min-w-0 max-w-full px-2.5 py-1.5 text-left pointer-events-none">
                           <div className="text-[10px] font-semibold text-white truncate drop-shadow">{clipVideo.name}</div>
                           <div className="text-[9px] text-blue-100/70">
                             Clip {index + 1} - {formatDuration(clipDuration)}
                           </div>
                         </div>
                         <div className="absolute bottom-0 left-0 right-0 h-[18px] bg-[#0f2f49]/80 flex items-end pointer-events-none z-10">
                            <svg preserveAspectRatio="none" className="w-full h-[75%] text-[#64a7e5]/80" fill="currentColor" viewBox="0 0 100 100"><path d="M0,100 L0,50 L5,60 L10,30 L15,80 L20,20 L25,70 L30,40 L35,90 L40,10 L45,60 L50,40 L55,80 L60,20 L65,70 L70,30 L75,90 L80,50 L85,60 L90,20 L95,80 L100,40 L100,100 Z"/></svg>
                         </div>
                       </button>
                     );
                   })
                 ) : (
                   <div className="absolute inset-y-2 left-2 right-4 text-[10px] text-gray-500 flex items-center px-3 border border-dashed border-white/15 rounded-md bg-black/20 pointer-events-none">
                     Kéo video từ Media vào đây để tạo clip trên timeline
                   </div>
                 )}
               </div>
            </div>

            {/* Audio Track (Dubbing) */}
            <div className="flex h-12 relative group">
               <div className={`${TRACK_LABEL_CLASS} items-center`} style={TRACK_LABEL_STYLE}>
                  <span className="text-[10px] font-medium text-gray-400">Voice/BGM</span>
               </div>
               <div className="flex-1 relative rounded-md border border-white/[0.05] bg-[#101010]/70 shadow-inner">
                 {dubbingClips.length > 0 && timelineScaleDuration > 0 ? (
                   dubbingClips.map((clip) => {
                     const left = (clip.start / timelineScaleDuration) * scrubWidth;
                     const width = Math.max(44, ((clip.end - clip.start) / timelineScaleDuration) * scrubWidth);
                     const isSelected = selectedDubbingClipId === clip.id;

                     return (
                       <button
                         key={clip.id}
                         type="button"
                         data-dubbing-clip-id={clip.id}
                         className={`absolute inset-y-1 flex touch-none items-center rounded-md border px-3 text-left text-[10px] font-medium text-white shadow-[0_4px_12px_rgba(0,0,0,0.24)] transition-[background-color,border-color,box-shadow] cursor-grab active:cursor-grabbing ${
                           isSelected
                             ? 'border-white/90 bg-emerald-500/70 ring-1 ring-white/55'
                             : 'border-emerald-300/50 bg-emerald-600/55 hover:border-emerald-100/80 hover:bg-emerald-500/60'
                         } ${draggingDubbingClipId === clip.id ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.24),0_8px_18px_rgba(0,0,0,0.35)]' : ''}`}
                         title={`${clip.text} - ${clip.voice} - ${(clip.speed || 1).toFixed(2)}x`}
                         onPointerDown={(event) => handleAudioPointerDown(event, clip, 'move')}
                         onPointerMove={handleAudioPointerMove}
                         onPointerUp={handleAudioPointerUp}
                         onPointerCancel={handleAudioPointerUp}
                         onClick={(event) => event.stopPropagation()}
                         onContextMenu={(event) => openAudioContextMenu(event, clip)}
                         style={{
                           left: `${left}px`,
                           width: `${width}px`,
                         }}
                       >
                         <span
                           className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize rounded-l-md bg-white/15 hover:bg-white/35"
                           onPointerDown={(event) => handleAudioPointerDown(event, clip, 'trim-start')}
                           onPointerMove={handleAudioPointerMove}
                           onPointerUp={handleAudioPointerUp}
                           onPointerCancel={handleAudioPointerUp}
                         />
                         <span className="pointer-events-none block min-w-0 truncate">
                           Voice: {clip.text}
                         </span>
                         <span className="pointer-events-none ml-auto pl-2 text-[9px] text-emerald-50/75">
                           {(clip.speed || 1).toFixed(2)}x
                         </span>
                         <span
                           className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-r-md bg-white/15 hover:bg-white/35"
                           onPointerDown={(event) => handleAudioPointerDown(event, clip, 'trim-end')}
                           onPointerMove={handleAudioPointerMove}
                           onPointerUp={handleAudioPointerUp}
                           onPointerCancel={handleAudioPointerUp}
                         />
                       </button>
                     );
                   })
                 ) : video?.vocalsPath && selectedTimelineClip && timelineScaleDuration > 0 ? (
                   <div
                     className="absolute inset-y-1 left-0 rounded-md border border-emerald-300/50 bg-emerald-600/45 px-2 text-[10px] font-medium text-white flex items-center truncate shadow-[0_4px_12px_rgba(0,0,0,0.24)]"
                     title={video.vocalsPath}
                     style={{
                       left: `${(selectedTimelineClip.start / timelineScaleDuration) * scrubWidth}px`,
                       width: `${Math.max(80, ((selectedTimelineClip.end - selectedTimelineClip.start) / timelineScaleDuration) * scrubWidth)}px`,
                     }}
                   >
                   Voice Trung isolated
                 </div>
               ) : (
                   <div className="absolute inset-y-1 left-0 text-[10px] text-gray-600 flex items-center px-3">
                     Voice/BGM pending
                   </div>
                 )}
               </div>
            </div>
          </div>
        </div>
      </div>
      {contextMenu && (
        <div
          className="fixed z-[100] w-52 rounded-md border border-white/10 bg-[#202020] p-1 text-gray-200 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextMenu.kind === 'video' && (
            <>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-gray-200 transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                onClick={() => {
                  onCopyTimelineClip(contextMenu.clipId);
                  setContextMenu(null);
                }}
              >
                <span>Copy Clip</span>
                <span className="ml-auto text-[10px] text-gray-500">Ctrl+C</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-gray-200 transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                onClick={() => {
                  onDuplicateTimelineClip(contextMenu.clipId);
                  setContextMenu(null);
                }}
              >
                <span>Duplicate Clip</span>
                <span className="ml-auto text-[10px] text-gray-500">Ctrl+D</span>
              </button>
              <div className="my-1 h-px bg-[#343434]" />
            </>
          )}
          <button
            type="button"
            className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-red-400 transition-colors hover:bg-red-500/15 focus:bg-red-500/15 focus:outline-none"
            onClick={deleteContextMenuTarget}
          >
            <span>
              {contextMenu.kind === 'text' && selectedTextClipIdSet.has(contextMenu.clipId) && selectedTextClipIdSet.size > 1
                ? `Delete ${selectedTextClipIdSet.size} Texts`
                : contextMenu.kind === 'text'
                  ? 'Delete Text'
                  : contextMenu.kind === 'audio'
                    ? 'Delete Audio'
                    : 'Delete'}
            </span>
            <span className="ml-auto text-[10px] text-gray-500">Del</span>
          </button>
        </div>
      )}
    </div>
  );
};
