import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

// Explicit opt-in only; do not load local application credentials here. The
// transaction-local table shadows the application table and is rolled back.
const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260905100000_notification_default_template_newlines/migration.sql',
  ),
  'utf8',
);
const titles = {
  ORDER_SUBMITTED: '**新工单提交**',
  ORDER_CHANGE_REQUESTED: '**工单变更/取消申请**',
  PRODUCTION_PROGRESS_ANOMALY: '⚠️ **报工进度异常**',
  PRODUCTION_STAGNANT: '⏳ **生产停滞**',
  PENDING_FACTORY_BACKLOG: '📋 **待确认积压**',
};

type Rule = {
  id: string;
  eventType: string;
  messageTemplate: string;
  isActive: boolean;
  channelIds: string[];
  updatedAt: Date;
};

postgresDescribe('notification default line-break repair · PostgreSQL', () => {
  it('repairs all five exact defaults while preserving custom templates, routing, and switches', async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout TO '10s'");
      await client.query('SET LOCAL standard_conforming_strings TO on');
      await client.query(`
        CREATE TEMP TABLE "NotificationRule" (
          "id" TEXT PRIMARY KEY,
          "eventType" TEXT NOT NULL,
          "messageTemplate" TEXT NOT NULL,
          "isActive" BOOLEAN NOT NULL,
          "channelIds" TEXT[] NOT NULL,
          "updatedAt" TIMESTAMPTZ NOT NULL
        ) ON COMMIT DROP
      `);
      const original: Rule[] = [];
      for (const [eventType, title] of Object.entries(titles)) {
        const legacy = `${title}\\n工单号：{orderNo}\\n{summary}\\n{deepLink}`;
        for (const [variant, messageTemplate] of [
          ['legacy', legacy],
          ['normalized', legacy.replaceAll('\\n', '\n')],
          ['custom', `${legacy}\\n管理员自定义内容`],
        ]) {
          original.push({
            id: `${eventType}:${variant}`,
            eventType,
            messageTemplate: messageTemplate!,
            isActive: variant !== 'custom',
            channelIds: [`channel-${variant}`],
            updatedAt: new Date('2026-09-01T00:00:00.000Z'),
          });
        }
      }
      original.push({
        ...original[0]!,
        id: 'unrelated',
        eventType: 'URGENT_ORDER',
      });
      for (const row of original) {
        await client.query(
          'INSERT INTO "NotificationRule" VALUES ($1, $2, $3, $4, $5, $6)',
          [row.id, row.eventType, row.messageTemplate, row.isActive, row.channelIds, row.updatedAt],
        );
      }

      const applied = await client.query(migration);
      expect(applied.rowCount).toBe(5);
      const repaired = await client.query<Rule>('SELECT * FROM "NotificationRule"');
      const byId = new Map(repaired.rows.map((row) => [row.id, row]));
      for (const before of original) {
        const after = byId.get(before.id)!;
        if (before.id.endsWith(':legacy')) {
          expect(after.messageTemplate).toBe(before.messageTemplate.replaceAll('\\n', '\n'));
          expect(after.messageTemplate.split('\n')).toHaveLength(4);
          expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
          expect({ ...after, messageTemplate: before.messageTemplate, updatedAt: before.updatedAt }).toEqual(before);
        } else {
          expect(after).toEqual(before);
        }
      }
      expect((await client.query(migration)).rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
