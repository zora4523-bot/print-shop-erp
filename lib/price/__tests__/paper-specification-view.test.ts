import { describe, expect, it } from 'vitest';
import { buildPaperSpecificationView } from '../paper-specification-view';
import { unassignedPaperProducts } from '../unassigned-paper-products';
import type { CreateOrderPriceSnapshot } from '../create-order/types';
import { ProductCategory } from '@/generated/prisma/enums';
const paper = { id: 'paper', name: '160g红卡', specification: '160g', isActive: true, outOfStock: false };
const product = { categoryNode: { isActive: true, path: 'product.blank_stock', legacyCategory: ProductCategory.BLANK_STOCK }, id: 'product', category: ProductCategory.BLANK_STOCK, specification: '中号封80×115', paperType: '160g红卡', weight: 160, paperMaterialId: 'paper', isActive: true };
const snapshot = { partial: { blankUnitPrices: [{ paperType: '红卡', paperWeightGsm: 160, specification: '中号封', unitPrice: '0.1234' }] },
  orderCharges: { logisticsPolicy: { billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE', gramsPerItemByPaperWeightGsm: { '160': '2' } } },
} as unknown as CreateOrderPriceSnapshot;
const input = { paper, papers: [paper], products: [product], selectableProducts: [product], selectablePapers: [paper], snapshot, nodeReady: true };
const mid = (data: Parameters<typeof buildPaperSpecificationView>[0] = input) => buildPaperSpecificationView(data).cells.find((cell) => cell.key === 'mid')!;
describe('纸张规格状态来自现有目录和报价选择器', () => {
  it('已启用不可取消，按文本而非产品 ID 显示四位单价', () => {
    expect(mid()).toMatchObject({ state: 'enabled', canEnable: false, availability: '建单可选', price: '0.1234' });
  });
  it('缺货关联纸仍展示禁选，未关联旧产品按目录现状可选', () => {
    expect(mid({ ...input, selectablePapers: [{ ...paper, outOfStock: true }] }).availability).toBe('暂不可选');
    expect(mid({ ...input, selectableProducts: [{ ...product, paperMaterialId: null }], selectablePapers: [] }).availability).toBe('建单可选');
  });
  it('分类过滤后的产品不显示建单可选', () => {
    expect(mid({ ...input, selectableProducts: [] }).availability).toBe('未进入建单选项');
  });
  it('未建产品仍能显示文本匹配的现行价，零价不是缺价', () => {
    const data = { ...input, products: [], selectableProducts: [], snapshot: { ...snapshot, partial: { ...snapshot.partial, blankUnitPrices: [{ ...snapshot.partial.blankUnitPrices[0]!, unitPrice: '0' }] } } };
    expect(mid(data)).toMatchObject({ state: 'unconfigured', canEnable: true, price: '0' });
    expect(mid({ ...data, snapshot: { ...snapshot, partial: { ...snapshot.partial, blankUnitPrices: [] } } }).price).toBeNull();
  });
  it('停用候选可重启，启用别名或多条候选须处理', () => {
    expect(mid({ ...input, products: [{ ...product, isActive: false }] })).toMatchObject({ state: 'inactive', canEnable: true });
    for (const products of [[{ ...product, specification: '中号封' }], [product, { ...product, id: 'two' }]]) {
      expect(mid({ ...input, products })).toMatchObject({ state: 'needs-attention', canEnable: false });
    }
  });
  it('重复纸身份及不可用节点均阻止新增', () => {
    expect(mid({ ...input, products: [], papers: [paper, { ...paper, id: 'off', isActive: false }] }).canEnable).toBe(false);
    expect(mid({ ...input, products: [], nodeReady: false }).canEnable).toBe(false);
  });
  it('无法读取价格与缺价明确区分，物流单重未配置不伪造', () => {
    const view = buildPaperSpecificationView({ ...input, snapshot: null });
    expect(view.priceReadable).toBe(false);
    expect(view.logisticsConfigured).toBe(false);
  });
  it('未归属列表包含彩印并按文本匹配全部 PAPER，不自动建纸', () => {
    const orphan = { ...product, id: 'orphan', category: ProductCategory.COLOR_PRINT, paperType: '200g铜版纸', weight: 200 };
    expect(unassignedPaperProducts([product, orphan, { ...orphan, id: 'off', isActive: false }], [paper])).toEqual([orphan]);
  });
});

it('合法停用候选所在分类失效时不能勾选', () => {
  expect(mid({ ...input, products: [{ ...product, isActive: false, categoryNode: { ...product.categoryNode, isActive: false } }] }))
    .toMatchObject({ state: 'inactive', canEnable: false, blockedReason: '产品分类已停用或退役，请检查相关组合' });
});
