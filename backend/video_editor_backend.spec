# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
import os
import shutil

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules


project_root = Path.cwd()
backend_dir = project_root / "backend"


def resolve_binary(name):
    env_path = os.getenv(f"{name.upper()}_PATH", "").strip()
    candidates = [
        env_path,
        rf"C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\{name}.exe",
        shutil.which(name),
    ]

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return str(Path(candidate))

    return None


hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "multipart",
    "torchcodec.encoders",
]

for package in [
    "api",
    "core",
    "services",
    "demucs",
    "dora",
    "faster_whisper",
    "edge_tts",
    "vieneu",
    "sea_g2p",
    "yt_dlp",
]:
    hiddenimports += collect_submodules(package)

datas = []
for package in [
    "demucs",
    "faster_whisper",
    "edge_tts",
    "vieneu",
    "sea_g2p",
    "tokenizers",
]:
    datas += collect_data_files(package)

binaries = []
for package in [
    "av",
    "ctranslate2",
    "onnxruntime",
    "soundfile",
    "torch",
    "torchaudio",
    "torchcodec",
]:
    binaries += collect_dynamic_libs(package)

for binary_name in ["ffmpeg", "ffprobe"]:
    binary_path = resolve_binary(binary_name)
    if binary_path:
        binaries.append((binary_path, "."))
    else:
        print(f"WARNING: {binary_name}.exe was not found; packaged backend will require it on PATH.")


a = Analysis(
    [str(backend_dir / "run_backend.py")],
    pathex=[str(backend_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    name="video-editor-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    exclude_binaries=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="video-editor-backend",
)
