import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PaymentStatusBadge } from '../SalaryStatusBadge';

describe('SalaryStatusBadge', () => {
  it('renders the unpaid state as warning, not danger', () => {
    const unpaid = renderToStaticMarkup(
      <PaymentStatusBadge isPaid={false} />,
    );

    expect(unpaid).toContain('data-tone="warning"');
    expect(unpaid).toContain('未发');
    expect(unpaid).not.toContain('data-tone="danger"');
  });

  it('renders the paid state as success', () => {
    const paid = renderToStaticMarkup(<PaymentStatusBadge isPaid />);

    expect(paid).toContain('data-tone="success"');
  });
});
