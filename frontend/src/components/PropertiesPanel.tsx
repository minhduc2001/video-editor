import { useEffect, useState } from 'react';
import { Bold, Italic, Loader2, RotateCcw } from 'lucide-react';
import { formatDuration, formatFileSize } from '@/lib/media';
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
  TEXT_FONT_OPTIONS,
} from '@/lib/text-style';
import type { DubbingClip, ImportedVideo, TextClip } from '@/types/media';

interface PropertiesPanelProps {
  video: ImportedVideo | null
  selectedTextClip: TextClip | null
  selectedTextClips: TextClip[]
  selectedDubbingClip: DubbingClip | null
  textClipCount: number
  dubbingStatus: 'idle' | 'generating' | 'ready' | 'error'
  dubbingError: string | null
  onUpdateTextClip: (clipId: string, patch: Partial<TextClip>) => void
  onUpdateSelectedTextClips: (patch: Partial<TextClip>) => void
  onUpdateDubbingClip: (clipId: string, patch: Partial<DubbingClip>) => void
  onGenerateDubbing: (scope: 'selected' | 'all', voice: string) => void
}

const getColorValue = (value: string | undefined, fallback: string) => value || fallback;

const TTS_VOICE_GROUPS = [
  {
    label: 'VieNeu Vietnamese (local or remote)',
    voices: [
      { value: 'vieneu:Bình An', label: 'Bình An - default natural voice' },
      { value: 'vieneu:Xuân Vĩnh', label: 'Xuân Vĩnh - preset voice' },
      { value: 'vieneu:Ngọc Linh', label: 'Ngọc Linh - preset voice' },
    ],
  },
  {
    label: 'OpenAI Natural Vietnamese (needs OpenAI key)',
    voices: [
      { value: 'openai:marin', label: 'Marin - warm natural narrator' },
      { value: 'openai:cedar', label: 'Cedar - calm grounded narrator' },
      { value: 'openai:coral', label: 'Coral - bright friendly female' },
      { value: 'openai:verse', label: 'Verse - youthful social style' },
      { value: 'openai:nova', label: 'Nova - clear modern female' },
      { value: 'openai:shimmer', label: 'Shimmer - soft polished female' },
    ],
  },
  {
    label: 'Microsoft Edge Vietnamese (free)',
    voices: [
      { value: 'vi-VN-HoaiMyNeural', label: 'HoaiMy - Vietnamese female' },
      { value: 'vi-VN-NamMinhNeural', label: 'NamMinh - Vietnamese male' },
    ],
  },
  {
    label: 'Other Edge test voices',
    voices: [
      { value: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao - Chinese female' },
      { value: 'zh-CN-YunxiNeural', label: 'Yunxi - Chinese male' },
      { value: 'en-US-JennyNeural', label: 'Jenny - English female' },
      { value: 'en-US-GuyNeural', label: 'Guy - English male' },
    ],
  },
];

export const PropertiesPanel = ({
  video,
  selectedTextClip,
  selectedTextClips,
  selectedDubbingClip,
  textClipCount,
  dubbingStatus,
  dubbingError,
  onUpdateTextClip,
  onUpdateSelectedTextClips,
  onUpdateDubbingClip,
  onGenerateDubbing,
}: PropertiesPanelProps) => {
  const [activeTab, setActiveTab] = useState('text');
  const [subTab, setSubTab] = useState('basic');
  const [selectedVoice, setSelectedVoice] = useState('vi-VN-HoaiMyNeural');
  const selectedTextTargets = selectedTextClips.length > 0
    ? selectedTextClips
    : selectedTextClip
      ? [selectedTextClip]
      : [];
  const primaryTextClip = selectedTextClip ?? selectedTextTargets[0] ?? null;
  const hasTextSelection = selectedTextTargets.length > 0;
  const isMultiTextSelection = selectedTextTargets.length > 1;
  const isDubbingBusy = dubbingStatus === 'generating';

  useEffect(() => {
    if (selectedDubbingClip) {
      setActiveTab('audio');
      return;
    }

    if (hasTextSelection) {
      setActiveTab('text');
    }
  }, [hasTextSelection, selectedDubbingClip]);

  const updateSelectedTextClips = (patch: Partial<TextClip>) => {
    if (!primaryTextClip) {
      return;
    }

    if (isMultiTextSelection) {
      onUpdateSelectedTextClips(patch);
      return;
    }

    onUpdateTextClip(primaryTextClip.id, patch);
  };

  return (
    <div className="w-full min-w-0 h-full glass-card flex flex-col z-10 shadow-[-4px_0_10px_rgba(0,0,0,0.2)] border-l border-border/50">
      {/* Top Tabs */}
      <div className="flex h-12 bg-muted/20 border-b border-border/40 items-center px-4 space-x-6 text-[13px] font-medium backdrop-blur-md">
        <button 
          onClick={() => setActiveTab('video')}
          className={`pb-2 ${activeTab === 'video' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
        >Video</button>
        <button 
          onClick={() => setActiveTab('audio')}
          className={`pb-2 ${activeTab === 'audio' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
        >Audio</button>
        <button 
          onClick={() => setActiveTab('speed')}
          className={`pb-2 ${activeTab === 'speed' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
        >Speed</button>
        <button 
           onClick={() => setActiveTab('text')}
           className={`pb-2 ${activeTab === 'text' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
        >Text</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 text-sm">
        
        {activeTab === 'video' && (
           <div className="space-y-6">
              <div className="rounded-xl border border-border/50 bg-background/40 p-4 space-y-2 shadow-sm backdrop-blur-sm">
                <div className="text-[11px] uppercase font-semibold text-gray-500">Selected Media</div>
                {video ? (
                  <div className="space-y-1 text-xs">
                    <div className="text-gray-200 truncate" title={video.name}>{video.name}</div>
                    <div className="text-gray-500">{formatDuration(video.duration)} · {formatFileSize(video.size)}</div>
                    <div className="text-gray-500 truncate">{video.type}</div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">Chưa chọn video</div>
                )}
              </div>
              <div className="flex text-[12px] font-medium border-b border-[#2d2d2d] pb-1">
                <button className="flex-1 text-blue-400">Basic</button>
                <button className="flex-1 text-gray-400 hover:text-gray-200">Cutout</button>
                <button className="flex-1 text-gray-400 hover:text-gray-200">Mask</button>
              </div>
              <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-xs">Scale</span>
                    <div className="flex gap-2 items-center">
                       <input type="range" className="w-24 accent-blue-500 h-1" defaultValue="100" />
                       <span className="text-[10px] text-gray-400 w-8">100%</span>
                    </div>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-xs">Opacity</span>
                    <div className="flex gap-2 items-center">
                       <input type="range" className="w-24 accent-blue-500 h-1" defaultValue="100" />
                       <span className="text-[10px] text-gray-400 w-8">100%</span>
                    </div>
                 </div>
              </div>
           </div>
        )}

        {activeTab === 'audio' && (
           <div className="space-y-6">
              {selectedDubbingClip ? (
                <div className="space-y-5">
                  <div className="rounded-xl border border-border/50 bg-background/40 p-4 space-y-1 shadow-sm backdrop-blur-sm">
                    <div className="text-[11px] uppercase font-semibold text-gray-500">Selected Audio Clip</div>
                    <div className="truncate text-xs text-gray-200" title={selectedDubbingClip.text}>
                      {selectedDubbingClip.text}
                    </div>
                    <div className="truncate text-[11px] text-gray-500">{selectedDubbingClip.voice}</div>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-xs">Volume</span>
                    <div className="flex gap-2 items-center">
                      <input
                        type="range"
                        className="w-28 accent-blue-500 h-1"
                        min="0"
                        max="2"
                        step="0.01"
                        value={selectedDubbingClip.volume ?? 1}
                        onChange={(event) =>
                          onUpdateDubbingClip(selectedDubbingClip.id, {
                            volume: Number(event.target.value),
                          })
                        }
                      />
                      <span className="text-[10px] text-gray-400 w-10 text-right">
                        {Math.round((selectedDubbingClip.volume ?? 1) * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-xs">Speed</span>
                    <div className="flex gap-2 items-center">
                      <input
                        type="range"
                        className="w-28 accent-blue-500 h-1"
                        min="0.5"
                        max="2"
                        step="0.05"
                        value={selectedDubbingClip.speed || 1}
                        onChange={(event) =>
                          onUpdateDubbingClip(selectedDubbingClip.id, {
                            speed: Number(event.target.value),
                          })
                        }
                      />
                      <span className="text-[10px] text-gray-400 w-10 text-right">
                        {(selectedDubbingClip.speed || 1).toFixed(2)}x
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-[#2d2d2d] pt-4">
                    <label className="text-[11px] text-gray-400">
                      Start
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={selectedDubbingClip.start.toFixed(1)}
                        onChange={(event) =>
                          onUpdateDubbingClip(selectedDubbingClip.id, {
                            start: Number(event.target.value),
                          })
                        }
                        className="mt-1 w-full bg-[#121212] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-gray-300"
                      />
                    </label>
                    <label className="text-[11px] text-gray-400">
                      End
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={selectedDubbingClip.end.toFixed(1)}
                        onChange={(event) =>
                          onUpdateDubbingClip(selectedDubbingClip.id, {
                            end: Number(event.target.value),
                          })
                        }
                        className="mt-1 w-full bg-[#121212] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-gray-300"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDubbingClip(selectedDubbingClip.id, {
                        volume: 1,
                        speed: 1,
                      })
                    }
                    className="w-full rounded border border-[#2d2d2d] bg-[#121212] px-3 py-1.5 text-xs text-gray-300 hover:bg-[#2d2d2d] hover:text-white"
                  >
                    Reset Audio
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-border/50 bg-background/40 p-3 text-[11px] text-muted-foreground shadow-sm">
                  Chọn một audio clip trong Voice/BGM track để chỉnh volume, speed hoặc kéo timing.
                </div>
              )}
           </div>
        )}

        {activeTab === 'speed' && (
           <div className="space-y-6">
              {selectedDubbingClip ? (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-xs">Audio Speed</span>
                    <div className="flex gap-2 items-center">
                      <input
                        type="range"
                        className="w-28 accent-blue-500 h-1"
                        min="0.5"
                        max="2"
                        step="0.05"
                        value={selectedDubbingClip.speed || 1}
                        onChange={(event) =>
                          onUpdateDubbingClip(selectedDubbingClip.id, {
                            speed: Number(event.target.value),
                          })
                        }
                      />
                      <span className="text-[10px] text-gray-400 w-10 text-right">
                        {(selectedDubbingClip.speed || 1).toFixed(2)}x
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-xs">Timeline Duration</span>
                    <span className="w-16 bg-[#121212] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-gray-300 text-center">
                      {formatDuration(selectedDubbingClip.end - selectedDubbingClip.start)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-border/50 bg-background/40 p-3 text-[11px] text-muted-foreground shadow-sm">
                  Chọn audio clip ở Voice/BGM track để chỉnh speed.
                </div>
              )}
           </div>
        )}

        {activeTab === 'text' && (
          <>
            {/* Basic / Bubble / Effects tabs */}
            <div className="flex text-[12px] font-medium border-b border-[#2d2d2d] pb-1">
              <button onClick={() => setSubTab('basic')} className={`flex-1 ${subTab === 'basic' ? 'text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>Basic</button>
              <button onClick={() => setSubTab('bubble')} className={`flex-1 ${subTab === 'bubble' ? 'text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>Bubble</button>
              <button onClick={() => setSubTab('effects')} className={`flex-1 ${subTab === 'effects' ? 'text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>Effects</button>
            </div>

            {subTab === 'basic' && (
              <>
                {/* Text Input */}
                <div className="space-y-2">
                  <textarea 
                    className="w-full bg-background/50 border border-input rounded-lg p-2.5 text-foreground resize-none outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-sm shadow-sm"
                    rows={3}
                    value={isMultiTextSelection ? '' : primaryTextClip?.text ?? ''}
                    disabled={!primaryTextClip || isMultiTextSelection}
                    placeholder={
                      isMultiTextSelection
                        ? `${selectedTextTargets.length} text clips selected`
                        : 'Chưa có text/caption'
                    }
                    onChange={(event) => {
                      if (primaryTextClip && !isMultiTextSelection) {
                        onUpdateTextClip(primaryTextClip.id, { text: event.target.value });
                      }
                    }}
                  ></textarea>
                  {primaryTextClip && !isMultiTextSelection ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-gray-400">
                        Start
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={primaryTextClip.start.toFixed(1)}
                          onChange={(event) =>
                            onUpdateTextClip(primaryTextClip.id, {
                              start: Number(event.target.value),
                            })
                          }
                          className="mt-1 w-full bg-[#121212] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-gray-300"
                        />
                      </label>
                      <label className="text-[11px] text-gray-400">
                        End
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={primaryTextClip.end.toFixed(1)}
                          onChange={(event) =>
                            onUpdateTextClip(primaryTextClip.id, {
                              end: Number(event.target.value),
                            })
                          }
                          className="mt-1 w-full bg-[#121212] border border-[#2d2d2d] rounded px-2 py-1 text-xs text-gray-300"
                        />
                      </label>
                    </div>
                  ) : isMultiTextSelection ? (
                    <div className="text-[11px] text-gray-500">
                      {selectedTextTargets.length} text clips selected. Style controls below apply to all selected clips.
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-500">Chọn một text clip trên timeline hoặc bấm Add Default Text.</div>
                  )}
                </div>

                {/* Font Selection */}
                <div className="flex items-center space-x-2">
                  <select
                    className="flex-1 bg-background/50 border border-input rounded-md p-1.5 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-xs"
                    value={primaryTextClip?.fontFamily ?? DEFAULT_TEXT_FONT}
                    disabled={!hasTextSelection}
                    onChange={(event) => {
                      if (hasTextSelection) {
                        updateSelectedTextClips({
                          fontFamily: event.target.value,
                        });
                      }
                    }}
                  >
                    {TEXT_FONT_OPTIONS.map((font) => (
                      <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex bg-[#121212] border border-[#2d2d2d] rounded overflow-hidden">
                    <button
                      type="button"
                      disabled={!hasTextSelection}
                      onClick={() => {
                        if (primaryTextClip) {
                          updateSelectedTextClips({
                            fontWeight: (primaryTextClip.fontWeight ?? DEFAULT_TEXT_WEIGHT) >= 700 ? 400 : 700,
                          });
                        }
                      }}
                      className={`p-1.5 border-r border-[#2d2d2d] text-gray-300 disabled:opacity-40 ${
                        primaryTextClip && (primaryTextClip.fontWeight ?? DEFAULT_TEXT_WEIGHT) >= 700
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-[#2d2d2d]'
                      }`}
                    >
                      <Bold size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={!hasTextSelection}
                      onClick={() => {
                        if (primaryTextClip) {
                          updateSelectedTextClips({
                            fontStyle:
                              (primaryTextClip.fontStyle ?? DEFAULT_TEXT_STYLE) === 'italic'
                                ? 'normal'
                                : 'italic',
                          });
                        }
                      }}
                      className={`p-1.5 text-gray-300 disabled:opacity-40 ${
                        primaryTextClip && (primaryTextClip.fontStyle ?? DEFAULT_TEXT_STYLE) === 'italic'
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-[#2d2d2d]'
                      }`}
                    >
                      <Italic size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-300 text-xs font-medium">Font Size</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="16"
                      max="72"
                      value={primaryTextClip?.fontSize ?? DEFAULT_TEXT_SIZE}
                      disabled={!hasTextSelection}
                      onChange={(event) => {
                        if (hasTextSelection) {
                          updateSelectedTextClips({
                            fontSize: Number(event.target.value),
                          });
                        }
                      }}
                      className="w-24 accent-blue-500 h-1 disabled:opacity-40"
                    />
                    <span className="text-gray-400 text-[10px] w-8">
                      {primaryTextClip?.fontSize ?? DEFAULT_TEXT_SIZE}px
                    </span>
                  </div>
                </div>

                {/* Color and properties */}
                <div className="space-y-4 pt-4 border-t border-[#2d2d2d]">
                  <div className="flex items-center justify-between">
                      <span className="text-gray-300 text-xs font-medium">Text Color</span>
                      <input
                        type="color"
                        disabled={!hasTextSelection}
                        value={getColorValue(primaryTextClip?.color, DEFAULT_TEXT_COLOR)}
                        onChange={(event) => {
                          if (hasTextSelection) {
                            updateSelectedTextClips({
                              color: event.target.value,
                            });
                          }
                        }}
                        className="h-7 w-16 cursor-pointer rounded border border-gray-600 bg-transparent p-0.5 disabled:opacity-40"
                      />
                  </div>
                  
                  <div className="flex items-center justify-between">
                      <span className="text-gray-300 text-xs font-medium">Stroke</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="0"
                          max="6"
                          step="0.5"
                          disabled={!hasTextSelection}
                          value={primaryTextClip?.strokeWidth ?? DEFAULT_TEXT_STROKE_WIDTH}
                          onChange={(event) => {
                            if (hasTextSelection) {
                              updateSelectedTextClips({
                                strokeWidth: Number(event.target.value),
                              });
                            }
                          }}
                          className="w-24 accent-blue-500 h-1 disabled:opacity-40"
                        />
                        <span className="text-gray-400 text-[10px] w-8">
                          {primaryTextClip?.strokeWidth ?? DEFAULT_TEXT_STROKE_WIDTH}px
                        </span>
                        <input
                          type="color"
                          disabled={!hasTextSelection}
                          value={getColorValue(primaryTextClip?.strokeColor, DEFAULT_TEXT_STROKE_COLOR)}
                          onChange={(event) => {
                            if (hasTextSelection) {
                              updateSelectedTextClips({
                                strokeColor: event.target.value,
                              });
                            }
                          }}
                          className="h-7 w-7 cursor-pointer rounded border border-gray-600 bg-transparent p-0.5 disabled:opacity-40"
                        />
                      </div>
                  </div>

                  <div className="flex items-center justify-between">
                      <span className="text-gray-300 text-xs font-medium">Background</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          disabled={!hasTextSelection}
                          value={primaryTextClip?.backgroundOpacity ?? DEFAULT_TEXT_BACKGROUND_OPACITY}
                          onChange={(event) => {
                            if (hasTextSelection) {
                              updateSelectedTextClips({
                                backgroundOpacity: Number(event.target.value),
                              });
                            }
                          }}
                          className="w-24 accent-blue-500 h-1 disabled:opacity-40"
                        />
                        <span className="text-gray-400 text-[10px] w-8">
                          {Math.round((primaryTextClip?.backgroundOpacity ?? DEFAULT_TEXT_BACKGROUND_OPACITY) * 100)}%
                        </span>
                        <input
                          type="color"
                          disabled={!hasTextSelection}
                          value={getColorValue(primaryTextClip?.backgroundColor, DEFAULT_TEXT_BACKGROUND_COLOR)}
                          onChange={(event) => {
                            if (hasTextSelection) {
                              updateSelectedTextClips({
                                backgroundColor: event.target.value,
                              });
                            }
                          }}
                          className="h-7 w-7 cursor-pointer rounded border border-gray-600 bg-transparent p-0.5 disabled:opacity-40"
                        />
                      </div>
                  </div>
                </div>

                {/* Voice Dubbing Section */}
                <div className="space-y-3 pt-4 border-t border-[#2d2d2d]">
                  <div className="flex items-center justify-between">
                    <span className="text-blue-400 font-medium text-xs">AI Dubbing (TTS)</span>
                    <button className="text-gray-400 hover:text-white"><RotateCcw size={12} /></button>
                  </div>
                  <select
                    value={selectedVoice}
                    disabled={isDubbingBusy}
                    onChange={(event) => setSelectedVoice(event.target.value)}
                    className="w-full bg-[#121212] border border-[#2d2d2d] rounded p-1.5 text-gray-300 outline-none focus:border-blue-500 text-xs disabled:opacity-50"
                  >
                    {TTS_VOICE_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.voices.map((voice) => (
                          <option key={voice.value} value={voice.value}>
                            {voice.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {selectedVoice.startsWith('openai:') && (
                    <div className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-blue-200">
                      Uses OpenAI TTS. Add an OpenAI API key in Settings before generating.
                    </div>
                  )}
                  {selectedVoice.startsWith('vieneu:') && (
                    <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-emerald-200">
                      Uses VieNeu TTS. Leave VieNeu API URL blank for local SDK, or set a remote server URL in Settings.
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      disabled={!hasTextSelection || isDubbingBusy}
                      onClick={() => onGenerateDubbing('selected', selectedVoice)}
                      className="flex-1 bg-[#2d2d2d] hover:bg-[#3d3d3d] text-gray-200 text-xs py-1.5 rounded transition-colors border border-[#3d3d3d] disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-1.5"
                    >
                      {isDubbingBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                      Selected
                    </button>
                    <button
                      type="button"
                      disabled={textClipCount === 0 || isDubbingBusy}
                      onClick={() => onGenerateDubbing('all', selectedVoice)}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-1.5"
                    >
                      {isDubbingBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                      All Text
                    </button>
                  </div>
                  {dubbingStatus === 'ready' && (
                    <div className="text-[11px] text-emerald-400">Voice clips added to Voice/BGM track.</div>
                  )}
                  {dubbingStatus === 'error' && (
                    <div className="text-[11px] text-red-400 leading-relaxed">{dubbingError ?? 'Generate voice failed.'}</div>
                  )}
                </div>
              </>
            )}

            {subTab === 'bubble' && (
              <div className="text-center text-gray-500 text-xs py-10">Select a text bubble style</div>
            )}

            {subTab === 'effects' && (
              <div className="text-center text-gray-500 text-xs py-10">Select a text effect</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
