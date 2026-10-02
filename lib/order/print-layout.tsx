import { foilColorLabel } from '@/lib/order/foil-colors';
import { paperDisplayLabel } from '@/lib/rules/paper-label';
import { packagingType, packagingModeLabel } from './packaging-mode';
import type { CSSProperties, ReactNode } from 'react';
import { printFontCss } from './print-fonts';

import { formatDateInputShanghai } from '@/lib/format/dates';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';

import type {
  PrintFoilTechnique,
  PrintLamination,
  PrintOrder,
  PrintOrderItem,
  PrintPackagingGroup,
  PrintShipment,
} from './print-types';

interface Props {
  order: PrintOrder;
  factoryName: string;
  fontCss?: string;
}

type Artwork = {
  id: string;
  fig: number;
  title: string;
  sub?: string | null;
  url?: string | null;
};

type ItemPackaging = {
  mode?: import('@/generated/prisma/enums').OrderPackagingMode;
  unitsPerBag: number | null;
  bagCount: number | null;
  mixed: boolean;
};

type FlowRow = {
  key: string;
  itemSequence: number | null;
  itemName: string | null;
  scopeLabel?: string | null;
  name: string;
  planned: string;
  completed: string;
  defect: string;
  completedAt: string;
};

type SupplementPage = {
  key: string;
  label: string;
  part: number;
  totalParts: number;
  value: string;
};

const MAX_ITEMS_ON_MAIN_PAGE = 8;
const MAX_ITEMS_PER_ANNEX_PAGE = 12;
const MAX_ARTWORKS_ON_MAIN_PAGE = 8;
const MAX_ARTWORKS_PER_ANNEX_PAGE = 10;
const MAIN_FLOW_HEIGHT_MM = 60;
const ANNEX_FLOW_HEIGHT_MM = 195;
const MAX_SHIPMENTS_ON_MAIN_PAGE = 2;
const MAX_SHIPMENTS_PER_ANNEX_PAGE = 4;
const MAX_MAIN_FACT_CHARACTERS = 36;
const MAX_MAIN_REMARK_CHARACTERS = 120;
const MAX_MAIN_REMARK_LINES = 3;
const MAX_DENSE_MAIN_FACT_CHARACTERS = 16;
const MAX_DENSE_MAIN_REMARK_CHARACTERS = 48;
const MAX_SUPPLEMENT_CHARACTERS_PER_PAGE = 600;
const MAX_SUPPLEMENT_LINES_PER_PAGE = 22;
const SUPPLEMENT_CHARACTERS_PER_LINE = 36;
const MAX_HEADER_FACTORY_CHARACTERS = 24;
const MAX_HEADER_SALES_CHARACTERS = 16;
const MAX_HEADER_ORDER_NAME_CHARACTERS = 100;
const MAX_HEADER_ORDER_NAME_LINES = 3;
const MAX_INLINE_ORDER_NUMBER_CHARACTERS = 64;

const FOIL_TECHNIQUE_LABEL: Record<PrintFoilTechnique, string> = {
  UNSPECIFIED: '烫金',
  NONE: '不烫金',
  FLAT: '平烫',
  RELIEF: '浮雕',
  RAISED: '激凸',
};

