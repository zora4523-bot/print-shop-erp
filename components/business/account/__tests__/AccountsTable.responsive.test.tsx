import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EmploymentType,
  Role,
  WorkerType,
} from '@/generated/prisma/enums';
import type { AccountSummary } from '@/lib/account';
import { AccountsTable } from '../AccountsTable';

const longUsername = `worker-${'x'.repeat(57)}`;
const longDisplayName = `师傅03${'长'.repeat(60)}`;

const account: AccountSummary = {
  id: 'account-boundary',
  username: longUsername,
  displayName: longDisplayName,
  phone: '13800138000',
  role: Role.WORKER,
  workerType: WorkerType.PACKER,
  machineType: null,
  isActive: true,
  employmentType: EmploymentType.TEMPORARY,
  employmentStartDate: null,
  employmentEndDate: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('AccountsTable responsive boundary', () => {
  it('在窄屏显示完整可换行卡片，在桌面端限制列宽', () => {
    const html = renderToStaticMarkup(<AccountsTable accounts={[account]} />);

    expect(html).toContain('aria-label="账号列表"');
    expect(html).toContain('class="grid gap-3 lg:hidden"');
    expect(html).toContain('class="hidden lg:block"');
    expect(html).toContain('min-w-[71rem] table-fixed');
    expect(html).toContain('admin-wrap-anywhere');
    expect(html).toContain(`title="${longUsername}"`);
    expect(html).toContain(`title="${longDisplayName}"`);
    // Mobile text + desktop title + desktop text all preserve the full value.
    expect(html.match(new RegExp(longDisplayName, 'g'))).toHaveLength(3);
    expect(html).toContain('编辑账号');
    // 启停徽章归并到共享 ActiveStatusBadge 后，文案统一为「启用」
    // （原「活跃」），与同页启停确认层保持一个词。
    expect(html).toContain('启用');
    expect(html).not.toContain('活跃');
  });

  it('保留用户名与姓名的正确列映射', () => {
    const html = renderToStaticMarkup(<AccountsTable accounts={[account]} />);

    expect(html).toMatch(/<th[^>]*>用户名<\/th><th[^>]*>姓名<\/th>/);
    expect(html.indexOf(`title="${longUsername}"`)).toBeLessThan(
      html.indexOf(`title="${longDisplayName}"`),
    );
  });

  it('搜索无匹配时显示无结果空态', () => {
    const html = renderToStaticMarkup(
      <AccountsTable accounts={[]} hasFilters />,
    );

    expect(html).toContain('data-kind="no-result"');
  });
});
