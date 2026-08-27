import type { CSSProperties, ReactNode } from 'react';

import { formatDateInputShanghai } from '@/lib/format/dates';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

import type {
  PrintOrder,
  PrintOrderItem,
  PrintPackagingGroup,
  PrintShipment,
  PrintTask,
} from './OrderPrintLayout.types';

interface Props {
  order: PrintOrder;
}

type Artwork = {
  id: string;
  fig: number;
  title: string;
  sub?: string | null;
  url?: string | null;
};

type ItemPackaging = {
  unitsPerBag: number | null;
  bagCount: number | null;
  mixed: boolean;
};

type FlowRow = {
  key: string;
  name: string;
  planned: string;
  completed: string;
  defect: string;
  completedAt: string;
};

const MAX_ARTWORKS_ON_MAIN_PAGE = 8;

const PRICING_ROUTE_LABEL: Record<PrintOrderItem['pricingRoute'], string> = {
  STOCK_BLANK: '局部烫金',
  CUSTOM_SINGLE_FLAT_FOIL: '专版烫金',
  COLOR_PRINT: '彩印',
  MANUAL_QUOTE: '人工报价',
};

const CARRIER_LABEL: Record<string, string> = {
  ZTO: '中通',
  SF: '顺丰',
  YTO: '圆通',
  STO: '申通',
  YUNDA: '韵达',
  JD: '京东物流',
  EMS: '邮政 EMS',
  DEPPON: '德邦',
};

export function OrderPrintLayout({ order }: Props) {
  const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const itemPackaging = buildItemPackaging(order.packagingGroups);
  const totalBags = calculateTotalBags(order, itemPackaging);
  const artworks = buildArtworks(order);
  const hasArtworkAnnex = artworks.length > MAX_ARTWORKS_ON_MAIN_PAGE;
  const pageCount = hasArtworkAnnex ? 2 : 1;
  const team = getTeam(order);
  const craft = joinDistinct(order.items.map((item) => PRICING_ROUTE_LABEL[item.pricingRoute]));
  const paper = joinDistinct(order.items.map(formatPaper));
  const foil = joinDistinct(order.items.map(formatFoil));
  const warnings = auditOrder(order, itemPackaging, team);
  const flowRows = buildFlowRows(order, totalQuantity, totalBags);
  const orderDate = formatDateInputShanghai(order.submittedAt ?? order.createdAt);
  const denseMainSheet =
    order.items.length >= 3 || artworks.length >= 5 || order.shipments.length > 1;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <main className="work-order-document">
        <WorkOrderSheet
          order={order}
          page={1}
          pageCount={pageCount}
          orderDate={orderDate}
          dense={denseMainSheet}
        >
          <WorkOrderHeader order={order} team={team} />
          <AuditWarnings warnings={warnings} />

          <section className="sec">
            <div className="grid">
              <Fact label="工艺类型" value={craft} emphasis="l0" />
              <Fact label="纸张类型" value={paper} emphasis="l0" />
              <Fact label="烫金颜色" value={foil} emphasis="l0" />
              <Fact
                label="交货日期"
                value={order.promisedDate ? formatDateInputShanghai(order.promisedDate) : null}
                emphasis="l0"
              />
              <Fact
                label="总数量"
                value={formatNumber(totalQuantity)}
                emphasis="l0"
                unit="个"
              />
              <Fact
                label="包装要求"
                value={clean(order.packageRequirement)}
                emphasis="l1"
              />
            </div>
            {clean(order.remark) ? (
              <div className="remark">
                <div className="lbl">备注</div>
                <div className="l1 note">{order.remark}</div>
              </div>
            ) : null}
          </section>

          <section className="sec">
            <ItemTable
              items={order.items}
              packaging={itemPackaging}
              totalQuantity={totalQuantity}
              totalBags={totalBags}
            />
          </section>

          {!hasArtworkAnnex ? (
            <section className="sec">
              <ArtworkGrid artworks={artworks} onAnnex={false} />
            </section>
          ) : null}

          <section className="sec">
            <FlowTable rows={flowRows} />
          </section>

          <section className="sec">
            <ShippingBlock order={order} />
          </section>
        </WorkOrderSheet>

        {hasArtworkAnnex ? (
          <WorkOrderSheet order={order} page={2} pageCount={pageCount} orderDate={orderDate}>
            <WorkOrderHeader order={order} team={team} />
            <section className="sec artwork-annex">
              <ArtworkGrid artworks={artworks} onAnnex />
            </section>
          </WorkOrderSheet>
        ) : null}
      </main>
    </>
  );
}