const LAMINATION_LABEL: Record<PrintLamination, string> = {
  NONE: '不覆膜',
  MATTE: '亚膜',
  SOFT_TOUCH: '触感膜',
  NEW_GLOSS: '新光膜',
  LASER: '雷射膜',
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

export function OrderPrintLayout({ order, factoryName, fontCss = printFontCss() }: Props) {
  const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const itemPackaging = buildItemPackaging(order.packagingGroups);
  const packagingComplete = hasCompleteBagFacts(order, itemPackaging);
  const totalBags = calculateTotalBags(order, itemPackaging);
  const artworks = buildArtworks(order);
  const showItemPaper = hasMixedItemPaper(order.items);
  const { mainItems, itemAnnexPages } = paginateItems(order.items, showItemPaper);
  const hasOversizedItem = order.items.some(
    (item) => estimateItemRowUnits(item, showItemPaper) >= 4,
  );
  const fullCraft = formatProductionCrafts(order);
  const fullPaper = joinDistinct(order.items.map(formatPaper));
  const fullFoil = joinDistinct(order.items.map(formatFoil));
  const fullPackageRequirement = clean(order.packageRequirement);
  const fullRemark = clean(order.remark);
  const hasLongMainText = [
    fullCraft,
    fullPaper,
    fullFoil,
    fullPackageRequirement,
  ].some(
    (value) =>
      Array.from(value ?? '').length >= MAX_MAIN_FACT_CHARACTERS ||
      hasExplicitLineBreak(value),
  ) ||
    Array.from(fullRemark ?? '').length > MAX_MAIN_REMARK_CHARACTERS ||
    explicitLineCount(fullRemark) > MAX_MAIN_REMARK_LINES;
  const needsCondensedMain =
    itemAnnexPages.length > 0 || hasOversizedItem || hasLongMainText;
  const mainFactLimit =
    needsCondensedMain
      ? MAX_DENSE_MAIN_FACT_CHARACTERS
      : MAX_MAIN_FACT_CHARACTERS;
  const mainRemarkLimit =
    needsCondensedMain
      ? MAX_DENSE_MAIN_REMARK_CHARACTERS
      : MAX_MAIN_REMARK_CHARACTERS;
  const craft = previewForMain(fullCraft, mainFactLimit);
  const paper = previewForMain(fullPaper, mainFactLimit);
  const foil = previewForMain(fullFoil, mainFactLimit);
  const packageRequirement = previewForMain(
    fullPackageRequirement,
    mainFactLimit,
  );
  const remark =
    Array.from(fullRemark ?? '').length <= mainRemarkLimit &&
    explicitLineCount(fullRemark) <= MAX_MAIN_REMARK_LINES
      ? fullRemark
      : previewForMain(fullRemark, mainRemarkLimit);
  const supplementPages = buildSupplementPages([
    {
      key: 'factory',
      label: '工厂',
      value: clean(factoryName),
      mainLimit: MAX_HEADER_FACTORY_CHARACTERS,
    },
    {
      key: 'external-sales',
      label: '外部销售',
      value: clean(order.externalSalesName),
      mainLimit: MAX_HEADER_SALES_CHARACTERS,
    },
    {
      key: 'order-name',
      label: '工单名称',
      value: clean(order.customName),
      mainLimit: MAX_HEADER_ORDER_NAME_CHARACTERS,
      mainLines: MAX_HEADER_ORDER_NAME_LINES,
    },
    {
      key: 'craft',
      label: '生产工艺',
      value: fullCraft,
      mainLimit: mainFactLimit,
    },
    {
      key: 'paper',
      label: '纸张类型',
      value: fullPaper,
      mainLimit: mainFactLimit,
    },
    {
      key: 'foil',
      label: '烫金工艺',
      value: fullFoil,
      mainLimit: mainFactLimit,
    },
    {
      key: 'package',
      label: '包装要求',
      value: fullPackageRequirement,
      mainLimit: mainFactLimit,
    },
    {
      key: 'remark',
      label: '备注',
      value: fullRemark,
      mainLimit: mainRemarkLimit,
      mainLines: MAX_MAIN_REMARK_LINES,
    },
  ]);
  // A split or unusually tall item table consumes the main page's
  // variable-height allowance. Move all artwork to bounded annex pages in
  // that case so the browser never has to invent an undeclared physical page.
  const hasArtworkOnMainPage =
    artworks.length === 0 ||
    (!needsCondensedMain &&
      artworks.length <= MAX_ARTWORKS_ON_MAIN_PAGE);
  const artworkAnnexPages = hasArtworkOnMainPage
    ? []
    : chunk(artworks, MAX_ARTWORKS_PER_ANNEX_PAGE);
  const warnings = auditOrder(order, itemPackaging);
  const flowRows = buildFlowRows(order);
  const { mainFlowRows, flowAnnexPages } = paginateFlowRows(flowRows);
  const shipments =
    order.shipments.length > 0 ? order.shipments : [fallbackShipment(order)];
  const hasShipmentAnnex =
    shipments.length > MAX_SHIPMENTS_ON_MAIN_PAGE ||
    shipments.some(isLongShipment) ||
    shipments.reduce(
      (sum, shipment) => sum + estimateShipmentLines(shipment),
      0,
    ) > 6;
  const mainShipments = hasShipmentAnnex ? [] : shipments;
  const shipmentAnnexPages = hasShipmentAnnex
    ? chunk(shipments, MAX_SHIPMENTS_PER_ANNEX_PAGE)
    : [];
  const pageCount =
    1 +
    supplementPages.length +
    itemAnnexPages.length +
    artworkAnnexPages.length +
    shipmentAnnexPages.length +
    flowAnnexPages.length;
  const orderDate = formatDateInputShanghai(order.submittedAt ?? order.createdAt);
  const denseMainSheet =
    needsCondensedMain ||
    hasShipmentAnnex ||
    order.items.length >= 2 ||
    artworks.length >= 5 ||
    order.shipments.length > 1 ||
    order.productionSteps.length > 0;

  return (
    <>
      <style>{fontCss + PRINT_CSS}</style>
      <main className="work-order-document order-document" data-print-fonts="required" data-print-mode="order">
        <WorkOrderSheet
          order={order}
          page={1}
          pageCount={pageCount}
          orderDate={orderDate}
          dense={denseMainSheet}
        >
          <WorkOrderHeader order={order} factoryName={factoryName} />
          <AuditWarnings warnings={warnings} />

          <section className="sec">
            <div className="grid">
              <Fact label="生产工艺" value={craft} emphasis="l0" />
              <Fact label="纸张类型" value={paper} emphasis="l0" />
              <Fact label="烫金工艺" value={foil} emphasis="l1" />
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
                value={
                  packageRequirement ?? (packagingComplete ? (order.packagingGroups.some((group) => packagingType(group.mode) !== 'BAG') ? '见包装明细' : '见分袋明细') : null)
                }
                emphasis="l1"
              />
            </div>
            {remark ? (
              <div className="remark">
                <div className="lbl">备注</div>
                <div className="l1 note">{remark}</div>
              </div>
            ) : null}
          </section>

          <section className="sec">
            <ItemTable
              items={mainItems}
              showItemPaper={showItemPaper}
              packaging={itemPackaging}
              totalQuantity={totalQuantity}
              totalBags={totalBags}
              showTotal={itemAnnexPages.length === 0}
            />
          </section>

          {hasArtworkOnMainPage ? (
            <section className="sec">
              <ArtworkGrid artworks={artworks} onAnnex={false} />
            </section>
          ) : null}

          {/* 工序在下发生产时生成；还没有工序时不占位（原“暂无生产工序记录”）。 */}
          {flowRows.length > 0 ? (
            <section className="sec">
              {mainFlowRows.length === 0 ? (
                <p className="flow-empty">工序明细见附页</p>
              ) : (
                <FlowTable rows={mainFlowRows} />
              )}
            </section>
          ) : null}

          <section className="sec">
            {hasShipmentAnnex ? (
              <div className="shipment-annex-notice">
                {shipments.length} 个收货地址见附页
              </div>
            ) : (
              <ShippingBlock
                shipments={mainShipments}
                isSfCollect={order.isSfCollect}
              />
            )}
          </section>
        </WorkOrderSheet>

        {supplementPages.map((supplement, index) => {
          const page = 2 + index;
          return (
            <WorkOrderSheet
              key={`supplement-page-${supplement.key}-${supplement.part}`}
              order={order}
              page={page}
              pageCount={pageCount}
              orderDate={orderDate}
            >
              <WorkOrderHeader
                order={order}
                factoryName={factoryName}
              />
              <SupplementAnnexSection {...{
                supplement: supplement,
              }} />
            </WorkOrderSheet>
          );
        })}

        {itemAnnexPages.map((items, index) => {
          const page =
            2 + supplementPages.length + index;
          const isLastItemPage = index === itemAnnexPages.length - 1;
          return (
            <WorkOrderSheet
              key={`item-page-${page}`}
              order={order}
              page={page}
              pageCount={pageCount}
              orderDate={orderDate}
            >
              <WorkOrderHeader
                order={order}
                factoryName={factoryName}
              />
              <section className="sec item-annex">
                <div className="annex-title">款式明细（续）</div>
                <ItemTable
                  items={items}
                  showItemPaper={showItemPaper}
                  packaging={itemPackaging}
                  totalQuantity={totalQuantity}
                  totalBags={totalBags}
                  showTotal={isLastItemPage}
                />
              </section>
            </WorkOrderSheet>
          );
        })}

        {artworkAnnexPages.map((pageArtworks, index) => {
          const page =
            2 +
            supplementPages.length +
            itemAnnexPages.length +
            index;
          return (
            <WorkOrderSheet
              key={`artwork-page-${page}`}
              order={order}
              page={page}
              pageCount={pageCount}
              orderDate={orderDate}
            >
              <WorkOrderHeader
                order={order}
                factoryName={factoryName}
              />
              <section className="sec artwork-annex">
                <ArtworkGrid artworks={pageArtworks} onAnnex />
              </section>
            </WorkOrderSheet>
          );
        })}

        {shipmentAnnexPages.map((pageShipments, index) => {
          const page =
            2 +
            supplementPages.length +
            itemAnnexPages.length +
            artworkAnnexPages.length +
            index;
          return (
            <WorkOrderSheet
              key={`shipment-page-${page}`}
              order={order}
              page={page}
              pageCount={pageCount}
              orderDate={orderDate}
            >
              <WorkOrderHeader
                order={order}
                factoryName={factoryName}
              />
              <ShipmentAnnexSection {...{
                pageShipments: pageShipments, order: order,
              }} />
            </WorkOrderSheet>
          );
        })}

        {flowAnnexPages.map((rows, index) => {
          const page =
            2 +
            supplementPages.length +
            itemAnnexPages.length +
            artworkAnnexPages.length +
            shipmentAnnexPages.length +
            index;
          return (
            <WorkOrderSheet
              key={`flow-page-${page}`}
              order={order}
              page={page}
              pageCount={pageCount}
              orderDate={orderDate}
            >
              <WorkOrderHeader
                order={order}
                factoryName={factoryName}
              />
              <section className="sec flow-annex">
                <div className="annex-title">工序明细（续）</div>
                <FlowTable rows={rows} />
              </section>
            </WorkOrderSheet>
          );
        })}
      </main>
    </>
  );
}

function SupplementAnnexSection({ supplement }: { supplement: SupplementPage; }) {
  return (
    <section className="sec supplement-annex">
      <div className="annex-title">
        {supplement.label}
        {supplement.totalParts > 1 ? `（${supplement.part} / ${supplement.totalParts}）` : ''}
      </div>
      <div className="supplement-text">{supplement.value}</div>
    </section>
  );
}

function ShipmentAnnexSection({ pageShipments, order }: { pageShipments: PrintShipment[]; order: PrintOrder; }) {
  return (
    <section className="sec shipment-annex">
      <div className="annex-title">收货与快递（续）</div>
      <ShippingBlock shipments={pageShipments} isSfCollect={order.isSfCollect} />
    </section>
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
    <article className={classNames('sheet', dense && 'dense')} data-print-page={page} data-print-template="work-order">
      {children}
      <footer className="ft">
        <span>{order.orderNo} · v{order.workOrderVersion}</span>
        <span>{orderDate}</span>
        <span>
          {page} / {pageCount}
        </span>
      </footer>
    </article>
  );
}

function WorkOrderHeader({
  order,
  factoryName,
}: {
  order: PrintOrder;
  factoryName: string;
}) {
  const displayFactoryName = previewForHeader(
    clean(factoryName),
    MAX_HEADER_FACTORY_CHARACTERS,
  );
  const displaySalesName = previewForHeader(
    clean(order.externalSalesName),
    MAX_HEADER_SALES_CHARACTERS,
  );
  const fullOrderName = clean(order.customName);
  const displayOrderName =
    Array.from(fullOrderName ?? '').length <= MAX_HEADER_ORDER_NAME_CHARACTERS &&
    explicitLineCount(fullOrderName) <= MAX_HEADER_ORDER_NAME_LINES
      ? fullOrderName
      : previewForMain(fullOrderName, MAX_HEADER_ORDER_NAME_CHARACTERS);
  return (
    <header className="hd">
      <div className="hd-main">
        <div className="factory">{displayFactoryName}</div>
        {/* 抬头为工单归属的外部销售（原“客户”自 2026-09-13 起不再录入） */}
        <div className={classNames('cust', !displaySalesName && 'miss')}>
          {displaySalesName ?? '外部销售未填'}
        </div>
        {displayOrderName ? (
          <div className="order-name">工单 <b>{displayOrderName}</b></div>
        ) : null}
        <div className="line">
          状态 <b>{!order.simpleProduction && ['RELEASED', 'FOILING', 'PACKING'].includes(order.status) ? ({ RELEASED: '已下发', FOILING: '烫金中', PACKING: '打包中' } as Record<string, string>)[order.status] : ORDER_STATUS_REGISTRY[order.status].label}</b>
          {order.hasPendingChange ? <span className="tag">变更待审批</span> : null}
          {order.isUrgent ? <span className="tag">加急</span> : null}
          {order.kind === 'REWORK' ? (
            <span className="tag">
              重做{order.sourceOrderNo ? ` · ${order.sourceOrderNo}` : ''}
            </span>
          ) : null}
        </div>
      </div>
      <div className={classNames('scan', Array.from(order.orderNo).length > MAX_INLINE_ORDER_NUMBER_CHARACTERS && 'long-identifier')}>
        <div
          className="qr"
          aria-label={`工单 ${order.orderNo} 二维码`}
          dangerouslySetInnerHTML={{ __html: order.orderQrSvg }}
        />
        <div className="no">{order.orderNo} · v{order.workOrderVersion}</div>
      </div>
    </header>
  );
}

function AuditWarnings({
  warnings,
}: {
  warnings: string[];
}) {
  return (
    <>
      {warnings.length > 0 ? (
        <div className="warn">
          数据不完整：{warnings.join('；')}
        </div>
      ) : null}
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
  showItemPaper,
  packaging,
  totalQuantity,
  totalBags,
  showTotal,
}: {
  items: PrintOrderItem[];
  showItemPaper: boolean;
  packaging: Map<string, ItemPackaging>;
  totalQuantity: number;
  totalBags: number | null;
  showTotal: boolean;
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
            const itemPaper = showItemPaper ? formatPaper(item) : null;
            const processFacts = formatItemProcess(item);
            return (
              <tr key={item.id}>
                <td><span className="badge">{item.sequence}</span></td>
                <td className={!clean(item.specification) ? 'miss' : undefined}>
                  {clean(item.specification)
                    ? externalPriceBusinessText(item.specification!)
                    : '未填'}
                </td>
                <td>
                  <div>{clean(item.name) ?? `款式 ${item.sequence}`}</div>
                  {itemPaper ? <div className="item-material">{itemPaper}</div> : null}
                  {processFacts ? <div className="item-process">{processFacts}</div> : null}
                  {itemPack?.mode && packagingType(itemPack.mode) === 'BOX' ? <div className="item-process">{packagingModeLabel(itemPack.mode)}</div> : null}
                </td>
                <td className="num">{formatNumber(item.quantity)}</td>
                <td className={classNames('num', !hasPack && 'miss')}>
                  {itemPack?.mode === 'UNPACKED' ? '不包装' : hasPack ? `${formatNumber(itemPack!.unitsPerBag!)}${itemPack?.mode && packagingType(itemPack.mode) === 'BOX' ? '个/盒' : ''}` : '未填'}
                </td>
                <td className={classNames('num', !itemPack && 'miss')}>
                  {!itemPack
                    ? '—'
                    : itemPack.mode === 'UNPACKED' ? '—' : itemPack.mixed
                      ? '混装'
                      : itemPack.bagCount && itemPack.bagCount > 0
                        ? `${formatNumber(itemPack.bagCount)}${itemPack.mode && packagingType(itemPack.mode) === 'BOX' ? '盒' : ''}`
                        : '—'}
                </td>
              </tr>
            );
          })
        ) : (
          <tr><td colSpan={6} className="empty-row miss">无生产明细</td></tr>
        )}
      </tbody>
      {showTotal ? (
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
      ) : null}
    </table>
  );
}

