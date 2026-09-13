import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableScrollArea } from '@/components/ui-business';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/dashboard/format';
import { formatUnitPrice } from '@/lib/format/unit-price';

export type PricingNumericValue = number | string | null;

export type PricingNumericFieldState = {
  /** Stable DOM/form identifier. */
  id: string;
  /** Submitted field name; defaults to `id`. */
  name?: string;
  value: PricingNumericValue;
  editable?: boolean;
  disabled?: boolean;
  changed?: boolean;
};

export type PricingMatrixColumn = {
  key: string;
  label: string;
};

export type PricingMatrixCell = PricingNumericFieldState & {
  columnKey: string;
};

export type CustomerBlankPricingRow = {
  key: string;
  paperName: string;
  weight: number | string;
  cells: readonly PricingMatrixCell[];
};

export type CustomerBlankPricingSectionViewProps = {
  columns: readonly PricingMatrixColumn[];
  rows: readonly CustomerBlankPricingRow[];
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerMachinePricingSectionViewProps = {
  rate: PricingNumericFieldState;
  flatFee: PricingNumericFieldState;
  jumpQuantity: PricingNumericFieldState;
  plateFee: PricingNumericFieldState;
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerTierPricingRow = {
  key: string;
  name: string;
  maxQuantity: PricingNumericFieldState;
  middlePrice: PricingNumericFieldState;
  largePrice: PricingNumericFieldState;
};

export type CustomerTiersPricingSectionViewProps = {
  rows: readonly CustomerTierPricingRow[];
  exampleQuantity?: number;
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerPricingAdjustmentRow = {
  key: string;
  label: string;
  description?: string;
  value: PricingNumericFieldState;
  unit: '元/个' | '元';
  isNew?: boolean;
};

export type CustomerAddsPricingSectionViewProps = {
  paperAdjustments: readonly CustomerPricingAdjustmentRow[];
  craftAdjustments: readonly CustomerPricingAdjustmentRow[];
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerPrintPricingRow = {
  key: string;
  label: string;
  cells: readonly PricingMatrixCell[];
};

export type CustomerPrintPricingSectionViewProps = {
  columns: readonly PricingMatrixColumn[];
  rows: readonly CustomerPrintPricingRow[];
  foilCells: readonly PricingMatrixCell[];
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerBagPricingFields = {
  normalFee: PricingNumericFieldState;
  mixedFee: PricingNumericFieldState;
};

export type CustomerCartonPricingTierRow = {
  key: string;
  name?: string;
  maxQuantity: PricingNumericFieldState;
  fee: PricingNumericFieldState;
};

export type CustomerCartonPricingFields = {
  tiers: readonly CustomerCartonPricingTierRow[];
  segmentLength: PricingNumericFieldState;
  segmentFee: PricingNumericFieldState;
};

export type CustomerShippingUnitWeightRow = {
  key: string;
  label: string;
  value: PricingNumericFieldState;
};

export type CustomerShippingZoneRow = {
  key: string;
  name: string;
  provinces: readonly string[];
  firstWeightFee: PricingNumericFieldState;
  incrementFee: PricingNumericFieldState;
  incrementKilograms: number;
};

export type CustomerShippingPricingFields = {
  unitWeights: readonly CustomerShippingUnitWeightRow[];
  maxQuantity: PricingNumericFieldState;
  zones: readonly CustomerShippingZoneRow[];
};

export type CustomerShipPricingSectionViewProps = {
  bag: CustomerBagPricingFields;
  carton: CustomerCartonPricingFields;
  shipping: CustomerShippingPricingFields;
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

type PricingNumericInputProps = PricingNumericFieldState & {
  ariaLabel: string;
  placeholder?: string;
  step?: number | string;
  className?: string;
  changedDot?: boolean;
};

type PricingSectionHeadingProps = {
  headingId: string;
  title: string;
  description: ReactNode;
  basis?: string;
  criticalBasis?: boolean;
  actions?: ReactNode;
};

const EMPTY_FIELD: PricingNumericFieldState = {
  id: 'missing-pricing-field',
  value: null,
  editable: false,
  disabled: true,
  changed: false,
};

function PricingSectionHeading({
  headingId,
  title,
  description,
  basis,
  criticalBasis = false,
  actions,
}: PricingSectionHeadingProps) {
  return (
    <header className="min-w-0">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1
              id={headingId}
              className="admin-wrap-anywhere text-lg font-extrabold tracking-tight sm:text-xl"
            >
              {title}
            </h1>
            {basis ? (
              <Badge
                variant="outline"
                className={cn(
                  'h-auto rounded-md px-2 py-0.5 font-mono text-xs font-bold tracking-wide',
                  criticalBasis && 'border-destructive text-destructive',
                )}
              >
                {basis}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 max-w-3xl text-xs font-medium leading-5 text-muted-foreground sm:text-sm">
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function PricingNumericInput({
  id,
  name,
  value,
  editable = false,
  disabled = false,
  changed = false,
  ariaLabel,
  placeholder = '—',
  step,
  className,
  changedDot = false,
}: PricingNumericInputProps) {
  const label = `${ariaLabel}${changed ? '（有未发布改动）' : ''}`;
  const displayValue =
    value === null || value === '' ? placeholder : String(value);

  return (
    <div className="relative min-w-0">
      {editable && !disabled ? (
        <Input
          // The server action revalidates this view with the persisted value.
          // Remount only the changed field so Base UI receives a stable
          // defaultValue for each uncontrolled input instance. Other fields
          // keep their unsaved DOM values after a validation error.
          key={JSON.stringify([id, value ?? ''])}
          id={id}
          name={name ?? id}
          type="number"
          inputMode="decimal"
          defaultValue={value ?? ''}
          placeholder={placeholder}
          step={step}
          aria-label={label}
          data-changed={changed || undefined}
          className={cn(
            'h-8 min-w-0 text-right text-sm font-bold tabular-nums',
            changed &&
              'border-warning/50 bg-warning/10 text-warning-foreground',
            className,
          )}
        />
      ) : (
        <>
          <span className="sr-only">{label}，当前值：</span>
          <span
            id={id}
            data-price-label={label}
            data-readonly="true"
            data-disabled={disabled || undefined}
            data-changed={changed || undefined}
            className={cn(
              'flex h-8 min-w-0 items-center justify-end rounded-md border border-transparent bg-transparent px-3 text-right text-sm font-bold tabular-nums',
              (value === null || value === '') && 'text-muted-foreground',
              disabled && 'text-muted-foreground',
              changed &&
                'border-warning/50 bg-warning/10 text-warning-foreground',
              className,
            )}
          >
            {displayValue}
          </span>
        </>
      )}
      {changed && changedDot ? (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 size-1.5 rounded-full bg-warning"
        />
      ) : null}
    </div>
  );
}

function FormulaNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/70 px-3.5 py-2.5 text-xs font-semibold leading-5 sm:text-sm">
      {children}
    </div>
  );
}

function CardSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="border-b pb-2 text-xs font-extrabold tracking-[0.14em] text-muted-foreground">
      {children}
    </div>
  );
}

function displayWeight(weight: number | string): string {
  if (typeof weight === 'number') return `${weight}g`;
  return /g$/i.test(weight.trim()) ? weight : `${weight}g`;
}

function finiteNumber(value: PricingNumericValue): number | null {
  if (value === null || value === '') return null;
  const normalized =
    typeof value === 'string' ? value.replaceAll(',', '').trim() : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerLabel(value: number): string {
  return Math.trunc(value).toLocaleString('zh-CN');
}

function decimalLabel(value: number, maximumFractionDigits = 3): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function currencyLabel(value: number | null, fractionDigits = 2): string {
  return value === null || !Number.isFinite(value)
    ? '待定'
    : fractionDigits === 4
      ? formatUnitPrice(value)
      : formatMoney(value);
}

function matrixCell(
  cells: readonly PricingMatrixCell[],
  columnKey: string,
  fallbackId: string,
): PricingNumericFieldState {
  return (
    cells.find((cell) => cell.columnKey === columnKey) ?? {
      ...EMPTY_FIELD,
      id: fallbackId,
    }
  );
}

export function CustomerBlankPricingSectionView({
  columns,
  rows,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-blank-pricing-heading',
}: CustomerBlankPricingSectionViewProps) {
  const minimumWidth = Math.max(720, 176 + columns.length * 112);

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="局部烫金 · 空白封现货单价"
        basis="元 / 个"
        description={
          <>
            空白封 = 局部烫金的材料价。空格是“— 转人工”显式状态；
            <strong className="text-foreground">0 元和无报价是两回事</strong>。
          </>
        }
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <Table label="局部烫金空白封现货单价矩阵" style={{ minWidth: minimumWidth }}>
            <TableHeader>
              <TableRow className="border-b-2 border-foreground hover:bg-transparent">
                <TableHead className="w-44 px-4 text-xs font-extrabold tracking-wide text-muted-foreground">
                  纸张 · 克重
                </TableHead>
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className="min-w-28 px-2 text-right text-xs font-extrabold tracking-wide text-muted-foreground"
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className="hover:bg-transparent">
                  <TableCell className="px-4 py-2.5 text-left text-sm font-bold">
                    {row.paperName}
                    <span className="ml-1.5 font-mono text-xs font-semibold text-muted-foreground">
                      {displayWeight(row.weight)}
                    </span>
                  </TableCell>
                  {columns.map((column) => {
                    const field = matrixCell(
                      row.cells,
                      column.key,
                      `blank-${row.key}-${column.key}`,
                    );
                    return (
                      <TableCell key={column.key} className="p-1.5">
                        <PricingNumericInput
                          {...field}
                          ariaLabel={`${row.paperName}${displayWeight(row.weight)}${column.label}单价`}
                          placeholder="— 转人工"
                          step="0.005"
                          changedDot
                          className={cn(
                            'h-9 border-transparent bg-transparent px-2 text-right shadow-none',
                            field.value === null &&
                              'text-xs font-semibold placeholder:text-muted-foreground',
                            field.editable && 'hover:bg-muted/60',
                            field.changed &&
                              'border-warning/50 bg-warning/10 text-warning-foreground',
                          )}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

function ParameterRow({
  label,
  description,
  field,
  unit,
  step,
  placeholder,
}: {
  label: ReactNode;
  description?: ReactNode;
  field: PricingNumericFieldState;
  unit: string;
  step?: number | string;
  placeholder?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1 text-sm font-bold">
        <div>{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs font-medium leading-4 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <PricingNumericInput
        {...field}
        ariaLabel={typeof label === 'string' ? label : '价格参数'}
        placeholder={placeholder}
        step={step}
        className="w-[110px] shrink-0"
      />
      <span className="w-12 shrink-0 text-xs font-extrabold text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

export function CustomerMachinePricingSectionView({
  rate,
  flatFee,
  jumpQuantity,
  plateFee,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-machine-pricing-heading',
}: CustomerMachinePricingSectionViewProps) {
  const rateNumber = finiteNumber(rate.value);
  const flatNumber = finiteNumber(flatFee.value);
  const jumpNumber = finiteNumber(jumpQuantity.value);
  const exampleAtJump =
    rateNumber === null || flatNumber === null || jumpNumber === null
      ? null
      : 1_000 < jumpNumber
        ? 2 * flatNumber
        : 1_000 * 2 * rateNumber;
  const exampleBelowJump =
    rateNumber === null || flatNumber === null || jumpNumber === null
      ? null
      : 999 < jumpNumber
        ? 3 * flatNumber
        : 999 * 3 * rateNumber;
  const platePolicyDescriptionId = `${plateFee.id}-manual-only-description`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="局部烫金 · 机烫费与制版费"
        description={
          <>
            机烫费按<strong className="text-foreground">印刷次数</strong>
            计，不按面数。印刷次数 = 数量 × 过版次数。
          </>
        }
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="divide-y px-4 sm:px-5">
          <ParameterRow
            label="费率"
            description="数量 ≥ 跳变点时，每次印刷"
            field={rate}
            unit="元/次"
            step="0.005"
          />
          <ParameterRow
            label="固定费"
            description="数量低于跳变点时，每次过版"
            field={flatFee}
            unit="元/次"
          />
          <ParameterRow
            label="跳变点"
            description="低于此数量走固定费"
            field={jumpQuantity}
            unit="个"
          />
          <div className="py-3">
            <FormulaNote>
              当前参数试算：1,000 个双面 = 2,000 次 ×{' '}
              {rateNumber === null ? '待定' : decimalLabel(rateNumber)} ={' '}
              <strong className="text-destructive">
                {currencyLabel(exampleAtJump)}
              </strong>
              <span aria-hidden="true">　·　</span>
              999 个三色 = 3 次过版 ×{' '}
              {flatNumber === null ? '待定' : decimalLabel(flatNumber)} ={' '}
              <strong className="text-destructive">
                {currencyLabel(exampleBelowJump)}
              </strong>
            </FormulaNote>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-3 sm:px-5">
          <div
            id={plateFee.id}
            role="note"
            aria-describedby={platePolicyDescriptionId}
            className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <div className="text-sm font-bold">制烫金版费</div>
              <p
                id={platePolicyDescriptionId}
                className="mt-0.5 text-xs font-medium leading-4 text-muted-foreground"
              >
                版费默认 0 元；需要收费时，管理员可在工单中添加制版明细，录入金额和依据。
              </p>
            </div>
            <Badge
              variant="outline"
              className="h-auto w-fit shrink-0 rounded-md px-2 py-0.5 text-xs font-bold text-destructive"
            >
              默认 0 元 · 可人工添加
            </Badge>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function tierRanges(rows: readonly CustomerTierPricingRow[]) {
  let previousMax = 0;
  return rows.map((row, index) => {
    const lower = index === 0 ? 1 : previousMax + 1;
    const upper = finiteNumber(row.maxQuantity.value);
    const label =
      upper === null
        ? `≥ ${integerLabel(lower)} 个`
        : `≥ ${integerLabel(lower)} 且 < ${integerLabel(upper + 1)} 个`;
    if (upper !== null) previousMax = upper;
    return { lower, upper, label };
  });
}

export function CustomerTiersPricingSectionView({
  rows,
  exampleQuantity = 4_600,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-tiers-pricing-heading',
}: CustomerTiersPricingSectionViewProps) {
  const ranges = tierRanges(rows);
  const exampleIndex = ranges.findIndex(
    (range) => range.upper === null || exampleQuantity <= range.upper,
  );
  const exampleTier = exampleIndex >= 0 ? rows[exampleIndex]?.name : null;

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="专版烫金 · 阶梯单价"
        basis="元 / 个"
        description="按数量区间取价，达到下一档数量时采用下一档单价；末档不限。"
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <TableScrollArea label="专版烫金阶梯单价表">
            <div
              role="table"
              aria-label="专版烫金阶梯单价"
              className="min-w-[820px] px-4 py-3 sm:px-5"
            >
              <div role="rowgroup">
                <div
                  role="row"
                  className="grid grid-cols-[86px_minmax(18rem,1fr)_110px_100px_100px] items-center gap-2 border-b-2 border-foreground py-2 text-xs font-extrabold tracking-wide text-muted-foreground"
                >
                  <span role="columnheader">档位</span>
                  <span role="columnheader">适用范围（推导）</span>
                  <span role="columnheader" className="text-right">
                    数量上界（含）
                  </span>
                  <span role="columnheader" className="px-1.5 text-right">
                    中号组单价
                  </span>
                  <span role="columnheader" className="px-1.5 text-right">
                    大号组单价
                  </span>
                </div>
              </div>
              <div role="rowgroup">
                {rows.map((row, index) => {
                  const range = ranges[index];
                  const lastOpenTier = row.maxQuantity.value === null;
                  return (
                    <div
                      role="row"
                      key={row.key}
                      className="grid grid-cols-[86px_minmax(18rem,1fr)_110px_100px_100px] items-center gap-2 border-b py-1.5 text-sm last:border-b-0"
                    >
                      <span role="cell" className="font-extrabold">
                        {row.name}
                      </span>
                      <span
                        role="cell"
                        className="text-xs font-semibold text-muted-foreground"
                      >
                        {range?.label ?? '待推导'}
                      </span>
                      <div role="cell">
                        <PricingNumericInput
                          {...row.maxQuantity}
                          disabled={row.maxQuantity.disabled || lastOpenTier}
                          ariaLabel={`${row.name}上界`}
                          placeholder={lastOpenTier ? '∞' : '—'}
                        />
                      </div>
                      <div role="cell" className="min-w-0">
                        <PricingNumericInput
                          {...row.middlePrice}
                          ariaLabel={`${row.name}中号组单价`}
                          step="0.005"
                          className="w-full min-w-0 px-1.5 text-xs"
                        />
                      </div>
                      <div role="cell" className="min-w-0">
                        <PricingNumericInput
                          {...row.largePrice}
                          ariaLabel={`${row.name}大号组单价`}
                          step="0.005"
                          className="w-full min-w-0 px-1.5 text-xs"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </TableScrollArea>
          <div className="px-4 pb-4 sm:px-5">
            <FormulaNote>
              档位取档按“实际数量适用范围”：
              {integerLabel(exampleQuantity)} 个落{' '}
              <strong className="text-destructive">
                {exampleTier ?? '未命中'}
              </strong>
              。每个数量仅对应一档，未设最低起订量。
            </FormulaNote>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function AdjustmentRows({
  rows,
}: {
  rows: readonly CustomerPricingAdjustmentRow[];
}) {
  return (
    <div className="divide-y">
      {rows.map((row) => (
        <div key={row.key} className="flex min-w-0 items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold">
              <span className="admin-wrap-anywhere">{row.label}</span>
              {row.isNew ? (
                <Badge className="h-auto rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0 text-xs font-extrabold text-warning-foreground">
                  新增 · 未发布
                </Badge>
              ) : null}
            </div>
            {row.description ? (
              <p className="mt-0.5 text-xs font-medium leading-4 text-muted-foreground">
                {row.description}
              </p>
            ) : null}
          </div>
          <PricingNumericInput
            {...row.value}
            ariaLabel={`${row.label}${row.unit}`}
            step={row.unit === '元/个' ? '0.005' : undefined}
            className="w-[110px] shrink-0"
          />
          <span className="w-12 shrink-0 text-xs font-extrabold text-muted-foreground">
            {row.unit}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CustomerAddsPricingSectionView({
  paperAdjustments,
  craftAdjustments,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-adds-pricing-heading',
}: CustomerAddsPricingSectionViewProps) {
  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="专版烫金 · 加价"
        basis="元 / 个"
        description={
          <>
            全部仅作用于专版烫金，叠加到阶梯单价上；基准 160g 艳闪 / 红卡 = 0，
            基准纸不需要加价行。
          </>
        }
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <CardSectionLabel>专版烫金加价 · 纸张</CardSectionLabel>
          <AdjustmentRows rows={paperAdjustments} />
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <CardSectionLabel>专版烫金加价 · 工艺</CardSectionLabel>
          <AdjustmentRows rows={craftAdjustments} />
        </CardContent>
      </Card>
    </section>
  );
}

export function CustomerPrintPricingSectionView({
  columns,
  rows,
  foilCells,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-print-pricing-heading',
}: CustomerPrintPricingSectionViewProps) {
  const minimumWidth = Math.max(960, 168 + columns.length * 64);

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="彩印阶梯总价"
        basis="元 / 单 · PER_ORDER · 整单总价不乘数量"
        criticalBasis
        description="查到的直接就是整单总价。空格 = 该档无报价，转人工。数量取整：5千–7千按5千 · 8千–1万按1万 · 1.5万–2万按2万。"
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <Table label="彩印阶梯整单总价矩阵" style={{ minWidth: minimumWidth }}>
            <TableHeader>
              <TableRow className="border-b-2 border-foreground hover:bg-transparent">
                <TableHead className="w-40 px-4 text-xs font-extrabold tracking-wide text-muted-foreground">
                  纸张 规格
                </TableHead>
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className="w-16 px-1 text-right text-xs font-extrabold tracking-wide text-muted-foreground"
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className="hover:bg-transparent">
                  <TableCell className="px-4 py-2 text-sm font-bold">
                    {row.label}
                  </TableCell>
                  {columns.map((column) => {
                    const field = matrixCell(
                      row.cells,
                      column.key,
                      `print-${row.key}-${column.key}`,
                    );
                    return (
                      <TableCell key={column.key} className="p-1">
                        <PricingNumericInput
                          {...field}
                          ariaLabel={`${row.label}${column.label}档整单总价`}
                          className="h-8 w-14 px-1.5 text-xs"
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              <TableRow className="hover:bg-transparent">
                <TableCell className="px-4 py-2 text-sm font-bold">
                  <span className="block">单色烫金原子套餐</span>
                  <span className="mt-0.5 block text-xs font-semibold text-primary">
                    含制版费 · 按不可拆套餐总价计价
                  </span>
                </TableCell>
                {columns.map((column) => {
                  const field = matrixCell(
                    foilCells,
                    column.key,
                    `print-foil-${column.key}`,
                  );
                  return (
                    <TableCell key={column.key} className="p-1">
                      <PricingNumericInput
                        {...field}
                        ariaLabel={`单色烫金${column.label}档含版费原子套餐价`}
                        className="h-8 w-14 px-1.5 text-xs"
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableBody>
          </Table>
          <div className="px-4 pb-4 pt-3 sm:px-5">
            <FormulaNote>
              彩印基础价清空一个格子 = 该档无报价转人工，
              <strong className="text-destructive">不是 0 元</strong>。单色烫金套餐价已包含制版费，有唯一明确档位时作为不可拆原子总价计入款式，不再另收订单级制版费；缺档时整款转人工核价。冰白中号 2千起为空就是现状，不会按 0 元处理。
            </FormulaNote>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function cartonRanges(tiers: readonly CustomerCartonPricingTierRow[]) {
  let previousMax = 0;
  return tiers.map((tier, index) => {
    const lower = index === 0 ? 1 : previousMax + 1;
    const upper = finiteNumber(tier.maxQuantity.value);
    if (upper !== null) previousMax = upper;
    return {
      lower,
      upper,
      label:
        upper === null
          ? `≥ ${integerLabel(lower)}`
          : `${integerLabel(lower)} ~ ${integerLabel(upper)}`,
    };
  });
}

function calculateCartonFee(
  carton: CustomerCartonPricingFields,
  quantity: number,
): number | null {
  const segmentLength = finiteNumber(carton.segmentLength.value);
  const segmentFee = finiteNumber(carton.segmentFee.value);
  if (
    segmentLength === null ||
    segmentLength <= 0 ||
    segmentFee === null
  ) {
    return null;
  }

  let rest = quantity;
  let total = 0;
  while (rest > segmentLength) {
    total += segmentFee;
    rest -= segmentLength;
  }
  const matchedTier = carton.tiers.find((tier) => {
    const max = finiteNumber(tier.maxQuantity.value);
    return max !== null && rest <= max;
  });
  const remainderFee = matchedTier
    ? finiteNumber(matchedTier.fee.value)
    : segmentFee;
  return remainderFee === null ? null : total + remainderFee;
}

function calculateShippingExample(
  shipping: CustomerShippingPricingFields,
  province: string,
): number | null {
  const maxQuantity = finiteNumber(shipping.maxQuantity.value);
  const unitWeight = shipping.unitWeights.find((row) => row.key === '160');
  const grams = finiteNumber(unitWeight?.value.value ?? null);
  const zone = shipping.zones.find((row) => row.provinces.includes(province));
  if (!zone || grams === null || maxQuantity === null || 2_000 > maxQuantity) {
    return null;
  }
  const first = finiteNumber(zone.firstWeightFee.value);
  const increment = finiteNumber(zone.incrementFee.value);
  if (
    first === null ||
    increment === null ||
    zone.incrementKilograms <= 0
  ) {
    return null;
  }
  const kilograms = Math.max(1, Math.ceil((2_000 * grams) / 1_000));
  return zone.incrementKilograms === 1
    ? first + (kilograms - 1) * increment
    : first +
        Math.ceil((kilograms - 1) / zone.incrementKilograms) * increment;
}

export function CustomerShipPricingSectionView({
  bag,
  carton,
  shipping,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-ship-pricing-heading',
}: CustomerShipPricingSectionViewProps) {
  const ranges = cartonRanges(carton.tiers);
  const carton8k = calculateCartonFee(carton, 8_000);
  const carton10k = calculateCartonFee(carton, 10_000);
  const shanghai = calculateShippingExample(shipping, '上海');
  const gansu = calculateShippingExample(shipping, '甘肃');

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="包装 · 纸箱耗材 · 中通快递"
        description="入袋混装按袋（款级）；纸箱与快递按整单。纸箱任何情况都收；快递仅总数量 ≤ 上限时自动计，超出走物流待定，顺丰到付归零。"
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <CardSectionLabel>包装 · 元/袋</CardSectionLabel>
          <div className="divide-y">
            <ParameterRow
              label="单款入袋"
              field={bag.normalFee}
              unit="元/袋"
              step="0.05"
            />
            <ParameterRow
              label="混装"
              description="款数 ≥ 2 才可选"
              field={bag.mixedFee}
              unit="元/袋"
              step="0.05"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <div className="px-4 pt-4 sm:px-5">
            <CardSectionLabel>
              纸箱档位 · 超出后分段累加 · 订单级
            </CardSectionLabel>
          </div>
          <TableScrollArea label="纸箱费用阶梯">
            <div
              role="table"
              aria-label="纸箱费用阶梯"
              className="min-w-[680px] px-4 pt-2 sm:px-5"
            >
              <div role="rowgroup">
                <div
                  role="row"
                  className="grid grid-cols-[86px_minmax(16rem,1fr)_110px_110px_34px] items-center gap-2 border-b-2 border-foreground py-2 text-xs font-extrabold tracking-wide text-muted-foreground"
                >
                  <span role="columnheader">档</span>
                  <span role="columnheader">范围（推导）</span>
                  <span role="columnheader" className="text-right">
                    上界(个)
                  </span>
                  <span role="columnheader" className="text-right">
                    费用(元)
                  </span>
                  <span role="columnheader" aria-label="预留操作列" />
                </div>
              </div>
              <div role="rowgroup">
                {carton.tiers.map((tier, index) => (
                  <div
                    role="row"
                    key={tier.key}
                    className="grid grid-cols-[86px_minmax(16rem,1fr)_110px_110px_34px] items-center gap-2 border-b py-1.5 text-sm last:border-b-0"
                  >
                    <span role="cell" className="font-extrabold">
                      {tier.name ?? `第${index + 1}档`}
                    </span>
                    <span
                      role="cell"
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      {ranges[index]?.label ?? '待推导'}
                    </span>
                    <div role="cell">
                      <PricingNumericInput
                        {...tier.maxQuantity}
                        ariaLabel={`${tier.name ?? `第${index + 1}档`}上界`}
                      />
                    </div>
                    <div role="cell">
                      <PricingNumericInput
                        {...tier.fee}
                        ariaLabel={`${tier.name ?? `第${index + 1}档`}纸箱费用`}
                      />
                    </div>
                    <span role="cell" />
                  </div>
                ))}
              </div>
            </div>
          </TableScrollArea>
          <div className="divide-y px-4 sm:px-5">
            <ParameterRow
              label="分段长度"
              description="超末档后每扣一段计段费，余量回查上表"
              field={carton.segmentLength}
              unit="个"
            />
            <ParameterRow
              label="每段费用"
              field={carton.segmentFee}
              unit="元"
            />
          </div>
          <div className="px-4 pb-4 pt-1 sm:px-5">
            <FormulaNote>
              当前参数：8,000 = 分段 + 查余量 ={' '}
              <strong className="text-destructive">
                {currencyLabel(carton8k, 0)}
              </strong>
              <span aria-hidden="true">　·　</span>
              10,000 ={' '}
              <strong className="text-destructive">
                {currencyLabel(carton10k, 0)}
              </strong>
            </FormulaNote>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <CardSectionLabel>红包单重（净重估算，不含包装）</CardSectionLabel>
          <div className="divide-y">
            {shipping.unitWeights.map((row) => (
              <ParameterRow
                key={row.key}
                label={row.label}
                field={row.value}
                unit="克/个"
                step="0.05"
              />
            ))}
            <ParameterRow
              label="快递数量上限"
              description="超出走物流，运费待定"
              field={shipping.maxQuantity}
              unit="个"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <div className="px-4 pt-4 sm:px-5">
            <CardSectionLabel>
              中通省份档 · 不足 1kg 收首重，计费重量向上取整
            </CardSectionLabel>
          </div>
          <TableScrollArea label="中通快递省份档">
            <div
              role="table"
              aria-label="中通快递省份档"
              className="min-w-[720px] px-4 py-2 sm:px-5"
            >
              <div role="rowgroup" className="sr-only">
                <div role="row">
                  <span role="columnheader">档位</span>
                  <span role="columnheader">省份</span>
                  <span role="columnheader">首重费用</span>
                  <span role="columnheader">续重费用</span>
                  <span role="columnheader">续重单位</span>
                </div>
              </div>
              <div role="rowgroup">
                {shipping.zones.map((zone) => (
                  <div
                    role="row"
                    key={zone.key}
                    className="grid grid-cols-[34px_minmax(19rem,1fr)_100px_100px_70px] items-center gap-2 border-b py-1.5 text-sm last:border-b-0"
                  >
                    <span role="cell" className="font-extrabold">
                      {zone.name}
                    </span>
                    <span
                      role="cell"
                      className="admin-wrap-anywhere whitespace-normal text-xs font-semibold leading-5 text-muted-foreground"
                    >
                      {zone.provinces.join(' ')}
                    </span>
                    <div role="cell">
                      <PricingNumericInput
                        {...zone.firstWeightFee}
                        ariaLabel={`${zone.name}档首重费用`}
                        step="0.1"
                      />
                    </div>
                    <div role="cell">
                      <PricingNumericInput
                        {...zone.incrementFee}
                        ariaLabel={`${zone.name}档续重费用`}
                        step="0.1"
                      />
                    </div>
                    <span
                      role="cell"
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      元/{decimalLabel(zone.incrementKilograms, 1)}kg
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </TableScrollArea>
          <div className="px-4 pb-4 pt-2 sm:px-5">
            <FormulaNote>
              试算：2,000个 160g → 上海{' '}
              <strong className="text-destructive">
                {currencyLabel(shanghai, 1)}
              </strong>{' '}
              · 甘肃{' '}
              <strong className="text-destructive">
                {currencyLabel(gansu, 1)}
              </strong>
            </FormulaNote>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