function WorkOrderSheet({
  order,
  page,
  pageCount,
  orderDate,
  dense = false,
  children,
}: {
  order: PrintOrder;
  page: number;
  pageCount: number;
  orderDate: string;
  dense?: boolean;
  children: ReactNode;
}) {
  return (
    <article className={classNames('sheet', dense && 'dense')}>
      {children}
      <footer className="ft">
        <span>{order.orderNo}</span>
        <span>{orderDate}</span>
        <span>
          {page} / {pageCount}
        </span>
      </footer>
    </article>
  );
}

function WorkOrderHeader({ order, team }: { order: PrintOrder; team: string | null }) {
  return (
    <header className="hd">
      <div className="hd-main">
        <div className={classNames('cust', !clean(order.customerName) && 'miss')}>
          {clean(order.customerName) ?? '客户未填'}
        </div>
        <div className="line">
          团队 <b className={!team ? 'miss' : undefined}>{team ?? '待排产'}</b>
          {clean(order.customName) ? (
            <>
              <span className="sep">·</span>工单 <b>{order.customName}</b>
            </>
          ) : null}
          {order.isUrgent ? <span className="tag">加急</span> : null}
          {order.kind === 'REWORK' ? (
            <span className="tag">
              重做{order.sourceOrderNo ? ` · ${order.sourceOrderNo}` : ''}
            </span>
          ) : null}
        </div>
      </div>
      <div className="scan">
        <div
          className="qr"
          aria-label={`工单 ${order.orderNo} 二维码`}
          dangerouslySetInnerHTML={{ __html: order.orderQrSvg }}
        />
        <div className="no">{order.orderNo}</div>
      </div>
    </header>
  );
}

function AuditWarnings({ warnings }: { warnings: string[] }) {
  return (
    <>
      {warnings.length > 0 ? <div className="warn">数据不完整：{warnings.join('；')}</div> : null}
      <div className="warn image-load-warning" hidden />
    </>
  );
}

function Fact({
  label,
  value,
  emphasis,
  unit,
}: {
  label: string;
  value: string | null;
  emphasis: 'l0' | 'l1';
  unit?: string;
}) {
  const present = Boolean(clean(value));
  return (
    <div className="fact">
      <div className="lbl">{label}</div>
      <div className={classNames(emphasis, !present && 'miss')}>
        {present ? value : '未填'}
        {present && unit ? <span className="unit">{unit}</span> : null}
      </div>
    </div>
  );
}

