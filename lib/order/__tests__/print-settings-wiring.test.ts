import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('print factory-name wiring', () => {
  it('浏览器与静态 HTML 共用 lib/order 的布局与数据契约', () => {
    const page = source('app/print/orders/[id]/page.tsx');
    const html = source('lib/order/print-html.tsx');
    const view = source('lib/order/print-view.ts');
    const layout = source('lib/order/print-layout.tsx');

    expect(page).toContain(
      "import { OrderPrintLayout } from '@/lib/order/print-layout'",
    );
    expect(html).toContain(
      "import { OrderPrintLayout } from './print-layout'",
    );
    expect(html).toContain("import type { PrintOrder } from './print-types'");
    expect(view).toContain("from './print-types'");
    expect(layout).toContain("from './print-types'");
    expect([html, view, layout].join('\n')).not.toContain(
      'components/business/order/OrderPrintLayout',
    );
  });

  it('浏览器打印读取当前厂名并显式传给共享布局', () => {
    const page = source('app/print/orders/[id]/page.tsx');

    expect(page).toContain("getSetting('factory_name')");
    expect(page).toContain(
      '<OrderPrintLayout order={order} factoryName={factoryName} />',
    );
  });

  it('同步 PDF 读取当前厂名并传入静态 HTML', () => {
    const route = source('app/api/orders/[id]/pdf/route.ts');

    expect(route).toContain("getSetting('factory_name')");
    expect(route).toContain('buildPrintHtml(order, { factoryName })');
  });

  it('后台 PDF 任务在执行时读取当前厂名', () => {
    const job = source('lib/background-jobs/pdf.ts');

    expect(job).toContain("getSetting('factory_name')");
    expect(job).toContain('buildPrintHtml(order, { factoryName })');
  });
});
