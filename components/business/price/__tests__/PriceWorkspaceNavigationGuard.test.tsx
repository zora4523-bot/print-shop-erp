import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  guardedPriceWorkspaceDestination,
  PriceWorkspaceUnsavedSummary,
  unsavedTierNavigationMessage,
} from '../PriceWorkspaceNavigationGuard';

describe('PriceWorkspaceNavigationGuard', () => {
  it('只说明未保存修改的离开后果', () => {
    const message = unsavedTierNavigationMessage(1_200);

    expect(message).toContain('1,200 个档位尚未保存');
    expect(message).toContain('离开后将丢失这些修改');
    expect(message).not.toContain('本地');
    expect(message).not.toContain('服务器');
  });

  it('未进入阶梯编辑时显示当前状态', () => {
    const html = renderToStaticMarkup(<PriceWorkspaceUnsavedSummary />);

    expect(html).toContain('当前未编辑价格阶梯');
    expect(html).not.toContain('右侧表单');
  });

  it('全局侧栏切换价格分区时也会进入离开保护', () => {
    const current =
      'http://localhost:3000/owner/rules/customer-pricing?section=tiers';

    expect(
      guardedPriceWorkspaceDestination(
        current,
        '/owner/rules/customer-pricing?section=print',
      ),
    ).toBe('/owner/rules/customer-pricing?section=print');
    expect(
      guardedPriceWorkspaceDestination(current, `${current}#matrix`),
    ).toBeNull();
    expect(
      guardedPriceWorkspaceDestination(current, 'https://example.com/rules'),
    ).toBeNull();
  });
});
