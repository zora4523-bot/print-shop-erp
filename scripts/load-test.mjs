#!/usr/bin/env node

import { chromium } from '@playwright/test';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_DENIED_HOSTS = new Set(['bag.sshapi.cn']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MUTATING_SCENARIOS = new Set(['pdf']);

const { scenario, options } = parseCli(process.argv.slice(2));

if (
  !scenario ||
  scenario === 'help' ||
  scenario === '--help' ||
  options.has('help')
) {
  printHelp();
  process.exit(0);
}

if (options.has('formal') && options.has('smoke')) {
  throw new Error('Choose either --formal or --smoke, not both');
}
const executionMode = options.has('formal') ? 'formal' : 'smoke';
const preflight =
  executionMode === 'formal' ? await loadFormalPreflight() : null;

const baseUrl = new URL(
  option('base-url') ?? process.env.LOAD_TEST_BASE_URL ?? DEFAULT_BASE_URL,
);
baseUrl.pathname = '/';
baseUrl.search = '';
baseUrl.hash = '';

assertSafeTarget(baseUrl, scenario);
await assertTargetIsLive(baseUrl);

let readSessions = null;
let auth;
if (scenario === 'read' && executionMode === 'formal') {
  readSessions = await loginRoleSessions(baseUrl);
  auth = {
    role: 'MIXED',
    sessionCount: readSessions.length,
    roleMix: countBy(readSessions, (session) => session.role),
  };
} else {
  auth = await loginAndGetCookie(baseUrl, credentialsFor(baseUrl));
}
const runId = `load-${new Date().toISOString().replaceAll(/[-:.TZ]/g, '')}-${randomBytes(4).toString('hex')}`;
const commonHeaders = {
  ...(auth.cookie ? { cookie: auth.cookie } : {}),
  'user-agent': 'print-shop-erp-load-test/1.0',
  'x-load-test-run-id': runId,
};

const startedAt = new Date();
let result;

switch (scenario) {
  case 'read':
    result = await runReadScenario(baseUrl, commonHeaders, readSessions);
    break;
  case 'pdf':
    result = await runPdfScenario(baseUrl, commonHeaders);
    break;
  case 'salary-export':
    result = await runSalaryExportScenario(baseUrl, commonHeaders);
    break;
  default:
    throw new Error(`Unknown scenario: ${scenario}`);
}

const report = {
  schemaVersion: 1,
  runId,
  scenario,
  executionMode,
  capacityAssessment: {
    valid: executionMode === 'formal' && result.thresholds?.passed === true,
    scope:
      scenario === 'read'
        ? executionMode === 'formal'
          ? '28 independent authenticated sessions with the 20+3+5 role mix'
          : 'authenticated single-session HTTP baseline; excludes the 20+3+5 role mix'
        : scenario,
    reason:
      executionMode === 'formal'
        ? result.thresholds?.passed === true
          ? 'strict preflight and scenario thresholds passed'
          : 'one or more scenario thresholds failed'
        : 'smoke mode validates the path only; it is not capacity evidence',
  },
  auth: {
    role: auth.role,
    sessionCount: auth.sessionCount ?? 1,
    ...(auth.roleMix ? { roleMix: auth.roleMix } : {}),
  },
  target: {
    origin: baseUrl.origin,
    remote: !LOCAL_HOSTS.has(baseUrl.hostname),
  },
  loadGenerator: {
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    node: process.version,
  },
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  result,
  ...(preflight
    ? {
        preflight: {
          checkedAt: preflight.checkedAt,
          reportPath: resolve(requiredOption('preflight-report')),
        },
      }
    : {}),
};

const outputPath = resolve(
  option('output') ??
    `test-results/load/${scenario}-${startedAt.toISOString().replaceAll(/[:.]/g, '-')}.json`,
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(report, null, 2));
console.error(`Load-test report: ${outputPath}`);

if (result.unexpectedErrors > 0) process.exitCode = 1;
if (result.thresholds?.passed === false) process.exitCode = 1;

function parseCli(argv) {
  const [name, ...rest] = argv;
  const parsed = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const equal = token.indexOf('=');
    if (equal >= 0) {
      addOption(parsed, token.slice(2, equal), token.slice(equal + 1));
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      addOption(parsed, key, next);
      index += 1;
    } else {
      addOption(parsed, key, 'true');
    }
  }
  return { scenario: name, options: parsed };
}

