# Build and release

The desktop app is built by GitHub Actions in `.github/workflows/build-apps.yml`.

## What the workflow builds

- Windows x64 NSIS installer (`.exe`)
- macOS Apple Silicon build for M1/M2/M3/M4 (`.dmg` and zipped `.app`)
- A bundled Python backend sidecar built with PyInstaller
- Bundled `ffmpeg` and `ffprobe`
- Tauri updater artifacts and `latest.json` when publishing a release

The macOS job uses GitHub's `macos-14` runner, which is listed as arm64 in the [GitHub-hosted runner table](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The frontend uses npm:

```bash
cd frontend
npm install
npm run build
```

## Normal CI

Every push or pull request to `main` builds both desktop targets and uploads them as workflow artifacts.

## Auto update

The app checks for updates on startup. Release builds use Tauri's updater endpoint:

```text
https://github.com/minhduc2001/video-editor/releases/latest/download/latest.json
```

Tauri updater signatures cannot be disabled. Generate the updater key pair once:

```bash
cd frontend
npm run tauri -- signer generate -w ~/.tauri/video-editor.key
```

Add these GitHub repository secrets before publishing the first release:

- `TAURI_UPDATER_PUBLIC_KEY`: the public key printed by the signer command
- `TAURI_SIGNING_PRIVATE_KEY`: the private key content or path from the signer command
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional, only if the key has a password

Keep the private key safe. If it is lost, already-installed apps will not accept future updates signed with a different key.

## Create a versioned release

Create and push a semver tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The workflow strips the leading `v`, stamps `0.1.1` into `frontend/package.json` and `frontend/src-tauri/tauri.conf.json`, builds both platforms, signs updater artifacts, creates `latest.json`, then publishes everything to a GitHub Release named `v0.1.1`.

## Manual build

Open GitHub Actions, run `Build desktop apps`, and optionally fill:

- `version`: app version to stamp, for example `0.1.1`
- `release_tag`: release tag to publish, for example `v0.1.1`

If `release_tag` is empty, the workflow only uploads build artifacts.

## Notes

The macOS package is currently unsigned and not notarized. It can be tested locally, but a polished public macOS release should add Apple Developer signing secrets later.
