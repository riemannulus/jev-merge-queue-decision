const DEFAULT_THRESHOLDS = Object.freeze({
  required: 0.8,
  notRequired: 0.2,
});

export function routeAssessment({ facts = {}, answers = {}, thresholds = DEFAULT_THRESHOLDS }) {
  const policy = validateThresholds(thresholds);

  if (!facts.baseResolved) {
    return blockedAssessment('The base ref could not be resolved.');
  }

  return {
    rebase: routeRebase(facts, answers.rebase_before_merge_queue, policy),
    fullTest: routeFullTest(facts, answers.full_test_matrix_required, policy),
  };
}

function routeRebase(facts, answer, thresholds) {
  if (facts.behind === 0 && isNoul(answer)) {
    return deterministic('NOT_REQUIRED', 'The branch already includes every commit from the base ref.');
  }

  if (facts.virtualMergeAvailable === false) {
    return blocked('Virtual merge evidence is unavailable for a branch that is behind the base ref.');
  }

  if (facts.hasConflicts) {
    return deterministic('REQUIRED', 'A virtual merge with the base ref reports conflicts.');
  }

  return routeNoul(answer, thresholds, 'Jev rebase assessment is unavailable or invalid.');
}

function routeFullTest(facts, answer, thresholds) {
  if (Array.isArray(facts.highBlastRadiusPaths) && facts.highBlastRadiusPaths.length > 0) {
    return deterministic(
      'REQUIRED',
      `High-blast-radius paths changed: ${facts.highBlastRadiusPaths.join(', ')}.`,
    );
  }

  return routeNoul(answer, thresholds, 'Jev full-test assessment is unavailable or invalid.');
}

function routeNoul(answer, thresholds, blockedReason) {
  if (!isNoul(answer)) {
    return blocked(blockedReason);
  }

  if (answer >= thresholds.required) {
    return jev('REQUIRED', answer);
  }

  if (answer <= thresholds.notRequired) {
    return jev('NOT_REQUIRED', answer);
  }

  return jev('REVIEW_REQUIRED', answer);
}

function blockedAssessment(reason) {
  return {
    rebase: blocked(reason),
    fullTest: blocked(reason),
  };
}

function deterministic(status, reason) {
  return { status, source: 'deterministic', reason };
}

function jev(status, probability) {
  return {
    status,
    source: 'jev',
    probability,
    reason: `Jev returned probability ${probability}.`,
  };
}

function blocked(reason) {
  return { status: 'BLOCKED', source: 'system', reason };
}

function isNoul(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateThresholds(thresholds) {
  const required = thresholds?.required;
  const notRequired = thresholds?.notRequired;

  if (
    !Number.isFinite(required)
    || !Number.isFinite(notRequired)
    || notRequired < 0
    || required > 1
    || notRequired >= required
  ) {
    throw new RangeError('Thresholds must satisfy 0 <= notRequired < required <= 1.');
  }

  return { required, notRequired };
}
