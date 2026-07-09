import {
  DESIGN_GRID_WARN_THRESHOLD,
  pickDesignGridClass,
} from './design-grid';
import {
  formatDateShanghai,
  formatDateTimeShanghai,
} from '@/lib/format/dates';
import type {
  PrintDesign,
  PrintOrder,
  PrintOrderItem,
} from './OrderPrintLayout.types';

// Shared print layout for both browser print and server-rendered PDF.
// Pure render of a PrintOrder view-model — no data fetching, no
// side-effects. Page layer is responsible for mapping DB rows into this
// shape (craft IDs → names, role enum → Chinese label, etc).
//
// SPEC §E: A4 portrait, 15mm margin, no prices / no money, per-item
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

      <div className="print-container">
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
          <div>客户代号：{order.customerRef ?? '-'}</div>
          <div>
            提交人：{order.submitterDisplayName}（{order.submitterRoleLabel}）
          </div>
          <div>急单：{order.isUrgent ? '【是】' : '否'}</div>
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
          {(order.receiverName || order.receiverPhone || order.receiverAddress) && (
            <div style={{ marginTop: 8 }}>
              <strong>收货信息：</strong>
              <div>
                {order.receiverName ?? '-'} {order.receiverPhone ?? ''}
              </div>
              {order.receiverAddress && <div>{order.receiverAddress}</div>}
              {order.expressCode && <div>快递代码：{order.expressCode}</div>}
            </div>
          )}
        </div>

        <div className="print-footer">打印时间：{formatShanghaiDateTime(printedAt)}</div>
      </div>
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
            <dd>{item.foilColor ?? '-'}</dd>
            <dt>双面：</dt>
            <dd>{item.isDoubleSided ? '是' : '否'}</dd>
            <dt>双色：</dt>
            <dd>{item.isDoubleColor ? '是' : '否'}</dd>
            <dt>工艺：</dt>
            <dd>{item.craftNames.length > 0 ? item.craftNames.join('、') : '-'}</dd>
          </dl>
          {item.remark && <div className="item-remark">备注：{item.remark}</div>}
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
      {printable.length >= DESIGN_GRID_WARN_THRESHOLD && (
        <div className="no-print design-many-warn">
          设计图较多（{printable.length} 张），建议分款式打印以保证清晰度
        </div>
      )}
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
    margin: 15mm;
  }
  @media print {
    body { margin: 0; padding: 0; }
    .no-print { display: none !important; }
    .order-item { page-break-inside: avoid; }
    .page-break { page-break-before: always; }
  }
  .print-container {
    font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #000;
    line-height: 1.5;
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
  .item-remark { margin-top: 6px; font-size: 12px; color: #666; }
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
  .print-footer {
    position: fixed;
    bottom: 5mm;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 10px;
    color: #666;
  }
`;
