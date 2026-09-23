import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { collectGitEvidence } from '../lib/git-evidence.mjs';

test('keeps a changed path containing spaces as one evidence entry', (t) => {
  const repo = createRepository(t);
  commitFile(repo, 'shared/file name.txt', 'branch change');

  const evidence = collectGitEvidence({ repo, base: 'develop' });

  assert.deepEqual(evidence.changedPaths, ['shared/file name.txt']);
  assert.deepEqual(evidence.highBlastRadiusPaths, ['shared/file name.txt']);
});

test('marks a local base as not refreshed unless refresh was explicitly requested', (t) => {
  const repo = createRepository(t);

  const evidence = collectGitEvidence({ repo, base: 'develop' });

  assert.equal(evidence.freshness, 'not-refreshed');
});

test('reports an unresolved base without trying to infer a decision', (t) => {
  const repo = createRepository(t);

  const evidence = collectGitEvidence({ repo, base: 'missing-develop' });

  assert.equal(evidence.baseResolved, false);
  assert.equal(evidence.base, 'missing-develop');
  assert.deepEqual(evidence.changedPaths, []);
});

test('caps changed-path evidence and reports truncation', (t) => {
  const repo = createRepository(t);
  commitFile(repo, 'docs/one.md', 'one');
  commitFile(repo, 'docs/two.md', 'two');

  const evidence = collectGitEvidence({
    repo,
    base: 'develop',
    maxChangedPaths: 1,
  });

  assert.equal(evidence.changedPaths.length, 1);
  assert.equal(evidence.changedPathsTruncated, true);
});

function createRepository(t) {
  const repo = mkdtempSync(join(tmpdir(), 'jev-merge-queue-'));
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
