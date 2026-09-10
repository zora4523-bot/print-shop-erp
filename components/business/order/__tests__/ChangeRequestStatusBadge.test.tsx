import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  OrderChangeRequestStatus,
  OrderChangeRequestType,
} from '@/generated/prisma/enums';
import {
  ChangeRequestStatusBadge,
  ChangeRequestTypeBadge,
} from '../ChangeRequestStatusBadge';

// 这两颗徽章原本在 app/(admin)/orders/[id]/page.tsx 与
// app/(admin)/owner/order-changes/page.tsx 各写一份，归并到此后由本文件
// 兜住两条约定：状态走 StatusBadge（带 data-tone），类型走 shadcn Badge
// （不带 data-tone，视觉上不与同排的状态徽章同权）。

describe('ChangeRequestStatusBadge', () => {
  it('待审核走 warning 并带圆点', () => {
    const html = renderToStaticMarkup(
      <ChangeRequestStatusBadge status={OrderChangeRequestStatus.PENDING} />,
    );

    expect(html).toContain('data-slot="badge"');
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('待审核');
  });

  it('已批准走 success，已拒绝走 danger', () => {
    const approved = renderToStaticMarkup(
      <ChangeRequestStatusBadge status={OrderChangeRequestStatus.APPROVED} />,
    );
    const rejected = renderToStaticMarkup(
      <ChangeRequestStatusBadge status={OrderChangeRequestStatus.REJECTED} />,
    );

    expect(approved).toContain('data-tone="success"');
    expect(approved).toContain('已批准');
    expect(rejected).toContain('data-tone="danger"');
    expect(rejected).toContain('已拒绝');
  });

  it('每个持久化状态都渲染中文标签，不外显枚举值', () => {
    for (const status of Object.values(OrderChangeRequestStatus)) {
      const html = renderToStaticMarkup(
        <ChangeRequestStatusBadge status={status} />,
      );

      expect(html).toContain('data-tone=');
      expect(html).not.toContain(status);
    }
  });
});

describe('ChangeRequestTypeBadge', () => {
  it('类型标签读注册表文案，不再由页面写死中文三元', () => {
    const modify = renderToStaticMarkup(
      <ChangeRequestTypeBadge type={OrderChangeRequestType.MODIFY} />,
    );
    const cancel = renderToStaticMarkup(
      <ChangeRequestTypeBadge type={OrderChangeRequestType.CANCEL} />,
    );

    expect(modify).toContain('修改申请');
    expect(cancel).toContain('取消申请');
  });

  it('类型不是状态：不带 tone，也不套用状态徽章的实心底色', () => {
    const html = renderToStaticMarkup(
      <ChangeRequestTypeBadge type={OrderChangeRequestType.CANCEL} />,
    );

    expect(html).not.toContain('data-tone');
  });
});
