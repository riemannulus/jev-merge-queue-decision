import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repositoryRoot, 'plugins', 'jev-merge-queue-decision');
const distDirectory = join(repositoryRoot, 'dist');
const stagedEntries = [
  '.codex-plugin',
  'lib',
  'scripts',
  'skills',
  'README.md',
  'package.json',
  'plugin.json',
];

const packageMetadata = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/u.test(packageMetadata.version)) {
  throw new Error('Plugin package.json must have a stable x.y.z version before packaging.');
}

const stagingRoot = await mkdtemp(join(tmpdir(), 'jev-merge-queue-package-'));
const stagingPackage = join(stagingRoot, 'package');
const archive = join(distDirectory, `jev-merge-queue-decision-${packageMetadata.version}.tgz`);

try {
  await mkdir(stagingPackage);
  const files = trackedRuntimeFiles();
  await Promise.all(files.map(async (entry) => {
    const source = checkedPath(pluginRoot, entry);
    const destination = checkedPath(stagingPackage, entry);
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing to package symbolic link: ${entry}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, 0);
  }));
  await mkdir(distDirectory, { recursive: true });

  const result = spawnSync('tar', ['-czf', archive, '-C', stagingRoot, 'package'], {
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`);

  process.stdout.write(`${archive}\n`);
} finally {
  await rm(stagingRoot, { force: true, recursive: true });
}

function checkedPath(root, entry) {
  const path = resolve(root, entry);
  const pathFromRoot = relative(root, path);
  if (pathFromRoot === '' || pathFromRoot.startsWith('..') || pathFromRoot.includes('../')) {
    throw new Error(`Unsafe package entry: ${entry}`);
  }

  return path;
}

function trackedRuntimeFiles() {
  const result = spawnSync('git', ['ls-files', '-z', '--', 'plugins/jev-merge-queue-decision'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);

  const prefix = 'plugins/jev-merge-queue-decision/';
  const files = result.stdout
    .split('\0')
    .filter(Boolean)
    .map((path) => path.slice(prefix.length))
    .filter(isStagedEntry);

  if (files.length === 0) {
    throw new Error('No tracked runtime files found for the plugin.');
  }

  for (const path of files) {
    if (/(?:^|\/)\.env(?:\.|$)/u.test(path)) {
      throw new Error(`Refusing to package environment file: ${path}`);
    }
  }

  return files;
}

function isStagedEntry(path) {
  return stagedEntries.some((entry) => path === entry || path.startsWith(`${entry}/`));
}
