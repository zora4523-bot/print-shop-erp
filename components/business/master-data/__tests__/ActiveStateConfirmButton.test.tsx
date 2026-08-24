import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActiveStateConfirmButton } from '../ActiveStateConfirmButton';

describe('ActiveStateConfirmButton', () => {
  it('guards a deactivate action with an L2 dialog trigger', () => {
    const html = renderToStaticMarkup(
      <ActiveStateConfirmButton
        entityLabel="物料"
        currentlyActive
        pending={false}
        formId="material-active-form"
        deactivateImpactItems={['不再用于新业务选择', '历史记录继续保留']}
      />,
    );

    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('停用物料');
  });

  it('keeps pending activation disabled and visible', () => {
    const html = renderToStaticMarkup(
      <ActiveStateConfirmButton
        entityLabel="账号"
        currentlyActive={false}
        pending
        formId="account-active-form"
        activateVerb="激活"
        deactivateImpactItems={['无法登录']}
      />,
    );

    expect(html).toContain('正在激活账号…');
    expect(html).toContain('disabled');
  });
});
