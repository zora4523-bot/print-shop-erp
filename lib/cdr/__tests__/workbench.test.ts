import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ order: { findMany: vi.fn(), count: vi.fn() }, designBundle: { findMany: vi.fn() }, $queryRaw: vi.fn() }));
vi.mock('@/lib/db', () => ({ db }));
import { collectWorkbenchSelection, listWorkbenchOrders, validateWorkbenchManifest, workbenchOrderFacts, workbenchWhere, cdrWorkbenchSelect } from '../workbench';
import { cdrWorkbenchFilterSchema, cdrSelectionSchema } from '../workbench-model';
import type { Prisma } from '@/generated/prisma/client';
function order(id = 'o1', username = 'sales1'): Prisma.OrderGetPayload<{ select: typeof cdrWorkbenchSelect }> {
  return { id, orderNo: id, customName: null, status: 'CONFIRMED', submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES', submittedAt: new Date('2026-09-01T00:00:00Z'),
    submitter: { id: username, username, displayName: '同名销售' }, sourceOrder: null,
    items: [{ id: `${id}-item`, sequence: 1, name: '信封', designs: [{ id: `${id}-cdr`, fileName: 'file.cdr', fileUrl: 'https://example.com/design/file.cdr', fileSize: BigInt(123), uploadedAt: new Date('2026-09-01T00:00:00Z') }] }] };
}
beforeEach(() => { vi.resetAllMocks(); db.order.count.mockResolvedValue(1); db.designBundle.findMany.mockResolvedValue([]); db.$queryRaw.mockResolvedValue([]); });
describe('CDR workbench', () => {
  it('groups by historical account identity, never display name', () => {
    expect(workbenchOrderFacts(order()).salesId).not.toBe(workbenchOrderFacts(order('o2', 'sales2')).salesId);
    expect(workbenchOrderFacts(order()).files[0].folders).toHaveLength(3);
  });
  it('rework follows original sales; internal orders remain a separate explicit group', () => {
    const row = order(); row.settlementType = 'NO_CHARGE'; row.sourceOrder = { submitter: row.submitter, submitterRole: 'SALES' };
    expect(workbenchOrderFacts(row).salesId).toBe('sales1');
    row.sourceOrder = null; expect(workbenchOrderFacts(row).salesId).toBe('internal');
  });
  it('blocks missing CDR for any item and invalid account, rather than partially packing silently', () => {
    const row = order(); row.items.push({ id: 'missing', sequence: 2, name: 'missing', designs: [] });
    expect(workbenchOrderFacts(row).issue).toBe('1 款缺少 CDR');
    row.submitterRole = 'ADMIN'; expect(workbenchOrderFacts(row).issue).toBe('外部销售未填');
  });
  it('validates reversed/impossible dates and duplicate or oversized selections', () => {
    expect(cdrWorkbenchFilterSchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(cdrWorkbenchFilterSchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(false);
    const entry = { id: 'o1', version: 'a'.repeat(64) };
    expect(cdrSelectionSchema.safeParse([entry, entry]).success).toBe(false);
    expect(cdrSelectionSchema.safeParse(Array.from({ length: 101 }, (_, i) => ({ ...entry, id: String(i) }))).success).toBe(false);
  });
  it('default spans previous days; dates use Shanghai boundaries', () => {
    expect(workbenchWhere(cdrWorkbenchFilterSchema.parse({})).purpose).toEqual({ not: 'SAMPLE_SHIPMENT' });
    expect(workbenchWhere(cdrWorkbenchFilterSchema.parse({ scope: 'all' })).purpose).toBeUndefined();
    expect(workbenchWhere(cdrWorkbenchFilterSchema.parse({})).submittedAt).toEqual({ not: null });
    expect(workbenchWhere(cdrWorkbenchFilterSchema.parse({ from: '2026-10-02' })).submittedAt).toEqual({ not: null, gte: new Date('2026-10-01T16:00:00Z') });
  });
  it('revalidates current selection and catches edits, additions, deletion and missing orders', async () => {
    const row = order(); const selected = [{ id: row.id, version: workbenchOrderFacts(row).version }];
    db.order.findMany.mockResolvedValue([row]);
    const collected = await collectWorkbenchSelection(selected);
    expect(collected.designIds).toEqual(['o1-cdr']);
    expect(collected.manifest.files[0].folders[0]).toMatch(/^同名销售_[a-f0-9]{8}$/);
    row.items[0].designs[0].fileUrl = 'https://example.com/design/changed.cdr';
    await expect(collectWorkbenchSelection(selected)).rejects.toThrow('已更新');
    await expect(validateWorkbenchManifest(collected.manifest)).rejects.toThrow('已更新');
    db.order.findMany.mockResolvedValue([]);
    await expect(collectWorkbenchSelection(selected)).rejects.toThrow('已变更');
  });
  it('marks changed files against the most recent real snapshot, preserves uncertainty for legacy packages', async () => {
    const a = order(); const b = order('o2'); const c = order('o3');
    db.order.findMany.mockResolvedValue([a, b, c]);
    db.$queryRaw.mockResolvedValue([
      { orderId: a.id, fingerprint: 'old' },
      { orderId: b.id, fingerprint: workbenchOrderFacts(b).fingerprint },
      { orderId: c.id, fingerprint: null },
    ]);
    expect((await listWorkbenchOrders(cdrWorkbenchFilterSchema.parse({}))).orders.map((o) => o.packageState)).toEqual(['updated', 'unchanged', 'unknown']);
  });
});

it('normal production transitions do not invalidate unchanged files', () => {
  const row = order(); const version = workbenchOrderFacts(row).version;
  row.status = 'RELEASED';
  expect(workbenchOrderFacts(row).salesId).toBe('sales1');
  expect(workbenchOrderFacts(row).version).toBe(version);
});
it('clamps out-of-range pages before querying', async () => {
  db.order.count.mockResolvedValue(101); db.order.findMany.mockResolvedValue([]);
  const result = await listWorkbenchOrders(cdrWorkbenchFilterSchema.parse({ page: 999 }));
  expect(result.page).toBe(2);
  expect(db.order.findMany.mock.calls[0][0].skip).toBe(100);
});
it('rejects invalid and nested unmatched storage addresses', () => {
  const row = order(); row.items[0].designs[0].fileUrl = 'https://example.com/wrong/design/file.cdr';
  expect(workbenchOrderFacts(row).issue).toBe('文件地址异常');
});