function addOption(map, key, value) {
  const current = map.get(key);
  if (current === undefined) map.set(key, value);
  else if (Array.isArray(current)) current.push(value);
  else map.set(key, [current, value]);
}

function option(name, fallback) {
  const value = options.get(name);
  if (Array.isArray(value)) return value.at(-1);
  return value ?? fallback;
}

function allOptions(name) {
  const value = options.get(name);
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function positiveNumber(name, fallback) {
  const raw = option(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return value;
}

function positiveInteger(name, fallback) {
  const value = positiveNumber(name, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`--${name} must be an integer`);
  }
  return value;
}

function assertSafeTarget(url, selectedScenario) {
  const denied = new Set([
    ...DEFAULT_DENIED_HOSTS,
    ...(process.env.LOAD_TEST_DENY_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  ]);
  if (denied.has(url.hostname)) {
    throw new Error(`Refusing to load-test denied host ${url.hostname}`);
  }

  const local = LOCAL_HOSTS.has(url.hostname);
  if (!local) {
    if (url.protocol !== 'https:') {
      throw new Error('Remote load-test targets must use HTTPS');
    }
    const expectedAck = `staging:${url.hostname}`;
    if (process.env.LOAD_TEST_REMOTE_ACK !== expectedAck) {
      throw new Error(
        `Remote target requires LOAD_TEST_REMOTE_ACK=${expectedAck}`,
      );
    }
  }

  if (MUTATING_SCENARIOS.has(selectedScenario)) {
    const expectedAck = `mutate:${url.hostname}`;
    if (process.env.LOAD_TEST_MUTATION_ACK !== expectedAck) {
      throw new Error(
        `Scenario ${selectedScenario} writes jobs/artifacts and requires ` +
          `LOAD_TEST_MUTATION_ACK=${expectedAck}`,
      );
    }
  }
}

async function assertTargetIsLive(url) {
  const response = await fetch(new URL('/api/health/live', url), {
    signal: AbortSignal.timeout(5_000),
    redirect: 'manual',
  });
  if (response.status !== 200) {
    throw new Error(`Target liveness returned HTTP ${response.status}`);
  }
  const live = await response.json();
  if (live?.status !== 'ok') throw new Error('Target liveness body is not ok');
  if (executionMode === 'formal' && (!live.version || live.version === 'dev')) {
    throw new Error('Formal load test requires a non-dev APP_VERSION');
  }

  if (executionMode === 'formal') {
    const readyResponse = await fetch(new URL('/api/health/ready', url), {
      signal: AbortSignal.timeout(5_000),
      redirect: 'manual',
    });
    const ready = await readyResponse.json();
    if (
      readyResponse.status !== 200 ||
      ready?.status !== 'ok' ||
      ready?.db !== 'ok'
    ) {
      throw new Error(`Target readiness failed with HTTP ${readyResponse.status}`);
    }
  }
}

function credentialsFor(url) {
  const local = LOCAL_HOSTS.has(url.hostname);
  const username =
    process.env.LOAD_TEST_USERNAME ?? (local ? 'e2e-owner' : undefined);
  const password =
    process.env.LOAD_TEST_PASSWORD ??
    (local ? 'e2e-test-password-1234' : undefined);
  if (!username || !password) {
    throw new Error(
      'Set LOAD_TEST_USERNAME and LOAD_TEST_PASSWORD for the staging account',
    );
  }
  return { username, password };
}

async function loginAndGetCookie(url, credentials) {
  const browser = await chromium.launch({ headless: true });
  try {
    return await loginWithBrowser(browser, url, credentials, 0);
  } finally {
    await browser.close();
  }
}

async function loginRoleSessions(url) {
  const credentialsPath = resolve(requiredOption('credentials-file'));
  const fileStat = await stat(credentialsPath);
  if ((fileStat.mode & 0o077) !== 0) {
    throw new Error('Credentials file must not be readable or writable by group/others; run chmod 600');
  }
  const parsed = JSON.parse(await readFile(credentialsPath, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length !== 28) {
    throw new Error('Formal read requires exactly 28 credential entries');
  }
  const usernames = new Set();
  for (const credential of parsed) {
    if (
      typeof credential?.username !== 'string' ||
      !credential.username ||
      typeof credential?.password !== 'string' ||
      !credential.password
    ) {
      throw new Error('Every credential entry requires non-empty username and password');
    }
    if (usernames.has(credential.username)) {
      throw new Error('Credential usernames must be unique');
    }
    usernames.add(credential.username);
  }

  const browser = await chromium.launch({ headless: true });
  const sessions = [];
  const burst = positiveInteger('login-burst', 6);
  const spacingMs = positiveNumber('login-spacing-ms', 6_000);
  try {
    for (let index = 0; index < parsed.length; index += 1) {
      if (index >= burst) await delay(spacingMs);
      const session = await loginWithBrowser(
        browser,
        url,
        parsed[index],
        index,
      );
      sessions.push({
        cookie: session.cookie,
        role: session.role,
        paths: rolePaths(session.role, parsed[index].paths),
      });
    }
  } finally {
    await browser.close();
  }

  const roles = countBy(sessions, (session) => session.role);
  const salesCs = roles.SALES ?? 0;
  if (salesCs !== 20 || roles.ADMIN !== 3 || roles.WORKER !== 5) {
    throw new Error(
      `Formal role mix must be SALES=20, ADMIN=3, WORKER=5; received ${JSON.stringify(roles)}`,
    );
  }
  return sessions;
}

async function loginWithBrowser(browser, url, credentials, ipIndex) {
  const context = await browser.newContext({
    baseURL: url.origin,
    extraHTTPHeaders: { 'x-real-ip': documentationIp(ipIndex) },
  });
  try {
    const page = await context.newPage();
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.locator('#username').fill(credentials.username);
    await page.locator('#password').fill(credentials.password);
    await page.getByRole('button', { name: /登录|登 录/ }).click();
    await page.waitForURL((next) => !next.pathname.startsWith('/login'), {
      timeout: 15_000,
    });
    const cookies = await context.cookies(url.origin);
    if (cookies.length === 0) throw new Error('Login produced no session cookie');
    const sessionResponse = await context.request.get('/api/auth/session');
    if (sessionResponse.status() !== 200) {
      throw new Error(`Session verification returned HTTP ${sessionResponse.status()}`);
    }
    const session = await sessionResponse.json();
    if (!session?.user?.id || !session.user.role) {
      throw new Error('Session verification returned no authenticated user/role');
    }
    return {
      cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; '),
      role: session.user.role,
    };
  } finally {
    await context.close();
  }
}

function rolePaths(role, configuredPaths) {
  const defaults = {
    ADMIN: ['/owner', '/orders'],
    SALES: ['/orders'],
    WORKER: ['/worker'],
  };
  const paths = configuredPaths ?? defaults[role];
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error(`No read paths configured for role ${role}`);
  }
  for (const path of paths) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      throw new Error('Credential paths must start with one / and remain local');
    }
  }
  return paths;
}

