# Jev Merge Queue Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package a Codex plugin that produces safe, auditable Jev-assisted decisions for rebase and full-test requirements before merge-queue admission.

**Architecture:** A dependency-free Node ESM CLI gathers Git facts, applies non-negotiable deterministic gates, and calls TypeSafe's HTTP API once for two independent Noul judgments. Pure modules own evidence collection, response validation, and verdict routing; the CLI only composes them and prints the documented JSON contract.

**Tech Stack:** Node.js 20+ built-in modules (`node:child_process`, `node:fs`, `node:test`), Git, TypeSafe System One HTTP API, portable Agent Plugins manifest, Codex compatibility manifest.

**Spec:** `docs/design.md`

## Global Constraints

- Never rebase, push, run tests, or enqueue a merge; emit advice and evidence only.
- Resolve factual Git state in code; only the two semantic questions go to `jev-latest`.
- A missing base ref, API key, or valid Jev answer must never yield `NOT_REQUIRED`.
- Rebase is deterministically `NOT_REQUIRED` when the branch is not behind the base, and `REQUIRED` for a virtual merge conflict.
- Full tests are deterministically `REQUIRED` for high-blast-radius paths.
- Use the default Noul routing thresholds of `>= 0.80` and `<= 0.20`; make both configurable.
- Send bounded metadata only; do not send source content, untracked content, credentials, or Git remotes with credentials.
- No runtime package dependencies or lifecycle scripts.

## Review Focus

- A base that resolves but is stale must be identified when `--refresh` was not requested; test the emitted freshness state in Task 2.
- Git paths containing spaces or non-ASCII characters must remain single paths; test a real temporary repository in Task 2.
- A malformed TypeSafe response must block rather than being routed as a low probability; test this boundary in Task 3.
- A high-blast-radius change must override a low Jev probability; test the externally observable CLI result in Task 3.
- Package contents must not include tests, development metadata, or TypeSafe credentials; inspect the generated archive in Task 4.

---

### Task 1: Define the pure verdict policy and Node project

**Files:**
- Create: `plugins/jev-merge-queue-decision/package.json`
- Create: `plugins/jev-merge-queue-decision/lib/policy.mjs`
- Create: `plugins/jev-merge-queue-decision/test/policy.test.mjs`

**Interfaces:**
- Consumes: Plain Git evidence object with `baseResolved`, `behind`, `hasConflicts`, and `highBlastRadiusPaths` fields.
- Produces: `routeAssessment({ facts, answers, thresholds })`, returning `{ rebase, fullTest }`, where each decision has `status`, `source`, `reason`, and optional `probability`.

- [ ] **Step 1: Write the failing policy tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeAssessment } from '../lib/policy.mjs';

test('blocks both decisions when the base cannot be resolved', () => {
  const result = routeAssessment({
    facts: { baseResolved: false },
    answers: {},
  });

  assert.equal(result.rebase.status, 'BLOCKED');
  assert.equal(result.fullTest.status, 'BLOCKED');
});

test('requires a rebase for a virtual merge conflict', () => {
  const result = routeAssessment({
    facts: { baseResolved: true, behind: 2, hasConflicts: true, highBlastRadiusPaths: [] },
    answers: { rebase_before_merge_queue: 0.01, full_test_matrix_required: 0.01 },
  });

  assert.equal(result.rebase.status, 'REQUIRED');
  assert.equal(result.rebase.source, 'deterministic');
});