function ArtworkGrid({ artworks, onAnnex }: { artworks: Artwork[]; onAnnex: boolean }) {
  const layout = artLayout(artworks.length, onAnnex);
  const style = {
    '--cols': String(layout.cols),
    ...(layout.cap ? { '--cap': layout.cap } : {}),
    ...(layout.maxBoxHeight
      ? { '--art-max-box-height': layout.maxBoxHeight }
      : {}),
    ...(layout.centered ? { '--art-justify': 'center' } : {}),
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
    <table className="flow flow-compact">
      <thead>
        <tr>
          <th className="flow-step-col">工序</th>
          <th className="num flow-number-col">计划数</th>
          <th className="num flow-number-col">完成数</th>
          <th className="num flow-defect-col">不良数</th>
          <th className="flow-date-col">完成日期</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const itemLabel = formatFlowItemLabel(row);
          return (
            <tr key={row.key}>
              <td className="step">
                {itemLabel ? (
                  <small className="flow-item">{itemLabel}</small>
                ) : null}
                {row.name}
              </td>
              <td className="num">{row.planned}</td>
              <td className="num">{row.completed}</td>
              <td className="num">{row.defect}</td>
              <td>{row.completedAt}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ShippingBlock({
  shipments,
  isSfCollect,
}: {
  shipments: PrintShipment[];
  isSfCollect: boolean;
}) {
  return (
    <div className="ship-list">
      {shipments.map((shipment) => {
        const receiver = clean(shipment.receiverName);
        const rest = [
          clean(shipment.receiverPhone),
          formatCarrier(shipment, isSfCollect),
          clean(shipment.expressCode),
        ]
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

function isLongShipment(shipment: PrintShipment): boolean {
  return [
    shipment.receiverName,
    shipment.receiverPhone,
    shipment.receiverAddress,
    shipment.expressCode,
  ].some((value) => Array.from(clean(value) ?? '').length > 80);
}

function estimateShipmentLines(shipment: PrintShipment): number {
  const header = [
    shipment.receiverName,
    shipment.receiverPhone,
    shipment.expressCode,
  ]
    .map(clean)
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  return (
    estimateTextLines(header, 42) +
    estimateTextLines(shipment.receiverAddress, 42)
  );
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
  const entries = new Map<string, Array<{ unitsPerBag: number; bagCount: number; mixed: boolean; mode: PrintPackagingGroup['mode'] }>>();
  for (const group of groups) {
    for (const line of group.lines) {
      const current = entries.get(line.orderItemId) ?? [];
      current.push({
        mode: group.mode,
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
      mode: rows[0]?.mode,
      unitsPerBag: units.length === 1 ? units[0]! : null,
      bagCount: mixed ? null : rows[0]?.bagCount ?? null,
      mixed,
    }];
  }));
}

function calculateTotalBags(order: PrintOrder, packaging: Map<string, ItemPackaging>): number | null {
  if (order.items.length === 0 || order.packagingGroups.length === 0 ||
    order.items.some((item) => !packaging.get(item.id)?.unitsPerBag) ||
    order.packagingGroups.some((group) => group.mode !== 'UNPACKED' && group.actualBagCount <= 0)) return null;
  return order.packagingGroups.reduce((sum, group) => sum + group.actualBagCount, 0);
}

function buildFlowRows(order: PrintOrder): FlowRow[] {
  return order.productionSteps.map((step) => ({
    key: `production-${step.source.toLowerCase()}-${step.id}`,
    itemSequence: step.itemSequence ?? null,
    itemName: step.itemName ?? null,
    scopeLabel: step.scopeLabel,
    name: clean(step.craftName) ?? '工序未填',
    planned: `${formatNumber(step.plannedQty)}${step.quantityUnit ? ` ${step.quantityUnit}` : ''}`,
    completed: formatProgress(step.completedQty),
    defect: formatProgress(step.defectQty),
    completedAt: step.completedAt ? formatDateInputShanghai(step.completedAt) : '',
  }));
}

function hasCompleteBagFacts(
  order: PrintOrder,
  packaging: Map<string, ItemPackaging>,
): boolean {
  return order.items.length > 0 && order.items.every(
    (item) => (packaging.get(item.id)?.unitsPerBag ?? 0) > 0,
  );
}

function auditOrder(order: PrintOrder, packaging: Map<string, ItemPackaging>): string[] {
  const warnings: string[] = [];
  if (!clean(order.externalSalesName)) warnings.push('外部销售未填');
  if (!order.promisedDate) warnings.push('交货日期未填');
  // Keep the legacy paper warning only when both the note and bag facts are
  // missing. Complete structured packaging needs no additional free-text note.
  if (!clean(order.packageRequirement) && !hasCompleteBagFacts(order, packaging)) {
    warnings.push('包装要求未填');
  }
  if (order.items.length === 0) warnings.push('无生产明细');
  for (const item of order.items) {
    const prefix = `图 ${item.sequence}`;
    if (!clean(item.specification)) warnings.push(`${prefix} 规格未填`);
    if (!clean(formatPaper(item))) warnings.push(`${prefix} 纸张未填`);
    if (
      declaredCraftNames(item).length === 0 &&
      !order.productionSteps.some((step) => step.itemSequence === item.sequence)
    ) {
      warnings.push(`${prefix} 生产工艺待确认`);
    }
    if (
      item.foilTechnique !== 'NONE' &&
      item.foilTechnique !== 'UNSPECIFIED' &&
      foilColorsBySide(item).all.length === 0
    ) {
      warnings.push(`${prefix} 烫金颜色未填`);
    }
    if (!packaging.get(item.id)?.unitsPerBag) warnings.push(`${prefix} 包装数量未填`);
    if (!item.designs.some((design) => design.fileType === 'IMAGE')) warnings.push(`${prefix} 缺设计图`);
  }
  const shipment = order.shipments[0] ?? fallbackShipment(order);
  if (!clean(shipment.receiverName)) warnings.push('收件人姓名未填');
  if (!clean(shipment.receiverPhone)) warnings.push('收件电话未填');
  if (!clean(shipment.receiverAddress)) warnings.push('收货地址未填');
  // Summarize repeated missing fields without creating paper-only audit pages.
  return unique(warnings.map((warning) => order.items.length > 1 ? warning.replace(/^图 \d+ /, '款式') : warning));
}

function formatPaper(item: PrintOrderItem): string | null {
  const paper = clean(item.paperType) ? paperDisplayLabel(externalPriceBusinessText(item.paperType!)) : null;
  if (!paper) return null;
  const weight = item.paperWeightGsm;
  if (!weight || new RegExp(`${weight}\\s*(?:g|克)`, 'i').test(paper)) return paper;
  return `${paper} ${weight}g`;
}

// 款名由建单人自定（DECISIONS 2026-09-26）后不再携带纸张与克重：一张工单混用多种
// 纸张 / 克重时逐行标出；只用一种时仍看顶部“纸张类型”，版面与页数不变。类型不另印，
// 每行工艺已写明局部平烫 / 专版平烫 / 彩印。
function hasMixedItemPaper(items: readonly PrintOrderItem[]): boolean {
  return new Set(items.map(formatPaper).filter(Boolean)).size > 1;
}

function formatFoil(item: PrintOrderItem): string | null {
  const { front, back, all } = foilColorsBySide(item);
  if (
    item.foilTechnique === 'UNSPECIFIED' &&
    item.hasLocalFoil === null &&
    all.length === 0
  ) {
    return null;
  }

  const technique = FOIL_TECHNIQUE_LABEL[item.foilTechnique];
  const scope =
    item.foilTechnique === 'NONE'
      ? ''
      : item.hasLocalFoil === true
        ? '局部'
        : item.hasLocalFoil === false
          ? '专版'
          : '';
  const process = `${scope}${technique}`;
  if (all.length === 0) return process;

  if (back.length > 0) {
    return `${process} · 正面 ${front.length > 0 ? front.join('、') : '未填'} / 反面 ${back.join('、')}`;
  }
  return `${process} · ${front.length > 0 ? front.join('、') : all.join('、')}`;
}

function formatColorPrint(item: PrintOrderItem): string | null {
  const colors = unique(item.printColors.map(externalPriceBusinessText));
  const hasPrintColors = colors.length > 0;
  const hasLamination = item.lamination !== 'NONE';
  if (!hasPrintColors && !hasLamination) {
    return null;
  }

  const facts: string[] = [];
  if (hasPrintColors) {
    facts.push(`彩印 ${colors.join('、')}`);
  } else if (!item.printColorsKnown) {
    facts.push('彩印颜色待确认');
  }
  if (hasLamination) {
    facts.push(LAMINATION_LABEL[item.lamination]);
  } else if (hasPrintColors) {
    facts.push(LAMINATION_LABEL.NONE);
  }
  return facts.join(' · ');
}

function formatItemProcess(item: PrintOrderItem): string | null {
  return joinDistinct([formatColorPrint(item), formatFoil(item)]);
}

function foilColorsBySide(item: PrintOrderItem): {
  front: string[];
  back: string[];
  all: string[];
} {
  const front = unique(item.frontFoilColors.map(foilColorLabel).map(externalPriceBusinessText));
  const back = unique(item.backFoilColors.map(foilColorLabel).map(externalPriceBusinessText));
  const legacy = unique(item.foilColors.map(foilColorLabel).map(externalPriceBusinessText));
  const normalizedFront = front.length > 0 ? front : back.length === 0 ? legacy : front;
  return {
    front: normalizedFront,
    back,
    all: unique([...normalizedFront, ...back]),
  };
}

function formatProductionCrafts(order: PrintOrder): string | null {
  return joinDistinct(
    order.productionSteps.length > 0
      ? order.productionSteps.map((step) => step.craftName)
      : order.items.flatMap(declaredCraftNames),
  );
}

function declaredCraftNames(item: PrintOrderItem): string[] {
  const persistedCrafts = unique(
    item.craftNames.map(clean).filter((name): name is string => Boolean(name)),
  );
  if (persistedCrafts.length > 0) return persistedCrafts;

  const explicitSteps: string[] = [];
  if (item.printColors.length > 0) explicitSteps.push('彩印');
  if (item.lamination !== 'NONE') explicitSteps.push('覆膜');
  if (
    item.foilTechnique !== 'NONE' &&
    (item.foilTechnique !== 'UNSPECIFIED' ||
      item.hasLocalFoil !== null ||
      foilColorsBySide(item).all.length > 0)
  ) {
    explicitSteps.push(
      item.hasLocalFoil === true
        ? '局部烫金'
        : item.hasLocalFoil === false
          ? '专版烫金'
          : '烫金',
    );
  }
  return unique(explicitSteps);
}

function formatFlowItemLabel(row: FlowRow): string | null {
  if (clean(row.scopeLabel)) return clean(row.scopeLabel);
  if (row.itemSequence === null) return null;
  const itemName = clean(row.itemName) ?? `款式 ${row.itemSequence}`;
  return `图 ${row.itemSequence} · ${itemName}`;
}

function formatCarrier(shipment: PrintShipment, isSfCollect: boolean): string | null {
  if (isSfCollect) return '顺丰到付';
  const carrier = clean(shipment.carrierCode);
  return carrier ? CARRIER_LABEL[carrier] ?? carrier : null;
}

function artLayout(count: number, onAnnex: boolean): {
  cols: number;
  cap: string | null;
  maxBoxHeight: string | null;
  centered: boolean;
} {
  if (onAnnex && count <= 1) {
    // A full-width 3:4 artwork is taller than the annex's printable area once
    // its repeated header, title, caption, and footer are included. Bound both
    // dimensions explicitly so Chromium cannot create an undeclared spill page.
    return {
      cols: 1,
      cap: '120mm',
      maxBoxHeight: '160mm',
      centered: true,
    };
  }
  if (onAnnex && count === 2) {
    return {
      cols: 2,
      cap: '82mm',
      maxBoxHeight: '110mm',
      centered: true,
    };
  }
  if (onAnnex) {
    return {
      cols: Math.max(1, Math.min(count, 6)),
      cap: null,
      maxBoxHeight: null,
      centered: false,
    };
  }
  if (count <= 1) {
    return {
      cols: 1,
      cap: '50mm',
      maxBoxHeight: null,
      centered: false,
    };
  }
  if (count <= 2) {
    return {
      cols: count,
      cap: '44mm',
      maxBoxHeight: null,
      centered: false,
    };
  }
  if (count <= 4) {
    return {
      cols: count,
      cap: '40mm',
      maxBoxHeight: null,
      centered: false,
    };
  }
  return {
    cols: count,
    cap: null,
    maxBoxHeight: null,
    centered: false,
  };
}

function formatProgress(value: number): string { return value > 0 ? formatNumber(value) : ''; }

function joinDistinct(values: Array<string | null | undefined>): string | null {
  const joined = unique(values.map(clean).filter((value): value is string => Boolean(value)));
  return joined.length > 0 ? joined.join(' / ') : null;
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

function paginateItems(items: PrintOrderItem[], showItemPaper: boolean): {
  mainItems: PrintOrderItem[];
  itemAnnexPages: PrintOrderItem[][];
} {
  const itemUnits = items.map((item) => estimateItemRowUnits(item, showItemPaper));
  const mainUnitLimit =
    items.length >= 4 || itemUnits.some((units) => units > 1)
    ? Math.ceil(MAX_ITEMS_ON_MAIN_PAGE / 2)
    : MAX_ITEMS_ON_MAIN_PAGE;
  const mainItems: PrintOrderItem[] = [];
  let mainUnits = 0;
  let nextIndex = 0;
  while (nextIndex < items.length && mainItems.length < MAX_ITEMS_ON_MAIN_PAGE) {
    const item = items[nextIndex]!;
    const units = itemUnits[nextIndex]!;
    if (mainItems.length > 0 && mainUnits + units > mainUnitLimit) {
      break;
    }
    mainItems.push(item);
    mainUnits += units;
    nextIndex += 1;
  }
  return {
    mainItems,
    itemAnnexPages: paginateByWeight(
      items.slice(nextIndex),
      MAX_ITEMS_PER_ANNEX_PAGE,
      (item) => estimateItemRowUnits(item, showItemPaper),
    ),
  };
}

function estimateItemRowUnits(item: PrintOrderItem, showItemPaper: boolean): number {
  const specificationLines = estimateTextLines(item.specification, 8);
  const nameLines = estimateTextLines(item.name, 20);
  const materialLines = showItemPaper ? estimateTextLines(formatPaper(item), 24) : 0;
  const processLines = estimateTextLines(formatItemProcess(item), 24);
  const estimatedLines = Math.max(
    specificationLines,
    nameLines + materialLines + processLines,
  );
  // A normal item uses two short visual lines (name + process) and occupies
  // one historical row slot. Longer legal values consume extra slots before
  // the deterministic paginator decides the annex boundary.
  return Math.max(1, Math.ceil(estimatedLines / 2));
}

function paginateFlowRows(rows: FlowRow[]): {
  mainFlowRows: FlowRow[];
  flowAnnexPages: FlowRow[][];
} {
  const mainFlowRows: FlowRow[] = [];
  let usedHeightMm = 0;
  for (const row of rows) {
    const heightMm = estimateCompactFlowRowHeightMm(row);
    if (usedHeightMm + heightMm > MAIN_FLOW_HEIGHT_MM) break;
    mainFlowRows.push(row);
    usedHeightMm += heightMm;
  }
  return {
    mainFlowRows,
    flowAnnexPages: paginateByWeight(
      rows.slice(mainFlowRows.length),
      ANNEX_FLOW_HEIGHT_MM,
      estimateCompactFlowRowHeightMm,
    ),
  };
}

function estimateCompactFlowRowHeightMm(row: FlowRow): number {
  return 2.4 +
    estimateTextLines(formatFlowItemLabel(row), 30) * 2.8 +
    estimateTextLines(row.name, 20) * 3.5;
}

function paginateByWeight<T>(
  values: T[],
  maxUnits: number,
  getUnits: (value: T) => number,
): T[][] {
  const pages: T[][] = [];
  let page: T[] = [];
  let usedUnits = 0;
  for (const value of values) {
    const units = Math.max(1, getUnits(value));
    if (page.length > 0 && usedUnits + units > maxUnits) {
      pages.push(page);
      page = [];
      usedUnits = 0;
    }
    page.push(value);
    usedUnits += units;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

function estimateTextLines(
  value: string | null | undefined,
  charactersPerLine: number,
): number {
  const normalized = clean(value);
  if (!normalized) return 0;
  return normalized.split(/\r?\n/).reduce((sum, line) => {
    const length = Array.from(line).length;
    return sum + Math.max(1, Math.ceil(length / charactersPerLine));
  }, 0);
}

function previewForMain(
  value: string | null,
  maxCharacters: number,
): string | null {
  if (!value) return null;
  // Main-sheet summaries are deliberately single-flow text. Explicit line
  // breaks are preserved verbatim on deterministic supplement pages instead
  // of being allowed to make the physical first page taller than its model.
  const compact = value.replace(/\s+/g, ' ').trim();
  const characters = Array.from(compact);
  if (characters.length <= maxCharacters) return compact;
  return `${characters.slice(0, maxCharacters).join('')}…（见附页）`;
}

function previewForHeader(
  value: string | null,
  maxCharacters: number,
): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  const characters = Array.from(compact);
  return characters.length <= maxCharacters
    ? compact
    : `${characters.slice(0, maxCharacters).join('')}…`;
}

function buildSupplementPages(
  sources: Array<{
    key: string;
    label: string;
    value: string | null;
    mainLimit: number;
    mainLines?: number;
  }>,
): SupplementPage[] {
  return sources.flatMap((source) => {
    if (!source.value) return [];
    const characters = Array.from(source.value);
    if (
      characters.length <= source.mainLimit &&
      explicitLineCount(source.value) <= (source.mainLines ?? 1)
    ) {
      return [];
    }
    const parts = paginateSupplementText(source.value);
    return parts.map((value, index) => ({
      key: source.key,
      label: source.label,
      part: index + 1,
      totalParts: parts.length,
      value,
    }));
  });
}

function hasExplicitLineBreak(value: string | null | undefined): boolean {
  return Boolean(value && /\r?\n/.test(value));
}

function explicitLineCount(value: string | null | undefined): number {
  return value ? value.split(/\r?\n/).length : 0;
}

function paginateSupplementText(value: string): string[] {
  const pages: string[] = [];
  let pageCharacters: string[] = [];
  let lineCount = 1;
  let column = 0;

  const flush = () => {
    if (pageCharacters.length === 0) return;
    pages.push(pageCharacters.join(''));
    pageCharacters = [];
    lineCount = 1;
    column = 0;
  };

  for (const character of Array.from(value)) {
    const isNewline = character === '\n';
    const wrapsLine = !isNewline && column >= SUPPLEMENT_CHARACTERS_PER_LINE;
    const additionalLine = isNewline || wrapsLine ? 1 : 0;
    if (
      pageCharacters.length >= MAX_SUPPLEMENT_CHARACTERS_PER_PAGE ||
      (pageCharacters.length > 0 &&
        lineCount + additionalLine > MAX_SUPPLEMENT_LINES_PER_PAGE)
    ) {
      flush();
    }

    pageCharacters.push(character);
    if (isNewline) {
      lineCount += 1;
      column = 0;
    } else if (column >= SUPPLEMENT_CHARACTERS_PER_LINE) {
      lineCount += 1;
      column = 1;
    } else if (character !== '\r') {
      column += 1;
    }
  }
  flush();
  return pages;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

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
  font-family:"ERP Print Sans",sans-serif;
  font-synthesis:none;
  color:var(--ink); background:#93969a; font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased; padding:8mm 0;
}
.work-order-document{ width:100%; }
.sheet{
  width:210mm; min-height:297mm; padding:13mm 13mm 10mm; margin:0 auto 8mm;
  background:#fff; box-shadow:0 2mm 8mm rgba(0,0,0,.3); display:flex;
  flex-direction:column; break-after:page; page-break-after:always;
}
.sheet.dense{ padding-top:10mm; padding-bottom:7mm; }
.sheet:last-child{ break-after:auto; page-break-after:auto; }
.lbl{ font-size:6pt; font-weight:600; letter-spacing:.18em; color:var(--mute); }
.l1{ font-size:13.5pt; font-weight:800; line-height:1.2; }
.l0{ font-size:18pt; font-weight:800; line-height:1.05; letter-spacing:-.015em; }
.hd{ display:flex; justify-content:space-between; align-items:flex-start; gap:10mm; padding-bottom:4mm; border-bottom:.7mm solid var(--rule); }
.hd-main{ min-width:0; flex:1 1 auto; overflow:hidden; }
.factory{ font-size:8pt; font-weight:700; color:var(--mute); letter-spacing:.08em; margin-bottom:1.8mm; }
.factory,.cust{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cust{ max-width:130mm; font-size:26pt; font-weight:800; line-height:1; letter-spacing:-.02em; }
.order-name{ margin-top:2mm; font-size:10pt; line-height:1.4; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--mute); }
.order-name b{ color:var(--ink); }
.flow-empty{ font-size:9pt; color:var(--mute); margin:2mm 0; }
.line{ display:flex; align-items:center; flex-wrap:wrap; gap:1.5mm; font-size:9.5pt; font-weight:600; color:var(--mute); margin-top:2.6mm; }
.line b{ max-width:60mm; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink); }
.line b.miss{ color:var(--flag); }
.sep{ color:var(--hair); margin:0 .5mm; }
.scan{ text-align:right; flex:0 0 auto; }
.scan.long-identifier{ min-width:25mm; max-width:65mm; }
.scan.long-identifier .no{ white-space:normal; overflow-wrap:anywhere; }
.scan .qr{ min-width:25mm; min-height:25mm; margin-left:auto; display:flex; justify-content:flex-end; }
.scan svg{ min-width:25mm; min-height:25mm; display:block; }
.scan .no{ font-family:"ERP Print Mono",monospace; font-size:8pt; font-weight:700; margin-top:1.4mm; white-space:nowrap; }
.sec{ padding:4.5mm 0; border-top:.25mm solid var(--hair); }
.sheet.dense > .sec{ padding-top:3mm; padding-bottom:3mm; }
.order-document .sheet.dense > .sec{ padding-top:2.2mm; padding-bottom:2.2mm; }
.order-document .sheet.dense .hd{ padding-bottom:3mm; }
.order-document .sheet.dense .grid{ gap:2.8mm 5mm; }
.order-document .sheet.dense .fact .l0{ font-size:14.5pt; }
.order-document .sheet.dense .fact .l1{ font-size:11.5pt; }
.order-document .sheet.dense .remark{ margin-top:2.5mm; }
.order-document .sheet.dense .remark .note{ font-size:11pt; }
.order-document .sheet.dense .items tbody td{ padding-top:1mm; padding-bottom:1mm; font-size:9.5pt; }
.order-document .sheet.dense .items .col-fig{ width:10mm; }
.order-document .sheet.dense .items .col-spec{ width:22mm; }
.order-document .sheet.dense .items .col-qty{ width:22mm; }
.order-document .sheet.dense .items .col-pack{ width:18mm; }
.order-document .sheet.dense .items .col-bags{ width:16mm; }
.order-document .sheet.dense .item-process,
.order-document .sheet.dense .item-material{ font-size:6.8pt; margin-top:.4mm; }
.order-document .sheet.dense .thumb .box{ max-height:42mm; }
.sec:first-of-type{ border-top:none; }
.grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:5mm 6mm; align-items:start; }
.fact{ min-width:0; }
.fact .l0,.fact .l1{ margin-top:1.2mm; overflow-wrap:anywhere; }
.miss{ color:var(--flag); }
.warn{ margin-top:3mm; border-left:.8mm solid var(--flag); padding-left:2.4mm; color:var(--flag); font-size:9pt; font-weight:700; line-height:1.4; }
.warn[hidden]{ display:none; }
.unit{ font-size:9pt; font-weight:600; color:var(--mute); margin-left:.8mm; }
.remark{ margin-top:5mm; }
.note{ border-left:.8mm solid var(--flag); padding-left:2.4mm; color:var(--flag); white-space:pre-wrap; }
.tag{ display:inline-block; border:.45mm solid var(--flag); color:var(--flag); font-size:8pt; font-weight:800; padding:.2mm 1.6mm; border-radius:.6mm; letter-spacing:.06em; margin-left:1mm; }
table{ width:100%; border-collapse:collapse; }
th,td{ border:none; padding:1.6mm 2mm 1.6mm 0; text-align:left; }
thead th{ font-size:6pt; font-weight:600; letter-spacing:.18em; color:var(--mute); border-bottom:.4mm solid var(--rule); padding-bottom:1.4mm; }
tbody td{ border-bottom:.15mm solid var(--hair); font-size:10.5pt; font-weight:600; }
.num{ text-align:right; font-weight:800; }
tfoot td{ border-top:.4mm solid var(--rule); border-bottom:none; font-size:11.5pt; font-weight:800; padding-top:2.2mm; }
.items tbody td{ height:7mm; }
.items tbody td:nth-child(2),.items tbody td:nth-child(3){ overflow-wrap:anywhere; }
.item-process,
.item-material{ max-width:65mm; color:var(--mute); font-size:7.2pt; font-weight:600; line-height:1.35; margin-top:.7mm; }
.empty-row{ height:14mm !important; text-align:center; }
.col-fig{ width:14mm; }.col-spec{ width:26mm; }.col-qty,.col-pack{ width:26mm; }.col-bags{ width:22mm; }
.flow tbody td{ min-height:11mm; }.flow .step{ font-size:11.5pt; font-weight:800; }
.flow .step small{ display:block; color:var(--mute); font-size:7pt; font-weight:600; }
.flow .step .flow-item{ margin-bottom:.8mm; }
.flow-compact .flow-step-col{ width:auto; }
.flow-compact .flow-number-col{ width:25mm; }.flow-compact .flow-defect-col{ width:20mm; }.flow-compact .flow-date-col{ width:27mm; }
.flow-compact tbody td{ font-size:9pt; line-height:1.2; padding-top:1.1mm; padding-bottom:1.1mm; }
.flow-compact .step{ font-size:9pt; overflow-wrap:anywhere; }
.flow-compact .step small{ font-size:6.8pt; line-height:1.2; }
.flow-compact .step .flow-item{ display:inline; margin-bottom:0; margin-right:2mm; }
.flow-step-col{ width:30mm; }.flow-number-col{ width:24mm; }.flow-defect-col{ width:20mm; }.flow-date-col{ width:26mm; }
.flow-annex{ flex:1; }
.annex-title{ font-size:15pt; font-weight:800; margin-bottom:4mm; }
.item-annex,.supplement-annex,.shipment-annex{ flex:1; }
.supplement-text{ white-space:pre-wrap; overflow-wrap:anywhere; font-size:11pt; font-weight:600; line-height:1.65; }
.shipment-annex-notice{ font-size:11pt; font-weight:700; color:var(--mute); }
.badge{ display:inline-flex; align-items:center; justify-content:center; min-width:5.2mm; height:5.2mm; padding:0 1.3mm; background:var(--ink); color:#fff; border-radius:99mm; font-size:8.5pt; font-weight:800; }
.art{ display:grid; gap:3.5mm; justify-content:var(--art-justify,start); grid-template-columns:repeat(var(--cols),minmax(0,var(--cap,1fr))); }
.thumb{ min-width:0; }
.thumb .box{ width:100%; max-height:var(--art-max-box-height,none); aspect-ratio:3/4; border:.2mm solid var(--hair); display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; background:#fff; }
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
.ship{ overflow-wrap:anywhere; white-space:pre-wrap; }
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
