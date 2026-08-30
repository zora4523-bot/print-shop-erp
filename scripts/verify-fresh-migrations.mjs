#!/usr/bin/env node

// Destructive lifecycle operations deliberately stay outside this gate. A DBA
// must provision an empty disposable database, pass its URL explicitly, and
// remove it after inspection. See DATABASE.md "Fresh database 验证".
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { Client } from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== 'production');
const freshDatabaseUrl = process.env.FRESH_DATABASE_URL?.trim();
if (!freshDatabaseUrl) {
  fail('FRESH_DATABASE_URL 未设；禁止默认使用常规 DATABASE_URL。');
}

let parsedUrl;
try {
  parsedUrl = new URL(freshDatabaseUrl);
} catch {
  fail('FRESH_DATABASE_URL 不是合法 PostgreSQL URL。');
}
if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
  fail('FRESH_DATABASE_URL 必须使用 postgres/postgresql 协议。');
}

const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//u, ''));
if (!databaseName) fail('FRESH_DATABASE_URL 未包含数据库名。');
if (process.env.FRESH_DATABASE_CONFIRM_DATABASE !== databaseName) {
  fail(
    `需设置 FRESH_DATABASE_CONFIRM_DATABASE=${databaseName} 确认这是可丢弃空库。`,
  );
}
const regularDatabaseUrl = process.env.DATABASE_URL?.trim();
if (regularDatabaseUrl) {
  let parsedRegularUrl;
  try {
    parsedRegularUrl = new URL(regularDatabaseUrl);
  } catch {
    fail('当前 DATABASE_URL 不是合法 URL，无法完成隔离校验。');
  }
  if (databaseIdentity(parsedRegularUrl) === databaseIdentity(parsedUrl)) {
    fail('FRESH_DATABASE_URL 与当前 DATABASE_URL 指向同一数据库，拒绝执行。');
  }
}

const migrationsRoot = join(root, 'prisma', 'migrations');
const expectedMigrationNames = readdirSync(migrationsRoot, {
  withFileTypes: true,
})
  .filter(
    (entry) =>
      entry.isDirectory() && /^\d+_[a-z0-9_]+$/u.test(entry.name),
  )
  .map((entry) => entry.name)
  .sort();
const expectedMigrations = expectedMigrationNames.length;
const expectedChecksums = new Map(
  expectedMigrationNames.map((name) => [
    name,
    createHash('sha256')
      .update(readFileSync(join(migrationsRoot, name, 'migration.sql')))
      .digest('hex'),
  ]),
);

const client = new Client({ connectionString: freshDatabaseUrl });
await client.connect();
try {
  const identity = await client.query(
    'SELECT current_database() AS database, current_user AS "user"',
  );
  const connectedDatabase = identity.rows[0]?.database;
  if (connectedDatabase !== databaseName) {
    fail(
      `连接到 ${String(connectedDatabase)}，但确认的数据库是 ${databaseName}。`,
    );
  }

  const version = await client.query('SHOW server_version_num');
  const versionNumber = Number(version.rows[0]?.server_version_num);
  expectEqual(Math.floor(versionNumber / 10_000), 16, 'PostgreSQL major 版本');

  const relations = await client.query(`
    SELECT namespace.nspname AS schema, class.relname AS relation
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND namespace.nspname NOT LIKE 'pg_toast%'
      AND class.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ORDER BY namespace.nspname, class.relname
    LIMIT 1
  `);
  if (relations.rowCount !== 0) {
    const relation = relations.rows[0];
    fail(
      `目标不是空库：已存在 ${String(relation.schema)}.${String(relation.relation)}。`,
    );
  }
} finally {
  await client.end();
}

info(`目标 ${parsedUrl.hostname}/${databaseName}，预期 ${expectedMigrations} 个 migration`);
runPrisma(['migrate', 'deploy']);
runPrisma(['migrate', 'status']);

