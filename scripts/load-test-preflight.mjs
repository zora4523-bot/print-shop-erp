#!/usr/bin/env node

import nextEnv from '@next/env';
import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const DEFAULT_DENIED_OSS_BUCKETS = new Set(['hongbaowebdb']);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, false);

const options = parseCli(process.argv.slice(2));
if (options.has('help')) {
  printHelp();
  process.exit(0);
}

const strict = options.has('strict');
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const database = databaseIdentity(databaseUrl);
assertDatabaseTargetIsSafe(database, strict);
assertAppTargetIsSafe();

const thresholds = {
  minOrders: positiveInteger('min-orders', 30_000),
  minPdfOrders: positiveInteger('min-pdf-orders', 1_000),
  minImageBytes: positiveInteger('min-image-bytes', 400 * 1_024),
  minAverageItems: positiveNumber('min-average-items', 2.5),
  minSalesCsUsers: positiveInteger('min-sales-cs-users', 20),
  minAdminUsers: positiveInteger('min-admin-users', 3),
  minWorkerUsers: positiveInteger('min-worker-users', 5),
  minSalaryWorkers: positiveInteger('min-salary-workers', 50),
  minSalaryDays: positiveInteger('min-salary-days', 180),
  minSalaryRows: positiveInteger('min-salary-rows', 9_000),
};
const userPrefix = option('user-prefix', 'load-');

const client = new Client({
  connectionString: databaseUrl,
  application_name: 'print-shop-erp-load-test-preflight',
  statement_timeout: 30_000,
  query_timeout: 35_000,
});

