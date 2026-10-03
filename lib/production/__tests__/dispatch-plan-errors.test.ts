import { expect, it } from 'vitest';
import { dispatchTargets } from '../dispatch-plan';
import { DispatchPlanValidationError } from '../dispatch-plan-error';

it('keeps incomplete order validation distinguishable from unexpected failures', () => {
  const order = {
    id: 'incomplete', orderNo: 'TEST-1', customName: '资料待完善', revision: 1, workOrderVersion: 1,
    items: [{ id: 'item', sequence: 1, quantity: 100, craft: null, crafts: [], frontFoilColors: [], backFoilColors: [] }],
    packagingGroups: [], shipments: [],
  } as unknown as Parameters<typeof dispatchTargets>[0];
  let failure: unknown;
  try { dispatchTargets(order, []); } catch (error) { failure = error; }
  expect(failure).toMatchObject({
    name: 'DispatchPlanValidationError',
    order: { id: 'incomplete', name: '资料待完善', revision: 1, version: 1 },
    issues: expect.arrayContaining(['款式 #1：生产工艺不明确，请完善工艺资料。', '未填写包装组，请完善包装资料。']),
  });
});

it('does not expose internal craft IDs, enum codes or unknown diagnostic messages', () => {
  const failure = new DispatchPlanValidationError(
    { id: 'a', customName: null, orderNo: 'A', revision: 1, workOrderVersion: 1 },
    [{ code: 'INACTIVE_CRAFT', message: '款式 #2 引用的历史工艺 PRIVATE_CODE 已停用' },
      { code: 'DUPLICATE_ITEM', message: '款式 private-item-id 重复' },
      { code: 'FUTURE_ISSUE', message: 'internal diagnostic' }],
  );
  expect(failure.issues).toEqual(['款式 #2：所选工艺已停用，请核对并选择可用工艺。', '款式重复，请核对款式资料。', '生产资料不完整，请核对工单资料。']);
});
