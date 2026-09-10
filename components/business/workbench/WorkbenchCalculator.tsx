'use client';

import { useRef, useState } from 'react';
import { Calculator } from 'lucide-react';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
} from '@/generated/prisma/enums';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import {
  MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE,
  NEW_ORDER_PRICING_ROUTES,
  ORDER_PRICING_ROUTE_LABELS,
  productCategoryMatchesPricingRoute,
} from '@/lib/order/pricing-route';
import { formatMoney } from '@/lib/dashboard/format';
import { formatRate } from '@/lib/format/unit-price';
import { quoteWorkbenchAction } from '@/actions/workbench';
import type {
  WorkbenchQuoteInput,
  WorkbenchQuoteResult,
} from '@/lib/workbench/quote';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ActionNotice, EmptyState } from '@/components/ui-business';
import { WorkbenchChoice } from './WorkbenchChoice';
import { WorkbenchProductFields } from './WorkbenchProductFields';

function isColorUnavailable(selected: readonly string[], color: string) {
  return (
    selected.length >= MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE &&
    !selected.includes(color)
  );
}

export function WorkbenchCalculator({
  options,
}: {
  options: ExternalCreateOrderOptions;
}) {
  const [route, setRoute] = useState<WorkbenchQuoteInput['pricingRoute']>(
    OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
  );
  const [productId, setProductId] = useState('');
  const [specification, setSpecification] = useState('');
  const [paperType, setPaperType] = useState('');
  const [quantity, setQuantity] = useState('1000');
  const [technique, setTechnique] = useState<
    WorkbenchQuoteInput['foilTechnique']
  >(OrderFoilTechnique.FLAT);
  const [front, setFront] = useState<string[]>([]);
  const [back, setBack] = useState<string[]>([]);
  const [markup, setMarkup] = useState('35');
  const [result, setResult] = useState<WorkbenchQuoteResult | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const products = options.products.filter((product) =>
    productCategoryMatchesPricingRoute(route, product.category),
  );
  function invalidate() {
    generation.current += 1;
    setResult(null);
    setPending(false);
  }
  function change<T>(setter: (value: T) => void, value: T) {
    invalidate();
    setter(value);
  }
  async function calculate(event: React.FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    setPending(true);
    setResult(null);
    try {
      const response = await quoteWorkbenchAction({
        productId,
        pricingRoute: route,
        specification,
        paperType,
        quantity: Number(quantity),
        foilTechnique: technique,
        frontFoilColors: front,
        backFoilColors: back,
        markup: Number(markup),
      });
      if (generation.current === request) {
        setResult(response);
        requestAnimationFrame(() => {
          if (generation.current === request) resultHeading.current?.focus();
        });
      }
    } catch {
      if (generation.current === request)
        setResult({
          status: 'error',
          message: '计算失败，请检查网络后重新计算',
        });
    } finally {
      if (generation.current === request) setPending(false);
    }
  }
  function toggleColor(side: 'front' | 'back', color: string) {
    const values = side === 'front' ? front : back;
    if (isColorUnavailable(values, color)) return;
    const next = values.includes(color)
      ? values.filter((value) => value !== color)
      : [...values, color];
    change(side === 'front' ? setFront : setBack, next);
  }
  if (!options.products.length)
    return (
      <EmptyState
        title="暂无可报价产品"
        description="请联系管理员配置产品后重试"
      />
    );
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Card className="min-w-0 p-4 sm:p-6">
        <h2 className="text-lg font-semibold">客户需求</h2>
        <form onSubmit={calculate} className="space-y-5">
          <WorkbenchChoice
            label="产品类型"
            value={route}
            options={NEW_ORDER_PRICING_ROUTES.map((value) => ({
              value,
              label: ORDER_PRICING_ROUTE_LABELS[value],
            }))}
            onChange={(value) => {
              invalidate();
              setRoute(value as WorkbenchQuoteInput['pricingRoute']);
              setProductId('');
              setSpecification('');
              setPaperType('');
              setFront([]);
              setBack([]);
              setTechnique(
                value === OrderItemPricingRoute.COLOR_PRINT
                  ? OrderFoilTechnique.NONE
                  : OrderFoilTechnique.FLAT,
              );
            }}
          />
          <WorkbenchProductFields
            products={products}
            papers={options.papers}
            selection={{ productId, specification, paperType }}
            onChange={(next) => {
              invalidate();
              setProductId(next.productId);
              setSpecification(next.specification);
              setPaperType(next.paperType);
            }}
          />
          <div className="space-y-2">
            <Label htmlFor="workbench-quantity">数量（个）</Label>
            <Input
              id="workbench-quantity"
              className="min-h-11"
              type="number"
              min="1"
              max="9999999"
              step="1"
              required
              value={quantity}
              onChange={(event) => change(setQuantity, event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {[500, 1000, 2000, 5000, 10000, 50000].map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={quantity === String(value) ? 'secondary' : 'outline'}
                  className="min-h-11"
                  aria-pressed={quantity === String(value)}
                  onClick={() => change(setQuantity, String(value))}
                >
                  {value.toLocaleString('zh-CN')}
                </Button>
              ))}
            </div>
          </div>
          <WorkbenchChoice
            label="烫金方式"
            value={technique}
            options={[
              ...(route === OrderItemPricingRoute.COLOR_PRINT
                ? [{ value: OrderFoilTechnique.NONE, label: '无烫金' }]
                : []),
              { value: OrderFoilTechnique.FLAT, label: '平烫' },
              ...(route === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL
                ? [
                    { value: OrderFoilTechnique.RELIEF, label: '浮雕' },
                    { value: OrderFoilTechnique.RAISED, label: '激凸' },
                  ]
                : []),
            ]}
            onChange={(value) => {
              change(
                setTechnique,
                value as WorkbenchQuoteInput['foilTechnique'],
              );
              if (value === OrderFoilTechnique.NONE) {
                setFront([]);
                setBack([]);
              }
            }}
          />
          {route === OrderItemPricingRoute.COLOR_PRINT && (
            <p className="text-sm text-muted-foreground">
              彩印按 CMYK 四色、无覆膜计算；加烫金按专版计算。
            </p>
          )}
          {technique !== OrderFoilTechnique.NONE && (
            <div className="space-y-4">
              {(['front', 'back'] as const).map((side) => (
                <fieldset key={side} className="space-y-2">
                  <legend className="text-sm font-medium">
                    {side === 'front' ? '正面烫金颜色' : '反面烫金颜色'}（最多 3
                    色）
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {options.foilColors.map((color) => (
                      <Button
                        type="button"
                        key={color.id}
                        className="min-h-11"
                        variant={
                          (side === 'front' ? front : back).includes(color.name)
                            ? 'secondary'
                            : 'outline'
                        }
                        aria-pressed={(side === 'front'
                          ? front
                          : back
                        ).includes(color.name)}
                        disabled={isColorUnavailable(
                          side === 'front' ? front : back,
                          color.name,
                        )}
                        onClick={() => toggleColor(side, color.name)}
                      >
                        {color.name}
                      </Button>
                    ))}
                  </div>
                  {!options.foilColors.length && (
                    <p className="text-sm text-muted-foreground">
                      暂无烫金颜色，请联系管理员配置
                    </p>
                  )}
                </fieldset>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="workbench-markup">加工费加价比例（%）</Label>
            <Input
              id="workbench-markup"
              className="min-h-11"
              type="number"
              required
              min="0"
              max="100"
              step="1"
              value={markup}
              onChange={(event) => change(setMarkup, event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {[0, 20, 35, 50, 80].map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={markup === String(value) ? 'secondary' : 'outline'}
                  className="min-h-11"
                  aria-pressed={markup === String(value)}
                  onClick={() => change(setMarkup, String(value))}
                >
                  {value === 0 ? '不加价' : `+${value}%`}
                </Button>
              ))}
            </div>
          </div>
          <Button className="min-h-11 w-full" type="submit" disabled={pending}>
            <Calculator aria-hidden className="size-4" />
            {pending ? '正在计算…' : '计算报价'}
          </Button>
        </form>
      </Card>
      <WorkbenchQuotePanel
        result={result}
        pending={pending}
        markup={markup}
        resultHeading={resultHeading}
      />
    </div>
  );
}

function WorkbenchQuotePanel({
  result,
  pending,
  markup,
  resultHeading,
}: {
  result: WorkbenchQuoteResult | null;
  pending: boolean;
  markup: string;
  resultHeading: React.RefObject<HTMLHeadingElement | null>;
}) {
  const quote = result?.status === 'success' ? result.quote : null;
  return (
    <div className="min-w-0 space-y-4">
      <Card className="min-w-0 p-4 sm:p-6" aria-busy={pending}>
        <h2
          ref={resultHeading}
          tabIndex={-1}
          className="scroll-mt-20 text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          加工费参考报价
        </h2>
        {pending ? (
          <p className="text-sm text-muted-foreground">正在按当前价格计算…</p>
        ) : null}
        {!result && !pending ? (
          <EmptyState
            title="填写需求后计算报价"
            description="选择产品、规格和工艺，查看费用明细"
          />
        ) : null}
        {result?.status === 'error' && (
          <ActionNotice tone="error" title={result.message} />
        )}
        {quote && (
          <>
            <p className="text-3xl font-semibold tabular-nums text-primary">
              {quote.suggestedAmount === null
                ? '待核价'
                : formatMoney(quote.suggestedAmount)}
            </p>
            <p className="text-sm text-muted-foreground">
              加工费价格版本 {quote.processingVersion} · 加价 {markup}%
            </p>
            {quote.needsPricing && (
              <ActionNotice
                tone="warning"
                title="部分费用待核价"
                description="请联系管理员确认后再向客户报价"
              />
            )}
            <dl className="divide-y">
              {quote.lines.map((line, index) => (
                <div
                  key={index}
                  className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                >
                  <dt className="min-w-0">
                    <span>{line.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {formatRate(line.rate)} × {line.units}
                    </span>
                  </dt>
                  <dd className="tabular-nums">{formatMoney(line.amount)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 py-3 text-sm font-semibold">
                <dt>加工费</dt>
                <dd>
                  {quote.baseAmount === null
                    ? '待核价'
                    : formatMoney(quote.baseAmount)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 py-3 text-sm">
                <dt>加价金额</dt>
                <dd>
                  {quote.markupAmount === null
                    ? '待核价'
                    : formatMoney(quote.markupAmount)}
                </dd>
              </div>
            </dl>
            {quote.plateFeePending && (
              <p className="text-sm text-muted-foreground">制版费待定</p>
            )}
          </>
        )}
      </Card>
      <Card className="p-4 sm:p-6">
        <h3 className="font-semibold">报价前核对</h3>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>参考报价仅含本次加工费及加价。</li>
          <li>制版、包装和快递费用另行确认。</li>
          <li>返单先核对原订单尺寸与设计稿。</li>
          <li>交期按设计确认时间和实际排期核实。</li>
        </ul>
      </Card>
    </div>
  );
}