async function runReadScenario(url, headers, sessions) {
  const concurrency = positiveInteger('concurrency', 28);
  const durationSeconds = positiveNumber('duration-seconds', 60);
  const thinkMs = positiveNumber('think-ms', 1_000);
  const timeoutMs = positiveNumber('timeout-ms', 15_000);
  const paths = (option('paths', '/orders,/owner') ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
  if (paths.length === 0) throw new Error('--paths must not be empty');
  for (const path of paths) {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new Error('--paths entries must start with one / and remain local');
    }
  }
  const requestUrls = paths.map((path) => sameOriginUrl(path, url, '--paths entry'));
  if (executionMode === 'formal') {
    if (concurrency !== 28) {
      throw new Error('Formal read baseline requires --concurrency 28');
    }
    if (durationSeconds < 900) {
      throw new Error('Formal read baseline requires at least 900 seconds');
    }
    if (!sessions || sessions.length !== concurrency) {
      throw new Error('Formal read baseline requires one authenticated session per user');
    }
  }

  const workerTargets = sessions
    ? sessions.map((session) => ({
        cookie: session.cookie,
        role: session.role,
        urls: session.paths.map((path) =>
          sameOriginUrl(path, url, 'credential path'),
        ),
      }))
    : Array.from({ length: concurrency }, () => ({
        cookie: headers.cookie,
        role: 'SHARED',
        urls: requestUrls,
      }));

  const deadline = performance.now() + durationSeconds * 1_000;
  const samples = [];
  await Promise.all(
    Array.from({ length: concurrency }, (_, worker) =>
      (async () => {
        const target = workerTargets[worker];
        let sequence = worker;
        while (performance.now() < deadline) {
          const requestUrl = target.urls[sequence % target.urls.length];
          const sample = await timedFetch(requestUrl, {
            headers: {
              ...headers,
              cookie: target.cookie,
              accept: 'text/html,application/xhtml+xml',
              'x-real-ip': documentationIp(worker + 1),
            },
            timeoutMs,
          });
          if (
            sample.status === 200 &&
            !sample.contentType.includes('text/html')
          ) {
            sample.error = `unexpected content type: ${sample.contentType || '(missing)'}`;
          }
          sample.role = target.role;
          samples.push(sample);
          sequence += 1;
          await delay(jitter(thinkMs, 0.25));
        }
      })(),
    ),
  );

  return summarizeHttpSamples(samples, {
    concurrency,
    durationSeconds,
    paths:
      sessions === null
        ? paths
        : Object.fromEntries(
            Object.entries(countByRolePaths(sessions)).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          ),
    roleMix: sessions
      ? countBy(sessions, (session) => session.role)
      : { SHARED: concurrency },
    p95LimitMs: positiveNumber('p95-ms', 2_000),
  });
}

