---
name: merge-queue-decision
description: Decide whether the current Git branch needs a rebase onto develop and the full repository test matrix before merge-queue admission. Use for merge queue, rebase-needed, full-test-needed, or pre-merge risk decisions.
---

# Jev merge-queue decision

Use this workflow only to decide and explain. It must never run a rebase,
start tests, push, or submit a merge-queue entry.

1. Locate this plugin's root directory (the parent of `skills/`) and run:

   ```bash
   node <plugin-root>/scripts/assess-merge-queue.mjs \
     --repo "$PWD" \
     --base origin/develop \
     --refresh \
     --json
   ```

   `--refresh` performs `git fetch --quiet origin develop` only. It does not
   modify the worktree, rebase, or push. Omit it only when the caller requires
   an offline result; the output then marks the base `not-refreshed`.

2. `TYPESAFE_API_KEY` is required for live Jev evaluation. Never print,
   persist, or pass the key as a command-line argument. For deterministic
   testing, `--response-file <path>` accepts a saved TypeSafe response instead.

3. Read the JSON result as a safety contract:

   - `REQUIRED`: recommend the named action and cite its `reason` and
     `source`.
   - `NOT_REQUIRED`: state the evidence and its freshness; it is permission
     to skip only that action, not unrelated validation.
   - `REVIEW_REQUIRED`: do not choose on the caller's behalf. Surface the
     probability and ask the responsible reviewer to decide.
   - `BLOCKED`: explain the diagnostic and stop. Do not convert it to a skip.

4. Report both independent decisions—`rebase` and `fullTest`—with the base
   ref, ahead/behind counts, changed high-blast-radius paths, and whether the
   ref was refreshed. A result with exit code 1 is blocked; preserve its JSON
   evidence for the reviewer.

The CLI sends bounded Git metadata, not source-file contents or untracked
worktree contents, to TypeSafe Jev. It applies deterministic guards before
semantic routing: unresolved bases block, a branch already containing the base
does not require rebase, virtual merge conflicts require rebase, and
high-blast-radius paths require the full matrix.
