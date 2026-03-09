const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

const resolveLibc = () => {
  if (process.platform !== 'linux') return null;

  try {
    const { familySync, MUSL } = require('detect-libc');
    return familySync() === MUSL ? 'musl' : process.arch === 'arm' ? 'gnueabihf' : 'gnu';
  } catch {
    return fs.existsSync('/etc/alpine-release') ? 'musl' : 'gnu';
  }
};

const resolvePackageName = () => {
  const parts = [process.platform, process.arch];

  if (process.platform === 'linux') {
    parts.push(resolveLibc());
  } else if (process.platform === 'win32') {
    parts.push('msvc');
  }

  return `lightningcss-${parts.join('-')}`;
};

const main = () => {
  const lightningcssPkg = require(path.join(projectRoot, 'node_modules/lightningcss/package.json'));
  const version = lightningcssPkg.version;
  const platformPkg = resolvePackageName();

  try {
    require.resolve(platformPkg, { paths: [projectRoot] });
    console.log(`[ensure-lightningcss] ${platformPkg} already installed`);
    return;
  } catch {
    console.log(`[ensure-lightningcss] installing ${platformPkg}@${version}`);
  }

  execSync(`npm install --no-save --no-audit --no-fund ${platformPkg}@${version}`, {
    cwd: projectRoot,
    stdio: 'inherit'
  });
};

main();
