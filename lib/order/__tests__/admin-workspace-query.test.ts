import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
import {
  adminOrderExportParamsFromQuery,
  isAdminOrderWorkspaceExportParams,
  parseAdminOrderWorkspaceQuery,
  serializeAdminOrderWorkspaceQuery,
  updateAdminOrderWorkspaceQuery,
} from '../admin-workspace-query';

describe('admin order workspace query', () => {
  it('defaults to todo and forces the locked newest-first order', () => {
    const parsed = parseAdminOrderWorkspaceQuery({
      sort: 'totalAmount',
      dir: 'asc',
      selected: 'order-1',
      scroll: '420',
      view: 'urgent',
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.query).toMatchObject({
      queue: 'todo',
      starred: false,
      unbilled: false,
      list: { page: 1, sort: 'createdAt', dir: 'desc' },
    });
    expect(parsed.query.list.selectedOrderId).toBeUndefined();
    expect(parsed.query.list.scrollY).toBeUndefined();
    expect(parsed.query.list.view).toBeUndefined();
    expect(serializeAdminOrderWorkspaceQuery(parsed.query)).not.toHaveProperty(
      'sort',
    );
  });

  it('round-trips queue, signal, star, billing state and independent list filters', () => {
    const parsed = parseAdminOrderWorkspaceQuery({
      queue: 'production',
      signal: 'overdue',
      starred: 'yes',
      unbilled: 'yes',
      q: '福明',
      customerRef: '客户甲',
      submitterId: 'sales-1',
      craftId: ['craft-1', 'craft-2'],
      page: '3',
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.query).toMatchObject({
      queue: 'production',
      signal: 'overdue',
      starred: true,
      unbilled: true,
      list: { page: 3 },
    });
    expect(serializeAdminOrderWorkspaceQuery(parsed.query)).toEqual(
      expect.objectContaining({
        queue: 'production',
        signal: 'overdue',
        starred: 'yes',
        unbilled: 'yes',
        q: '福明',
        customerRef: '客户甲',
        submitterId: 'sales-1',
        craftId: 'craft-1,craft-2',
        page: 3,
      }),
    );
  });

  it('reports forged workspace keys without reflecting them', () => {
    const parsed = parseAdminOrderWorkspaceQuery({
      queue: 'secret',
      signal: 'unknown',
      starred: 'sometimes',
      unbilled: 'sometimes',
    });

    expect(parsed.issues).toEqual([
      '工单队列不合法',
      '看板入口不合法',
      '星标筛选不合法',
      '未出账筛选不合法',
    ]);
    expect(parsed.query).toMatchObject({
      queue: 'todo',
      starred: false,
      unbilled: false,
    });
    expect(parsed.query.signal).toBeUndefined();
  });

  it('serializes a page-independent durable-export receipt for workspace-only filters', () => {
    const query = parseAdminOrderWorkspaceQuery({
      queue: 'print',
      signal: 'pending-change',
      starred: 'yes',
      unbilled: 'yes',
      q: '客户甲',
      page: '9',
      pageSize: '50',
    }).query;

    const params = adminOrderExportParamsFromQuery(query);
    expect(params).toEqual({
      q: '客户甲',
      queue: 'print',
      signal: 'pending-change',
      starred: 'yes',
      unbilled: 'yes',
      adminWorkspace: 'v1',
    });
    expect(params).not.toHaveProperty('page');
    expect(params).not.toHaveProperty('pageSize');
    expect(isAdminOrderWorkspaceExportParams(params)).toBe(true);
    expect(isAdminOrderWorkspaceExportParams({ q: '客户甲' })).toBe(false);
  });

  it('resets pagination when changing a queue, signal or star filter', () => {
    const query = parseAdminOrderWorkspaceQuery({ page: '8' }).query;
    const updated = updateAdminOrderWorkspaceQuery(query, {
      queue: 'all',
      signal: 'pending-change',
      starred: true,
      unbilled: true,
    });
    expect(updated.list.page).toBe(1);
    expect(updated).toMatchObject({
      queue: 'all',
      signal: 'pending-change',
      starred: true,
      unbilled: true,
    });
  });
});
