import assert from 'node:assert/strict';
import test from 'node:test';

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
    facts: {
      baseResolved: true,
      behind: 2,
      hasConflicts: true,
      highBlastRadiusPaths: [],
    },
    answers: {
      rebase_before_merge_queue: 0.01,
      full_test_matrix_required: 0.01,
    },
  });

  assert.equal(result.rebase.status, 'REQUIRED');
  assert.equal(result.rebase.source, 'deterministic');
});

test('does not require a rebase when the branch includes the base', () => {
  const result = routeAssessment({
    facts: {
      baseResolved: true,
      behind: 0,
      hasConflicts: false,
      highBlastRadiusPaths: [],
    },
    answers: {
      rebase_before_merge_queue: 0.99,
      full_test_matrix_required: 0.01,
    },
  });

  assert.equal(result.rebase.status, 'NOT_REQUIRED');
  assert.equal(result.rebase.source, 'deterministic');
});

test('routes Noul values in the uncertainty band to human review', () => {
  const result = routeAssessment({
    facts: {
      baseResolved: true,
      behind: 1,
      hasConflicts: false,
      highBlastRadiusPaths: [],
    },
    answers: {
      rebase_before_merge_queue: 0.5,
      full_test_matrix_required: 0.5,
    },
  });

  assert.equal(result.rebase.status, 'REVIEW_REQUIRED');
  assert.equal(result.fullTest.status, 'REVIEW_REQUIRED');
});

test('blocks an invalid Noul answer instead of treating it as a skip', () => {
  const result = routeAssessment({
    facts: {
      baseResolved: true,
      behind: 1,
      hasConflicts: false,
      highBlastRadiusPaths: [],
    },
    answers: {
      rebase_before_merge_queue: Number.NaN,
      full_test_matrix_required: undefined,
    },
  });

  assert.equal(result.rebase.status, 'BLOCKED');
  assert.equal(result.fullTest.status, 'BLOCKED');
});

test('requires the full matrix when a high-blast-radius path changes', () => {
  const result = routeAssessment({
    facts: {
      baseResolved: true,
      behind: 1,
      hasConflicts: false,
      highBlastRadiusPaths: ['pnpm-lock.yaml'],
    },
    answers: {
      rebase_before_merge_queue: 0.01,
      full_test_matrix_required: 0.01,
    },
  });

  assert.equal(result.fullTest.status, 'REQUIRED');
  assert.equal(result.fullTest.source, 'deterministic');
});

test('uses caller supplied thresholds', () => {
  const result = routeAssessment({
    facts: {
      baseResolved: true,
      behind: 1,
      hasConflicts: false,
      highBlastRadiusPaths: [],
    },
    answers: {
      rebase_before_merge_queue: 0.7,
      full_test_matrix_required: 0.3,
    },
    thresholds: { required: 0.7, notRequired: 0.3 },
  });

  assert.equal(result.rebase.status, 'REQUIRED');
  assert.equal(result.fullTest.status, 'NOT_REQUIRED');
});
