type DownloadProgress = {
  event: 'Started' | 'Progress' | 'Finished'
  data?: {
    contentLength?: number
    chunkLength?: number
  }
}

const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 MB';
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const checkForAppUpdates = async () => {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const [{ check }, { relaunch }] = await Promise.all([
      import('@tauri-apps/plugin-updater'),
      import('@tauri-apps/plugin-process'),
    ]);

    const update = await check({ timeout: 30_000 });
    if (!update) {
      return;
    }

    const releaseNotes = update.body ? `\n\n${update.body}` : '';
    const shouldInstall = window.confirm(
      `Có bản cập nhật mới ${update.version}. Tải và cài đặt ngay bây giờ?${releaseNotes}`
    );

    if (!shouldInstall) {
      return;
    }

    let downloaded = 0;
    let total = 0;

    await update.downloadAndInstall((event: DownloadProgress) => {
      if (event.event === 'Started') {
        total = event.data?.contentLength ?? 0;
        console.info(`Update download started: ${formatBytes(total)}`);
      }

      if (event.event === 'Progress') {
        downloaded += event.data?.chunkLength ?? 0;
        console.info(`Update download progress: ${formatBytes(downloaded)} / ${formatBytes(total)}`);
      }

      if (event.event === 'Finished') {
        console.info('Update download finished.');
      }
    });

    window.alert('Cập nhật đã cài đặt xong. Ứng dụng sẽ khởi động lại.');
    await relaunch();
  } catch (error) {
    const message = getErrorMessage(error);
    const isExpectedLocalBuildError =
      /updater/i.test(message) &&
      /(not configured|pubkey|endpoint|signature|permission)/i.test(message);

    if (isExpectedLocalBuildError) {
      console.info(`Auto update is not active for this build: ${message}`);
      return;
    }

    console.warn(`Auto update check failed: ${message}`);
  }
};