async function runSalaryExportScenario(url, headers) {
  const concurrency = positiveInteger('concurrency', 1);
  const timeoutMs = positiveNumber('timeout-ms', 120_000);
  const from = requiredOption('from');
  const to = requiredOption('to');
  const workerId = option('worker-id');
  const coverageDays = inclusiveDateSpanDays(from, to);
  if (executionMode === 'formal' && coverageDays < 180) {
    throw new Error('Formal salary export requires a date range of at least 180 days');
  }
  const requestUrl = new URL('/api/salary/piecework/export', url);
  requestUrl.searchParams.set('from', from);
  requestUrl.searchParams.set('to', to);
  if (workerId) requestUrl.searchParams.set('workerId', workerId);

  const samples = await Promise.all(
    Array.from({ length: concurrency }, (_, worker) =>
      timedFetch(requestUrl, {
        headers: {
          ...headers,
          accept:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'x-real-ip': documentationIp(worker + 1),
        },
        timeoutMs,
      }),
    ),
  );

  for (const sample of samples) {
    if (
      sample.status === 200 &&
      (!sample.contentType.includes(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ) ||
        sample.bodyHexPrefix !== '504b0304')
    ) {
      sample.error = 'invalid XLSX response';
    }
  }

  return summarizeHttpSamples(samples, {
    concurrency,
    durationSeconds: null,
    paths: [requestUrl.pathname],
    from,
    to,
    coverageDays,
    workerId: workerId ?? null,
    p95LimitMs: positiveNumber('p95-ms', 10_000),
  });
}

