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

test('refreshes the exact origin tracking ref despite a restrictive fetch mapping', (t) => {
  const repo = createRepository(t);
  const remote = mkdtempSync(join(tmpdir(), 'jev-remote-'));
  const writerRoot = mkdtempSync(join(tmpdir(), 'jev-writer-'));
  const writer = join(writerRoot, 'writer');
  t.after(() => rmSync(remote, { force: true, recursive: true }));
  t.after(() => rmSync(writerRoot, { force: true, recursive: true }));

  git(remote, ['init', '--bare']);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', 'origin', 'develop:develop']);
  git(repo, ['fetch', 'origin', 'develop:refs/remotes/origin/develop']);
  git(repo, ['config', 'remote.origin.fetch', '+refs/heads/release:refs/remotes/origin/release']);
  git(process.cwd(), ['clone', '--branch', 'develop', remote, writer]);
  git(writer, ['config', 'user.email', 'tests@example.com']);
  git(writer, ['config', 'user.name', 'Test User']);
  commitFile(writer, 'base-update.md', 'new develop commit');
  git(writer, ['push', 'origin', 'develop']);

  const evidence = collectGitEvidence({ repo, base: 'origin/develop', refresh: true });

  assert.equal(evidence.freshness, 'refreshed');
  assert.equal(evidence.baseCommit, git(writer, ['rev-parse', 'develop']).trim());
});

test('rejects a refresh base that is not an origin branch name before fetching', (t) => {
  const repo = createRepository(t);

  assert.throws(
    () => collectGitEvidence({
      repo,
      base: 'origin/develop:refs/heads/other',
      refresh: true,
    }),
    /--refresh requires a base ref in the form origin\/<branch>/,
  );
});

test('classifies both rename endpoints so moving a shared file cannot bypass the full-test gate', (t) => {
  const repo = createRepository(t);
  git(repo, ['checkout', 'develop']);
  commitFile(repo, 'shared/core.mjs', 'base implementation');
  git(repo, ['checkout', '-B', 'feature', 'develop']);
  mkdirSync(join(repo, 'app'));
  git(repo, ['mv', 'shared/core.mjs', 'app/core.mjs']);
  git(repo, ['commit', '-m', 'move shared implementation']);

  const evidence = collectGitEvidence({ repo, base: 'develop' });

  assert.deepEqual(evidence.highBlastRadiusPaths, ['shared/core.mjs']);
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

test('caps high-blast-radius paths while preserving their total count', (t) => {
  const repo = createRepository(t);
  commitFile(repo, 'shared/one.mjs', 'one');
  commitFile(repo, 'shared/two.mjs', 'two');
  commitFile(repo, 'shared/three.mjs', 'three');

  const evidence = collectGitEvidence({
    repo,
    base: 'develop',
    maxChangedPaths: 2,
  });

  assert.equal(evidence.highBlastRadiusPaths.length, 2);
  assert.equal(evidence.highBlastRadiusPathCount, 3);
  assert.equal(evidence.highBlastRadiusPathsTruncated, true);
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
