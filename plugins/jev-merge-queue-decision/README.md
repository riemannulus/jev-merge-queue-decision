# Jev Merge Queue Decision

An installable Codex plugin that collects bounded Git evidence and asks
TypeSafe Jev two independent questions:

1. Does the branch need rebasing onto `develop` before merge-queue admission?
2. Does the change require the full repository test matrix instead of focused
   validation?

It never rebases, runs tests, pushes, or enqueues a merge. It emits auditable
JSON evidence and a verdict for each question.

## Install from this repository

Add the marketplace source, then install `jev-merge-queue-decision` from the
Codex Plugins Directory. Codex discovers the repository marketplace at
`.agents/plugins/marketplace.json`.

```bash
codex plugin marketplace add https://github.com/riemannulus/jev-merge-queue-decision.git \
  --sparse .agents/plugins
```

Restart the Codex desktop app, select **Jev Merge Queue Decision** from that
marketplace, and install it. The portable package also has a root
`plugin.json` for Agent Plugins-compatible hosts.

## Use the CLI

Set the TypeSafe API key in the environment, never on a command line:

```bash
export TYPESAFE_API_KEY='...'
node plugins/jev-merge-queue-decision/scripts/assess-merge-queue.mjs \
  --repo /absolute/path/to/checkout \
  --base origin/develop \
  --refresh \
  --json
```

`--refresh` only runs `git fetch --quiet origin develop` so the decision uses
current remote-tracking data. It does not alter the worktree. Omit it for an
offline decision; `evidence.freshness` will be `not-refreshed`.

The CLI prints one JSON object with independent `rebase` and `fullTest`
decisions. Each has `REQUIRED`, `NOT_REQUIRED`, `REVIEW_REQUIRED`, or
`BLOCKED` status. Values at or above `0.80` require the action; values at or
below `0.20` do not; values between those bounds require review. Pass
`--required-threshold` and `--not-required-threshold` to calibrate the
boundaries.

`BLOCKED` is a failure state, not a skip. The CLI exits with status 1 when
either decision is blocked. `REVIEW_REQUIRED` exits zero but still requires a
human choice.

For offline demos and tests, provide a complete saved TypeSafe response:

```bash
node plugins/jev-merge-queue-decision/scripts/assess-merge-queue.mjs \
  --repo /absolute/path/to/checkout \
  --base develop \
  --response-file plugins/jev-merge-queue-decision/test/fixtures/low-risk-response.json \
  --json
```

## Package a portable archive

The repository marketplace is the canonical installation method. To create an
inspectable portable archive for transfer or release tooling, run:

```bash
node scripts/package-plugin.mjs
tar -tzf dist/jev-merge-queue-decision-0.1.0.tgz
```

The generated archive contains the manifest, compatibility manifest, skill,
runtime code, and README only. It excludes tests, untracked worktree files,
and environment files.

## Verify

```bash
python3 /Users/lago/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py \
  plugins/jev-merge-queue-decision
node --test plugins/jev-merge-queue-decision/test/*.test.mjs test/package-plugin.test.mjs
```