async function runPdfScenario(url, headers) {
  const orderInput = await loadOrderIds();
  const orderIds = orderInput.orderIds;
  const ratePerHour = positiveNumber('rate-per-hour', 1_000 / 3);
  const durationSeconds = positiveNumber('duration-seconds', 60);
  const completionTimeoutMs = positiveNumber(
    'completion-timeout-ms',
    15 * 60_000,
  );
  const requestedCount = Math.ceil((ratePerHour * durationSeconds) / 3_600);
  if (executionMode === 'formal') {
    if (durationSeconds < 10_800) {
      throw new Error('Formal PDF capacity test requires at least 10800 seconds');
    }
    if (requestedCount < 1_000) {
      throw new Error('Formal PDF capacity test requires at least 1000 PDFs');
    }
    if (orderIds.length < requestedCount) {
      throw new Error(
        `Formal PDF test requires ${requestedCount} unique order ids; received ${orderIds.length}`,
      );
    }
  }
  const count = Math.min(requestedCount, orderIds.length);
  if (count === 0) throw new Error('No order ids available for PDF scenario');
  if (orderIds.length < requestedCount) {
    console.error(
      `PDF scenario shortened to ${count} unique orders; ${requestedCount} required for full duration`,
    );
  }

  const intervalMs = 3_600_000 / ratePerHour;
  const runStarted = performance.now();
  const healthSamples = [await readJobHealth(url)];
  let stopHealthPolling = false;
  const healthPoll = (async () => {
    while (!stopHealthPolling) {
      await delay(5_000);
      if (!stopHealthPolling) healthSamples.push(await readJobHealth(url));
    }
  })();

  const jobs = Array.from({ length: count }, async (_, index) => {
    const scheduledAt = runStarted + index * intervalMs;
    const wait = scheduledAt - performance.now();
    if (wait > 0) await delay(wait);
    const scheduleDelayMs = Math.max(0, performance.now() - scheduledAt);
    const sample = await fetchPdfUntilComplete(
      new URL(`/api/orders/${encodeURIComponent(orderIds[index])}/pdf`, url),
      {
        headers: {
          ...headers,
          accept: 'application/pdf,text/html;q=0.9',
          'x-real-ip': documentationIp((index % 60) + 1),
        },
        timeoutMs: completionTimeoutMs,
      },
    );
    return { ...sample, scheduleDelayMs };
  });

  const samples = await Promise.all(jobs);
  stopHealthPolling = true;
  await healthPoll;
  healthSamples.push(await readJobHealth(url));

  const summary = summarizePdfSamples(samples);
  const healthSummary = summarizeHealth(healthSamples);
  return {
    ...summary,
    configured: {
      ratePerHour,
      durationSeconds,
      requestedCount,
      executedCount: count,
      inputOrderIds: orderInput.inputCount,
      duplicateOrderIdsRemoved: orderInput.duplicateCount,
      uniqueOrders: true,
      completeSchedule: count === requestedCount,
      scheduledDurationSeconds:
        count <= 1 ? 0 : ((count - 1) * intervalMs) / 1_000,
    },
    jobHealth: healthSummary,
    thresholds: {
      meanCompletionLimitMs: positiveNumber('mean-ms', 8_300),
      passed:
        count === requestedCount &&
        summary.unexpectedErrors === 0 &&
        (executionMode !== 'formal' || healthSummary.formalReady) &&
        summary.completionLatencyMs.mean <= positiveNumber('mean-ms', 8_300),
    },
  };
}

async function loadOrderIds() {
  const inline = allOptions('order-id').map((value) => value.trim());
  const file = option('order-ids-file');
  let fromFile = [];
  if (file) {
    const text = await readFile(resolve(file), 'utf8');
    fromFile = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  }
  const input = [...inline.filter(Boolean), ...fromFile];
  const orderIds = [...new Set(input)];
  return {
    orderIds,
    inputCount: input.length,
    duplicateCount: input.length - orderIds.length,
  };
}

async function fetchPdfUntilComplete(initialUrl, { headers, timeoutMs }) {
  const started = performance.now();
  let currentUrl = initialUrl;
  let attempts = 0;
  const attemptStatuses = [];
  let firstResponseMs = null;
  while (performance.now() - started < timeoutMs) {
    attempts += 1;
    const sample = await timedFetch(currentUrl, {
      headers,
      timeoutMs: Math.min(30_000, timeoutMs),
    });
    attemptStatuses.push(sample.status);
    if (firstResponseMs === null) firstResponseMs = sample.durationMs;
    if (
      sample.status === 200 &&
      sample.contentType.includes('application/pdf') &&
      sample.bodyPrefix === '%PDF-'
    ) {
      return {
        status: 200,
        attempts,
        attemptStatuses,
        firstResponseMs,
        completionMs: performance.now() - started,
        bytes: sample.bytes,
        error: null,
      };
    }
    if (sample.status === 200) {
      return {
        status: 200,
        attempts,
        attemptStatuses,
        firstResponseMs,
        completionMs: performance.now() - started,
        bytes: sample.bytes,
        error: sample.contentType.includes('application/pdf')
          ? 'invalid PDF signature'
          : `unexpected content type: ${sample.contentType || '(missing)'}`,
      };
    }
    if (sample.status !== 202) {
      return {
        status: sample.status,
        attempts,
        attemptStatuses,
        firstResponseMs,
        completionMs: performance.now() - started,
        bytes: sample.bytes,
        error: sample.error ?? `HTTP ${sample.status}`,
      };
    }
    const retry = retryTarget(sample.headers, currentUrl);
    if (retry.url.origin !== initialUrl.origin) {
      return {
        status: 0,
        attempts,
        attemptStatuses,
        firstResponseMs,
        completionMs: performance.now() - started,
        bytes: sample.bytes,
        error: `cross-origin retry refused: ${retry.url.origin}`,
      };
    }
    currentUrl = retry.url;
    await delay(retry.delayMs);
  }
  return {
    status: 0,
    attempts,
    attemptStatuses,
    firstResponseMs,
    completionMs: performance.now() - started,
    bytes: 0,
    error: 'completion timeout',
  };
}