test('routes Noul values in the uncertainty band to human review', () => {
  const result = routeAssessment({
    facts: { baseResolved: true, behind: 1, hasConflicts: false, highBlastRadiusPaths: [] },
    answers: { rebase_before_merge_queue: 0.5, full_test_matrix_required: 0.5 },
  });

  assert.equal(result.rebase.status, 'REVIEW_REQUIRED');
  assert.equal(result.fullTest.status, 'REVIEW_REQUIRED');
});
```

- [ ] **Step 2: Verify that the policy test fails because the module is absent**

Run: `node --test plugins/jev-merge-queue-decision/test/policy.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` for `lib/policy.mjs`.

- [ ] **Step 3: Implement the minimal pure policy**

```js
export function routeAssessment({ facts, answers, thresholds = { required: 0.8, notRequired: 0.2 } }) {
  if (!facts.baseResolved) return blockedAssessment('The base ref could not be resolved.');
  return {
    rebase: routeRebase(facts, answers.rebase_before_merge_queue, thresholds),
    fullTest: routeFullTest(facts, answers.full_test_matrix_required, thresholds),
  };
}
```

Implement `blockedAssessment`, `routeRebase`, and `routeFullTest` as private functions. Validate thresholds (`0 <= notRequired < required <= 1`) and return `BLOCKED` when an answer is absent or not a finite number between zero and one.

- [ ] **Step 4: Verify the focused policy suite passes**

Run: `node --test plugins/jev-merge-queue-decision/test/policy.test.mjs`

Expected: all tests pass with no warnings.

- [ ] **Step 5: Commit the policy task**

```bash
git add plugins/jev-merge-queue-decision/package.json \
  plugins/jev-merge-queue-decision/lib/policy.mjs \
  plugins/jev-merge-queue-decision/test/policy.test.mjs
git commit -m '✨ Jev 판정 정책을 추가합니다'
```

### Task 2: Collect bounded, deterministic Git evidence

**Files:**
- Create: `plugins/jev-merge-queue-decision/lib/git-evidence.mjs`
- Create: `plugins/jev-merge-queue-decision/test/git-evidence.test.mjs`
- Modify: `plugins/jev-merge-queue-decision/test/policy.test.mjs`

**Interfaces:**
- Consumes: `collectGitEvidence({ repo, base, refresh, maxChangedPaths, maxDiffStatLines })`.
- Produces: Evidence accepted by `routeAssessment`, including `baseResolved`, `behind`, `hasConflicts`, `highBlastRadiusPaths`, `changedPaths`, `diffStat`, and `freshness`.

- [ ] **Step 1: Write failing evidence tests against temporary repositories**

```js
test('keeps a changed path containing spaces as one evidence entry', async (t) => {
  const repo = await createRepository(t, { baseBranch: 'develop' });
  await commitFile(repo, 'shared package/file name.txt', 'branch change');

  const evidence = await collectGitEvidence({ repo, base: 'develop' });

  assert.deepEqual(evidence.changedPaths, ['shared package/file name.txt']);
  assert.equal(evidence.highBlastRadiusPaths[0], 'shared package/file name.txt');
});

test('marks the base as stale unless refresh was explicitly requested', async (t) => {
  const repo = await createRepository(t, { baseBranch: 'develop' });
  const evidence = await collectGitEvidence({ repo, base: 'develop' });

  assert.equal(evidence.freshness, 'not-refreshed');
});
```

The test helper initializes a temporary Git repository, configures its local identity, commits an initial `develop` commit, and checks out a `feature` branch. It uses `spawnSync('git', args, { cwd: repo, encoding: 'utf8' })` and asserts every fixture setup command exits with status zero.

- [ ] **Step 2: Verify that the evidence test fails because the collector is absent**

Run: `node --test plugins/jev-merge-queue-decision/test/git-evidence.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` for `lib/git-evidence.mjs`.

- [ ] **Step 3: Implement collection without shell interpolation**

```js
export async function collectGitEvidence({ repo, base, refresh = false, maxChangedPaths = 200, maxDiffStatLines = 200 }) {
  if (refresh) runGit(repo, ['fetch', '--quiet', 'origin', base]);
  const baseOid = tryGit(repo, ['rev-parse', '--verify', `${base}^{commit}`]);
  if (!baseOid) return unresolvedBaseEvidence(base, refresh);

  const mergeBase = runGit(repo, ['merge-base', 'HEAD', base]).trim();
  const [ahead, behind] = runGit(repo, ['rev-list', '--left-right', '--count', `HEAD...${base}`])
    .trim().split(/\s+/).map(Number);
  const changedPaths = parseNulPaths(runGit(repo, ['diff', '--name-only', '-z', `${mergeBase}..HEAD`])).slice(0, maxChangedPaths);
  return buildEvidence({ base, baseOid, mergeBase, ahead, behind, changedPaths, maxDiffStatLines, freshness: refresh ? 'refreshed' : 'not-refreshed' });
}
```

Use Git argument arrays for every command. Parse `-z` output; do not split paths on newlines. Cap both path and diff-stat arrays, and record truncation booleans. Detect virtual conflicts with `git merge-tree --write-tree HEAD <base>` and use the command status, not its text, as the conflict signal.

- [ ] **Step 4: Run the evidence and policy suites**

Run: `node --test plugins/jev-merge-queue-decision/test/policy.test.mjs plugins/jev-merge-queue-decision/test/git-evidence.test.mjs`

Expected: all tests pass with no network access.

- [ ] **Step 5: Commit the Git evidence task**

```bash
git add plugins/jev-merge-queue-decision/lib/git-evidence.mjs \
  plugins/jev-merge-queue-decision/test/git-evidence.test.mjs \
  plugins/jev-merge-queue-decision/test/policy.test.mjs
