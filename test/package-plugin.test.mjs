import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const archive = 'dist/jev-merge-queue-decision-0.1.0.tgz';

test('packages exactly the portable plugin contents', (t) => {
  t.after(() => rmSync('dist', { force: true, recursive: true }));
  const untrackedEnvFile = 'plugins/jev-merge-queue-decision/scripts/.env';
  t.after(() => rmSync(untrackedEnvFile, { force: true }));
  writeFileSync(untrackedEnvFile, 'TYPESAFE_API_KEY=synthetic-secret\n');

  const result = spawnSync(process.execPath, ['scripts/package-plugin.mjs'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(archive), true);

  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /package\/plugin\.json/);
  assert.match(listing.stdout, /package\/skills\/merge-queue-decision\/SKILL\.md/);
  assert.match(listing.stdout, /package\/scripts\/assess-merge-queue\.mjs/);
  assert.doesNotMatch(listing.stdout, /test\//);
  assert.doesNotMatch(listing.stdout, /\.env/);
  assert.equal(existsSync(join('dist', 'jev-merge-queue-decision-0.1.0.tgz')), true);
});
