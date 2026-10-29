/**
 * Canonical release artifact filenames.
 *
 * Most formats keep the OS in the name so a download page can tell
 * `Varve-0.5.2-linux-x86_64.deb` from the Windows installer. AppImageHub
 * rejects "linux" in the filename (an AppImage is already a Linux artifact),
 * so AppImages are `Varve-<version>-<arch>.AppImage`.
 *
 * The Tauri updater *platform key* stays `linux-x86_64` / `linux-aarch64`.
 * 0.5.1 clients do not hardcode the filename; they download whatever URL
 * `platforms["linux-x86_64"].url` in stable.json points at.
 */
export const FORMAT_EXTENSIONS = Object.freeze({
  appimage: 'AppImage',
  deb: 'deb',
  rpm: 'rpm',
  nsis: 'exe',
  msi: 'msi',
  dmg: 'dmg',
});

export function releaseArtifactFilename({ product = 'Varve', version, os, arch, format, ext }) {
  const extension = ext ?? FORMAT_EXTENSIONS[format];
  if (!product) throw new Error('releaseArtifactFilename requires product');
  if (!version) throw new Error('releaseArtifactFilename requires version');
  if (!arch) throw new Error('releaseArtifactFilename requires arch');
  if (!extension) throw new Error(`Unknown release format: ${format ?? ext}`);
  if (format === 'appimage' || extension === 'AppImage') {
    return `${product}-${version}-${arch}.${extension}`;
  }
  if (!os) throw new Error('releaseArtifactFilename requires os');
  return `${product}-${version}-${os}-${arch}.${extension}`;
}

/** Pre-0.5.2 AppImage names, used only by repair tools that still touch those releases. */
export function legacyLinuxAppImageFilename({ product = 'Varve', version, arch }) {
  return `${product}-${version}-linux-${arch}.AppImage`;
}

export function linuxAppImageCandidates({ product = 'Varve', version, arch }) {
  return [
    releaseArtifactFilename({ product, version, os: 'linux', arch, format: 'appimage' }),
    legacyLinuxAppImageFilename({ product, version, arch }),
  ];
}
