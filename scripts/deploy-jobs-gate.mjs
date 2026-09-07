#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  WORKER_HEARTBEAT_ACTIVE_WINDOW_MS,
  WORKER_HEARTBEAT_MAX_INTERVAL_MS,
} from '../lib/background-jobs/heartbeat-timing.mjs';

const DEFAULT_STARTUP_BUDGET_MS = 120_000;
const DEFAULT_HARD_LIMIT_MS = 600_000;
const DEFAULT_SETTLE_MS = 6_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const PROBE_TIMEOUT_MS = 5_000;

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

function positiveDuration(value, fallback, name) {
  const duration = value ?? fallback;
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 86_400_000) {
    throw new TypeError(`invalid deploy gate duration: ${name}`);
  }
  return duration;
}

/** @param {{ startupBudgetMs?: number, recoveryBudgetMs?: number, hardLimitMs?: number, intervalMs?: number, settleMs?: number }} options */
function resolveWaitBudgets(options) {
  const intervalMs = positiveDuration(options.intervalMs, DEFAULT_POLL_INTERVAL_MS, 'interval');
  const settleMs = positiveDuration(options.settleMs, DEFAULT_SETTLE_MS, 'settle');
  const startupBudgetMs = positiveDuration(options.startupBudgetMs, DEFAULT_STARTUP_BUDGET_MS, 'startup');
  const minimumRecoveryMs = WORKER_HEARTBEAT_ACTIVE_WINDOW_MS +
    WORKER_HEARTBEAT_MAX_INTERVAL_MS + settleMs + 2 * intervalMs + 4 * PROBE_TIMEOUT_MS;
  const recoveryBudgetMs = positiveDuration(options.recoveryBudgetMs, minimumRecoveryMs, 'recovery');
  const hardLimitMs = positiveDuration(options.hardLimitMs, DEFAULT_HARD_LIMIT_MS, 'hard limit');
  if (recoveryBudgetMs < minimumRecoveryMs ||
      hardLimitMs < Math.max(startupBudgetMs, recoveryBudgetMs) ||
      hardLimitMs > DEFAULT_HARD_LIMIT_MS) {
    throw new TypeError('deploy gate budgets do not cover bounded heartbeat recovery');
  }
  return { intervalMs, settleMs, startupBudgetMs, recoveryBudgetMs, hardLimitMs };
}

/**
 * A relative hint uses the DB clock; deadlines use one monotonic local clock.
 * The hint can extend observation but cannot turn a duplicate into readiness.
 * The default recovery budget is 180s expiry + 60s heartbeat + 6s settle +
 * 24s request/poll margin = 270s. Continuous restarts hit the 600s hard limit.
 *
 * @param {{
 *   readHealth: (options: { timeoutMs: number }) => Promise<unknown>,
 *   nowMs?: () => number,
 *   sleep?: (durationMs: number) => Promise<void>,
 *   startupBudgetMs?: number,
 *   recoveryBudgetMs?: number,
 *   hardLimitMs?: number,
 *   intervalMs?: number,
 *   settleMs?: number
 * }} options
 */
