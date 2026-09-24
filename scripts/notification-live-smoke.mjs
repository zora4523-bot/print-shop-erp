#!/usr/bin/env node

// Run with: node --conditions=react-server --import tsx scripts/notification-live-smoke.mjs --send
// Without --send this only checks configuration. Synthetic business data and
// delivery records live in a newly created disposable database; the messages
// themselves are sent to the existing bound enterprise WeChat group.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import nextEnv from '@next/env';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== 'production');
const { configuredSmartBotIdDigest } = require('../lib/notification/smart-bot-identity.ts');
const { NOTIFICATION_EVENTS, sanitizeNotificationPayload } = require('../lib/notification/events.ts');
const { renderTemplate } = require('../lib/notification/render.ts');
const { NOTIFICATION_PAYLOAD_FIELDS } = require('../lib/notification/payload-fields.ts');
const args = process.argv.slice(2);
assert(args.every((arg) => arg === '--send'), 'only --send is supported');
const send = args.includes('--send');
const batch = randomBytes(6).toString('hex');
const databaseName = `erp_notification_smoke_${batch}`;
const events = Object.values(NOTIFICATION_EVENTS);
const sourceUrl = process.env.DATABASE_URL;
const source = new pg.Client({ connectionString: sourceUrl });
let databaseCreated = false;
let database;
let worker;
let workerExit;
let workerStopped = false;
let shutdownRequested = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { shutdownRequested = true; });
}

function requireCheck(condition, message) {
  assert(condition, message);
}

async function until(check, description, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    requireCheck(!shutdownRequested, 'test interrupted; cleanup requested');
    const result = await check();
    if (result) return result;
    if (workerStopped) throw new Error('test worker stopped unexpectedly');
    await delay(500);
  }
  throw new Error(`timed out: ${description}`);
}

async function stopWorker() {
  if (!worker || workerStopped) return;
  worker.kill('SIGTERM');
  const timer = setTimeout(() => worker.kill('SIGKILL'), 20_000);
  try { await workerExit; } finally { clearTimeout(timer); }
}

function syntheticPayload(event, order) {
  const values = {
    orderId: order.id,
    orderNo: order.orderNo,
    submitterName: '合成测试提交人',
    customerRef: '合成测试客户',
    urgentMark: '系统测试急单',
    summary: '系统测试：合成业务数据，无需处理',
    deepLink: `/orders#wo=${encodeURIComponent(order.orderNo)}`,
    taskCount: 2,
    workOrderVersion: 1,
    trackingNo: 'TEST-TRACKING-NOT-REAL',
    outsourceId: `TEST-OUTSOURCE-${batch}`,
    supplierName: '合成测试供应商',
    daysOverdue: 2,
    expectedDate: '2026-09-01',
    promisedDate: '2026/09/01',
    status: '系统测试状态',
    materialName: '合成测试物料',
    currentStock: '1.00',
    safetyStock: '2.00',
    periodId: `TEST-PERIOD-${batch}`,
    csName: '合成测试客服',
    daysLeft: 2,
    totalSales: '0.01',
    settledCount: 1,
    commission: '0.01',
    date: new Date().toISOString().slice(0, 10),
    workerCount: 1,
    totalAmount: '0.01',
  };
  return Object.fromEntries(NOTIFICATION_PAYLOAD_FIELDS[event].map((field) => [field, values[field]]));
}

