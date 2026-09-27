#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assessDeployJobsGate,
  deployJobsGateFailureMessage,
} from './deploy-jobs-gate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipBuild = args.has('--skip-build');
const skipPdfBrowser = args.has('--skip-pdf-browser');
const requireBaseUrl = args.has('--require-base-url');
const runSeed = process.env.DEPLOY_SMOKE_RUN_SEED === 'true';
const baseUrl =
  process.env.DEPLOY_SMOKE_BASE_URL ||
  process.env.E2E_BASE_URL ||
  '';

function localBin(name) {
  return join(root, 'node_modules', '.bin', name);
}

function info(message) {
  console.log(`[deploy-smoke] ${message}`);
}

function fail(message) {
  console.error(`[deploy-smoke] ${message}`);
  process.exit(1);
}

function run(label, command, commandArgs, options = {}) {
  info(label);
  if (dryRun) {
    console.log(`  ${command} ${commandArgs.join(' ')}`);
    return;
  }
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

async function checkPdfBrowser() {
  info('checking Puppeteer PDF browser');
  if (dryRun) {
    console.log('  import puppeteer and launch headless browser');
    return;
  }
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
  });
  await browser.close();
}

function checkNotificationMode() {
  info('checking notification mock-mode environment');
  const value = process.env.NOTIFICATION_MOCK_MODE;
  if (process.env.NODE_ENV === 'production' && value !== 'false') {
    fail('production smoke requires NOTIFICATION_MOCK_MODE=false');
  }
  if (process.env.NODE_ENV !== 'production' && value === 'false') {
    info('NOTIFICATION_MOCK_MODE=false in non-production; real webhooks may be called');
  } else {
    info(`NOTIFICATION_MOCK_MODE=${value ?? '(default)'}`);
  }
}

function checkBackgroundJobsMode() {
  info('checking background jobs mode');
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.BACKGROUND_JOBS_MODE === 'inline'
  ) {
    fail('production smoke refuses BACKGROUND_JOBS_MODE=inline');
  }
}

async function request(path, init = {}) {
  const url = new URL(path, baseUrl);
  return fetch(url, {
    redirect: 'manual',
    ...init,
  });
}

async function checkRoutes() {
  if (!baseUrl) {
    if (requireBaseUrl) fail('DEPLOY_SMOKE_BASE_URL or E2E_BASE_URL is required');
    info('skipping route checks because DEPLOY_SMOKE_BASE_URL is not set');
    return;
  }

  info(`checking routes at ${baseUrl}`);

  const login = await request('/login');
  if (login.status !== 200) {
    fail(`/login expected 200, got ${login.status}`);
  }

  const live = await request('/api/health/live');
  if (live.status !== 200) fail(`/api/health/live expected 200, got ${live.status}`);

  const ready = await request('/api/health/ready');
  if (ready.status !== 200) {
    fail(`/api/health/ready expected 200, got ${ready.status}`);
  }
  if (process.env.NODE_ENV === 'production') {
    const body = await ready.json();
    if (!['ok', 'degraded'].includes(body.status) || body.db !== 'ok') {
      fail(
        `/api/health/ready returned unhealthy body: ${JSON.stringify(body)}`,
      );
    }
  }

  // 历史非通知死信仍只告警，不能让前向迁移后的新版无法发布。
  // 机器人鉴权/连接所有权故障不会自愈，是通知功能的发布门禁。
  const jobsProbe = await request('/api/health/jobs');
  let jobsBody;
  try {
    jobsBody = await jobsProbe.json();
  } catch {
    fail('/api/health/jobs returned invalid JSON');
  }
  const jobsGate = assessDeployJobsGate(jobsBody, {
    runtimeEnvironment: process.env.NODE_ENV,
  });
  if (!jobsGate.ok || !jobsGate.ready) {
    fail(`/api/health/jobs ${deployJobsGateFailureMessage(jobsGate)}`);
  }
  if (jobsProbe.status === 200) {
    info('/api/health/jobs ok');
  } else {
    info(
      `WARNING: /api/health/jobs returned ${jobsProbe.status}; 队列需要人工处理: ${JSON.stringify(jobsBody)}`,
    );
  }

  const protectedRoute = await request('/owner/pigsty');
  const location = protectedRoute.headers.get('location') ?? '';
  if (
    ![302, 303, 307, 308].includes(protectedRoute.status) ||
    !location.includes('/login')
  ) {
    fail(
      `/owner/pigsty expected redirect to /login, got ${protectedRoute.status} ${location}`,
    );
  }

  const cron = await request('/api/cron/daily-salary', {
    method: 'POST',
    headers: {
      authorization: 'Bearer deploy-smoke-invalid-secret',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  const expectedCronStatuses = process.env.NODE_ENV === 'production' ? [401] : [401, 503];
  if (!expectedCronStatuses.includes(cron.status)) {
    fail(`/api/cron/daily-salary invalid auth expected ${expectedCronStatuses.join(' or ')}, got ${cron.status}`);
  }
}

function ensureNodeModules() {
  if (!existsSync(localBin('prisma'))) {
    fail('node_modules/.bin/prisma missing; run pnpm install first');
  }
}

// Read-only: invalid concurrent indexes cannot arbitrate ON CONFLICT.
export async function checkInvalidIndexes(client) {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS index_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT i.indisvalid
    ORDER BY n.nspname, c.relname
  `);
  if (rows.length) {
    throw new Error(`invalid indexes: ${rows.map((row) =>
      `${row.schema_name}.${row.index_name}${row.index_name === 'NotificationLog_deliveryKey_channelId_key' ? ' (notification dedupe dependency)' : ''}`,
    ).join(', ')}`);
  }
}

async function checkDatabaseIndexes() {
  info('checking all database indexes are valid');
  if (dryRun) return;
  // Match Prisma CLI dotenv loading without overriding operator environment.
  await import('dotenv/config');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  try {
    await client.connect();
    await checkInvalidIndexes(client);
  } finally {
    await client.end();
  }
}

async function main() {
  ensureNodeModules();
  run('prisma validate', localBin('prisma'), ['validate']);
  run('prisma migrate status', localBin('prisma'), ['migrate', 'status']);
  await checkDatabaseIndexes();

  if (runSeed) {
    run('prisma db seed', localBin('prisma'), ['db', 'seed']);
  } else {
    info('skipping prisma db seed; set DEPLOY_SMOKE_RUN_SEED=true for local smoke');
  }

  checkNotificationMode();
  checkBackgroundJobsMode();

  if (!skipPdfBrowser) {
    await checkPdfBrowser();
  } else {
    info('skipping Puppeteer PDF browser check');
  }

  if (!skipBuild) {
    run('next build', localBin('next'), ['build']);
  } else {
    info('skipping next build');
  }

  await checkRoutes();
  info('completed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