const verification = new Client({ connectionString: freshDatabaseUrl });
await verification.connect();
try {
  const migrationState = await verification.query(`
    SELECT "migration_name", "checksum", "finished_at", "rolled_back_at"
    FROM "_prisma_migrations"
    ORDER BY "migration_name"
  `);
  expectEqual(
    migrationState.rows.length,
    expectedMigrations,
    'migration 记录数',
  );
  for (const [index, expectedName] of expectedMigrationNames.entries()) {
    const applied = migrationState.rows[index];
    expectEqual(applied?.migration_name, expectedName, `migration[${index}] 名称`);
    expectEqual(
      applied?.checksum,
      expectedChecksums.get(expectedName),
      `${expectedName} checksum`,
    );
    if (!applied?.finished_at || applied?.rolled_back_at) {
      fail(`${expectedName} 未成功完成或已被回滚。`);
    }
  }

  const pricing = await verification.query(`
    SELECT
      five_tier."version" AS "fiveTierVersion",
      five_tier."notes" ? 'supersedesScheduledPriceBookId'
        AS "hasScheduledEvidence",
      repaired."version" AS "repairedVersion",
      five_tier."effectiveTo" = repaired."effectiveFrom" AS continuous,
      repaired."effectiveTo" IS NULL AND repaired."isActive" = TRUE
        AS "repairedCurrent",
      (
        SELECT COUNT(*)::INT FROM "CustomerPriceRule"
        WHERE "priceBookId" = five_tier."id"
      ) AS "fiveTierRuleCount",
      (
        SELECT COUNT(*)::INT FROM "CustomerPriceRule"
        WHERE "priceBookId" = repaired."id"
      ) AS "repairedRuleCount",
      (
        SELECT COUNT(*)::INT
        FROM "CustomerPriceRule" rule
        WHERE rule."priceBookId" = repaired."id"
          AND (
            (rule."code"::TEXT = 'BASE_STOCK-PEARL-RED-160-LARGE'
              AND rule."amount" = 0.1300)
            OR
            (rule."code"::TEXT = 'BASE_STOCK-SOFT-TOUCH-200-LARGE'
              AND rule."amount" = 0.2500)
          )
      ) AS "correctedAmountCount",
      (
        SELECT COUNT(*)::INT
        FROM "CustomerPriceRule" rule
        WHERE rule."priceBookId" = repaired."id"
          AND rule."code"::TEXT = 'BASE_STOCK-SOFT-TOUCH-200-SQUARE'
      ) AS "unsupportedRuleCount",
      (
        SELECT COUNT(*)::INT
        FROM "Product" product
        WHERE product."code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'::CITEXT
          AND product."isActive" = TRUE
      ) AS "unsupportedActiveProductCount"
    FROM "CustomerPriceBook" five_tier
    CROSS JOIN "CustomerPriceBook" repaired
    WHERE five_tier."id" = 'cpb_external_processing_rule_v4_five_tier'
      AND repaired."id" = 'cpb_external_processing_truth_repair_v1'
  `);
  if (pricing.rowCount !== 1) {
    fail('缺少 fresh v4 五档版或后续真值修复版。');
  }
  const row = pricing.rows[0];
  expectEqual(row.fiveTierVersion, 4, 'fresh 五档版版本');
  expectEqual(row.hasScheduledEvidence, false, '伪造计划版证据');
  expectEqual(row.repairedVersion, 5, 'fresh 真值修复版版本');
  expectEqual(row.continuous, true, '版本时间线连续性');
  expectEqual(row.repairedCurrent, true, '真值修复版当前态');
  expectEqual(row.fiveTierRuleCount, 145, '五档版规则数');
  expectEqual(row.repairedRuleCount, 144, '真值修复版规则数');
  expectEqual(row.correctedAmountCount, 2, '真值价格修复数');
  expectEqual(row.unsupportedRuleCount, 0, '无效触感纸方形规则数');
  expectEqual(
    row.unsupportedActiveProductCount,
    0,
    '无效触感纸方形激活产品数',
  );
} finally {
  await verification.end();
}

info('通过：空库完整迁移链与加工费真值后置条件均正确。');

function runPrisma(args) {
  const result = spawnSync(join(root, 'node_modules', '.bin', 'prisma'), args, {
    cwd: root,
    env: { ...process.env, DATABASE_URL: freshDatabaseUrl },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) fail(`prisma ${args.join(' ')} 无法执行：${result.error.message}`);
  if (result.status !== 0) {
    fail(`prisma ${args.join(' ')} 失败（exit ${String(result.status)}）。`);
  }
}

function databaseIdentity(url) {
  const port = url.port || '5432';
  const name = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  return `${url.hostname.toLowerCase()}:${port}/${name}`;
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}错误：期望 ${String(expected)}，实际 ${String(actual)}。`);
  }
}

function info(message) {
  console.log(`[fresh-migrations] ${message}`);
}

function fail(message) {
  console.error(`[fresh-migrations] 失败：${message}`);
  process.exit(1);
}
