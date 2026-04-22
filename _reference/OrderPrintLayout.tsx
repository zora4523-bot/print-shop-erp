/**
 * 工单打印布局组件（参考骨架）
 *
 * 用途：
 * - 浏览器打印：在 /orders/[id]/print-view 页面渲染，自动触发 window.print()
 * - PDF生成：Puppeteer 访问同一URL，page.pdf() 输出PDF
 *
 * 此文件是开发参考骨架，Claude Code 可在此基础上完善样式和交互。
 * 最终成品请放在 components/business/order/OrderPrintLayout.tsx
 */

import type { Order, OrderItem, OrderItemDesign, ProductionTask } from '@prisma/client';
import { QRCodeSVG } from 'qrcode.react';

type OrderWithRelations = Order & {
  submitter: { displayName: string; role: string };
  items: (OrderItem & {
    designs: OrderItemDesign[];
    tasks: (ProductionTask & { craft: { name: string }; worker?: { displayName: string } })[];
  })[];
};

interface Props {
  order: OrderWithRelations;
  factoryName?: string;
}

export function OrderPrintLayout({ order, factoryName = '红包印刷厂' }: Props) {
  return (
    <>
      {/* 打印样式 - 关键！ */}
      <style>{`
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
        
        /* 多设计图布局 - 根据数量选择网格 */
        .design-grid {
          display: grid;
          gap: 4mm;
          padding: 2mm;
        }
        .design-grid.count-1 {
          grid-template-columns: 60mm;
        }
        .design-grid.count-2 {
          grid-template-columns: 45mm 45mm;
        }
        .design-grid.count-3-4 {
          grid-template-columns: 35mm 35mm;
        }
        .design-grid.count-5-6 {
          grid-template-columns: 28mm 28mm 28mm;
        }
        .design-grid.count-7-9 {
          grid-template-columns: 25mm 25mm 25mm;
        }
        .design-grid.count-many {
          grid-template-columns: 22mm 22mm 22mm;
        }
        .design-thumb {
          width: 100%;
          aspect-ratio: 1 / 1;
          object-fit: contain;
          border: 1px solid #ddd;
          background: #fafafa;
        }
        .item-info {
          flex: 1;
          font-size: 13px;
        }
        .item-info dl {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 3px 10px;
          margin: 0;
        }
        .item-info dt { font-weight: 600; }
        .item-info dd { margin: 0; }
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
        .task-qr { width: 15mm; height: 15mm; }
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
      `}</style>

      <div className="print-container">
        {/* 急单横幅 */}
        {order.isUrgent && (
          <div className="urgent-banner">
            🚨 急 单 🚨 请优先处理
          </div>
        )}

        {/* 页眉 */}
        <div className="order-header">
          <div>
            <div style={{ fontSize: 12, color: '#666' }}>{factoryName}</div>
            <h1 style={{ fontSize: 24, margin: '4px 0' }}>工 单</h1>
            <div style={{ fontSize: 16, fontWeight: 'bold' }}>
              {order.orderNo}
            </div>
          </div>
          <div>
            <QRCodeSVG value={`order:${order.id}`} size={95} />
          </div>
        </div>

        {/* 元信息 */}
        <div className="order-meta">
          <div>下单日期：{formatDate(order.submittedAt ?? order.createdAt)}</div>
          <div>客户代号：{order.customerRef ?? '-'}</div>
          <div>
            提交人：{order.submitter.displayName}（
            {order.submitter.role === 'SALES' ? '销售' : '客服'}）
          </div>
          <div>急单：{order.isUrgent ? '【是】' : '否'}</div>
        </div>

        {/* 款式列表 */}
        {order.items.map((item, idx) => (
          <div key={item.id} className="order-item">
            <div className="item-header">
              款式 {idx + 1}：{item.name}
            </div>

            <div className="item-body">
              {/* 设计图（仅IMAGE，CDR不打印） */}
              <DesignGrid designs={item.designs.filter(d => d.fileType === 'IMAGE')} />

              {/* 信息 */}
              <div className="item-info">
                <dl>
                  <dt>规格：</dt><dd>{item.specification ?? '-'}</dd>
                  <dt>纸张：</dt><dd>{item.paperType ?? '-'}</dd>
                  <dt>数量：</dt><dd>{item.quantity}</dd>
                  <dt>烫金色：</dt><dd>{item.foilColor ?? '-'}</dd>
                  <dt>双面：</dt><dd>{item.isDoubleSided ? '是' : '否'}</dd>
                  <dt>双色：</dt><dd>{item.isDoubleColor ? '是' : '否'}</dd>
                  <dt>工艺：</dt>
                  <dd>{/* 从 item.crafts ID 查对应工艺名，组件里接入字典 */}</dd>
                </dl>
                {item.remark && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
                    备注：{item.remark}
                  </div>
                )}
              </div>
            </div>

            {/* 任务表 */}
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
                  {item.tasks.map(task => (
                    <tr key={task.id}>
                      <td>{shortId(task.id)}</td>
                      <td>{task.craft.name}</td>
                      <td>{task.worker?.displayName ?? '未分配'}</td>
                      <td>
                        <QRCodeSVG value={`task:${task.id}`} size={55} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}

        {/* 底部信息 */}
        <div className="order-footer">
          {order.packageRequirement && (
            <div><strong>包装要求：</strong>{order.packageRequirement}</div>
          )}
          {order.remark && (
            <div><strong>特别备注：</strong>{order.remark}</div>
          )}
          <div style={{ marginTop: 8 }}>
            <strong>收货信息：</strong>
            <div>{order.receiverName} {order.receiverPhone}</div>
            <div>{order.receiverAddress}</div>
            {order.expressCode && <div>快递代码：{order.expressCode}</div>}
          </div>
        </div>

        {/* 页脚 */}
        <div className="print-footer">
          打印时间：{formatDateTime(new Date())}
        </div>
      </div>
    </>
  );
}

function formatDate(d: Date | null) {
  if (!d) return '-';
  return new Date(d).toISOString().slice(0, 10);
}

function formatDateTime(d: Date) {
  return new Date(d).toLocaleString('zh-CN', { hour12: false });
}

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

/**
 * 多设计图布局：根据数量选择不同网格规则
 * 规则见 SPEC-v1.2 附录 E.2.1
 */
function DesignGrid({ designs }: { designs: OrderItemDesign[] }) {
  if (designs.length === 0) {
    return (
      <div style={{ width: 60, fontSize: 11, color: '#999', fontStyle: 'italic' }}>
        （无设计图）
      </div>
    );
  }

  const countClass = (() => {
    const n = designs.length;
    if (n === 1) return 'count-1';
    if (n === 2) return 'count-2';
    if (n <= 4) return 'count-3-4';
    if (n <= 6) return 'count-5-6';
    if (n <= 9) return 'count-7-9';
    return 'count-many';
  })();

  // 按上传时间排序（先上传的在前）
  const sorted = [...designs].sort(
    (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
  );

  return (
    <div>
      <div className={`design-grid ${countClass}`}>
        {sorted.map(d => (
          <img
            key={d.id}
            src={d.thumbnailUrl ?? d.fileUrl}
            alt={d.fileName}
            className="design-thumb"
          />
        ))}
      </div>
      {designs.length > 9 && (
        <div className="no-print" style={{ fontSize: 11, color: '#c00', marginTop: 4 }}>
          ⚠ 设计图较多（{designs.length}张），建议分款式打印以保证清晰度
        </div>
      )}
    </div>
  );
}
