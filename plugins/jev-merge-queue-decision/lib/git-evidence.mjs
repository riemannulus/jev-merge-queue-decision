import { spawnSync } from 'node:child_process';

const HIGH_BLAST_RADIUS_PATHS = [
  /^(?:\.github|\.gitlab|\.circleci|\.buildkite|ci|common|shared|packages|prisma|graphql|infra|infrastructure)\//u,
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb)$/u,
  /^(?:package\.json|pnpm-workspace\.yaml|turbo\.json|tsconfig(?:\.[^/]+)?\.json|docker-compose(?:\.[^/]+)?\.ya?ml)$/u,
  /(?:^|\/)codegen(?:\/|\.)/u,
];

export function collectGitEvidence({
  repo,
  base,
  refresh = false,
  maxChangedPaths = 200,
  maxDiffStatLines = 200,
}) {
  validateLimit('maxChangedPaths', maxChangedPaths);
  validateLimit('maxDiffStatLines', maxDiffStatLines);

  if (refresh) {
    refreshBase(repo, base);
  }

  const baseOid = tryGit(repo, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  const freshness = refresh ? 'refreshed' : 'not-refreshed';

  if (!baseOid) {
    return unresolvedBaseEvidence(base, freshness);
  }

  const head = runGit(repo, ['rev-parse', '--verify', 'HEAD']).trim();
  const mergeBase = runGit(repo, ['merge-base', 'HEAD', base]).trim();
  const [ahead, behind] = parseAheadBehind(runGit(repo, ['rev-list', '--left-right', '--count', `HEAD...${base}`]));
  const allChangedPaths = parseNulPaths(runGit(repo, ['diff', '--name-only', '-z', `${mergeBase}..HEAD`]));
  const allDiffStatLines = parseLines(runGit(repo, ['diff', '--stat', '--no-renames', `${mergeBase}..HEAD`]));
  const virtualMerge = runGitResult(repo, ['merge-tree', '--write-tree', 'HEAD', base]);

  return {
    base,
    baseCommit: baseOid.trim(),
    baseResolved: true,
    changedPaths: allChangedPaths.slice(0, maxChangedPaths),
    changedPathsTruncated: allChangedPaths.length > maxChangedPaths,
    diffStat: allDiffStatLines.slice(0, maxDiffStatLines),
    diffStatTruncated: allDiffStatLines.length > maxDiffStatLines,
    freshness,
    hasConflicts: virtualMerge.status === 1,
    head,
    highBlastRadiusPaths: allChangedPaths.filter(isHighBlastRadiusPath),
    mergeBase,
    virtualMergeAvailable: virtualMerge.status === 0 || virtualMerge.status === 1,
    ahead,
    behind,
  };
}

function unresolvedBaseEvidence(base, freshness) {
  return {
    base,
    baseResolved: false,
    changedPaths: [],
    changedPathsTruncated: false,
    diffStat: [],
    diffStatTruncated: false,
    freshness,
    hasConflicts: false,
    highBlastRadiusPaths: [],
    virtualMergeAvailable: false,
  };
}

function refreshBase(repo, base) {
  const match = /^origin\/(.+)$/u.exec(base);
  if (!match) {
    throw new Error('--refresh requires a base ref in the form origin/<branch>.');
  }

  runGit(repo, ['fetch', '--quiet', 'origin', match[1]]);
}

function parseAheadBehind(output) {
  const values = output.trim().split(/\s+/u).map(Number);
  if (values.length !== 2 || values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`Could not parse git ahead/behind counts: ${output}`);
  }

  return values;
}

function parseNulPaths(output) {
  return output.split('\0').filter(Boolean);
}

function parseLines(output) {
  return output.split('\n').filter(Boolean);
}

function isHighBlastRadiusPath(path) {
  return HIGH_BLAST_RADIUS_PATHS.some((pattern) => pattern.test(path));
}

function validateLimit(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function tryGit(repo, args) {
  const result = runGitResult(repo, args);
  return result.status === 0 ? result.stdout : null;
}

function runGit(repo, args) {
  const result = runGitResult(repo, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

function runGitResult(repo, args) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}
