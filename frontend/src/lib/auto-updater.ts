type DownloadProgress = {
  event: 'Started' | 'Progress' | 'Finished'
  data?: {
    contentLength?: number
    chunkLength?: number
  }
}

export type AppUpdateCheckResult = {
  status: 'unsupported' | 'current' | 'available' | 'installed' | 'error'
  message: string
  version?: string
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

export const getCurrentAppVersion = async () => {
  if (!isTauriRuntime()) {
    return __APP_VERSION__;
  }

  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return __APP_VERSION__;
  }
};

export const checkForAppUpdates = async (
  options: { notifyWhenCurrent?: boolean } = {}
): Promise<AppUpdateCheckResult> => {
  if (!isTauriRuntime()) {
    const result = {
      status: 'unsupported',
      message: 'Update checks are available in the installed desktop app.',
    } satisfies AppUpdateCheckResult;

    if (options.notifyWhenCurrent) {
      window.alert(result.message);
    }

    return result;
  }

  try {
    const [{ check }, { relaunch }] = await Promise.all([
      import('@tauri-apps/plugin-updater'),
      import('@tauri-apps/plugin-process'),
    ]);

    const update = await check({ timeout: 30_000 });
    if (!update) {
      const result = {
        status: 'current',
        message: 'You are already on the latest version.',
      } satisfies AppUpdateCheckResult;

      if (options.notifyWhenCurrent) {
        window.alert(result.message);
      }

      return result;
    }

    const releaseNotes = update.body ? `\n\n${update.body}` : '';
    const shouldInstall = window.confirm(
      `New version ${update.version} is available. Download and install now?${releaseNotes}`
    );

    if (!shouldInstall) {
      return {
        status: 'available',
        version: update.version,
        message: `Version ${update.version} is available.`,
      };
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

    window.alert('Update installed. The app will restart now.');
    await relaunch();

    return {
      status: 'installed',
      version: update.version,
      message: `Version ${update.version} was installed.`,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    const isExpectedLocalBuildError =
      /updater/i.test(message) &&
      /(not configured|pubkey|endpoint|signature|permission)/i.test(message);
    const result = {
      status: 'error',
      message: isExpectedLocalBuildError
        ? `Auto update is not active for this build: ${message}`
        : `Update check failed: ${message}`,
    } satisfies AppUpdateCheckResult;

    if (options.notifyWhenCurrent) {
      window.alert(result.message);
    } else {
      console.warn(result.message);
    }

    return result;
  }
};
