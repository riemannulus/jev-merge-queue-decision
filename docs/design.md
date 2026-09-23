# Jev merge-queue decision plugin — design

## Purpose

Ship an installable Codex plugin that answers two pre-merge questions for a
Git checkout without performing either action itself:

1. Must the current branch be rebased onto `develop` before it enters the
   merge queue?
2. Must the repository's entire test matrix run, rather than only focused
   checks?

The product is a decision aid, not a merge-queue executor. It never rebases,
pushes, starts tests, or exposes API secrets. Its output gives an auditable
verdict, the Git evidence, Jev probabilities, and the next command a human or
agent may choose to run.

## Decision architecture

The bundled Node CLI collects factual state from Git and derives mechanically
checkable signals before involving the model:

- resolved `HEAD`, base ref, and merge base;
- commits ahead of and behind the base;
- files and diff statistics changed by the branch;
- overlap and conflict signals produced by a virtual merge; and
- high-blast-radius paths such as workspace manifests, lockfiles, CI, shared
  packages, schema/code-generation, or infrastructure configuration.

It sends this bounded structured state to one `jev-latest` System One request
with two independent Noul questions. The model supplies the semantic judgment;
the CLI owns truth collection, policy thresholds, deterministic safety gates,
and the final output format.

```text
Git facts ──> deterministic guards ──> Jev (two parallel Nouls) ──> verdicts
  │                    │                       │                    │
  └──────── evidence ──┴───────────────────────┴──> JSON + human report
```

The two questions are deliberately separate. A branch can be safe to merge
without rebasing while still needing the complete test matrix, or it can need a
rebase but have a narrow test scope. Their outputs must never be conflated.

## Verdict contract

The CLI returns a stable JSON document. Each decision has one of four values:

- `REQUIRED` — run the named action before merge-queue admission.
- `NOT_REQUIRED` — the evidence supports skipping that action.
- `REVIEW_REQUIRED` — the model probability is in the configured uncertainty
  band; a human must decide.
- `BLOCKED` — required Git evidence, the Jev credential, or a valid Jev
  response is unavailable.

Each decision carries `source` (`deterministic` or `jev`), a concise reason,
the probability when Jev supplied it, and evidence identifiers. `BLOCKED` and
`REVIEW_REQUIRED` are intentionally not treated as permission to skip work.

The initial policy thresholds are `>= 0.80` for `REQUIRED` and `<= 0.20` for
`NOT_REQUIRED`; values in between require review. They are command-line
configurable and explicitly shown in every output, so later calibration does
not require rewriting the questions.

### Deterministic safety gates

The CLI must not hand a known fact to Jev as an opinion:

- A missing or unresolved base ref blocks both decisions.
- If the branch is not behind the base, rebase is not required.
- A virtual merge conflict makes rebase required.
- A changed high-blast-radius path makes the complete test matrix required.

Otherwise the corresponding Jev Noul selects between the remaining outcomes.
An unavailable API never silently produces `NOT_REQUIRED`.

## Jev request

The request uses `POST https://api.typesafe.ai/v1/systemone`, model
`jev-latest`, and `TYPESAFE_API_KEY`. It does not add an SDK dependency.

The state is structured JSON with the Git facts described above. It caps file
and diff summaries at documented limits to control token cost and never sends
repository credentials or untracked file contents. The questions are:

- `rebase_before_merge_queue`: whether the presented divergence, changed
  surfaces, and merge evidence make a rebase onto the named base necessary
  before merge-queue admission. `true` means a rebase materially reduces
  integration/build/test risk; `false` means it does not.
- `full_test_matrix_required`: whether the presented change risk justifies the
  entire repository test matrix rather than focused validation. `true` means a
  cross-cutting or high-risk regression could escape focused checks; `false`
  means the supplied scope is narrow and isolated.

Question text will not instruct Jev to infer missing Git facts or policy. The
same evidence state is used for both questions in a single request; each is
independently consumable.

## Plugin layout and interface

The repository is both the distributable source and a Codex marketplace:

```text
.agents/plugins/marketplace.json
plugins/jev-merge-queue-decision/
  plugin.json
  .codex-plugin/plugin.json
  README.md
  skills/merge-queue-decision/SKILL.md
  scripts/assess-merge-queue.mjs
  test/assess-merge-queue.test.mjs
```

`plugin.json` is the portable Agent Plugins manifest. The compatibility
manifest preserves current Codex local-marketplace support. The bundled skill
activates only for merge-queue/rebase/full-test decision requests and directs
the agent to run the CLI, preserve JSON evidence, and never turn a review or
block into an automatic action.

The CLI accepts `--repo`, `--base` (default `origin/develop`), `--refresh`,
`--json`, and `--response-file`. `--refresh` is opt-in and runs only `git fetch
origin develop`; the default detects and reports possibly stale remote-tracking
data instead of silently changing it. `--response-file` makes API-free tests
and demos deterministic.

## Testing and packaging

Node's built-in test runner exercises Git fact parsing, deterministic gates,
Jev-response validation, threshold routing, missing-credential failures, and
the no-API fixture path. Tests use temporary Git repositories and a fixture
response; no network, TypeSafe key, rebase, or test execution is required.

The plugin validator validates the Codex compatibility manifest. A packaging
script creates a versioned `.tgz` artifact containing only the portable plugin
directory. The canonical installation path is the repository marketplace,
which allows Codex to install the bundle without executing package lifecycle
scripts. The README documents both paths and the required runtime environment
variable.

## Non-goals

- Running a rebase, tests, or a merge queue.
- Guessing a result when `develop` or the Jev API cannot be verified.
- Replacing repository-specific CI policy; high-blast-radius path rules are a
  transparent starter policy and remain configurable.
- Sending complete source diffs, secrets, or untracked worktree content to
  TypeSafe.
