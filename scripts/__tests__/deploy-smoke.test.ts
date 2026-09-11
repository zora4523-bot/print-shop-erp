import { spawn } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

describe('production deploy smoke jobs gate', () => {
  it.each([401, 503])('accepts local inline optional null health with cron %s', async (cronStatus) => {
    const result = await runSmokeWithJobs({
      statusCode: 200, body: inlineHealth(), cronStatus,
      environment: 'development', mode: 'inline',
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[deploy-smoke] completed');
  });

  it('rejects production optional null health even when the remote body says inline', async () => {
    const result = await runSmokeWithJobs({ statusCode: 200, body: inlineHealth() });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('recognized smart-bot status');
  });

  it.each(['heavy-worker-missing', 'light-worker-version-mismatch'])(
    'rejects production %s even when ready is healthy and the bot is connected', async (alert) => {
      const result = await runSmokeWithJobs({
        statusCode: 503, body: { mode: 'durable', alerts: [alert],
          smartBot: { status: 'CONNECTED', required: true,
            configurationValid: true, identityMatch: true, operational: true } },
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('required background worker');
    },
  );

  it.each([200, 403, 500])('rejects unexpected production cron status %s', async (cronStatus) => {
    const result = await runSmokeWithJobs({
      statusCode: 200,
      body: { smartBot: { status: 'CONNECTED', required: true,
        configurationValid: true, identityMatch: true, operational: true } },
      cronStatus,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`invalid auth expected 401, got ${cronStatus}`);
  });

  it('rejects missing production cron configuration instead of accepting a 503', async () => {
    const result = await runSmokeWithJobs({
      statusCode: 200,
      body: { smartBot: { status: 'CONNECTED', required: true,
        configurationValid: true, identityMatch: true, operational: true } },
      cronStatus: 503,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('invalid auth expected 401, got 503');
    expect(result.stdout).not.toContain('[deploy-smoke] completed');
  });

  it.each([
    { smartBotStatus: 'AUTH_FAILED', statusCode: 200 },
    { smartBotStatus: 'CONNECTION_CONFLICT', statusCode: 200 },
  ])(
    'fails when the smart-bot reports $smartBotStatus over HTTP $statusCode',
    async ({ smartBotStatus, statusCode }) => {
      const result = await runSmokeWithJobs({
        statusCode,
        body: {
          status: 'alert',
          smartBot: {
            status: smartBotStatus,
            required: true,
            configurationValid: true,
            identityMatch: true,
            operational: false,
          },
          alerts: ['smart-bot-auth-failed'],
          warnings: [],
        },
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(smartBotStatus);
      expect(result.stdout).not.toContain('[deploy-smoke] completed');
    },
  );

  it('keeps an unrelated historical queue alert as a warning', async () => {
    const result = await runSmokeWithJobs({
      statusCode: 503,
      body: {
        status: 'alert',
        smartBot: {
          status: 'CONNECTED',
          required: true,
          configurationValid: true,
          identityMatch: true,
          operational: true,
        },
        alerts: ['dead-jobs-last-24h'],
        warnings: [],
      },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('WARNING: /api/health/jobs returned 503');
    expect(result.stdout).toContain('[deploy-smoke] completed');
  });

  it('fails while a required connector remains disconnected', async () => {
    const result = await runSmokeWithJobs({
      statusCode: 200,
      body: {
        status: 'degraded',
        smartBot: {
          status: 'DISCONNECTED',
          required: true,
          configurationValid: true,
          identityMatch: true,
          operational: false,
        },
        alerts: [],
        warnings: ['smart-bot-disconnected'],
      },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('DISCONNECTED');
    expect(result.stdout).not.toContain('[deploy-smoke] completed');
  });
});

function inlineHealth() {
  return {
    status: 'ok', mode: 'inline', time: '2026-09-10T00:00:00.000Z',
    jobs: { pending: { LIGHT: 0, HEAVY: 0 }, running: 0, staleRunning: 0,
      deadLast24h: 0, deadNotificationLast24h: 0 },
    smartBot: { status: null, required: false, configurationValid: true,
      identityMatch: null, operational: true, recoveryWaitMs: 0 },
    alerts: [], warnings: [],
  };
}

async function runSmokeWithJobs(input: {
  statusCode: number;
  body: Record<string, unknown>;
  cronStatus?: number;
  environment?: 'production' | 'development';
  mode?: 'inline' | 'durable';
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const server = createServer((request, response) => {
    switch (request.url) {
      case '/login':
      case '/api/health/live':
        response.statusCode = 200;
        response.end('ok');
        return;
      case '/api/health/ready':
        writeJson(response, 200, { status: 'ok', db: 'ok' });
        return;
      case '/api/health/jobs':
        writeJson(response, input.statusCode, input.body);
        return;
      case '/owner/pigsty':
        response.statusCode = 307;
        response.setHeader('location', '/login');
        response.end();
        return;
      case '/api/cron/daily-salary':
        response.statusCode = input.cronStatus ?? 401;
        response.end('unauthorized');
        return;
      default:
        response.statusCode = 404;
        response.end('not found');
    }
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    await close(server);
    throw new Error('test server did not expose a TCP port');
  }

  try {
    return await runSmoke(`http://127.0.0.1:${address.port}`, input);
  } finally {
    await close(server);
  }
}

function runSmoke(
  baseUrl: string,
  options: { environment?: 'production' | 'development'; mode?: 'inline' | 'durable' },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [
        'scripts/deploy-smoke.mjs',
        '--dry-run',
        '--skip-build',
        '--skip-pdf-browser',
        '--require-base-url',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: options.environment ?? 'production',
          NOTIFICATION_MOCK_MODE: options.environment === 'development' ? 'true' : 'false',
          BACKGROUND_JOBS_MODE: options.mode ?? 'durable',
          DEPLOY_SMOKE_BASE_URL: baseUrl,
          DEPLOY_SMOKE_RUN_SEED: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
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
  });
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function listen(server: Server): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}
