#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { collectGitEvidence } from '../lib/git-evidence.mjs';
import { routeAssessment } from '../lib/policy.mjs';
import { evaluateWithJev, parseNoulAnswers } from '../lib/typesafe.mjs';

const DEFAULTS = Object.freeze({
  base: 'origin/develop',
  notRequiredThreshold: 0.2,
  requiredThreshold: 0.8,
});

main().catch((error) => {
  const assessment = blockedAssessment(`Unexpected error: ${safeMessage(error)}`);
  process.stdout.write(`${JSON.stringify(assessment)}\n`);
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const diagnostics = [];
  let evidence;

  try {
    evidence = collectGitEvidence(options);
  } catch (error) {
    evidence = unresolvedEvidence(options.base);
    diagnostics.push(`Git evidence collection failed: ${safeMessage(error)}`);
  }

  let answers = {};
  let model = null;
  let usage = null;

  if (evidence.baseResolved) {
    try {
      const result = await getJevResult(options, evidence);
      answers = result.answers;
      model = result.model;
      usage = result.usage;
    } catch (error) {
      diagnostics.push(`Jev evaluation unavailable: ${safeMessage(error)}`);
    }
  }

  const routed = routeAssessment({
    facts: evidence,
    answers,
    thresholds: {
      required: options.requiredThreshold,
      notRequired: options.notRequiredThreshold,
    },
  });
  const assessment = {
    schemaVersion: 1,
    thresholds: {
      required: options.requiredThreshold,
      notRequired: options.notRequiredThreshold,
    },
    evidence,
    model,
    usage,
    diagnostics,
    ...routed,
  };

  process.stdout.write(`${JSON.stringify(assessment)}\n`);
  if (assessment.rebase.status === 'BLOCKED' || assessment.fullTest.status === 'BLOCKED') {
    process.exitCode = 1;
  }
}

async function getJevResult(options, evidence) {
  if (options.responseFile) {
    const body = await readFile(options.responseFile, 'utf8');
    const payload = JSON.parse(body);
    return {
      answers: parseNoulAnswers(payload),
      model: typeof payload.model === 'string' ? payload.model : null,
      usage: payload.usage ?? null,
    };
  }

  return evaluateWithJev({
    state: evidence,
    apiKey: process.env.TYPESAFE_API_KEY,
  });
}

function parseOptions(arguments_) {
  const options = {
    repo: process.cwd(),
    base: DEFAULTS.base,
    refresh: false,
    responseFile: null,
    requiredThreshold: DEFAULTS.requiredThreshold,
    notRequiredThreshold: DEFAULTS.notRequiredThreshold,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--json') continue;
    if (argument === '--refresh') {
      options.refresh = true;
      continue;
    }

    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${argument} requires a value.`);
    }

    if (argument === '--repo') options.repo = resolve(value);
    else if (argument === '--base') options.base = value;
    else if (argument === '--response-file') options.responseFile = resolve(value);
    else if (argument === '--required-threshold') options.requiredThreshold = Number(value);
    else if (argument === '--not-required-threshold') options.notRequiredThreshold = Number(value);
    else throw new Error(`Unknown option: ${argument}`);
    index += 1;
  }

  return options;
}

function unresolvedEvidence(base) {
  return {
    base,
    baseResolved: false,
    changedPaths: [],
    changedPathsTruncated: false,
    diffStat: [],
    diffStatTruncated: false,
    freshness: 'unknown',
    hasConflicts: false,
    highBlastRadiusPaths: [],
    virtualMergeAvailable: false,
  };
}

function blockedAssessment(reason) {
  const decision = { status: 'BLOCKED', source: 'system', reason };
  return {
    schemaVersion: 1,
    thresholds: {
      required: DEFAULTS.requiredThreshold,
      notRequired: DEFAULTS.notRequiredThreshold,
    },
    evidence: unresolvedEvidence(DEFAULTS.base),
    model: null,
    usage: null,
    diagnostics: [reason],
    rebase: decision,
    fullTest: decision,
  };
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
