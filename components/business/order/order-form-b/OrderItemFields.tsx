'use client';
import type { ReactNode } from 'react';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import { isCoatedOrderPaper } from '@/lib/order/order-item-material';
import {
  OrderItemPricingRoute,
  OrderFoilTechnique,
  OrderLamination,
} from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  OrderFoilSwatchPicker,
  type OrderFoilSwatchOption,
} from './OrderFoilSwatchPicker';
import {
  Group,
  PillPicker,
  FieldError,
  FieldLabel,
} from './OrderFieldPrimitives';
export const ROUTE_OPTIONS = [
  { value: OrderItemPricingRoute.STOCK_BLANK, label: '局部烫金' },
  {
    value: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    label: '专版烫金',
  },
  { value: OrderItemPricingRoute.COLOR_PRINT, label: '彩印' },
] as const;

const LAMINATION_OPTIONS = [
  { value: OrderLamination.MATTE, label: '亚膜' },
  { value: OrderLamination.SOFT_TOUCH, label: '触感膜' },
  { value: OrderLamination.NEW_GLOSS, label: '新光膜' },
  { value: OrderLamination.LASER, label: '雷射' },
] as const;

type Item = CreateOrderInput['items'][number];
/** 纸张胶囊选项；label 已是 paperDisplayLabel 后的现行叫法。 */
export type OrderPaperOption = {
  value: string;
  label: string;
  disabled?: boolean;
};
type Common = {
  uid: string;
  item: Item;
  disabled?: boolean;
  first?: boolean;
  appearance?: 'divided' | 'plain';
  itemErrors?: {
    route?: string;
    paper?: string;
    weight?: string;
    specification?: string;
    foilColors?: string;
    quantity?: string;
  };
};
export type OrderItemCraftFieldsProps = Common & {
  hideRoute?: boolean;
  title?: string;
  paperKey: string | null;
  paperOptions: readonly OrderPaperOption[];
  foilOptions: readonly OrderFoilSwatchOption[];
  onRouteChange: (value: OrderItemPricingRoute) => void;
  onLaminationChange: (value: OrderLamination) => void;
  onPrintFoilModeChange: (value: 'NONE' | 'PARTIAL' | 'FULL') => void;
  onFoilSidesChange: (front: string[], back: string[]) => void;
  onBackFoilToggle: (value: boolean) => void;
  onFoilTechniqueChange: (value: OrderFoilTechnique) => void;
};
export type OrderItemMaterialFieldsProps = Common & {
  materialExtras?: ReactNode;
  hideSpecification?: boolean;
  paperKey: string | null;
  paperOptions: readonly OrderPaperOption[];
  weightOptions: readonly { value: number; disabled?: boolean }[];
  specificationOptions: readonly {
    value: string;
    label: string;
    disabled?: boolean;
  }[];
  allowManualWeight?: boolean;
  allowCustomSize?: boolean;
  onPaperChange: (value: string) => void;
  onWeightChange: (value: number) => void;
  onSpecificationChange: (value: string) => void;
  onCustomSizeChange: (value: boolean) => void;
};
function isCopperPaper(
  paperKey: string | null,
  options: readonly OrderPaperOption[],
): boolean {
  const option = options.find((entry) => entry.value === paperKey);
  return isCoatedOrderPaper(paperKey) || isCoatedOrderPaper(option?.label);
}

function currentPrintFoilMode(
  item: CreateOrderInput['items'][number],
): 'NONE' | 'PARTIAL' | 'FULL' {
  if (item.frontFoilColors.length === 0 && item.backFoilColors.length === 0) {
    return 'NONE';
  }
  return item.hasLocalFoil === false ? 'FULL' : 'PARTIAL';
}

