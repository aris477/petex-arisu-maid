const fs = require('node:fs/promises');
const path = require('node:path');

const ARISU_ID = '8a87ef6b-0a63-428c-af2a-a30448d753af';

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function seedBundledArisu(library, source) {
  if (await exists(path.join(library.root, 'settings.json'))) return;
  const destination = path.join(library.petsPath, ARISU_ID);
  if (!await exists(destination)) {
    const staging = await fs.mkdtemp(path.join(library.root, 'seed-'));
    try {
      const role = path.join(staging, ARISU_ID);
      await fs.cp(source, role, {recursive: true});
      await fs.rename(role, destination);
    } finally {
      await fs.rm(staging, {recursive: true, force: true});
    }
  }
  await library.saveSettings({...await library.settings(), petId: ARISU_ID, hideBuiltinMiso: true});
}

module.exports = {seedBundledArisu};