function retryTarget(headers, currentUrl) {
  const refresh = headers.refresh;
  const match = refresh?.match(/^\s*(\d+)\s*;\s*url=(.+)\s*$/i);
  if (match) {
    return {
      delayMs: Math.max(250, Number(match[1]) * 1_000),
      url: new URL(match[2], currentUrl),
    };
  }
  const retryAfter = Number(headers['retry-after']);
  return {
    delayMs: Number.isFinite(retryAfter) ? retryAfter * 1_000 : 5_000,
    url: currentUrl,
  };
}

async function timedFetch(url, { headers, timeoutMs }) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers,
      // Redirects are observable failures for these authenticated endpoints.
      // Following them could hide a session expiry as a fast login-page 200.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.arrayBuffer();
    const bodyPrefix = new TextDecoder('ascii').decode(body.slice(0, 5));
    const bodyHexPrefix = Buffer.from(body.slice(0, 4)).toString('hex');
    return {
      url: url.pathname,
      status: response.status,
      durationMs: performance.now() - started,
      bytes: body.byteLength,
      bodyPrefix,
      bodyHexPrefix,
      contentType: response.headers.get('content-type') ?? '',
      headers: Object.fromEntries(response.headers.entries()),
      error: null,
    };
  } catch (error) {
    return {
      url: url.pathname,
      status: 0,
      durationMs: performance.now() - started,
      bytes: 0,
      bodyPrefix: '',
      bodyHexPrefix: '',
      contentType: '',
      headers: {},
      error: error instanceof Error ? error.name : String(error),
    };
  }
}

