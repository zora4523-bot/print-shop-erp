import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { test, expect, type Locator } from '@playwright/test';
import {
  ADMIN_PASSWORD, ADMIN_USERNAME, expectNoNextErrorOverlay, login, uniqueSuffix,
} from './_helpers';
import { E2E_PASSWORD, E2E_USERS } from './global-setup';
import { smartBotIdDigest } from '../../lib/notification/smart-bot-identity';

// Configuration writes and simulated binding are restricted to a disposable DB.
// Never run these fixtures against the user's live notification routes.
function hasDisposableDatabase(): boolean {
  // Playwright reloads config in workers after DATABASE_URL is already switched;
  // do not rely on a marker recomputed against that switched URL.
  const requested = process.env.E2E_DATABASE_URL;
  if (!requested || requested !== process.env.DATABASE_URL) return false;
  const url = new URL(requested);
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    /^\/notif_ui_e2e_[a-z0-9_]+$/.test(url.pathname);
}
test.beforeEach(() => {
  test.skip(!hasDisposableDatabase(), 'Requires a local disposable E2E_DATABASE_URL named notif_ui_e2e_*');
  test.skip(process.env.NOTIFICATION_MOCK_MODE !== 'true', 'Requires explicit mock mode; no real group messages');
});

async function setCheckbox(checkbox: Locator, checked: boolean) {
  // Base UI associates the wrapping label in a client layout effect. Waiting
  // for that accessible association avoids clicking an unhydrated SSR span.
  await expect(checkbox).toHaveAttribute('aria-labelledby', /.+/);
  await checkbox.setChecked(checked);
}

async function withFixtureDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  if (!hasDisposableDatabase() || process.env.NOTIFICATION_MOCK_MODE !== 'true') throw new Error('Isolated mock fixture required');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
}

