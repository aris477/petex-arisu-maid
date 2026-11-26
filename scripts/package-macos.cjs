const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {packager} = require('@electron/packager');
const {version} = require('../package.json');

const root = path.resolve(__dirname, '..');
const electronVersion = '44.3.0';
const name = 'Arisu Maid';

async function main() {
  assert(process.platform === 'darwin' && process.arch === 'arm64',
    'Build with an arm64 Node.js installation on macOS so sharp is packaged for Apple Silicon.');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'arisu-mac-'));
  try {
    const iconset = path.join(temp, 'arisu.iconset');
    const icon = path.join(temp, 'arisu.icns');
    const source = path.join(root, 'app/assets/arisu-app.png');
    await fs.mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const px = String(size * scale);
        execFileSync('/usr/bin/sips', ['-z', px, px, source, '--out',
          path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
      }
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icon]);

    const [out] = await packager({
      dir: root, out: path.join(root, 'dist'), platform: 'darwin', arch: 'arm64',
      name, executableName: name, appBundleId: 'com.aris477.petex.arisumaid.trial',
      appVersion: version, electronVersion, icon, overwrite: true,
      // Keep sharp's native files and libraries in the regular filesystem.
      asar: false,
      extraResource: [path.join(root, 'pets/arisu-maid-hd-2x')],
      ignore: [
        /^\/\./,
        /^\/(?:companion|dist|docs|pets|qa|scripts|tests|data)(?:\/|$)/,
        /\.bak(?:-|$)/,
      ],
    });
    const app = path.join(out, `${name}.app`);
    // Ad-hoc signing permits local smoke testing. Distribution needs Developer ID and notarization.
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], {stdio: 'inherit'});
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], {stdio: 'inherit'});
    const zip = path.join(root, 'dist', `Petex-Arisu-Maid-v${version}-macOS-arm64-preview.zip`);
    await fs.rm(zip, {force: true});
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip], {stdio: 'inherit'});
    console.log(zip);
  } finally {
    await fs.rm(temp, {recursive: true, force: true});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
