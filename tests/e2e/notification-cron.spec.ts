import { test, expect } from '@playwright/test';
import { readNotificationLogs } from './_helpers';
import { withUniqueCronFixture } from './_cs-notification-fixtures';

// Real production handlers, inline after() delivery and a mock destination.
// Each run owns its channel/entity; historical rows are never cleanup targets.
// Durable deduplication is verified separately by worker/database tests.
const CRON_SECRET = process.env.CRON_SECRET;

const cases = [
  { endpoint: 'outsource-overdue', event: 'OUTSOURCE_OVERDUE', count: 'overdueCount', copy: ['外协超期'] },
  { endpoint: 'cs-period-ending', event: 'CS_PERIOD_ENDING', count: 'endingCount', copy: ['客服周期即将结束', '100,000.00'] },
  { endpoint: 'order-overdue', event: 'ORDER_OVERDUE', count: 'overdueCount', copy: ['交期逾期', '已逾期：5 天', '生产中'] },
] as const;

test.describe('cron notify wire', () => {
  test.skip(!CRON_SECRET, '受控测试环境未配置 CRON_SECRET');

  for (const item of cases) {
    test(`/api/cron/${item.endpoint} → ${item.event} NotificationLog`, async ({ request }) => {
      await withUniqueCronFixture(item.event, async ({ channelId, entityId, messageMarker }) => {
        const res = await request.post(`/api/cron/${item.endpoint}`, {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body[item.count]).toBeGreaterThanOrEqual(1);

        const readOwnLogs = async () => (await readNotificationLogs({ eventType: item.event, channelId }))
          .filter((log) => item.event === 'ORDER_OVERDUE'
            ? log.relatedOrderId === entityId
            : log.messageContent.includes(messageMarker));
        await expect.poll(readOwnLogs, { timeout: 10_000 }).toHaveLength(1);
        const mine = await readOwnLogs();
        expect(mine).toHaveLength(1);
        expect(mine[0]!.status).toBe('SUCCESS');
        expect(mine[0]!.errorMessage).toBe('MOCK');
        expect(mine[0]!.messageContent).toContain(messageMarker);
        for (const copy of item.copy) expect(mine[0]!.messageContent).toContain(copy);
        expect(mine[0]!.messageContent).not.toMatch(/\{[a-z]+\}/i);
      });
    });
  }
});