async function readJobHealth(url) {
  const at = new Date().toISOString();
  try {
    const response = await fetch(new URL('/api/health/jobs', url), {
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.json();
    return { at, status: response.status, body };
  } catch (error) {
    return {
      at,
      status: 0,
      error: error instanceof Error ? error.name : String(error),
    };
  }
}

function summarizeHttpSamples(samples, configured) {
  const latencyMs = distribution(samples.map((sample) => sample.durationMs));
  const statuses = countBy(samples, (sample) => String(sample.status));
  const unexpectedErrors = samples.filter(
    (sample) => sample.status !== 200 || sample.error !== null,
  ).length;
  return {
    requests: samples.length,
    bytes: samples.reduce((sum, sample) => sum + sample.bytes, 0),
    statuses,
    unexpectedErrors,
    latencyMs,
    requestsPerSecond:
      configured.durationSeconds === null
        ? null
        : round(samples.length / configured.durationSeconds),
    byPath: summarizeHttpByPath(samples),
    byRole: summarizeHttpGroups(samples, (sample) => sample.role ?? 'UNKNOWN'),
    errors: countBy(
      samples.filter((sample) => sample.error),
      (sample) => sample.error,
    ),
    configured,
    thresholds: {
      p95LimitMs: configured.p95LimitMs,
      passed: unexpectedErrors === 0 && latencyMs.p95 <= configured.p95LimitMs,
    },
  };
}

function summarizePdfSamples(samples) {
  const completed = samples.filter(
    (sample) => sample.status === 200 && sample.error === null,
  ).length;
  const unexpectedErrors = samples.length - completed;
  return {
    requests: samples.length,
    completed,
    unexpectedErrors,
    statuses: countBy(samples, (sample) => String(sample.status)),
    httpAttempts: samples.reduce((sum, sample) => sum + sample.attempts, 0),
    attemptStatuses: countBy(
      samples.flatMap((sample) => sample.attemptStatuses),
      (status) => String(status),
    ),
    firstResponseLatencyMs: distribution(
      samples.map((sample) => sample.firstResponseMs ?? sample.completionMs),
    ),
    completionLatencyMs: distribution(
      samples.map((sample) => sample.completionMs),
    ),
    totalBytes: samples.reduce((sum, sample) => sum + sample.bytes, 0),
    maxAttempts: Math.max(0, ...samples.map((sample) => sample.attempts)),
    schedulingDelayMs: distribution(
      samples.map((sample) => sample.scheduleDelayMs),
    ),
    errors: countBy(
      samples.filter((sample) => sample.error),
      (sample) => sample.error,
    ),
  };
}

function summarizeHealth(samples) {
  const successful = samples.filter(
    (sample) => sample.status === 200 && sample.body,
  );
  const modes = countBy(successful, (sample) => sample.body.mode ?? '(missing)');
  const maxPendingLight = Math.max(
    0,
    ...successful.map((sample) => sample.body.jobs?.pending?.LIGHT ?? 0),
  );
  const maxPendingHeavy = Math.max(
    0,
    ...successful.map((sample) => sample.body.jobs?.pending?.HEAVY ?? 0),
  );
  const maxRunning = Math.max(
    0,
    ...successful.map((sample) => sample.body.jobs?.running ?? 0),
  );
  const maxStaleRunning = Math.max(
    0,
    ...successful.map((sample) => sample.body.jobs?.staleRunning ?? 0),
  );
  const maxDeadLast24h = Math.max(
    0,
    ...successful.map((sample) => sample.body.jobs?.deadLast24h ?? 0),
  );
  const alertSamples = successful.filter(
    (sample) => (sample.body.alerts?.length ?? 0) > 0,
  ).length;
  const warningSamples = successful.filter(
    (sample) => (sample.body.warnings?.length ?? 0) > 0,
  ).length;
  const first = samples.at(0) ?? null;
  const last = samples.at(-1) ?? null;
  const baselineClear =
    first?.status === 200 &&
    (first.body?.jobs?.pending?.HEAVY ?? -1) === 0 &&
    (first.body?.jobs?.running ?? -1) === 0;
  const finalDrained =
    last?.status === 200 &&
    (last.body?.jobs?.pending?.HEAVY ?? -1) === 0 &&
    (last.body?.jobs?.running ?? -1) === 0;
  const formalReady =
    samples.length > 0 &&
    successful.length === samples.length &&
    Object.keys(modes).length === 1 &&
    modes.durable === samples.length &&
    maxStaleRunning === 0 &&
    maxDeadLast24h === 0 &&
    alertSamples === 0 &&
    warningSamples === 0 &&
    baselineClear &&
    finalDrained;
  return {
    samples: samples.length,
    statuses: countBy(samples, (sample) => String(sample.status)),
    modes,
    maxPending: { LIGHT: maxPendingLight, HEAVY: maxPendingHeavy },
    maxRunning,
    maxStaleRunning,
    maxDeadLast24h,
    alertSamples,
    warningSamples,
    baselineClear,
    finalDrained,
    formalReady,
    first,
    last,
  };
}

function summarizeHttpByPath(samples) {
  return summarizeHttpGroups(samples, (sample) => sample.url);
}

function summarizeHttpGroups(samples, keyFor) {
  const groups = new Map();
  for (const sample of samples) {
    const key = String(keyFor(sample));
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([path, group]) => [
      path,
      {
        requests: group.length,
        statuses: countBy(group, (sample) => String(sample.status)),
        unexpectedErrors: group.filter(
          (sample) => sample.status !== 200 || sample.error !== null,
        ).length,
        latencyMs: distribution(group.map((sample) => sample.durationMs)),
      },
    ]),
  );
}

function countByRolePaths(sessions) {
  const result = {};
  for (const session of sessions) {
    const paths = new Set(result[session.role] ?? []);
    for (const path of session.paths) paths.add(path);
    result[session.role] = [...paths].sort();
  }
  return result;
}

function distribution(values) {
  if (values.length === 0) {
    return { min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: round(sorted[0]),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: round(quantile(sorted, 0.5)),
    p95: round(quantile(sorted, 0.95)),
    p99: round(quantile(sorted, 0.99)),
    max: round(sorted.at(-1)),
  };
}

function quantile(sorted, percentile) {
  const index = Math.max(0, Math.ceil(sorted.length * percentile) - 1);
  return sorted[index];
}

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFor(item));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function loadFormalPreflight() {
  const path = resolve(requiredOption('preflight-report'));
  const report = JSON.parse(await readFile(path, 'utf8'));
  if (report.strict !== true || report.ready !== true) {
    throw new Error('Formal load test requires a strict preflight report with ready=true');
  }

  const checkedAt = Date.parse(report.checkedAt);
  const maxAgeMs = positiveNumber('preflight-max-age-minutes', 60) * 60_000;
  const ageMs = Date.now() - checkedAt;
  if (!Number.isFinite(checkedAt) || ageMs < -60_000 || ageMs > maxAgeMs) {
    throw new Error('Formal preflight report is invalid, from the future, or too old');
  }

  const requiredThresholds = {
    minOrders: 30_000,
    minPdfOrders: 1_000,
    minImageBytes: 400 * 1_024,
    minAverageItems: 2.5,
    minSalesCsUsers: 20,
    minAdminUsers: 3,
    minWorkerUsers: 5,
    minSalaryWorkers: 50,
    minSalaryDays: 180,
    minSalaryRows: 9_000,
  };
  for (const [key, minimum] of Object.entries(requiredThresholds)) {
    if ((report.thresholds?.[key] ?? 0) < minimum) {
      throw new Error(`Preflight threshold ${key} is below required value ${minimum}`);
    }
  }
  if (report.configuration?.backgroundJobsMode !== 'durable') {
    throw new Error('Formal preflight must confirm BACKGROUND_JOBS_MODE=durable');
  }
  if (report.configuration?.nodeEnv !== 'production') {
    throw new Error('Formal preflight must come from NODE_ENV=production');
  }
  if (
    !report.configuration?.appVersion ||
    ['dev', '(unset)'].includes(report.configuration.appVersion)
  ) {
    throw new Error('Formal preflight must confirm a non-dev APP_VERSION');
  }
  if (report.configuration?.ossConfigured !== true) {
    throw new Error('Formal preflight must confirm a complete test OSS configuration');
  }
  if (report.configuration?.ossDenied !== false) {
    throw new Error('Formal preflight points to a denied/production OSS bucket');
  }
  if (
    report.configuration?.notificationMockMode !== 'true' ||
    report.configuration?.cdrBundleMockMode !== 'true'
  ) {
    throw new Error('Formal preflight must confirm external notifications/CDR are mocked');
  }
  return report;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function inclusiveDateSpanDays(from, to) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(from) || !pattern.test(to)) {
    throw new Error('--from and --to must use YYYY-MM-DD');
  }
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    throw new Error('Invalid salary export date range');
  }
  return Math.floor((toMs - fromMs) / 86_400_000) + 1;
}

