import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SalaryPeriodStatus } from '@/generated/prisma/enums';
import {
  PaymentStatusBadge,
  SalaryPeriodStatusBadge,
} from '../SalaryStatusBadge';

describe('SalaryStatusBadge', () => {
  it('renders unpaid and ready-to-settle states as warning, not danger', () => {
    const unpaid = renderToStaticMarkup(
      <PaymentStatusBadge isPaid={false} />,
    );
    const ready = renderToStaticMarkup(
      <SalaryPeriodStatusBadge
        status={SalaryPeriodStatus.IN_PROGRESS}
        readyToSettle
      />,
    );

    expect(unpaid).toContain('data-tone="warning"');
    expect(unpaid).toContain('未发');
    expect(ready).toContain('data-tone="warning"');
    expect(ready).toContain('待结算');
    expect(unpaid).not.toContain('data-tone="danger"');
    expect(ready).not.toContain('data-tone="danger"');
  });

  it('renders paid and settled states as success', () => {
    const paid = renderToStaticMarkup(<PaymentStatusBadge isPaid />);
    const settled = renderToStaticMarkup(
      <SalaryPeriodStatusBadge status={SalaryPeriodStatus.SETTLED} />,
    );

    expect(paid).toContain('data-tone="success"');
    expect(settled).toContain('data-tone="success"');
  });
});
