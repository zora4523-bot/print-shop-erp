#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import pg from 'pg';

export function devProcesses(mode, args = []) {
  const web = { name: 'web', args: ['node_modules/next/dist/bin/next', 'dev', ...args] };
  return mode === 'durable' ? [
    { name: 'LIGHT', args: ['--conditions=react-server', '--import', 'tsx', 'scripts/background-worker.ts', '--queue=LIGHT'] },
    { name: 'HEAVY', args: ['--import', 'tsx', 'scripts/background-worker.ts', '--queue=HEAVY'] }, web,
  ] : [web];
}

export async function startDevStack(args = process.argv.slice(2)) {
  if (process.env.NODE_ENV === 'production') throw new Error('DEV_REQUIRES_DEVELOPMENT');
  loadEnvConfig(process.cwd(), true);
  const mode = process.env.BACKGROUND_JOBS_MODE || 'durable';
  if (!['durable', 'inline'].includes(mode)) throw new Error('INVALID_BACKGROUND_MODE');
  const portFlag = args.findIndex((arg) => arg === '--port' || arg === '-p');
  const port = Number(portFlag >= 0 ? args[portFlag + 1] : process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  const hostnameFlag = args.findIndex((arg) => arg === '--hostname' || arg === '-H');
  const host = hostnameFlag >= 0 ? args[hostnameFlag + 1] : '127.0.0.1';
  await checkPort(port, host);
  const version = `dev-${randomUUID()}`;
  const env = { ...process.env, NODE_ENV: 'development', BACKGROUND_JOBS_MODE: mode, APP_VERSION: version, NOTIFICATION_MOCK_MODE: 'true' };
  const children = [];
  let stopping = false;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 30_000);
    timer.unref();
  }
  process.once('SIGINT', () => stop());
  process.once('SIGTERM', () => stop());
  function launch(config) {
    if (stopping) return;
    const child = spawn(process.execPath, config.args, { stdio: 'inherit', env });
    children.push(child);
    child.once('error', () => { console.error(`[dev] ${config.name} failed to start`); stop(1); });
    child.once('exit', () => {
      if (!stopping) { console.error(`[dev] ${config.name} stopped; shutting down stack`); stop(1); }
    });
    return child;
  }
  try {
    const configs = devProcesses(mode, [...args, ...(portFlag < 0 ? ['--port', String(port)] : []), ...(hostnameFlag < 0 ? ['--hostname', host] : [])]);
    if (mode === 'durable') {
      for (const config of configs.slice(0, -1)) launch(config);
      await waitForWorkers(env, () => stopping);
    } else {
      await new Promise((resolveCheck, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/pdf-check.ts'], { stdio: 'inherit', env });
        children.push(child);
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolveCheck() : reject(new Error('PDF_PREFLIGHT_FAILED')));
      });
    }
    if (!stopping) {
      console.info(`[dev] ${mode} dependencies ready; notifications mocked`);
      launch(configs.at(-1));
    }
  } catch (error) { stop(1); throw error; }
}

async function waitForWorkers(env, stopped) {
  const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    // Heartbeat columns contain UTC wall time, matching databasePoolConfig.
    // Do not inherit the operator/database default time zone for comparisons.
    await client.query("SET TIME ZONE 'UTC'");
    const deadline = Date.now() + 60_000;
    while (!stopped() && Date.now() < deadline) {
      const result = await client.query('SELECT DISTINCT queue FROM "BackgroundWorkerHeartbeat" WHERE version = $1 AND (queue != \'HEAVY\' OR "pdfReady" IS TRUE) AND "lastSeenAt" > now() - interval \'30 seconds\'', [env.APP_VERSION]);
      if (result.rows.some((row) => row.queue === 'LIGHT') && result.rows.some((row) => row.queue === 'HEAVY')) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    throw new Error('DEV_WORKERS_NOT_READY');
  } finally { await client.end(); }
}
async function checkPort(port, host) {
  await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port, host, exclusive: true }, () => server.close(resolvePort));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startDevStack().catch((error) => { console.error('[dev] startup failed:', error.code || error.message); process.exitCode = 1; });
}
