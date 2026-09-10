import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BillStatus } from '@/generated/prisma/enums';
import { BillStatusBadge } from '../BillStatusBadge';

describe('BillStatusBadge', () => {
  it('renders issued and partially paid bills as attention, not danger', () => {
    const issued = renderToStaticMarkup(
      <BillStatusBadge status={BillStatus.ISSUED} />,
    );
    const partial = renderToStaticMarkup(
      <BillStatusBadge status={BillStatus.PARTIAL_PAID} />,
    );

    expect(issued).toContain('data-tone="warning"');
    expect(issued).toContain('已发单');
    expect(partial).toContain('data-tone="info"');
    expect(partial).toContain('部分结清');
    expect(issued).not.toContain('data-tone="danger"');
    expect(partial).not.toContain('data-tone="danger"');
  });

  it('renders settled bills as success and drafts as neutral', () => {
    expect(
      renderToStaticMarkup(<BillStatusBadge status={BillStatus.FULLY_PAID} />),
    ).toContain('data-tone="success"');
    expect(
      renderToStaticMarkup(<BillStatusBadge status={BillStatus.DRAFT} />),
    ).toContain('data-tone="neutral"');
  });
});
