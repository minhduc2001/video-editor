import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { Film, Music, Type, Sparkles, FolderDown, Download, SpellCheck, FileText, Link, Loader2, Wand2 } from 'lucide-react';
import { formatDuration, formatFileSize } from '@/lib/media';
import { TTS_VOICE_GROUPS } from '@/lib/tts-voices';
import type { AllInOneAutomationOptions, AllInOneAutomationResult, ImportedVideo } from '@/types/media';

interface SidebarProps {
  videos: ImportedVideo[]
  activeVideoId: string | null
  timelineVideoIds: Set<string>
  timelineVideo: ImportedVideo | null
  hasTimelineVideo: boolean
  captionStatus: "idle" | "uploading" | "transcribing" | "ready" | "error"
  captionError: string | null
  linkImportStatus: "idle" | "downloading" | "ready" | "error"
  linkImportError: string | null
  allInOneStatus: "idle" | "running" | "done" | "error"
  allInOneStep: string
  allInOneError: string | null
  allInOneResults: AllInOneAutomationResult[]
  onImportVideos: (files: FileList) => void
  onImportVideoLink: (url: string) => void
  onRunAllInOne: (options: AllInOneAutomationOptions) => void
  onSelectVideo: (videoId: string) => void
  onAddVideoToTimeline: (videoId: string) => void
  onAddText: () => void
  onAddBlurMask: () => void
  onImportSubtitles: (file: File) => void
  onIsolateVoice: () => void
  onAutoCaptions: (translateToVietnamese: boolean) => void
}

