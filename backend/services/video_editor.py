import os
import subprocess
import shutil
from pathlib import Path
from typing import Dict, Any, List

class VideoEditorService:
    """Service for mixing audio, rendering subtitles, and exporting final video using FFmpeg"""

    @staticmethod
    def _run_ffmpeg(cmd: List[str], cwd: Path | None = None):
        print(f"Running FFmpeg: {' '.join(cmd)}")
        subprocess.run(cmd, check=True, cwd=str(cwd) if cwd else None)

    @staticmethod
    def _has_audio_stream(video_path: Path) -> bool:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=index",
                "-of",
                "csv=p=0",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        return bool(result.stdout.strip())

    @staticmethod
    def _even_dimension(value: int, fallback: int) -> int:
        safe_value = int(value or fallback)
        safe_value = max(2, safe_value)
        return safe_value if safe_value % 2 == 0 else safe_value + 1

    @staticmethod
    def _probe_video_size(video_path: Path) -> tuple[int, int]:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=s=x:p=0",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        width_text, _, height_text = result.stdout.strip().partition("x")

        try:
            width = int(width_text)
            height = int(height_text)
        except ValueError:
            return 1280, 720

        return (
            VideoEditorService._even_dimension(width, 1280),
            VideoEditorService._even_dimension(height, 720),
        )

    @staticmethod
    def _apply_blur_masks(
        input_path: Path,
        output_path: Path,
        blur_masks: List[Dict[str, Any]],
        width: int,
        height: int,
    ):
        filter_parts: List[str] = []
        last_video_label = "0:v"
        valid_mask_count = 0

        for mask in blur_masks:
            start = max(0.0, float(mask.get("start", 0)))
            end = max(start, float(mask.get("end", start)))

            if end <= start:
                continue

            mask_width = VideoEditorService._even_dimension(
                round(width * max(1.0, min(100.0, float(mask.get("width", 82)))) / 100),
                2,
            )
            mask_height = VideoEditorService._even_dimension(
                round(height * max(1.0, min(100.0, float(mask.get("height", 13)))) / 100),
                2,
            )
            mask_width = max(2, min(width, mask_width))
            mask_height = max(2, min(height, mask_height))
            center_x = width * max(0.0, min(100.0, float(mask.get("x", 50)))) / 100
            center_y = height * max(0.0, min(100.0, float(mask.get("y", 82)))) / 100
            left = int(max(0, min(width - mask_width, round(center_x - mask_width / 2))))
            top = int(max(0, min(height - mask_height, round(center_y - mask_height / 2))))
            max_radius = max(1, min(mask_width, mask_height) // 3)
            radius = max(1, min(int(float(mask.get("intensity", 16))), max_radius))
            mode = str(mask.get("mode", "blur") or "blur").lower()
            color = str(mask.get("color", "#ffd84d") or "#ffd84d").replace("#", "").strip()
            color = (color + "ffd84d")[:6]
            opacity = max(0.0, min(1.0, float(mask.get("opacity", 0.86))))
            base_label = f"blurbase{valid_mask_count}"
            source_label = f"blursrc{valid_mask_count}"
            crop_label = f"blurcrop{valid_mask_count}"
            output_label = f"blurout{valid_mask_count}"

            if mode == "solid":
                filter_parts.append(f"[{last_video_label}]null[{base_label}]")
                filter_parts.append(
                    f"color=c=0x{color}@{opacity:.3f}:s={mask_width}x{mask_height}:d={max(end, 0.1):.3f},"
                    f"format=rgba[{crop_label}]"
                )
            else:
                filter_parts.append(f"[{last_video_label}]split=2[{base_label}][{source_label}]")
                filter_parts.append(
                    f"[{source_label}]crop={mask_width}:{mask_height}:{left}:{top},"
                    f"boxblur=luma_radius={radius}:luma_power=1[{crop_label}]"
                )
            filter_parts.append(
                f"[{base_label}][{crop_label}]overlay={left}:{top}:"
                f"enable='between(t,{start:.3f},{end:.3f})'[{output_label}]"
            )
            last_video_label = output_label
            valid_mask_count += 1

        if valid_mask_count == 0:
            shutil.copyfile(input_path, output_path)
            return

        VideoEditorService._run_ffmpeg([
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(input_path),
            "-filter_complex",
            ";".join(filter_parts),
            "-map",
            f"[{last_video_label}]",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-c:a",
            "copy",
            str(output_path),
        ])

    @staticmethod
    def _merge_intervals(intervals: List[tuple[float, float]]) -> List[tuple[float, float]]:
        if not intervals:
            return []

        sorted_intervals = sorted(intervals, key=lambda interval: interval[0])
        merged: List[tuple[float, float]] = [sorted_intervals[0]]

        for start, end in sorted_intervals[1:]:
            previous_start, previous_end = merged[-1]

            if start <= previous_end + 0.05:
                merged[-1] = (previous_start, max(previous_end, end))
                continue

            merged.append((start, end))

        return merged

    @staticmethod
    def _atempo_filter_chain(speed: float) -> str:
        safe_speed = max(0.25, min(4.0, float(speed or 1.0)))
        filters: List[str] = []

        while safe_speed > 2.0:
            filters.append("atempo=2.0")
            safe_speed /= 2.0

        while safe_speed < 0.5:
            filters.append("atempo=0.5")
            safe_speed /= 0.5

        filters.append(f"atempo={safe_speed:.6f}")

        return ",".join(filters)

    @staticmethod
    def _mix_timeline_dubbing(
        input_path: Path,
        output_path: Path,
        dubbing_clips: List[Dict[str, Any]],
        duck_original_audio_all: bool = False,
        ducking_volume: float = 0.18,
    ):
        valid_clips: List[Dict[str, Any]] = []

        for clip in dubbing_clips:
            audio_path_text = str(clip.get("audio_path") or "").strip()
            if not audio_path_text:
                continue

            audio_path = Path(audio_path_text)
            start = max(0.0, float(clip.get("start", 0)))
            end = max(start, float(clip.get("end", start)))

            if not audio_path.exists() or end <= start:
                continue

            valid_clips.append({
                "audio_path": audio_path,
                "start": start,
                "end": end,
                "volume": max(0.0, min(2.0, float(clip.get("volume", 1)))),
                "speed": max(0.25, min(4.0, float(clip.get("speed", 1)))),
            })

        if not valid_clips and not duck_original_audio_all:
            shutil.copyfile(input_path, output_path)
            return

        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(input_path),
        ]

        for clip in valid_clips:
            cmd.extend(["-i", str(clip["audio_path"])])

        filter_parts: List[str] = []
        base_audio_label = "0:a"
        if duck_original_audio_all:
            filter_parts.append(
                f"[{base_audio_label}]volume={ducking_volume:.3f}[duckedall]"
            )
            base_audio_label = "duckedall"
        else:
            duck_intervals = VideoEditorService._merge_intervals(
                [(clip["start"], clip["end"]) for clip in valid_clips]
            )

            for index, (start, end) in enumerate(duck_intervals):
                ducked_label = f"ducked{index}"
                filter_parts.append(
                    f"[{base_audio_label}]volume={ducking_volume:.3f}:"
                    f"enable='between(t,{start:.3f},{end:.3f})'[{ducked_label}]"
                )
                base_audio_label = ducked_label

        dub_labels: List[str] = []
        for index, clip in enumerate(valid_clips):
            delay_ms = max(0, int(clip["start"] * 1000))
            duration = max(0.05, clip["end"] - clip["start"])
            dub_label = f"dub{index}"
            speed_filter = VideoEditorService._atempo_filter_chain(clip["speed"])
            filter_parts.append(
                f"[{index + 1}:a]{speed_filter},"
                f"atrim=0:{duration:.3f},asetpts=PTS-STARTPTS,"
                f"adelay={delay_ms}:all=1,"
                f"volume={clip['volume']:.3f}[{dub_label}]"
            )
            dub_labels.append(dub_label)

        if dub_labels:
            audio_inputs = f"[{base_audio_label}]" + "".join(f"[{label}]" for label in dub_labels)
            filter_parts.append(
                f"{audio_inputs}amix=inputs={len(dub_labels) + 1}:"
                "duration=first:dropout_transition=0:normalize=0[finalaudio]"
            )
            final_audio_label = "finalaudio"
        else:
            final_audio_label = base_audio_label

        cmd.extend([
            "-filter_complex",
            ";".join(filter_parts),
            "-map",
            "0:v:0",
            "-map",
            f"[{final_audio_label}]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-b:a",
            "192k",
            str(output_path),
        ])
        VideoEditorService._run_ffmpeg(cmd)

    @staticmethod
    def _ass_color(hex_color: str) -> str:
        normalized = (hex_color or "#ffffff").replace("#", "").strip()
        normalized = (normalized + "ffffff")[:6]
        red = normalized[0:2]
        green = normalized[2:4]
        blue = normalized[4:6]
        return f"&H00{blue}{green}{red}&"

    @staticmethod
    def _ass_time(seconds: float) -> str:
        safe_seconds = max(0.0, float(seconds or 0))
        hours = int(safe_seconds // 3600)
        minutes = int((safe_seconds % 3600) // 60)
        secs = int(safe_seconds % 60)
        centiseconds = int((safe_seconds - int(safe_seconds)) * 100)
        return f"{hours}:{minutes:02d}:{secs:02d}.{centiseconds:02d}"

    @staticmethod
    def _ass_text(text: str) -> str:
        return (
            (text or "")
            .replace("\\", "\\\\")
            .replace("{", "(")
            .replace("}", ")")
            .replace("\r\n", "\n")
            .replace("\n", "\\N")
        )

    @staticmethod
    def _font_name(font_family: str) -> str:
        first_family = (font_family or "Arial").split(",")[0].strip()
        return first_family.strip("'\"") or "Arial"

    @staticmethod
    def _create_timeline_ass_subtitle(
        text_clips: List[Dict[str, Any]],
        ass_path: Path,
        width: int = 1280,
        height: int = 720,
    ):
        ass_content = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,42,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,0,1,5,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

        for clip in text_clips:
            start = float(clip.get("start", 0))
            end = float(clip.get("end", start))
            if end <= start:
                continue

            x = int((float(clip.get("x", 50)) / 100) * width)
            y = int((float(clip.get("y", 78)) / 100) * height)
            font_size = max(8, int(float(clip.get("font_size", 30))))
            font_name = VideoEditorService._font_name(str(clip.get("font_family", "Arial")))
            text_color = VideoEditorService._ass_color(str(clip.get("color", "#ffffff")))
            stroke_color = VideoEditorService._ass_color(str(clip.get("stroke_color", "#000000")))
            stroke_width = max(0, float(clip.get("stroke_width", 0)))
            bold = 1 if int(clip.get("font_weight", 700)) >= 700 else 0
            italic = 1 if clip.get("font_style") == "italic" else 0
            text = VideoEditorService._ass_text(str(clip.get("text", "")))
            override = (
                f"{{\\pos({x},{y})\\an5\\fn{font_name}\\fs{font_size}"
                f"\\c{text_color}\\3c{stroke_color}\\bord{stroke_width}"
                f"\\b{bold}\\i{italic}}}"
            )

            ass_content += (
                f"Dialogue: 0,{VideoEditorService._ass_time(start)},"
                f"{VideoEditorService._ass_time(end)},Default,,0,0,0,,{override}{text}\n"
            )

        ass_path.write_text(ass_content, encoding="utf-8")

    @staticmethod
    def render_timeline_export(
        clips: List[Dict[str, Any]],
        text_clips: List[Dict[str, Any]],
        blur_masks: List[Dict[str, Any]],
        dubbing_clips: List[Dict[str, Any]],
        output_path: Path,
        include_audio: bool = True,
        burn_subtitles: bool = True,
        duck_original_audio_all: bool = False,
        output_width: int = 0,
        output_height: int = 0,
    ) -> bool:
        """Render timeline clips into a single MP4, optionally burning text overlays."""
        if not clips:
            raise ValueError("No timeline clips to export")

        work_dir = output_path.parent / f"{output_path.stem}_work"
        if work_dir.exists():
            shutil.rmtree(work_dir)
        work_dir.mkdir(parents=True, exist_ok=True)

        first_video_path = Path(str(clips[0].get("video_path", "")))
        probed_width, probed_height = VideoEditorService._probe_video_size(first_video_path)
        target_width = VideoEditorService._even_dimension(output_width, probed_width)
        target_height = VideoEditorService._even_dimension(output_height, probed_height)
        segment_paths: List[Path] = []
        normalize_filter = (
            f"scale={target_width}:{target_height}:force_original_aspect_ratio=decrease,"
            f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2,"
            "setsar=1,fps=30,format=yuv420p"
        )

        try:
            for index, clip in enumerate(clips):
                video_path = Path(str(clip.get("video_path", "")))
                if not video_path.exists():
                    raise FileNotFoundError(f"Video not found: {video_path}")

                source_start = max(0.0, float(clip.get("source_start", 0)))
                source_end = max(source_start + 0.1, float(clip.get("source_end", source_start + 0.1)))
                duration = source_end - source_start
                segment_path = work_dir / f"segment_{index:04d}.mp4"
                cmd = [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    f"{source_start:.3f}",
                    "-t",
                    f"{duration:.3f}",
                    "-i",
                    str(video_path),
                ]

                if include_audio:
                    bgm_path_text = str(clip.get("bgm_path") or "").strip()
                    bgm_path = Path(bgm_path_text) if bgm_path_text else None
                    if bgm_path and bgm_path.exists():
                        cmd.extend([
                            "-ss",
                            f"{source_start:.3f}",
                            "-t",
                            f"{duration:.3f}",
                            "-i",
                            str(bgm_path),
                            "-map",
                            "0:v:0",
                            "-map",
                            "1:a:0",
                            "-shortest",
                        ])
                    elif VideoEditorService._has_audio_stream(video_path):
                        cmd.extend(["-map", "0:v:0", "-map", "0:a:0"])
                    else:
                        cmd.extend([
                            "-f",
                            "lavfi",
                            "-t",
                            f"{duration:.3f}",
                            "-i",
                            "anullsrc=channel_layout=stereo:sample_rate=48000",
                            "-map",
                            "0:v:0",
                            "-map",
                            "1:a:0",
                            "-shortest",
                        ])
                else:
                    cmd.extend(["-map", "0:v:0"])

                cmd.extend([
                    "-vf",
                    normalize_filter,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "20",
                ])

                if include_audio:
                    cmd.extend(["-c:a", "aac", "-ar", "48000", "-b:a", "160k"])
                else:
                    cmd.append("-an")

                cmd.append(str(segment_path))
                VideoEditorService._run_ffmpeg(cmd)
                segment_paths.append(segment_path)

            concat_list_path = work_dir / "concat.txt"
            concat_list_path.write_text(
                "\n".join(f"file '{path.as_posix()}'" for path in segment_paths),
                encoding="utf-8",
            )
            joined_path = work_dir / "joined.mp4"
            VideoEditorService._run_ffmpeg([
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_list_path),
                "-c",
                "copy",
                str(joined_path),
            ])

            render_input_path = joined_path
            if blur_masks:
                blurred_path = work_dir / "blurred.mp4"
                VideoEditorService._apply_blur_masks(
                    joined_path,
                    blurred_path,
                    blur_masks,
                    target_width,
                    target_height,
                )
                render_input_path = blurred_path

            final_video_path = render_input_path
            if burn_subtitles and text_clips:
                ass_path = work_dir / "subtitles.ass"
                subtitled_path = work_dir / "subtitled.mp4"
                VideoEditorService._create_timeline_ass_subtitle(
                    text_clips,
                    ass_path,
                    width=target_width,
                    height=target_height,
                )
                cmd = [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(render_input_path),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a?",
                    "-vf",
                    "ass=subtitles.ass",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "20",
                    "-c:a",
                    "copy",
                    str(subtitled_path),
                ]
                VideoEditorService._run_ffmpeg(cmd, cwd=work_dir)
                final_video_path = subtitled_path

            if include_audio and (dubbing_clips or duck_original_audio_all):
                VideoEditorService._mix_timeline_dubbing(
                    final_video_path,
                    output_path,
                    dubbing_clips,
                    duck_original_audio_all=duck_original_audio_all,
                )
            else:
                shutil.copyfile(final_video_path, output_path)

            return True
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
    
    @staticmethod
    def _create_ass_subtitle(segments: List[Dict[str, Any]], ass_path: Path):
        """Generates an Advanced SubStation Alpha (.ass) file for styled subtitles"""
        ass_content = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,60,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,10,10,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        def format_time(seconds: float) -> str:
            """Convert seconds to ASS time format: H:MM:SS.cs"""
            h = int(seconds / 3600)
            m = int((seconds % 3600) / 60)
            s = int(seconds % 60)
            cs = int((seconds % 1) * 100)
            return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

        for seg in segments:
            start = format_time(seg["start"])
            end = format_time(seg["end"])
            text = seg.get("translated_text", seg["text"])
            # Replace newlines with ASS newline \N
            text = text.replace('\n', '\\N')
            ass_content += f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n"

        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(ass_content)

    @staticmethod
    def render_final_video(
        video_path: Path, 
        bgm_path: Path, 
        segments: List[Dict[str, Any]], 
        output_path: Path,
        bgm_volume: float = 0.2
    ) -> bool:
        """
        Mixes BGM (ducked), dubbed audio segments, and burns subtitles into the video.
        """
        temp_dir = output_path.parent
        
        # 1. Create ASS Subtitle file
        ass_path = temp_dir / "subtitles.ass"
        VideoEditorService._create_ass_subtitle(segments, ass_path)
        
        # 2. Combine all dub audio segments into a single audio track with correct offsets
        # We use FFmpeg's adelay filter for each segment, then amix them all together.
        dub_tracks = []
        filter_complex = []
        
        for i, seg in enumerate(segments):
            if "dub_audio_path" in seg and Path(seg["dub_audio_path"]).exists():
                dub_tracks.append(seg["dub_audio_path"])
                # adelay expects milliseconds
                delay_ms = int(seg["start"] * 1000)
                filter_complex.append(f"[{i+2}:a]adelay={delay_ms}|{delay_ms}[dub{i}];")
        
        # If no dubs generated, just use original or BGM
        if not dub_tracks:
            print("No dub tracks found. Rendering video with subtitles only.")
            cmd = [
                "ffmpeg", "-y", "-i", str(video_path),
                "-vf", f"ass='{ass_path}'",
                str(output_path)
            ]
            subprocess.run(cmd, check=True)
            return True

        # Build massive FFmpeg command
        cmd = ["ffmpeg", "-y", "-i", str(video_path), "-i", str(bgm_path)]
        
        for track in dub_tracks:
            cmd.extend(["-i", str(track)])
            
        # Mix BGM (volume reduced) and all dubs
        # [1:a] is BGM
        filter_complex.append(f"[1:a]volume={bgm_volume}[bgm];")
        
        # Amix all dubs together first
        dub_mix_inputs = "".join([f"[dub{i}]" for i in range(len(dub_tracks))])
        filter_complex.append(f"{dub_mix_inputs}amix=inputs={len(dub_tracks)}:normalize=0[alldubs];")
        
        # Finally mix BGM and all dubs
        filter_complex.append(f"[bgm][alldubs]amix=inputs=2:normalize=0[final_audio]")
        
        cmd.extend(["-filter_complex", "".join(filter_complex)])
        
        # Add video filter for subtitles (Windows path requires special escaping for ASS filter, we use relative if possible, but let's try standard)
        ass_path_escaped = str(ass_path).replace("\\", "/") # FFmpeg ass filter prefers forward slashes
        cmd.extend([
            "-map", "0:v",
            "-map", "[final_audio]",
            "-vf", f"ass='{ass_path_escaped}'",
            "-c:v", "libx264",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "192k",
            str(output_path)
        ])
        
        print(f"Rendering final video: {' '.join(cmd)}")
        try:
            subprocess.run(cmd, check=True)
            return True
        except subprocess.CalledProcessError as e:
            print(f"Render failed: {e}")
            return False