export async function waitForDeployJobsGate(options) {
  const now = options.nowMs ?? (() => performance.now());
  const pause = options.sleep ?? sleep;
  const { intervalMs, settleMs, startupBudgetMs, recoveryBudgetMs, hardLimitMs } = resolveWaitBudgets(options);
  const recoveryTailMs = recoveryBudgetMs - WORKER_HEARTBEAT_ACTIVE_WINDOW_MS;
  const startedAt = now();
  const hardDeadline = startedAt + hardLimitMs;
  let deadline = startedAt + startupBudgetMs;
  let recoveryStarted = false;
  let connectedSince = null;
  let lastAssessment = assessDeployJobsGate(null);
  const finish = (ok, reason) => ({
    ok, reason, status: lastAssessment.status,
    elapsedMs: Math.max(0, now() - startedAt),
  });
  const timeout = () => finish(false, now() >= hardDeadline
    ? 'hard-timeout' : recoveryStarted ? 'recovery-timeout' : 'startup-timeout');

  while (now() < Math.min(deadline, hardDeadline)) {
    let body;
    try {
      body = await options.readHealth({
        timeoutMs: Math.max(1, Math.ceil(Math.min(PROBE_TIMEOUT_MS, deadline - now(), hardDeadline - now()))),
      });
    } catch {
      // Network/JSON errors are unobservable, not evidence of a new recovery
      // episode. They cannot continually reset either deadline.
      body = null;
    }
    const observedAt = now();
    if (observedAt >= Math.min(deadline, hardDeadline)) return timeout();
    const assessment = assessDeployJobsGate(body);
    lastAssessment = assessment;
    if (!assessment.ok && assessment.reason !== 'smart-bot-status-unavailable') {
      return finish(false, assessment.reason);
    }
    if (assessment.ok && assessment.ready) {
      if (!assessment.required) return finish(true, null);
      connectedSince ??= observedAt;
      if (observedAt - connectedSince >= settleMs) return finish(true, null);
      // A first CONNECTED sample near the startup boundary still needs a full
      // stable interval; accepting it immediately would hide a connection kick.
      deadline = Math.max(deadline, connectedSince + settleMs + intervalMs);
    } else {
      connectedSince = null;
      const smartBot = body?.smartBot;
      if (assessment.ok && smartBot?.configurationValid && smartBot.identityMatch === true) {
        if (!recoveryStarted) {
          recoveryStarted = true;
          deadline = Math.max(deadline, observedAt + recoveryBudgetMs);
        }
        const waitMs = smartBot.recoveryWaitMs;
        if (Number.isSafeInteger(waitMs) && waitMs > 0 && waitMs <= WORKER_HEARTBEAT_ACTIVE_WINDOW_MS) {
          // The decreasing hint for an unchanged stale row preserves its
          // expiry boundary. A newly refreshed extra row grants limited grace;
          // two live workers can extend only as far as hardDeadline.
          deadline = Math.max(deadline, observedAt + waitMs + recoveryTailMs);
        }
      }
    }
    await pause(Math.max(0, Math.min(intervalMs, deadline - now(), hardDeadline - now())));
  }
  return timeout();
}

function envDuration(key) {
  const value = process.env[key];
  return value === undefined ? undefined : Number(value) * 1_000;
}

async function runWaitCli(target, checkOnly = false) {
  try {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new TypeError('invalid jobs health URL');
    }
    const budgets = resolveWaitBudgets({
      startupBudgetMs: envDuration('DEPLOY_JOBS_GATE_STARTUP_SECONDS'),
      recoveryBudgetMs: envDuration('DEPLOY_JOBS_GATE_RECOVERY_SECONDS'),
      hardLimitMs: envDuration('DEPLOY_JOBS_GATE_MAX_SECONDS'),
      intervalMs: envDuration('DEPLOY_JOBS_GATE_INTERVAL_SECONDS'),
      settleMs: envDuration('DEPLOY_JOBS_GATE_CONNECTED_SETTLE_SECONDS'),
    });
    if (checkOnly) {
      console.log('[deploy-jobs-gate] wait configuration accepted');
      return;
    }
    const result = await waitForDeployJobsGate({
      readHealth: async ({ timeoutMs }) => {
        // Read JSON even on 503: unrelated historical queue alerts do not
        // invalidate a healthy connector. Bound headers AND response-body I/O.
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return response.json();
      },
      ...budgets,
    });
    if (result.ok) {
      console.log(`[deploy-jobs-gate] stable connector accepted: ${result.status}`);
    } else {
      console.error(`[deploy-jobs-gate] rejected: ${result.reason}; status=${result.status}; elapsed=${Math.ceil(result.elapsedMs / 1_000)}s`);
      process.exitCode = 1;
    }
  } catch {
    console.error('[deploy-jobs-gate] invalid wait configuration');
    process.exitCode = 2;
  }
}

async function runCli() {
  const checkIndex = process.argv.indexOf('--check-config');
  if (checkIndex !== -1) {
    await runWaitCli(process.argv[checkIndex + 1], true);
    return;
  }
  const waitIndex = process.argv.indexOf('--wait');
  if (waitIndex !== -1) {
    await runWaitCli(process.argv[waitIndex + 1]);
    return;
  }
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
