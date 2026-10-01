import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 回归：启用/停用成功后，action 的 revalidatePath 让同一次响应带着翻转后的
// isActive 重渲；组件不重挂，成功结果仍在。回执必须按提交时的目标状态播报，
// 不能按已经翻转的 currentlyActive 推导（旧实现会把「已停用」播成「已启用」）。
const { actionState, captured, actions } = vi.hoisted(() => ({
  actionState: { current: null as Record<string, unknown> | null },
  captured: { fn: null as null | ((prev: unknown, formData: FormData) => Promise<unknown>) },
  actions: {
    ok: async () => ({ status: 'success' as const }),
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: (fn: (prev: unknown, formData: FormData) => Promise<unknown>) => {
      captured.fn = fn;
      return [actionState.current, vi.fn(), false];
    },
  };
});

vi.mock('@/actions/owner-accounts', () => ({ setUserActiveAction: vi.fn(actions.ok) }));
vi.mock('@/actions/owner-boms', () => ({ setBomActiveAction: vi.fn(actions.ok) }));
vi.mock('@/actions/owner-crafts', () => ({ setCraftActiveAction: vi.fn(actions.ok) }));
vi.mock('@/actions/owner-materials', () => ({ setMaterialActiveAction: vi.fn(actions.ok) }));
vi.mock('@/actions/owner-parties', () => ({ setPartyActiveAction: vi.fn(actions.ok) }));
vi.mock('@/actions/owner-product-categories', () => ({
  setProductCategoryNodeActiveAction: vi.fn(actions.ok),
}));
vi.mock('@/actions/owner-products', () => ({ setQuoteProductActiveAction: vi.fn(actions.ok) }));

import { ToggleActiveButton as AccountToggle } from '@/components/business/account/ToggleActiveButton';
import { ToggleBomActiveButton } from '@/components/business/bom/ToggleBomActiveButton';
import { ToggleActiveButton as CraftToggle } from '@/components/business/craft/ToggleActiveButton';
import { ToggleMaterialActiveButton } from '@/components/business/material/ToggleMaterialActiveButton';
import { TogglePartyActiveButton } from '@/components/business/party/TogglePartyActiveButton';
import { ToggleProductCategoryActiveButton } from '@/components/business/product-category/ToggleProductCategoryActiveButton';
import { ToggleActiveButton as ProductToggle } from '@/components/business/product/ToggleActiveButton';

const impact = { orderCount: 0, bomCount: 0, currentExternalPriceRuleCount: 0 };

const CASES: {
  name: string;
  render: (currentlyActive: boolean) => ReactElement;
  deactivated: string;
  activated: string;
}[] = [
  { name: 'account', render: (a) => <AccountToggle userId="u" currentlyActive={a} />, deactivated: '账号已停用', activated: '账号已激活' },
  { name: 'bom', render: (a) => <ToggleBomActiveButton bomId="b" currentlyActive={a} />, deactivated: '用料清单已停用', activated: '用料清单已启用' },
  { name: 'craft', render: (a) => <CraftToggle craftId="c" currentlyActive={a} />, deactivated: '工艺已停用', activated: '工艺已启用' },
  { name: 'material', render: (a) => <ToggleMaterialActiveButton materialId="m" currentlyActive={a} />, deactivated: '物料已停用', activated: '物料已启用' },
  { name: 'party', render: (a) => <TogglePartyActiveButton partyId="p" currentlyActive={a} />, deactivated: '客户/供应商已停用', activated: '客户/供应商已启用' },
  { name: 'category', render: (a) => <ToggleProductCategoryActiveButton nodeId="n" currentlyActive={a} />, deactivated: '分类已停用', activated: '分类已启用' },
  { name: 'product', render: (a) => <ProductToggle productId="x" currentlyActive={a} impact={impact} />, deactivated: '产品已停用', activated: '产品已启用' },
];

beforeEach(() => {
  actionState.current = null;
  captured.fn = null;
});

describe.each(CASES)('$name active toggle receipt', ({ render, deactivated, activated }) => {
  it('records the submitted target state in the action result', async () => {
    renderToStaticMarkup(render(true));
    await expect(captured.fn?.(null, new FormData())).resolves.toMatchObject({
      status: 'success',
      appliedActive: false,
    });
    renderToStaticMarkup(render(false));
    await expect(captured.fn?.(null, new FormData())).resolves.toMatchObject({
      status: 'success',
      appliedActive: true,
    });
  });

  it('announces a deactivation after revalidation has flipped the prop', () => {
    actionState.current = { status: 'success', appliedActive: false };
    const html = renderToStaticMarkup(render(false));
    expect(html).toContain(deactivated);
    expect(html).not.toContain(activated);
  });

  it('announces an activation after revalidation has flipped the prop', () => {
    actionState.current = { status: 'success', appliedActive: true };
    const html = renderToStaticMarkup(render(true));
    expect(html).toContain(activated);
    expect(html).not.toContain(deactivated);
  });
});
