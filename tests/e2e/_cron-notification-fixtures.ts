import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { databasePoolConfig } from '../../lib/database-session';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_USERS } from './global-setup';

async function withFixtureDb<T>(action: (db: Client) => Promise<T>): Promise<T> {
  const database = assertActivatedE2eDatabase();
  const db = new Client(databasePoolConfig(database.url));
  await db.connect();
  try {
    const identity = await db.query<{ database: string }>('SELECT current_database() AS database');
    if (identity.rows[0]?.database !== database.databaseName) throw new Error('通知 fixture 拒绝写入非隔离数据库');
    return await action(db);
  } finally {
    await db.end();
  }
}

type CronEvent = 'OUTSOURCE_OVERDUE' | 'ORDER_OVERDUE';

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
    } else {
      messageMarker = `E2E-DUE-${suffix.toUpperCase()}`;
      const sales = await db.query<{ id: string }>('SELECT id FROM "User" WHERE username=$1::citext AND role=\'SALES\' AND "isActive"=TRUE', [E2E_USERS.sales.username]);
      if (sales.rowCount !== 1) throw new Error('通知回归缺少隔离销售账号');
      // promisedDate 的契约是「日历日的 UTC 零点」、逾期天数按上海今天算
      // （lib/order/promised-date.ts）；NOW()-5 days 在 UTC 16–24 点会被算成 6 天。
      await db.query(
        `INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","settlementType","createdById",status,"customerRef","totalAmount","promisedDate","submittedAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,'SALES','EXTERNAL_SALES',$3,'IN_PRODUCTION','通知回归客户',100,((NOW() AT TIME ZONE 'Asia/Shanghai')::date-5)::timestamp,NOW(),NOW(),NOW())`,
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
    // their append-only notification history available for inspection.
    await withFixtureDb((db) => db.query(
      'UPDATE "NotificationRule" SET "channelIds"=$2::text[],"isActive"=$3,"updatedAt"=$4 WHERE "eventType"=$1 AND "channelIds"=ARRAY[$5]::text[]',
      [event, previous.channelIds, previous.isActive, previous.updatedAt, channelId],
    ));
  }
}