export const Sidebar = ({
  videos,
  activeVideoId,
  timelineVideoIds,
  timelineVideo,
  hasTimelineVideo,
  captionStatus,
  captionError,
  linkImportStatus,
  linkImportError,
  allInOneStatus,
  allInOneStep,
  allInOneError,
  allInOneResults,
  onImportVideos,
  onImportVideoLink,
  onRunAllInOne,
  onSelectVideo,
  onAddVideoToTimeline,
  onAddText,
  onAddBlurMask,
  onImportSubtitles,
  onIsolateVoice,
  onAutoCaptions,
}: SidebarProps) => {
  const [activeTab, setActiveTab] = useState('media');
  const [videoLink, setVideoLink] = useState('');
  const [allInOneLinks, setAllInOneLinks] = useState('');
  const [allInOneVoice, setAllInOneVoice] = useState('vi-VN-HoaiMyNeural');
  const [allInOneTranslate, setAllInOneTranslate] = useState(true);
  const [allInOneVoiceEnabled, setAllInOneVoiceEnabled] = useState(true);
  const [allInOneBurnSubtitles, setAllInOneBurnSubtitles] = useState(true);
  const [allInOneDuckAudio, setAllInOneDuckAudio] = useState(true);
  const [translateCaptionsToVietnamese, setTranslateCaptionsToVietnamese] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const isCaptionBusy = captionStatus === 'uploading' || captionStatus === 'transcribing';
  const isAllInOneRunning = allInOneStatus === 'running';

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      onImportVideos(event.target.files);
      event.target.value = '';
    }
  };

  const handleSubtitleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      onImportSubtitles(file);
      event.target.value = '';
    }
  };

  const handleVideoLinkSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (linkImportStatus === 'downloading') {
      return;
    }

    onImportVideoLink(videoLink);
  };

  const handleAllInOneSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isAllInOneRunning) {
      return;
    }

    onRunAllInOne({
      urls: allInOneLinks
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean),
      voice: allInOneVoice,
      translateToVietnamese: allInOneTranslate,
      includeVietnameseVoice: allInOneVoiceEnabled,
      burnSubtitles: allInOneBurnSubtitles,
      duckOriginalAudioAll: allInOneDuckAudio,
    });
  };

  return (
    <div className="w-full min-w-0 h-full bg-[#1e1e1e] border-r border-[#000] flex flex-col shadow-xl z-10">
      {/* Top Tabs */}
      <div className="flex h-14 bg-[#181818] border-b border-[#000] items-center px-2 space-x-1">
        <button 
          onClick={() => setActiveTab('media')}
          className={`flex flex-col items-center justify-center p-2 w-16 rounded transition-colors ${activeTab === 'media' ? 'text-blue-400 bg-[#2d2d2d]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#2d2d2d]'}`}
        >
          <Film size={20} />
          <span className="text-[10px] mt-1">Media</span>
        </button>
        <button 
          onClick={() => setActiveTab('audio')}
          className={`flex flex-col items-center justify-center p-2 w-16 rounded transition-colors ${activeTab === 'audio' ? 'text-blue-400 bg-[#2d2d2d]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#2d2d2d]'}`}
        >
          <Music size={20} />
          <span className="text-[10px] mt-1">Audio</span>
        </button>
        <button 
          onClick={() => setActiveTab('text')}
          className={`flex flex-col items-center justify-center p-2 w-16 rounded transition-colors ${activeTab === 'text' ? 'text-blue-400 bg-[#2d2d2d]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#2d2d2d]'}`}
        >
          <Type size={20} />
          <span className="text-[10px] mt-1">Text</span>
        </button>
        <button 
          onClick={() => setActiveTab('auto')}
          className={`flex flex-col items-center justify-center p-2 w-16 rounded transition-colors ${activeTab === 'auto' ? 'text-blue-400 bg-[#2d2d2d]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#2d2d2d]'}`}
        >
          <Wand2 size={20} />
          <span className="text-[10px] mt-1">Auto</span>
        </button>
        <button 
          onClick={() => setActiveTab('effects')}
          className={`flex flex-col items-center justify-center p-2 w-16 rounded transition-colors ${activeTab === 'effects' ? 'text-blue-400 bg-[#2d2d2d]' : 'text-gray-400 hover:text-gray-200 hover:bg-[#2d2d2d]'}`}
        >
          <Sparkles size={20} />
          <span className="text-[10px] mt-1">Effects</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'media' && (
          <>
            <div className="w-20 bg-[#1e1e1e] border-r border-[#2d2d2d] py-2 flex flex-col gap-1">
                <button className="text-[11px] text-blue-400 font-medium px-4 py-1.5 text-left bg-[#2d2d2d]/50">Local</button>
                <button className="text-[11px] text-gray-400 hover:text-gray-200 px-4 py-1.5 text-left">Library</button>
            </div>
            <div className="flex-1 p-3 flex flex-col gap-4 overflow-y-auto">
                <form className="space-y-2 rounded border border-[#2d2d2d] bg-[#121212] p-2" onSubmit={handleVideoLinkSubmit}>
                  <div className="flex items-center gap-1.5 text-[10px] uppercase text-gray-500">
                    <Link size={12} />
                    Link video
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={videoLink}
                      onChange={(event) => setVideoLink(event.target.value)}
                      placeholder="https://www.douyin.com/..."
                      className="min-w-0 flex-1 rounded border border-[#343434] bg-[#181818] px-2 py-1.5 text-[11px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={linkImportStatus === 'downloading'}
                      className="shrink-0 rounded bg-blue-600 px-2.5 py-1.5 text-[11px] text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {linkImportStatus === 'downloading' ? 'Loading' : 'Download'}
                    </button>
                  </div>
                  {linkImportStatus === 'ready' && (
                    <div className="text-[11px] text-emerald-400">Video imported from link.</div>
                  )}
                  {linkImportStatus === 'error' && (
                    <div className="whitespace-pre-line text-[11px] text-red-400 leading-relaxed">{linkImportError ?? 'Download failed'}</div>
                  )}
                </form>
                <div className="flex space-x-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-[#2d2d2d] hover:bg-[#3d3d3d] text-gray-200 text-[11px] px-3 py-1.5 rounded flex items-center gap-1.5 border border-[#3d3d3d] shadow-sm"
                >
                  <FolderDown size={14} /> Import
                </button>
                </div>
                
                {videos.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    {videos.map((video) => (
                      <button
                        key={video.id}
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('application/x-video-id', video.id);
                          event.dataTransfer.setData('text/plain', video.id);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => onSelectVideo(video.id)}
                        onDoubleClick={() => onAddVideoToTimeline(video.id)}
                        className={`bg-[#121212] rounded-md overflow-hidden relative cursor-pointer border-2 text-left hover:border-blue-500 transition-all shadow-md ${
                          activeVideoId === video.id ? 'border-blue-500' : 'border-transparent'
                        }`}
                      >
                        <div className="h-20 bg-black flex items-center justify-center overflow-hidden">
                          <video
                            src={video.url}
                            muted
                            preload="metadata"
                            className="w-full h-full object-cover opacity-90"
                          />
                        </div>
                        <div className="p-1.5">
                          <div className="text-[10px] text-gray-300 truncate">{video.name}</div>
                          <div className="text-[9px] text-gray-500 truncate">{formatFileSize(video.size)}</div>
                        </div>
                        <span className="absolute top-1.5 right-1.5 text-[9px] text-white bg-black/60 px-1 rounded shadow">
                          {formatDuration(video.duration)}
                        </span>
                        {timelineVideoIds.has(video.id) && (
                          <span className="absolute bottom-1.5 right-1.5 text-[9px] text-blue-100 bg-blue-600/80 px-1 rounded shadow">
                            Timeline
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="h-36 rounded-md border border-dashed border-[#3d3d3d] bg-[#121212] flex flex-col items-center justify-center text-center px-4">
                    <Film size={22} className="text-gray-500 mb-2" />
                    <div className="text-xs text-gray-300">Chưa có video</div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-3 text-[11px] text-blue-300 hover:text-blue-200"
                    >
                      Chọn video để bắt đầu
                    </button>
                  </div>
                )}
            </div>
          </>
        )}

        {activeTab === 'audio' && (
           <div className="flex-1 p-4 flex flex-col gap-4 bg-[#121212]/30">
              <div className="text-xs text-gray-400 uppercase font-semibold">AI Audio</div>
              <button
                type="button"
                disabled={!hasTimelineVideo || timelineVideo?.voiceIsolationStatus === 'processing'}
                onClick={onIsolateVoice}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs py-2 rounded flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Music size={14} />
                {timelineVideo?.voiceIsolationStatus === 'processing'
                  ? 'Đang tách voice Trung...'
                  : 'Tách voice Trung / BGM'}
              </button>
              {timelineVideo?.voiceIsolationStatus === 'ready' && (
                <div className="text-[11px] text-emerald-400 leading-relaxed">
                  Đã tách xong vocals và background music.
                </div>
              )}
              {timelineVideo?.voiceIsolationStatus === 'error' && (
                <div className="text-[11px] text-red-400 leading-relaxed">
                  {timelineVideo.voiceIsolationError ?? 'Tách voice thất bại'}
                </div>
              )}
              {!hasTimelineVideo && (
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  Kéo video từ Media xuống Main Track trước khi tách voice.
                </div>
              )}

              <div className="text-xs text-gray-400 uppercase font-semibold mt-4">Sound Effects</div>
              <div className="space-y-2">
                 <div className="bg-[#1e1e1e] p-2 rounded border border-[#2d2d2d] flex justify-between items-center cursor-pointer hover:border-blue-500">
                    <div>
                       <div className="text-xs text-gray-200">Woosh Transition</div>
                       <div className="text-[10px] text-gray-500">00:02</div>
                    </div>
                    <Download size={14} className="text-gray-400" />
                 </div>
                 <div className="bg-[#1e1e1e] p-2 rounded border border-[#2d2d2d] flex justify-between items-center cursor-pointer hover:border-blue-500">
                    <div>
                       <div className="text-xs text-gray-200">Pop Sound</div>
                       <div className="text-[10px] text-gray-500">00:01</div>
                    </div>
                    <Download size={14} className="text-gray-400" />
                 </div>
              </div>
           </div>
        )}

        {activeTab === 'text' && (
           <div className="flex-1 p-4 flex flex-col gap-4 bg-[#121212]/30">
              <input
                ref={subtitleInputRef}
                type="file"
                accept=".srt,.str,text/plain,application/x-subrip"
                className="hidden"
                onChange={handleSubtitleFileChange}
              />
              <button
                type="button"
                disabled={!hasTimelineVideo}
                onClick={onAddText}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs py-2 rounded flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                 <Type size={14} /> Add Default Text
              </button>
              <button
                type="button"
                disabled={!hasTimelineVideo}
                onClick={() => subtitleInputRef.current?.click()}
                className="bg-[#2d2d2d] hover:bg-[#3d3d3d] text-white text-xs py-2 rounded flex items-center justify-center gap-2 border border-[#3d3d3d] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                 <FileText size={14} /> Import SRT
              </button>
              <button
                type="button"
                disabled={!hasTimelineVideo || isCaptionBusy}
                aria-busy={isCaptionBusy}
                onClick={() => {
                  if (!isCaptionBusy) {
                    onAutoCaptions(translateCaptionsToVietnamese);
                  }
                }}
                className="bg-[#2d2d2d] hover:bg-[#3d3d3d] text-white text-xs py-2 rounded flex items-center justify-center gap-2 border border-[#3d3d3d] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                 {isCaptionBusy ? <Loader2 size={14} className="animate-spin" /> : <SpellCheck size={14} />}
                 {captionStatus === 'uploading'
                   ? 'Uploading video...'
                   : captionStatus === 'transcribing'
                     ? 'Generating captions...'
                     : 'Auto Captions (AI)'}
              </button>
              <label className="flex items-center justify-between rounded border border-[#2d2d2d] bg-[#121212] px-3 py-2 text-[11px] text-gray-300">
                <span>Translate to Vietnamese</span>
                <input
                  type="checkbox"
                  checked={translateCaptionsToVietnamese}
                  disabled={isCaptionBusy}
                  onChange={(event) => setTranslateCaptionsToVietnamese(event.target.checked)}
                  className="h-4 w-4 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
              {captionStatus === 'ready' && (
                <div className="text-[11px] text-emerald-400">Captions generated and added to timeline.</div>
              )}
              {captionStatus === 'error' && (
                <div className="text-[11px] text-red-400 leading-relaxed">{captionError ?? 'Auto captions failed'}</div>
              )}
              {!hasTimelineVideo && (
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  Kéo video từ Media xuống timeline để thêm text hoặc tạo sub.
                </div>
              )}

              <div className="text-xs text-gray-400 uppercase font-semibold mt-4">Templates</div>
              <div className="grid grid-cols-2 gap-2">
                 <div className="h-16 bg-[#1e1e1e] border border-[#2d2d2d] rounded flex items-center justify-center cursor-pointer hover:border-blue-500 text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                    Neon
                 </div>
                 <div className="h-16 bg-[#1e1e1e] border border-[#2d2d2d] rounded flex items-center justify-center cursor-pointer hover:border-blue-500 text-sm font-serif italic text-white drop-shadow-md">
                    Classic
                 </div>
              </div>
           </div>
        )}

        {activeTab === 'auto' && (
          <form className="flex-1 overflow-y-auto bg-[#121212]/30 p-4" onSubmit={handleAllInOneSubmit}>
            <div className="space-y-4">
              <div className="text-xs text-gray-400 uppercase font-semibold">All in one</div>
              <label className="block space-y-1.5">
                <span className="text-[11px] text-gray-400">Video links</span>
                <textarea
                  value={allInOneLinks}
                  onChange={(event) => setAllInOneLinks(event.target.value)}
                  disabled={isAllInOneRunning}
                  placeholder={'Mỗi link một dòng\nhttps://www.douyin.com/...\nhttps://www.douyin.com/...'}
                  rows={5}
                  className="w-full resize-none rounded border border-[#343434] bg-[#181818] px-2 py-2 text-[11px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-blue-500 disabled:opacity-50"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-[11px] text-gray-400">Vietnamese voice</span>
                <select
                  value={allInOneVoice}
                  disabled={isAllInOneRunning || !allInOneVoiceEnabled}
                  onChange={(event) => setAllInOneVoice(event.target.value)}
                  className="w-full rounded border border-[#343434] bg-[#181818] px-2 py-2 text-[11px] text-gray-200 outline-none focus:border-blue-500 disabled:opacity-50"
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
              </label>

              <div className="space-y-2 rounded border border-[#2d2d2d] bg-[#121212] p-3">
                <label className="flex items-center justify-between text-[11px] text-gray-300">
                  <span>Translate to Vietnamese</span>
                  <input
                    type="checkbox"
                    checked={allInOneTranslate}
                    disabled={isAllInOneRunning}
                    onChange={(event) => setAllInOneTranslate(event.target.checked)}
                    className="h-4 w-4 accent-blue-600 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center justify-between text-[11px] text-gray-300">
                  <span>Generate Vietnamese voice</span>
                  <input
                    type="checkbox"
                    checked={allInOneVoiceEnabled}
                    disabled={isAllInOneRunning}
                    onChange={(event) => setAllInOneVoiceEnabled(event.target.checked)}
                    className="h-4 w-4 accent-blue-600 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center justify-between text-[11px] text-gray-300">
                  <span>Burn subtitles</span>
                  <input
                    type="checkbox"
                    checked={allInOneBurnSubtitles}
                    disabled={isAllInOneRunning}
                    onChange={(event) => setAllInOneBurnSubtitles(event.target.checked)}
                    className="h-4 w-4 accent-blue-600 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center justify-between text-[11px] text-gray-300">
                  <span>Reduce original audio</span>
                  <input
                    type="checkbox"
                    checked={allInOneDuckAudio}
                    disabled={isAllInOneRunning || !allInOneVoiceEnabled}
                    onChange={(event) => setAllInOneDuckAudio(event.target.checked)}
                    className="h-4 w-4 accent-blue-600 disabled:opacity-50"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={isAllInOneRunning}
                className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAllInOneRunning ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                {isAllInOneRunning ? 'Running...' : 'Run All in one'}
              </button>

              {allInOneStep && (
                <div className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-200">
                  {allInOneStep}
                </div>
              )}
              {allInOneStatus === 'error' && (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-300">
                  {allInOneError ?? 'Automation failed.'}
                </div>
              )}
              {allInOneResults.length > 0 && (
                <div className="space-y-2 rounded border border-emerald-500/25 bg-emerald-500/5 p-2">
                  <div className="text-[10px] uppercase text-emerald-300/80">
                    Exported {allInOneResults.length} video{allInOneResults.length > 1 ? 's' : ''}
                  </div>
                  {allInOneResults.map((result, index) => (
                    <a
                      key={`${result.downloadUrl}-${index}`}
                      href={result.downloadUrl}
                      download={result.fileName}
                      className="flex min-w-0 items-center gap-2 rounded border border-emerald-500/35 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-100 hover:bg-emerald-500/15"
                      title={result.sourceUrl}
                    >
                      <Download size={13} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{result.fileName}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </form>
        )}

        {activeTab === 'effects' && (
           <div className="flex-1 p-4 flex flex-col gap-4 bg-[#121212]/30">
              <div className="text-xs text-gray-400 uppercase font-semibold">Video Effects</div>
              <div className="grid grid-cols-2 gap-2">
                 <button
                   type="button"
                   disabled={!hasTimelineVideo}
                   onClick={onAddBlurMask}
                   className="h-24 bg-[#1e1e1e] border border-[#2d2d2d] rounded flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 gap-2 disabled:cursor-not-allowed disabled:opacity-40"
                 >
                    <div className="w-12 h-8 bg-gradient-to-r from-gray-400 to-gray-600 rounded blur-[2px]"></div>
                    <span className="text-[10px] text-gray-300">Blur Subtitle Area</span>
                 </button>
                 <div className="h-24 bg-[#1e1e1e] border border-[#2d2d2d] rounded flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 gap-2">
                    <div className="w-12 h-8 bg-gray-500 rounded skew-x-12"></div>
                    <span className="text-[10px] text-gray-300">Glitch</span>
                 </div>
              </div>
           </div>
        )}
      </div>
    </div>
  );
};
