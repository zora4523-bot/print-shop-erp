import Decimal from 'decimal.js';
import { formatFoilColors } from '@/lib/order/foil-colors';
import type { ReactNode } from 'react';
import type { getOrderDetail } from '@/lib/order';
import {
  ORDER_PRICING_ROUTE_LABELS,
  deriveLegacyOrderItemFoilFacts,
} from '@/lib/order/pricing-route';
import { ORDER_SETTLEMENT_LABELS } from '@/lib/order/settlement';
import { formatMoney } from '@/lib/dashboard/format';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { DesignUploadPanel } from './DesignUploadPanel';

type Order = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;
const readable = (value: string | null | undefined) =>
  value ? externalPriceBusinessText(value) : '未填写';
const qty = (value: number) => value.toLocaleString('zh-CN');
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm [overflow-wrap:anywhere]">
        {children ?? '未填写'}
      </dd>
    </div>
  );
}

/** Render persisted facts, never defaults from today's create catalog. */
export function OrderSavedConfiguration({
  order,
  canEditDesigns,
  feesOnly = false,
}: {
  order: Order;
  canEditDesigns: boolean;
  feesOnly?: boolean;
}) {
  if (feesOnly) {
    return (
      <Card id="saved-fees">
        <CardHeader className="border-b pb-3">
          <h2 className="text-sm font-semibold">费用</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="divide-y">
            {order.items.map((item) => (
              <Disclosure key={item.id}>
                <DisclosureSummary className="justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0 break-words">
                    第 {item.sequence} 款 · {readable(item.name)}
                  </span>
                  <strong className="ml-auto shrink-0 tabular-nums">
                    {'subtotal' in item ? (item.subtotal == null ? '待核定' : formatMoney(String(item.subtotal))) : '待核定'}
                  </strong>
                </DisclosureSummary>
                <dl className="grid gap-3 pb-4 sm:grid-cols-3">
                  <Fact label="数量">{qty(item.quantity)} 个</Fact>
                  <Fact label="加工单价">
                    {'unitPrice' in item
                      ? formatUnitPrice(String(item.unitPrice))
                      : '待核定'}
                  </Fact>
                  <Fact label="一次性费用">
                    {'fixedFee' in item ? (item.fixedFee == null ? '待核定' : formatMoney(String(item.fixedFee))) : '待核定'}
                  </Fact>
                </dl>
              </Disclosure>
            ))}
            <div className="flex justify-between gap-3 py-3 text-sm">
              <span>入袋费</span>
              <span>
                {order.items.length && 'packagingAmount' in order
                  ? (order.packagingAmount == null ? '待核定' : formatMoney(String(order.packagingAmount)))
                  : '未计价'}
              </span>
            </div>
            {order.customerCharges.map((charge) => (
              <div
                key={charge.id}
                className="flex flex-wrap justify-between gap-2 py-3 text-sm"
              >
                <span>
                  {charge.category.name}
                  {charge.shipment
                    ? ` · 第 ${charge.shipment.sequence} 票`
                    : ''}
                </span>
                <span className="tabular-nums">{charge.amount == null ? '待核定' : formatMoney(String(charge.amount))}</span>
                {charge.overrideReason ? (
                  <p className="basis-full text-xs text-muted-foreground">
                    {charge.overrideReason}
                  </p>
                ) : null}
              </div>
            ))}
            {order.items.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                未记录款式，暂不能计算生产费用。
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-t pt-4">
            <span className="text-sm font-medium">当前工单金额</span>
            <strong className="text-lg tabular-nums">
              {'totalAmount' in order ? (order.totalAmount == null ? '待核定' : formatMoney(String(order.totalAmount))) : '待核定'}
            </strong>
          </div>
          <Disclosure>
            <DisclosureSummary className="text-xs text-muted-foreground">
              报价与结算记录
            </DisclosureSummary>
            <dl className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-3">
              <Fact label="原始报价">{order.quotedFee == null ? '待核定' : formatMoney(String(order.quotedFee))}</Fact>
              <Fact label="当前确认金额">{order.confirmedFee == null ? '待核定' : formatMoney(String(order.confirmedFee))}</Fact>
              <Fact label="结算金额">
                {order.settledFee === null ? '未结算' : formatMoney(String(order.settledFee))}
              </Fact>
            </dl>
          </Disclosure>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="min-w-0 space-y-4">
      {!feesOnly ? (
        <Card id="saved-items">
          <CardHeader>
            <h2 className="text-base font-semibold">
              款式与设计 · {order.items.length} 款
            </h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {order.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                未记录款式，无法核对生产和计价信息。
              </p>
            ) : null}
            {order.items.map((item) => {
              return (
                <Disclosure key={item.id} className="min-w-0 rounded-lg border">
                  <DisclosureSummary className="min-h-11 flex-wrap px-3 py-3">
                    <span className="min-w-0 break-words">
                      #{item.sequence} · {readable(item.name)}
                    </span>
                    <span className="ml-auto text-sm tabular-nums">
                      {qty(item.quantity)} 个
                    </span>
                  </DisclosureSummary>
                  <OrderSavedItemDetails
                    order={order}
                    item={item}
                    canEditDesigns={canEditDesigns}
                  />
                </Disclosure>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
      <Card id="saved-fees">
        <CardHeader>
          <h2 className="text-base font-semibold">
            {feesOnly ? '费用' : '已保存费用'}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-3">
            {'settlementType' in order ? (
              <Fact label="结算方式">
                {Object.entries(ORDER_SETTLEMENT_LABELS).find(
                  ([key]) => key === order.settlementType,
                )?.[1] ?? '未明确'}
              </Fact>
            ) : null}
            <Fact label="配送方式">
              {order.shipments.length === 0
                ? '未记录'
                : order.isSfCollect
                  ? '顺丰到付'
                  : '寄付'}
            </Fact>
            {'processingAmount' in order ? (
              <Fact label="加工费">
                {order.items.length
                  ? formatMoney(
                      new Decimal(String(order.processingAmount))
                        .minus(
                          'packagingAmount' in order
                            ? String(order.packagingAmount)
                            : '0',
                        ),
                    )
                  : '未计价'}
              </Fact>
            ) : null}
            {'packagingAmount' in order ? (
              <Fact label="入袋费">
                {order.items.length ? (order.packagingAmount == null ? '待核定' : formatMoney(String(order.packagingAmount))) : '未计价'}
              </Fact>
            ) : null}
            <Fact label="报价">{order.quotedFee == null ? '待核定' : formatMoney(String(order.quotedFee))}</Fact>
            <Fact label="确认金额">{order.confirmedFee == null ? '待核定' : formatMoney(String(order.confirmedFee))}</Fact>
            <Fact label="结算金额">{order.settledFee == null ? '待核定' : formatMoney(String(order.settledFee))}</Fact>
          </dl>
          <ul className="divide-y">
            {order.customerCharges.map((charge) => (
              <li
                key={charge.id}
                className="flex min-w-0 flex-wrap justify-between gap-2 py-2 text-sm"
              >
                <span className="min-w-0 break-words">
                  {charge.category.name}
                  {charge.shipment
                    ? ` · 第 ${charge.shipment.sequence} 票`
                    : ''}
                  {charge.description
                    ? ` · ${readable(charge.description)}`
                    : ''}
                </span>
                <span className="tabular-nums">{charge.amount == null ? '待核定' : formatMoney(String(charge.amount))}</span>
                {charge.overrideReason ? (
                  <p className="basis-full text-xs text-muted-foreground">
                    {charge.overrideReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

export function OrderSavedItemDetails({
  order,
  item,
  canEditDesigns = false,
  includeDesigns = true,
}: {
  order: Order;
  item: Order['items'][number];
  canEditDesigns?: boolean;
  includeDesigns?: boolean;
}) {
  const foil = deriveLegacyOrderItemFoilFacts(item);
  return (
    <div className="space-y-4 border-t p-3 sm:p-4">
      <dl className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="产品组合">{readable(item.product?.name)}</Fact>
        <Fact label="计价路线">
          {ORDER_PRICING_ROUTE_LABELS[item.pricingRoute]}
        </Fact>
        <Fact label="产品结构">
          {
            {
              UNSPECIFIED: '未明确',
              STANDARD_ENVELOPE: '普通封',
              WESTERN_ENVELOPE: '西封',
              TEN_THOUSAND_ENVELOPE: '万元封',
            }[item.productStructure]
          }
        </Fact>
        <Fact label="规格">{readable(item.specification)}</Fact>
        <Fact label="实际尺寸">
          {item.actualWidthMm !== null && item.actualHeightMm !== null
            ? `${item.actualWidthMm} × ${item.actualHeightMm} mm`
            : '未设置'}
        </Fact>
        <Fact label="纸张与克重">
          {readable(item.paperType)}
          {item.paperWeightGsm !== null ? ` · ${item.paperWeightGsm} g/㎡` : ''}
        </Fact>
        <Fact label="版组">{item.plateGroupId}</Fact>
        <Fact label="覆膜">
          {
            {
              NONE: '不覆膜',
              MATTE: '覆哑膜',
              SOFT_TOUCH: '触感膜',
              NEW_GLOSS: '新光膜',
              LASER: '镭射膜',
            }[item.lamination]
          }
        </Fact>
        <Fact label="每袋数量（历史记录）">
          {item.pack === null ? '未记录' : qty(item.pack)}
        </Fact>
        <Fact label="稿件版本">{item.artworkVersion}</Fact>
        <Fact label="专版计价组">
          {item.pricingGroup === 'MID'
            ? '中封组'
            : item.pricingGroup === 'LARGE'
              ? '大封组'
              : readable(item.pricingGroup)}
        </Fact>
        <Fact label="烫金方式">
          {
            {
              UNSPECIFIED: '未明确',
              NONE: '不烫金',
              FLAT: '平烫',
              RELIEF: '浮雕',
              RAISED: '激凸',
            }[item.foilTechnique]
          }
        </Fact>
        <Fact label="正面烫金">
          {foil.frontFoilColors.length
            ? formatFoilColors(foil.frontFoilColors)
            : '无'}
        </Fact>
        <Fact label="反面烫金">
          {foil.backFoilColors.length
            ? formatFoilColors(foil.backFoilColors)
            : '无'}
        </Fact>
        <Fact label="局部烫金">
          {item.hasLocalFoil === null
            ? '未明确'
            : item.hasLocalFoil
              ? '是'
              : '否'}
        </Fact>
        <Fact label="彩印颜色">
          {item.printColorsKnown
            ? item.printColors.join('、') || '无'
            : '未明确'}
        </Fact>
        <Fact label="工艺">{item.craftNames.join('、') || '未记录'}</Fact>
        <Fact label="款式备注">{item.remark}</Fact>
        {'unitPrice' in item ? (
          <Fact label="加工单价">
            {formatUnitPrice(String(item.unitPrice))}
          </Fact>
        ) : null}
        {'fixedFee' in item ? (
          <Fact label="一次性费用">{item.fixedFee == null ? '待核定' : formatMoney(String(item.fixedFee))}</Fact>
        ) : null}
        {'subtotal' in item ? (
          <Fact label="款式小计">{item.subtotal == null ? '待核定' : formatMoney(String(item.subtotal))}</Fact>
        ) : null}
        {'manualQuoteReason' in item && item.manualQuoteReason ? (
          <Fact label="人工报价原因">{String(item.manualQuoteReason)}</Fact>
        ) : null}
        {'priceOverrideReason' in item && item.priceOverrideReason ? (
          <Fact label="改价说明">{String(item.priceOverrideReason)}</Fact>
        ) : null}
      </dl>
      {'plateDetails' in item && item.plateDetails.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">制版明细</h3>
          {item.plateDetails.map((plate) => (
            <p key={plate.id} className="break-words text-sm">
              {plate.name}
              {plate.isActive ? '' : '（已移除）'} ·{' '}
              {readable(plate.specification)} · {plate.quantity} ×{' '}
              {plate.unitPrice == null ? '待核定' : formatMoney(String(plate.unitPrice))} · {plate.amount == null ? '待核定' : formatMoney(String(plate.amount))}
              {plate.remark ? ` · ${plate.remark}` : ''}
            </p>
          ))}
        </div>
      ) : null}
      {includeDesigns ? (
        <DesignUploadPanel
          orderId={order.id}
          orderItemId={item.id}
          canEdit={canEditDesigns}
          designs={item.designs.map((design) => ({
            id: design.id,
            fileName: design.fileName,
            fileType: design.fileType,
            fileUrl:
              design.fileType === 'IMAGE'
                ? signDesignReadUrl(design.fileUrl)
                : '',
            fileSize: String(design.fileSize),
          }))}
        />
      ) : null}
    </div>
  );
}

/** Saved allocations and bag quantities remain read-only during basic edits. */
export function OrderSavedPackaging({ order }: { order: Order }) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {order.shipments.map((shipment) => (
          <div key={shipment.id} className="min-w-0 rounded-lg border p-3">
            <h3 className="text-sm font-medium">
              第 {shipment.sequence} 票 ·{' '}
              {shipment.receiverName ?? '未填收件人'}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {shipment.lines
                .map(
                  (line) =>
                    `#${line.orderItem.sequence} ${readable(line.orderItem.name)} × ${qty(line.quantity)}`,
                )
                .join('；') || '未记录分货数量'}
            </p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <Fact label="配送省份">{shipment.destinationProvince}</Fact>
              <Fact label="预估重量">
                {shipment.quotedWeightKg === null
                  ? '未记录'
                  : `${shipment.quotedWeightKg} kg`}
              </Fact>
              <Fact label="实际计费重量">
                {shipment.weightKg === null
                  ? '未记录'
                  : `${shipment.weightKg} kg`}
              </Fact>
              <Fact label="运单号">{shipment.trackingNo}</Fact>
            </dl>
          </div>
        ))}
      </div>
      {order.packagingGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">未记录分袋明细。</p>
      ) : null}
      {order.packagingGroups.map((group) => (
        <div key={group.id} className="min-w-0 rounded-lg border p-3">
          <h3 className="text-sm font-medium">
            包装组 #{group.sequence}
            {group.name ? ` · ${group.name}` : ''} ·{' '}
            {group.mode === 'MIXED_STYLE' ? '混装' : '单款装'}
          </h3>
          <p className="mt-1 text-sm">
            实际 {qty(group.actualBagCount)} 袋 ·{' '}
            {group.lines
              .map(
                (line) =>
                  `#${line.orderItem.sequence} 每袋 ${qty(line.unitsPerBag)} 个`,
              )
              .join('；') || '未记录每袋组成'}
          </p>
          {'subtotal' in group ? (
            <p className="mt-1 text-sm text-muted-foreground">
              入袋单价 {formatUnitPrice(String(group.unitPrice))} · 小计{' '}
              {group.subtotal == null ? '待核定' : formatMoney(String(group.subtotal))}
              {group.priceOverrideReason
                ? ` · ${group.priceOverrideReason}`
                : ''}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
