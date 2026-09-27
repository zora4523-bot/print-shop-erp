import { describe, expect, it } from 'vitest';
import { FORM_DRAFT_PREFIX, FORM_DRAFT_TTL, bomDraftSchema, draftStorageKey, emptyBomDraft, emptyPurchaseDraft, parseStoredDraft, type StoredDraft } from '../model';
import { readSupplementContext, supplementCreateHref, supplementParams, supplementReturnHref } from '../return-context';
import { cleanupDrafts, completedDraftIdentity, completeDraft, isDraftCompleted, listDrafts, saveDraft } from '../storage';

const draftId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const nonce = '33333333-3333-4333-8333-333333333333';
const now = 1790512246000;
const record = (): StoredDraft => ({ schemaVersion: 1, actorId: 'admin-1', sessionScope: nonce,
  kind: 'purchase-new', draftId, clientRequestId: requestId, savedAt: now,
  payload: { ...emptyPurchaseDraft(), quantity: '123', unitCost: '0.', remark: '待补资料' }, supplement: null });

function storage() {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

describe('资料补录白名单协议', () => {
  it('只映射业务枚举，拒绝 URL 和伪造字段类型', () => {
    const context = { origin: 'purchase-new' as const, draftId, nonce, entityType: 'SUPPLIER' as const, target: 'supplierPartyId' };
    expect(readSupplementContext(supplementParams(context))).toEqual(context);
    expect(supplementReturnHref(context, 'supplier-1')).toContain('/owner/purchases/new?');
    expect(supplementCreateHref(context, true)).toContain('/owner/parties?');
    for (const origin of ['https://evil.example', '//evil.example', '/owner/purchases/new', 'bom-new']) {
      expect(readSupplementContext({ ...supplementParams(context), form_origin: origin })).toBeNull();
    }
    expect(readSupplementContext({ ...supplementParams(context), form_target: 'materialId' })).toBeNull();
    expect(readSupplementContext({ ...supplementParams(context), form_nonce: ['x', nonce] })).toBeNull();
  });
  it('BOM 物料回填必须关联稳定行 ID', () => {
    const context = { origin: 'bom-new' as const, draftId, nonce, entityType: 'MATERIAL' as const, target: `row:${requestId}` };
    const fd = new FormData();
    for (const [key, value] of Object.entries(supplementParams(context))) fd.set(key, value);
    expect(readSupplementContext(fd)).toEqual(context);
    fd.set('form_target', 'row:1');
    expect(readSupplementContext(fd)).toBeNull();
  });
});

describe('完整草稿与标签页存储', () => {
  it('保留部分金额文本，拒绝跨身份、过期、未来时间、旧 schema 与损坏内容', () => {
    expect(parseStoredDraft(JSON.stringify(record()), 'admin-1', now)?.payload).toMatchObject({ unitCost: '0.', quantity: '123' });
    expect(parseStoredDraft(JSON.stringify(record()), 'sales-1', now)).toBeNull();
    expect(parseStoredDraft(JSON.stringify(record()), 'admin-1', now + FORM_DRAFT_TTL + 1)).toBeNull();
    expect(parseStoredDraft(JSON.stringify(record()), 'admin-1', now - 60_001)).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ ...record(), schemaVersion: 0 }), 'admin-1', now)).toBeNull();
    expect(parseStoredDraft('{broken', 'admin-1', now)).toBeNull();
    expect(parseStoredDraft('x'.repeat(80_001), 'admin-1', now)).toBeNull();
  });
  it('拒绝超长字段、重复行 ID、过量行、错误来源关联', () => {
    const bom = emptyBomDraft(requestId);
    expect(bomDraftSchema.safeParse({ ...bom, rows: [bom.rows[0], bom.rows[0]] }).success).toBe(false);
    expect(bomDraftSchema.safeParse({ ...bom, rows: Array(21).fill(bom.rows[0]) }).success).toBe(false);
    expect(parseStoredDraft(JSON.stringify({ ...record(), payload: { ...emptyPurchaseDraft(), remark: 'x'.repeat(2001) } }), 'admin-1', now)).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ ...record(), supplement: { origin: 'purchase-new', draftId: requestId, nonce, entityType: 'MATERIAL', target: 'materialId' } }), 'admin-1', now)).toBeNull();
  });
  it('删除第一行后保存第二行的值和原 ID，隐藏目标字段也保留', () => {
    const bom = { ...emptyBomDraft(draftId), productId: 'old-product', categoryNodeId: 'category-1',
      rows: [{ rowId: draftId, materialId: 'a', quantity: '11', remark: '' }, { rowId: requestId, materialId: 'b', quantity: '22', remark: '第二行' }] };
    const parsed = bomDraftSchema.parse({ ...bom, rows: bom.rows.filter((row) => row.rowId !== draftId) });
    expect(parsed).toMatchObject({ productId: 'old-product', categoryNodeId: 'category-1', rows: [{ rowId: requestId, quantity: '22' }] });
  });
  it('成功后旧组件不能重新写回草稿，失败暂存仍保留', () => {
    const store = storage();
    saveDraft(store, record());
    expect(listDrafts(store, 'admin-1', 'purchase-new', now)).toHaveLength(1);
    completeDraft(store, record(), now);
    expect(isDraftCompleted(store, record(), now)).toBe(true);
    // The receipt retains identity so a cached back-navigation must verify it.
    expect(completedDraftIdentity(store, record())).toEqual({ draftId, clientRequestId: requestId });
    expect(saveDraft(store, record())).toBe(false);
    expect(listDrafts(store, 'admin-1', 'purchase-new', now)).toEqual([]);
  });
  it('仅清理本功能键，按已认证身份和权限隔离', () => {
    const store = storage();
    store.setItem('unrelated', 'keep');
    saveDraft(store, record());
    saveDraft(store, { ...record(), actorId: 'admin-2' });
    cleanupDrafts(store, 'admin-1', ['purchase-new'], now);
    expect(store.getItem(draftStorageKey(record()))).not.toBeNull();
    expect(store.getItem(draftStorageKey({ ...record(), actorId: 'admin-2' }))).toBeNull();
    cleanupDrafts(store, 'admin-1', [], now);
    expect(store.length).toBe(1);
    expect(store.getItem('unrelated')).toBe('keep');
  });
  it('不隐藏存储失败，不承诺已暂存', () => {
    const store = storage();
    store.setItem = () => { throw new Error('quota'); };
    expect(() => saveDraft(store, record())).toThrow('quota');
  });
  it('有界保留最近八份草稿', () => {
    const store = storage();
    for (let i = 0; i < 12; i++) saveDraft(store, { ...record(), draftId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, savedAt: now + i });
    expect(listDrafts(store, 'admin-1', 'purchase-new', now + 12)).toHaveLength(8);
    expect(store.key(0)).toContain(FORM_DRAFT_PREFIX);
  });
});
