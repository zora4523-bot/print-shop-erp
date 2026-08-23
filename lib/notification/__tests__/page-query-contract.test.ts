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

  it('keeps RETRYING+DEAD logs visible in the alert, owner queue, and badge', () => {
    expect(page).toContain('listUnresolvedNotificationLogs({');
    expect(page).toContain('data-slot="notifications-owner-alert"');
    expect(page).toContain('重试已耗尽');
    expect(page).toContain('hasDeadLetterJob={log.hasDeadLetterJob}');
    expect(page).toContain('<Badge variant="destructive">重试耗尽</Badge>');
    expect(page).toContain('href="/owner/background-jobs"');
    expect(page).toContain('查看死信任务');
  });

  it('only offers UNKNOWN resolution actions to UNKNOWN rows', () => {
    expect(page).toContain("log.status === 'UNKNOWN'");
    expect(page).toContain('<UnknownNotificationActions');
  });
});