let snapshot;
let pdfOrderIds = [];
await client.connect();
try {
  // The application forces PostgreSQL sessions to UTC because Prisma DateTime
  // columns are UTC wall-clock timestamps. A staging server configured for
  // Asia/Shanghai would otherwise make raw now()-based heartbeat checks appear
  // eight hours stale.
  await client.query("SET TIME ZONE 'UTC'");
  await client.query('BEGIN READ ONLY');
  snapshot = await readSnapshot(client, userPrefix, thresholds.minImageBytes);
  const orderIdsOutput = option('order-ids-output');
  if (orderIdsOutput) {
    pdfOrderIds = await readPdfOrderIds(
      client,
      thresholds.minImageBytes,
      thresholds.minPdfOrders,
    );
  }
  await client.query('ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

const checks = buildChecks(snapshot, thresholds, userPrefix, database);
const failedChecks = checks.filter((check) => !check.passed);
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  strict,
  database: {
    host: database.hostname,
    port: database.port,
    name: database.name,
    local: database.local,
  },
  configuration: configurationSnapshot(),
  thresholds,
  userPrefix,
  snapshot,
  checks,
  ready: failedChecks.length === 0,
};

const orderIdsOutput = option('order-ids-output');
if (orderIdsOutput) {
  const outputPath = resolve(orderIdsOutput);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${pdfOrderIds.join('\n')}\n`, 'utf8');
  report.pdfOrderIdsOutput = outputPath;
  report.pdfOrderIdsWritten = pdfOrderIds.length;
}

const reportOutput = option('output');
if (reportOutput) {
  const outputPath = resolve(reportOutput);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(`Preflight report: ${outputPath}`);
}

console.log('\n[load-test-preflight] 隔离压测环境体检\n');
console.log(`数据库: ${database.hostname}:${database.port}/${database.name}`);
for (const check of checks) {
  console.log(`${check.passed ? '✓' : '✗'} ${check.label}: ${check.actual}`);
}
console.log(
  `\n${failedChecks.length === 0 ? '体检通过，可开始正式压测。' : `尚有 ${failedChecks.length} 项不满足正式压测条件。`}`,
);
if (!strict && failedChecks.length > 0) {
  console.log('当前是信息模式；正式执行前请使用 --strict 作为阻断检查。');
}
console.log('');
console.log(JSON.stringify(report, null, 2));

if (strict && failedChecks.length > 0) process.exitCode = 1;

function parseCli(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const equal = token.indexOf('=');
    if (equal >= 0) {
      parsed.set(token.slice(2, equal), token.slice(equal + 1));
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, 'true');
    }
  }
  return parsed;
}

function option(name, fallback) {
  return options.get(name) ?? fallback;
}

function positiveInteger(name, fallback) {
  const value = positiveNumber(name, fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function positiveNumber(name, fallback) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return value;
}

function databaseIdentity(connectionString) {
  const url = new URL(connectionString);
  const hostname = url.hostname;
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!hostname || !name) throw new Error('DATABASE_URL must include host and database name');
  return {
    hostname,
    port: url.port || '5432',
    name,
    local: ['localhost', '127.0.0.1', '::1'].includes(hostname),
  };
}

function assertDatabaseTargetIsSafe(databaseTarget, strictMode) {
  const denied = new Set([
    'bag.sshapi.cn',
    ...(process.env.LOAD_TEST_DENY_DB_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  ]);
  if (denied.has(databaseTarget.hostname)) {
    throw new Error(`Refusing denied database host ${databaseTarget.hostname}`);
  }
  if (databaseTarget.local && !strictMode) return;
  const expected = `isolated-test:${databaseTarget.hostname}/${databaseTarget.name}`;
  if (process.env.LOAD_TEST_DB_ACK !== expected) {
    throw new Error(`Database preflight requires LOAD_TEST_DB_ACK=${expected}`);
  }
}

function assertAppTargetIsSafe() {
  for (const key of ['APP_PUBLIC_URL', 'AUTH_URL', 'NEXTAUTH_URL']) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    try {
      if (new URL(value).hostname === 'bag.sshapi.cn') {
        throw new Error(`Refusing environment whose ${key} points to production`);
      }
    } catch (error) {
      if (error instanceof TypeError) continue;
      throw error;
    }
  }
}

async function readSnapshot(db, prefix, minImageBytes) {
  const metadata = await db.query(`
      SELECT
        pg_database_size(current_database())::text AS "databaseBytes",
        current_setting('server_version') AS "serverVersion",
        current_setting('max_connections')::int AS "maxConnections",
        current_setting('transaction_read_only') AS "transactionReadOnly"
    `);
  const orders = await db.query('SELECT count(*)::int AS count FROM "Order"');
  const allUsers = await db.query(`
      SELECT role::text AS role, count(*)::int AS count
      FROM "User"
      WHERE "isActive" = true
      GROUP BY role
      ORDER BY role
    `);
  const loadUsers = await db.query(
      `
        SELECT role::text AS role, count(*)::int AS count
        FROM "User"
        WHERE "isActive" = true AND username::text LIKE $1
        GROUP BY role
        ORDER BY role
      `,
      [`${prefix}%`],
    );
  const printableOrders = await db.query(
      `
        WITH per_order AS (
          SELECT
            o.id,
            count(DISTINCT oi.id)::int AS item_count,
            count(d.id) FILTER (WHERE d."fileType" = 'IMAGE')::int AS image_count,
            COALESCE(sum(d."fileSize") FILTER (WHERE d."fileType" = 'IMAGE'), 0)::bigint AS image_bytes
          FROM "Order" o
          JOIN "OrderItem" oi ON oi."orderId" = o.id
          LEFT JOIN "OrderItemDesign" d ON d."orderItemId" = oi.id
          GROUP BY o.id
        )
        SELECT
          count(*) FILTER (WHERE image_count > 0)::int AS "withImages",
          count(*) FILTER (WHERE image_bytes >= $1)::int AS "atLeastTargetImageBytes",
          round(COALESCE(avg(item_count) FILTER (WHERE image_count > 0), 0)::numeric, 2)::text AS "averageItems",
          round(COALESCE(avg(image_bytes) FILTER (WHERE image_count > 0), 0)::numeric, 2)::text AS "averageImageBytes",
          COALESCE(max(image_bytes), 0)::text AS "maxImageBytes"
        FROM per_order
      `,
      [minImageBytes],
    );
  const workload = await db.query(`
      SELECT
        (SELECT count(*)::int FROM "ProductionTask") AS "productionTasks",
        (SELECT round(COALESCE(avg(cardinality(crafts)), 0)::numeric, 2)::text FROM "OrderItem") AS "averageCraftsPerItem",
        (
          SELECT round(COALESCE(avg(shipment_count), 0)::numeric, 2)::text
          FROM (
            SELECT count(*)::int AS shipment_count
            FROM "OrderShipment"
            GROUP BY "orderId"
          ) shipments
        ) AS "averageShipmentsWhenPresent"
    `);
  const salary = await db.query(`
      SELECT
        count(*)::int AS rows,
        count(DISTINCT "workerId")::int AS workers,
        min(date)::text AS "from",
        max(date)::text AS "to",
        COALESCE((max(date) - min(date)) + 1, 0)::int AS "spanDays"
      FROM "DailyWorkerSalary"
    `);
  const jobs = await db.query(`
      SELECT queue::text AS queue, status::text AS status, count(*)::int AS count
      FROM "BackgroundJob"
      GROUP BY queue, status
      ORDER BY queue, status
    `);
  const heartbeats = await db.query(`
      SELECT
        queue::text AS queue,
        count(*) FILTER (WHERE "lastSeenAt" >= now() - interval '30 seconds')::int AS fresh,
        count(*)::int AS total
      FROM "BackgroundWorkerHeartbeat"
      GROUP BY queue
      ORDER BY queue
    `);

  return {
    metadata: metadata.rows[0],
    orders: orders.rows[0].count,
    activeUsersByRole: rowsToCounts(allUsers.rows, 'role'),
    loadUsersByRole: rowsToCounts(loadUsers.rows, 'role'),
    printableOrders: normalizeNumbers(printableOrders.rows[0]),
    workload: normalizeNumbers(workload.rows[0]),
    salary: normalizeNumbers(salary.rows[0]),
    backgroundJobs: jobs.rows,
    workerHeartbeats: heartbeats.rows,
  };
}

async function readPdfOrderIds(db, minImageBytes, limit) {
  const result = await db.query(
    `
      SELECT o.id
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      JOIN "OrderItemDesign" d ON d."orderItemId" = oi.id AND d."fileType" = 'IMAGE'
      GROUP BY o.id, o."createdAt"
      HAVING sum(d."fileSize") >= $1
      ORDER BY o."createdAt" DESC, o.id DESC
      LIMIT $2
    `,
    [minImageBytes, limit],
  );
  return result.rows.map((row) => row.id);
}

function buildChecks(snapshotData, limits, prefix, databaseTarget) {
  const loadUsers = snapshotData.loadUsersByRole;
  const salesCs = (loadUsers.SALES ?? 0) + (loadUsers.CUSTOMER_SERVICE ?? 0);
  const heavyFresh = snapshotData.workerHeartbeats.find(
    (heartbeat) => heartbeat.queue === 'HEAVY',
  )?.fresh ?? 0;
  const lightFresh = snapshotData.workerHeartbeats.find(
    (heartbeat) => heartbeat.queue === 'LIGHT',
  )?.fresh ?? 0;
  const config = configurationSnapshot();
  const backgroundJobCount = snapshotData.backgroundJobs.reduce(
    (sum, row) => sum + row.count,
    0,
  );
  const expectedDbAck = `isolated-test:${databaseTarget.hostname}/${databaseTarget.name}`;
  const expectedOssAck = config.ossBucket
    ? `test-bucket:${config.ossBucket}`
    : '(OSS_BUCKET missing)';

  return [
    check('database-ack', '隔离测试库确认', process.env.LOAD_TEST_DB_ACK ?? '(missing)', process.env.LOAD_TEST_DB_ACK === expectedDbAck),
    check('production-build', '生产运行模式', config.nodeEnv, config.nodeEnv === 'production'),
    check('app-version', '非 dev 应用版本', config.appVersion, Boolean(config.appVersion && config.appVersion !== 'dev' && config.appVersion !== '(unset)')),
    check('durable-mode', '持久任务模式', config.backgroundJobsMode, config.backgroundJobsMode === 'durable'),
    check('notification-mock', '企微通知 mock', config.notificationMockMode, config.notificationMockMode === 'true'),
    check('cdr-mock', 'CDR 打包 mock', config.cdrBundleMockMode, config.cdrBundleMockMode === 'true'),
    check('oss-ack', '独立测试 OSS 确认', process.env.LOAD_TEST_OSS_ACK ?? '(missing)', process.env.LOAD_TEST_OSS_ACK === expectedOssAck),
    check('oss-not-production', 'OSS 不在生产禁用清单', config.ossDenied ? 'denied' : 'allowed', config.ossDenied === false),
    check('oss-config', '测试 OSS 配置完整', config.ossConfigured, config.ossConfigured === true),
    check('orders', '历史工单数', snapshotData.orders, snapshotData.orders >= limits.minOrders),
    check('pdf-orders', `图片≥${limits.minImageBytes}字节的不同工单`, snapshotData.printableOrders.atLeastTargetImageBytes, snapshotData.printableOrders.atLeastTargetImageBytes >= limits.minPdfOrders),
    check('average-items', '可打印工单平均款式数', snapshotData.printableOrders.averageItems, snapshotData.printableOrders.averageItems >= limits.minAverageItems),
    check('sales-cs-users', `${prefix} 销售/客服账号`, salesCs, salesCs >= limits.minSalesCsUsers),
    check('admin-users', `${prefix} 主管账号`, loadUsers.ADMIN ?? 0, (loadUsers.ADMIN ?? 0) >= limits.minAdminUsers),
    check('worker-users', `${prefix} 师傅账号`, loadUsers.WORKER ?? 0, (loadUsers.WORKER ?? 0) >= limits.minWorkerUsers),
    check('salary-workers', '工资数据覆盖人数', snapshotData.salary.workers, snapshotData.salary.workers >= limits.minSalaryWorkers),
    check('salary-days', '工资数据日期跨度', snapshotData.salary.spanDays, snapshotData.salary.spanDays >= limits.minSalaryDays),
    check('salary-rows', '工资数据行数', snapshotData.salary.rows, snapshotData.salary.rows >= limits.minSalaryRows),
    check('empty-job-baseline', '测试前后台任务总数', backgroundJobCount, backgroundJobCount === 0),
    check('light-worker', '30秒内活跃的 LIGHT worker', lightFresh, lightFresh >= 1),
    check('heavy-worker', '30秒内活跃的 HEAVY worker', heavyFresh, heavyFresh >= 1),
    check('pdf-artifact-dir', 'PDF 产物目录', config.pdfArtifactDir || '(missing)', Boolean(config.pdfArtifactDir && isAbsolute(config.pdfArtifactDir))),
  ];
}

function check(id, label, actual, passed) {
  return { id, label, actual, passed };
}

function configurationSnapshot() {
  const requiredOssKeys = [
    'OSS_ACCESS_KEY_ID',
    'OSS_ACCESS_KEY_SECRET',
    'OSS_STS_ROLE_ARN',
    'OSS_BUCKET',
    'OSS_REGION',
  ];
  const deniedOssBuckets = new Set([
    ...DEFAULT_DENIED_OSS_BUCKETS,
    ...(process.env.LOAD_TEST_DENY_OSS_BUCKETS ?? '')
      .split(',')
      .map((bucket) => bucket.trim())
      .filter(Boolean),
  ]);
  const ossBucket = process.env.OSS_BUCKET ?? '(unset)';
  return {
    nodeEnv: process.env.NODE_ENV ?? '(unset)',
    appVersion: process.env.APP_VERSION ?? '(unset)',
    backgroundJobsMode: process.env.BACKGROUND_JOBS_MODE ?? '(unset)',
    notificationMockMode: process.env.NOTIFICATION_MOCK_MODE ?? '(unset)',
    cdrBundleMockMode: process.env.CDR_BUNDLE_MOCK_MODE ?? '(unset)',
    ossBucket,
    ossDenied: deniedOssBuckets.has(ossBucket),
    ossConfigured: requiredOssKeys.every(
      (key) => Boolean(process.env[key]?.trim()),
    ),
    pdfArtifactDir: process.env.PDF_ARTIFACT_DIR ?? '(unset)',
    orderExportArtifactDir: process.env.ORDER_EXPORT_ARTIFACT_DIR ?? '(unset)',
    agentMonthlyBillExportArtifactDir:
      process.env.AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR ?? '(unset)',
  };
}

function rowsToCounts(rows, key) {
  return Object.fromEntries(rows.map((row) => [row[key], row.count]));
}

function normalizeNumbers(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (value === null) return [key, null];
      if (typeof value === 'number') return [key, value];
      if (/^-?\d+(?:\.\d+)?$/.test(value)) return [key, Number(value)];
      return [key, value];
    }),
  );
}

function printHelp() {
  console.log(`Usage:
  pnpm test:load:preflight [--strict] [options]

Safety acknowledgements:
  LOAD_TEST_DB_ACK=isolated-test:<db-host>/<db-name>
  LOAD_TEST_OSS_ACK=test-bucket:<bucket>

Representative defaults:
  --min-orders 30000 --min-pdf-orders 1000 --min-image-bytes 409600
  --min-average-items 2.5
  --user-prefix load- --min-sales-cs-users 20 --min-admin-users 3
  --min-worker-users 5
  --min-salary-workers 50 --min-salary-days 180 --min-salary-rows 9000

Outputs:
  --output test-results/load/preflight.json
  --order-ids-output test-results/load/staging-pdf-order-ids.txt
`);
}
