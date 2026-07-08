import { useCallback, useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { Film, Maximize, Pause, Play, Settings, SkipBack, SkipForward, VolumeX } from 'lucide-react';
import { formatDuration } from '@/lib/media';
import {
  DEFAULT_TEXT_FONT,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TEXT_STROKE_COLOR,
  DEFAULT_TEXT_STROKE_WIDTH,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TEXT_WEIGHT,
  getEffectiveTextBackgroundColor,
  getEffectiveTextBackgroundOpacity,
  getEffectiveTextColor,
  hexToRgba,
} from '@/lib/text-style';
import type { BlurMaskClip, DubbingClip, ImportedVideo, SeekCommand, TextClip } from '@/types/media';

interface PlayerProps {
  video: ImportedVideo | null
  textClips: TextClip[]
  dubbingClips: DubbingClip[]
  blurMaskClips: BlurMaskClip[]
  reduceOriginalAudioAll: boolean
  selectedBlurMaskClipId: string | null
  selectedTextClipId: string | null
  selectedTextClipIds: string[]
  currentTime: number
  timelineCurrentTime: number
  timelineDuration: number
  clipSourceStart: number
  clipSourceEnd: number | null
  seekCommand: SeekCommand
  onDurationChange: (videoId: string, duration: number, width?: number, height?: number) => void
  onTimeChange: (time: number) => void
  onSeekTimeline: (time: number) => void
  onClipEnded: () => boolean
  onSelectTextClip: (clipId: string, mode?: 'single' | 'toggle' | 'add') => void
  onUpdateTextClip: (clipId: string, patch: Partial<TextClip>) => void
  onSelectBlurMaskClip: (clipId: string) => void
  onUpdateBlurMaskClip: (clipId: string, patch: Partial<BlurMaskClip>) => void
  onToggleReduceOriginalAudioAll: () => void
}

export const Player = ({
  video,
  textClips,
  dubbingClips,
  blurMaskClips,
  reduceOriginalAudioAll,
  selectedBlurMaskClipId,
  selectedTextClipId,
  selectedTextClipIds,
  currentTime,
  timelineCurrentTime,
  timelineDuration,
  clipSourceStart,
  clipSourceEnd,
  seekCommand,
  onDurationChange,
  onTimeChange,
  onSeekTimeline,
  onClipEnded,
  onSelectTextClip,
  onUpdateTextClip,
  onSelectBlurMaskClip,
  onUpdateBlurMaskClip,
  onToggleReduceOriginalAudioAll,
}: PlayerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const shouldAutoPlayNextClipRef = useRef(false);
  const dubbingAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const visibleTextClips = textClips.filter(
    (clip) => currentTime >= clip.start && currentTime <= clip.end
  );
  const visibleBlurMaskClips = blurMaskClips.filter(
    (clip) => currentTime >= clip.start && currentTime <= clip.end
  );
  const isDubbingActive = dubbingClips.some(
    (clip) => timelineCurrentTime >= clip.start && timelineCurrentTime <= clip.end
  );
  const selectedTextClipIdSet = new Set(
    selectedTextClipIds.length > 0
      ? selectedTextClipIds
      : selectedTextClipId
        ? [selectedTextClipId]
        : []
  );
  const videoAspectRatio =
    video?.width && video.height && video.width > 0 && video.height > 0
      ? video.width / video.height
      : 16 / 9;
  const nativeVideoWidth = video?.width && video.width > 0 ? video.width : canvasSize.width;
  const previewFontScale =
    nativeVideoWidth > 0 && canvasSize.width > 0
      ? canvasSize.width / nativeVideoWidth
      : 1;
  const textBoxWidth = Math.max(1, canvasSize.width * 0.86);

  const playCurrentVideo = useCallback(async () => {
    const player = videoRef.current;
    if (!player) {
      return false;
    }

    try {
      const sourceEnd = clipSourceEnd ?? player.duration;

      if (
        Number.isFinite(clipSourceStart) &&
        (player.currentTime < clipSourceStart || player.currentTime >= sourceEnd)
      ) {
        player.currentTime = clipSourceStart;
      }

      await player.play();
      setIsPlaying(true);
      return true;
    } catch (error) {
      console.error('Unable to play video', error);
    }

    return false;
  }, [clipSourceEnd, clipSourceStart]);

  const togglePlayback = useCallback(async () => {
    const player = videoRef.current;
    if (!player) {
      return;
    }

    if (player.paused) {
      await playCurrentVideo();
      return;
    }

    player.pause();
    setIsPlaying(false);
  }, [playCurrentVideo]);

  const seekBy = (seconds: number) => {
    if (timelineDuration <= 0) {
      return;
    }

    onSeekTimeline(Math.max(0, Math.min(timelineDuration, timelineCurrentTime + seconds)));
  };

  useEffect(() => {
    const player = videoRef.current;
    if (!player || !video) {
      return;
    }

    const duration = player.duration || video.duration || 0;
    const sourceEnd = clipSourceEnd ?? duration;
    const nextTime = Math.max(
      clipSourceStart,
      Math.min(clipSourceStart + seekCommand.time, sourceEnd || clipSourceStart + seekCommand.time)
    );

    if (Number.isFinite(nextTime) && Math.abs(player.currentTime - nextTime) > 0.03) {
      player.currentTime = nextTime;
    }
  }, [clipSourceEnd, clipSourceStart, seekCommand.id, seekCommand.time, video]);

  useEffect(() => {
    if (!shouldAutoPlayNextClipRef.current || !video) {
      return;
    }

    const player = videoRef.current;
    if (!player) {
      return;
    }

    if (player.readyState >= HTMLMediaElement.HAVE_METADATA) {
      shouldAutoPlayNextClipRef.current = false;
      void playCurrentVideo();
      return;
    }

    const handleLoadedMetadata = () => {
      shouldAutoPlayNextClipRef.current = false;
      void playCurrentVideo();
    };

    player.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    return () => player.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, [playCurrentVideo, seekCommand.id, video]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let frameId = 0;

    const syncCurrentTime = () => {
      const player = videoRef.current;
      if (player) {
        onTimeChange(player.currentTime);
      }

      frameId = requestAnimationFrame(syncCurrentTime);
    };

    frameId = requestAnimationFrame(syncCurrentTime);

    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, onTimeChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !video) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (isTypingTarget) {
        return;
      }

      event.preventDefault();
      void togglePlayback();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayback, video]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const updateCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };

    updateCanvasSize();
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(canvas);
    window.addEventListener('resize', updateCanvasSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [video]);

  useEffect(() => {
    const audioMap = dubbingAudioRefs.current;
    const activeDubbingClipIds = new Set(dubbingClips.map((clip) => clip.id));

    audioMap.forEach((audio, clipId) => {
      if (!activeDubbingClipIds.has(clipId)) {
        audio.pause();
        audioMap.delete(clipId);
      }
    });

    if (!isPlaying) {
      audioMap.forEach((audio) => audio.pause());
      return;
    }

    dubbingClips.forEach((clip) => {
      let audio = audioMap.get(clip.id);

      if (!audio) {
        audio = new Audio(clip.audioUrl);
        audio.preload = 'auto';
        audioMap.set(clip.id, audio);
      }

      const offset = timelineCurrentTime - clip.start;
      const isActive = offset >= 0 && timelineCurrentTime <= clip.end;
      const speed = Math.max(0.5, Math.min(2, clip.speed || 1));
      const audioTime = Math.max(0, offset * speed);

      if (!isActive) {
        audio.pause();
        return;
      }

      audio.volume = Math.max(0, Math.min(1, clip.volume ?? 1));
      audio.playbackRate = speed;

      if (Math.abs(audio.currentTime - audioTime) > 0.18) {
        audio.currentTime = audioTime;
      }

      if (audio.paused) {
        void audio.play().catch(() => {
          audio.pause();
        });
      }
    });
  }, [dubbingClips, isPlaying, timelineCurrentTime]);

  useEffect(() => {
    const player = videoRef.current;

    if (!player) {
      return;
    }

    player.volume = reduceOriginalAudioAll || isDubbingActive ? 0.18 : 1;
  }, [isDubbingActive, reduceOriginalAudioAll]);

  useEffect(() => () => {
    dubbingAudioRefs.current.forEach((audio) => {
      audio.pause();
    });
    dubbingAudioRefs.current.clear();
  }, []);

  return (
    <div className="min-w-0 flex-1 glass-card border-r border-border/50 flex flex-col h-full shadow-lg relative z-0">
      {/* Top Toolbar */}
      <div className="h-12 flex items-center px-4 justify-between border-b border-border/40 bg-muted/20 backdrop-blur-md">
         <span className="text-xs text-gray-400">Player</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onToggleReduceOriginalAudioAll}
              className={`rounded p-1.5 transition-colors ${
                reduceOriginalAudioAll
                  ? 'text-primary bg-primary/10 shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
              title="Reduce original audio for whole timeline"
              aria-pressed={reduceOriginalAudioAll}
            >
              <VolumeX size={14} />
            </button>
            <button className="text-gray-400 hover:text-white"><Settings size={14} /></button>
          </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden p-4">
        <div
          ref={canvasRef}
          className="max-h-full max-w-full bg-black relative border border-white/10 rounded-lg overflow-hidden shadow-2xl transition-all"
          style={{
            aspectRatio: `${videoAspectRatio}`,
            width: videoAspectRatio >= 1 ? '100%' : 'auto',
            height: videoAspectRatio < 1 ? '100%' : 'auto',
          }}
        >
          {video ? (
            <video
              key={video.id}
              ref={videoRef}
              src={video.url}
              className="w-full h-full object-contain bg-black"
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration;
                const sourceEnd = clipSourceEnd ?? duration;
                const nextTime = Math.max(
                  clipSourceStart,
                  Math.min(clipSourceStart + seekCommand.time, sourceEnd || clipSourceStart + seekCommand.time)
                );

                onDurationChange(
                  video.id,
                  duration,
                  event.currentTarget.videoWidth,
                  event.currentTarget.videoHeight
                );
                event.currentTarget.currentTime = nextTime;
                onTimeChange(Math.max(0, nextTime - clipSourceStart));

                if (!shouldAutoPlayNextClipRef.current) {
                  setIsPlaying(false);
                }
              }}
              onTimeUpdate={(event) => {
                const player = event.currentTarget;
                const sourceEnd = clipSourceEnd ?? player.duration;
                const localTime = Math.max(0, player.currentTime - clipSourceStart);

                onTimeChange(localTime);

                if (Number.isFinite(sourceEnd) && player.currentTime >= sourceEnd - 0.03) {
                  player.pause();
                  const hasNextClip = onClipEnded();

                  if (hasNextClip) {
                    shouldAutoPlayNextClipRef.current = true;
                  }
                }
              }}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onEnded={() => {
                const hasNextClip = onClipEnded();

                if (hasNextClip) {
                  shouldAutoPlayNextClipRef.current = true;
                  return;
                }

                setIsPlaying(false);
              }}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-background/50 text-muted-foreground backdrop-blur-sm rounded-lg">
              <Film size={34} className="mb-3" />
              <div className="text-sm text-gray-300">Chưa có video trên timeline</div>
              <div className="text-xs text-gray-500 mt-1">Import video rồi kéo từ Media xuống Main Track</div>
            </div>
          )}

          {video && visibleBlurMaskClips.map((clip) => {
            const maskWidth = Math.max(24, (clip.width / 100) * canvasSize.width);
            const maskHeight = Math.max(16, (clip.height / 100) * canvasSize.height);
            const maskLeft = (clip.x / 100) * canvasSize.width - maskWidth / 2;
            const maskTop = (clip.y / 100) * canvasSize.height - maskHeight / 2;
            const isCaptionCover = clip.source === 'caption_cover';
            const isSelected = selectedBlurMaskClipId === clip.id;

            return (
              <Rnd
                key={clip.id}
                position={{
                  x: maskLeft,
                  y: maskTop,
                }}
                size={{
                  width: maskWidth,
                  height: maskHeight,
                }}
                bounds="parent"
                minWidth={24}
                minHeight={16}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onSelectBlurMaskClip(clip.id);
                }}
                onDragStop={(_event, data) => {
                  const nextX = canvasSize.width > 0
                    ? ((data.x + maskWidth / 2) / canvasSize.width) * 100
                    : clip.x;
                  const nextY = canvasSize.height > 0
                    ? ((data.y + maskHeight / 2) / canvasSize.height) * 100
                    : clip.y;

                  onUpdateBlurMaskClip(clip.id, {
                    x: Math.max(0, Math.min(100, nextX)),
                    y: Math.max(0, Math.min(100, nextY)),
                  });
                }}
                onResizeStop={(_event, _direction, ref, _delta, position) => {
                  const nextWidth = canvasSize.width > 0
                    ? (ref.offsetWidth / canvasSize.width) * 100
                    : clip.width;
                  const nextHeight = canvasSize.height > 0
                    ? (ref.offsetHeight / canvasSize.height) * 100
                    : clip.height;
                  const nextX = canvasSize.width > 0
                    ? ((position.x + ref.offsetWidth / 2) / canvasSize.width) * 100
                    : clip.x;
                  const nextY = canvasSize.height > 0
                    ? ((position.y + ref.offsetHeight / 2) / canvasSize.height) * 100
                    : clip.y;

                  onUpdateBlurMaskClip(clip.id, {
                    x: Math.max(0, Math.min(100, nextX)),
                    y: Math.max(0, Math.min(100, nextY)),
                    width: Math.max(3, Math.min(100, nextWidth)),
                    height: Math.max(3, Math.min(100, nextHeight)),
                  });
                }}
                className="z-10 cursor-move"
              >
                <div
                  className={`h-full w-full border bg-white/10 ${
                    isCaptionCover ? 'rounded-sm' : 'rounded'
                  } ${
                    isSelected
                      ? 'border-white ring-1 ring-cyan-300'
                      : isCaptionCover
                        ? 'border-transparent'
                        : 'border-cyan-300/80'
                  }`}
                  style={{
                    backgroundColor:
                      clip.mode === 'solid'
                        ? hexToRgba(clip.color ?? '#ffd84d', clip.opacity ?? 0.86)
                        : undefined,
                    backdropFilter: clip.mode === 'solid' ? undefined : `blur(${clip.intensity}px)`,
                    WebkitBackdropFilter: clip.mode === 'solid' ? undefined : `blur(${clip.intensity}px)`,
                    boxShadow: isSelected || !isCaptionCover
                      ? 'inset 0 0 0 1px rgba(0, 0, 0, 0.45)'
                      : '0 6px 18px rgba(0, 0, 0, 0.18)',
                  }}
                />
              </Rnd>
            );
          })}

          {video && visibleTextClips.map((clip) => (
            <Rnd
              key={clip.id}
              position={{
                x: (clip.x / 100) * canvasSize.width,
                y: (clip.y / 100) * canvasSize.height,
              }}
              size={{ width: 1, height: 1 }}
              bounds="parent"
              enableResizing={false}
              onMouseDown={(event) => {
                event.stopPropagation();
                onSelectTextClip(clip.id);
              }}
              onDragStop={(_event, data) => {
                const nextX = canvasSize.width > 0 ? (data.x / canvasSize.width) * 100 : clip.x;
                const nextY = canvasSize.height > 0 ? (data.y / canvasSize.height) * 100 : clip.y;
                onUpdateTextClip(clip.id, {
                  x: Math.max(0, Math.min(100, nextX)),
                  y: Math.max(0, Math.min(100, nextY)),
                });
              }}
              className="z-20 cursor-move"
            >
              <div
                className={`whitespace-pre-wrap rounded-md text-center leading-[1.12] tracking-normal ${
                  selectedTextClipIdSet.has(clip.id) ? 'ring-1 ring-white/80' : ''
                }`}
                style={{
                  boxSizing: 'border-box',
                  width: clip.source === 'caption' ? `${textBoxWidth}px` : 'max-content',
                  maxWidth: `${textBoxWidth}px`,
                  transform: 'translate(-50%, -50%)',
                  padding: `${Math.max(2, 6 * previewFontScale)}px ${Math.max(4, 12 * previewFontScale)}px`,
                  fontFamily: clip.fontFamily || DEFAULT_TEXT_FONT,
                  fontSize: `${Math.max(8, (clip.fontSize || DEFAULT_TEXT_SIZE) * previewFontScale)}px`,
                  fontWeight: clip.fontWeight ?? DEFAULT_TEXT_WEIGHT,
                  fontStyle: clip.fontStyle ?? DEFAULT_TEXT_STYLE,
                  color: getEffectiveTextColor(clip),
                  backgroundColor: hexToRgba(
                    getEffectiveTextBackgroundColor(clip),
                    getEffectiveTextBackgroundOpacity(clip)
                  ),
                  WebkitTextStroke: `${Math.max(0, (clip.strokeWidth ?? DEFAULT_TEXT_STROKE_WIDTH) * previewFontScale)}px ${
                    clip.strokeColor ?? DEFAULT_TEXT_STROKE_COLOR
                  }`,
                  textShadow:
                    (clip.strokeWidth ?? DEFAULT_TEXT_STROKE_WIDTH) > 0
                      ? '0 1px 2px rgba(0, 0, 0, 0.45)'
                      : clip.source === 'caption'
                        ? '0 2px 4px rgba(0,0,0,0.86), 0 0 14px rgba(0,0,0,0.55)'
                        : '0 1px 2px rgba(0, 0, 0, 0.25)',
                }}
              >
                {clip.text}
              </div>
            </Rnd>
          ))}
        </div>
      </div>

      {/* Player Controls */}
      <div className="h-14 flex items-center px-4 justify-between text-muted-foreground border-t border-border/50 bg-muted/20 backdrop-blur-md">
        <div className="flex items-center gap-4 w-32 text-[11px] font-mono">
           <span className="text-blue-400">{formatDuration(timelineCurrentTime)}</span>
           <span className="text-gray-600">/</span>
           <span>{formatDuration(timelineDuration)}</span>
        </div>

        <div className="flex items-center space-x-6">
           <button className="hover:text-white disabled:opacity-30" disabled={!video} onClick={() => seekBy(-5)}><SkipBack size={18} /></button>
           <button className="hover:text-white disabled:opacity-30" disabled={!video} onClick={togglePlayback}>
             {isPlaying ? <Pause size={24} className="fill-current" /> : <Play size={24} className="fill-current" />}
           </button>
           <button className="hover:text-white disabled:opacity-30" disabled={!video} onClick={() => seekBy(5)}><SkipForward size={18} /></button>
        </div>

        <div className="flex justify-end gap-3 w-32">
           <button className="text-[11px] border border-gray-600 px-2 py-0.5 rounded hover:text-white hover:border-gray-400">Original</button>
           <button className="hover:text-white"><Maximize size={16} /></button>
        </div>
      </div>
    </div>
  );
};
