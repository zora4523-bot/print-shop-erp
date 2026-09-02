import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const warningFragment =
  'Calling client.query() when the client is already executing a query';
const probePrefix = '__PG_WARNING_PROBE__';
const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;

type ProbeResult = {
  rows: number;
  total: number;
  fixtureFound: boolean;
  targetWarnings: string[];
};

databaseDescribe('admin workspace PostgreSQL transaction integration', () => {
  it('loads the real workspace without overlapping queries on its pg client', async () => {
    const result = await runProbe();

    expect(result.code, result.stderr).toBe(0);
    const payloadLine = result.stdout
      .split('\n')
      .find((line) => line.startsWith(probePrefix));
    expect(payloadLine, result.stdout).toBeDefined();
    const payload = JSON.parse(
      payloadLine!.slice(probePrefix.length),
    ) as ProbeResult;

    expect(payload.fixtureFound).toBe(true);
    expect(payload.rows).toBe(1);
    expect(payload.total).toBe(1);
    expect(payload.targetWarnings).toEqual([]);
    expect(result.stderr).not.toContain(warningFragment);
  }, 15_000);
});

function runProbe(): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolveRun, rejectRun) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      NODE_OPTIONS: '--conditions=react-server --trace-deprecation',
      FORCE_COLOR: '0',
    };
    delete env.NODE_NO_WARNINGS;

    const child = spawn(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        resolve(
          'lib/order/__tests__/fixtures/admin-workspace-pg-warning-probe.ts',
        ),
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
    }, 10_000);
    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimers();
      rejectRun(error);
    });
    child.once('close', (code) => {
      clearTimers();
      if (timedOut) {
        rejectRun(new Error('PostgreSQL warning probe timed out after 10s'));
        return;
      }
      resolveRun({ code, stdout, stderr });
    });
  });
}
