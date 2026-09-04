#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KNOWN_SMART_BOT_STATUSES = new Set([
  'NOT_CONFIGURED',
  'CONNECTING',
  'CONNECTED',
  'DISCONNECTED',
  'AUTH_FAILED',
  'CONNECTION_CONFLICT',
]);

const FATAL_SMART_BOT_STATUSES = new Set([
  'AUTH_FAILED',
  'CONNECTION_CONFLICT',
]);

/**
 * The jobs endpoint can legitimately be 503 because of an old non-notification
 * dead letter or a stale job. Those conditions stay visible to operators, but
 * must not make a forward-only migration release impossible. Smart-bot auth
 * and ownership failures are different: a newly deployed notification
 * transport cannot work until an operator intervenes, so they fail the gate.
 * A required connector that is still reconnecting is observable but not ready;
 * update.sh may wait for it only within its bounded observation window.
 */
export function assessDeployJobsGate(body) {
  const smartBot = body?.smartBot;
  const status = smartBot?.status;
  if (
    typeof status !== 'string' ||
    !KNOWN_SMART_BOT_STATUSES.has(status) ||
    typeof smartBot?.required !== 'boolean' ||
    typeof smartBot?.configurationValid !== 'boolean' ||
    (smartBot.identityMatch !== null &&
      typeof smartBot.identityMatch !== 'boolean') ||
    typeof smartBot?.operational !== 'boolean'
  ) {
    return {
      ok: false,
      ready: false,
      reason: 'smart-bot-status-unavailable',
      status: null,
      required: null,
    };
  }
  if (FATAL_SMART_BOT_STATUSES.has(status)) {
    return {
      ok: false,
      ready: false,
      reason: 'smart-bot-fatal',
      status,
      required: smartBot.required,
    };
  }
  if (smartBot.required && !smartBot.configurationValid) {
    return {
      ok: false,
      ready: false,
      reason: 'smart-bot-channel-invalid',
      status,
      required: true,
    };
  }
  if (smartBot.required && smartBot.identityMatch === false) {
    return {
      ok: false,
      ready: false,
      reason: 'smart-bot-identity-mismatch',
      status,
      required: true,
    };
  }
  if (smartBot.required && status === 'NOT_CONFIGURED') {
    return {
      ok: false,
      ready: false,
      reason: 'smart-bot-required-not-configured',
      status,
      required: true,
    };
  }
  const ready =
    !smartBot.required ||
    (status === 'CONNECTED' && smartBot.operational === true);
  return {
    ok: true,
    ready,
    reason: ready ? null : 'smart-bot-not-ready',
    status,
    required: smartBot.required,
  };
}

export function deployJobsGateFailureMessage(assessment) {
  if (assessment.reason === 'smart-bot-fatal') {
    return `enterprise WeChat smart-bot is not operational: ${assessment.status}`;
  }
  if (assessment.reason === 'smart-bot-channel-invalid') {
    return 'active enterprise WeChat smart-bot destination is incomplete';
  }
  if (assessment.reason === 'smart-bot-identity-mismatch') {
    return 'enterprise WeChat smart-bot identity does not match the active destination';
  }
  if (assessment.reason === 'smart-bot-required-not-configured') {
    return 'an active enterprise WeChat smart-bot destination requires configured credentials';
  }
  if (assessment.reason === 'smart-bot-not-ready') {
    return `required enterprise WeChat smart-bot is not connected: ${assessment.status}`;
  }
  return 'jobs health response did not expose a recognized smart-bot status';
}

async function runCli() {
  const statusOnly = process.argv.includes('--status-only');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    console.error('[deploy-jobs-gate] jobs health response was not valid JSON');
    process.exitCode = 2;
    return;
  }

  const assessment = assessDeployJobsGate(body);
  if (!assessment.ok) {
    console.error(
      `[deploy-jobs-gate] ${deployJobsGateFailureMessage(assessment)}`,
    );
    process.exitCode =
      assessment.reason === 'smart-bot-status-unavailable' ? 2 : 1;
    return;
  }
  if (statusOnly) {
    console.log(
      !assessment.required
        ? 'NOT_REQUIRED'
        : assessment.ready
          ? 'CONNECTED'
          : `WAITING_${assessment.status}`,
    );
    return;
  }
  if (!assessment.ready) {
    console.log(
      `[deploy-jobs-gate] ${deployJobsGateFailureMessage(assessment)}`,
    );
    return;
  }
  console.log(
    `[deploy-jobs-gate] smart-bot status accepted: ${assessment.status}`,
  );
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entrypoint === import.meta.url) await runCli();
