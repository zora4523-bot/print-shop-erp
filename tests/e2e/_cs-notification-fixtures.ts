import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { databasePoolConfig } from '../../lib/database-session';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_PASSWORD, E2E_USERS } from './global-setup';

async function withFixtureDb<T>(action: (db: Client) => Promise<T>): Promise<T> {
  const database = assertActivatedE2eDatabase();
  const db = new Client(databasePoolConfig(database.url));
  await db.connect();
  try {
    const identity = await db.query<{ database: string }>('SELECT current_database() AS database');
    if (identity.rows[0]?.database !== database.databaseName) throw new Error('客服及通知 fixture 拒绝写入非隔离数据库');
    return await action(db);
  } finally {
    await db.end();
  }
}

// Every run owns its identity and period. Existing salary/notification ledgers
// remain intact; a rerun must not require deleting another test's history.
export async function seedUniqueCustomerService() {
  const suffix = randomBytes(8).toString('hex');
  const id = `e2e-cs-isolated-${suffix}`;
  const username = `e2e-cs-${suffix}`;
  const displayName = `客服回归 ${suffix}`;
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);
  await withFixtureDb((db) => db.query(
    `INSERT INTO "User" (id,username,"displayName",password,role,"isActive","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'CUSTOMER_SERVICE',TRUE,NOW(),NOW())`,
    [id, username, displayName, passwordHash],
  ));
  return { id, username, displayName };
}

type CronEvent = 'OUTSOURCE_OVERDUE' | 'CS_PERIOD_ENDING' | 'ORDER_OVERDUE';

export async function withUniqueCronFixture<T>(event: CronEvent, action: (fixture: {
  channelId: string;
  entityId: string;
  messageMarker: string;
}) => Promise<T>): Promise<T> {
  if (process.env.NOTIFICATION_MOCK_MODE !== 'true') throw new Error('通知回归必须启用 NOTIFICATION_MOCK_MODE');
  const suffix = randomBytes(8).toString('hex');
  const channelId = `e2e-cron-channel-${suffix}`;
  const entityId = `e2e-cron-entity-${suffix}`;
  let messageMarker = `回归通知 ${suffix}`;
  const cs = event === 'CS_PERIOD_ENDING' ? await seedUniqueCustomerService() : null;
  const previous = await withFixtureDb(async (db) => {
    const rule = await db.query<{ channelIds: string[]; isActive: boolean; updatedAt: Date }>(
      'SELECT "channelIds","isActive","updatedAt" FROM "NotificationRule" WHERE "eventType"=$1', [event],
    );
    if (rule.rowCount !== 1) throw new Error(`通知回归缺少已迁移的 ${event} 规则`);
    if (event === 'OUTSOURCE_OVERDUE') {
      await db.query(
        `INSERT INTO "OutsourceOrder" (id,"idempotencyKey","orderItemIds","supplierName","expectedDate",status,"createdAt","updatedAt")
         VALUES ($1,$2,ARRAY[]::text[],$3,NOW()-INTERVAL '5 days','IN_PROGRESS',NOW(),NOW())`,
        [entityId, `${entityId}:fixture`, messageMarker],
      );
    } else if (event === 'CS_PERIOD_ENDING' && cs) {
      messageMarker = cs.displayName;
      await db.query(
        `INSERT INTO "SalaryPeriod" (id,"csUserId","periodStart","periodEnd","durationMonths","totalSales","initialSales","monthlyBase",status,"createdAt","updatedAt")
         VALUES ($1,$2,(NOW() AT TIME ZONE 'Asia/Shanghai')::date-90,(NOW() AT TIME ZONE 'Asia/Shanghai')::date+3,4,100000,0,5000,'IN_PROGRESS',NOW(),NOW())`,
        [entityId, cs.id],
      );
    } else {
      messageMarker = `E2E-DUE-${suffix.toUpperCase()}`;
      const sales = await db.query<{ id: string }>('SELECT id FROM "User" WHERE username=$1::citext AND role=\'SALES\' AND "isActive"=TRUE', [E2E_USERS.sales.username]);
      if (sales.rowCount !== 1) throw new Error('通知回归缺少隔离销售账号');
      await db.query(
        `INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","settlementType","createdById",status,"customerRef","totalAmount","promisedDate","submittedAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,'SALES','EXTERNAL_SALES',$3,'IN_PRODUCTION','通知回归客户',100,NOW()-INTERVAL '5 days',NOW(),NOW(),NOW())`,
        [entityId, messageMarker, sales.rows[0]!.id],
      );
    }
    await db.query(
      `INSERT INTO "NotificationChannel" (id,"channelKey","channelName","webhookUrl","isActive","createdAt","updatedAt")
       VALUES ($1::text,$1::text,'独立通知回归群','https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=E2E_FIXTURE',TRUE,NOW(),NOW())`,
      [channelId],
    );
    await db.query('UPDATE "NotificationRule" SET "channelIds"=ARRAY[$2]::text[],"isActive"=TRUE,"updatedAt"=NOW() WHERE "eventType"=$1', [event, channelId]);
    return rule.rows[0]!;
  });
  try {
    return await action({ channelId, entityId, messageMarker });
  } finally {
    // Restore only the rule we temporarily bound. Keep channels, entities and
    // their append-only notification/salary history available for inspection.
    await withFixtureDb((db) => db.query(
      'UPDATE "NotificationRule" SET "channelIds"=$2::text[],"isActive"=$3,"updatedAt"=$4 WHERE "eventType"=$1 AND "channelIds"=ARRAY[$5]::text[]',
      [event, previous.channelIds, previous.isActive, previous.updatedAt, channelId],
    ));
  }
}
