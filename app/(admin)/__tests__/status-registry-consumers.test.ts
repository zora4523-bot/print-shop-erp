import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('high-risk status registry consumers', () => {
  it('uses one bill registry across owner, sales, list, and detail views', () => {
    const files = [
      'app/(admin)/owner/bills/page.tsx',
      'app/(admin)/owner/bills/[id]/page.tsx',
      'app/(admin)/sales/bills/page.tsx',
      'app/(admin)/sales/bills/[id]/page.tsx',
    ];

    for (const file of files) {
      expect(source(file), file).toContain('BILL_STATUS_REGISTRY');
    }
    expect(source(files[1]!)).not.toContain(
      '<Badge variant="destructive">{label}</Badge>',
    );
    expect(source(files[3]!)).not.toContain(
      '<Badge variant="destructive">{label}</Badge>',
    );
  });

  it('centralizes notification and background-job labels and tones', () => {
    const notificationPage = source(
      'app/(admin)/owner/notifications/page.tsx',
    );
    expect(notificationPage).toContain('NOTIFICATION_STATUS_REGISTRY[status]');
    expect(notificationPage).toContain(
      'BACKGROUND_JOB_STATUS_REGISTRY[status]',
    );
    expect(source('app/(admin)/owner/background-jobs/page.tsx')).toContain(
      'BACKGROUND_JOB_STATUS_REGISTRY[status]',
    );
  });

  it('shares salary period and payment badge adapters', () => {
    const files = [
      'app/(admin)/owner/salary/cs/page.tsx',
      'app/(admin)/owner/salary/cs/[id]/page.tsx',
      'app/(admin)/owner/salary/daily/page.tsx',
      'app/(admin)/owner/salary/daily/[id]/page.tsx',
      'app/(admin)/owner/salary/hourly/page.tsx',
      'app/(worker)/worker/salary/page.tsx',
      'app/(worker)/worker/salary/[id]/page.tsx',
    ];

    for (const file of files) {
      expect(source(file), file).toMatch(
        /(?:Payment|SalaryPeriod)StatusBadge/,
      );
    }
    expect(source(files[1]!)).not.toContain(
      '<Badge variant="destructive">待结算</Badge>',
    );
  });

  it('centralizes order-change, outsource, production-task, and price-version states', () => {
    const consumers: Array<[string, string]> = [
      [
        'app/(admin)/owner/order-changes/page.tsx',
        'ORDER_CHANGE_REQUEST_STATUS_REGISTRY',
      ],
      [
        'app/(admin)/orders/[id]/page.tsx',
        'ORDER_CHANGE_REQUEST_STATUS_REGISTRY',
      ],
      [
        'app/(admin)/foreman/outsource/page.tsx',
        'OUTSOURCE_STATUS_REGISTRY',
      ],
      [
        'app/(admin)/foreman/outsource/[id]/page.tsx',
        'OUTSOURCE_STATUS_REGISTRY',
      ],
      ['app/(admin)/owner/page.tsx', 'OUTSOURCE_STATUS_REGISTRY'],
      [
        'components/business/production/WorkerTaskBatchList.tsx',
        'PRODUCTION_TASK_STATUS_REGISTRY',
      ],
      [
        'app/(worker)/worker/tasks/[id]/page.tsx',
        'PRODUCTION_TASK_STATUS_REGISTRY',
      ],
      [
        'app/(worker)/worker/orders/[id]/page.tsx',
        'PRODUCTION_TASK_STATUS_REGISTRY',
      ],
      [
        'components/business/price/ExternalSalesPriceBookVersionPanel.tsx',
        'CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY',
      ],
    ];

    for (const [file, registry] of consumers) {
      expect(source(file), file).toContain(registry);
    }

    expect(
      source('app/(admin)/foreman/outsource/page.tsx'),
    ).not.toContain('const STATUS_LABELS');
    expect(
      source('components/business/price/ExternalSalesPriceBookVersionPanel.tsx'),
    ).not.toContain('statusBadgeClass');
  });

  it('centralizes purchase, shipment, CDR, export, and order-filter status UI', () => {
    const consumers: Array<[string, string]> = [
      [
        'components/business/purchase/PurchaseStatusBadge.tsx',
        'PURCHASE_ORDER_STATUS_REGISTRY',
      ],
      [
        'components/business/purchase/PurchaseStatusBadge.tsx',
        'PURCHASE_RECEIPT_STATUS_REGISTRY',
      ],
      [
        'components/business/order/ShipmentStatusBadge.tsx',
        'SHIPMENT_STATUS_REGISTRY',
      ],
      [
        'app/(admin)/foreman/cdr/page.tsx',
        'DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY',
      ],
      [
        'components/business/order/OrderExportControls.tsx',
        'ORDER_EXPORT_STATUS_REGISTRY',
      ],
      [
        'components/business/order/OrderAdvancedFilters.tsx',
        'SHIPMENT_STATUS_REGISTRY',
      ],
      [
        'components/business/order/OrderAdvancedFilters.tsx',
        'PRODUCTION_TASK_STATUS_REGISTRY',
      ],
      [
        'components/business/order/OrderAdvancedFilters.tsx',
        'OUTSOURCE_STATUS_REGISTRY',
      ],
      [
        'components/business/order/OrderListFilters.tsx',
        'SHIPMENT_STATUS_REGISTRY',
      ],
    ];

    for (const [file, registry] of consumers) {
      expect(source(file), file).toContain(registry);
    }

    expect(
      source('components/business/purchase/PurchaseOrdersTable.tsx'),
    ).toContain('PurchaseOrderStatusBadge');
    expect(source('app/(admin)/owner/purchases/[id]/page.tsx')).toContain(
      'PurchaseReceiptStatusBadge',
    );
    expect(source('app/(admin)/owner/warehouses/page.tsx')).toContain(
      'PurchaseOrderStatusBadge',
    );
    expect(source('app/(admin)/orders/[id]/page.tsx')).toContain(
      'ShipmentStatusBadge',
    );

    const filterFields = source(
      'components/business/order/OrderListFilterFields.tsx',
    );
    expect(filterFields).not.toContain('SHIPMENT_STATUS_LABELS');
    expect(filterFields).not.toContain('TASK_STATUS_LABELS');
    expect(filterFields).not.toContain('OUTSOURCE_STATUS_LABELS');
    expect(source('lib/purchase.ts')).not.toContain(
      'PURCHASE_ORDER_STATUS_LABELS',
    );
    expect(source('lib/purchase.ts')).not.toContain(
      'PURCHASE_RECEIPT_STATUS_LABELS',
    );

    // Excel 生成是服务端领域输出，不反向依赖 UI 注册表。
    expect(source('lib/order/export.ts')).not.toContain(
      "@/lib/ui/status-registry",
    );
  });

  it('uses the shared order registry and keeps domain maps out of the badge atom', () => {
    expect(
      source('components/business/order/OrderStatusBadge.tsx'),
    ).toContain('ORDER_STATUS_REGISTRY');
    const badgeAtom = source('components/ui-business/StatusBadge.tsx');
    expect(badgeAtom).not.toContain('ORDER_STATUS_TO_BADGE');
    expect(badgeAtom).not.toContain('BILL_STATUS_TO_BADGE');
  });
});
