import fs from 'node:fs';
import path from 'node:path';

const [outputPath = 'src-tauri/.generated-updater.conf.json', ...overlayPaths] =
  process.argv.slice(2);

const releaseBuild = process.env.RELEASE_BUILD === 'true';
const publicKey = (process.env.TAURI_UPDATER_PUBLIC_KEY ?? '').trim();
const privateKey = (process.env.TAURI_SIGNING_PRIVATE_KEY ?? '').trim();
const repository = (process.env.GITHUB_REPOSITORY ?? 'minhduc2001/video-editor').trim();

const merge = (target, source) => {
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      merge(target[key], value);
    } else {
      target[key] = value;
    }
  }

  return target;
};

const config = {};

for (const overlayPath of overlayPaths) {
  const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
  merge(config, overlay);
}

if (releaseBuild) {
  if (!publicKey) {
    console.error('TAURI_UPDATER_PUBLIC_KEY is required for release builds with auto update.');
    process.exit(1);
  }

  if (!privateKey) {
    console.error('TAURI_SIGNING_PRIVATE_KEY is required for release builds with auto update.');
    process.exit(1);
  }

  merge(config, {
    bundle: {
      createUpdaterArtifacts: true,
    },
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: [
          `https://github.com/${repository}/releases/latest/download/latest.json`,
        ],
        windows: {
          installMode: 'passive',
        },
      },
    },
  });
}

if (Object.keys(config).length === 0) {
  console.log('No updater config generated for this build.');
  process.exit(0);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
