import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(
  path.join(
    process.cwd(),
    'app',
    '(admin)',
    'owner',
    'notifications',
    'page.tsx',
  ),
  'utf8',
);

describe('owner notification page query contract', () => {
  it('loads channels and rules through the shared single-query snapshot', () => {
    expect(page).toContain('listNotificationConfiguration()');
    expect(page).not.toContain('listChannelsWithRefCount()');
    expect(page).not.toContain('listRules()');
  });

  it('keeps RETRYING+DEAD visible while rendering transport and job states separately', () => {
    expect(page).toContain('listUnresolvedNotificationLogs({');
    expect(page).toContain('data-slot="notifications-owner-alert"');
    expect(page).toContain('重试已耗尽');
    expect(page).toContain('投递状态');
    expect(page).toContain('重发状态');
    expect(page).toContain('NOTIFICATION_STATUS_REGISTRY[status]');
    expect(page).toContain('BACKGROUND_JOB_STATUS_REGISTRY[status]');
    expect(page).not.toContain('hasDeadLetterJob={log.hasDeadLetterJob}');
    expect(page).toContain('<UiStatusBadge tone={definition.tone}');
    expect(page).toContain('href="/owner/background-jobs"');
    expect(page).toContain('查看失败记录');
    expect(page).not.toContain('无持久任务');
  });

  it('only offers UNKNOWN resolution actions to UNKNOWN rows', () => {
    expect(page).toContain("log.status === 'UNKNOWN'");
    expect(page).toContain('<UnknownNotificationActions');
  });

  it('renders the persisted LIGHT-worker smart-bot connection state', () => {
    expect(page).toContain('getBackgroundJobHealth().catch(() => null)');
    expect(page).toContain('summarizeSmartBotConnection(backgroundHealth');
    expect(page).toContain('data-slot="notifications-smart-bot-connection"');
    expect(page).toContain('此状态来自后台处理进程上报的连接心跳');
    expect(page).toContain("case 'AUTH_FAILED':");
    expect(page).toContain('请立即轮换或核对机器人凭据');
    expect(page).not.toContain('notifications-smart-bot-env-banner');
  });
});