async function run() {
  await source.connect();
  requireCheck(process.env.WECOM_SMART_BOT_SECRET?.trim(), 'Bot Secret missing');
  const channelRows = await source.query(`
    SELECT "transport", "smartBotBotDigest", "smartBotTargetId",
           "smartBotChatType", "smartBotBoundAt"
      FROM "NotificationChannel"
     WHERE "transport" = 'WECOM_SMART_BOT' AND "isActive" = TRUE
       AND "smartBotBotDigest" = $1
       AND "smartBotTargetId" IS NOT NULL AND "smartBotChatType" = 'GROUP'
       AND "smartBotBoundAt" IS NOT NULL
  `, [configuredSmartBotIdDigest()]);
  requireCheck(channelRows.rowCount === 1, 'exactly one bound matching smart-bot group is required');
  const ruleRows = await source.query('SELECT "eventType", "messageTemplate", "isActive" FROM "NotificationRule"');
  const sourceRules = new Map(ruleRows.rows.map((row) => [row.eventType, row]));
  requireCheck(events.every((event) => sourceRules.has(event)), 'some event templates are missing');
  for (const event of events) {
    requireCheck(!sourceRules.get(event).messageTemplate.includes('\\n'), `${event}: template contains literal escaped newlines`);
  }
  console.info(JSON.stringify({ phase: 'preflight', events: events.length,
    enabledSourceRules: ruleRows.rows.filter((row) => row.isActive).length,
    boundMatchingGroup: true, realSendRequested: send }));
  if (!send) return;
  requireCheck(process.env.NOTIFICATION_MOCK_MODE === 'false', 'explicit real-send mode is required');
  const activeWorkers = await source.query(`SELECT COUNT(*)::int AS count FROM "BackgroundWorkerHeartbeat"
    WHERE queue = 'LIGHT' AND "lastSeenAt" > NOW() - INTERVAL '180 seconds'`);
  requireCheck(activeWorkers.rows[0].count === 0, 'stop the existing LIGHT worker before this isolated test');
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  requireCheck(/^erp_notification_smoke_[a-f0-9]{12}$/.test(databaseName), 'invalid disposable database name');
  requireCheck(new URL(sourceUrl).pathname !== testUrl.pathname, 'test database must differ from source');
  await source.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  const env = { ...process.env, DATABASE_URL: testUrl.toString(),
    NODE_ENV: 'production', NOTIFICATION_MOCK_MODE: 'false', BACKGROUND_JOBS_MODE: 'durable',
    APP_VERSION: `notification-smoke-${batch}`, LIGHT_WORKER_CONCURRENCY: '2', WORKER_HEARTBEAT_MS: '5000' };
  const migration = spawnSync('pnpm', ['prisma', 'migrate', 'deploy'], { cwd: root, env, encoding: 'utf8' });
  requireCheck(migration.status === 0, 'disposable database migration failed');
  console.info(JSON.stringify({ phase: 'migrations', passed: true }));
  Object.assign(process.env, env);
  database = require('../lib/db.ts').db;
  const { dispatchNotification } = require('../lib/notification/dispatch.ts');
  const { enqueueNotificationJob } = require('../lib/background-jobs/notification.ts');
  const channel = await database.notificationChannel.create({ data: {
    ...channelRows.rows[0], channelKey: `smoke_${batch}`,
    channelName: '系统测试智能机器人目标', isActive: true,
  } });
  const routing = {
    factoryConfirmer: { enabled: true, channelIds: [channel.id] },
    owner: { enabled: true, channelIds: [channel.id] },
  };
  await database.setting.upsert({ where: { key: 'management_notification_routing' },
    create: { key: 'management_notification_routing', value: routing }, update: { value: routing } });
  for (const [index, event] of events.entries()) {
    const messageTemplate = `**【系统测试 ${index + 1}/${events.length}｜${batch}】**\n以下均为合成数据，无需业务处理。\n\n${sourceRules.get(event).messageTemplate}`;
    const data = { messageTemplate, isActive: true, channelIds: [channel.id], channels: { set: [{ id: channel.id }] } };
    await database.notificationRule.upsert({ where: { eventType: event },
      create: { eventType: event, ...data, channels: { connect: [{ id: channel.id }] } }, update: data });
  }
  const actor = await database.user.create({ data: { username: `notify-smoke-${batch}`,
    password: 'disabled-test-account', role: 'ADMIN', displayName: '通知验收测试员', isActive: false } });
  const order = await database.order.create({ data: { orderNo: `TEST-NOTIFY-${batch}`,
    submitterId: actor.id, createdById: actor.id, submitterRole: 'SALES',
    settlementType: 'EXTERNAL_SALES', status: 'PACKING', completedAt: new Date(), workOrderVersion: 1 } });
  const payloads = Object.fromEntries(events.map((event) => [event, syntheticPayload(event, order)]));
  for (const event of events) {
    const message = renderTemplate(sourceRules.get(event).messageTemplate, sanitizeNotificationPayload(event, payloads[event]));
    requireCheck(!/\{[A-Za-z][A-Za-z0-9_]*\}/.test(message), `${event}: unresolved template placeholder`);
  }
  worker = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx',
    'scripts/background-worker.ts', '--queue=LIGHT'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // Do not copy SDK/provider output or connection details into the report.
  worker.stdout.resume();
  worker.stderr.resume();
  workerExit = new Promise((resolveExit) => {
    worker.once('error', () => { workerStopped = true; resolveExit(); });
    worker.once('exit', () => { workerStopped = true; resolveExit(); });
  });
  await until(async () => {
    const heartbeats = await database.backgroundWorkerHeartbeat.findMany({ where: { queue: 'LIGHT' } });
    const heartbeat = heartbeats[0];
    if (heartbeat?.smartBotStatus === 'AUTH_FAILED' || heartbeat?.smartBotStatus === 'CONNECTION_CONFLICT') {
      throw new Error(`smart bot ${heartbeat.smartBotStatus}`);
    }
    return heartbeats.length === 1 && heartbeat.smartBotStatus === 'CONNECTED'
      && heartbeat.smartBotBotDigest === configuredSmartBotIdDigest();
  }, 'smart-bot authentication', 100_000);
  console.info(JSON.stringify({ phase: 'connector', connected: true, identityMatch: true }));
  const keys = [];
  for (const [index, event] of events.entries()) {
    const dedupeKey = `notification:live-smoke:${batch}:${event}`;
    keys.push(dedupeKey);
    await dispatchNotification(event, payloads[event], { dedupeKey, spreadIndex: index });
  }
  let lastFinished = -1;
  const jobs = await until(async () => {
    const rows = await database.backgroundJob.findMany({ where: { dedupeKey: { in: keys } } });
    const finished = rows.filter((row) => row.status === 'SUCCEEDED').length;
    if (finished !== lastFinished) { console.info(JSON.stringify({ phase: 'delivery', finished, total: events.length })); lastFinished = finished; }
    if (rows.some((row) => row.status === 'DEAD')) {
      await stopWorker();
      const failedLogs = await database.notificationLog.findMany({
        select: { eventType: true, status: true, errorMessage: true },
      });
      console.info(JSON.stringify({ phase: 'delivery-failure', jobs: rows.map((row) => ({
        event: row.payload.event, status: row.status, attempts: row.attempts,
        errorCode: row.lastErrorCode, result: row.result,
      })), logs: failedLogs }));
      requireCheck(false, 'a notification job became DEAD; do not resend automatically');
    }
    return finished === events.length ? rows : false;
  }, 'all event deliveries');
  const outcomes = [];
  for (const event of events) {
    const job = jobs.find((row) => row.payload.event === event);
    assert.deepEqual(job.result, { event, attempted: 1, delivered: 1, skipped: 0, failed: 0, unknown: 0, unlogged: 0, errorCodes: [] });
    const logs = await database.notificationLog.findMany({ where: { deliveryKey: job.dedupeKey } });
    requireCheck(logs.length === 1 && logs[0].status === 'SUCCESS' && logs[0].sentAt && logs[0].errorMessage === null,
      `${event}: missing unique real-send success ledger`);
    const duplicate = await enqueueNotificationJob(event, sanitizeNotificationPayload(event, payloads[event]), { dedupeKey: job.dedupeKey });
    requireCheck(duplicate.jobId === job.id && !duplicate.created && !duplicate.requeued, `${event}: duplicate job was requeued`);
    outcomes.push({ event, delivered: true, mock: false, logCount: logs.length, attempts: job.attempts, duplicateSuppressed: true });
  }
  // These checks exercise live queue guards but must produce no network send.
  async function guard(event, guardPayload, name) {
    const key = `notification:live-smoke:${batch}:guard:${name}`;
    await dispatchNotification(event, guardPayload, { dedupeKey: key });
    const job = await until(async () => {
      const row = await database.backgroundJob.findUnique({ where: { dedupeKey: key } });
      return row?.status === 'SUCCEEDED' ? row : false;
    }, name, 20_000);
    assert.deepEqual(job.result, { event, attempted: 0, delivered: 0,
      skipped: name === 'obsolete-completion' ? 1 : 0,
      failed: 0, unknown: 0, unlogged: 0, errorCodes: [] });
    requireCheck(await database.notificationLog.count({ where: { deliveryKey: key } }) === 0,
      `${name}: unexpected delivery log`);
    return { name, passed: true };
  }
  const guards = [await guard('ORDER_COMPLETED', { ...payloads.ORDER_COMPLETED, workOrderVersion: 2 }, 'obsolete-completion')];
  await database.setting.update({ where: { key: 'management_notification_routing' },
    data: { value: { ...routing, owner: { enabled: false, channelIds: [channel.id] } } } });
  guards.push(await guard('PRODUCTION_STAGNANT', payloads.PRODUCTION_STAGNANT, 'disabled-role'));
  await database.notificationRule.update({ where: { eventType: 'URGENT_ORDER' }, data: { isActive: false } });
  guards.push(await guard('URGENT_ORDER', payloads.URGENT_ORDER, 'disabled-rule'));
  const finalLogs = await database.notificationLog.findMany({ select: { status: true, errorMessage: true } });
  requireCheck(finalLogs.length === events.length, 'unexpected extra delivery logs');
  requireCheck(finalLogs.filter((row) => row.status === 'SUCCESS' && row.errorMessage === null).length === events.length,
    'unexpected successful delivery count after replay/guard checks');
  console.info(JSON.stringify({ phase: 'result', batch, testedAt: new Date().toISOString(),
    events: outcomes, guards, allPassed: true }, null, 2));
}

try {
  await run();
} catch (error) {
  // Assertions contain only static descriptions/event names; infrastructure
  // exceptions may contain credentials or target IDs, so print their type only.
  console.error(JSON.stringify({ phase: 'failed', error: error.name,
    message: error.name === 'AssertionError' ? error.message : 'live smoke did not complete' }));
  process.exitCode = 1;
} finally {
  await stopWorker();
  if (database) await database.$disconnect();
  if (databaseCreated) {
    await source.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    console.info(JSON.stringify({ phase: 'cleanup', disposableDatabaseRemoved: true }));
  }
  await source.end();
}
