import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = join(pluginRoot, 'scripts', 'assess-merge-queue.mjs');
const fixturePath = join(pluginRoot, 'test', 'fixtures', 'low-risk-response.json');

test('returns NOT_REQUIRED for a narrow branch with low fixture probabilities', (t) => {
  const repo = createRepository(t);
  commitFile(repo, 'docs/readme.md', 'narrow change');

  const result = runCli([
    '--repo', repo,
    '--base', 'develop',
    '--response-file', fixturePath,
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.rebase.status, 'NOT_REQUIRED');
  assert.equal(assessment.fullTest.status, 'NOT_REQUIRED');
  assert.equal(assessment.evidence.changedPaths[0], 'docs/readme.md');
});

test('does not let a low fixture probability bypass a high-blast-radius change', (t) => {
  const repo = createRepository(t);
  commitFile(repo, 'pnpm-lock.yaml', 'lockfile change');

  const result = runCli([
    '--repo', repo,
    '--base', 'develop',
    '--response-file', fixturePath,
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.fullTest.status, 'REQUIRED');
  assert.equal(assessment.fullTest.source, 'deterministic');
});

test('blocks instead of skipping when there is no fixture or TypeSafe API key', (t) => {
  const repo = createRepository(t);
  commitFile(repo, 'docs/readme.md', 'narrow change');

  const result = runCli(['--repo', repo, '--base', 'develop', '--json'], {
    TYPESAFE_API_KEY: '',
  });

  assert.equal(result.status, 1);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.rebase.status, 'BLOCKED');
  assert.equal(assessment.fullTest.status, 'BLOCKED');
});

function runCli(args, environment = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

function createRepository(t) {
  const repo = mkdtempSync(join(tmpdir(), 'jev-cli-'));
  t.after(() => rmSync(repo, { force: true, recursive: true }));

  git(repo, ['init', '--initial-branch=develop']);
  git(repo, ['config', 'user.email', 'tests@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeFileSync(join(repo, 'README.md'), '# test\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['checkout', '-b', 'feature']);
  return repo;
}

function commitFile(repo, relativePath, contents) {
  const path = join(repo, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  git(repo, ['add', '--', relativePath]);
  git(repo, ['commit', '-m', `change ${relativePath}`]);
}

function git(repo, arguments_) {
  const result = spawnSync('git', arguments_, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
