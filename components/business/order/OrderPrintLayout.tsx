import { pickDesignGridClass } from './design-grid';
import {
  formatDateShanghai,
  formatDateTimeShanghai,
} from '@/lib/format/dates';
import type {
  PrintDesign,
  PrintOrder,
  PrintOrderItem,
} from './OrderPrintLayout.types';
import { formatFoilColors } from '@/lib/order/foil-colors';
import { formatReceiverInfo } from '@/lib/order/receiver-info';

// Shared print layout for both browser print and server-rendered PDF.
// Pure render of a PrintOrder view-model — no data fetching, no
// side-effects. Page layer is responsible for mapping DB rows into this
// shape (craft IDs → names, role enum → Chinese label, etc).
//
// SPEC §E: A4 portrait, 10mm margin, no prices / no money, per-item
// page-break-inside avoid, urgent banner, per-task QR code at 15mm,
// order QR code at the page header.

interface Props {
  order: PrintOrder;
  factoryName?: string;
  // Injected for determinism — tests / PDF renders can pin the footer
  // timestamp instead of capturing wall-clock at render time.
  renderedAt?: Date;
}

export function OrderPrintLayout({
  order,
  factoryName = '红包印刷厂',
  renderedAt,
}: Props) {
  const printedAt = renderedAt ?? new Date();
  return (
    <>
      <style>{PRINT_CSS}</style>

      {/* 表格外壳：thead / tfoot 是浏览器**原生**的「每页重复」机制，
          浏览器打印和 Puppeteer PDF 两条路径行为一致，而且会为页眉页脚
          预留空间。此前页脚用 position: fixed，Chrome 每页重画它却不占
          位，实测 168 个组合里 125 个（74%）压在正文墨迹上。
          业主 2026-08-18 决策：放弃「三款一页」，改显式分页 + 每页重复
          表头。 */}
      <table className="print-sheet">
        <thead>
          <tr>
            <td>
              <div className="running-header">
                <span className="running-header-no">{order.orderNo}</span>
                <span className="running-header-name">
                  {order.customName ?? order.customerRef ?? ''}
                </span>
                {order.isUrgent ? (
                  <span className="running-header-urgent">急单</span>
                ) : null}
              </div>
            </td>
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td>
              <div className="print-footer">
                打印时间：{formatShanghaiDateTime(printedAt)}
              </div>
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td>
      <div className="print-container">
        {order.kind === 'REWORK' ? (
          <div className="rework-banner">
            重 做 单
            {order.sourceOrderNo ? ` · 原单 ${order.sourceOrderNo}` : ''}
          </div>
        ) : null}
        {order.isUrgent && (
          <div className="urgent-banner">
            急 单 · 请优先处理
          </div>
        )}

        <div className="order-header">
          <div>
            <div className="factory-name">{factoryName}</div>
            <h1 className="order-title">工 单</h1>
            <div className="order-no">{order.orderNo}</div>
            {order.customName && (
              <div className="order-custom-name">{order.customName}</div>
            )}
          </div>
          <div
            // QR SVG pre-rendered server-side via the `qrcode` package.
            // We can't use qrcode.react here: renderToStaticMarkup +
            // dynamic-imported react-dom/server pulls in a separate React
            // copy from the one qrcode.react was bundled against → "Invalid
            // hook call". String injection bypasses the hook system.
            dangerouslySetInnerHTML={{ __html: order.orderQrSvg }}
          />
        </div>

        <div className="order-meta">
          <div>下单日期：{formatShanghaiDate(order.submittedAt ?? order.createdAt)}</div>
          <div>客户名称/简称：{order.customerRef ?? '-'}</div>
          <div>
            提交人：{order.submitterDisplayName}（{order.submitterRoleLabel}）
          </div>
          <div>急单：{order.isUrgent ? '【是】' : '否'}</div>
          <div>
            配送：
            {order.isSfCollect ? '顺丰到付（自行预约）' : '普通配送'}
            {order.shipments.length > 1
              ? ` · 多地址 ×${order.shipments.length}`
              : ''}
          </div>
          <div>
            承诺交期：
            {order.promisedDate ? formatShanghaiDate(order.promisedDate) : '-'}
          </div>
        </div>

        {order.items.map((item) => (
          <OrderItemBlock key={item.id} item={item} />
        ))}

        <div className="order-footer">
          {order.packageRequirement && (
            <div>
              <strong>包装要求：</strong>
              {order.packageRequirement}
            </div>
          )}
          {order.remark && (
            <div>
              <strong>特别备注：</strong>
              {order.remark}
            </div>
          )}
          {order.shipments.length > 0 ? (
            <div className="shipment-list">
              <strong>
                收货信息
                {order.shipments.length > 1
                  ? `（多地址 ×${order.shipments.length}）`
                  : ''}
                ：
              </strong>
              {order.shipments.map((shipment) => (
                <div key={shipment.id} className="shipment-row">
                  <span>
                    地址 {shipment.sequence}：{formatReceiverInfo(shipment, '-')}
                  </span>
                  {shipment.expressCode ? (
                    <span> · 快递代码 {shipment.expressCode}</span>
                  ) : null}
                  {shipment.trackingNo ? (
                    <span> · 运单号 {shipment.trackingNo}</span>
                  ) : null}
                  {shipment.lines.length > 0 ? (
                    <span>
                      {' '}
                      ·{' '}
                      {shipment.lines
                        .map(
                          (line) =>
                            `#${line.orderItemSequence} ${line.orderItemName} ×${line.quantity}`,
                        )
                        .join('；')}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : order.receiverName ||
            order.receiverPhone ||
            order.receiverAddress ? (
            <div className="shipment-list">
              <strong>收货信息：</strong>
              <div>{formatReceiverInfo(order, '-')}</div>
            </div>
          ) : null}
        </div>

      </div>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function OrderItemBlock({ item }: { item: PrintOrderItem }) {
  return (
    <div className="order-item">
      <div className="item-header">
        款式 {item.sequence}：{item.name}
      </div>

      <div className="item-body">
        <DesignGrid designs={item.designs} />

        <div className="item-info">
          <dl>
            <dt>规格：</dt>
            <dd>{item.specification ?? '-'}</dd>
            <dt>纸张：</dt>
            <dd>{item.paperType ?? '-'}</dd>
            <dt>数量：</dt>
            <dd>{item.quantity}</dd>
            <dt>烫金色：</dt>
            <dd>{formatFoilColors(item.foilColors, '-')}</dd>
            <dt>双面：</dt>
            <dd>{item.isDoubleSided ? '是' : '否'}</dd>
            <dt>双色：</dt>
            <dd>{item.isDoubleColor ? '是' : '否'}</dd>
            <dt>工艺：</dt>
            <dd>{item.craftNames.length > 0 ? item.craftNames.join('、') : '-'}</dd>
          </dl>
          {item.remark && (
            <div className="item-remark">
              <span className="item-remark-label">款式备注：</span>
              <span className="item-remark-text">{item.remark}</span>
            </div>
          )}
        </div>
      </div>

      {item.tasks.length > 0 && (
        <table className="task-table">
          <thead>
            <tr>
              <th>任务号</th>
              <th>工艺</th>
              <th>分配师傅</th>
              <th>二维码</th>
            </tr>
          </thead>
          <tbody>
            {item.tasks.map((task) => (
              <tr key={task.id}>
                <td>{shortId(task.id)}</td>
                <td>{task.craftName}</td>
                <td>{task.workerDisplayName ?? '未分配'}</td>
                <td
                  dangerouslySetInnerHTML={{ __html: task.qrSvg }}
                />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DesignGrid({ designs }: { designs: PrintDesign[] }) {
  // CDR source files aren't meaningful to the workshop — only JPG/PNG
  // goes on the printed sheet (SPEC E.2.1).
  const printable = designs.filter((d) => d.fileType === 'IMAGE');

  if (printable.length === 0) {
    return <div className="design-empty">（无设计图）</div>;
  }

  const sorted = [...printable].sort(
    (a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime(),
  );
  const gridClass = pickDesignGridClass(sorted.length);

  return (
    <div>
      <div className={`design-grid ${gridClass}`}>
        {sorted.map((d) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={d.id}
            src={d.thumbnailUrl ?? d.fileUrl}
            alt={d.fileName}
            className="design-thumb"
          />
        ))}
      </div>
    </div>
  );
}

// 打印视图的空值占位用 '-'（窄字符，打印排版紧凑），与页面端 '—' 区分。
function formatShanghaiDate(d: Date | null | undefined): string {
  return formatDateShanghai(d, '-');
}

function formatShanghaiDateTime(d: Date): string {
  return formatDateTimeShanghai(d);
}

function shortId(id: string): string {
  return id.slice(-6).toUpperCase();
}

// Inline stylesheet. Intentionally not a global CSS module — it ships
// with the component so the same markup looks identical whether it's
// rendered via `window.print()` or via Puppeteer.
const PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 10mm;
  }
  /* 打印视图按定义是纸张模拟，不跟随界面主题。根 layout 的主题脚本会在
     hydration 前把 .dark 打到 <html> 上，globals.css 的 body 于是变成
     深色背景，而 PRINT_CSS 只设了 color:#000 —— 结果管理员开着暗色主题
     点「打印」，预览是黑底黑字，整页看不见。
     这份 style 只在打印路由注入（OrderPrintLayout 的两个消费者都是打印
     路径），所以裸 body 选择器的作用域是安全的。 */
  html:has(.print-sheet), html:has(.print-sheet) body {
    background: #fff;
    color: #000;
    color-scheme: light;
  }

  /* 两条渲染路径（浏览器 window.print() 与 PDF 的 buildPrintHtml doc
     shell）之前 box-sizing 不一致，设计图在 PDF 侧比网页宽 2px 并溢出
     网格格子。reset 放在这里，两条路径共用同一份规则。 */
  .print-sheet, .print-sheet *, .print-sheet *::before, .print-sheet *::after {
    box-sizing: border-box;
  }
  .print-sheet img, .print-sheet svg { display: block; }

  /* 运行页眉 / 页脚：thead、tfoot 由浏览器在每个打印页重复并预留空间。 */
  .print-sheet {
    width: 100%;
    border-collapse: collapse;
  }
  .print-sheet > thead > tr > td,
  .print-sheet > tfoot > tr > td,
  .print-sheet > tbody > tr > td {
    padding: 0;
  }
  .running-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    border-bottom: 1px solid #999;
    padding-bottom: 3px;
    margin-bottom: 6px;
    font-size: 10px;
    color: #444;
  }
  .running-header-no { font-weight: bold; color: #000; }
  .running-header-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .running-header-urgent { color: #dc2626; font-weight: bold; }

  @media print {
    body { margin: 0; padding: 0; }
    .no-print { display: none !important; }
    /* 不要对整个 .order-item 用 avoid：款式本身高于一页时，浏览器无处
       可断，会塌陷成「非单调页数 + 近乎空白页」。只保护真正不可切的
       子块，让高款式正常跨页。 */
    .item-header { break-after: avoid; page-break-after: avoid; }
    .task-table tr { break-inside: avoid; page-break-inside: avoid; }
    .design-grid figure { break-inside: avoid; page-break-inside: avoid; }
    .page-break { page-break-before: always; }
    /* 首页不需要重复页眉——它下面紧跟着完整的工单抬头。 */
    .print-sheet > thead { display: table-header-group; }
    .print-sheet > tfoot { display: table-footer-group; }
  }
  .print-container {
    /* 打印视图按定义是纸张模拟，不该跟随界面主题。此前暗色模式下
       /print/orders/{id} 是黑底黑字（PRINT_CSS 只设了 color:#000，
       没设 background），整页看不见。 */
    background: #fff;
    font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC",
      "Microsoft YaHei", Arial, sans-serif;
    color: #000;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .urgent-banner {
    background: #dc2626;
    color: white;
    padding: 8px;
    text-align: center;
    font-weight: bold;
    font-size: 18px;
    margin-bottom: 10px;
  }
  .rework-banner {
    border: 2px solid #b45309;
    background: #fffbeb;
    color: #92400e;
    padding: 6px;
    text-align: center;
    font-weight: bold;
    font-size: 16px;
    margin-bottom: 8px;
  }
  .order-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #000;
    padding-bottom: 10px;
    margin-bottom: 15px;
  }
  .factory-name { font-size: 12px; color: #666; }
  .order-title { font-size: 24px; margin: 4px 0; }
  .order-no { font-size: 16px; font-weight: bold; }
  .order-custom-name {
    margin-top: 2px;
    font-size: 14px;
    font-weight: bold;
  }
  .order-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 20px;
    font-size: 14px;
    margin-bottom: 15px;
  }
  .order-item {
    border: 1px solid #333;
    margin-bottom: 12px;
    padding: 10px;
  }
  .item-header {
    font-weight: bold;
    font-size: 16px;
    border-bottom: 1px dashed #666;
    padding-bottom: 5px;
    margin-bottom: 8px;
  }
  .item-body {
    display: flex;
    gap: 15px;
  }
  .design-grid {
    display: grid;
    gap: 4mm;
    padding: 2mm;
  }
  .design-grid.count-1      { grid-template-columns: 60mm; }
  .design-grid.count-2      { grid-template-columns: 45mm 45mm; }
  .design-grid.count-3-4    { grid-template-columns: 35mm 35mm; }
  .design-grid.count-5-6    { grid-template-columns: 28mm 28mm 28mm; }
  .design-grid.count-7-9    { grid-template-columns: 25mm 25mm 25mm; }
  .design-grid.count-many   { grid-template-columns: 22mm 22mm 22mm; }
  .design-thumb {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: contain;
    border: 1px solid #ddd;
    background: #fafafa;
  }
  .design-empty {
    width: 60mm;
    font-size: 11px;
    color: #999;
    font-style: italic;
  }
  .design-many-warn {
    font-size: 11px;
    color: #c00;
    margin-top: 4px;
  }
  .item-info { flex: 1; font-size: 13px; }
  .item-info dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    margin: 0;
  }
  .item-info dt { font-weight: 600; }
  .item-info dd { margin: 0; }
  .item-remark {
    margin-top: 8px;
    font-size: 13px;
    color: #000;
  }
  .item-remark-label {
    color: #333;
  }
  .item-remark-text {
    padding: 1px 3px;
    font-weight: bold;
    color: #c00000;
    background: #ffe6e6;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .task-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: 12px;
  }
  .task-table th, .task-table td {
    border: 1px solid #999;
    padding: 4px 6px;
    text-align: center;
  }
  .order-footer {
    margin-top: 15px;
    border-top: 1px solid #333;
    padding-top: 10px;
    font-size: 13px;
  }
  .shipment-list { margin-top: 8px; }
  .shipment-row {
    margin-top: 2px;
    overflow-wrap: anywhere;
  }
  /* compact-3 已移除：它把三款工单的字号压小以塞进一张 A4，
     而工单一旦排产仍然放不下。业主 2026-08-18 决策改为显式分页 +
     每页重复表头，车间拿到的字号因此恢复正常大小。 */
  /* 不再用 position: fixed —— 它每页重画却不占位，会压住正文。现在
     由 tfoot 承载，浏览器自动每页重复并预留空间。 */
  .print-footer {
    border-top: 1px solid #ccc;
    margin-top: 6px;
    padding-top: 3px;
    text-align: center;
    font-size: 10px;
    color: #666;
  }
`;
