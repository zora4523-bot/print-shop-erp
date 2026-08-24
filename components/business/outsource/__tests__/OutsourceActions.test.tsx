import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OutsourceReceiveFeedback } from '../OutsourceReceiveFeedback';

const actionsSource = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'outsource',
    'OutsourceActions.tsx',
  ),
  'utf8',
);

describe('OutsourceReceiveFeedback', () => {
  it('收货表单被刷新卸载后，覆盖缺口 notice 仍可独立渲染', () => {
    const notice =
      '工单尚未完工：款式 2「红包 B」还没有对应的外协单';
    const html = renderToStaticMarkup(
      <OutsourceReceiveFeedback
        state={{ status: 'success', id: 'outsource-1', notice }}
      />,
    );

    expect(html).toContain(notice);
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('已标记回货，但工单尚未生产完工');
    expect(html).not.toContain('<form');
  });

  it('回货与取消都经过 L2 影响确认，不从原按钮直接提交', () => {
    expect(actionsSource.match(/<ConfirmActionDialog/g)).toHaveLength(2);
    expect(
      actionsSource.match(/<ConfirmActionDialog\s+level="L2"/g),
    ).toHaveLength(2);
    expect(actionsSource).toContain('formId={receiveFormId}');
    expect(actionsSource).toContain('formId={cancelFormId}');
    expect(actionsSource).toContain('onSubmit={handleReceiveSubmit}');
    expect(actionsSource).toContain('confirmedReceiveRef.current = true');
    expect(actionsSource).toContain('已回货终态，不能直接回退');
    expect(actionsSource).toContain('不会自动确认外协应付金额');
    expect(actionsSource).toContain('已取消终态');
    expect(actionsSource).not.toContain('<Button type="submit"');
  });
});
