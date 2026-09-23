import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNoulAnswers } from '../lib/typesafe.mjs';

test('rejects a malformed TypeSafe response instead of manufacturing a low-risk answer', () => {
  assert.throws(
    () => parseNoulAnswers({ answers: { rebase_before_merge_queue: { type: 'noul', noul: 0.01 } } }),
    /full_test_matrix_required/,
  );
});

test('returns the two named Noul values from a valid TypeSafe response', () => {
  const answers = parseNoulAnswers({
    answers: {
      rebase_before_merge_queue: { type: 'noul', noul: 0.81 },
      full_test_matrix_required: { type: 'noul', noul: 0.19 },
    },
  });

  assert.deepEqual(answers, {
    rebase_before_merge_queue: 0.81,
    full_test_matrix_required: 0.19,
  });
});