function FoilSideFields({
  item,
  direct,
  maxSelections,
  disabled,
  error,
  idStem,
  foilOptions,
  onFoilSidesChange,
  onBackFoilToggle,
}: {
  item: CreateOrderInput['items'][number];
  direct: boolean;
  maxSelections: number;
  disabled?: boolean;
  error?: string;
  idStem: string;
  foilOptions: readonly OrderFoilSwatchOption[];
  onFoilSidesChange: (front: string[], back: string[]) => void;
  onBackFoilToggle: (enabled: boolean) => void;
}) {
  const front = item.frontFoilColors;
  const back = item.backFoilColors;
  const backEnabled = back.length > 0 || item.isDoubleSided;

  if (direct) {
    return (
      <div className="mt-5">
        <OrderFoilSwatchPicker
          id={`${idStem}-foil-front`}
          label="烫金颜色"
          value={front}
          options={foilOptions}
          maxSelections={maxSelections}
          minimumSelections={0}
          disabled={disabled}
          error={error}
          onChange={(nextFront) => onFoilSidesChange(nextFront, [])}
        />
      </div>
    );
  }

  const sameAsFront =
    backEnabled &&
    front.length === back.length &&
    front.every((color, index) => color === back[index]);

  return (
    <fieldset className="mt-5 min-w-0" aria-label="烫金颜色">
      <legend className="mb-2 text-xs font-bold tracking-[0.16em] text-muted-foreground">
        烫金颜色
      </legend>
      <div className="rounded-xl bg-muted/30 p-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">正面</span>
        </div>
        <OrderFoilSwatchPicker
          id={`${idStem}-foil-front`}
          label=""
          value={front}
          options={foilOptions}
          maxSelections={maxSelections}
          minimumSelections={0}
          disabled={disabled}
          onChange={(nextFront) => onFoilSidesChange(nextFront, back)}
        />
      </div>
      <div
        className={cn(
          'mt-2 rounded-xl bg-muted/30 p-3.5',
          !backEnabled && 'bg-muted/15',
        )}
      >
        <div className={cn('flex items-center gap-2', backEnabled && 'mb-2.5')}>
          <span className="text-sm font-semibold text-foreground">反面</span>
          <span className="text-xs font-semibold text-muted-foreground">
            {backEnabled
              ? sameAsFront
                ? '与正面同色'
                : back.join(' + ') || '未选'
              : '不烫'}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={backEnabled}
            disabled={disabled}
            className="ml-auto min-h-11 text-xs font-semibold"
            onClick={() => onBackFoilToggle(!backEnabled)}
          >
            {backEnabled ? '取消反面' : '＋ 加烫反面'}
          </Button>
        </div>
        {backEnabled ? (
          <OrderFoilSwatchPicker
            id={`${idStem}-foil-back`}
            label=""
            value={back}
            options={foilOptions}
            maxSelections={maxSelections}
            minimumSelections={0}
            disabled={disabled}
            onChange={(nextBack) => onFoilSidesChange(front, nextBack)}
          />
        ) : null}
      </div>
      <FieldError>{error}</FieldError>
    </fieldset>
  );
}

