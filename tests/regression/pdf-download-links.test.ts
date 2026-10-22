import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function hrefTags(file: string, includes: (expression: string) => boolean): string[] {
  const source = ts.createSourceFile(file, readFileSync(path.resolve(file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tags: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const href = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'href');
      if (href && ts.isJsxAttribute(href) && href.initializer && includes(href.initializer.getText(source))) tags.push(node.tagName.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return tags;
}

describe('PDF download navigation', () => {
  /**
   * 业主 2026-10-22：单张工单 PDF 改为页内按钮交付，不再有任何指向下载接口的链接。链接会整页
   * 跳走——排队超过接口等待上限时落到 HTML 兜底页，管理员还要再点返回；中键在新标签页打开更会
   * 绕过「下载即记已打印」。原先这里只防 next/link，现在连原生 <a> 也不允许。
   */
  it.each([
    'components/business/order/AdminOrderDetailView.tsx',
    'app/(admin)/orders/[id]/page.tsx',
  ])('%s delivers the single-order PDF in place, never by navigating to the endpoint', (file) => {
    expect(hrefTags(file, (href) => href.includes('/api/orders/') && href.includes('/pdf'))).toEqual([]);
    expect(readFileSync(path.resolve(file), 'utf8')).toMatch(/<OrderPdfDownloadButton\b/);
  });

  // 业主 2026-10-02 点打印即记已打印：所有打印页入口统一走 PrintPageLink（原生 <a>，打印后回页刷新）。
  it('uses the prepared web-print route for printing batch results', () => {
    expect(readFileSync(path.resolve('components/business/order/AdminOrderBatchResultProvider.tsx'), 'utf8')).toMatch(/<PrintPageLink\b/);
    expect(hrefTags('components/business/order/PrintPageLink.tsx', (href) => href.includes('/print/orders/') && href.includes('autoprint=1'))).toEqual(['a']);
  });
});
