import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assessDeployJobsGate } from '../deploy-jobs-gate.mjs';

function smartBot(
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    status,
    required: true,
    configurationValid: true,
    identityMatch: true,
    operational: status === 'CONNECTED',
    ...overrides,
  };
}

function inlineHealth() {
  return {
    status: 'ok', mode: 'inline', time: '2026-09-10T00:00:00.000Z',
    jobs: { pending: { LIGHT: 0, HEAVY: 0 }, running: 0,
      staleRunning: 0, deadLast24h: 0, deadNotificationLast24h: 0 },
    smartBot: { status: null, required: false, configurationValid: true,
      identityMatch: null, operational: true, recoveryWaitMs: 0 },
    alerts: [], warnings: [],
  };
}

describe('deploy jobs health gate', () => {
  it.each([
    { mode: 'durable' }, { mode: undefined }, { status: 'error' },
    { time: undefined }, { time: 'invalid' }, { jobs: undefined },
    { jobs: { ...inlineHealth().jobs, pending: { LIGHT: 0 } } },
    { jobs: { ...inlineHealth().jobs, running: -1 } },
    { alerts: undefined }, { warnings: {} }, { alerts: ['smart-bot-auth-failed'] },
    { warnings: ['unreviewed-warning'] },
    ...Object.keys(inlineHealth().smartBot).map((field) => ({
      smartBot: { ...inlineHealth().smartBot, [field]: undefined },
    })),
    { smartBot: { ...inlineHealth().smartBot, required: true } },
    { smartBot: { ...inlineHealth().smartBot, configurationValid: false } },
    { smartBot: { ...inlineHealth().smartBot, identityMatch: false } },
    { smartBot: { ...inlineHealth().smartBot, operational: false } },
    { smartBot: { ...inlineHealth().smartBot, recoveryWaitMs: 100 } },
  ])('rejects incomplete or inconsistent optional inline null health %#', (overrides) => {
    expect(assessDeployJobsGate({ ...inlineHealth(), ...overrides }, {
      runtimeEnvironment: 'development',
    })).toMatchObject({ ok: false, ready: false });
  });

  it.each(['development', 'test'])('CLI accepts explicit %s inline health as NOT_REQUIRED', async (environment) => {
    const result = await runGateCli(JSON.stringify(inlineHealth()), ['--status-only'], {
      NODE_ENV: environment,
    });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('NOT_REQUIRED');
  });

  it('CLI rejects inline null health under production even when the body says ok', async () => {
    const result = await runGateCli(JSON.stringify(inlineHealth()), ['--status-only'], {
      NODE_ENV: 'production',
    });
    expect(result.code).toBe(2);
    expect(result.stdout).not.toContain('NOT_REQUIRED');
  });

  it.each(['AUTH_FAILED', 'CONNECTION_CONFLICT'])(
    'blocks the non-self-healing smart-bot state %s',
    (status) => {
      expect(
        assessDeployJobsGate({
          status: 'alert',
          smartBot: smartBot(status),
          alerts: ['an-actionable-alert'],
        }),
      ).toEqual({
        ok: false,
        ready: false,
        reason: 'smart-bot-fatal',
        status,
        required: true,
      });
    },
  );

  it('does not turn an unrelated historical queue alert into a release blocker', () => {
    expect(
      assessDeployJobsGate({
        status: 'alert',
        smartBot: smartBot('CONNECTED'),
        alerts: ['dead-jobs-last-24h'],
      }),
    ).toEqual({
      ok: true,
      ready: true,
      reason: null,
      status: 'CONNECTED',
      required: true,
    });
  });

  it.each(['CONNECTING', 'DISCONNECTED'])(
    'observes but does not accept required transient state %s',
    (status) => {
      expect(assessDeployJobsGate({ smartBot: smartBot(status) })).toEqual({
        ok: true,
        ready: false,
        reason: 'smart-bot-not-ready',
        status,
        required: true,
      });
    },
  );

  it('immediately blocks NOT_CONFIGURED when an active destination requires the connector', () => {
    expect(
      assessDeployJobsGate({ smartBot: smartBot('NOT_CONFIGURED') }),
    ).toEqual({
      ok: false,
      ready: false,
      reason: 'smart-bot-required-not-configured',
      status: 'NOT_CONFIGURED',
      required: true,
    });
  });

  it('accepts an optional unconfigured connector', () => {
    expect(
      assessDeployJobsGate({
        smartBot: smartBot('NOT_CONFIGURED', {
          required: false,
          identityMatch: null,
          operational: true,
        }),
      }),
    ).toEqual({
      ok: true,
      ready: true,
      reason: null,
      status: 'NOT_CONFIGURED',
      required: false,
    });
  });

  it.each([
    ['configurationValid', false, 'smart-bot-channel-invalid'],
    ['identityMatch', false, 'smart-bot-identity-mismatch'],
  ] as const)('blocks required %s=false', (field, value, reason) => {
    expect(
      assessDeployJobsGate({
        smartBot: smartBot('CONNECTED', {
          [field]: value,
          operational: false,
        }),
      }),
    ).toEqual({
      ok: false,
      ready: false,
      reason,
      status: 'CONNECTED',
      required: true,
    });
  });

  it('waits while a required matching identity has not published a heartbeat yet', () => {
    expect(
      assessDeployJobsGate({
        smartBot: smartBot('CONNECTING', {
          identityMatch: null,
          operational: false,
        }),
      }),
    ).toEqual({
      ok: true,
      ready: false,
      reason: 'smart-bot-not-ready',
      status: 'CONNECTING',
      required: true,
    });
  });

  it.each([
    {},
    { smartBot: {} },
    { smartBot: { status: 'A_FUTURE_UNREVIEWED_STATUS' } },
  ])('fails closed when smart-bot health is not observable', (body) => {
    expect(assessDeployJobsGate(body)).toEqual({
      ok: false,
      ready: false,
      reason: 'smart-bot-status-unavailable',
      status: null,
      required: null,
    });
  });

  it('CLI exits non-zero for a fatal status without echoing the response body', async () => {
    const response = JSON.stringify({
      status: 'alert',
      smartBot: smartBot('AUTH_FAILED'),
      internal: 'must-not-be-printed',
    });
    const result = await runGateCli(response);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('AUTH_FAILED');
    expect(result.stderr).not.toContain('must-not-be-printed');
  });

  it('CLI distinguishes an unreadable probe so the deploy script can retry it', async () => {
    const result = await runGateCli('<html>upstream error</html>');

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('not valid JSON');
  });

  it.each([
    [smartBot('CONNECTED'), 'CONNECTED'],
    [smartBot('DISCONNECTED'), 'WAITING_DISCONNECTED'],
    [
      smartBot('NOT_CONFIGURED', {
        required: false,
        identityMatch: null,
        operational: true,
      }),
      'NOT_REQUIRED',
    ],
  ])('CLI emits the bounded deploy-loop token %#', async (state, token) => {
    const result = await runGateCli(
      JSON.stringify({ smartBot: state }),
      ['--status-only'],
    );

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(token);
    expect(result.stderr).toBe('');
  });

  it('CLI treats an observed identity mismatch as immediately actionable', async () => {
    const result = await runGateCli(
      JSON.stringify({
        smartBot: smartBot('CONNECTED', {
          identityMatch: false,
          operational: false,
        }),
      }),
      ['--status-only'],
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('identity');
  });

  it('CLI validates default wait configuration without probing a server', async () => {
    const result = await runGateCli('', ['--check-config', 'http://127.0.0.1:1/api/health/jobs']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('wait configuration accepted');
    expect(result.stderr).toBe('');
  });

  it.each(['120', '240', '601'])('CLI rejects unsafe explicit hard limit %s before deployment', async (limit) => {
    const result = await runGateCli('', ['--check-config', 'http://127.0.0.1:1/api/health/jobs'], {
      DEPLOY_JOBS_GATE_MAX_SECONDS: limit,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('invalid wait configuration');
  });
});

function runGateCli(
  input: string,
  args: string[] = [],
  env: Record<string, string> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [resolve('scripts/deploy-jobs-gate.mjs'), ...args],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectRun);
    child.once('close', (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}
