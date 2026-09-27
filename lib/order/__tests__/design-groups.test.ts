import { describe, expect, it } from 'vitest';
import { createBlankItem } from '../order-item-configuration';
import { designFileQueues, designItemIndexes, findDuplicateDesignNames, orderDesignGroups } from '../design-groups';
import { createOrderSchema } from '@/lib/auth/schemas';
import { buildExternalCreateOrderPayload } from '../external-create-order-payload';
import { parseExternalCreateOrderCommand } from '../external-create-order-command';
import { serializeLocalOrderFormDraft, parseLocalOrderFormDraft } from '@/components/business/order/order-form-local-draft';

const key = 'ade3197d-d8ee-49b6-bcbd-32f596fed888';
const first = { ...createBlankItem([]), name: '设计 A', productId: 'product-a', crafts: ['foil'], paperType: '160g红卡', paperWeightGsm: 160, actualWidthMm: 90, actualHeightMm: 165, designGroupKey: key, specification: '大号封', quantity: 100 };
const second = { ...first, fig: 2, specification: '中号封', quantity: 200 };
const other = { ...first, designGroupKey: null, name: '设计 B' };

describe('order design grouping', () => {
  it('keeps specifications under a design and historical ungrouped items independent', () => {
    expect(orderDesignGroups([first, other, second, other]).map((group) => group.indexes)).toEqual([[0, 2], [1], [3]]);
    expect(designItemIndexes([first, other, second], 2)).toEqual([0, 2]);
  });
  it('shares selected files only within a design and preserves them after removal', () => {
    const fields = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const files = [{ name: 'a.cdr' }, { name: 'a.png' }];
    const queues = designFileQueues([first, second, other], fields, { a: files, c: [{ name: 'b.cdr' }] });
    expect(queues.a).toEqual(files);
    expect(queues.b).toEqual(files);
    expect(queues.c).toEqual([{ name: 'b.cdr' }]);
    expect(designFileQueues([second, other], fields.slice(1), queues).b).toEqual(files);
    expect(designFileQueues([first, second], fields, { a: [], b: [] }).b).toEqual([]);
  });
  function order() {
    return createOrderSchema.parse({ clientSubmissionId: '260131a8-bcba-443c-a01d-a42e16392aef', customerRef: null, customName: '测试设计组', receiverName: '张三', receiverPhone: '13800138000', receiverAddress: '广东省佛山市测试地址',
      expressCode: null, packageRequirement: null, remark: null, isUrgent: false, isSfCollect: false,
      packagingGroups: [], additionalShipments: [], items: [first, second] });
  }
  it('retains grouping through local drafts and the external-sales authorization boundary', () => {
    const input = order();
    const result = parseExternalCreateOrderCommand(buildExternalCreateOrderPayload(input));
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (result.success) expect(result.data.items.map((item) => item.designGroupKey)).toEqual([key, key]);
    const serialized = serializeLocalOrderFormDraft(input, 'internal', new Date());
    expect(serialized).toContain(key);
    expect(parseLocalOrderFormDraft(serialized!, 'internal')).not.toBeNull();
  });
  it('rejects conflicting shared facts while preserving independent quantities and pricing lines', () => {
    const input = order();
    expect(input.items.map((item) => item.quantity)).toEqual([100, 200]);
    input.items[1].paperWeightGsm = 230;
    expect(createOrderSchema.safeParse(input).success).toBe(false);
    input.items[1].designGroupKey = null;
    input.items[1].name = '设计 B';
    expect(createOrderSchema.safeParse(input).success).toBe(true);
  });
  it('reports each colliding design once at its first row in the create schema', () => {
    const input = order();
    input.items.push({ ...first, designGroupKey: '6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b', fig: 3 }, { ...other, fig: 4, name: '设计 a' });
    const result = createOrderSchema.safeParse(input);
    expect(result.success).toBe(false);
    const issues = result.error!.issues.filter((issue) => issue.path.at(-1) === 'name');
    expect(issues.map((issue) => [issue.path, issue.message])).toEqual([
      [['items', 2, 'name'], '设计款名称不能重复：设计 A'],
      [['items', 3, 'name'], '设计款名称不能重复：设计 a'],
    ]);
  });
});

describe('design name uniqueness', () => {
  const otherKey = '6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b';
  it('lets specification rows of one design share (or keep differing) names', () => {
    expect(findDuplicateDesignNames([first, second])).toEqual([]);
    expect(findDuplicateDesignNames([first, { ...second, name: '旧草稿行名' }])).toEqual([]);
  });
  it('rejects two designs with the same name at the later design\'s first row', () => {
    const later = { ...first, designGroupKey: otherKey, fig: 3 };
    expect(findDuplicateDesignNames([first, second, other, later, { ...later, fig: 4 }])).toEqual([{ index: 3, name: '设计 A' }]);
  });
  it('treats whitespace and letter-case variants as the same name', () => {
    const lower = { ...first, designGroupKey: otherKey, name: '  设计 a ' };
    expect(findDuplicateDesignNames([first, lower])).toEqual([{ index: 1, name: '设计 a' }]);
    expect(findDuplicateDesignNames([{ ...first, name: 'Fu' }, { ...lower, name: 'FU' }])).toEqual([{ index: 1, name: 'FU' }]);
  });
  it('counts every legacy keyless row as its own design', () => {
    const legacy = { ...other, name: '福字款' };
    expect(findDuplicateDesignNames([legacy, { ...legacy, fig: 2 }, { ...legacy, fig: 3 }])).toEqual([{ index: 1, name: '福字款' }, { index: 2, name: '福字款' }]);
    expect(findDuplicateDesignNames([legacy, { ...legacy, name: '寿字款' }])).toEqual([]);
  });
  it('ignores empty names, leaving them to the required-name rule', () => {
    expect(findDuplicateDesignNames([{ ...other, name: '' }, { ...other, name: '  ' }, { ...first, name: '' }])).toEqual([]);
  });
});
