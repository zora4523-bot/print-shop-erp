import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepairLegacyProductionFactsResult } from '@/actions/order-production-facts.types';
const hooks = vi.hoisted(() => ({ state: null as RepairLegacyProductionFactsResult | null, pending: false }));
vi.mock('@/actions/order-production-facts', () => ({ repairLegacyProductionFactsAction: vi.fn() }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useActionState: () => [hooks.state, () => {}, hooks.pending] }));
import { LegacyProductionFactsRepairForm } from '../LegacyProductionFactsRepairForm';
const facts = { orderId: 'order-1', expectedOrderRevision: 2, needsPackaging: true, packagingMode: undefined,
  items: [{ id: 'item-1', name: '红包', sequence: 1, quantity: 751, craft: null, pack: null }, { id: 'item-2', name: '旧款', sequence: 2, quantity: 100, craft: 'FULL' as const, pack: 10 }] };
beforeEach(() => { hooks.state = null; hooks.pending = false; });
describe('LegacyProductionFactsRepairForm SSR', () => {
  it('只为缺失工艺和 pack 提供非受控字段，已有 pack 只读展示', () => {
    const html = renderToStaticMarkup(<LegacyProductionFactsRepairForm canRepair facts={facts} />);
    expect(html).toContain('name="items.0.craft"'); expect(html).not.toContain('name="items.1.craft"');
    expect(html).toContain('局部烫金'); expect(html).toContain('专版烫金'); expect(html).toContain('彩印');
    expect(html).toContain('name="items.0.unitsPerBag"'); expect(html).not.toContain('name="items.1.unitsPerBag"');
    expect(html).toContain('readOnly=""'); expect(html).toContain('name="packagingMode"'); expect(html).toContain('name="expectedOrderRevision"');
  });
  it('已有包装组不提供包装字段，pending 禁用提交', () => {
    hooks.pending = true;
    const html = renderToStaticMarkup(<LegacyProductionFactsRepairForm canRepair facts={{ ...facts, needsPackaging: false }} />);
    expect(html).not.toContain('name="packagingMode"'); expect(html).not.toContain('name="items.0.unitsPerBag"'); expect(html).toContain('disabled=""'); expect(html).toContain('正在保存…');
  });
  it('服务端未授权展示时不渲染表单', () => {
    expect(renderToStaticMarkup(<LegacyProductionFactsRepairForm canRepair={false} facts={facts} />)).toBe('');
  });
  it('invalid 显示行级错误', () => {
    hooks.state = { status: 'invalid', fieldErrors: { 'items.0.craft': ['请选择工艺'] } };
    expect(renderToStaticMarkup(<LegacyProductionFactsRepairForm canRepair facts={facts} />)).toContain('aria-invalid="true"');
  });
});