test('ADMIN smart-only configuration, legacy read-only history, routes and mock test', async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = uniqueSuffix().replace(/-/g, '_');
  const channelKey = `e2e_${suffix}`;
  const channelName = `智能机器人测试群 ${suffix}`;
  const legacyId = `legacy-${randomUUID()}`;
  const legacyName = `旧版历史群 ${suffix}`;
  const legacyKey = `legacy-private-${suffix}`;
  await withFixtureDb(async db => {
    await db.query(
      `INSERT INTO "NotificationChannel" (id, "channelKey", "channelName", transport, "webhookUrl", "isActive", "updatedAt")
       VALUES ($1, $1, $2, 'WECOM_GROUP_WEBHOOK', $3, true, NOW())`,
      [legacyId, legacyName, `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${legacyKey}`],
    );
    await db.query(
      `INSERT INTO "NotificationLog" (id, "eventType", "channelId", "messageContent", status, "errorMessage")
       VALUES ($1, '__TEST__', $2, 'historical fixture', 'SUCCESS', 'MOCK')`, [randomUUID(), legacyId],
    );
    for (const event of ['ORDER_SUBMITTED', 'URGENT_ORDER', 'DAILY_WORKER_SALARY']) {
      await db.query(
        `INSERT INTO "NotificationRule" (id, "eventType", "channelIds", "messageTemplate", "isActive", "updatedAt")
         VALUES ($1, $2, ARRAY[]::text[], '测试通知', false, NOW())
         ON CONFLICT ("eventType") DO UPDATE SET "channelIds"=ARRAY[]::text[], "isActive"=false`, [randomUUID(), event],
      );
    }
    // Managed events keep old IDs as history, but delivery uses role settings.
    // Enabling after migration must not be blocked by this hidden old field.
    await db.query('UPDATE "NotificationRule" SET "channelIds"=$1::text[] WHERE "eventType"=\'ORDER_SUBMITTED\'', [[legacyId]]);
  });

  await login(page, { from: '/owner/notifications', username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  await expect(page.getByRole('heading', { name: '推送配置', exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="notifications-mock-banner"]')).toBeVisible();
  const legacy = page.locator('[data-slot="legacy-notification-channels"]');
  await legacy.locator('summary').click();
  await expect(legacy).toContainText(legacyName);
  await expect(legacy.locator('form, input, button')).toHaveCount(0);
  await expect(legacy.getByRole('link', { name: '编辑' })).toHaveCount(0);
  expect(await page.content()).not.toContain(legacyKey);

  const legacyResponse = await page.goto(`/owner/notifications/channels/${legacyId}`);
  expect(await legacyResponse!.text()).not.toContain(legacyKey);
  await expect(page.getByRole('heading', { name: '旧版通知目标', exact: true })).toBeVisible();
  await expect(page.locator('main form')).toHaveCount(0);
  await page.getByRole('link', { name: '新建智能机器人目标', exact: true }).click();

  await page.locator('#channelKey').fill(channelKey);
  await page.locator('#channelName').fill(channelName);
  await expect(page.getByRole('textbox', { name: '传输方式' })).toHaveValue('Bot ID + Secret 智能机器人');
  await expect(page.locator('select[name="transport"], input[name="webhookUrl"]')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^启用/ })).toBeDisabled();
  await page.getByRole('button', { name: '创建通知目标', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);
  const row = () => page.getByRole('region', { name: '企业微信通知目标列表' }).locator('tr', { hasText: channelName });
  await expect(row().getByRole('button', { name: '测试', exact: true })).toBeDisabled();

  const channelId = await withFixtureDb(async db => {
    const result = await db.query('SELECT id, transport, "isActive", "webhookUrl" FROM "NotificationChannel" WHERE "channelKey"=$1', [channelKey]);
    expect(result.rows[0]).toMatchObject({ transport: 'WECOM_SMART_BOT', isActive: false, webhookUrl: null });
    const id: string = result.rows[0].id;
    // Simulate an already-verified callback solely in the disposable fixture.
    // This UI spec does not claim to verify enterprise WeChat binding/network.
    const digest = smartBotIdDigest(process.env.WECOM_SMART_BOT_ID!);
    await db.query(
      `UPDATE "NotificationChannel" SET "smartBotBotDigest"=$2, "smartBotTargetId"=$3,
       "smartBotChatType"='GROUP', "smartBotBoundAt"=NOW(), "updatedAt"=NOW() WHERE id=$1`,
      [id, digest, `fake-group-${suffix}`],
    );
    return id;
  });
  await page.goto(`/owner/notifications/channels/${channelId}`);
  await expect(page.getByText('已绑定群聊：')).toBeVisible();
  await setCheckbox(page.getByRole('checkbox', { name: /^启用/ }), true);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);

  await page.goto('/owner/settings');
  const factory = page.getByRole('region', { name: '工厂确认人通知路由' });
  await expect(factory.getByRole('checkbox', { name: `工厂确认人：${legacyName}` })).toHaveCount(0);
  await factory.getByLabel('角色开关').selectOption('true');
  await setCheckbox(factory.getByRole('checkbox', { name: `工厂确认人：${channelName}` }), true);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');

  await page.goto('/owner/notifications/rules/ORDER_SUBMITTED');
  await expect(page.getByText('此事件固定路由到')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: channelName })).toHaveCount(0);
  await setCheckbox(page.getByRole('checkbox', { name: '启用此规则' }), true);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);
  await expect(row().getByRole('button', { name: '删除', exact: true })).toBeDisabled();

  await page.goto('/owner/notifications/rules/URGENT_ORDER');
  await expect(page.getByRole('checkbox', { name: legacyName })).toHaveCount(0);
  await setCheckbox(page.getByRole('checkbox', { name: channelName }), true);
  await setCheckbox(page.getByRole('checkbox', { name: '启用此规则' }), true);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);

  await row().getByRole('button', { name: '测试', exact: true }).click();
  await expect(row().getByText('测试结果已记录', { exact: true })).toBeVisible();
  await withFixtureDb(async db => {
    const result = await db.query('SELECT status, "errorMessage" FROM "NotificationLog" WHERE "channelId"=$1', [channelId]);
    expect(result.rows).toEqual([{ status: 'SUCCESS', errorMessage: 'MOCK' }]);
  });

  await page.goto('/owner/settings');
  await setCheckbox(factory.getByRole('checkbox', { name: `工厂确认人：${channelName}` }), false);
  await factory.getByLabel('角色开关').selectOption('false');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  await page.goto('/owner/notifications/rules/URGENT_ORDER');
  await setCheckbox(page.getByRole('checkbox', { name: channelName }), false);
  await setCheckbox(page.getByRole('checkbox', { name: '启用此规则' }), false);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);
  await row().getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(row().getByRole('alert', { name: '删除失败', exact: true })).toContainText('历史推送记录');
  await expectNoNextErrorOverlay(page);
});

test('SALES cannot open owner notification configuration', async ({ page }) => {
  await login(page, { from: '/orders', username: E2E_USERS.sales.username, password: E2E_PASSWORD });
  await page.goto('/owner/notifications');
  await expect(page.getByRole('heading', { name: '推送配置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建通知目标', exact: true })).toHaveCount(0);
});