function SpecialTechnique({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: OrderFoilTechnique;
  disabled?: boolean;
  onChange: (value: OrderFoilTechnique) => void;
}) {
  const options = [
    { value: OrderFoilTechnique.RELIEF, label: '浮雕' },
    { value: OrderFoilTechnique.RAISED, label: '激凸' },
  ] as const;
  return (
    <fieldset className="mt-5">
      <legend className="mb-2 text-xs font-bold tracking-[0.16em] text-muted-foreground">
        特殊工艺
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              id={`${id}-${option.value}`}
              type="button"
              variant="outline"
              aria-pressed={selected}
              disabled={disabled}
              className={cn(
                'h-auto min-h-11 min-w-11 rounded-full px-3.5 py-1.5 text-sm font-semibold',
                selected &&
                  'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background dark:border-foreground dark:bg-foreground dark:text-background dark:hover:bg-foreground dark:hover:text-background',
              )}
              onClick={() =>
                onChange(selected ? OrderFoilTechnique.FLAT : option.value)
              }
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function OrderItemCraftFields({
  hideRoute = false,
  uid,
  item,
  title = '工艺',
  first,
  appearance,
  paperKey,
  paperOptions,
  foilOptions,
  disabled,
  itemErrors,
  onRouteChange,
  onLaminationChange,
  onPrintFoilModeChange,
  onFoilSidesChange,
  onBackFoilToggle,
  onFoilTechniqueChange,
}: OrderItemCraftFieldsProps) {
  const printFoilMode = currentPrintFoilMode(item);
  const copperPaper = isCopperPaper(paperKey, paperOptions);
  const directFoil = item.pricingRoute !== OrderItemPricingRoute.STOCK_BLANK;
  const showsFoil =
    item.pricingRoute !== OrderItemPricingRoute.COLOR_PRINT ||
    printFoilMode !== 'NONE';
  const showsSpecialTechnique =
    item.pricingRoute === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL ||
    (item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT &&
      printFoilMode === 'FULL');
  return (
    <Group title={title} first={first} appearance={appearance}>
      {!hideRoute ? <PillPicker
        id={`${uid}-route`}
        label="工艺类型"
        value={item.pricingRoute}
        options={ROUTE_OPTIONS}
        disabled={disabled}
        error={itemErrors?.route}
        onChange={onRouteChange}
      /> : null}

      {item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT ? (
        <div className="mt-5 space-y-5">
          {copperPaper ? (
            <PillPicker
              id={`${uid}-lamination`}
              label="覆膜"
              value={item.lamination}
              options={LAMINATION_OPTIONS}
              disabled={disabled}
              onChange={onLaminationChange}
            />
          ) : null}
          <PillPicker
            id={`${uid}-print-foil`}
            label="叠加烫金"
            value={printFoilMode}
            options={[
              { value: 'NONE', label: '无' },
              { value: 'PARTIAL', label: '局部烫金' },
              { value: 'FULL', label: '专版烫金' },
            ]}
            disabled={disabled}
            onChange={onPrintFoilModeChange}
          />
        </div>
      ) : null}

      {showsFoil ? (
        <FoilSideFields
          item={item}
          direct={directFoil}
          maxSelections={
            item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT ? 1 : 3
          }
          disabled={disabled}
          error={itemErrors?.foilColors}
          idStem={`${uid}-style`}
          foilOptions={foilOptions}
          onFoilSidesChange={onFoilSidesChange}
          onBackFoilToggle={onBackFoilToggle}
        />
      ) : null}

      {showsSpecialTechnique ? (
        <SpecialTechnique
          id={`${uid}-special-technique`}
          value={item.foilTechnique}
          disabled={disabled}
          onChange={onFoilTechniqueChange}
        />
      ) : null}
    </Group>
  );
}
export function OrderItemMaterialFields({
  uid,
  item,
  first,
  appearance,
  disabled,
  itemErrors,
  materialExtras,
  hideSpecification,
  paperKey,
  paperOptions,
  weightOptions,
  specificationOptions,
  allowManualWeight,
  allowCustomSize,
  onPaperChange,
  onWeightChange,
  onSpecificationChange,
  onCustomSizeChange,
}: OrderItemMaterialFieldsProps) {
  return (
    <Group title="材料" first={first} appearance={appearance}>
      {materialExtras}
      <PillPicker
        id={`${uid}-paper`}
        label="纸张材质"
        value={paperKey ?? ''}
        options={paperOptions}
        disabled={disabled}
        error={itemErrors?.paper}
        onChange={onPaperChange}
      />

      <div className="mt-5">
        <PillPicker
          id={`${uid}-weight`}
          label="克重"
          value={item.paperWeightGsm ?? 0}
          options={weightOptions.map((option) => ({
            ...option,
            label: `${option.value}g`,
          }))}
          disabled={disabled}
          error={itemErrors?.weight}
          onChange={onWeightChange}
        />
        {allowManualWeight &&
        item.pricingRoute === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL ? (
          <div className="mt-2">
            <div className="flex max-w-[11rem] items-center gap-2">
              <Input
                type="number"
                min={1}
                max={2000}
                step={1}
                aria-label="手动输入克重"
                placeholder="手动输入"
                disabled={disabled}
                value={
                  item.paperWeightGsm !== null &&
                  !weightOptions.some(
                    (option) => option.value === item.paperWeightGsm,
                  )
                    ? item.paperWeightGsm
                    : ''
                }
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isInteger(next) && next > 0) {
                    onWeightChange(next);
                  }
                }}
              />
              <span className="text-xs font-bold text-muted-foreground">g</span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              手动输入克重转管理员终价
            </p>
          </div>
        ) : null}
      </div>

      {!hideSpecification ? <OrderItemSpecificationFields
        uid={uid} item={item} disabled={disabled} itemErrors={itemErrors}
        specificationOptions={specificationOptions} allowCustomSize={allowCustomSize}
        onSpecificationChange={onSpecificationChange} onCustomSizeChange={onCustomSizeChange}
      /> : null}
    </Group>
  );
}
export function OrderItemSpecificationFields({
  uid, item, disabled, itemErrors, specificationOptions, allowCustomSize,
  onSpecificationChange, onCustomSizeChange,
}: Pick<OrderItemMaterialFieldsProps, 'uid' | 'item' | 'disabled' | 'itemErrors' |
  'specificationOptions' | 'allowCustomSize' | 'onSpecificationChange' | 'onCustomSizeChange'>) {
  const customSizeSelected = item.actualWidthMm === null && item.actualHeightMm === null;
  return (
      <div className="mt-5">
        <PillPicker
          id={`${uid}-specification`}
          label="规格"
          value={item.specification ?? ''}
          options={specificationOptions}
          disabled={disabled}
          error={itemErrors?.specification}
          onChange={onSpecificationChange}
        />
        {allowCustomSize &&
        item.pricingRoute === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL ? (
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
            <Checkbox
              checked={customSizeSelected}
              disabled={disabled}
              aria-label="改尺寸（转管理员终价）"
              onCheckedChange={onCustomSizeChange}
            />
            改尺寸（转管理员终价）
          </label>
        ) : null}
      </div>
  );
}
export function OrderItemQuantityField({
  uid,
  item,
  disabled,
  itemErrors,
  onQuantityChange,
}: Common & { onQuantityChange: (value: number) => void }) {
  return (
    <div>
      <FieldLabel htmlFor={`${uid}-quantity`} required>
        数量
      </FieldLabel>
      <Input
        id={`${uid}-quantity`}
        type="number"
        min={1}
        max={9999999}
        step={1}
        required
        aria-required="true"
        aria-invalid={Boolean(itemErrors?.quantity)}
        aria-describedby={itemErrors?.quantity ? `${uid}-quantity-message` : undefined}
        disabled={disabled}
        value={item.quantity || ''}
        className="h-10 min-h-11"
        onChange={(event) =>
          onQuantityChange(
            event.target.value === '' ? 0 : Number(event.target.value),
          )
        }
      />
      <FieldError id={`${uid}-quantity-message`} reservedLines={1}>{itemErrors?.quantity}</FieldError>
    </div>
  );
}

export function OrderItemProductField({
  value,
  products,
  onChange,
  disabled,
}: {
  value: string | null;
  products: readonly { id: string | null; name: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const persistedProducts = products.filter((product): product is { id: string; name: string } => product.id !== null);
  if (persistedProducts.length < 2) return null;
  return (
    <label className="mt-4 block space-y-2 text-sm">
      匹配产品
      <select
        className="min-h-11 w-full rounded-lg border bg-background px-3"
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">请选择产品</option>
        {persistedProducts.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </select>
    </label>
  );
}
