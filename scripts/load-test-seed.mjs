#!/usr/bin/env node

/**
 * Representative, synthetic load-test data for an isolated PostgreSQL DB.
 *
 * The script deliberately uses deterministic IDs scoped by --run-id. Re-running
 * the same run repairs/upserts the same rows instead of growing the data set.
 * Login passwords are rotated on every successful run and are written only to
 * the chmod-600 credentials file.
 */

import nextEnv from '@next/env';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const { Client } = pg;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, false);

const options = parseCli(process.argv.slice(2));
if (options.has('help')) {
  printHelp();
  process.exit(0);
}

const runId = option('run-id', 'representative-v1');
if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(runId)) {
  throw new Error('--run-id must be 1-24 lowercase letters, digits, or dashes');
}

const orderCount = positiveInteger('orders', 30_000);
const pdfOrderCount = positiveInteger('pdf-orders', 1_000);
const itemCount = positiveInteger('items-per-order', 3);
const salaryWorkerCount = positiveInteger('salary-workers', 50);
const salaryDayCount = positiveInteger('salary-days', 180);
const taskOrderCount = positiveInteger('task-orders', 5_000);
if (pdfOrderCount > orderCount) throw new Error('--pdf-orders cannot exceed --orders');
if (itemCount !== 3) {
  throw new Error('--items-per-order must be 3 for the representative-v1 fixture');
}
if (salaryWorkerCount < 50 || salaryDayCount < 180) {
  throw new Error('Representative salary data requires at least 50 workers and 180 days');
}
if (taskOrderCount > orderCount) throw new Error('--task-orders cannot exceed --orders');
if (taskOrderCount * itemCount < salaryWorkerCount * salaryDayCount) {
  throw new Error('--task-orders does not provide enough unique tasks for salary detail rows');
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const database = databaseIdentity(databaseUrl);
assertSafeDatabase(database, runId);

const idPrefix = `lt-${runId}-`;
const orderNoPrefix = `LT-${runId.toUpperCase()}-`;
const credentialsOutput = resolve(
  option(
    'credentials-output',
    `test-results/load/${runId}-credentials.json`,
  ),
);
const imageDirectory = resolve(
  option('image-dir', `public/load-test/${runId}`),
);
const imageBaseUrl = readImageBaseUrl(runId);
const batchSize = positiveInteger('batch-size', 1_000);

const imageAssets = await writeRepresentativeImages(imageDirectory, imageBaseUrl);
const loginAccounts = createLoginAccounts(runId);
const salaryAccounts = createSalaryAccounts(runId, salaryWorkerCount - 5);
await hashAccountPasswords(loginAccounts, salaryAccounts);

const client = new Client({
  connectionString: databaseUrl,
  application_name: `print-shop-erp-load-seed-${runId}`,
  statement_timeout: 0,
  query_timeout: 0,
});

console.log('[load-test-seed] target verified as isolated');
console.log(`Database: ${database.hostname}:${database.port}/${database.name}`);
console.log(`Run: ${runId}`);

await client.connect();
let seedLockHeld = false;
try {
  // Match lib/database-session.ts so synthetic DateTime values use the same
  // UTC wall-clock convention as the application, regardless of server TZ.
  await client.query("SET TIME ZONE 'UTC'");
  await assertSchemaReady(client);
  const seedLock = await client.query(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
    [`load-test-seed:${runId}`],
  );
  if (!seedLock.rows[0]?.locked) {
    throw new Error(`Another seed process is already running for run-id ${runId}`);
  }
  seedLockHeld = true;
  await withTransaction(client, async () => {
    await upsertUsers(client, [...loginAccounts, ...salaryAccounts]);
  });
  console.log(`Users ready: ${loginAccounts.length} login + ${salaryAccounts.length} salary-only`);

  const users = await readSeedUsers(client, loginAccounts, salaryAccounts);
  const crafts = await upsertCrafts(client, idPrefix);

  for (let start = 1; start <= orderCount; start += batchSize) {
    const end = Math.min(orderCount, start + batchSize - 1);
    await withTransaction(client, async () => {
      await upsertOrders(client, {
        start,
        end,
        idPrefix,
        orderNoPrefix,
        submitterIds: users.submitterIds,
        submitterRoles: users.submitterRoles,
        adminId: users.adminIds[0],
      });
      await upsertOrderItems(client, {
        start,
        end,
        idPrefix,
        craftIds: crafts.map((craft) => craft.id),
      });
      await upsertShipments(client, { start, end, idPrefix });
      await upsertShipmentLines(client, { start, end, idPrefix });
    });
    printProgress('orders/items/shipments', end, orderCount);
  }

  await withTransaction(client, async () => {
    await upsertDesigns(client, {
      count: pdfOrderCount,
      idPrefix,
      adminId: users.adminIds[0],
      assets: imageAssets,
    });
  });
  console.log(`Printable orders ready: ${pdfOrderCount} x ${itemCount} real PNG images`);

  for (let start = 1; start <= taskOrderCount; start += batchSize) {
    const end = Math.min(taskOrderCount, start + batchSize - 1);
    await withTransaction(client, async () => {
      await upsertProductionTasks(client, {
        start,
        end,
        idPrefix,
        craftIds: crafts.map((craft) => craft.id),
        workerIds: users.loadWorkerIds,
      });
    });
    printProgress('production tasks', end, taskOrderCount);
  }

  await withTransaction(client, async () => {
    await upsertDailySalaries(client, {
      idPrefix,
      workerIds: users.salaryWorkerIds,
      days: salaryDayCount,
    });
    await mapSalaryTasks(client, {
      idPrefix,
      workerIds: users.salaryWorkerIds,
      days: salaryDayCount,
    });
    await upsertDailySalaryItems(client, {
      idPrefix,
      orderNoPrefix,
      craft: crafts[0],
      workerIds: users.salaryWorkerIds,
      days: salaryDayCount,
    });
    await client.query(
      `INSERT INTO "BusinessCodeSequence" (key, value, "updatedAt")
       VALUES ($1, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = CURRENT_TIMESTAMP`,
      [`load-test-seed:${runId}:representative-v1`],
    );
  });

  await client.query(
    'ANALYZE "User", "Order", "OrderItem", "OrderItemDesign", "OrderShipment", "OrderShipmentLine", "ProductionTask", "DailyWorkerSalary", "DailyWorkerSalaryItem"',
  );
  const verification = await verifyFixture(client, {
    idPrefix,
    usernamePrefix: `load-${runId}-`,
    orderCount,
    pdfOrderCount,
    salaryWorkerCount,
    salaryDayCount,
  });
  assertVerification(verification, {
    orderCount,
    pdfOrderCount,
    salaryWorkerCount,
    salaryDayCount,
  });

  await writeCredentials(credentialsOutput, loginAccounts);
  console.log(`Credentials: ${credentialsOutput} (mode 600; passwords not printed)`);
  console.log(JSON.stringify(verification, null, 2));
  console.log('[load-test-seed] representative fixture ready');
} finally {
  if (seedLockHeld) {
    await client
      .query('SELECT pg_advisory_unlock(hashtext($1))', [`load-test-seed:${runId}`])
      .catch(() => undefined);
  }
  await client.end();
}

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
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
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

function assertSafeDatabase(target, seedRunId) {
  const deniedHosts = new Set([
    'bag.sshapi.cn',
    '120.26.184.160',
    ...(process.env.LOAD_TEST_DENY_DB_HOSTS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
  if (deniedHosts.has(target.hostname)) {
    throw new Error(`Refusing denied database host ${target.hostname}`);
  }
  if (!/(?:load|test|staging|stage|perf|bench)/i.test(target.name)) {
    throw new Error(
      `Refusing database ${target.name}: isolated DB name must contain load/test/staging/perf/bench`,
    );
  }
  const dbAck = `isolated-test:${target.hostname}/${target.name}`;
  if (process.env.LOAD_TEST_DB_ACK !== dbAck) {
    throw new Error(`Set LOAD_TEST_DB_ACK=${dbAck}`);
  }
  const seedAck = `seed-representative:${target.hostname}/${target.name}:${seedRunId}`;
  if (process.env.LOAD_TEST_SEED_ACK !== seedAck) {
    throw new Error(`Seeding requires LOAD_TEST_SEED_ACK=${seedAck}`);
  }
}

function readImageBaseUrl(seedRunId) {
  const explicit = option('image-base-url');
  const appBase = process.env.LOAD_TEST_INTERNAL_BASE_URL ?? process.env.APP_PUBLIC_URL;
  const value = explicit ?? `${(appBase ?? 'http://127.0.0.1:3000').replace(/\/+$/, '')}/load-test/${seedRunId}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('--image-base-url must use http or https');
  }
  const deniedHosts = new Set([
    'bag.sshapi.cn',
    ...(process.env.LOAD_TEST_DENY_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  ]);
  if (deniedHosts.has(url.hostname)) {
    throw new Error(`Refusing production image host ${url.hostname}`);
  }
  return value.replace(/\/+$/, '');
}

async function assertSchemaReady(db) {
  const result = await db.query(`
    SELECT current_database() AS database,
      current_setting('transaction_read_only') AS "readOnly",
      to_regclass('public."Order"') IS NOT NULL AS orders,
      to_regclass('public."DailyWorkerSalaryItem"') IS NOT NULL AS salary_items,
      to_regclass('public."BusinessCodeSequence"') IS NOT NULL AS marker
  `);
  const row = result.rows[0];
  if (row.readOnly !== 'off') throw new Error('Database is read-only');
  if (!row.orders || !row.salary_items || !row.marker) {
    throw new Error('Database schema is incomplete; run prisma migrate deploy first');
  }
}

async function withTransaction(db, operation) {
  await db.query('BEGIN');
  try {
    await operation();
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function createLoginAccounts(seedRunId) {
  const accounts = [];
  // 业主 2026-09-24：客服角色已删除，20 个下单账号全部是外部销售。
  for (let index = 1; index <= 20; index += 1) {
    accounts.push(account(seedRunId, 'sales', index, 'SALES', `压测销售${index}`));
  }
  for (let index = 1; index <= 3; index += 1) {
    accounts.push(account(seedRunId, 'admin', index, 'ADMIN', `压测主管${index}`));
  }
  for (let index = 1; index <= 5; index += 1) {
    accounts.push(account(seedRunId, 'worker', index, 'WORKER', `压测师傅${index}`, true));
  }
  return accounts;
}

function createSalaryAccounts(seedRunId, count) {
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 6;
    return {
      ...account(seedRunId, 'salary-worker', index, 'WORKER', `工资样本师傅${index}`, true),
      isActive: false,
      login: false,
    };
  });
}

function account(seedRunId, kind, index, role, displayName, worker = false) {
  const suffix = String(index).padStart(2, '0');
  return {
    id: `lt-${seedRunId}-user-${kind}-${suffix}`,
    username: `load-${seedRunId}-${kind}-${suffix}`,
    password: randomBytes(18).toString('base64url'),
    passwordHash: '',
    role,
    displayName,
    isActive: true,
    login: true,
    workerType: worker ? 'MACHINE' : null,
    machineType: worker ? 'HAND_PRESS' : null,
    machineCapabilities: worker ? ['HAND_PRESS', 'WINDMILL', 'GLUE'] : [],
  };
}

async function hashAccountPasswords(login, salaryOnly) {
  await Promise.all(
    login.map(async (entry) => {
      entry.passwordHash = await bcrypt.hash(entry.password, 10);
    }),
  );
  const disabledHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 10);
  for (const entry of salaryOnly) {
    entry.password = '';
    entry.passwordHash = disabledHash;
  }
}

async function upsertUsers(db, accounts) {
  const usernames = accounts.map((entry) => entry.username);
  const existing = await db.query(
    'SELECT id, username::text AS username FROM "User" WHERE username = ANY($1::text[])',
    [usernames],
  );
  const expectedIds = new Map(accounts.map((entry) => [entry.username, entry.id]));
  for (const row of existing.rows) {
    if (expectedIds.get(row.username) !== row.id) {
      throw new Error(`Refusing to take over existing username ${row.username}`);
    }
  }

  for (const entry of accounts) {
    await db.query(
      `INSERT INTO "User" (
         id, username, password, role, "workerType", "machineType",
         "machineCapabilities", "displayName", "isActive", "employmentType",
         "employmentStartDate", "createdAt", "updatedAt"
       ) VALUES (
         $1, $2, $3, $4::"Role", $5::"WorkerType", $6::"MachineType",
         $7::"MachineType"[], $8, $9, $10::"EmploymentType",
         CURRENT_DATE - 365, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         password = EXCLUDED.password,
         role = EXCLUDED.role,
         "workerType" = EXCLUDED."workerType",
         "machineType" = EXCLUDED."machineType",
         "machineCapabilities" = EXCLUDED."machineCapabilities",
         "displayName" = EXCLUDED."displayName",
         "isActive" = EXCLUDED."isActive",
         "employmentType" = EXCLUDED."employmentType",
         "updatedAt" = CURRENT_TIMESTAMP`,
      [
        entry.id,
        entry.username,
        entry.passwordHash,
        entry.role,
        entry.workerType,
        entry.machineType,
        entry.machineCapabilities,
        entry.displayName,
        entry.isActive,
        entry.workerType ? 'FULL_TIME' : null,
      ],
    );
  }
}

async function readSeedUsers(db, login, salaryOnly) {
  const byUsername = new Map([...login, ...salaryOnly].map((entry) => [entry.username, entry]));
  const result = await db.query(
    'SELECT id, username::text AS username, role::text AS role FROM "User" WHERE username = ANY($1::text[])',
    [[...byUsername.keys()]],
  );
  const rows = new Map(result.rows.map((row) => [row.username, row]));
  const required = (entry) => {
    const row = rows.get(entry.username);
    if (!row) throw new Error(`Seed user missing after upsert: ${entry.username}`);
    return row;
  };
  const submitters = login.filter((entry) => entry.role === 'SALES').map(required);
  const admins = login.filter((entry) => entry.role === 'ADMIN').map(required);
  const loadWorkers = login.filter((entry) => entry.role === 'WORKER').map(required);
  const allSalaryWorkers = [...loadWorkers, ...salaryOnly.map(required)];
  return {
    submitterIds: submitters.map((row) => row.id),
    submitterRoles: submitters.map((row) => row.role),
    adminIds: admins.map((row) => row.id),
    loadWorkerIds: loadWorkers.map((row) => row.id),
    salaryWorkerIds: allSalaryWorkers.map((row) => row.id),
  };
}

async function upsertCrafts(db, prefix) {
  const definitions = [
    ['FLAT_FOIL_PARTIAL', '局部烫金', 'HAND_PRESS'],
    ['FLAT_FOIL_SINGLE', '专版单色平烫', 'WINDMILL'],
    ['EMBOSS', '浮雕', 'WINDMILL'],
  ];
  const rows = [];
  for (const [code, name, machineType] of definitions) {
    const result = await db.query(
      `INSERT INTO "Craft" (
         id, name, code, "isOutsource", "defaultWorkerType", "defaultMachineType",
         "inHouseMachineTypes", "sortOrder", "isActive", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, false, 'MACHINE', $4::"MachineType", ARRAY[]::"MachineType"[], 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (code) DO UPDATE SET "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP
       RETURNING id, name, code`,
      [`${prefix}craft-${code.toLowerCase()}`, name, code, machineType],
    );
    rows.push(result.rows[0]);
  }
  return rows;
}

async function upsertOrders(db, input) {
  await db.query(
    `INSERT INTO "Order" (
       id, "orderNo", "submitterId", "submitterRole", "createdById", status,
       kind, "billingMode", "settlementType", "isUrgent", "customName",
       "customerRef", "receiverName", "receiverPhone", "receiverAddress",
       "packageRequirement", remark, "processingAmount", "totalAmount",
       revision, "promisedDate", "submittedAt", "scheduledAt", "completedAt",
       "shippedAt", "finishedAt", "createdAt", "updatedAt"
     )
     SELECT
       $1 || 'order-' || lpad(n::text, 6, '0'),
       $2 || lpad(n::text, 6, '0'),
       ($3::text[])[((n - 1) % cardinality($3::text[])) + 1],
       (($4::text[])[((n - 1) % cardinality($4::text[])) + 1])::"Role",
       $5,
       (CASE n % 20 WHEN 0 THEN 'DRAFT' WHEN 1 THEN 'SUBMITTED' WHEN 2 THEN 'SCHEDULING' WHEN 3 THEN 'IN_PRODUCTION' WHEN 4 THEN 'COMPLETED' WHEN 5 THEN 'SHIPPED' WHEN 6 THEN 'CANCELLED' ELSE 'FINISHED' END)::"OrderStatus",
       'NORMAL'::"OrderKind", 'CHARGE'::"OrderBillingMode",
       'EXTERNAL_SALES'::"OrderSettlementType",
       n % 17 = 0, '代表性压测工单 ' || n, '压测客户 ' || ((n - 1) % 200 + 1),
       '测试收件人' || ((n - 1) % 300 + 1), '1380000' || lpad((n % 10000)::text, 4, '0'),
       '浙江省杭州市压测隔离地址 ' || ((n - 1) % 500 + 1) || ' 号',
       '防水包装', 'synthetic load-test run=' || $6,
       (80 + n % 600)::numeric(12,2), (130 + n % 600)::numeric(12,2), 1,
       CURRENT_TIMESTAMP + make_interval(days => (n % 14) + 1),
       CURRENT_TIMESTAMP - make_interval(days => n % 730, hours => n % 24),
       CURRENT_TIMESTAMP - make_interval(days => n % 730),
       CASE WHEN n % 20 IN (4,5,7,8,9,10,11,12,13,14,15,16,17,18,19) THEN CURRENT_TIMESTAMP - make_interval(days => n % 730) END,
       CASE WHEN n % 20 IN (5,7,8,9,10,11,12,13,14,15,16,17,18,19) THEN CURRENT_TIMESTAMP - make_interval(days => n % 730) END,
       CASE WHEN n % 20 IN (7,8,9,10,11,12,13,14,15,16,17,18,19) THEN CURRENT_TIMESTAMP - make_interval(days => n % 730) END,
       CURRENT_TIMESTAMP - make_interval(days => n % 730, hours => n % 24), CURRENT_TIMESTAMP
     FROM generate_series($7::int, $8::int) AS n
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, "updatedAt" = CURRENT_TIMESTAMP, remark = EXCLUDED.remark`,
    [
      input.idPrefix,
      input.orderNoPrefix,
      input.submitterIds,
      input.submitterRoles,
      input.adminId,
      runId,
      input.start,
      input.end,
    ],
  );
}

async function upsertOrderItems(db, input) {
  await db.query(
    `INSERT INTO "OrderItem" (
       id, "orderId", sequence, name, specification, "paperType", quantity,
       crafts, "foilColors", "isDoubleSided", "isDoubleColor", "unitPrice",
       "fixedFee", subtotal, "pricingSnapshot", remark, "createdAt", "updatedAt",
       "pricingRoute", "productStructure", "foilTechnique"
     )
     SELECT
       $1 || 'item-' || lpad(n::text, 6, '0') || '-' || style,
       $1 || 'order-' || lpad(n::text, 6, '0'), style,
       '红包款式 ' || style, '90x170mm', '特种纸', 1000 + (n % 20) * 100,
       $2::text[], ARRAY['哑金']::text[], style = 2, style = 3,
       0.1200, 10.00, (130 + n % 300)::numeric(12,2),
       jsonb_build_object(
         'version', 1, 'complete', false, 'suggestedSubtotal', 'null'::jsonb,
         'source', 'LOAD_TEST', 'runId', $3::text, 'style', style
       ),
       '三款三工艺代表样本',
       CURRENT_TIMESTAMP - make_interval(days => n % 730), CURRENT_TIMESTAMP,
       'MANUAL_QUOTE'::"OrderItemPricingRoute",
       'STANDARD_ENVELOPE'::"OrderProductStructure", 'FLAT'::"OrderFoilTechnique"
     FROM generate_series($4::int, $5::int) AS n
     CROSS JOIN generate_series(1, 3) AS style
     ON CONFLICT (id) DO UPDATE SET
       crafts = EXCLUDED.crafts, quantity = EXCLUDED.quantity,
       "pricingSnapshot" = EXCLUDED."pricingSnapshot", "updatedAt" = CURRENT_TIMESTAMP`,
    [input.idPrefix, input.craftIds, runId, input.start, input.end],
  );
}

async function upsertShipments(db, input) {
  await db.query(
    `INSERT INTO "OrderShipment" (
       id, "orderId", sequence, "receiverName", "receiverPhone", "receiverAddress",
       "expressCode", "carrierCode", "destinationProvince", "quotedWeightKg",
       "trackingNo", "weightKg", status, "shippedAt", "createdAt", "updatedAt"
     )
     SELECT
       $1 || 'shipment-' || lpad(n::text, 6, '0') || '-' || seq,
       $1 || 'order-' || lpad(n::text, 6, '0'), seq,
       '测试收件人' || seq, '1380000000' || seq,
       '浙江省杭州市隔离压测地址 ' || n || '-' || seq, 'LT' || lpad(n::text, 8, '0') || seq,
       'OTHER', '浙江', (0.8 + seq * 0.2)::numeric(10,3),
       CASE WHEN n % 4 = 0 THEN 'LOAD' || lpad(n::text, 10, '0') || seq END,
       (0.9 + seq * 0.2)::numeric(10,3),
       (CASE WHEN n % 4 = 0 THEN 'SHIPPED' ELSE 'PLANNED' END)::"ShipmentStatus",
       CASE WHEN n % 4 = 0 THEN CURRENT_TIMESTAMP - make_interval(days => n % 30) END,
       CURRENT_TIMESTAMP - make_interval(days => n % 730), CURRENT_TIMESTAMP
     FROM generate_series($2::int, $3::int) AS n
     CROSS JOIN generate_series(1, 3) AS seq
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, "updatedAt" = CURRENT_TIMESTAMP`,
    [input.idPrefix, input.start, input.end],
  );
}

async function upsertShipmentLines(db, input) {
  await db.query(
    `INSERT INTO "OrderShipmentLine" (id, "shipmentId", "orderItemId", quantity)
     SELECT
       $1 || 'shipment-line-' || lpad(n::text, 6, '0') || '-' || seq,
       $1 || 'shipment-' || lpad(n::text, 6, '0') || '-' || seq,
       $1 || 'item-' || lpad(n::text, 6, '0') || '-' || seq,
       1000 + (n % 20) * 100
     FROM generate_series($2::int, $3::int) AS n
     CROSS JOIN generate_series(1, 3) AS seq
     ON CONFLICT (id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [input.idPrefix, input.start, input.end],
  );
}

async function upsertDesigns(db, input) {
  await db.query(
    `INSERT INTO "OrderItemDesign" (
       id, "orderItemId", "fileType", "fileUrl", "fileName", "fileSize",
       "thumbnailUrl", "uploadedBy", "uploadedAt"
     )
     SELECT
       $1 || 'design-' || lpad(n::text, 6, '0') || '-' || style,
       $1 || 'item-' || lpad(n::text, 6, '0') || '-' || style,
       'IMAGE'::"DesignFileType", ($2::text[])[style],
       'representative-design-' || style || '.png', ($3::bigint[])[style],
       NULL, $4, CURRENT_TIMESTAMP - make_interval(days => n % 30)
     FROM generate_series(1, $5::int) AS n
     CROSS JOIN generate_series(1, 3) AS style
     ON CONFLICT (id) DO UPDATE SET
       "fileUrl" = EXCLUDED."fileUrl", "fileSize" = EXCLUDED."fileSize",
       "uploadedBy" = EXCLUDED."uploadedBy"`,
    [
      input.idPrefix,
      input.assets.map((asset) => asset.url),
      input.assets.map((asset) => asset.bytes),
      input.adminId,
      input.count,
    ],
  );
}

async function upsertProductionTasks(db, input) {
  await db.query(
    `INSERT INTO "ProductionTask" (
       id, "orderItemId", "craftId", "workerId", "workerType", "machineType",
       status, "plannedQty", "boardCount", "pressCount", "completedQty",
       "defectQty", "reworkQty", "pieceworkAmount", "salaryRuleSnapshot",
       "startedAt", "completedAt", remark, "createdAt", "updatedAt"
     )
     SELECT
       $1 || 'task-' || lpad(n::text, 6, '0') || '-' || style || '-' || craft.ordinality,
       $1 || 'item-' || lpad(n::text, 6, '0') || '-' || style, craft.id,
       ($2::text[])[((n + style + craft.ordinality - 3) % cardinality($2::text[])) + 1],
       'MACHINE'::"WorkerType",
       (CASE WHEN craft.ordinality = 1 THEN 'HAND_PRESS' ELSE 'WINDMILL' END)::"MachineType",
       (CASE WHEN n % 5 = 0 THEN 'IN_PROGRESS' WHEN n % 5 IN (1,2) THEN 'COMPLETED' ELSE 'PENDING' END)::"TaskStatus",
       1000 + (n % 20) * 100, 2 + n % 5, 1 + n % 3,
       CASE WHEN n % 5 IN (1,2) THEN 1000 + (n % 20) * 100 ELSE 0 END,
       n % 3, 0, CASE WHEN n % 5 IN (1,2) THEN (20 + n % 80)::numeric(10,2) ELSE 0 END,
       CASE WHEN n % 5 IN (1,2) THEN jsonb_build_object('source','load-test','runId',$3::text) END,
       CASE WHEN n % 5 IN (0,1,2) THEN CURRENT_TIMESTAMP - make_interval(days => n % 180, hours => 2) END,
       CASE WHEN n % 5 IN (1,2) THEN CURRENT_TIMESTAMP - make_interval(days => n % 180) END,
       'synthetic production mix', CURRENT_TIMESTAMP - make_interval(days => n % 730), CURRENT_TIMESTAMP
     FROM generate_series($4::int, $5::int) AS n
     CROSS JOIN generate_series(1, 3) AS style
     CROSS JOIN unnest($6::text[]) WITH ORDINALITY AS craft(id, ordinality)
     ON CONFLICT (id) DO UPDATE SET
       "workerId" = EXCLUDED."workerId", status = EXCLUDED.status,
       "completedQty" = EXCLUDED."completedQty", "updatedAt" = CURRENT_TIMESTAMP`,
    [input.idPrefix, input.workerIds, runId, input.start, input.end, input.craftIds],
  );
}

async function upsertDailySalaries(db, input) {
  await db.query(
    `INSERT INTO "DailyWorkerSalary" (
       id, "workerId", date, "machineType", "baseSalary", "totalPieceworkAmount",
       "adjustmentAmount", "actualSalary", "taskCount", "orderCount",
       "calculationDetail", "salaryRuleSnapshot", "isPaid", "paidAt", "createdAt"
     )
     SELECT
       $1 || 'salary-' || lpad(worker.ordinality::text, 3, '0') || '-' || lpad(day::text, 3, '0'),
       worker.id, CURRENT_DATE - ($3::int - day), 'HAND_PRESS'::"MachineType",
       100.00, (120 + (worker.ordinality + day) % 80)::numeric(10,2),
       CASE WHEN day % 31 = 0 THEN 10.00 ELSE 0.00 END,
       (120 + (worker.ordinality + day) % 80 + CASE WHEN day % 31 = 0 THEN 10 ELSE 0 END)::numeric(10,2),
       1, 1, jsonb_build_array(jsonb_build_object('source','load-test','day',day)),
       jsonb_build_object('source','load-test','runId',$4::text,'dailyBase',100,'pieceRate',0.01),
       day <= 30, CASE WHEN day <= 30 THEN CURRENT_TIMESTAMP - make_interval(days => 30 - day) END,
       CURRENT_TIMESTAMP - make_interval(days => $3::int - day)
     FROM unnest($2::text[]) WITH ORDINALITY AS worker(id, ordinality)
     CROSS JOIN generate_series(1, $3::int) AS day
     ON CONFLICT (id) DO UPDATE SET
       "baseSalary" = EXCLUDED."baseSalary",
       "totalPieceworkAmount" = EXCLUDED."totalPieceworkAmount",
       "actualSalary" = EXCLUDED."actualSalary",
       "calculationDetail" = EXCLUDED."calculationDetail",
       "salaryRuleSnapshot" = EXCLUDED."salaryRuleSnapshot"`,
    [input.idPrefix, input.workerIds, input.days, runId],
  );
}

async function mapSalaryTasks(db, input) {
  await db.query(
    `WITH salary_grid AS (
       SELECT worker.id AS worker_id, worker.ordinality AS worker_no, day,
         ((worker.ordinality - 1) * $3::int + day) AS k
       FROM unnest($2::text[]) WITH ORDINALITY AS worker(id, ordinality)
       CROSS JOIN generate_series(1, $3::int) AS day
     ), mapped AS (
       SELECT *, ((k - 1) / 3 + 1)::int AS order_no, ((k - 1) % 3 + 1)::int AS style
       FROM salary_grid
     )
     UPDATE "ProductionTask" task SET
       "workerId" = mapped.worker_id, "workerType" = 'MACHINE', "machineType" = 'HAND_PRESS',
       status = 'COMPLETED', "completedQty" = 1000 + (mapped.order_no % 20) * 100,
       "defectQty" = mapped.order_no % 3, "pieceworkAmount" = 120 + (mapped.worker_no + mapped.day) % 80,
       "salaryRuleSnapshot" = jsonb_build_object('source','load-test','runId',$4::text),
       "startedAt" = (CURRENT_DATE - ($3::int - mapped.day))::timestamp - interval '2 hours',
       "completedAt" = (CURRENT_DATE - ($3::int - mapped.day))::timestamp + interval '12 hours',
       "updatedAt" = CURRENT_TIMESTAMP
     FROM mapped
     WHERE task.id = $1 || 'task-' || lpad(mapped.order_no::text, 6, '0') || '-' || mapped.style || '-1'`,
    [input.idPrefix, input.workerIds, input.days, runId],
  );
}

async function upsertDailySalaryItems(db, input) {
  await db.query(
    `WITH salary_grid AS (
       SELECT worker.id AS worker_id, worker.ordinality AS worker_no, day,
         ((worker.ordinality - 1) * $5::int + day) AS k
       FROM unnest($4::text[]) WITH ORDINALITY AS worker(id, ordinality)
       CROSS JOIN generate_series(1, $5::int) AS day
     ), mapped AS (
       SELECT *, ((k - 1) / 3 + 1)::int AS order_no, ((k - 1) % 3 + 1)::int AS style
       FROM salary_grid
     )
     INSERT INTO "DailyWorkerSalaryItem" (
       id, "dailySalaryId", "productionTaskId", "orderId", "orderNo", "orderItemId",
       "orderItemName", "craftId", "craftName", "machineType", "completedQty",
       "defectQty", "reworkQty", "boardCount", "pressCount", "pieceworkAmount",
       "salaryRuleSnapshot", "completedAt", "createdAt"
     )
     SELECT
       $1 || 'salary-item-' || lpad(worker_no::text, 3, '0') || '-' || lpad(day::text, 3, '0'),
       $1 || 'salary-' || lpad(worker_no::text, 3, '0') || '-' || lpad(day::text, 3, '0'),
       $1 || 'task-' || lpad(order_no::text, 6, '0') || '-' || style || '-1',
       $1 || 'order-' || lpad(order_no::text, 6, '0'), $2 || lpad(order_no::text, 6, '0'),
       $1 || 'item-' || lpad(order_no::text, 6, '0') || '-' || style,
       '红包款式 ' || style, $3, $6, 'HAND_PRESS'::"MachineType",
       1000 + (order_no % 20) * 100, order_no % 3, 0, 2 + order_no % 5, 1 + order_no % 3,
       (120 + (worker_no + day) % 80)::numeric(10,2),
       jsonb_build_object('source','load-test','runId',$7::text),
       (CURRENT_DATE - ($5::int - day))::timestamp + interval '12 hours', CURRENT_TIMESTAMP
     FROM mapped
     ON CONFLICT (id) DO UPDATE SET
       "pieceworkAmount" = EXCLUDED."pieceworkAmount",
       "salaryRuleSnapshot" = EXCLUDED."salaryRuleSnapshot",
       "completedAt" = EXCLUDED."completedAt"`,
    [
      input.idPrefix,
      input.orderNoPrefix,
      input.craft.id,
      input.workerIds,
      input.days,
      input.craft.name,
      runId,
    ],
  );
}

async function verifyFixture(db, expected) {
  const result = await db.query(
    `WITH printable AS (
       SELECT o.id, count(DISTINCT oi.id)::int AS items, COALESCE(sum(d."fileSize"),0)::bigint AS image_bytes
       FROM "Order" o
       JOIN "OrderItem" oi ON oi."orderId" = o.id
       LEFT JOIN "OrderItemDesign" d ON d."orderItemId" = oi.id AND d."fileType" = 'IMAGE'
       WHERE o.id LIKE $1
       GROUP BY o.id
     ), roles AS (
       SELECT role::text AS role, count(*)::int AS count FROM "User"
       WHERE "isActive" = true AND username::text LIKE $2 GROUP BY role
     )
     SELECT
       (SELECT count(*)::int FROM "Order" WHERE id LIKE $1) AS orders,
       (SELECT count(*)::int FROM printable WHERE items = 3 AND image_bytes >= 409600) AS "pdfOrders",
       (SELECT round(avg(items)::numeric,2)::text FROM printable WHERE image_bytes > 0) AS "averagePdfItems",
       (SELECT round(avg(image_bytes)::numeric,2)::text FROM printable WHERE image_bytes > 0) AS "averagePdfImageBytes",
       (SELECT count(*)::int FROM "ProductionTask" WHERE id LIKE $1) AS tasks,
       (SELECT count(*)::int FROM "OrderShipment" WHERE id LIKE $1) AS shipments,
       (SELECT count(*)::int FROM "DailyWorkerSalary" WHERE id LIKE $1) AS "salaryRows",
       (SELECT count(DISTINCT "workerId")::int FROM "DailyWorkerSalary" WHERE id LIKE $1) AS "salaryWorkers",
       (SELECT ((max(date)-min(date))+1)::int FROM "DailyWorkerSalary" WHERE id LIKE $1) AS "salaryDays",
       (SELECT count(*)::int FROM "DailyWorkerSalaryItem" WHERE id LIKE $1) AS "salaryItems",
       (SELECT jsonb_object_agg(role,count) FROM roles) AS roles`,
    [`${expected.idPrefix}%`, `${expected.usernamePrefix}%`],
  );
  const row = result.rows[0];
  return {
    orders: row.orders,
    pdfOrders: row.pdfOrders,
    averagePdfItems: Number(row.averagePdfItems),
    averagePdfImageBytes: Number(row.averagePdfImageBytes),
    tasks: row.tasks,
    shipments: row.shipments,
    salaryRows: row.salaryRows,
    salaryWorkers: row.salaryWorkers,
    salaryDays: row.salaryDays,
    salaryItems: row.salaryItems,
    roles: row.roles ?? {},
  };
}

function assertVerification(actual, expected) {
  const salesCs = actual.roles.SALES ?? 0;
  const requiredSalaryRows = expected.salaryWorkerCount * expected.salaryDayCount;
  const failures = [
    [actual.orders >= expected.orderCount, `orders ${actual.orders}/${expected.orderCount}`],
    [actual.pdfOrders >= expected.pdfOrderCount, `pdfOrders ${actual.pdfOrders}/${expected.pdfOrderCount}`],
    [actual.averagePdfItems >= 3, `averagePdfItems ${actual.averagePdfItems}/3`],
    [salesCs === 20, `sales users ${salesCs}/20`],
    [actual.roles.ADMIN === 3, `admin users ${actual.roles.ADMIN ?? 0}/3`],
    [actual.roles.WORKER === 5, `worker users ${actual.roles.WORKER ?? 0}/5`],
    [actual.salaryWorkers >= expected.salaryWorkerCount, `salaryWorkers ${actual.salaryWorkers}/${expected.salaryWorkerCount}`],
    [actual.salaryDays >= expected.salaryDayCount, `salaryDays ${actual.salaryDays}/${expected.salaryDayCount}`],
    [actual.salaryRows >= requiredSalaryRows, `salaryRows ${actual.salaryRows}/${requiredSalaryRows}`],
    [actual.salaryItems >= requiredSalaryRows, `salaryItems ${actual.salaryItems}/${requiredSalaryRows}`],
  ].filter(([passed]) => !passed);
  if (failures.length > 0) {
    throw new Error(`Seed verification failed: ${failures.map(([, label]) => label).join(', ')}`);
  }
}

async function writeCredentials(outputPath, accounts) {
  const payload = accounts.map(({ username, password }) => ({ username, password }));
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(outputPath, 0o600);
}

async function writeRepresentativeImages(directory, baseUrl) {
  await mkdir(directory, { recursive: true });
  const assets = [];
  for (let index = 1; index <= 3; index += 1) {
    const fileName = `representative-design-${index}.png`;
    const buffer = createPng(320, 180, 0x1a2b3c4d ^ index);
    await writeFile(resolve(directory, fileName), buffer);
    assets.push({ fileName, bytes: buffer.byteLength, url: `${baseUrl}/${fileName}` });
  }
  const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  if (total < 400 * 1_024 || total > 700 * 1_024) {
    throw new Error(`Generated image payload is outside representative range: ${total} bytes`);
  }
  console.log(`Design image payload: ${total} bytes across ${assets.length} PNG files`);
  return assets;
}

function createPng(width, height, seed) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  let state = seed >>> 0;
  for (let y = 0; y < height; y += 1) {
    const offset = y * stride;
    raw[offset] = 0;
    for (let x = 1; x < stride; x += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      raw[offset + x] = state & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function printProgress(label, current, total) {
  if (current === total || current % 5_000 === 0) {
    console.log(`${label}: ${current}/${total}`);
  }
}

function printHelp() {
  console.log(`
Generate representative load-test data in an isolated database.

Required environment acknowledgements:
  LOAD_TEST_DB_ACK=isolated-test:<host>/<database>
  LOAD_TEST_SEED_ACK=seed-representative:<host>/<database>:<run-id>

Usage:
  pnpm test:load:seed --run-id representative-v1 \\
    --credentials-output /secure/load-test-users.json

Options:
  --run-id <id>                 deterministic fixture namespace (default: representative-v1)
  --credentials-output <path>   chmod-600 JSON for scripts/load-test.mjs
  --image-dir <path>            generated public PNG directory
  --image-base-url <url>        URL matching --image-dir (default uses APP_PUBLIC_URL)
  --orders <n>                  default 30000
  --pdf-orders <n>              default 1000
  --salary-workers <n>          default 50
  --salary-days <n>             default 180
  --task-orders <n>             default 5000
  --batch-size <n>              default 1000
`);
}
