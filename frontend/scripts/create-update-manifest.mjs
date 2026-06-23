import fs from 'node:fs';
import path from 'node:path';

const [assetsDir = 'release-assets', outputPath = 'release-assets/latest.json'] =
  process.argv.slice(2);

const repository = process.env.GITHUB_REPOSITORY;
const releaseTag = process.env.RELEASE_TAG ?? process.env.TAG;

if (!repository) {
  console.error('GITHUB_REPOSITORY is required.');
  process.exit(1);
}

if (!releaseTag) {
  console.error('RELEASE_TAG is required.');
  process.exit(1);
}

const files = [];

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else {
      files.push(fullPath);
    }
  }
};

walk(assetsDir);

const findOne = (predicate, label) => {
  const found = files.find((file) => predicate(path.basename(file)));
  if (!found) {
    console.error(`Missing ${label} in ${assetsDir}.`);
    process.exit(1);
  }

  return found;
};

const assetUrl = (filePath) => {
  const fileName = path.basename(filePath);
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(
    releaseTag
  )}/${encodeURIComponent(fileName)}`;
};

const readSignature = (filePath) => fs.readFileSync(filePath, 'utf8').trim();

const windowsBundle = findOne(
  (name) => /\.exe$/i.test(name) && !/\.sig$/i.test(name),
  'Windows updater bundle'
);
const windowsSignature = findOne((name) => /\.exe\.sig$/i.test(name), 'Windows signature');
const macosBundle = findOne((name) => /\.app\.tar\.gz$/i.test(name), 'macOS updater bundle');
const macosSignature = findOne((name) => /\.app\.tar\.gz\.sig$/i.test(name), 'macOS signature');

const manifest = {
  version: releaseTag.replace(/^v/, ''),
  notes: `Automated desktop build for ${releaseTag}.`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readSignature(windowsSignature),
      url: assetUrl(windowsBundle),
    },
    'darwin-aarch64': {
      signature: readSignature(macosSignature),
      url: assetUrl(macosBundle),
    },
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
