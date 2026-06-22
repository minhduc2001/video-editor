"""Run Demucs with a WAV writer that does not require TorchCodec.

Recent torchaudio releases route ``torchaudio.save`` through TorchCodec. On
Windows this can fail unless FFmpeg shared DLLs and a matching TorchCodec build
are present. Demucs only needs to write WAV stems here, so use stdlib ``wave``
for PCM16 output and keep the rest of Demucs untouched.
"""

from pathlib import Path
import sys
import wave

import torch

import demucs.audio as demucs_audio
import demucs.separate as demucs_separate


def save_audio_without_torchcodec(
    wav: torch.Tensor,
    path: str | Path,
    samplerate: int,
    bitrate: int = 320,
    clip: str = "rescale",
    bits_per_sample: int = 16,
    as_float: bool = False,
    preset: int = 2,
) -> None:
    output_path = Path(path)

    if output_path.suffix.lower() != ".wav":
        return ORIGINAL_SAVE_AUDIO(
            wav,
            output_path,
            samplerate,
            bitrate=bitrate,
            clip=clip,
            bits_per_sample=bits_per_sample,
            as_float=as_float,
            preset=preset,
        )

    if as_float or bits_per_sample != 16:
        raise ValueError("Demucs compatibility writer only supports PCM16 WAV output.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    clipped = demucs_audio.prevent_clip(wav, mode=clip).detach().cpu()

    if clipped.ndim == 1:
        clipped = clipped.unsqueeze(0)

    clipped = clipped.clamp(-1, 1)
    channels, _samples = clipped.shape
    pcm = (clipped.transpose(0, 1).contiguous().numpy() * 32767).astype("<i2")

    with wave.open(str(output_path), "wb") as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(2)
        writer.setframerate(samplerate)
        writer.writeframes(pcm.tobytes())


ORIGINAL_SAVE_AUDIO = demucs_audio.save_audio
demucs_audio.save_audio = save_audio_without_torchcodec
demucs_separate.save_audio = save_audio_without_torchcodec


if __name__ == "__main__":
    sys.exit(demucs_separate.main())
