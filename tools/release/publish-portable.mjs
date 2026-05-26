import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2]?.trim();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    const printable = [command, ...args].join(' ');
    throw new Error(`Command failed: ${printable}`);
  }
}

function read(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    const printable = [command, ...args].join(' ');
    throw new Error(`Command failed: ${printable}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function assertVersion(value) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value ?? '')) {
    throw new Error('Usage: npm run release:portable -- 0.2.1');
  }
}

function portableArtifactName(value) {
  return `BKE Layout Preview-${value}-portable.exe`;
}

function assertCleanTree() {
  const status = read('git', ['status', '--porcelain']);
  if (status) {
    throw new Error(`Working tree is not clean. Commit or stash changes first:\n${status}`);
  }
}

function assertGhReady() {
  run('gh', ['auth', 'status']);
}

function assertReleaseDoesNotExist(tag) {
  const result = spawnSync('gh', ['release', 'view', tag], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status === 0) {
    throw new Error(`GitHub Release already exists: ${tag}`);
  }
}

function restoreGeneratedSampleIfNeeded() {
  const status = read('git', ['status', '--porcelain', '--', 'sample_project']);
  if (status) run('git', ['restore', '--', 'sample_project']);
}

assertVersion(version);

const tag = `v${version}`;
const artifact = path.join(root, 'release', portableArtifactName(version));

assertCleanTree();
assertGhReady();
assertReleaseDoesNotExist(tag);

run('npm', ['version', version, '--no-git-tag-version']);
run('npm', ['test']);
run('npm', ['run', 'pack:win-portable']);
restoreGeneratedSampleIfNeeded();

if (!fs.existsSync(artifact)) {
  throw new Error(`Portable artifact was not created: ${artifact}`);
}

run('git', ['add', 'package.json', 'package-lock.json']);
run('git', ['commit', '-m', `Release v${version}`]);
run('git', ['tag', tag]);
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', tag]);
run('gh', [
  'release',
  'create',
  tag,
  artifact,
  '--title',
  `BKE Layout Preview ${version}`,
  '--notes',
  `Portable Windows build for BKE Layout Preview ${version}.`,
]);

console.log(`Published ${tag}: ${artifact}`);