function sameOriginUrl(value, base, label) {
  const resolved = new URL(value, base);
  if (resolved.origin !== base.origin) {
    throw new Error(
      `${label} must stay on ${base.origin}; received ${resolved.origin}`,
    );
  }
  return resolved;
}

function documentationIp(index) {
  const safe = (index % 250) + 1;
  return `2001:db8::${safe.toString(16)}`;
}

function jitter(value, ratio) {
  return value * (1 - ratio + Math.random() * ratio * 2);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function printHelp() {
  console.log(`Usage:
  pnpm test:load read [options]
  pnpm test:load pdf --order-ids-file ids.txt [options]
  pnpm test:load salary-export --from YYYY-MM-DD --to YYYY-MM-DD [options]

Common environment:
  LOAD_TEST_BASE_URL=http://127.0.0.1:3000
  LOAD_TEST_USERNAME=<staging user>
  LOAD_TEST_PASSWORD=<staging password>

Execution mode:
  --smoke                                      # default; never capacity-valid
  --formal --preflight-report <strict-ready.json>
  --preflight-max-age-minutes 60

Remote safety acknowledgements:
  LOAD_TEST_REMOTE_ACK=staging:<hostname>
  LOAD_TEST_MUTATION_ACK=mutate:<hostname>   # required by PDF scenario

Read options:
  --concurrency 28 --duration-seconds 60 --think-ms 1000
  --paths /orders,/owner --p95-ms 2000
  Formal: --credentials-file /secure/load-test-users.json
          --login-burst 6 --login-spacing-ms 6000

PDF options:
  --order-id <id> (repeatable) or --order-ids-file <path>
  --rate-per-hour 333.333333 --duration-seconds 10800 --mean-ms 8300

Salary export options:
  --from YYYY-MM-DD --to YYYY-MM-DD --concurrency 1 --p95-ms 10000
`);
}
