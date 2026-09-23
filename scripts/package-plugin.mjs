import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
  await Promise.all(stagedEntries.map(async (entry) => {
    const source = checkedPath(pluginRoot, entry);
    const destination = checkedPath(stagingPackage, entry);
    await cp(source, destination, { errorOnExist: true, recursive: true });
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
