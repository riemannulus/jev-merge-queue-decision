const QUESTION_IDS = Object.freeze({
  rebase: 'rebase_before_merge_queue',
  fullTest: 'full_test_matrix_required',
});

export class TypeSafeResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TypeSafeResponseError';
  }
}

export async function evaluateWithJev({ state, apiKey, fetchImpl = fetch, timeoutMs = 15_000 }) {
  if (!apiKey) {
    throw new TypeSafeResponseError('TYPESAFE_API_KEY is required unless --response-file is supplied.');
  }

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeSafeResponseError('TypeSafe timeout must be a positive integer in milliseconds.');
  }

  const signal = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'jev-latest',
        state,
        questions: questions(),
      }),
      signal,
    });
  } catch {
    if (signal.aborted) {
      throw new TypeSafeResponseError(`TypeSafe request timed out after ${timeoutMs}ms.`);
    }

    throw new TypeSafeResponseError('TypeSafe request failed before receiving a response.');
  }

  if (!response.ok) {
    throw new TypeSafeResponseError(`TypeSafe returned HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TypeSafeResponseError('TypeSafe returned invalid JSON.');
  }

  return {
    answers: parseNoulAnswers(payload),
    model: typeof payload.model === 'string' ? payload.model : null,
    usage: isPlainObject(payload.usage) ? payload.usage : null,
  };
}

export function parseNoulAnswers(payload) {
  const answers = payload?.answers;
  if (!isPlainObject(answers)) {
    throw new TypeSafeResponseError('Jev response is missing its answers object.');
  }

  return {
    [QUESTION_IDS.rebase]: readNoul(answers, QUESTION_IDS.rebase),
    [QUESTION_IDS.fullTest]: readNoul(answers, QUESTION_IDS.fullTest),
  };
}

function questions() {
  return {
    [QUESTION_IDS.rebase]: {
      type: 'noul',
      instructions: {
        question: 'Given the Git evidence in the state, is rebasing this branch onto the named base necessary before merge-queue admission?',
        trueMeans: 'Rebasing materially reduces integration, build, or test risk before the branch enters the merge queue.',
        falseMeans: 'The evidence does not show a material reason to rebase before merge-queue admission.',
        boundary: 'Use only the supplied state. Do not infer missing Git facts or execute an action.',
      },
      criteria: {
        true: 'A rebase is warranted before the branch enters the merge queue.',
        false: 'A rebase is not warranted before the branch enters the merge queue.',
      },
    },
    [QUESTION_IDS.fullTest]: {
      type: 'noul',
      instructions: {
        question: 'Given the Git evidence in the state, is the repository-wide test matrix required rather than focused validation?',
        trueMeans: 'The change is cross-cutting or risky enough that focused checks could miss a regression.',
        falseMeans: 'The supplied change scope is narrow and isolated enough that focused validation is sufficient.',
        boundary: 'Use only the supplied state. Do not infer policy not represented by the evidence.',
      },
      criteria: {
        true: 'The complete repository test matrix is required.',
        false: 'Focused validation is sufficient; the complete matrix is not required.',
      },
    },
  };
}

function readNoul(answers, id) {
  const answer = answers[id];
  if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
    throw new TypeSafeResponseError(`Jev response has no valid Noul answer for ${id}.`);
  }

  return answer.noul;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