git commit -m '✨ 머지 큐용 Git 근거 수집기를 추가합니다'
```

### Task 3: Call Jev once and expose the decision CLI

**Files:**
- Create: `plugins/jev-merge-queue-decision/lib/typesafe.mjs`
- Create: `plugins/jev-merge-queue-decision/scripts/assess-merge-queue.mjs`
- Create: `plugins/jev-merge-queue-decision/test/cli.test.mjs`
- Create: `plugins/jev-merge-queue-decision/test/fixtures/low-risk-response.json`
- Modify: `plugins/jev-merge-queue-decision/lib/policy.mjs`

**Interfaces:**
- Consumes: `evaluateWithJev({ state, apiKey, fetchImpl })`, returning the two validated Noul values; and CLI flags `--repo`, `--base`, `--refresh`, `--json`, `--response-file`, `--required-threshold`, `--not-required-threshold`.
- Produces: one JSON object conforming to the verdict contract in `docs/design.md`; exit code zero only when both decisions are not `BLOCKED`.

- [ ] **Step 1: Write failing CLI integration tests with a fixture response**

```js
test('returns NOT_REQUIRED for a narrow branch with low fixture probabilities', async (t) => {
  const repo = await createRepository(t, { baseBranch: 'develop' });
  await commitFile(repo, 'docs/readme.md', 'narrow change');

  const result = runCli([
    '--repo', repo,
    '--base', 'develop',
    '--response-file', fixturePath('low-risk-response.json'),
    '--json',
  ]);

  assert.equal(result.status, 0);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.rebase.status, 'NOT_REQUIRED');
  assert.equal(assessment.fullTest.status, 'NOT_REQUIRED');
});

