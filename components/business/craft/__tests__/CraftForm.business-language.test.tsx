import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CraftMutationResult } from '@/actions/owner-crafts.types';
import { MachineType, WorkerType } from '@/generated/prisma/enums';

const { actionState } = vi.hoisted(() => ({
  actionState: { current: null as CraftMutationResult | null },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), false],
  };
});

import { CraftForm } from '../CraftForm';

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('CraftForm business language', () => {
  const action = vi.fn(async () => ({ status: 'success' as const }));

  beforeEach(() => {
    actionState.current = null;
  });

  it('lets the server generate the code when creating a craft', () => {
    const html = renderToStaticMarkup(
      <CraftForm mode="create" action={action} />,
    );

    expect(visibleText(html)).not.toContain('工艺代码');
    expect(visibleText(html)).not.toContain('自定义代码');
    expect(html).not.toContain('name="code"');
  });

  it('编辑时不把稳定内部编号交给客户端', () => {
    const internalCode = 'INTERNAL_CRAFT_CODE';
    const html = renderToStaticMarkup(
      <CraftForm
        mode="edit"
        action={action}
        initial={{
          name: '局部烫金',
          isOutsource: false,
          defaultWorkerType: WorkerType.MACHINE,
          defaultMachineType: MachineType.HAND_PRESS,
          sortOrder: 10,
          isActive: true,
        }}
      />,
    );

    const text = visibleText(html);
    expect(text).not.toContain('工艺代码');
    expect(text).not.toContain(internalCode);
    expect(html).not.toContain('name="code"');
  });

  it('历史服务端返回未归属字段错误时仍给出可见反馈', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        code: ['INTERNAL_CRAFT_CODE 已被占用'],
      },
    };

    const html = renderToStaticMarkup(
      <CraftForm mode="create" action={action} />,
    );
    const text = visibleText(html);

    expect(text).toContain('部分设置无法保存，请刷新后重试');
    expect(text).not.toContain('INTERNAL_CRAFT_CODE');
  });
});