function ItemTable({
  items,
  packaging,
  totalQuantity,
  totalBags,
}: {
  items: PrintOrderItem[];
  packaging: Map<string, ItemPackaging>;
  totalQuantity: number;
  totalBags: number | null;
}) {
  return (
    <table className="items">
      <thead>
        <tr>
          <th className="col-fig">图号</th>
          <th className="col-spec">规格</th>
          <th>款名</th>
          <th className="num col-qty">下单数量</th>
          <th className="num col-pack">包装数量</th>
          <th className="num col-bags">包数</th>
        </tr>
      </thead>
      <tbody>
        {items.length > 0 ? (
          items.map((item) => {
            const itemPack = packaging.get(item.id);
            const hasPack = Boolean(itemPack?.unitsPerBag && itemPack.unitsPerBag > 0);
            return (
              <tr key={item.id}>
                <td><span className="badge">{item.sequence}</span></td>
                <td className={!clean(item.specification) ? 'miss' : undefined}>
                  {clean(item.specification)
                    ? externalPriceBusinessText(item.specification!)
                    : '未填'}
                </td>
                <td>{clean(item.name) ?? `款式 ${item.sequence}`}</td>
                <td className="num">{formatNumber(item.quantity)}</td>
                <td className={classNames('num', !hasPack && 'miss')}>
                  {hasPack ? formatNumber(itemPack!.unitsPerBag!) : '未填'}
                </td>
                <td className={classNames('num', !itemPack && 'miss')}>
                  {!itemPack
                    ? '—'
                    : itemPack.mixed
                      ? '混装'
                      : itemPack.bagCount && itemPack.bagCount > 0
                        ? formatNumber(itemPack.bagCount)
                        : '—'}
                </td>
              </tr>
            );
          })
        ) : (
          <tr><td colSpan={6} className="empty-row miss">无生产明细</td></tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3}>合　计</td>
          <td className="num">{formatNumber(totalQuantity)}</td>
          <td />
          <td className={classNames('num', totalBags === null && 'miss')}>
            {totalBags === null ? '—' : formatNumber(totalBags)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function ArtworkGrid({ artworks, onAnnex }: { artworks: Artwork[]; onAnnex: boolean }) {
  const layout = artLayout(artworks.length, onAnnex);
  const style = {
    '--cols': String(layout.cols),
    ...(layout.cap ? { '--cap': layout.cap } : {}),
  } as CSSProperties;

  if (artworks.length === 0) return <div className="art-empty miss">未提供设计图</div>;

  return (
    <div className="art" style={style}>
      {artworks.map((artwork) => (
        <figure
          className={classNames('thumb', !artwork.url && 'image-missing')}
          key={artwork.id}
          data-fig={artwork.fig}
        >
          <div className="box">
            <span className="art-placeholder">{artwork.url ? '图稿加载失败' : '图稿未提供'}</span>
            {artwork.url ? (
              // Static print HTML needs the signed original URL and native
              // load/error events; Next/Image cannot participate in either.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={artwork.url} alt={`图 ${artwork.fig} ${artwork.title}`} data-print-artwork="true" />
            ) : null}
          </div>
          <figcaption className="cap">
            <span className="badge">{artwork.fig}</span>
            <span className="txt">
              {artwork.title}
              {clean(artwork.sub) ? <small>{artwork.sub}</small> : null}
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function FlowTable({ rows }: { rows: FlowRow[] }) {
  return (
    <table className="flow">
      <thead>
        <tr>
          <th className="flow-step-col">工序</th>
          <th className="num flow-number-col">计划数</th>
          <th className="num flow-number-col">完成数</th>
          <th className="num flow-defect-col">不良数</th>
          <th className="flow-date-col">完成日期</th>
          <th>签字</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="step">{row.name}</td>
            <td className="num">{row.planned}</td>
            <td className="num">{row.completed}</td>
            <td className="num">{row.defect}</td>
            <td>{row.completedAt}</td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ShippingBlock({ order }: { order: PrintOrder }) {
  const shipments = order.shipments.length > 0 ? order.shipments : [fallbackShipment(order)];
  return (
    <div className="ship-list">
      {shipments.map((shipment) => {
        const receiver = clean(shipment.receiverName);
        const rest = [clean(shipment.receiverPhone), formatCarrier(shipment, order.isSfCollect), clean(shipment.expressCode)]
          .filter(Boolean)
          .join(' · ');
        return (
          <div className="ship" key={shipment.id}>
            <div className="who">
              <b className={!receiver ? 'miss' : undefined}>{receiver ?? '收件人未填'}</b>
              {rest ? ` · ${rest}` : ''}
            </div>
            <div className={!clean(shipment.receiverAddress) ? 'miss' : undefined}>
              {clean(shipment.receiverAddress) ?? '收货地址未填'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function fallbackShipment(order: PrintOrder): PrintShipment {
  return {
    id: 'order-shipping-fallback', sequence: 1,
    receiverName: order.receiverName, receiverPhone: order.receiverPhone,
    receiverAddress: order.receiverAddress, expressCode: order.expressCode,
    carrierCode: null, trackingNo: null, lines: [],
  };
}

function buildArtworks(order: PrintOrder): Artwork[] {
  return order.items.flatMap<Artwork>((item) => {
    const images = item.designs.filter((design) => design.fileType === 'IMAGE');
    if (images.length === 0) {
      return [{ id: `missing-${item.id}`, fig: item.sequence,
        title: clean(item.name) ?? `款式 ${item.sequence}`,
        sub: clean(item.artworkVersion), url: null }];
    }
    return images.map((design, index) => ({
      id: design.id,
      fig: item.sequence,
      title: images.length > 1
        ? `${clean(item.name) ?? `款式 ${item.sequence}`}（${index + 1}）`
        : clean(item.name) ?? `款式 ${item.sequence}`,
      sub: clean(item.artworkVersion),
      url: design.fileUrl,
    }));
  });
}

function buildItemPackaging(groups: PrintPackagingGroup[]): Map<string, ItemPackaging> {
  const entries = new Map<string, Array<{ unitsPerBag: number; bagCount: number; mixed: boolean }>>();
  for (const group of groups) {
    for (const line of group.lines) {
      const current = entries.get(line.orderItemId) ?? [];
      current.push({
        unitsPerBag: line.unitsPerBag,
        bagCount: group.actualBagCount,
        mixed: group.mode === 'MIXED_STYLE' || group.lines.length > 1,
      });
      entries.set(line.orderItemId, current);
    }
  }
  return new Map([...entries].map(([itemId, rows]) => {
    const units = unique(rows.map((row) => row.unitsPerBag).filter((value) => value > 0));
    const mixed = rows.length > 1 || rows.some((row) => row.mixed);
    return [itemId, {
      unitsPerBag: units.length === 1 ? units[0]! : null,
      bagCount: mixed ? null : rows[0]?.bagCount ?? null,
      mixed,
    }];
  }));
}

function calculateTotalBags(order: PrintOrder, packaging: Map<string, ItemPackaging>): number | null {
  if (order.items.length === 0 || order.packagingGroups.length === 0 ||
    order.items.some((item) => !packaging.get(item.id)?.unitsPerBag) ||
    order.packagingGroups.some((group) => group.actualBagCount <= 0)) return null;
  return order.packagingGroups.reduce((sum, group) => sum + group.actualBagCount, 0);
}

function buildFlowRows(order: PrintOrder, totalQuantity: number, totalBags: number | null): FlowRow[] {
  const tasks = order.items.flatMap((item) => item.tasks);
  const rows = tasks.length > 0 ? aggregateTasks(tasks) : derivePlannedSteps(order);
  if (order.packagingGroups.length > 0 && !rows.some((row) => row.name === '打包')) {
    rows.push({ key: 'packaging', name: '打包',
      planned: totalBags === null ? '—' : `${formatNumber(totalBags)} 包`,
      completed: '', defect: '', completedAt: '' });
  }
  if (rows.length === 0) {
    rows.push({ key: 'production', name: '生产', planned: formatNumber(totalQuantity),
      completed: '', defect: '', completedAt: '' });
  }
  return rows;
}

function aggregateTasks(tasks: PrintTask[]): FlowRow[] {
  const grouped = new Map<string, PrintTask[]>();
  for (const task of tasks) grouped.set(task.craftName, [...(grouped.get(task.craftName) ?? []), task]);
  return [...grouped].map(([name, rows], index) => {
    const completedDates = rows.map((row) => row.completedAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime());
    return {
      key: `task-${index}-${name}`, name,
      planned: formatNumber(rows.reduce((sum, row) => sum + row.plannedQty, 0)),
      completed: formatProgress(rows.reduce((sum, row) => sum + row.completedQty, 0)),
      defect: formatProgress(rows.reduce((sum, row) => sum + row.defectQty, 0)),
      completedAt: completedDates[0] ? formatDateInputShanghai(completedDates[0]) : '',
    };
  });
}

function derivePlannedSteps(order: PrintOrder): FlowRow[] {
  const plannedByStep = new Map<string, number>();
  for (const item of order.items) {
    const names = unique([
      ...item.craftNames.map(clean).filter((name): name is string => Boolean(name)),
      PRICING_ROUTE_LABEL[item.pricingRoute],
    ]).filter((name) => name !== '打包');
    for (const name of names) {
      plannedByStep.set(name, (plannedByStep.get(name) ?? 0) + item.quantity);
    }
  }
  return [...plannedByStep].map(([name, planned], index) => ({
    key: `planned-${index}-${name}`,
    name,
    planned: formatNumber(planned),
    completed: '',
    defect: '',
    completedAt: '',
  }));
}

function auditOrder(order: PrintOrder, packaging: Map<string, ItemPackaging>, team: string | null): string[] {
  const warnings: string[] = [];
  if (!clean(order.customerName)) warnings.push('客户未填');
  if (!order.promisedDate) warnings.push('交货日期未填');
  if (!team) warnings.push('生产团队待排产');
  if (!clean(order.packageRequirement)) warnings.push('包装要求未填');
  if (order.items.length === 0) warnings.push('无生产明细');
  for (const item of order.items) {
    const prefix = `图 ${item.sequence}`;
    if (!clean(item.specification)) warnings.push(`${prefix} 规格未填`);
    if (!clean(formatPaper(item))) warnings.push(`${prefix} 纸张未填`);
    if (item.pricingRoute !== 'COLOR_PRINT' && !clean(formatFoil(item))) warnings.push(`${prefix} 烫金颜色未填`);
    if (!packaging.get(item.id)?.unitsPerBag) warnings.push(`${prefix} 包装数量未填`);
    if (!item.designs.some((design) => design.fileType === 'IMAGE')) warnings.push(`${prefix} 缺设计图`);
  }
  const shipment = order.shipments[0] ?? fallbackShipment(order);
  if (!clean(shipment.receiverName)) warnings.push('收件人姓名未填');
  if (!clean(shipment.receiverPhone)) warnings.push('收件电话未填');
  if (!clean(shipment.receiverAddress)) warnings.push('收货地址未填');
  return unique(warnings);
}

function getTeam(order: PrintOrder): string | null {
  return joinDistinct(order.items.flatMap((item) => item.tasks.map((task) => task.workerDisplayName)));
}

function formatPaper(item: PrintOrderItem): string | null {
  const paper = clean(item.paperType) ? externalPriceBusinessText(item.paperType!) : null;
  if (!paper) return null;
  const weight = item.paperWeightGsm;
  if (!weight || new RegExp(`${weight}\\s*(?:g|克)`, 'i').test(paper)) return paper;
  return `${paper} ${weight}g`;
}

function formatFoil(item: PrintOrderItem): string | null {
  if (item.pricingRoute === 'COLOR_PRINT') return '不烫金';
  const front = unique(item.frontFoilColors.map(externalPriceBusinessText));
  const back = unique(item.backFoilColors.map(externalPriceBusinessText));
  if (back.length > 0) return `正面 ${front.length > 0 ? front.join('、') : '未填'} / 反面 ${back.join('、')}`;
  const legacy = unique(item.foilColors.map(externalPriceBusinessText));
  const colors = front.length > 0 ? front : legacy;
  return colors.length > 0 ? colors.join('、') : null;
}

function formatCarrier(shipment: PrintShipment, isSfCollect: boolean): string | null {
  if (isSfCollect) return '顺丰到付';
  const carrier = clean(shipment.carrierCode);
  return carrier ? CARRIER_LABEL[carrier] ?? carrier : null;
}

function artLayout(count: number, onAnnex: boolean): { cols: number; cap: string | null } {
  if (onAnnex) return { cols: Math.max(1, Math.min(count, 6)), cap: null };
  if (count <= 1) return { cols: 1, cap: '50mm' };
  if (count <= 2) return { cols: count, cap: '44mm' };
  if (count <= 4) return { cols: count, cap: '40mm' };
  return { cols: count, cap: null };
}

function formatProgress(value: number): string { return value > 0 ? formatNumber(value) : ''; }

function joinDistinct(values: Array<string | null | undefined>): string | null {
  const joined = unique(values.map(clean).filter((value): value is string => Boolean(value)));
  return joined.length > 0 ? joined.join(' / ') : null;
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function formatNumber(value: number): string { return new Intl.NumberFormat('zh-CN').format(value); }

function classNames(...values: Array<string | false | null | undefined>): string | undefined {
  const result = values.filter(Boolean).join(' ');
  return result || undefined;
}

const PRINT_CSS = String.raw`
:root{ --ink:#111214; --mute:#7c7f84; --hair:#cdd0d4; --rule:#23262a; --flag:#a8121a; }
*{ box-sizing:border-box; margin:0; padding:0; }
html,body{ min-height:100%; }
body{
  font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC","Source Han Sans SC",sans-serif;
  color:var(--ink); background:#93969a; font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased; padding:8mm 0;
}
.work-order-document{ width:100%; }
.sheet{
  width:210mm; min-height:297mm; padding:13mm 13mm 10mm; margin:0 auto 8mm;
  background:#fff; box-shadow:0 2mm 8mm rgba(0,0,0,.3); display:flex;
  flex-direction:column; break-after:page; page-break-after:always;
}
.sheet:last-child{ break-after:auto; page-break-after:auto; }
.lbl{ font-size:6pt; font-weight:600; letter-spacing:.18em; color:var(--mute); }
.l1{ font-size:13.5pt; font-weight:800; line-height:1.2; }
.l0{ font-size:18pt; font-weight:800; line-height:1.05; letter-spacing:-.015em; }
.hd{ display:flex; justify-content:space-between; align-items:flex-start; gap:10mm; padding-bottom:4mm; border-bottom:.7mm solid var(--rule); }
.hd-main{ min-width:0; }
.cust{ font-size:26pt; font-weight:800; line-height:1; letter-spacing:-.02em; }
.line{ display:flex; align-items:center; flex-wrap:wrap; gap:1.5mm; font-size:9.5pt; font-weight:600; color:var(--mute); margin-top:2.6mm; }
.line b{ color:var(--ink); }
.line b.miss{ color:var(--flag); }
.sep{ color:var(--hair); margin:0 .5mm; }
.scan{ text-align:right; flex:0 0 auto; }
.scan .qr{ width:20mm; height:20mm; overflow:hidden; margin-left:auto; }
.scan svg{ width:20mm !important; height:20mm !important; display:block; }
.scan .no{ font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size:8pt; font-weight:700; margin-top:1.4mm; white-space:nowrap; }
.sec{ padding:4.5mm 0; border-top:.25mm solid var(--hair); }
.sheet.dense > .sec{ padding-top:4.2mm; padding-bottom:4.2mm; }
.sec:first-of-type{ border-top:none; }
.grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:5mm 6mm; align-items:start; }
.fact{ min-width:0; }
.fact .l0,.fact .l1{ margin-top:1.2mm; overflow-wrap:anywhere; }
.miss{ color:var(--flag); }
.warn{ margin-top:3mm; border-left:.8mm solid var(--flag); padding-left:2.4mm; color:var(--flag); font-size:9pt; font-weight:700; line-height:1.4; }
.warn[hidden]{ display:none; }
.unit{ font-size:9pt; font-weight:600; color:var(--mute); margin-left:.8mm; }
.remark{ margin-top:5mm; }
.note{ border-left:.8mm solid var(--flag); padding-left:2.4mm; color:var(--flag); }
.tag{ display:inline-block; border:.45mm solid var(--flag); color:var(--flag); font-size:8pt; font-weight:800; padding:.2mm 1.6mm; border-radius:.6mm; letter-spacing:.06em; margin-left:1mm; }
table{ width:100%; border-collapse:collapse; }
th,td{ border:none; padding:1.6mm 2mm 1.6mm 0; text-align:left; }
thead th{ font-size:6pt; font-weight:600; letter-spacing:.18em; color:var(--mute); border-bottom:.4mm solid var(--rule); padding-bottom:1.4mm; }
tbody td{ border-bottom:.15mm solid var(--hair); font-size:10.5pt; font-weight:600; }
.num{ text-align:right; font-weight:800; }
tfoot td{ border-top:.4mm solid var(--rule); border-bottom:none; font-size:11.5pt; font-weight:800; padding-top:2.2mm; }
.items tbody td{ height:7mm; }
.empty-row{ height:14mm !important; text-align:center; }
.col-fig{ width:14mm; }.col-spec{ width:26mm; }.col-qty,.col-pack{ width:26mm; }.col-bags{ width:22mm; }
.flow tbody td{ height:11mm; }.flow .step{ font-size:12.5pt; font-weight:800; }
.flow-step-col{ width:26mm; }.flow-number-col{ width:28mm; }.flow-defect-col{ width:24mm; }.flow-date-col{ width:30mm; }
.badge{ display:inline-flex; align-items:center; justify-content:center; min-width:5.2mm; height:5.2mm; padding:0 1.3mm; background:var(--ink); color:#fff; border-radius:99mm; font-size:8.5pt; font-weight:800; }
.art{ display:grid; gap:3.5mm; justify-content:start; grid-template-columns:repeat(var(--cols),minmax(0,var(--cap,1fr))); }
.thumb{ min-width:0; }
.thumb .box{ width:100%; aspect-ratio:3/4; border:.2mm solid var(--hair); display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; background:#fff; }
.thumb .box img{ position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:#fff; }
.art-placeholder{ display:none; color:var(--flag); font-size:8pt; font-weight:700; text-align:center; padding:2mm; }
.image-missing .art-placeholder,.image-failed .art-placeholder{ display:block; }
.image-failed .box img{ display:none; }.image-failed .box{ border-color:var(--flag); }
.thumb .cap{ display:flex; gap:1.4mm; align-items:flex-start; margin-top:1.6mm; }
.thumb .cap .txt{ font-size:8pt; font-weight:700; line-height:1.3; min-width:0; overflow-wrap:anywhere; }
.thumb .cap small{ display:block; font-size:6.4pt; color:var(--mute); font-weight:600; margin-top:.4mm; }
.art-empty{ min-height:24mm; display:flex; align-items:center; justify-content:center; border:.2mm solid var(--flag); font-size:10pt; font-weight:700; }
.artwork-annex{ flex:1; }
.ship-list{ display:grid; gap:3mm; }
.ship{ font-size:11pt; font-weight:700; line-height:1.5; }
.ship + .ship{ padding-top:3mm; border-top:.15mm solid var(--hair); }
.ship .who{ color:var(--mute); font-weight:600; font-size:9.5pt; }
.ship .who b{ color:var(--ink); font-weight:700; }.ship .who b.miss{ color:var(--flag); }
.ft{ margin-top:auto; padding-top:3mm; border-top:.25mm solid var(--hair); display:flex; justify-content:space-between; font-size:6pt; color:var(--mute); letter-spacing:.06em; }
tr,.sec,.thumb{ break-inside:avoid; page-break-inside:avoid; }
@media print{
  @page{ size:A4; margin:0; }
  html,body{ width:210mm; background:#fff; padding:0; }
  .sheet{ margin:0; box-shadow:none; }
  *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
}
`;