test('does not let a low fixture probability bypass a high-blast-radius change', async (t) => {
  const repo = await createRepository(t, { baseBranch: 'develop' });
  await commitFile(repo, 'pnpm-lock.yaml', 'lockfile change');

  const result = runCli(['--repo', repo, '--base', 'develop', '--response-file', fixturePath('low-risk-response.json'), '--json']);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.fullTest.status, 'REQUIRED');
  assert.equal(assessment.fullTest.source, 'deterministic');
});
```

- [ ] **Step 2: Verify that the CLI integration test fails because the executable is absent**

Run: `node --test plugins/jev-merge-queue-decision/test/cli.test.mjs`

Expected: the spawned process exits nonzero because `scripts/assess-merge-queue.mjs` does not exist.

- [ ] **Step 3: Implement the TypeSafe boundary and CLI**

```js
export async function evaluateWithJev({ state, apiKey, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions: questions() }),
  });
  return parseNoulAnswers(await response.json());
}
```

`parseNoulAnswers` requires both named `type: 'noul'` answers and finite values in `[0, 1]`; otherwise it throws a typed error caught by the CLI to produce `BLOCKED`. The CLI reads `--response-file` before checking `TYPESAFE_API_KEY`, builds state only from collected evidence, routes it through `routeAssessment`, and emits exactly one JSON document to stdout. Diagnostics go to stderr.

- [ ] **Step 4: Run all behavior tests**

Run: `node --test plugins/jev-merge-queue-decision/test/*.test.mjs`

Expected: all tests pass, including fixture-only CLI tests with no TypeSafe credential or network connection.

- [ ] **Step 5: Commit the executable decision path**

```bash
git add plugins/jev-merge-queue-decision/lib/typesafe.mjs \
  plugins/jev-merge-queue-decision/scripts/assess-merge-queue.mjs \
  plugins/jev-merge-queue-decision/test/cli.test.mjs \
  plugins/jev-merge-queue-decision/test/fixtures/low-risk-response.json \
  plugins/jev-merge-queue-decision/lib/policy.mjs
git commit -m '✨ Jev 머지 큐 판정 CLI를 추가합니다'
```

### Task 4: Package the portable Codex plugin and verify its install artifacts

**Files:**
- Create: `.agents/plugins/marketplace.json`
- Create: `plugins/jev-merge-queue-decision/plugin.json`
- Create: `plugins/jev-merge-queue-decision/.codex-plugin/plugin.json`
- Create: `plugins/jev-merge-queue-decision/skills/merge-queue-decision/SKILL.md`
- Create: `plugins/jev-merge-queue-decision/README.md`
- Create: `scripts/package-plugin.mjs`
- Create: `test/package-plugin.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the plugin directory and `package.json` version.
- Produces: `dist/jev-merge-queue-decision-<version>.tgz`, a marketplace discoverable at `.agents/plugins/marketplace.json`, and an installable portable plugin.

- [ ] **Step 1: Write the failing packaging test**

```js
test('packages exactly the portable plugin contents', () => {
  const result = spawnSync(process.execPath, ['scripts/package-plugin.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const archive = 'dist/jev-merge-queue-decision-0.1.0.tgz';
  assert.equal(existsSync(archive), true);
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' }).stdout;
  assert.match(listing, /package\/plugin\.json/);
  assert.match(listing, /package\/skills\/merge-queue-decision\/SKILL\.md/);
  assert.doesNotMatch(listing, /test\//);
  assert.doesNotMatch(listing, /\.env/);
});
```

- [ ] **Step 2: Verify that the packaging test fails because the script is absent**

Run: `node --test test/package-plugin.test.mjs`

Expected: assertion failure because `scripts/package-plugin.mjs` does not exist and the process exits nonzero.

- [ ] **Step 3: Add manifests, the skill, docs, and a deterministic archiver**

The root portable `plugin.json` declares the Agent Plugins schema, name `jev-merge-queue-decision`, version `0.1.0`, and MIT license. Its `skills/` directory holds a focused workflow that refuses to auto-rebase or auto-run tests and calls the bundled CLI with `--json`. The compatibility manifest has matching identity and OpenAI install metadata. The marketplace points at `./plugins/jev-merge-queue-decision` with `AVAILABLE`, `ON_INSTALL`, and `Productivity`.

`scripts/package-plugin.mjs` stages only `plugin.json`, `.codex-plugin/`, `skills/`, `lib/`, `scripts/`, `README.md`, and `package.json` under a temporary `package/` directory; it then creates a gzipped tar archive via `tar -czf`. It validates every staged relative path stays under the plugin root, removes the staging directory in `finally`, and creates `dist/` only as a generated ignored directory.

- [ ] **Step 4: Verify manifests and complete project suite**

Run: `python3 /Users/lago/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/jev-merge-queue-decision && node --test plugins/jev-merge-queue-decision/test/*.test.mjs test/package-plugin.test.mjs && node scripts/package-plugin.mjs && tar -tzf dist/jev-merge-queue-decision-0.1.0.tgz`

Expected: validator exits zero, every Node test passes, and the archive lists the portable manifest and skill but no tests or `.env` files.

- [ ] **Step 5: Commit the distributable plugin**

```bash
git add .agents/plugins/marketplace.json .gitignore plugins/jev-merge-queue-decision \
  scripts/package-plugin.mjs test/package-plugin.test.mjs
git commit -m '📦 설치 가능한 Jev 머지 큐 플러그인을 패키징합니다'
```
